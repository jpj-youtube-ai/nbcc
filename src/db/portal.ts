import { randomUUID } from "node:crypto";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import {
  issuePortalToken,
  verifyPortalToken,
  PortalTokenError,
  type PortalTokenRecord,
} from "../portal/tokens";

// The transactional, audited donor-portal magic-link writes (REQ-061). Issuing a token persists a
// one-time, expiring grant; consuming it verifies + marks it used. Mirrors the audited BEGIN…COMMIT /
// lock / typed-error transaction shape of reviseDeclaration in src/db/declarations.ts. The pure token
// rules (expiry, one-time use, link URL) live in src/portal/tokens.ts; the send in src/clients/email.ts.

export { PortalTokenError };

export interface IssuePortalTokenResult {
  token: string;
  donorId: number;
  expiresAt: Date;
}

// Issue a new magic-link token for a donor: generate a random token, build the record
// (issuePortalToken → expiry = now + ttl), INSERT it, and append a `portal.token_issued` audit row
// in ONE transaction. Returns the token + its expiry so the caller can build + send the link. Any
// throw rolls back both writes.
export async function issuePortalAccessToken(
  donorId: number,
  options: { ttlMs?: number; actor?: string } = {},
): Promise<IssuePortalTokenResult> {
  const actor = options.actor ?? "system";
  const record = issuePortalToken({ token: randomUUID(), donorId, now: new Date(), ttlMs: options.ttlMs });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO portal_access_tokens (donor_id, token, expires_at) VALUES ($1, $2, $3)`,
      [record.donor_id, record.token, record.expires_at],
    );
    await insertAudit(client, {
      actor,
      action: "portal.token_issued",
      entity: "donor",
      entityId: donorId,
      data: { expiresAt: record.expires_at.toISOString() },
    });
    await client.query("COMMIT");
    return { token: record.token, donorId, expiresAt: record.expires_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Consume a magic-link token: lock its row (FOR UPDATE, so a double-click races safely), verify it
// (verifyPortalToken — throws PortalTokenError for an unknown / expired / already-used token), mark
// used_at, and append a `portal.token_used` audit row — all in ONE transaction. Returns the donor id
// the token grants. The used_at stamp is the one-time-use enforcement: a replay finds used_at set and
// verifyPortalToken throws 'already_used'. Any throw rolls back.
export async function consumePortalToken(
  token: string,
  actor = "donor",
): Promise<{ donorId: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (
      await client.query<PortalTokenRecord>(
        `SELECT token, donor_id, expires_at, used_at
           FROM portal_access_tokens
          WHERE token = $1 FOR UPDATE`,
        [token],
      )
    ).rows[0];
    const { donorId } = verifyPortalToken(row, new Date()); // throws PortalTokenError if invalid
    await client.query(`UPDATE portal_access_tokens SET used_at = now() WHERE token = $1`, [token]);
    await insertAudit(client, {
      actor,
      action: "portal.token_used",
      entity: "donor",
      entityId: donorId,
      data: { token },
    });
    await client.query("COMMIT");
    return { donorId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
