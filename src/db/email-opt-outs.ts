import { pool } from "./pool";

// TASK-507: the address level opt out list (email_opt_outs). An address on it has asked us to stop:
// "Stop all emails" in the preference centre (kind "all") or thank yous turned off there (kind
// "thank_you"). A fundraiser's thank you (email 20) is never sent to it. By address, so it covers
// every donor row and list membership with that address. Lifting it (thank yous turned back on) is a
// tombstone, never a delete, as for the suppression list (src/db/email-suppressions.ts).

export type OptOutKind = "all" | "thank_you";
export type OptOutSource = "preferences" | "backfill";

/** Add an address. Idempotent: one already opted out keeps its first record. True when added now. */
export async function addOptOut(email: string, kind: OptOutKind, source: OptOutSource): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  const { rowCount } = await pool.query(
    `INSERT INTO email_opt_outs (email, kind, source)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (SELECT 1 FROM email_opt_outs WHERE email = $1 AND removed_at IS NULL)`,
    [address, kind, source],
  );
  return (rowCount ?? 0) > 0;
}

/** Lift it (they turned thank yous back on). Tombstoned, never deleted. True when one was lifted. */
export async function liftOptOut(email: string, by: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const { rowCount } = await pool.query(
    `UPDATE email_opt_outs SET removed_at = now(), removed_by = $2 WHERE email = $1 AND removed_at IS NULL`,
    [address, by],
  );
  return (rowCount ?? 0) > 0;
}

/** Which of these addresses are opted out, lower cased. One query, however many. */
export async function optedOutAmong(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await pool.query(`SELECT email FROM email_opt_outs WHERE removed_at IS NULL AND email = ANY($1)`, [
    emails.map((e) => e.trim().toLowerCase()),
  ]);
  return new Set(rows.map((r) => String(r.email)));
}
