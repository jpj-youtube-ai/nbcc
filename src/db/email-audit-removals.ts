import { pool } from "./pool";
import type { AuditRemovalKind } from "../email/audit-removals";

// TASK-562: the addresses staff have removed from the Email audit's red band. A removal hides
// nothing by being here: the band's own query decides, each time it is read (REMOVAL_HIDES,
// src/db/email-log.ts). This module only writes down what staff did, and undoes it.
//
// Single statements over the pool, as src/db/email-log.ts and src/db/email-suppressions.ts are.
// It never writes to email_log or email_suppressions.

// Staff removed this address from the band. `blocked` is true when this removal is what blocked
// the address (a "stop" on an address that was not blocked already), so that putting it back
// knows whether the block is its own to lift.
export async function recordAuditRemoval(
  email: string,
  kind: AuditRemovalKind,
  actor: string,
  blocked: boolean,
): Promise<void> {
  await pool.query(
    `INSERT INTO email_audit_removals (email, kind, blocked, removed_by)
     VALUES (lower($1), $2, $3, $4)`,
    [email, kind, blocked, actor],
  );
}

// Put an address back: every removal still in force for it is stamped, never deleted (the house
// rule for unsubscribes and blocks too). Says how many there were, and whether any of them was
// what blocked the address.
export async function putBackAuditRemovals(
  email: string,
  actor: string,
): Promise<{ putBack: number; blocked: boolean }> {
  const { rows } = await pool.query<{ blocked: boolean }>(
    `UPDATE email_audit_removals
        SET put_back_at = now(), put_back_by = $2
      WHERE email = lower($1) AND put_back_at IS NULL
  RETURNING blocked`,
    [email, actor],
  );
  return { putBack: rows.length, blocked: rows.some((r) => r.blocked) };
}

// Why an address is blocked now ('bounced', 'complained' or 'manual'), or null when it is not.
// Read here rather than added to src/db/email-suppressions.ts, which every newsletter send loads.
export async function blockedReason(email: string): Promise<string | null> {
  const { rows } = await pool.query<{ reason: string }>(
    `SELECT reason FROM email_suppressions WHERE lower(email) = lower($1) AND removed_at IS NULL`,
    [email],
  );
  return rows[0]?.reason ?? null;
}
