import { pool } from "./pool";
import { LINK_DAYS, RESEND_MINUTES } from "../mailing-list/model";

// Joining the mailing list from the /newsletter page: the requests waiting to be confirmed by email
// (newsletter_signup_requests). Nobody here is on the mailing list; that is list_subscribers, which
// this file never touches. The row is the minimum: the address, the first name, a hash of the link
// and when it was sent and expires.

const DAY_MS = 86_400_000;

/**
 * Keep a request and its link's hash. One waiting request for an address: asking again replaces the
 * link (the earlier email's link then no longer works), but only when the last one was sent more
 * than ten minutes ago. True when it was stored, so the email should go; false when it is too soon.
 */
export async function saveSignupRequest(r: { email: string; firstName: string; tokenHash: string }, now: Date): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO newsletter_signup_requests (email, first_name, token_hash, sent_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE
        SET first_name = EXCLUDED.first_name, token_hash = EXCLUDED.token_hash,
            sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at
      WHERE newsletter_signup_requests.sent_at <= $6`,
    [
      r.email.trim().toLowerCase(),
      r.firstName,
      r.tokenHash,
      now,
      new Date(now.getTime() + LINK_DAYS * DAY_MS),
      new Date(now.getTime() - RESEND_MINUTES * 60_000),
    ],
  );
  return (rowCount ?? 0) > 0;
}

/** The request a link belongs to, while the link still works. */
export async function findSignupRequest(tokenHash: string, now: Date): Promise<{ email: string; firstName: string } | null> {
  const { rows } = await pool.query(
    `SELECT email, first_name FROM newsletter_signup_requests WHERE token_hash = $1 AND expires_at > $2`,
    [tokenHash, now],
  );
  return rows[0] ? { email: rows[0].email, firstName: rows[0].first_name } : null;
}

/** Forget a request: its link has been used, or its email could not be sent. */
export async function deleteSignupRequest(tokenHash: string): Promise<void> {
  await pool.query(`DELETE FROM newsletter_signup_requests WHERE token_hash = $1`, [tokenHash]);
}

/** The daily tidy up: requests nobody confirmed go once their link has expired (7 days). */
export async function purgeSignupRequests(now: Date): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM newsletter_signup_requests WHERE expires_at <= $1`, [now]);
  return rowCount ?? 0;
}
