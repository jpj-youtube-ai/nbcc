import { pool } from "./pool";
import { insertAudit } from "./donations";
import { chaseRecipientsSchema, type ChaseBooking } from "../ball/chase";
import type { Recipient } from "../ball/sales-report";

// TASK-575: the Festive Ball chase's reads and writes. What to send, and to whom, is decided by the
// pure src/ball/chase.ts; this file only reads the bookings, keeps the volunteers' list, and records
// which chase emails have gone so a second run of the daily job sends nothing twice.

/**
 * Every booking the chase looks at: paid ones (whatever their email or link state, the volunteers'
 * list needs the ones with no address too) and bank transfers still waiting for their money.
 * Cancelled, refunded and expired bookings are left out. Choices are read as listMenuProgress reads
 * them: one entry per named guest.
 */
export async function listChaseBookings(): Promise<ChaseBooking[]> {
  const res = await pool.query(
    `SELECT b.id, b.reference, b.status, b.payment_method, b.buyer_name, b.buyer_first_name, b.buyer_email,
            b.buyer_phone, b.guest_token, b.seats,
            COALESCE(
              array_agg(g.menu_choice) FILTER (WHERE g.id IS NOT NULL),
              '{}'
            ) AS choices,
            to_char(b.reminder_sent_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS reminder_sent_on
       FROM ball_bookings b
       LEFT JOIN ball_guests g ON g.booking_id = b.id
      WHERE b.status = 'paid' OR (b.status = 'pending' AND b.payment_method = 'transfer')
      GROUP BY b.id
      ORDER BY b.id ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status as "paid" | "pending",
    paymentMethod: r.payment_method,
    buyerName: r.buyer_name,
    buyerFirstName: r.buyer_first_name,
    buyerEmail: r.buyer_email,
    buyerPhone: r.buyer_phone,
    guestToken: r.guest_token,
    seats: r.seats,
    choices: (r.choices ?? []) as Array<string | null>,
    reminderSentOn: r.reminder_sent_on,
  }));
}

/** The volunteers the chase list goes to. Re-read through the same rules it was saved by. */
export async function getChaseRecipients(): Promise<Recipient[]> {
  const s = await pool.query<{ chase_recipients: unknown }>("SELECT chase_recipients FROM ball_settings WHERE id = 1");
  const parsed = chaseRecipientsSchema.safeParse(s.rows[0]?.chase_recipients ?? []);
  if (parsed.success) return parsed.data;
  // The list carries people's phone numbers, so a stored list that no longer passes goes to nobody
  // rather than to someone it should not. Said out loud (no addresses in the message), so a list
  // that quietly stopped arriving is found by the logs and not by a volunteer wondering where it is.
  console.error(
    `ball chase: the stored volunteers' list failed its checks, so the chase list goes to nobody (${parsed.error.issues.length} problem${parsed.error.issues.length === 1 ? "" : "s"}). Save the list again in Festive Ball, Emails.`,
  );
  return [];
}

export interface ChaseSendSummary {
  kind: string;
  sentOn: string;
  count: number;
}

/** What has gone lately, newest first: one line per kind and day, with how many emails it was. Sent ones only. */
export async function listRecentChaseSends(limit = 5): Promise<ChaseSendSummary[]> {
  const r = await pool.query<{ kind: string; sent_on: string; n: number }>(
    `SELECT kind, to_char(sent_on, 'YYYY-MM-DD') AS sent_on, count(*)::int AS n
       FROM ball_chase_sends
      WHERE status = 'sent'
      GROUP BY kind, sent_on
      ORDER BY sent_on DESC, kind ASC
      LIMIT $1`,
    [limit],
  );
  return r.rows.map((row) => ({ kind: row.kind, sentOn: row.sent_on, count: row.n }));
}

/** Saves the volunteers' list, with an audit row saying who was added and who was taken off. */
export async function saveChaseRecipients(list: Recipient[], actor: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ chase_recipients: Recipient[] }>(
      "SELECT chase_recipients FROM ball_settings WHERE id = 1 FOR UPDATE",
    );
    await client.query("UPDATE ball_settings SET chase_recipients = $1::jsonb WHERE id = 1", [JSON.stringify(list)]);
    const was = before.rows[0]?.chase_recipients ?? [];
    const wasEmails = new Set(was.map((r) => r.email));
    const nowEmails = new Set(list.map((r) => r.email));
    await insertAudit(client, {
      actor,
      action: "ball_chase.recipients_saved",
      entity: "ball_chase",
      entityId: null,
      data: {
        recipients: list.length,
        // The list carries people's phone numbers, so who it newly goes to, and by whom, is the
        // point of this row.
        added: [...nowEmails].filter((e) => !wasEmails.has(e)),
        removed: [...wasEmails].filter((e) => !nowEmails.has(e)),
      },
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Claims one chase email for the day. The unique key means only one claim per kind, day and address
 * can exist, so a second run of the daily job gets null and sends nothing.
 */
export async function claimChaseSend(
  kind: "reminder" | "list",
  sentOn: string,
  recipient: string,
): Promise<number | null> {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ball_chase_sends (kind, sent_on, recipient) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING id`,
    [kind, sentOn, recipient.trim().toLowerCase()],
  );
  return r.rows[0]?.id ?? null;
}

/** Records the email as gone, and which bookings it covered. */
export async function markChaseSent(id: number, bookingIds: number[]): Promise<void> {
  await pool.query("UPDATE ball_chase_sends SET status = 'sent', booking_ids = $2 WHERE id = $1", [id, bookingIds]);
}

/** A failed send gives the claim back, so it is tried again and never marked as gone when it did not. */
export async function releaseChaseClaim(id: number): Promise<void> {
  await pool.query("DELETE FROM ball_chase_sends WHERE id = $1 AND status = 'claimed'", [id]);
}
