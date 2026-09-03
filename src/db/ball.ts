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
import type { ThankYouBooking } from "../ball/thank-you-page";
import type { CardFeeRate } from "../ball/pricing";
import type { GuestProgressRow } from "../ball/guest-progress";
import type { RunUpBooking } from "../ball/run-up";
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
  // TASK-338: when guest details close. NULL until agreed with the venue.
  guestDetailsLockAt: string | null;
  // TASK-345: NULL until the venue confirms a menu; the guest form shows no menu section while
  // it is null, rather than an empty picker.
  menuOptions: string | null;
  // The card rate NBCC is actually charged (TASK-317). Data rather than a constant, because
  // the page asks buyers to cover this exact number: a stale rate collects money for a fee
  // that was never charged. Basis points so nothing here is a float — 120 = 1.20%.
  cardFeePercentBp: number;
  cardFeeFixedPence: number;
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
  guest_details_lock_at: string | null;
  menu_options: string | null;
  card_fee_percent_bp: number;
  card_fee_fixed_pence: number;
}

const SETTINGS_SQL = `SELECT total_tables, seats_per_table, held_seats, gate_open,
                             gate_opens_at, sales_close_at, sales_closed,
                             arrival_time, included_note, line_up_note,
                             guest_details_lock_at, menu_options,
                             card_fee_percent_bp, card_fee_fixed_pence
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

// Named holds that are still standing (TASK-324). Same idea as the reservations read above:
// expiry is a clause, not a job, so a hold cannot outlive its deadline because a sweeper
// failed. Folded into heldSeats below, which means every downstream calculation — seats left,
// whether a whole table is still unbroken, whether an order can be met — needs no change.
const HOLDS_SQL = `SELECT COALESCE(SUM(seats), 0) AS held_seats
                     FROM ball_holds
                    WHERE released_at IS NULL
                      AND (expires_at IS NULL OR expires_at > now())`;

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
    guestDetailsLockAt: r.guest_details_lock_at,
    menuOptions: r.menu_options,
    cardFeePercentBp: r.card_fee_percent_bp,
    cardFeeFixedPence: r.card_fee_fixed_pence,
  };
}

// A querier is either the pool or a client already inside a transaction, so the same three
// reads back both the plain availability read and the locked reservation claim below.
type Querier = Pick<PoolClient, "query">;

async function readCapacityState(db: Querier): Promise<CapacityState> {
  const s = await db.query<SettingsRow>(SETTINGS_SQL);
  const sold = await db.query<{ tables_sold: string; loose_seats_sold: string }>(SOLD_SQL);
  const held = await db.query<{ reserved_seats: string }>(RESERVED_SQL);
  const named = await db.query<{ held_seats: string }>(HOLDS_SQL);
  const r = s.rows[0];
  return {
    totalTables: r.total_tables,
    seatsPerTable: r.seats_per_table,
    // The blunt settings number PLUS every active named hold. Keeping both means TASK-324 is
    // purely additive: the old field still works, and it can be retired once the holds it
    // stood for have been written down properly.
    heldSeats: r.held_seats + Number(named.rows[0].held_seats),
    // SUM() comes back as a string from pg for bigint-ish results; coerce explicitly.
    tablesSold: Number(sold.rows[0].tables_sold),
    looseSeatsSold: Number(sold.rows[0].loose_seats_sold),
    reservedSeats: Number(held.rows[0].reserved_seats),
  };
}

// The card rate NBCC is charged, for anywhere that needs to quote it. It lives on
// ball_settings because that is where it was first needed (TASK-317), but it is a fact about
// the STRIPE ACCOUNT, not about the ball — the donate page is charged the same rate and reads
// it from here (TASK-321) rather than keeping a second copy that would drift.
export async function getCardFeeRate(): Promise<CardFeeRate> {
  const settings = await getSettings();
  return {
    percentBp: settings.cardFeePercentBp,
    fixedPence: settings.cardFeeFixedPence,
  };
}

export async function getSettings(): Promise<BallSettings> {
  const res = await pool.query<SettingsRow>(SETTINGS_SQL);
  return toSettings(res.rows[0]);
}

export async function getCapacityState(): Promise<CapacityState> {
  return readCapacityState(pool);
}

export async function getAvailability(): Promise<
  Availability & { salesOpen: boolean; cardFee: CardFeeRate }
> {
  const res = await pool.query<SettingsRow>(SETTINGS_SQL);
  const settings = toSettings(res.rows[0]);
  const state = await readCapacityState(pool);
  const a = availability(state);
  const closedByDate =
    settings.salesCloseAt !== null && new Date(settings.salesCloseAt) <= new Date();
  return {
    ...a,
    salesOpen: !settings.salesClosed && !closedByDate && !a.soldOut,
    // Carried here so the ONE read the checkout already does gives the route the rate too,
    // rather than a second round trip to price the same order.
    cardFee: {
      percentBp: settings.cardFeePercentBp,
      fixedPence: settings.cardFeeFixedPence,
    },
  };
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
       (reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname,
        buyer_email, tickets_pence, donation_pence, fee_cover_pence, total_pence,
        gift_aid, newsletter_opt_in, stripe_session_id, status, terms_accepted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',now())
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [
      booking.reference,
      booking.kind,
      booking.quantity,
      booking.seats,
      booking.buyerName,
      booking.buyerFirstName,
      booking.buyerSurname,
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
       (reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname,
        buyer_email, tickets_pence, donation_pence, fee_cover_pence, total_pence,
        gift_aid, newsletter_opt_in, stripe_session_id, status, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'paid',now())
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [
      booking.reference,
      booking.kind,
      booking.quantity,
      booking.seats,
      booking.buyerName,
      booking.buyerFirstName,
      booking.buyerSurname,
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
  guestDetailsLockAt: "guest_details_lock_at",
  menuOptions: "menu_options",
  cardFeePercentBp: "card_fee_percent_bp",
  cardFeeFixedPence: "card_fee_fixed_pence",
};

// TASK-323: cancel a booking from the admin area.
//
// The seats come back on their own: readCapacityState counts only 'pending' and 'paid', so a
// cancelled booking stops consuming capacity the moment the status changes. There is no
// separate "give the seats back" step to forget.
//
// It does NOT refund anything. Money is moved in Stripe, by a person, deliberately — a button
// in our admin that quietly issued refunds would be a far worse thing to get wrong than one
// that does not. The UI says so, and so does the README.
//
// Only a live booking can be cancelled. Re-cancelling something already cancelled or refunded
// returns null rather than pretending it did something, so the caller can say so plainly.
export type CancelOutcome =
  | { ok: true; seats: number; wasStatus: "pending" | "paid" }
  | { ok: false; reason: "not_found" | "already_closed"; status?: string };

export async function cancelBooking(
  reference: string,
  actor: string,
  note: string | null,
): Promise<CancelOutcome> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Locked for the length of the transaction so two staff pressing cancel at once cannot
    // both count it as a fresh cancellation in the audit log.
    const found = await client.query<{ id: number; status: string; seats: number }>(
      `SELECT id, status, seats FROM ball_bookings WHERE reference = $1 FOR UPDATE`,
      [reference],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (row.status !== "pending" && row.status !== "paid") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_closed", status: row.status };
    }

    await client.query(
      `UPDATE ball_bookings SET status = 'cancelled' WHERE id = $1`,
      [row.id],
    );
    await insertAudit(client, {
      actor,
      action: "ball.booking_cancelled",
      entity: "ball_booking",
      entityId: row.id,
      data: {
        reference,
        seatsReturned: row.seats,
        previousStatus: row.status,
        note: note ?? null,
      },
    });
    await client.query("COMMIT");
    return { ok: true, seats: row.seats, wasStatus: row.status };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- named holds (TASK-324) --------------------------------------------------

export interface BallHold {
  id: number;
  name: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  note: string | null;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

// Everything still standing, soonest to expire first, so the ones about to hand seats back are
// the ones staff see at the top. Holds with no deadline sort last: they are the ones that need
// a decision, not a reminder.
export async function listActiveHolds(): Promise<BallHold[]> {
  const res = await pool.query(
    `SELECT id, name, kind, quantity, seats, note, expires_at, created_by, created_at
       FROM ball_holds
      WHERE released_at IS NULL
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST, created_at ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    note: r.note,
    expiresAt: r.expires_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

// Place a hold, inside the SAME lock the checkout uses.
//
// Without the lock, a hold and a purchase can each be told there is room for the last table
// and both be granted it. This is the one write besides checkout that consumes capacity, so it
// queues behind the same settings row and re-checks availability having taken it.
export async function createHold(
  hold: { name: string; kind: "seat" | "table"; quantity: number; seats: number; note: string | null; expiresAt: string | null },
  actor: string,
): Promise<{ ok: true; id: number } | { ok: false; reason: "no_room" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM ball_settings WHERE id = 1 FOR UPDATE");
    const state = await readCapacityState(client);
    // Judged on SEATS, whichever kind was asked for: holding four tables when only 30 seats
    // are left has to fail, and it is the seat count that says so.
    if (availability(state).seatsRemaining < hold.seats) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "no_room" };
    }
    const res = await client.query<{ id: number }>(
      `INSERT INTO ball_holds (name, kind, quantity, seats, note, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [hold.name, hold.kind, hold.quantity, hold.seats, hold.note, hold.expiresAt, actor],
    );
    await insertAudit(client, {
      actor,
      action: "ball.hold_created",
      entity: "ball_hold",
      entityId: res.rows[0].id,
      data: { ...hold },
    });
    await client.query("COMMIT");
    return { ok: true, id: res.rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Hand the seats back early. Released rather than deleted: what was held, for whom, and who
// let it go is the whole point of writing it down.
export async function releaseHold(
  id: number,
  actor: string,
): Promise<{ ok: true; seats: number } | { ok: false; reason: "not_found" | "already_released" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ id: number; seats: number; released_at: string | null }>(
      `SELECT id, seats, released_at FROM ball_holds WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (row.released_at !== null) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_released" };
    }
    await client.query(`UPDATE ball_holds SET released_at = now() WHERE id = $1`, [id]);
    await insertAudit(client, {
      actor,
      action: "ball.hold_released",
      entity: "ball_hold",
      entityId: id,
      data: { seatsReturned: row.seats },
    });
    await client.query("COMMIT");
    return { ok: true, seats: row.seats };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

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
         sales_close_at, sales_closed, arrival_time, included_note, line_up_note,
         guest_details_lock_at, menu_options`,
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

// TASK-337: how many checkouts were started and never finished.
//
// Reported as a NUMBER rather than as rows. A pending booking is somebody who pressed pay and
// did not arrive - either still typing their card in, or long gone - and listing them beside
// real buyers made the bookings table read as sales that had not happened. The count still has
// to be visible somewhere: a sudden run of them is what a broken payment flow looks like from
// the outside, and hiding the rows without hiding the fact is the honest middle.
// The abandoned rows themselves, for the collapsed panel under the bookings table. Newest
// first: a checkout abandoned in the last hour is somebody who may still be mid-payment, which
// is the only one worth looking at.
export async function listAbandonedBookings(limit = 100): Promise<BallBookingRow[]> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_email,
            total_pence, donation_pence, gift_aid, newsletter_opt_in, status,
            created_at, paid_at
       FROM ball_bookings
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)],
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

export async function countAbandonedBookings(): Promise<number> {
  const res = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM ball_bookings WHERE status = 'pending'`,
  );
  return Number(res.rows[0]?.n ?? 0);
}

// Real outcomes only - paid and cancelled. See countAbandonedBookings above for why 'pending'
// is excluded rather than shown greyed out.
export async function listBookings(limit = 200, offset = 0): Promise<BallBookingRow[]> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_email,
            total_pence, donation_pence, gift_aid, newsletter_opt_in, status,
            created_at, paid_at
       FROM ball_bookings
      WHERE status <> 'pending'
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
    // TASK-409: buyer_surname joins buyer_first_name so the form can fill the booker in as the
    // first guest rather than asking them to type their own name into their own booking.
    `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname,
            buyer_email, table_name
       FROM ball_bookings
      WHERE guest_token = $1 AND status = 'paid'`,
    [token],
  );
  const r = res.rows[0];
  if (!r) return null;

  const guests = await pool.query(
    // menu_choice was already being read back by the mapper below but was never in the SELECT,
    // so every guest's menu choice came back undefined and the form re-rendered blank. Fixed
    // here while adding the name halves, since it is the same list and the same bug shape.
    `SELECT full_name, first_name, surname, dietary, access_needs, menu_choice FROM ball_guests
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
      buyerFirstName: r.buyer_first_name,
      buyerSurname: r.buyer_surname,
      buyerEmail: r.buyer_email,
      tableName: r.table_name,
    },
    guests: guests.rows.map((g) => ({
      fullName: g.full_name,
      firstName: g.first_name,
      surname: g.surname,
      dietary: g.dietary,
      accessNeeds: g.access_needs,
      menuChoice: g.menu_choice,
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
        // TASK-409: full_name is still written, holding "First Surname", because the door list,
        // the CSV exports, the admin table and the reminder email's read-back all read it. The
        // halves sit beside it for sorting by surname.
        `INSERT INTO ball_guests
           (booking_id, full_name, first_name, surname, dietary, access_needs, expires_at, menu_choice)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          bookingId,
          g.fullName,
          g.firstName ?? null,
          g.surname ?? null,
          g.dietary,
          g.accessNeeds,
          expires,
          g.menuChoice ?? null,
        ],
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
// TASK-336: how many guests each PAID booking has named, against how many seats it holds.
//
// A LEFT JOIN, not an inner one: a booking with no guests yet is the entire point of the query,
// and an inner join drops exactly the rows staff need to chase. Grouped in SQL rather than
// counted in Node so a sold-out ball is one round trip and not four hundred.
//
// Unpaid bookings are excluded. A pending or expired row owes nobody anything, and counting it
// would put seats nobody bought into the denominator of the catering list.
// TASK-338: everything the daily run-up pass needs, in one query.
//
// Same LEFT JOIN reasoning as listGuestProgress below - a booking with no guests is exactly the
// one being chased, so an inner join would drop it. Paid only: an abandoned checkout owes nobody
// an email.
export async function listBookingsForRunUp(): Promise<RunUpBooking[]> {
  const res = await pool.query(
    `SELECT b.id, b.reference, b.buyer_email, b.buyer_first_name, b.seats, b.guest_token,
            b.buyer_name, b.table_name,
            b.guest_chase_sent_at, b.guest_final_call_sent_at, b.reminder_sent_at,
            COUNT(g.id)::int AS guests_named
       FROM ball_bookings b
       LEFT JOIN ball_guests g ON g.booking_id = b.id
      WHERE b.status = 'paid' AND b.buyer_email <> ''
      GROUP BY b.id
      ORDER BY b.id ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    buyerEmail: r.buyer_email,
    buyerName: r.buyer_name,
    buyerFirstName: r.buyer_first_name,
    tableName: r.table_name,
    seats: r.seats,
    guestsNamed: r.guests_named,
    guestToken: r.guest_token,
    guestChaseSentAt: r.guest_chase_sent_at,
    guestFinalCallSentAt: r.guest_final_call_sent_at,
    reminderSentAt: r.reminder_sent_at,
  }));
}

// Written only AFTER a send succeeds. The column is chosen from a fixed map rather than
// interpolated, so a stage name can never reach SQL as an identifier.
const RUN_UP_STAMP: Record<string, string> = {
  chase: "guest_chase_sent_at",
  "final-call": "guest_final_call_sent_at",
  practical: "reminder_sent_at",
  summary: "guest_summary_sent_at",
};

export async function markRunUpSent(bookingId: number, stage: string): Promise<void> {
  const column = RUN_UP_STAMP[stage];
  if (!column) throw new Error(`unknown run-up stage: ${stage}`);
  await pool.query(`UPDATE ball_bookings SET ${column} = now() WHERE id = $1`, [bookingId]);
}

// The guests on one booking, for the read-back in the practical email.
export async function listGuestsForBooking(bookingId: number): Promise<GuestRow[]> {
  const res = await pool.query(
    `SELECT full_name, dietary, access_needs FROM ball_guests
      WHERE booking_id = $1 ORDER BY id ASC`,
    [bookingId],
  );
  return res.rows.map((g) => ({
    fullName: g.full_name,
    dietary: g.dietary,
    accessNeeds: g.access_needs,
  }));
}

export async function listGuestProgress(): Promise<GuestProgressRow[]> {
  const res = await pool.query(
    `SELECT b.reference, b.buyer_name, b.buyer_email, b.seats, b.guest_token,
            COUNT(g.id)::int AS guests_named,
            COUNT(g.id) FILTER (
              WHERE COALESCE(g.dietary, '') <> '' OR COALESCE(g.access_needs, '') <> ''
            )::int AS needs_given
       FROM ball_bookings b
       LEFT JOIN ball_guests g ON g.booking_id = b.id
      WHERE b.status = 'paid'
      GROUP BY b.id, b.reference, b.buyer_name, b.buyer_email, b.seats, b.guest_token
      ORDER BY b.created_at ASC`,
  );
  return res.rows.map((r) => ({
    reference: r.reference,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    seats: r.seats,
    guestsNamed: r.guests_named,
    needsGiven: r.needs_given,
    guestToken: r.guest_token,
  }));
}

export async function listGuestsForExport(): Promise<ExportGuest[]> {
  const res = await pool.query(
    `SELECT g.full_name, g.surname, g.dietary, g.access_needs, g.menu_choice,
            b.table_name, b.reference
       FROM ball_guests g
       JOIN ball_bookings b ON b.id = g.booking_id
      WHERE b.status = 'paid'`,
  );
  return res.rows.map((r) => ({
    fullName: r.full_name,
    surname: r.surname,
    dietary: r.dietary,
    accessNeeds: r.access_needs,
    menuChoice: r.menu_choice,
    tableName: r.table_name,
    reference: r.reference,
  }));
}

export async function listBookingsForExport(): Promise<ExportBooking[]> {
  const res = await pool.query(
    `SELECT reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname,
            buyer_email, tickets_pence, donation_pence, fee_cover_pence, total_pence,
            gift_aid, newsletter_opt_in, status, table_name, created_at
       FROM ball_bookings
      ORDER BY created_at ASC`,
  );
  return res.rows.map((r) => ({
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    buyerFirstName: r.buyer_first_name,
    buyerSurname: r.buyer_surname,
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
  /** NULL on bookings taken before TASK-318; the email falls back to the whole name. */
  buyerFirstName: string | null;
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
    `SELECT id, reference, buyer_name, buyer_first_name, buyer_email, seats, table_name, guest_token
       FROM ball_bookings
      WHERE status = 'paid' AND reminder_sent_at IS NULL AND buyer_email <> ''
      ORDER BY id ASC`,
  );
  const targets: ReminderTarget[] = [];
  for (const r of res.rows) {
    const guests = await pool.query(
      `SELECT full_name, dietary, access_needs, menu_choice FROM ball_guests
        WHERE booking_id = $1 ORDER BY id ASC`,
      [r.id],
    );
    targets.push({
      id: r.id,
      reference: r.reference,
      buyerName: r.buyer_name,
      buyerFirstName: r.buyer_first_name,
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
    `INSERT INTO ball_waiting_list
       (name, first_name, surname, email, seats_wanted, note, newsletter_opt_in)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           first_name = EXCLUDED.first_name,
           surname = EXCLUDED.surname,
           seats_wanted = EXCLUDED.seats_wanted,
           note = EXCLUDED.note,
           newsletter_opt_in = ball_waiting_list.newsletter_opt_in OR EXCLUDED.newsletter_opt_in
     RETURNING (xmax = 0) AS inserted`,
    [
      entry.name,
      entry.firstName,
      entry.surname,
      entry.email,
      entry.seatsWanted,
      entry.note,
      entry.newsletterOptIn,
    ],
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

// The booking behind a Stripe session, for the post-payment page. Any status is fine: Stripe
// only redirects on success, so a row still 'pending' just means the webhook has not landed in
// the second since. Returns null for an unknown id rather than throwing — the page then shows a
// generic "your payment went through" instead of an error.
export async function getBookingBySessionId(sessionId: string): Promise<ThankYouBooking | null> {
  const res = await pool.query(
    `SELECT reference, kind, quantity, seats, buyer_email, total_pence, guest_token
       FROM ball_bookings WHERE stripe_session_id = $1`,
    [sessionId],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    reference: r.reference,
    kind: r.kind === "table" ? "table" : "seat",
    quantity: r.quantity,
    seats: r.seats,
    buyerEmail: r.buyer_email,
    totalPence: r.total_pence,
    guestToken: r.guest_token,
  };
}
