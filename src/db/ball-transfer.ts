import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { readCapacityState } from "./ball";
import { canFulfil } from "../ball/capacity";
import type { BallBookingWrite } from "../ball/booking";
import type { BankDetails, InvoiceDetails, TransferSettings } from "../ball/transfer";

// TASK-484: the reads and writes behind paying for the Ball by bank transfer. The rules are in
// src/ball/transfer.ts. Every write that takes seats queues behind the same ball_settings row lock as
// the card checkout and named holds, and re-reads capacity once it has it, so a transfer booking can
// never be granted seats somebody else was granted a moment earlier.

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const lockSettings = (client: PoolClient) => client.query("SELECT id FROM ball_settings WHERE id = 1 FOR UPDATE");

// --- the bank details and the switch --------------------------------------------------------------

export async function getTransferSettings(): Promise<TransferSettings> {
  const res = await pool.query(
    `SELECT transfer_on, transfer_account_name, transfer_sort_code, transfer_account_number,
            to_char(transfer_last_day, 'YYYY-MM-DD') AS transfer_last_day
       FROM ball_settings WHERE id = 1`,
  );
  const r = res.rows[0];
  return {
    on: r.transfer_on,
    accountName: r.transfer_account_name,
    sortCode: r.transfer_sort_code,
    accountNumber: r.transfer_account_number,
    lastDay: r.transfer_last_day,
  };
}

export async function saveTransferSettings(
  update: { on?: boolean; details?: BankDetails; lastDay?: string | null },
  actor: string,
): Promise<TransferSettings> {
  await inTransaction(async (client) => {
    if (update.details) {
      await client.query(
        `UPDATE ball_settings
            SET transfer_account_name = $1, transfer_sort_code = $2, transfer_account_number = $3
          WHERE id = 1`,
        [update.details.accountName, update.details.sortCode, update.details.accountNumber],
      );
    }
    if (update.on !== undefined) {
      await client.query(`UPDATE ball_settings SET transfer_on = $1 WHERE id = 1`, [update.on]);
    }
    // TASK-485: null clears it.
    if (update.lastDay !== undefined) {
      await client.query(`UPDATE ball_settings SET transfer_last_day = $1 WHERE id = 1`, [update.lastDay]);
    }
    // What changed, never the numbers themselves: more people can read the audit log than the settings.
    await insertAudit(client, {
      actor,
      action: "ball.transfer_settings_changed",
      entity: "ball_settings",
      entityId: 1,
      data: {
        switchedOn: update.on ?? null,
        bankDetailsChanged: Boolean(update.details),
        lastDay: update.lastDay === undefined ? "unchanged" : update.lastDay,
      },
    });
  });
  return getTransferSettings();
}

// --- booking -------------------------------------------------------------------------------------

/** A new transfer booking, holding its seats from now. Null when there is no longer room for it. */
export async function createTransferBooking(
  write: Omit<BallBookingWrite, "stripeSessionId">,
  payBy: string,
  invoice: InvoiceDetails | null = null,
): Promise<{ id: number } | null> {
  return inTransaction(async (client) => {
    await lockSettings(client);
    const state = await readCapacityState(client);
    if (!canFulfil(state, { kind: write.kind, quantity: write.quantity })) return null;
    const res = await client.query<{ id: number }>(
      `INSERT INTO ball_bookings
         (reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname, buyer_email,
          tickets_pence, donation_pence, fee_cover_pence, total_pence, gift_aid, newsletter_opt_in,
          status, terms_accepted_at, payment_method, pay_by,
          invoice_company, invoice_address, invoice_po, invoice_accounts_email, invoice_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,$13,'pending',now(),'transfer',$14,
               $15,$16,$17,$18,$19)
       RETURNING id`,
      [
        write.reference,
        write.kind,
        write.quantity,
        write.seats,
        write.buyerName,
        write.buyerFirstName,
        write.buyerSurname,
        write.buyerEmail,
        write.ticketsPence,
        write.donationPence,
        write.totalPence,
        write.giftAid,
        write.newsletterOptIn,
        payBy,
        invoice?.company ?? null,
        invoice?.address ?? null,
        invoice?.po ?? null,
        invoice?.accountsEmail ?? null,
        invoice?.phone ?? null,
      ],
    );
    return { id: res.rows[0].id };
  });
}

// --- TASK-486: the invoice ------------------------------------------------------------------------

export interface InvoiceBooking {
  id: number;
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  ticketsPence: number;
  donationPence: number;
  totalPence: number;
  status: string;
  payBy: string | null;
  issuedOn: string;
  paidOn: string | null;
  company: string;
  address: string;
  po: string | null;
}

/** A transfer booking with an invoice, for its printable page; null when it has none. */
export async function getBookingForInvoice(id: number): Promise<InvoiceBooking | null> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, tickets_pence, donation_pence, total_pence,
            status, to_char(pay_by, 'YYYY-MM-DD') AS pay_by,
            to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS issued_on,
            to_char(paid_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS paid_on,
            invoice_company, invoice_address, invoice_po
       FROM ball_bookings
      WHERE id = $1 AND payment_method = 'transfer' AND invoice_company IS NOT NULL`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    ticketsPence: r.tickets_pence,
    donationPence: r.donation_pence,
    totalPence: r.total_pence,
    status: r.status,
    payBy: r.pay_by,
    issuedOn: r.issued_on,
    paidOn: r.paid_on,
    company: r.invoice_company,
    address: r.invoice_address,
    po: r.invoice_po,
  };
}

/** Whether a booking has an invoice, and the accounts team to copy in. */
export interface InvoiceContact {
  bookingId: number;
  accountsEmail: string | null;
}

// --- the admin's list ----------------------------------------------------------------------------

export interface AwaitingTransfer {
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  buyerEmail: string;
  totalPence: number;
  payBy: string;
  createdAt: string;
  /** TASK-485: the "please pay by" reminder has gone. */
  reminded: boolean;
  /** TASK-486: the company it is invoiced to, or null without an invoice. */
  company: string | null;
}

/** Every transfer still waiting for its money, the one due soonest first (so overdue ones lead). */
export async function listAwaitingTransfers(): Promise<AwaitingTransfer[]> {
  const res = await pool.query(
    `SELECT reference, kind, quantity, seats, buyer_name, buyer_email, total_pence,
            to_char(pay_by, 'YYYY-MM-DD') AS pay_by, created_at,
            transfer_reminder_sent_at IS NOT NULL AS reminded, invoice_company
       FROM ball_bookings
      WHERE payment_method = 'transfer' AND status = 'pending'
      ORDER BY pay_by ASC, created_at ASC`,
  );
  return res.rows.map((r) => ({
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    totalPence: r.total_pence,
    payBy: r.pay_by,
    createdAt: r.created_at,
    reminded: r.reminded,
    company: r.invoice_company,
  }));
}

// --- TASK-485: the reminder -----------------------------------------------------------------------

export interface ReminderCandidate {
  id: number;
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  buyerEmail: string;
  ticketsPence: number;
  donationPence: number;
  totalPence: number;
  giftAid: boolean;
  payBy: string;
  /** The UK date it was booked. */
  createdDay: string;
  remindedAt: string | null;
  invoice: InvoiceContact | null;
}

/** Unpaid transfers not yet reminded. Whether each is due today is the pure reminderDue's call. */
export async function listTransfersForReminder(): Promise<ReminderCandidate[]> {
  const res = await pool.query(
    `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_email, tickets_pence,
            donation_pence, total_pence, gift_aid, to_char(pay_by, 'YYYY-MM-DD') AS pay_by,
            to_char(created_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS created_day,
            invoice_company, invoice_accounts_email
       FROM ball_bookings
      WHERE payment_method = 'transfer' AND status = 'pending' AND transfer_reminder_sent_at IS NULL`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    kind: r.kind,
    quantity: r.quantity,
    seats: r.seats,
    buyerName: r.buyer_name,
    buyerEmail: r.buyer_email,
    ticketsPence: r.tickets_pence,
    donationPence: r.donation_pence,
    totalPence: r.total_pence,
    giftAid: r.gift_aid,
    payBy: r.pay_by,
    createdDay: r.created_day,
    invoice: r.invoice_company ? { bookingId: r.id, accountsEmail: r.invoice_accounts_email } : null,
    remindedAt: null,
  }));
}

/** Mark it reminded only if nothing has yet: true when this caller won it, so only one run sends. */
export async function claimTransferReminder(id: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE ball_bookings SET transfer_reminder_sent_at = now()
      WHERE id = $1 AND transfer_reminder_sent_at IS NULL AND status = 'pending'
      RETURNING id`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Give a claim back after its send failed, so the next run tries again. */
export async function releaseTransferReminder(id: number): Promise<void> {
  await pool.query(`UPDATE ball_bookings SET transfer_reminder_sent_at = NULL WHERE id = $1`, [id]);
}

// --- marking paid --------------------------------------------------------------------------------

export type MarkPaidOutcome =
  | { ok: true; reinstated: boolean; booking: BallBookingWrite; guestToken: string; invoice: InvoiceContact | null }
  | { ok: false; reason: "not_found" | "not_transfer" | "already_paid" | "was_paid" | "amount_mismatch" | "seats_gone" };

interface BookingDbRow {
  id: number;
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyer_name: string;
  buyer_first_name: string | null;
  buyer_surname: string | null;
  buyer_email: string;
  tickets_pence: number;
  donation_pence: number;
  fee_cover_pence: number;
  total_pence: number;
  gift_aid: boolean;
  newsletter_opt_in: boolean;
  status: string;
  payment_method: string;
  guest_token: string | null;
  cancelled_from: string | null;
  invoice_company: string | null;
  invoice_accounts_email: string | null;
}

function toWrite(r: BookingDbRow): BallBookingWrite {
  return {
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
    stripeSessionId: "", // a transfer has no Stripe session
  };
}

/**
 * An admin confirms the money has arrived. `confirmTotalPence` is the amount they were shown and
 * agreed to: it must be this booking's total, so a click on the wrong row, or a screen left open
 * while the order changed, cannot mark money arrived that did not. A cancelled transfer booking comes
 * back as paid only if its seats are still free: being cancelled, they are no longer counted, so the
 * question is whether there is room for them again.
 */
export async function markTransferPaid(
  reference: string,
  confirmTotalPence: number,
  actor: string,
  newToken: string,
): Promise<MarkPaidOutcome> {
  return inTransaction(async (client) => {
    await lockSettings(client);
    const found = await client.query<BookingDbRow>(
      `SELECT id, reference, kind, quantity, seats, buyer_name, buyer_first_name, buyer_surname,
              buyer_email, tickets_pence, donation_pence, fee_cover_pence, total_pence, gift_aid,
              newsletter_opt_in, status, payment_method, guest_token, cancelled_from,
              invoice_company, invoice_accounts_email
         FROM ball_bookings WHERE reference = $1 FOR UPDATE`,
      [reference],
    );
    const row = found.rows[0];
    if (!row) return { ok: false, reason: "not_found" };
    if (row.payment_method !== "transfer") return { ok: false, reason: "not_transfer" };
    if (row.status === "paid") return { ok: false, reason: "already_paid" };
    if (row.status !== "pending" && row.status !== "cancelled") return { ok: false, reason: "not_found" };
    // Paid, then cancelled and refunded by hand: bringing it back would confirm money the charity
    // has returned. Only a transfer cancelled while still unpaid can come back (TASK-484 review).
    if (row.status === "cancelled" && row.cancelled_from !== "pending") return { ok: false, reason: "was_paid" };
    if (row.total_pence !== confirmTotalPence) return { ok: false, reason: "amount_mismatch" };

    const reinstated = row.status === "cancelled";
    if (reinstated && !canFulfil(await readCapacityState(client), { kind: row.kind, quantity: row.quantity })) {
      return { ok: false, reason: "seats_gone" };
    }

    const updated = await client.query<{ guest_token: string }>(
      `UPDATE ball_bookings
          SET status = 'paid', paid_at = now(), marked_paid_by = $2,
              guest_token = COALESCE(guest_token, $3)
        WHERE id = $1
        RETURNING guest_token`,
      [row.id, actor, newToken],
    );
    await insertAudit(client, {
      actor,
      action: reinstated ? "ball.transfer_reinstated" : "ball.transfer_marked_paid",
      entity: "ball_booking",
      entityId: row.id,
      data: { reference, totalPence: row.total_pence },
    });
    return {
      ok: true,
      reinstated,
      booking: toWrite(row),
      guestToken: updated.rows[0].guest_token,
      invoice: row.invoice_company ? { bookingId: row.id, accountsEmail: row.invoice_accounts_email } : null,
    };
  });
}

// --- more time -----------------------------------------------------------------------------------

export async function extendPayBy(
  reference: string,
  payBy: string,
  actor: string,
): Promise<"ok" | "not_found" | "not_open"> {
  return inTransaction(async (client) => {
    const found = await client.query<{ id: number; status: string; payment_method: string; pay_by: string | null }>(
      `SELECT id, status, payment_method, to_char(pay_by, 'YYYY-MM-DD') AS pay_by
         FROM ball_bookings WHERE reference = $1 FOR UPDATE`,
      [reference],
    );
    const row = found.rows[0];
    if (!row) return "not_found";
    if (row.payment_method !== "transfer" || row.status !== "pending") return "not_open";
    // TASK-485: a new date gets its own reminder two days before it, so the old one is forgotten.
    await client.query(`UPDATE ball_bookings SET pay_by = $2, transfer_reminder_sent_at = NULL WHERE id = $1`, [
      row.id,
      payBy,
    ]);
    await insertAudit(client, {
      actor,
      action: "ball.transfer_pay_by_changed",
      entity: "ball_booking",
      entityId: row.id,
      data: { reference, from: row.pay_by, to: payBy },
    });
    return "ok";
  });
}

// --- the card fallback's duplicate (TASK-484) ----------------------------------------------------

/** The Stripe session of a still-pending CARD booking, so the checkout can retire it. */
export async function pendingCardSession(reference: string): Promise<string | null> {
  const res = await pool.query<{ stripe_session_id: string | null }>(
    `SELECT stripe_session_id FROM ball_bookings
      WHERE reference = $1 AND status = 'pending' AND payment_method = 'card'`,
    [reference],
  );
  return res.rows[0]?.stripe_session_id ?? null;
}

/** Give back the seats of a card checkout the buyer replaced. Only after Stripe agreed to expire it. */
export async function cancelReplacedCheckout(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE ball_bookings SET status = 'cancelled'
      WHERE stripe_session_id = $1 AND status = 'pending' AND payment_method = 'card'`,
    [sessionId],
  );
}
