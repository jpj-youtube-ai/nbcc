import { pool } from "./pool";

// Admin management Phase 3 (TASK-188, mandatory email 2FA), Task 2: storage for the one-time
// email login code challenged at step 2 of admin login (admin_login_codes,
// migrations/1783785596017_admin-login-codes.js). Plain pool.query, no audit — these are
// transient auth artifacts (like a session token), not user-management writes; mirrors
// touchLastLogin in src/db/admin-users.ts, which is also unaudited. One row per user (the LATEST
// challenge only): upsertLoginCode INSERTs or, on a repeat login attempt, overwrites the prior
// code/expiry and resets attempts to 0 so a fresh code always gets a fresh attempt budget.
//
// code_hash is the KEYED hash (hashLoginCode from src/admin/two-factor.ts) — never the raw code —
// so a DB leak of this table can't be brute-forced offline without ADMIN_SESSION_SECRET. Never log
// code_hash or the raw code (see the plan's Global Constraints).

export interface LoginCodeRow {
  code_hash: string;
  expires_at: Date;
  attempts: number;
}

// Store (or replace) the pending login code for a user. ON CONFLICT (user_id) DO UPDATE so a
// second login attempt before the first code is verified/expired invalidates the old code
// outright (one active code per user) and resets attempts to 0 — a new code gets a full attempt
// budget rather than inheriting the previous challenge's count.
export async function upsertLoginCode(userId: number, codeHash: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO admin_login_codes (user_id, code_hash, expires_at, attempts)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0`,
    [userId, codeHash, expiresAt],
  );
}

// The user's pending login-code challenge, or null when they have none (never requested a code,
// or it was already deleted after use/lockout). The route layer checks expires_at + attempts.
export async function getLoginCode(userId: number): Promise<LoginCodeRow | null> {
  const row = (
    await pool.query<LoginCodeRow>(
      `SELECT code_hash, expires_at, attempts FROM admin_login_codes WHERE user_id = $1`,
      [userId],
    )
  ).rows[0];
  return row ?? null;
}

// Increment the wrong-guess counter and return the NEW count, so the route can compare it against
// the attempt cap without a separate read. Returns 0 (rather than throwing) when there is no row
// for the user — RETURNING yields nothing on a no-op UPDATE, so there is nothing to bump; the
// route treats "no code" as its own generic-401 case via getLoginCode, not via this count.
export async function bumpLoginCodeAttempts(userId: number): Promise<number> {
  const row = (
    await pool.query<{ attempts: number }>(
      `UPDATE admin_login_codes SET attempts = attempts + 1 WHERE user_id = $1 RETURNING attempts`,
      [userId],
    )
  ).rows[0];
  return row?.attempts ?? 0;
}

// Remove the user's pending code — called after a successful verification (one-time use) and
// after the attempt cap is exceeded (forces a fresh login-step-1 code request).
export async function deleteLoginCode(userId: number): Promise<void> {
  await pool.query(`DELETE FROM admin_login_codes WHERE user_id = $1`, [userId]);
}
