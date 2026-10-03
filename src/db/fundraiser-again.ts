import { pool } from "./pool";

// TASK-515: the SQL behind "Do it again" (src/fundraising/again.ts): the one use link in email 18
// that opens the sign up form filled in from last year's fundraiser. Only the token's hash is ever
// stored or looked up.

export async function createAgainToken(fundraiserId: number, tokenHash: string, expiresAt: Date): Promise<void> {
  await pool.query("INSERT INTO fundraiser_again_tokens (fundraiser_id, token_hash, expires_at) VALUES ($1, $2, $3)", [
    fundraiserId,
    tokenHash,
    expiresAt,
  ]);
}

export interface FoundAgain {
  fundraiserId: number;
  expiresAt: Date;
  usedAt: Date | null;
}

export async function findAgainByHash(tokenHash: string): Promise<FoundAgain | null> {
  const r = await pool.query("SELECT fundraiser_id, expires_at, used_at FROM fundraiser_again_tokens WHERE token_hash = $1", [tokenHash]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    fundraiserId: Number(row.fundraiser_id),
    expiresAt: new Date(row.expires_at as string),
    usedAt: row.used_at ? new Date(row.used_at as string) : null,
  };
}

/**
 * The sign up made from a Do it again link has arrived: mark the link used, once, and only while in
 * date, with a History row on last year's fundraiser, in one statement, so two sign ups at once
 * cannot both take it. The id of last year's fundraiser, or null when there was nothing to take.
 */
export async function markAgainUsed(tokenHash: string, newFundraiserId: number): Promise<number | null> {
  const r = await pool.query<{ entity_id: number }>(
    `WITH used AS (
       UPDATE fundraiser_again_tokens SET used_at = now(), used_by_fundraiser_id = $2
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING fundraiser_id
     )
     INSERT INTO audit_log (actor, action, entity, entity_id, data)
     SELECT 'public', 'fundraiser.again_used', 'fundraiser', fundraiser_id, jsonb_build_object('newFundraiserId', $2::integer) FROM used
     RETURNING entity_id`,
    [tokenHash, newFundraiserId],
  );
  return r.rows[0] ? Number(r.rows[0].entity_id) : null;
}
