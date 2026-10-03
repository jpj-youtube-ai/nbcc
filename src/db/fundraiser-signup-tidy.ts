import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import { FUNDRAISER_SELECT, FundraiserError, toRecord } from "./fundraisers";
import type { FundraiserRecord, SignUp } from "../fundraising/model";
import { tshirtLinkLive, type WelcomePackChange } from "../fundraising/signup-tidy";

// The sign up tidy (Jaimie, 2026-10-03), the SQL side (migrations/1791200000210_signup-tidy.js):
//
//   - a sign up's new answers, saved in the sign up's own transaction (saveSignUpExtras, called by
//     createFundraiser), and a page they asked to keep off Get involved, taken off the list as staff
//     would (off_list_at, off_list_by 'organiser');
//   - staff correcting "Sporting event?" and the T shirt size before approving (setWelcomePack);
//   - the private link staff may email to ask for a size: only its sha256 is kept (saveTshirtLink),
//     it works for 60 days, and once (chooseTshirtSize).
//
// Every change writes its audit_log row in the same transaction. The token itself never reaches the
// database, a log or audit_log.

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** The sign up's new answers. Called inside createFundraiser's transaction, after the insert. */
export async function saveSignUpExtras(client: PoolClient, id: number, s: SignUp): Promise<void> {
  await client.query(
    `UPDATE fundraisers SET is_sporting = $1, tshirt_size = $2, child_first_name = $3, child_consent = $4, org_name = $5,
            employer_match = $6, memory_director_business = $7, memory_family_contact_name = $8,
            memory_family_contact_email = $9, call_time = $10,
            off_list_at = CASE WHEN $11 THEN now() ELSE off_list_at END,
            off_list_by = CASE WHEN $11 THEN 'organiser' ELSE off_list_by END
      WHERE id = $12`,
    [
      s.isSporting,
      s.tshirtSize,
      s.childFirstName,
      s.childConsent,
      s.orgName,
      s.employerMatch,
      s.memoryDirectorBusiness,
      s.memoryFamilyContactName,
      s.memoryFamilyContactEmail,
      s.callTime,
      s.listed === false,
      id,
    ],
  );
}

async function lock(client: PoolClient, id: number): Promise<FundraiserRecord> {
  const found = await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1 FOR UPDATE`, [id]);
  if (!found.rows[0]) throw new FundraiserError("not_found");
  return toRecord(found.rows[0]);
}

async function reread(client: PoolClient, id: number): Promise<FundraiserRecord> {
  return toRecord((await client.query(`${FUNDRAISER_SELECT} WHERE f.id = $1`, [id])).rows[0]);
}

/** Staff set "Sporting event?" and the T shirt size (a Yes may wait for one). */
export async function setWelcomePack(id: number, change: WelcomePackChange, actor: string): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const before = await lock(client, id);
    await client.query("UPDATE fundraisers SET is_sporting = $1, tshirt_size = $2, updated_at = now(), updated_by = $3 WHERE id = $4", [
      change.isSporting,
      change.tshirtSize,
      actor,
      id,
    ]);
    await insertAudit(client, {
      actor,
      action: "fundraiser.welcome_pack_changed",
      entity: "fundraiser",
      entityId: id,
      data: { ...change, was: { isSporting: before.isSporting ?? null, tshirtSize: before.tshirtSize ?? null } },
    });
    return reread(client, id);
  });
}

/**
 * Keep a new link's hash (any older link stops working), when it was sent and by whom. Only for a
 * sporting event still waiting for a size.
 */
export async function saveTshirtLink(id: number, tokenHash: string, actor: string): Promise<FundraiserRecord> {
  return inTransaction(async (client) => {
    const before = await lock(client, id);
    if (before.isSporting !== true) throw new FundraiserError("not_sporting");
    if (before.tshirtSize) throw new FundraiserError("has_size");
    await client.query("UPDATE fundraisers SET tshirt_token_hash = $1, tshirt_asked_at = now(), tshirt_asked_by = $2 WHERE id = $3", [
      tokenHash,
      actor,
      id,
    ]);
    await insertAudit(client, { actor, action: "fundraiser.tshirt_asked", entity: "fundraiser", entityId: id, data: { to: before.email } });
    return reread(client, id);
  });
}

/** The sign up a link is for, while it still waits for a size; null otherwise. */
export async function readTshirtLink(tokenHash: string): Promise<FundraiserRecord | null> {
  const r = await pool.query(
    `${FUNDRAISER_SELECT} WHERE f.tshirt_token_hash = $1 AND f.is_sporting IS TRUE AND f.tshirt_size IS NULL AND f.status <> 'declined'`,
    [tokenHash],
  );
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

/** Save the size chosen from a link, once. False when the link is not there, used, or too old. */
export async function chooseTshirtSize(tokenHash: string, size: string, now: Date): Promise<boolean> {
  return inTransaction(async (client) => {
    const found = await client.query(
      `${FUNDRAISER_SELECT} WHERE f.tshirt_token_hash = $1 AND f.is_sporting IS TRUE AND f.tshirt_size IS NULL AND f.status <> 'declined' FOR UPDATE`,
      [tokenHash],
    );
    if (!found.rows[0]) return false;
    const f = toRecord(found.rows[0]);
    if (!tshirtLinkLive(f.tshirtAskedAt ?? null, now)) return false;
    await client.query("UPDATE fundraisers SET tshirt_size = $1, tshirt_token_hash = NULL WHERE id = $2", [size, f.id]);
    await insertAudit(client, { actor: "organiser", action: "fundraiser.tshirt_chosen", entity: "fundraiser", entityId: f.id, data: { tshirtSize: size } });
    return true;
  });
}
