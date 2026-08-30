import type { PoolClient } from "pg";
import { pool } from "./pool";
import {
  availability,
  canFulfil,
  seatsFor,
  type CapacityState,
  type Availability,
  type Order,
} from "../ball/capacity";
import type { BallBookingWrite } from "../ball/booking";
import type { BallSettingsUpdate } from "../ball/settings";
import { retentionDate, type GuestInput } from "../ball/guests";
import type { GuestPageBooking, GuestRow } from "../ball/guest-page";
import type { ExportBooking, ExportGuest } from "../ball/exports";
import type { WaitingListEntry } from "../ball/waiting-list";
import { insertAudit } from "./donations";

// TASK-313: the read/write layer for the Festive Ball. Pure decisions live in src/ball/;
// only SQL lives here, mirroring how src/db/ticker.ts pairs with src/ticker/model.ts.

export interface BallSettings {
  totalTables: number;
  seatsPerTable: number;
  heldSeats: number;
  gateOpen: boolean;
  gateOpensAt: string | null;
  salesCloseAt: string | null;
  salesClosed: boolean;
  // Details that were not confirmed when the page was written (TASK-313). NULL until staff
  // set them; the page then keeps its honest "to be confirmed" wording.
  arrivalTime: string | null;
  includedNote: string | null;
  lineUpNote: string | null;
}

// What updateSettings actually writes. previewPassword (plaintext) is REPLACED by
// previewPasswordHash before it gets here, so there is no code path that could put the
// plaintext into SQL even by mistake.
export type BallSettingsWrite = Omit<BallSettingsUpdate, "previewPassword"> & {
  previewPasswordHash?: string;
};

interface SettingsRow {
  total_tables: number;
  seats_per_table: number;
  held_seats: number;
  gate_open: boolean;
  gate_opens_at: string | null;
  sales_close_at: string | null;
  sales_closed: boolean;
  arrival_time: string | null;
  included_note: string | null;
  line_up_note: string | null;
}

const SETTINGS_SQL = `SELECT total_tables, seats_per_table, held_seats, gate_open,
                             gate_opens_at, sales_close_at, sales_closed,
                             arrival_time, included_note, line_up_note
                        FROM ball_settings WHERE id = 1`;

// Sold seats, split by how they were bought. 'pending' counts as well as 'paid': a booking
// awaiting Stripe confirmation is still holding those seats, and releasing them early would
// let the room oversell in the seconds between payment and webhook.
const SOLD_SQL = `SELECT
    COALESCE(SUM(quantity) FILTER (WHERE kind = 'table'), 0) AS tables_sold,
    COALESCE(SUM(quantity) FILTER (WHERE kind = 'seat'),  0) AS loose_seats_sold
  FROM ball_bookings WHERE status IN ('pending', 'paid')`;

// Only live holds count. Expired rows are ignored by the WHERE clause rather than deleted,
// so a plain read never has to take a write lock.
const RESERVED_SQL = `SELECT COALESCE(SUM(seats), 0) AS reserved_seats
                        FROM ball_reservations WHERE expires_at > now()`;

function toSettings(r: SettingsRow): BallSettings {
  return {
    totalTables: r.total_tables,
    seatsPerTable: r.seats_per_table,
    heldSeats: r.held_seats,
    gateOpen: r.gate_open,
    gateOpensAt: r.gate_opens_at,
    salesCloseAt: r.sales_close_at,
    salesClosed: r.sales_closed,
    arrivalTime: r.arrival_time,
    includedNote: r.included_note,
    lineUpNote: r.line_up_note,
  };
}

// A querier is either the pool or a client already inside a transaction, so the same three
// reads back both the plain availability read and the locked reservation claim below.
type Querier = Pick<PoolClient, "query">;

async function readCapacityState(db: Querier): Promise<CapacityState> {
  const s = await db.query<SettingsRow>(SETTINGS_SQL);
  const sold = await db.query<{ tables_sold: string; loose_seats_sold: string }>(SOLD_SQL);
  const held = await db.query<{ reserved_seats: string }>(RESERVED_SQL);
  const r = s.rows[0];
  return {
    totalTables: r.total_tables,
    seatsPerTable: r.seats_per_table,
    heldSeats: r.held_seats,
    // SUM() comes back as a string from pg for bigint-ish results; coerce explicitly.
    tablesSold: Number(sold.rows[0].tables_sold),
    looseSeatsSold: Number(sold.rows[0].loose_seats_sold),
    reservedSeats: Number(held.rows[0].reserved_seats),
  };
}

export async function getSettings(): Promise<BallSettings> {
  const res = await pool.query<SettingsRow>(SETTINGS_SQL);
  return toSettings(res.rows[0]);
}

export async function getCapacityState(): Promise<CapacityState> {
  return readCapacityState(pool);
}

export async function getAvailability(): Promise<Availability & { salesOpen: boolean }> {
  const res = await pool.query<SettingsRow>(SETTINGS_SQL);
  const settings = toSettings(res.rows[0]);
  const state = await readCapacityState(pool);
  const a = availability(state);
  const closedByDate =
    settings.salesCloseAt !== null && new Date(settings.salesCloseAt) <= new Date();
  return { ...a, salesOpen: !settings.salesClosed && !closedByDate && !a.soldOut };
}

// Claim seats for a checkout. Runs in a transaction that LOCKS the single settings row, so
// simultaneous buyers are serialised: the second one sees the first one's reservation and is
// refused, rather than both being told yes and the room overselling. Returns null when the
// order cannot be met.
export async function claimReservation(
  order: Order,
  token: string,
  holdMs: number,
): Promise<{ token: string; expiresAt: string } | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialise every claim behind the one settings row.
    await client.query("SELECT id FROM ball_settings WHERE id = 1 FOR UPDATE");

    const state = await readCapacityState(client);
    if (!canFulfil(state, order)) {
      await client.query("ROLLBACK");
      return null;
    }

    const seats = seatsFor(order, state.seatsPerTable);
    const res = await client.query<{ expires_at: string }>(
      `INSERT INTO ball_reservations (token, kind, quantity, seats, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
       RETURNING expires_at`,
      [token, order.kind, order.quantity, seats, String(holdMs)],
    );
    await client.query("COMMIT");
    return { token, expiresAt: res.rows[0].expires_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function releaseReservation(token: string): Promise<void> {
  await pool.query(`DELETE FROM ball_reservations WHERE token = $1`, [token]);
}

// --- bookings ---------------------------------------------------------------
//
// A booking is written as 'pending' the moment the Stripe session is created, and it is the
// pending row — not the short reservation — that holds the seats from then on. That ordering
// matters: the 15-minute reservation only has to cover the gap between "choose" and "session
// created", after which the booking itself is the record of intent. Stripe's own 30-minute
// session expiry then closes the loop, via checkout.session.expired -> cancelled, so an
// abandoned checkout gives its seats back without a sweeper.

export async function createPendingBooking(booking: BallBookingWrite): Promise<void> {
  await pool.query(
    `INSERT INTO ball_bookings
       (reference, kind, quantity, seats, buyer_name, buyer_email,
        tickets_pence, donation_pence, fee_cover_pence, total_pence,
        gift_aid, newsletter_opt_in, stripe_session_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [
      booking.reference,
      booking.kind,
      booking.quantity,
      booking.seats,
      booking.buyerName,
      booking.buyerEmail,
      booking.ticketsPence,
      booking.donationPence,
      booking.feeCoverPence,
      booking.totalPence,
      booking.giftAid,
      booking.newsletterOptIn,
      booking.stripeSessionId,
    ],
  );
}

// Flip a booking to paid, on the webhook's transaction so it commits with the event-id claim.
// Also backfills the buyer email, which Stripe only knows for certain once payment completes.
// Returns the action label the webhook dispatcher reports.
export async function markBookingPaid(
  client: Querier,
  booking: BallBookingWrite,
): Promise<string> {
  const res = await client.query(
    `UPDATE ball_bookings
        SET status = 'paid',
            paid_at = now(),
            buyer_email = COALESCE(NULLIF($2, ''), buyer_email)
      WHERE stripe_session_id = $1 AND status = 'pending'`,
    [booking.stripeSessionId, booking.buyerEmail],
  );
  if (res.rowCount && res.rowCount > 0) return "ball.paid";

  // No pending row: either Stripe redelivered after we already recorded it (harmless), or the
  // session was created outside this app. Insert defensively so a real payment is never lost.
  const existing = await client.query(
    `SELECT status FROM ball_bookings WHERE stripe_session_id = $1`,
    [booking.stripeSessionId],
  );
  if (existing.rowCount && existing.rowCount > 0) return "ball.already_paid";

  await client.query(
    `INSERT INTO ball_bookings
       (reference, kind, quantity, seats, buyer_name, buyer_email,
        tickets_pence, donation_pence, fee_cover_pence, total_pence,
        gift_aid, newsletter_opt_in, stripe_session_id, status, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'paid',now())
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [
      booking.reference,
      booking.kind,
      booking.quantity,
      booking.seats,
      booking.buyerName,
      booking.buyerEmail,
      booking.ticketsPence,
      booking.donationPence,
      booking.feeCoverPence,
      booking.totalPence,
      booking.giftAid,
      booking.newsletterOptIn,
      booking.stripeSessionId,
    ],
  );
  return "ball.paid_recovered";
}

// An abandoned checkout: Stripe expired the session, so give the seats back.
export async function markBookingExpired(client: Querier, sessionId: string): Promise<string> {
  const res = await client.query(
    `UPDATE ball_bookings SET status = 'cancelled'
      WHERE stripe_session_id = $1 AND status = 'pending'`,
    [sessionId],
  );
  return res.rowCount && res.rowCount > 0 ? "ball.expired" : "ball.expired_noop";
}

// --- admin -------------------------------------------------------------------

// Map the validated update onto columns. Explicit rather than generated from the object keys,
// so a field can never reach SQL just because it appeared in a request body — the ticket price
// has no column here and no way to acquire one.
const SETTING_COLUMNS: Record<keyof BallSettingsWrite, string> = {
  previewPasswordHash: "preview_password_hash",
  totalTables: "total_tables",
  seatsPerTable: "seats_per_table",
  heldSeats: "held_seats",
  gateOpen: "gate_open",
  gateOpensAt: "gate_opens_at",
  salesCloseAt: "sales_close_at",
  salesClosed: "sales_closed",
  arrivalTime: "arrival_time",
  includedNote: "included_note",
  lineUpNote: "line_up_note",
};

// Save settings and record WHO changed WHAT in the same transaction. The gate toggle publishes
// a page to the public and the capacity decides whether the room oversells, so both belong in
// the audit log next to the donation writes.
export async function updateSettings(
  update: BallSettingsWrite,
  actor: string,
): Promise<BallSettings> {
  const entries = Object.entries(update).filter(([key]) => key in SETTING_COLUMNS);
  if (entries.length === 0) return getSettings();

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of entries) {
    values.push(value);
    sets.push(`${SETTING_COLUMNS[key as keyof BallSettingsWrite]} = $${values.length}`);
  }
  sets.push("updated_at = now()");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<SettingsRow>(
      `UPDATE ball_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING
         total_tables, seats_per_table, held_seats, gate_open, gate_opens_at,
         sales_close_at, sales_closed, arrival_time, included_note, line_up_note`,
      values,
    );
    await insertAudit(client, {
      actor,
      action: "ball.settings_updated",
      entity: "ball_settings",
      entityId: 1,
      // Never let the hash (or anything derived from the password) into the audit log. Record
      // only that it changed — which is the useful fact anyway: who changed it and when.
      data: {
        ...Object.fromEntries(
          Object.entries(update).filter(([k]) => k !== "previewPasswordHash"),
        ),
        ...(update.previewPasswordHash ? { previewPassword: "(changed)" } : {}),
      },
    });
    await client.query("COMMIT");
    return toSettings(res.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface BallBookingRow {
  id: number;
  reference: string;
  kind: string;
  quantity: number;
  seats: number;
  buyerName: string;
  buyerEmail: string;
  totalPence: number;
  donationPence: number;
  giftAid: boolean;
  newsletterOptIn: boolean;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export async function listBookings(limit = 200, offset = 0): Promise<BallBookingRow[]> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_email,
            total_pence, donation_pence, gift_aid, newsletter_opt_in, status,
            created_at, paid_at
       FROM ball_bookings
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [Math.min(Math.max(limit, 1), 500), Math.max(offset, 0)],
  );
  return res.rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    totalPence: r.total_pence,
    donationPence: r.donation_pence,
    giftAid: r.gift_aid,
    newsletterOptIn: r.newsletter_opt_in,
    status: r.status,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  }));
}

export interface BallDashboard {
  seatsSold: number;
  tablesSold: number;
  bookings: number;
  ticketsPence: number;
  donationsPence: number;
  feeCoverPence: number;
  totalPence: number;
  giftAidablePence: number;
  newsletterOptIns: number;
}

// Only PAID bookings count towards the money. A pending row is holding a seat, not banked
// income, and showing it as raised would overstate the total to the trustees.
export async function getDashboard(): Promise<BallDashboard> {
  const res = await pool.query(
    `SELECT
       COALESCE(SUM(seats), 0)                                          AS seats_sold,
       COALESCE(SUM(quantity) FILTER (WHERE kind = 'table'), 0)         AS tables_sold,
       COUNT(*)                                                         AS bookings,
       COALESCE(SUM(tickets_pence), 0)                                  AS tickets_pence,
       COALESCE(SUM(donation_pence), 0)                                 AS donations_pence,
       COALESCE(SUM(fee_cover_pence), 0)                                AS fee_cover_pence,
       COALESCE(SUM(total_pence), 0)                                    AS total_pence,
       COALESCE(SUM(donation_pence) FILTER (WHERE gift_aid), 0)         AS gift_aidable_pence,
       COUNT(*) FILTER (WHERE newsletter_opt_in)                        AS newsletter_opt_ins
     FROM ball_bookings WHERE status = 'paid'`,
  );
  const r = res.rows[0];
  return {
    seatsSold: Number(r.seats_sold),
    tablesSold: Number(r.tables_sold),
    bookings: Number(r.bookings),
    ticketsPence: Number(r.tickets_pence),
    donationsPence: Number(r.donations_pence),
    feeCoverPence: Number(r.fee_cover_pence),
    totalPence: Number(r.total_pence),
    giftAidablePence: Number(r.gift_aidable_pence),
    newsletterOptIns: Number(r.newsletter_opt_ins),
  };
}

// --- guest details (plan 5) --------------------------------------------------

export interface BookingByToken {
  id: number;
  booking: GuestPageBooking;
  guests: GuestRow[];
}

// Resolve the emailed link. Only a PAID booking is addressable: a pending one may never be paid,
// and a cancelled one has no table to describe.
export async function getBookingByGuestToken(token: string): Promise<BookingByToken | null> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, table_name
       FROM ball_bookings
      WHERE guest_token = $1 AND status = 'paid'`,
    [token],
  );
  const r = res.rows[0];
  if (!r) return null;

  const guests = await pool.query(
    `SELECT full_name, dietary, access_needs FROM ball_guests
      WHERE booking_id = $1 ORDER BY id ASC`,
    [r.id],
  );
  return {
    id: r.id,
    booking: {
      reference: r.reference,
      kind: r.kind === "table" ? "table" : "seat",
      quantity: r.quantity,
      seats: r.seats,
      buyerName: r.buyer_name,
      tableName: r.table_name,
    },
    guests: guests.rows.map((g) => ({
      fullName: g.full_name,
      dietary: g.dietary,
      accessNeeds: g.access_needs,
    })),
  };
}

// Replace the whole guest list in one transaction. Delete-then-insert rather than diffing:
// the form always submits the complete table, so a partial write would leave a door list that
// half matches what the booker just saw — worse than either state alone.
export interface GuestWrite {
  tableName: string | null;
  guests: GuestInput[];
}

// Takes the data shape rather than the schema's branded type: guestSubmissionSchema requires at
// least one guest (right for the JSON API), but clearing a table from the form is a legitimate
// thing for a booker fixing a mistake, so the writer accepts an empty list.
export async function saveGuests(bookingId: number, submission: GuestWrite): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE ball_bookings SET table_name = $2 WHERE id = $1", [
      bookingId,
      submission.tableName,
    ]);
    await client.query("DELETE FROM ball_guests WHERE booking_id = $1", [bookingId]);
    const expires = retentionDate().toISOString();
    for (const g of submission.guests) {
      await client.query(
        `INSERT INTO ball_guests (booking_id, full_name, dietary, access_needs, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [bookingId, g.fullName, g.dietary, g.accessNeeds, expires],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Mint the link token when a booking is paid. Idempotent: an existing token is kept, so a
// Stripe redelivery cannot invalidate a link already sitting in someone's inbox.
export async function ensureGuestToken(sessionId: string, token: string): Promise<string | null> {
  const res = await pool.query<{ guest_token: string }>(
    `UPDATE ball_bookings SET guest_token = COALESCE(guest_token, $2)
      WHERE stripe_session_id = $1 AND status = 'paid'
      RETURNING guest_token`,
    [sessionId, token],
  );
  return res.rows[0]?.guest_token ?? null;
}

// Delete guest details past their retention date. Called from the admin read so it runs
// naturally without a scheduler; the ninety-day promise in the ticket terms is kept by the
// row's own expires_at rather than by anyone remembering.
export async function purgeExpiredGuests(): Promise<number> {
  const res = await pool.query("DELETE FROM ball_guests WHERE expires_at <= now()");
  return res.rowCount ?? 0;
}

// --- exports (plan 5) --------------------------------------------------------

// Every named guest on a PAID booking, with the table they sit at. Pending and cancelled
// bookings are excluded: nobody unpaid is coming, and printing them would send the welcome desk
// looking for people who are not there.
export async function listGuestsForExport(): Promise<ExportGuest[]> {
  const res = await pool.query(
    `SELECT g.full_name, g.dietary, g.access_needs, b.table_name, b.reference
       FROM ball_guests g
       JOIN ball_bookings b ON b.id = g.booking_id
      WHERE b.status = 'paid'`,
  );
  return res.rows.map((r) => ({
    fullName: r.full_name,
    dietary: r.dietary,
    accessNeeds: r.access_needs,
    tableName: r.table_name,
    reference: r.reference,
  }));
}

export async function listBookingsForExport(): Promise<ExportBooking[]> {
  const res = await pool.query(
    `SELECT reference, kind, quantity, seats, buyer_name, buyer_email, tickets_pence,
            donation_pence, fee_cover_pence, total_pence, gift_aid, newsletter_opt_in,
            status, table_name, created_at
       FROM ball_bookings
      ORDER BY created_at ASC`,
  );
  return res.rows.map((r) => ({
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    ticketsPence: r.tickets_pence,
    donationPence: r.donation_pence,
    feeCoverPence: r.fee_cover_pence,
    totalPence: r.total_pence,
    giftAid: r.gift_aid,
    newsletterOptIn: r.newsletter_opt_in,
    status: r.status,
    tableName: r.table_name,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// --- reminders (plan 5) ------------------------------------------------------

export interface ReminderTarget {
  id: number;
  reference: string;
  buyerName: string;
  buyerEmail: string;
  seats: number;
  tableName: string | null;
  guestToken: string | null;
  guests: GuestRow[];
}

// Everyone who has PAID and has not already been reminded. The WHERE clause is the whole
// idempotency story: pressing send twice finds nobody the second time.
export async function listBookingsNeedingReminder(): Promise<ReminderTarget[]> {
  const res = await pool.query(
    `SELECT id, reference, buyer_name, buyer_email, seats, table_name, guest_token
       FROM ball_bookings
      WHERE status = 'paid' AND reminder_sent_at IS NULL AND buyer_email <> ''
      ORDER BY id ASC`,
  );
  const targets: ReminderTarget[] = [];
  for (const r of res.rows) {
    const guests = await pool.query(
      `SELECT full_name, dietary, access_needs FROM ball_guests
        WHERE booking_id = $1 ORDER BY id ASC`,
      [r.id],
    );
    targets.push({
      id: r.id,
      reference: r.reference,
      buyerName: r.buyer_name,
      buyerEmail: r.buyer_email,
      seats: r.seats,
      tableName: r.table_name,
      guestToken: r.guest_token,
      guests: guests.rows.map((g) => ({
        fullName: g.full_name,
        dietary: g.dietary,
        accessNeeds: g.access_needs,
      })),
    });
  }
  return targets;
}

// Stamped per booking as each send succeeds, NOT in one batch at the end: if the provider fails
// halfway through four hundred, the ones already emailed must not be emailed again on retry.
export async function markReminderSent(bookingId: number): Promise<void> {
  await pool.query("UPDATE ball_bookings SET reminder_sent_at = now() WHERE id = $1", [bookingId]);
}

// --- waiting list (plan 5) ---------------------------------------------------

// Upsert on email: pressing join twice updates the entry rather than creating a duplicate, so
// staff never have to work out which of two rows is current. Returns false if the address was
// already there, so the page can say "you're already on the list" rather than implying a second
// place was added.
export async function joinWaitingList(entry: WaitingListEntry): Promise<{ added: boolean }> {
  const res = await pool.query(
    `INSERT INTO ball_waiting_list (name, email, seats_wanted, note, newsletter_opt_in)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           seats_wanted = EXCLUDED.seats_wanted,
           note = EXCLUDED.note,
           newsletter_opt_in = ball_waiting_list.newsletter_opt_in OR EXCLUDED.newsletter_opt_in
     RETURNING (xmax = 0) AS inserted`,
    [entry.name, entry.email, entry.seatsWanted, entry.note, entry.newsletterOptIn],
  );
  return { added: Boolean(res.rows[0]?.inserted) };
}

export interface WaitingListRow {
  id: number;
  name: string;
  email: string;
  seatsWanted: number;
  note: string | null;
  newsletterOptIn: boolean;
  offeredAt: string | null;
  createdAt: string;
}

// Oldest first: a waiting list that does not run in order is not a waiting list.
export async function listWaitingList(): Promise<WaitingListRow[]> {
  const res = await pool.query(
    `SELECT id, name, email, seats_wanted, note, newsletter_opt_in, offered_at, created_at
       FROM ball_waiting_list ORDER BY created_at ASC, id ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    seatsWanted: r.seats_wanted,
    note: r.note,
    newsletterOptIn: r.newsletter_opt_in,
    offeredAt: r.offered_at,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

// The preview gate's secret: the staff-set hash if there is one, otherwise the config value.
// Kept OUT of BallSettings deliberately — that object is serialised straight to the admin API,
// and a hash has no business travelling to a browser.
export async function getPreviewPasswordHash(): Promise<string | null> {
  const res = await pool.query<{ preview_password_hash: string | null }>(
    "SELECT preview_password_hash FROM ball_settings WHERE id = 1",
  );
  return res.rows[0]?.preview_password_hash ?? null;
}
