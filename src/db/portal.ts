import { randomUUID } from "node:crypto";
import { pool } from "./pool";
import { insertAudit, writeWithAudit } from "./donations";
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

// Authenticate a portal request by its magic-link token (REQ-061/TASK-101): reads the token row and
// verifies it (verifyPortalToken — throws PortalTokenError for a missing / expired / already-used
// token) WITHOUT marking it used, so it stays valid for repeated read/update requests within its
// life. The route maps PortalTokenError → 401. (Consuming a token, marking it used, is the separate
// consumePortalToken flow.)
export async function authenticatePortalToken(token: string): Promise<{ donorId: number }> {
  const row = (
    await pool.query<PortalTokenRecord>(
      `SELECT token, donor_id, expires_at, used_at FROM portal_access_tokens WHERE token = $1`,
      [token],
    )
  ).rows[0];
  return verifyPortalToken(row, new Date());
}

// The donor's self-serve portal view (REQ-061): their editable details plus read-only status — the
// current monthly subscription plan (the most recent subscription donation's plan, or null) and
// whether they Gift Aid (any gift_aid donation on file). Read-only (pool.query, no transaction —
// mirrors listClaimableDonationsForExport).
export interface DonorPortalSnapshot {
  donorId: number;
  fullName: string;
  email: string | null;
  emailConsent: boolean;
  anonymous: boolean;
  subscriptionPlan: string | null;
  // The Stripe subscription id of that most-recent monthly-gift donation, so the portal page can
  // drive the reduce-instead-then-cancel flow (REQ-055 · TASK-102); null when there is no monthly gift.
  subscriptionId: string | null;
  giftAid: boolean;
}

export async function getDonorPortalSnapshot(donorId: number): Promise<DonorPortalSnapshot | null> {
  const row = (
    await pool.query<{
      full_name: string;
      email: string | null;
      email_consent: boolean;
      anonymous: boolean;
      subscription_plan: string | null;
      subscription_id: string | null;
      gift_aid: boolean;
    }>(
      `SELECT dn.full_name, dn.email, dn.email_consent, dn.anonymous,
              (SELECT d.plan FROM donations d
                 WHERE d.donor_id = dn.id AND d.stripe_subscription_id IS NOT NULL
                 ORDER BY d.id DESC LIMIT 1) AS subscription_plan,
              (SELECT d.stripe_subscription_id FROM donations d
                 WHERE d.donor_id = dn.id AND d.stripe_subscription_id IS NOT NULL
                 ORDER BY d.id DESC LIMIT 1) AS subscription_id,
              EXISTS (SELECT 1 FROM donations d WHERE d.donor_id = dn.id AND d.gift_aid = true) AS gift_aid
         FROM donors dn
        WHERE dn.id = $1`,
      [donorId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    donorId,
    fullName: row.full_name,
    email: row.email,
    emailConsent: row.email_consent,
    anonymous: row.anonymous,
    subscriptionPlan: row.subscription_plan,
    subscriptionId: row.subscription_id,
    giftAid: row.gift_aid,
  };
}

// The editable portal fields (PATCH). All optional — a caller sends only what changed.
export interface DonorPortalUpdate {
  fullName?: string;
  email?: string | null;
  emailConsent?: boolean;
  anonymous?: boolean;
}

// Update the donor's editable details + append a `donor.updated` audit_log row in the SAME
// transaction (writeWithAudit — the truth model in CLAUDE.md), so the change and its audit commit or
// roll back together. Only the supplied columns are written. Returns the donor id.
export async function updateDonorPortal(
  donorId: number,
  updates: DonorPortalUpdate,
  actor = "donor",
): Promise<{ donorId: number; fields: string[] }> {
  const columns: Record<keyof DonorPortalUpdate, string> = {
    fullName: "full_name",
    email: "email",
    emailConsent: "email_consent",
    anonymous: "anonymous",
  };
  return writeWithAudit(
    async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const fields: string[] = [];
      (Object.keys(columns) as (keyof DonorPortalUpdate)[]).forEach((key) => {
        if (updates[key] !== undefined) {
          params.push(updates[key]);
          sets.push(`${columns[key]} = $${params.length}`);
          fields.push(key);
        }
      });
      if (sets.length > 0) {
        params.push(donorId);
        await client.query(`UPDATE donors SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
      }
      return { donorId, fields };
    },
    (r) => ({
      actor,
      action: "donor.updated",
      entity: "donor",
      entityId: r.donorId,
      data: { fields: r.fields },
    }),
  );
}

// Resolve the newest donor row for a stored email (REQ-061 revised). With email now mandatory
// and always stored, the self-request route reaches ANY donor — including one-off donors with no
// Stripe subscription — by their stored donors.email. Case-insensitive; newest row wins (that is
// the canonical row the token targets). Returns null when no donor has that email.
export async function findNewestDonorByEmail(
  email: string,
): Promise<{ donorId: number; fullName: string } | null> {
  const res = await pool.query<{ id: number; full_name: string }>(
    `SELECT id, full_name FROM donors WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1`,
    [email],
  );
  const row = res.rows[0];
  return row ? { donorId: row.id, fullName: row.full_name } : null;
}

// A donor's giving history for the portal dashboard (REQ-061 revised). Identity = email: a donor
// who gave N times is N donor rows sharing an email, so this aggregates every donation joined to a
// donor row with that email (case-insensitive), newest first, plus the count and gross total. Pure
// read (pool.query). An email with no donations yields an empty history (count 0, total 0).
export interface DonorDonationHistory {
  totalPence: number;
  count: number;
  donations: Array<{
    date: string;
    amountPence: number;
    mode: "once" | "monthly";
    giftAid: boolean;
    status: string;
  }>;
}

export async function getDonorDonationHistory(email: string): Promise<DonorDonationHistory> {
  const res = await pool.query<{
    created_at: Date;
    amount_pence: number;
    mode: string;
    gift_aid: boolean;
    payment_status: string;
  }>(
    `SELECT d.created_at, d.amount_pence, d.mode, d.gift_aid, d.payment_status
       FROM donations d JOIN donors dn ON dn.id = d.donor_id
      WHERE LOWER(dn.email) = LOWER($1)
      ORDER BY d.created_at DESC, d.id DESC`,
    [email],
  );
  const donations = res.rows.map((r) => ({
    date: r.created_at.toISOString(),
    amountPence: r.amount_pence,
    mode: r.mode === "monthly" ? ("monthly" as const) : ("once" as const),
    giftAid: r.gift_aid,
    status: r.payment_status,
  }));
  const totalPence = donations.reduce((sum, d) => sum + d.amountPence, 0);
  return { totalPence, count: donations.length, donations };
}
