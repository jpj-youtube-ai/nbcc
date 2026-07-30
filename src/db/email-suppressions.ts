import { pool } from "./pool";

// TASK-272: the suppression list — addresses we must stop emailing.
//
// A hard bounce or a spam complaint used to be recorded and then ignored: the recipient queries
// filtered on consent alone, so a dead mailbox and someone who pressed "report spam" were mailed on
// every subsequent send, forever. Repeatedly mailing those two groups is what gets a sending domain
// junked or blocked — and nbcc.scot also carries admin sign-in codes and donation receipts.
//
// Two rules this module exists to hold:
//   1. Suppression is checked at SEND time, from the same helper the recipient PREVIEW uses, so the
//      number an admin confirms is the number that gets mailed.
//   2. Lifting a suppression is a tombstone, not a delete (the house rule for unsubscribes too), so
//      "why did we stop, and who decided to start again?" stays answerable.

export type SuppressionReason = "bounced" | "complained" | "manual";

export interface Suppression {
  id: number;
  email: string;
  reason: SuppressionReason;
  detail: string | null;
  createdAt: string;
}

// Add an address to the suppression list. Idempotent: an address already actively suppressed keeps
// its ORIGINAL reason and date — the first thing that went wrong is the useful record, and a later
// bounce must not quietly rewrite a complaint. Returns true when this call created the suppression.
export async function suppressEmail(
  email: string,
  reason: SuppressionReason,
  detail?: string | null,
): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const { rowCount } = await pool.query(
    `INSERT INTO email_suppressions (email, reason, detail)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (
        SELECT 1 FROM email_suppressions WHERE lower(email) = $1 AND removed_at IS NULL
      )`,
    [address, reason, detail ?? null],
  );
  return (rowCount ?? 0) > 0;
}

// Lift a suppression (an admin judged it safe to email them again). Tombstoned, never deleted.
export async function unsuppressEmail(email: string, actor: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const { rowCount } = await pool.query(
    `UPDATE email_suppressions SET removed_at = now(), removed_by = $2
      WHERE lower(email) = $1 AND removed_at IS NULL`,
    [address, actor],
  );
  return (rowCount ?? 0) > 0;
}

export async function listSuppressions(limit = 500): Promise<Suppression[]> {
  const { rows } = await pool.query(
    `SELECT id, email, reason, detail, created_at
       FROM email_suppressions
      WHERE removed_at IS NULL
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    reason: r.reason,
    detail: r.detail,
    createdAt: r.created_at,
  }));
}

// THE load-bearing call: given the addresses a send resolved to, return the set that must not be
// mailed. One query however big the audience — the send path can't afford a per-recipient lookup.
export async function suppressedAmong(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await pool.query(
    `SELECT lower(email) AS email FROM email_suppressions
      WHERE removed_at IS NULL AND lower(email) = ANY($1)`,
    [emails.map((e) => e.trim().toLowerCase())],
  );
  return new Set(rows.map((r) => r.email as string));
}
