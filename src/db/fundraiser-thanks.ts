import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { thanksLimitReached, type SkipReason, type ThanksRow, type ThanksStatus } from "../fundraising/thanks";

// TASK-507: the SQL behind "Thank your supporters". The rules are pure, in src/fundraising/thanks.ts;
// this file only moves rows.
//
//   - Sending one for checking: under the fundraiser's row lock, only by its own organiser, only while
//     it is approved or finished, at most three in any 24 hours (counted under the same lock). Every
//     gift picked must be a paid gift on THIS fundraiser, not money the organiser paid in and not
//     refunded in full, or nothing is stored (so another fundraiser's gifts can never be picked).
//     Gifts already in a thank you are skipped; a gift is thanked at most once (also a unique index).
//   - Deciding: approve queues every gift to send; not sending cancels them, which frees them.
//   - Sending: one gift at a time, each claimed (FOR UPDATE SKIP LOCKED) before its email, so two
//     senders never take the same one. The email address is read from the donor row at that moment
//     and never stored here. When the last gift of a thank you is dealt with, it is marked delivered
//     and the counts recorded, once.
//   - Every write records an audit_log row in the SAME transaction, against entity "fundraiser".

export type ThanksErrorReason = "not_found" | "bad_status" | "not_waiting";

export class ThanksError extends Error {
  constructor(public readonly reason: ThanksErrorReason) {
    super(`fundraiser thanks: ${reason}`);
    this.name = "ThanksError";
  }
}

type Row = Record<string, unknown>;
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// A thank you with its counts. WHERE is added by the caller.
const WITH_COUNTS = `SELECT t.id, t.fundraiser_id, t.message, t.status, t.created_at, t.decided_at, t.decided_by,
        t.reject_reason, t.delivered_at,
        count(g.id) AS gifts,
        count(g.id) FILTER (WHERE g.outcome IN ('queued', 'sending')) AS waiting,
        count(g.id) FILTER (WHERE g.outcome = 'sent') AS sent,
        count(g.id) FILTER (WHERE g.outcome = 'skipped') AS skipped,
        count(g.id) FILTER (WHERE g.outcome = 'failed') AS failed
   FROM fundraiser_thanks t LEFT JOIN fundraiser_thank_gifts g ON g.thanks_id = t.id`;
const GROUPED = "GROUP BY t.id ORDER BY t.created_at DESC, t.id DESC";

function toThanks(r: Row): ThanksRow {
  return {
    id: Number(r.id),
    fundraiserId: Number(r.fundraiser_id),
    message: String(r.message),
    status: r.status as ThanksStatus,
    createdAt: iso(r.created_at) as string,
    decidedAt: iso(r.decided_at),
    decidedBy: r.decided_by == null ? null : String(r.decided_by),
    rejectReason: r.reject_reason == null ? null : String(r.reject_reason),
    deliveredAt: iso(r.delivered_at),
    gifts: Number(r.gifts ?? 0),
    waiting: Number(r.waiting ?? 0),
    sent: Number(r.sent ?? 0),
    skipped: Number(r.skipped ?? 0),
    failed: Number(r.failed ?? 0),
  };
}

// --- the organiser --------------------------------------------------------------------------------

/** The gifts on these fundraisers already in a thank you (waiting, sent or skipped). */
export async function heldDonationIds(fundraiserIds: number[]): Promise<Set<number>> {
  if (fundraiserIds.length === 0) return new Set();
  const r = await pool.query(
    `SELECT g.donation_id FROM fundraiser_thank_gifts g JOIN fundraiser_thanks t ON t.id = g.thanks_id
      WHERE t.fundraiser_id = ANY($1) AND g.outcome <> 'cancelled'`,
    [fundraiserIds],
  );
  return new Set(r.rows.map((row) => Number(row.donation_id)));
}

/** The thank yous on these fundraisers, newest first, with their counts. */
export async function listThanks(fundraiserIds: number[]): Promise<ThanksRow[]> {
  if (fundraiserIds.length === 0) return [];
  const r = await pool.query(`${WITH_COUNTS} WHERE t.fundraiser_id = ANY($1) ${GROUPED}`, [fundraiserIds]);
  return r.rows.map(toThanks);
}

export type CreateThanksResult =
  | { verdict: "ok"; thanks: ThanksRow; alreadyThanked: number }
  | { verdict: "limit" }
  | { verdict: "bad_gift" }
  | { verdict: "none" };

/**
 * The signed in organiser (`email`) sends a thank you for checking. "limit" after three in 24 hours;
 * "bad_gift" when any gift picked is not a gift on this fundraiser that can be thanked; "none" when
 * every one picked is thanked already. Nothing is stored for any of those. Someone else's fundraiser
 * reads as not there.
 */
export async function createThanks(fundraiserId: number, email: string, message: string, donationIds: number[]): Promise<CreateThanksResult> {
  return inTransaction(async (client) => {
    const f = (await client.query("SELECT id, organiser_email, status FROM fundraisers WHERE id = $1 FOR UPDATE", [fundraiserId])).rows[0] as
      | Row
      | undefined;
    if (!f || String(f.organiser_email).trim().toLowerCase() !== email.trim().toLowerCase()) throw new ThanksError("not_found");
    if (f.status !== "approved" && f.status !== "finished") throw new ThanksError("bad_status");
    const counted = await client.query(
      "SELECT count(*) AS n FROM fundraiser_thanks WHERE fundraiser_id = $1 AND created_at > now() - interval '24 hours'",
      [fundraiserId],
    );
    if (thanksLimitReached(Number(counted.rows[0]?.n ?? 0))) return { verdict: "limit" as const };
    const real = await client.query(
      `SELECT d.id FROM donations d
        WHERE d.id = ANY($1) AND d.fundraiser_id = $2 AND d.payment_status = 'paid' AND NOT d.paid_in_by_organiser
          AND d.amount_pence - d.refunded_amount_pence > 0`,
      [donationIds, fundraiserId],
    );
    const realIds = new Set(real.rows.map((row) => Number(row.id)));
    if (donationIds.some((id) => !realIds.has(id))) return { verdict: "bad_gift" as const };
    // In memory (Jaimie, 2026-10-03): only givers who ticked "Let the family know I gave" may be
    // thanked, as only they are on the organiser's list.
    const unasked = await client.query(
      `SELECT d.id AS unasked FROM donations d JOIN fundraisers f ON f.id = d.fundraiser_id
        WHERE d.id = ANY($1) AND d.fundraiser_id = $2 AND f.in_memory AND NOT d.family_notify`,
      [donationIds, fundraiserId],
    );
    if (unasked.rows.length > 0) return { verdict: "bad_gift" as const };
    const held = await client.query(
      `SELECT g.donation_id FROM fundraiser_thank_gifts g WHERE g.donation_id = ANY($1) AND g.outcome <> 'cancelled'`,
      [donationIds],
    );
    const heldIds = new Set(held.rows.map((row) => Number(row.donation_id)));
    const fresh = donationIds.filter((id) => !heldIds.has(id));
    if (fresh.length === 0) return { verdict: "none" as const };
    const ins = await client.query(
      `INSERT INTO fundraiser_thanks (fundraiser_id, message) VALUES ($1, $2)
       RETURNING id, fundraiser_id, message, status, created_at, decided_at, decided_by, reject_reason, delivered_at`,
      [fundraiserId, message],
    );
    const thanks = toThanks({ ...ins.rows[0], gifts: fresh.length });
    await client.query(
      "INSERT INTO fundraiser_thank_gifts (thanks_id, donation_id) SELECT $1, unnest($2::int[])",
      [thanks.id, fresh],
    );
    await insertAudit(client, {
      actor: "organiser",
      action: "fundraiser.thanks_posted",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: { thanksId: thanks.id, gifts: fresh.length, alreadyThanked: heldIds.size },
    });
    return { verdict: "ok" as const, thanks, alreadyThanked: heldIds.size };
  });
}

// --- staff ----------------------------------------------------------------------------------------

/** Thank yous waiting for staff, for the Monday summary. */
export async function countPendingThanks(): Promise<number> {
  const r = await pool.query("SELECT count(*) AS n FROM fundraiser_thanks WHERE status = 'pending'");
  return Number(r.rows[0]?.n ?? 0);
}

/** How many wait on each fundraiser, for the "Thank yous to check" pill on the admin's list. */
export async function pendingThanksByFundraiser(): Promise<Record<number, number>> {
  const r = await pool.query("SELECT fundraiser_id, count(*) AS n FROM fundraiser_thanks WHERE status = 'pending' GROUP BY fundraiser_id");
  const out: Record<number, number> = {};
  for (const row of r.rows) out[Number(row.fundraiser_id)] = Number(row.n);
  return out;
}

export interface StaffThanksGift {
  donationId: number;
  name: string;
  amountPence: number;
  outcome: string;
  skipReason: SkipReason | null;
  sentAt: string | null;
}

/** A sign up's thank yous for staff, each with its gifts and what happened to each. Never an address. */
export async function listThanksForStaff(fundraiserId: number): Promise<Array<ThanksRow & { recipients: StaffThanksGift[] }>> {
  const thanks = await listThanks([fundraiserId]);
  if (thanks.length === 0) return [];
  const r = await pool.query(
    `SELECT g.thanks_id, g.donation_id, g.outcome, g.skip_reason, g.sent_at, dn.full_name, d.amount_pence, d.refunded_amount_pence
       FROM fundraiser_thank_gifts g JOIN donations d ON d.id = g.donation_id JOIN donors dn ON dn.id = d.donor_id
      WHERE g.thanks_id = ANY($1) ORDER BY g.id`,
    [thanks.map((t) => t.id)],
  );
  return thanks.map((t) => ({
    ...t,
    recipients: r.rows
      .filter((row) => Number(row.thanks_id) === t.id)
      .map((row) => ({
        donationId: Number(row.donation_id),
        name: String(row.full_name ?? ""),
        amountPence: Math.max(0, Number(row.amount_pence) - Number(row.refunded_amount_pence ?? 0)),
        outcome: String(row.outcome),
        skipReason: (row.skip_reason as SkipReason | null) ?? null,
        sentAt: iso(row.sent_at),
      })),
  }));
}

export type ThanksDecision = "approve" | "reject";

/**
 * Approve a waiting thank you (every gift is queued to send) or not send it (every gift is freed to
 * thank again; a reason, if given, stays with staff). Anything already decided is "not_waiting".
 */
export async function decideThanks(
  fundraiserId: number,
  thanksId: number,
  decision: ThanksDecision,
  actor: string,
  reason: string | null = null,
): Promise<ThanksRow> {
  return inTransaction(async (client) => {
    const found = await client.query("SELECT status FROM fundraiser_thanks WHERE id = $1 AND fundraiser_id = $2 FOR UPDATE", [thanksId, fundraiserId]);
    const row = found.rows[0] as Row | undefined;
    if (!row) throw new ThanksError("not_found");
    if (row.status !== "pending") throw new ThanksError("not_waiting");
    const approve = decision === "approve";
    const kept = approve ? null : reason;
    await client.query(
      "UPDATE fundraiser_thanks SET status = $1, decided_at = now(), decided_by = $2, reject_reason = $3 WHERE id = $4",
      [approve ? "approved" : "rejected", actor, kept, thanksId],
    );
    await client.query(
      approve
        ? "UPDATE fundraiser_thank_gifts SET outcome = 'queued', updated_at = now() WHERE thanks_id = $1 AND outcome = 'waiting'"
        : "UPDATE fundraiser_thank_gifts SET outcome = 'cancelled', updated_at = now() WHERE thanks_id = $1 AND outcome = 'waiting'",
      [thanksId],
    );
    await insertAudit(client, {
      actor,
      action: approve ? "fundraiser.thanks_approved" : "fundraiser.thanks_rejected",
      entity: "fundraiser",
      entityId: fundraiserId,
      data: kept ? { thanksId, reason: kept } : { thanksId },
    });
    const r = await client.query(`${WITH_COUNTS} WHERE t.id = $1 ${GROUPED}`, [thanksId]);
    return toThanks(r.rows[0]);
  });
}

// --- sending --------------------------------------------------------------------------------------

/** One gift's email, claimed: everything the email and the checks need, read at the moment of sending. */
export interface QueuedThanksGift {
  id: number;
  thanksId: number;
  fundraiserId: number;
  donationId: number;
  message: string;
  title: string;
  organiserName: string;
  donorName: string;
  email: string | null;
  /**
   * This thank you has already gone to the same address for another of their gifts, or is going now
   * from an earlier claim (a lower id), so two senders never email one person twice.
   */
  alreadySent: boolean;
  /** The gift and its fundraiser as they are now, to check it can still be thanked. */
  paymentStatus: string;
  amountPence: number;
  refundedPence: number;
  paidIn: boolean;
  fundraiserStatus: string;
  /** In memory: the email is the gentle version. */
  inMemory?: boolean;
}

/** Claim the next queued gift (it becomes "sending"), or null when there is none. */
export async function claimNextQueuedThanksGift(): Promise<QueuedThanksGift | null> {
  const claimed = await pool.query(
    `UPDATE fundraiser_thank_gifts SET outcome = 'sending', updated_at = now()
      WHERE id = (SELECT id FROM fundraiser_thank_gifts WHERE outcome = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, thanks_id, donation_id`,
  );
  const c = claimed.rows[0] as Row | undefined;
  if (!c) return null;
  const r = await pool.query(
    `SELECT t.id AS thanks_id, t.fundraiser_id, t.message, f.title, f.organiser_name, f.status AS fundraiser_status, f.in_memory,
            dn.full_name, dn.email, d.payment_status, d.amount_pence, d.refunded_amount_pence, d.paid_in_by_organiser,
            EXISTS (SELECT 1 FROM fundraiser_thank_gifts g2
                      JOIN donations d2 ON d2.id = g2.donation_id JOIN donors dn2 ON dn2.id = d2.donor_id
                     WHERE g2.thanks_id = t.id AND (g2.outcome = 'sent' OR (g2.outcome = 'sending' AND g2.id < $3))
                       AND dn.email IS NOT NULL AND lower(trim(dn2.email)) = lower(trim(dn.email))) AS already_sent
       FROM fundraiser_thanks t JOIN fundraisers f ON f.id = t.fundraiser_id
       JOIN donations d ON d.id = $2 JOIN donors dn ON dn.id = d.donor_id
      WHERE t.id = $1`,
    [c.thanks_id, c.donation_id, c.id],
  );
  const row = r.rows[0] as Row | undefined;
  return {
    id: Number(c.id),
    thanksId: Number(c.thanks_id),
    fundraiserId: row ? Number(row.fundraiser_id) : 0,
    donationId: Number(c.donation_id),
    message: row ? String(row.message) : "",
    title: row ? String(row.title) : "",
    organiserName: row ? String(row.organiser_name ?? "") : "",
    donorName: row ? String(row.full_name ?? "") : "",
    email: row && row.email != null ? String(row.email) : null,
    alreadySent: row ? Boolean(row.already_sent) : false,
    // A gift no longer there reads as refunded, so it is skipped rather than sent.
    paymentStatus: row ? String(row.payment_status) : "missing",
    amountPence: row ? Number(row.amount_pence) : 0,
    refundedPence: row ? Number(row.refunded_amount_pence ?? 0) : 0,
    paidIn: row ? Boolean(row.paid_in_by_organiser) : false,
    fundraiserStatus: row ? String(row.fundraiser_status) : "missing",
    ...(row && row.in_memory === true ? { inMemory: true } : {}),
  };
}

/** What happened to one claimed gift's email. */
export async function finishThanksGift(id: number, outcome: "sent" | "skipped" | "failed", reason: SkipReason | null = null): Promise<void> {
  // (skip_reason's allowed values were widened by 1791200000120 for refunded, paid_in, not_running.)
  await pool.query(
    `UPDATE fundraiser_thank_gifts SET outcome = $2, skip_reason = $3, updated_at = now(),
            sent_at = CASE WHEN $2 = 'sent' THEN now() END
      WHERE id = $1 AND outcome = 'sending'`,
    [id, outcome, reason],
  );
}

/**
 * Once none of a thank you's gifts is still to send, mark it delivered and record its counts in the
 * audit log. Only the first caller does (delivered_at IS NULL), so the counts are recorded once.
 */
export async function markThanksDeliveredIfDone(thanksId: number): Promise<boolean> {
  return inTransaction(async (client) => {
    const done = await client.query(
      `UPDATE fundraiser_thanks t SET delivered_at = now()
        WHERE t.id = $1 AND t.status = 'approved' AND t.delivered_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM fundraiser_thank_gifts g WHERE g.thanks_id = t.id AND g.outcome IN ('waiting', 'queued', 'sending'))
        RETURNING t.fundraiser_id`,
      [thanksId],
    );
    const row = done.rows[0] as Row | undefined;
    if (!row) return false;
    const counts = (
      await client.query(
        `SELECT count(*) FILTER (WHERE outcome = 'sent') AS sent, count(*) FILTER (WHERE outcome = 'skipped') AS skipped,
                count(*) FILTER (WHERE outcome = 'failed') AS failed
           FROM fundraiser_thank_gifts WHERE thanks_id = $1`,
        [thanksId],
      )
    ).rows[0] as Row;
    await insertAudit(client, {
      actor: "system",
      action: "fundraiser.thanks_delivered",
      entity: "fundraiser",
      entityId: Number(row.fundraiser_id),
      data: { thanksId, sent: Number(counts?.sent ?? 0), skipped: Number(counts?.skipped ?? 0), failed: Number(counts?.failed ?? 0) },
    });
    return true;
  });
}

/**
 * A gift left "sending" for 15 minutes was claimed by a sender that stopped part way (a restart). Its
 * email may or may not have gone, so it is marked failed rather than sent again. Returns the thank
 * yous it touched, so each can be marked delivered.
 */
export async function failStaleSending(): Promise<number[]> {
  const r = await pool.query(
    `UPDATE fundraiser_thank_gifts SET outcome = 'failed', updated_at = now()
      WHERE outcome = 'sending' AND updated_at < now() - interval '15 minutes'
      RETURNING thanks_id`,
  );
  return [...new Set(r.rows.map((row) => Number(row.thanks_id)))];
}

/**
 * Approved thank yous never marked delivered though none of their gifts is still to send: the mark
 * failed after the last email, or every gift went with its donation before staff approved it.
 */
export async function undeliveredDoneThanks(): Promise<number[]> {
  const r = await pool.query(
    `SELECT t.id FROM fundraiser_thanks t
      WHERE t.status = 'approved' AND t.delivered_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM fundraiser_thank_gifts g WHERE g.thanks_id = t.id AND g.outcome IN ('waiting', 'queued', 'sending'))
      ORDER BY t.id`,
  );
  return r.rows.map((row) => Number(row.id));
}

/**
 * Whether there is sending to pick up again: a gift queued, one left "sending" by a restart, or an
 * approved thank you never marked delivered.
 */
export async function hasQueuedThanks(): Promise<boolean> {
  const r = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM fundraiser_thank_gifts
                     WHERE outcome = 'queued' OR (outcome = 'sending' AND updated_at < now() - interval '15 minutes'))
         OR EXISTS (SELECT 1 FROM fundraiser_thanks WHERE status = 'approved' AND delivered_at IS NULL) AS queued`,
  );
  return Boolean(r.rows[0]?.queued);
}
