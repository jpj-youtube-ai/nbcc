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
