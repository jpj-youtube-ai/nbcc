import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { findActiveDeclarationIdForDonor, DeclarationCancellationError } from "./declarations";
import { buildDeclarationCancellation } from "../declarations/cancellation";
import { computeRetentionExpiry } from "../declarations/retention";
import type { Scope } from "../declarations/wording";

// Read access to admin/staff `users` (TASK-105/REQ-062). Read-only (pool.query, no transaction —
// mirrors getDonorPortalSnapshot in src/db/portal.ts). The login endpoint looks a user up by email
// and verifies the password against password_hash (src/admin/password.ts); the RBAC-gated admin
// writes below (TASK-106) let an Editor/Admin act on a donor's behalf, each appending its audit_log
// row in the SAME transaction as the state change (writeWithAudit — the truth model).

export interface AdminUserRow {
  id: number;
  email: string;
  full_name: string;
  role: string; // viewer | editor | admin
  password_hash: string | null; // scrypt hash; NULL for an account with no password set
}

// Look up a user by email, or null when none matches. Returns the password_hash so the caller can
// verify it — this row never leaves the server unredacted.
export async function findUserByEmail(email: string): Promise<AdminUserRow | null> {
  const row = (
    await pool.query<AdminUserRow>(
      `SELECT id, email, full_name, role, password_hash FROM users WHERE email = $1`,
      [email],
    )
  ).rows[0];
  return row ?? null;
}

// Revoke a donor's active Gift Aid declaration on an admin's behalf (REQ-062 · TASK-106). Mirrors
// cancelDeclaration but is issued by an admin: it finds the donor's active declaration and, in ONE
// audited transaction (writeWithAudit), locks the row (FOR UPDATE), rejects an already-revoked one
// (DeclarationCancellationError), sets revoked_at and appends the `declaration.revoked` audit row
// (built by the pure buildDeclarationCancellation, with the admin as actor). NO new declaration row
// is inserted — a cancellation has no replacement. Returns { cancelled: false } when the donor has
// no active declaration, so the route can 404.
export async function adminCancelGiftAid(
  donorId: number,
  actor: string,
): Promise<{ cancelled: boolean; declarationId?: number }> {
  const declarationId = await findActiveDeclarationIdForDonor(donorId);
  if (declarationId == null) return { cancelled: false };

  await writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number; donor_id: number; revoked_at: Date | null }>(
          `SELECT id, donor_id, revoked_at FROM declarations WHERE id = $1 FOR UPDATE`,
          [declarationId],
        )
      ).rows[0];
      if (!row) throw new DeclarationCancellationError("not_found", declarationId);
      if (row.revoked_at != null) throw new DeclarationCancellationError("already_revoked", declarationId);

      const cancellation = buildDeclarationCancellation({
        current: { id: row.id, donor_id: row.donor_id },
        now: new Date(),
        actor,
      });
      await client.query(`UPDATE declarations SET revoked_at = $1 WHERE id = $2`, [
        cancellation.revokedDeclaration.revoked_at,
        declarationId,
      ]);
      return cancellation;
    },
    (cancellation) => cancellation.audit,
  );
  return { cancelled: true, declarationId };
}

// Record that an admin cancelled a donor's monthly subscription (REQ-062 · TASK-106). The
// subscription state itself lives in Stripe (cancelSubscription); this appends the admin-action
// audit_log row via writeWithAudit so who-did-what is durably recorded in the same truth model as
// every other write.
export async function recordAdminSubscriptionCancellation(
  donorId: number,
  subscriptionId: string,
  actor: string,
): Promise<void> {
  await writeWithAudit(
    async () => ({ donorId, subscriptionId }),
    (r) => ({
      actor,
      action: "admin.subscription_cancelled",
      entity: "donor",
      entityId: r.donorId,
      data: { subscriptionId: r.subscriptionId },
    }),
  );
}

// --- Admin claim operations (REQ-062/REQ-052/REQ-063 · TASK-109) --------------------------------

// A claim-batch submission that cannot proceed: the batch id is unknown, or it is not open (already
// submitted, or in the adjustment_due state). A typed error like DeclarationCancellationError so a
// route can branch on it (not_found → 404, not_open → 409).
export class ClaimBatchSubmitError extends Error {
  constructor(
    public readonly reason: "not_found" | "not_open",
    public readonly batchId: number,
  ) {
    super(`claim batch ${batchId} cannot be submitted: ${reason}`);
    this.name = "ClaimBatchSubmitError";
  }
}

// Mark a claim batch submitted (REQ-052/REQ-062). In ONE audited transaction (writeWithAudit,
// mirroring assignDonationToBatch): lock the batch row (FOR UPDATE), reject an unknown id
// (not_found) or a batch that is not 'open' (not_open — already submitted, or adjustment_due), set
// status='submitted' + submitted_at=now(), and append a single `claim_batch.submitted` audit row.
// Any throw rolls back BOTH the state change and the audit row. The Charities Online export that
// produces the batch's file is src/claims/charities-online.ts; this only flips its status.
export async function submitClaimBatch(
  batchId: number,
  actor: string,
): Promise<{ batchId: number }> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number; status: string }>(
          `SELECT id, status FROM claim_batches WHERE id = $1 FOR UPDATE`,
          [batchId],
        )
      ).rows[0];
      if (!row) throw new ClaimBatchSubmitError("not_found", batchId);
      if (row.status !== "open") throw new ClaimBatchSubmitError("not_open", batchId);

      await client.query(
        `UPDATE claim_batches SET status = 'submitted', submitted_at = now() WHERE id = $1`,
        [batchId],
      );
      return { batchId };
    },
    (r) => ({
      actor,
      action: "claim_batch.submitted",
      entity: "claim_batch",
      entityId: r.batchId,
      data: {},
    }),
  );
}

export interface AdjustmentDueRow {
  id: number;
  donor_id: number;
  donor_name: string;
  donor_email: string | null;
  amount_pence: number;
  refunded_amount_pence: number;
  claim_status: string;
  claim_batch_id: number | null;
  adjustment_pence: number | null;
  adjustment_reason: string | null;
  created_at: Date;
}

// List donations owing an HMRC adjustment (claim_status='adjustment_due', REQ-063) for the admin
// adjustment queue. Read-only (pool.query, no transaction — mirrors listClaimableDonationsForExport).
// Joins the donor for name/email and LEFT JOINs the claim_adjustments row (the owed amount + reason).
export async function listAdjustmentDueDonations(): Promise<AdjustmentDueRow[]> {
  const res = await pool.query<AdjustmentDueRow>(
    `SELECT d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.amount_pence, d.refunded_amount_pence, d.claim_status, d.claim_batch_id, d.created_at,
            ca.adjustment_pence, ca.reason AS adjustment_reason
       FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN claim_adjustments ca ON ca.donation_id = d.id
      WHERE d.claim_status = 'adjustment_due'
      ORDER BY d.id DESC`,
  );
  return res.rows;
}

// --- Admin retention + awaiting-declaration queues (REQ-046/REQ-049/REQ-057 · TASK-110) ---------

// How far ahead of `now` a declaration counts as "expiring" (versus already "expired"). A six-month
// horizon gives staff notice before HMRC's six-year retention window closes.
const RETENTION_EXPIRING_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export interface RetentionExpiryRow {
  id: number;
  donor_id: number;
  first_name: string;
  last_name: string;
  scope: string;
  retentionExpiry: string; // ISO date the six-year window closes
  flag: "expired" | "expiring";
}

// List declarations whose retention window has closed ("expired") or closes within the horizon
// ("expiring"), per the pure computeRetentionExpiry calculator (REQ-046 — six years after the final
// claimed charge, indefinite while an enduring declaration is still live). Read-only (pool.query, no
// transaction). `now` is injectable so the classification is deterministic under test. Maps each
// declaration's inputs from the row: cancelledAt = revoked_at (a revoked declaration is inactive), so
// subscriptionActive = (revoked_at IS NULL); the anchor is the most recent claimed donation's date.
// Only declarations that HAVE a claimed donation are read (without one the calculator returns null).
export async function listRetentionExpiryDeclarations(
  now: Date = new Date(),
): Promise<RetentionExpiryRow[]> {
  const res = await pool.query<{
    id: number;
    donor_id: number;
    first_name: string;
    last_name: string;
    scope: Scope;
    revoked_at: Date | null;
    last_claimed_at: Date | null;
  }>(
    `SELECT dec.id, dec.donor_id, dec.first_name, dec.last_name, dec.scope, dec.revoked_at,
            (SELECT MAX(dn.created_at) FROM donations dn
               WHERE dn.declaration_id = dec.id
                 AND dn.claim_status IN ('claimed','adjustment_due')) AS last_claimed_at
       FROM declarations dec
      WHERE EXISTS (SELECT 1 FROM donations dn
                     WHERE dn.declaration_id = dec.id
                       AND dn.claim_status IN ('claimed','adjustment_due'))
      ORDER BY dec.id ASC`,
  );

  const rows: RetentionExpiryRow[] = [];
  for (const r of res.rows) {
    const expiry = computeRetentionExpiry({
      scope: r.scope,
      subscriptionActive: r.revoked_at == null,
      lastClaimedDonationAt: r.last_claimed_at,
      cancelledAt: r.revoked_at,
    });
    if (expiry == null) continue; // retained indefinitely / no anchor — not a queue item
    const flag =
      expiry.getTime() <= now.getTime()
        ? "expired"
        : expiry.getTime() <= now.getTime() + RETENTION_EXPIRING_WINDOW_MS
          ? "expiring"
          : null;
    if (!flag) continue; // closes beyond the horizon — not yet a queue item
    rows.push({
      id: r.id,
      donor_id: r.donor_id,
      first_name: r.first_name,
      last_name: r.last_name,
      scope: r.scope,
      retentionExpiry: expiry.toISOString(),
      flag,
    });
  }
  return rows;
}

export interface AwaitingDeclarationRow {
  id: number;
  donor_id: number;
  donor_name: string;
  donor_email: string | null;
  declaration_status: string;
  declaration_token: string | null;
  amount_pence: number;
  created_at: Date;
}

// List donations whose in-person/postal Gift Aid confirmation was sent but not completed (REQ-049/
// REQ-057): declaration_status 'sent' (link/letter dispatched) or 'undelivered' (it bounced) — so
// bounced emails are included. Read-only (pool.query, no transaction). Joins the donor for the
// name/email an admin needs to follow up, and carries the declaration_token addressing the link.
export async function listAwaitingDeclarationDonations(): Promise<AwaitingDeclarationRow[]> {
  const res = await pool.query<AwaitingDeclarationRow>(
    `SELECT d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.declaration_status, d.declaration_token, d.amount_pence, d.created_at
       FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
      WHERE d.declaration_status IN ('sent','undelivered')
      ORDER BY d.id DESC`,
  );
  return res.rows;
}

// The value written over a redacted text field (personal-data fields that are NOT NULL cannot be set
// to NULL, so they are overwritten with this sentinel; nullable ones are set to NULL).
const REDACTED = "Redacted";

export interface AnonymizeResult {
  anonymized: boolean;
  declarationId: number;
  donorId?: number;
}

// Anonymise a donor's captured personal data once a declaration's HMRC retention window has CLOSED
// (REQ-064). It reuses the pure computeRetentionExpiry calculator VERBATIM (src/declarations/
// retention.ts — six years after the final claimed charge, indefinite while an enduring declaration
// is live) to classify the declaration; ONLY an 'expired' declaration (expiry ≤ now) is touched — an
// 'expiring' or indefinitely-retained one is left completely untouched (no write, no audit row).
//
// For an expired declaration it, in ONE audited transaction (writeWithAudit — the truth model,
// mirroring updateDonorPortal / cancelDeclaration): nulls/redacts the donor's name + contact fields
// and the declaration's captured personal fields (name, address, postcode), and appends EXACTLY ONE
// `donor.personal_data_anonymized` audit row. Any throw rolls back BOTH. `now` is injectable so the
// classification is deterministic under test. The immutable declaration row keeps its
// wording_version/snapshot + scope (the audit-relevant shape); only the personal identifiers go.
export async function anonymizeDonorPersonalData(
  declarationId: number,
  options: { now?: Date; actor?: string } = {},
): Promise<AnonymizeResult> {
  const now = options.now ?? new Date();
  const actor = options.actor ?? "system";

  // Read the declaration's retention inputs (same shape listRetentionExpiryDeclarations derives).
  const row = (
    await pool.query<{
      id: number;
      donor_id: number;
      scope: Scope;
      revoked_at: Date | null;
      last_claimed_at: Date | null;
    }>(
      `SELECT dec.id, dec.donor_id, dec.scope, dec.revoked_at,
              (SELECT MAX(dn.created_at) FROM donations dn
                 WHERE dn.declaration_id = dec.id
                   AND dn.claim_status IN ('claimed','adjustment_due')) AS last_claimed_at
         FROM declarations dec
        WHERE dec.id = $1`,
      [declarationId],
    )
  ).rows[0];
  if (!row) return { anonymized: false, declarationId };

  const expiry = computeRetentionExpiry({
    scope: row.scope,
    subscriptionActive: row.revoked_at == null,
    lastClaimedDonationAt: row.last_claimed_at,
    cancelledAt: row.revoked_at,
  });
  // Untouched unless the retention window has actually closed. null (retained indefinitely / no
  // anchor) or a future expiry (still 'expiring') → no write, no audit row.
  if (expiry == null || expiry.getTime() > now.getTime()) {
    return { anonymized: false, declarationId, donorId: row.donor_id };
  }

  const donorId = row.donor_id;
  await writeWithAudit(
    async (client) => {
      // Donor identity: redact the NOT NULL name, null the nullable contact/business fields.
      await client.query(
        `UPDATE donors
            SET full_name = $1, email = NULL, business_name = NULL, company_number = NULL
          WHERE id = $2`,
        [REDACTED, donorId],
      );
      // Declaration captured personal fields: redact the NOT NULL name/address/house fields, null the
      // nullable title + postcode. wording_version/snapshot + scope stay (not personal data).
      await client.query(
        `UPDATE declarations
            SET title = NULL, first_name = $1, last_name = $1, house_name_number = $1,
                address = $1, postcode = NULL
          WHERE id = $2`,
        [REDACTED, declarationId],
      );
      return { donorId, declarationId };
    },
    (r) => ({
      actor,
      action: "donor.personal_data_anonymized",
      entity: "donor",
      entityId: r.donorId,
      data: { declarationId: r.declarationId, retentionExpiry: expiry.toISOString() },
    }),
  );
  return { anonymized: true, declarationId, donorId };
}

// --- Admin search (REQ-062 · TASK-108) ----------------------------------------------------------
// Read-only lookups an admin (Viewer and up) runs to find a donor, declaration or donation by a free
// query — a name, email, id or postcode. Each matches the query case-insensitively (ILIKE) across the
// relevant text columns, and additionally by numeric id when the query is all digits. Read-only
// (pool.query, no transaction — mirrors getDonorPortalSnapshot / listClaimableDonationsForExport).
// Results are capped (LIMIT) so an over-broad query can never return an unbounded set.

const SEARCH_LIMIT = 50;

// The query as an ILIKE pattern, plus its numeric value (or null) so an all-digits query also matches
// an id. Trims the input; a blank query is the route's concern (400 before we get here).
function searchArgs(q: string): [string, number | null] {
  const trimmed = q.trim();
  const numeric = /^\d+$/.test(trimmed) ? Number(trimmed) : null;
  return [`%${trimmed}%`, numeric];
}

export interface DonorSearchRow {
  id: number;
  donor_type: string;
  full_name: string;
  business_name: string | null;
  email: string | null;
  anonymous: boolean;
}

// Find donors by name, business name, email, or id.
export async function searchDonors(q: string): Promise<DonorSearchRow[]> {
  const [pattern, numeric] = searchArgs(q);
  const res = await pool.query<DonorSearchRow>(
    `SELECT id, donor_type, full_name, business_name, email, anonymous
       FROM donors
      WHERE full_name ILIKE $1 OR business_name ILIKE $1 OR email ILIKE $1
         OR ($2::int IS NOT NULL AND id = $2::int)
      ORDER BY id DESC
      LIMIT ${SEARCH_LIMIT}`,
    [pattern, numeric],
  );
  return res.rows;
}

export interface DeclarationSearchRow {
  id: number;
  donor_id: number;
  first_name: string;
  last_name: string;
  postcode: string | null;
  scope: string;
  revoked_at: Date | null;
  created_at: Date;
}

// Find declarations by donor name, postcode, declaration id or donor id.
export async function searchDeclarations(q: string): Promise<DeclarationSearchRow[]> {
  const [pattern, numeric] = searchArgs(q);
  const res = await pool.query<DeclarationSearchRow>(
    `SELECT id, donor_id, first_name, last_name, postcode, scope, revoked_at, created_at
       FROM declarations
      WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR postcode ILIKE $1
         OR ($2::int IS NOT NULL AND (id = $2::int OR donor_id = $2::int))
      ORDER BY id DESC
      LIMIT ${SEARCH_LIMIT}`,
    [pattern, numeric],
  );
  return res.rows;
}

export interface DonationSearchRow {
  id: number;
  donor_id: number;
  donor_name: string;
  donor_email: string | null;
  mode: string;
  plan: string | null;
  amount_pence: number;
  currency: string;
  gift_aid: boolean;
  claim_status: string;
  payment_channel: string;
  created_at: Date;
}

// Find donations by donor name/email, Stripe id, donation id or donor id (joins the donor for the
// name/email match — donations carry no name/email of their own).
export async function searchDonations(q: string): Promise<DonationSearchRow[]> {
  const [pattern, numeric] = searchArgs(q);
  const res = await pool.query<DonationSearchRow>(
    `SELECT d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.mode, d.plan, d.amount_pence, d.currency, d.gift_aid, d.claim_status,
            d.payment_channel, d.created_at
       FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
      WHERE dn.full_name ILIKE $1 OR dn.email ILIKE $1
         OR d.stripe_session_id ILIKE $1 OR d.stripe_payment_intent_id ILIKE $1
         OR d.stripe_subscription_id ILIKE $1
         OR ($2::int IS NOT NULL AND (d.id = $2::int OR d.donor_id = $2::int))
      ORDER BY d.id DESC
      LIMIT ${SEARCH_LIMIT}`,
    [pattern, numeric],
  );
  return res.rows;
}

// --- Admin dashboard read lists (REQ-066 · TASK-114) --------------------------------------------
// Read-only, paginated/list reads that back the admin cockpit UI: browse all donations, list claim
// batches, read the append-only audit trail, and list subscription dunning state. Each is a plain
// pool.query (no transaction/audit — a read), bounded so an over-broad request can never return an
// unbounded set. Mirrors searchDonors / listAdjustmentDueDonations above.

const LIST_LIMIT_MAX = 100;
const LIST_LIMIT_DEFAULT = 50;

// Clamp a caller-supplied limit/offset to a safe, bounded window. Pure — unit-tested DB-free.
export function clampPage(limit?: number, offset?: number): { limit: number; offset: number } {
  const l =
    typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, LIST_LIMIT_MAX)
      : LIST_LIMIT_DEFAULT;
  const o = typeof offset === "number" && Number.isInteger(offset) && offset > 0 ? offset : 0;
  return { limit: l, offset: o };
}

export interface AdminDonationRow {
  id: number;
  donor_id: number;
  donor_name: string;
  donor_email: string | null;
  mode: string;
  plan: string | null;
  amount_pence: number;
  currency: string;
  gift_aid: boolean;
  claim_status: string;
  payment_channel: string;
  refunded_amount_pence: number;
  declaration_status: string | null;
  created_at: Date;
}

// Browse ALL donations, newest first, optionally filtered by claim_status and/or payment_channel,
// with a bounded page window. Returns the page plus the total matching count (for pagination).
export async function listDonations(opts: {
  limit?: number;
  offset?: number;
  status?: string;
  channel?: string;
}): Promise<{ results: AdminDonationRow[]; total: number }> {
  const { limit, offset } = clampPage(opts.limit, opts.offset);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    where.push(`d.claim_status = $${params.length}`);
  }
  if (opts.channel) {
    params.push(opts.channel);
    where.push(`d.payment_channel = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRes = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM donations d ${whereSql}`,
    params,
  );
  const res = await pool.query<AdminDonationRow>(
    `SELECT d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.mode, d.plan, d.amount_pence, d.currency, d.gift_aid, d.claim_status,
            d.payment_channel, d.refunded_amount_pence, d.declaration_status, d.created_at
       FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
       ${whereSql}
      ORDER BY d.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { results: res.rows, total: totalRes.rows[0].count };
}

export interface ClaimBatchRow {
  id: number;
  status: string;
  submitted_at: Date | null;
  regulator: string;
  charity_number: string;
  hmrc_reference: string | null;
  created_at: Date;
  donation_count: number;
  total_pence: number;
}

// List every claim batch, newest first, with its donation count + summed amount (for the claims
// screen). LEFT JOIN so an empty batch still lists with a zero count.
export async function listClaimBatches(): Promise<ClaimBatchRow[]> {
  const res = await pool.query<ClaimBatchRow>(
    `SELECT b.id, b.status, b.submitted_at, b.regulator, b.charity_number, b.hmrc_reference,
            b.created_at,
            count(d.id)::int AS donation_count,
            COALESCE(sum(d.amount_pence), 0)::int AS total_pence
       FROM claim_batches b
       LEFT JOIN donations d ON d.claim_batch_id = b.id
      GROUP BY b.id
      ORDER BY b.id DESC`,
  );
  return res.rows;
}

export interface AdminAuditRow {
  id: number;
  actor: string;
  action: string;
  entity: string;
  entity_id: number | null;
  data: unknown;
  created_at: Date;
}

// Read the append-only audit trail, newest first, optionally scoped to an entity and/or entity id,
// with a bounded page. Returns the page plus the total matching count.
export async function listAuditLog(opts: {
  limit?: number;
  offset?: number;
  entity?: string;
  entityId?: number;
}): Promise<{ results: AdminAuditRow[]; total: number }> {
  const { limit, offset } = clampPage(opts.limit, opts.offset);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.entity) {
    params.push(opts.entity);
    where.push(`entity = $${params.length}`);
  }
  if (opts.entityId != null) {
    params.push(opts.entityId);
    where.push(`entity_id = $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRes = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_log ${whereSql}`,
    params,
  );
  const res = await pool.query<AdminAuditRow>(
    `SELECT id, actor, action, entity, entity_id, data, created_at
       FROM audit_log
       ${whereSql}
      ORDER BY id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { results: res.rows, total: totalRes.rows[0].count };
}

export interface DunningRow {
  id: number;
  donor_id: number;
  donor_name: string;
  donor_email: string | null;
  stripe_subscription_id: string;
  status: string;
  failed_attempts: number;
  lapsed_at: Date | null;
  updated_at: Date;
}

// List subscription dunning rows (at-risk / lapsed monthly gifts, REQ-057/065), most-recently
// updated first, optionally filtered by status ('active' | 'past_due' | 'lapsed'). Joins the donor.
export async function listDunning(status?: string): Promise<DunningRow[]> {
  const params: unknown[] = [];
  let whereSql = "";
  if (status) {
    params.push(status);
    whereSql = `WHERE sd.status = $1`;
  }
  const res = await pool.query<DunningRow>(
    `SELECT sd.id, sd.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            sd.stripe_subscription_id, sd.status, sd.failed_attempts, sd.lapsed_at, sd.updated_at
       FROM subscription_dunning sd
       JOIN donors dn ON dn.id = sd.donor_id
       ${whereSql}
      ORDER BY sd.updated_at DESC, sd.id DESC`,
    params,
  );
  return res.rows;
}
