import { pool } from "./pool";

// TASK-501: storage for signing in to the fundraising private area. The rules (and the hashing) are
// in src/fundraising/sign-in.ts. Plain pool.query and no audit rows, like the admin's login codes
// (src/db/login-codes.ts): these are short lived sign in artifacts, not changes to a fundraiser.
// Never log a code, a code hash, a session id or a session hash.
//
// Emails are stored lower case, so "Sam@Example.com" and "sam@example.com" are one organiser.

const lower = (email: string) => email.trim().toLowerCase();

/** Store (or replace) the code for an email. A new code gets a full set of tries. */
export async function saveSignInCode(email: string, codeHash: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO fundraiser_sign_in_codes (email, code_hash, expires_at, attempts)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
    [lower(email), codeHash, expiresAt],
  );
}

/**
 * Count a try at the code for this email and read it back, in ONE statement: tries sent at the
 * same moment each get their own count, so none can slip in under the limit. Null when there is no
 * code for the email.
 */
export async function countCodeTry(email: string): Promise<{ codeHash: string; expiresAt: Date; attempts: number } | null> {
  const r = await pool.query<{ code_hash: string; expires_at: Date | string; attempts: number }>(
    `UPDATE fundraiser_sign_in_codes SET attempts = attempts + 1 WHERE email = $1 RETURNING code_hash, expires_at, attempts`,
    [lower(email)],
  );
  const row = r.rows[0];
  return row ? { codeHash: row.code_hash, expiresAt: new Date(row.expires_at), attempts: Number(row.attempts) } : null;
}

/** Forget the code: after it is used, and once it is dead. */
export async function deleteSignInCode(email: string): Promise<void> {
  await pool.query(`DELETE FROM fundraiser_sign_in_codes WHERE email = $1`, [lower(email)]);
}

/** Start a session. Sessions and codes long past their time are tidied away on the way. */
export async function createSession(sessionHash: string, email: string, expiresAt: Date): Promise<void> {
  await pool.query(`DELETE FROM fundraiser_sessions WHERE expires_at < now() - interval '1 day'`);
  await pool.query(`DELETE FROM fundraiser_sign_in_codes WHERE expires_at < now() - interval '1 day'`);
  await pool.query(`INSERT INTO fundraiser_sessions (session_hash, email, expires_at) VALUES ($1, $2, $3)`, [
    sessionHash,
    lower(email),
    expiresAt,
  ]);
}

/** The signed in email for a session, only while it has time left. */
export async function findSession(sessionHash: string): Promise<{ email: string; expiresAt: Date } | null> {
  const r = await pool.query<{ email: string; expires_at: Date | string }>(
    `SELECT email, expires_at FROM fundraiser_sessions WHERE session_hash = $1 AND expires_at > now()`,
    [sessionHash],
  );
  const row = r.rows[0];
  return row ? { email: row.email, expiresAt: new Date(row.expires_at) } : null;
}

export async function deleteSession(sessionHash: string): Promise<void> {
  await pool.query(`DELETE FROM fundraiser_sessions WHERE session_hash = $1`, [sessionHash]);
}
