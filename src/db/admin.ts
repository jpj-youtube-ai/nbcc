import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { findActiveDeclarationIdForDonor, DeclarationCancellationError } from "./declarations";
import { buildDeclarationCancellation } from "../declarations/cancellation";
import { computeRetentionExpiry } from "../declarations/retention";
import { gasdsClaimDeadline } from "../gasds/deadline";
import type { Scope } from "../declarations/wording";
import { DONATION_SOURCES } from "./stripe-webhook-model";
import { ELF_SOURCE } from "../admin/gift-sources";
import { ARRIVAL_CHANNELS } from "../donations/arrival";
import { givenOnLabel, paidByLabel } from "../donations/labels";

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
  status: string; // invited | active | disabled (admin management Phase 1, Task 6)
}

// Look up a user by email, or null when none matches. Returns the password_hash so the caller can
// verify it — this row never leaves the server unredacted. Also returns `status` (Task 6) so
// postAdminLogin can reject a disabled/invited account after the password check.
export async function findUserByEmail(email: string): Promise<AdminUserRow | null> {
  const row = (
    await pool.query<AdminUserRow>(
      `SELECT id, email, full_name, role, password_hash, status FROM users WHERE email = $1`,
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

// Create a new (open) claim batch (REQ-052/REQ-062). status/regulator/charity_number all default in
// the schema (open/OSCR/SC047995); hmrc_reference is optional (set later when the claim is prepared).
// Audited (claim_batch.created) in ONE transaction, mirroring submitClaimBatch.
export async function createClaimBatch(
  actor: string,
  hmrcReference?: string,
): Promise<{ batchId: number }> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number }>(
          `INSERT INTO claim_batches (hmrc_reference) VALUES ($1) RETURNING id`,
          [hmrcReference ?? null],
        )
      ).rows[0];
      return { batchId: row.id };
    },
    (r) => ({ actor, action: "claim_batch.created", entity: "claim_batch", entityId: r.batchId, data: {} }),
  );
}

export interface EligibleClaimRow {
  id: number;
  donor_name: string;
  amount_pence: number;
  postcode: string | null;
  created_at: Date;
}

// The eligible-unbatched donations (claim_status='eligible' ⇒ claim_batch_id IS NULL) with a
// declaration, shaped for the admin "ready to claim" picker. Read-only (pool.query, no transaction —
// mirrors listAdjustmentDueDonations). The INNER JOIN to declarations excludes any eligible row
// without one; ordered by id for a stable list.
export async function listEligibleForClaim(): Promise<EligibleClaimRow[]> {
  const res = await pool.query<EligibleClaimRow>(
    `SELECT d.id, dn.full_name AS donor_name, d.amount_pence, dec.postcode, d.created_at
       FROM donations d
       JOIN declarations dec ON dec.id = d.declaration_id
       JOIN donors dn ON dn.id = d.donor_id
      WHERE d.claim_status = 'eligible'
      ORDER BY d.id ASC`,
  );
  return res.rows;
}

export interface DonorAddress {
  houseNameNumber: string | null;
  address: string | null;
  postcode: string | null;
}

// The donor's current postal address for the admin donor view. An individual's address lives on
// their latest NON-REVOKED Gift Aid declaration (REQ-043); a company's on the donor's billing_*
// columns (REQ-053). Read-only (pool.query, no transaction). Returns nulls when there is no
// declaration / billing address on file. Kept out of getDonorPortalSnapshot so the donor-facing
// portal shape is unchanged; getAdminDonor merges this in.
export async function getDonorAddress(donorId: number): Promise<DonorAddress> {
  const row = (
    await pool.query<{
      donor_type: string;
      billing_address: string | null;
      billing_postcode: string | null;
      house_name_number: string | null;
      address: string | null;
      postcode: string | null;
    }>(
      `SELECT dn.donor_type, dn.billing_address, dn.billing_postcode,
              dec.house_name_number, dec.address, dec.postcode
         FROM donors dn
         LEFT JOIN LATERAL (
           SELECT house_name_number, address, postcode
             FROM declarations d
            WHERE d.donor_id = dn.id AND d.revoked_at IS NULL
            ORDER BY d.id DESC LIMIT 1
         ) dec ON true
        WHERE dn.id = $1`,
      [donorId],
    )
  ).rows[0];
  if (!row) return { houseNameNumber: null, address: null, postcode: null };
  if (row.donor_type === "company") {
    return { houseNameNumber: null, address: row.billing_address, postcode: row.billing_postcode };
  }
  return { houseNameNumber: row.house_name_number, address: row.address, postcode: row.postcode };
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

// How far ahead of `now` a GASDS gift counts as "expiring" (versus already "expired"). A six-month
// horizon gives staff notice before the GASDS 2-year claim cliff closes.
const GASDS_DEADLINE_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;

export interface GasdsDeadlineRow {
  id: number; // donation id
  donor_id: number;
  full_name: string;
  amountPence: number;
  collectedAt: string; // ISO date the small donation was collected
  gasdsDeadline: string; // ISO date the GASDS 2-year claim window closes
  flag: "expired" | "expiring";
}

// List GASDS-eligible small donations whose 2-year claim window has closed ("expired") or closes
// within the horizon ("expiring"), per the pure gasdsClaimDeadline calculator (TASK-135 — two years
// after the tax-year-end of collection). Read-only (pool.query). `now` is injectable so the
// classification is deterministic under test. Already-claimed gifts are excluded
// (gasds_claimed_at IS NULL), so the queue only surfaces small gifts still needing a GASDS claim
// before the cliff (TASK-138 — mark-claimed via markGasdsClaimed).
export async function listGasdsDeadlineDonations(now: Date = new Date()): Promise<GasdsDeadlineRow[]> {
  const res = await pool.query<{
    id: number;
    donor_id: number;
    full_name: string;
    amount_pence: number;
    created_at: Date;
  }>(
    `SELECT dn.id, dn.donor_id, d.full_name, dn.amount_pence, dn.created_at
       FROM donations dn JOIN donors d ON d.id = dn.donor_id
      WHERE dn.gasds_eligible = true AND dn.payment_status = 'paid' AND dn.gasds_claimed_at IS NULL
      ORDER BY dn.created_at ASC`,
  );

  const rows: GasdsDeadlineRow[] = [];
  for (const r of res.rows) {
    const deadline = gasdsClaimDeadline(r.created_at);
    const flag =
      deadline.getTime() <= now.getTime()
        ? "expired"
        : deadline.getTime() <= now.getTime() + GASDS_DEADLINE_WINDOW_MS
          ? "expiring"
          : null;
    if (!flag) continue; // deadline beyond the horizon — not yet a queue item
    rows.push({
      id: r.id,
      donor_id: r.donor_id,
      full_name: r.full_name,
      amountPence: r.amount_pence,
      collectedAt: r.created_at.toISOString(),
      gasdsDeadline: deadline.toISOString(),
      flag,
    });
  }
  return rows;
}

// HMRC recommends re-confirming ACTIVE donors roughly every two years — still paying enough tax,
// details current. This applies to the enduring/monthly declaration population (TASK-136).
export const DECLARATION_REVIEW_YEARS = 2;

export interface DeclarationReviewRow {
  id: number;
  donor_id: number;
  first_name: string;
  last_name: string;
  createdAt: string; // ISO date the declaration was made (the review anchor)
  reviewDueSince: string; // ISO date it became due for review (created_at + 2 years)
}

// List ACTIVE enduring (all_donations) declarations that are due a periodic review — made more than
// two years ago and not revoked. Read-only (pool.query). `now` is injectable so the cutoff is
// deterministic under test. A light reminder so staff re-confirm long-running monthly donors; there
// is no separate "reviewed_at" column yet, so the declaration's own created_at is the anchor
// (re-confirming today issues a fresh declaration via reviseDeclaration, resetting the clock).
export async function listDeclarationsDueReview(now: Date = new Date()): Promise<DeclarationReviewRow[]> {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - DECLARATION_REVIEW_YEARS);
  const res = await pool.query<{
    id: number;
    donor_id: number;
    first_name: string;
    last_name: string;
    created_at: Date;
  }>(
    `SELECT dec.id, dec.donor_id, dec.first_name, dec.last_name, dec.created_at
       FROM declarations dec
      WHERE dec.revoked_at IS NULL AND dec.scope = 'all_donations' AND dec.created_at <= $1
      ORDER BY dec.created_at ASC`,
    [cutoff],
  );
  return res.rows.map((r) => {
    const due = new Date(r.created_at.getTime());
    due.setUTCFullYear(due.getUTCFullYear() + DECLARATION_REVIEW_YEARS);
    return {
      id: r.id,
      donor_id: r.donor_id,
      first_name: r.first_name,
      last_name: r.last_name,
      createdAt: r.created_at.toISOString(),
      reviewDueSince: due.toISOString(),
    };
  });
}

// Mark GASDS-eligible small donations as claimed (TASK-138) — bookkeeping that they have been counted
// toward a GASDS top-up claim, so the deadline queue stops surfacing them. Stamps gasds_claimed_at on
// each still-unclaimed, GASDS-eligible id and appends ONE `gasds.claimed` audit row, in one
// transaction (writeWithAudit). Ids that are not GASDS-eligible or already claimed are silently
// skipped (the WHERE guards them), so a stale/duplicate request is a safe no-op. Returns the ids
// actually stamped.
export async function markGasdsClaimed(
  donationIds: number[],
  actor: string,
): Promise<{ claimedIds: number[] }> {
  return writeWithAudit(
    async (client) => {
      const res = await client.query<{ id: number }>(
        `UPDATE donations SET gasds_claimed_at = now()
          WHERE id = ANY($1::int[]) AND gasds_eligible = true AND gasds_claimed_at IS NULL
        RETURNING id`,
        [donationIds],
      );
      return { claimedIds: res.rows.map((r) => r.id) };
    },
    (r) => ({
      actor,
      action: "gasds.claimed",
      entity: "donation",
      entityId: r.claimedIds[0] ?? 0,
      data: { donationIds: r.claimedIds },
    }),
  );
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
  /** Where the gift was started: 'red_bag' for Fill a Red Bag, null for every other gift. */
  source: string | null;
  /** The invoice this gift paid (Admin > Giving > Invoices), so the list can say "Invoice INV-0012". */
  invoice_id: number | null;
}

// Find donations by donor name/email, Stripe id, donation id or donor id (joins the donor for the
// name/email match — donations carry no name/email of their own).
export async function searchDonations(q: string): Promise<DonationSearchRow[]> {
  const [pattern, numeric] = searchArgs(q);
  const res = await pool.query<DonationSearchRow>(
    `SELECT d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.mode, d.plan, d.amount_pence, d.currency, d.gift_aid, d.claim_status,
            d.payment_channel, d.created_at, d.source, d.invoice_id
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
  /** 'donation' for a gift; 'elf' for an Elf Detective School payment (an elf_orders row), which the
   *  list shows beside the gifts (Head Elf HQ). */
  kind: "donation" | "elf";
  id: number;
  /** Null on an elf payment: it has a family in Head Elf HQ, not a donor. */
  donor_id: number | null;
  donor_name: string;
  donor_email: string | null;
  mode: string;
  plan: string | null;
  amount_pence: number;
  currency: string;
  gift_aid: boolean;
  claim_status: string;
  payment_status: string;
  payment_channel: string;
  refunded_amount_pence: number;
  declaration_status: string | null;
  created_at: Date;
  /** Where the gift was started: 'red_bag' for Fill a Red Bag, null for every other gift;
   *  'elf_school' on an elf payment. */
  source: string | null;
  /** The invoice this gift paid (Admin > Giving > Invoices), so the list can say "Invoice INV-0012". */
  invoice_id: number | null;
  /** Stripe's reference for a gift (TASK-596): its payment, else its charge, else a renewal's invoice,
   *  else its checkout session. Null on an elf payment (it has its own reference) and a bank transfer. */
  stripe_ref: string | null;
  /** An elf payment's reference (EDS-K4F9Q2), its family, and its entry and gift; null on a gift. */
  elf_reference: string | null;
  elf_family_id: number | null;
  entry_pence: number | null;
  gift_pence: number | null;
  // The Donations gift log (docs/superpowers/plans/2026-11-05-donations-screen.md, Task 3). On an elf
  // payment these are null, but for its card fee cover.
  fee_cover_pence: number | null;
  /** What brought the giver (src/donations/arrival.ts); null when not noted. */
  arrival_channel: string | null;
  arrival_source: string | null;
  arrival_campaign: string | null;
  /** The giving page's path, e.g. /donate. */
  given_on: string | null;
  /** How it was paid (src/donations/pay-details.ts); null until checked with Stripe. */
  pay_method: string | null;
  pay_wallet: string | null;
  card_brand: string | null;
  card_last4: string | null;
  fundraiser_title: string | null;
  fundraiser_slug: string | null;
  /** The sponsor pledge this gift paid, if any. */
  pledge_id: number | null;
  donor_type: string | null;
  business_name: string | null;
  /** Plain words for the cards (src/donations/labels.ts): "Fill a Red Bag", "Invoice INV-0012" ... */
  given_on_label: string;
  /** "Apple Pay (Visa ending 4242)", "Direct Debit" ...; null when not known. */
  paid_by_label: string | null;
}

// The Elf Detective School's paid payments, the rows Head Elf HQ counts: a family a head elf removed
// is left out, as it is there.
const ELF_PAID = `FROM elf_orders o JOIN elf_families f ON f.id = o.family_id
      WHERE o.status = 'paid' AND f.active AND f.removed_at IS NULL`;
// Each as a row of the list, column for column with the gifts': the grown up as the name, entry plus
// gift as the amount, paid online, one off, and never in a claim (an entry is never Gift Aided; the
// gift alone can carry it). What only a gift has is a typed empty, so the UNION ALL lines up.
const ELF_ROWS = `SELECT 'elf' AS kind, NULL::text AS stripe_ref, o.reference AS elf_reference, o.family_id AS elf_family_id,
            o.entry_pence AS entry_pence, o.donation_pence AS gift_pence,
            o.fee_cover_pence AS fee_cover_pence, NULL::text AS arrival_channel, NULL::text AS arrival_source,
            NULL::text AS arrival_campaign, NULL::text AS given_on, NULL::text AS pay_method, NULL::text AS pay_wallet,
            NULL::text AS card_brand, NULL::text AS card_last4, NULL::text AS fundraiser_title, NULL::text AS fundraiser_slug,
            NULL::int AS pledge_id, NULL::text AS donor_type, NULL::text AS business_name,
            o.id, NULL::int AS donor_id, f.grown_up_name AS donor_name, f.email AS donor_email,
            'once' AS mode, NULL::text AS plan, o.entry_pence + o.donation_pence AS amount_pence, 'GBP' AS currency,
            (o.gift_aid AND o.donation_pence > 0) AS gift_aid, 'not_eligible' AS claim_status,
            'paid' AS payment_status, 'online' AS payment_channel, 0 AS refunded_amount_pence,
            NULL::text AS declaration_status, COALESCE(o.paid_at, o.created_at) AS created_at, 'elf_school' AS source, NULL::int AS invoice_id
       ${ELF_PAID}`;

/** The gift log's "Paid by" filter values. */
export const PAY_FILTERS = ["card", "apple_pay", "google_pay", "bacs_debit", "bank_transfer", "card_present"] as const;
/** Places a gift can be given that are not a donations.source: the Donate page, a fundraiser's page, the card reader. */
export const PLACE_FILTERS = ["donate_page", "fundraiser", "card_reader"] as const;
const PLACE_WHERE: Record<(typeof PLACE_FILTERS)[number], string> = {
  // As the Donate page's line in the totals (sumGiftsBySource), and never an invoice.
  donate_page: "d.source IS NULL AND d.payment_channel = 'online' AND d.fundraiser_id IS NULL AND d.invoice_id IS NULL",
  fundraiser: "d.fundraiser_id IS NOT NULL",
  card_reader: "d.payment_channel = 'in_person'",
};
const SEARCH_MAX = 100;

// A real calendar day written YYYY-MM-DD, or null.
function ukDateArg(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : null;
}

// Name or email as typed, trimmed and cut to 100 characters, with ILIKE's wild characters (and its
// escape, the backslash) taken literally. Null when there is nothing to search for.
function searchPattern(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().slice(0, SEARCH_MAX);
  return q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}

// Browse ALL donations, newest first, optionally filtered by claim_status and/or payment_channel,
// with a bounded page window. Returns the page plus the total matching count (for pagination).
//
// The Elf Detective School's payments are listed beside the gifts (decision 8 of
// docs/superpowers/specs/2026-11-05-elf-admin-design.md) wherever the filters fit them: they are paid,
// one off, online and never in a claim, so a claim status, Monthly, Refunded, Pending or Failed, in
// person or another source leaves them out, and ?source=elf_school shows only them. Both kinds are
// ordered by when each was given or paid, newest first: gifts before elf payments at the same moment,
// then the newest record.
//
// The gift log (Task 3 of docs/superpowers/plans/2026-11-05-donations-screen.md) adds a search by name
// or email and from/to UK dates, which elf payments meet as gifts do (by the grown up, and by when
// each was paid), and Paid by, Came from and Gift Aid, which only a gift can meet: any of them leaves
// elf payments out.
export async function listDonations(opts: {
  limit?: number;
  offset?: number;
  status?: string;
  channel?: string;
  paymentStatus?: string;
  /** TASK-446: 'monthly' or 'once'. Anything else is ignored rather than returning nothing. */
  mode?: string;
  /** 'red_bag': only gifts started on Fill a Red Bag (and so on, DONATION_SOURCES); 'elf_school':
   *  only the Elf Detective School's payments; 'donate_page', 'fundraiser' or 'card_reader' (PLACE_FILTERS).
   *  Anything else is ignored, as mode is. */
  source?: string;
  /** Name or email, ILIKE. */
  q?: string;
  /** UK dates, YYYY-MM-DD, inclusive. */
  from?: string;
  to?: string;
  /** One of PAY_FILTERS. */
  method?: string;
  /** An arrival channel (ARRIVAL_CHANNELS), or 'unknown' for none noted. */
  came?: string;
  /** 'yes' or 'no'. */
  giftAid?: string;
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
  // TASK-241: filter by payment state. 'refunded' is a derived state (refunds are tracked in
  // refunded_amount_pence, not payment_status), so it filters on any refund rather than the enum.
  if (opts.paymentStatus === "refunded") {
    where.push(`d.refunded_amount_pence > 0`);
  } else if (opts.paymentStatus) {
    params.push(opts.paymentStatus);
    where.push(`d.payment_status = $${params.length}`);
  }
  // TASK-446: regular giving vs one-off. Checked against the column's own CHECK values rather
  // than passed through: an unrecognised mode returns everything, which reads as "no filter", where
  // passing it on would quietly return an empty list and look like there are no donations at all.
  if (opts.mode === "monthly" || opts.mode === "once") {
    params.push(opts.mode);
    where.push(`d.mode = $${params.length}`);
  }
  // Fill a Red Bag only. Checked against the one list of sources (DONATION_SOURCES), for the same
  // reason as mode above: junk reads as "no filter", never as an empty list.
  const giftSource = typeof opts.source === "string" && (DONATION_SOURCES as readonly string[]).includes(opts.source);
  if (giftSource) {
    params.push(opts.source);
    where.push(`d.source = $${params.length}`);
  }
  // The Donate page, a fundraiser's page, the card reader: fixed conditions, no value to pass.
  const place = PLACE_FILTERS.find((p) => p === opts.source);
  if (place) where.push(PLACE_WHERE[place]);

  // Search and dates: on gifts and elf payments alike, by the same placeholders when both are listed.
  const pattern = searchPattern(opts.q);
  const from = ukDateArg(opts.from);
  const to = ukDateArg(opts.to);
  const shared = (values: unknown[]) => {
    const at = (v: unknown) => `$${values.push(v)}`;
    return { q: pattern ? at(pattern) : null, from: from ? at(from) : null, to: to ? at(to) : null };
  };
  const giftShared = shared(params);
  // A gift is found by its Stripe reference too (TASK-596): its payment, charge, renewal invoice or plan.
  if (giftShared.q) {
    const byStripe = ["stripe_payment_intent_id", "stripe_charge_id", "stripe_invoice_id", "stripe_subscription_id"].map((c) => ` OR d.${c} ILIKE ${giftShared.q}`).join("");
    where.push(`(dn.full_name ILIKE ${giftShared.q} OR dn.email ILIKE ${giftShared.q}${byStripe})`);
  }
  if (giftShared.from) where.push(`(d.created_at AT TIME ZONE 'Europe/London')::date >= ${giftShared.from}::date`);
  if (giftShared.to) where.push(`(d.created_at AT TIME ZONE 'Europe/London')::date <= ${giftShared.to}::date`);

  // Paid by. Apple Pay and Google Pay are online card payments by wallet; "card" is the rest of them.
  // The card reader includes an in person gift not yet checked with Stripe (it can be nothing else).
  const method = PAY_FILTERS.find((m) => m === opts.method);
  if (method === "apple_pay" || method === "google_pay") {
    params.push(method);
    where.push(`d.pay_method = 'card' AND d.pay_wallet = $${params.length}`);
  } else if (method === "card") {
    params.push(method);
    where.push(`d.pay_method = $${params.length} AND (d.pay_wallet IS NULL OR d.pay_wallet NOT IN ('apple_pay', 'google_pay'))`);
  } else if (method === "card_present") {
    params.push(method);
    where.push(`(d.pay_method = $${params.length} OR (d.pay_method IS NULL AND d.payment_channel = 'in_person'))`);
  } else if (method) {
    params.push(method);
    where.push(`d.pay_method = $${params.length}`);
  }
  // Came from: a channel, or 'unknown' for the gifts where nothing was noted.
  const came = opts.came === "unknown" ? "unknown" : ARRIVAL_CHANNELS.find((c) => c === opts.came);
  if (came === "unknown") {
    where.push(`d.arrival_channel IS NULL`);
  } else if (came) {
    params.push(came);
    where.push(`d.arrival_channel = $${params.length}`);
  }
  const giftAid = opts.giftAid === "yes" || opts.giftAid === "no" ? opts.giftAid : null;
  if (giftAid) where.push(`d.gift_aid = ${giftAid === "yes" ? "true" : "false"}`);

  const onlyElf = opts.source === ELF_SOURCE;
  const elfFits =
    !opts.status &&
    (!opts.channel || opts.channel === "online") &&
    (!opts.paymentStatus || opts.paymentStatus === "paid") &&
    opts.mode !== "monthly" &&
    !method &&
    !came &&
    !giftAid;
  const withGifts = !onlyElf;
  const withElf = elfFits && !giftSource && !place;
  // Elf Detective School only, with a filter no payment of it can meet: nothing to look up.
  if (!withGifts && !withElf) return { results: [], total: 0 };

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // The gifts' filters' values belong to the gifts' WHERE; a list of elf payments alone carries only
  // its own search and dates.
  const values = withGifts ? params : [];
  const elfAt = withGifts ? giftShared : shared(values);
  const elfWhere = [
    ...(elfAt.q ? [`(f.grown_up_name ILIKE ${elfAt.q} OR f.email ILIKE ${elfAt.q})`] : []),
    ...(elfAt.from ? [`(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date >= ${elfAt.from}::date`] : []),
    ...(elfAt.to ? [`(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date <= ${elfAt.to}::date`] : []),
  ]
    .map((c) => ` AND ${c}`)
    .join("");
  // The donor's name is only needed to count when searching by it.
  const giftFrom = `FROM donations d ${giftShared.q ? "JOIN donors dn ON dn.id = d.donor_id " : ""}${whereSql}`;
  const giftCount = `SELECT count(*)::int ${giftFrom}`;
  const elfCount = `SELECT count(*)::int ${ELF_PAID}${elfWhere}`;
  const countSql = withGifts && withElf
    ? `SELECT (${giftCount}) + (${elfCount}) AS count`
    : `SELECT count(*)::int AS count ${withGifts ? giftFrom : `${ELF_PAID}${elfWhere}`}`;
  const totalRes = await pool.query<{ count: number }>(countSql, values);

  // The new columns come before the old ones, so each half's tail reads as it always has. At most one
  // sponsor pledge per gift, so a row is never doubled.
  const giftRows = `SELECT 'donation' AS kind,
            COALESCE(d.stripe_payment_intent_id, d.stripe_charge_id, d.stripe_invoice_id, d.stripe_session_id) AS stripe_ref,
            NULL::text AS elf_reference, NULL::int AS elf_family_id,
            NULL::int AS entry_pence, NULL::int AS gift_pence,
            d.fee_cover_pence, d.arrival_channel, d.arrival_source,
            d.arrival_campaign, d.given_on, d.pay_method, d.pay_wallet,
            d.card_brand, d.card_last4, fr.title AS fundraiser_title, fr.slug AS fundraiser_slug,
            (SELECT sp.id FROM sponsor_pledges sp WHERE sp.donation_id = d.id ORDER BY sp.id LIMIT 1) AS pledge_id,
            dn.donor_type, dn.business_name,
            d.id, d.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            d.mode, d.plan, d.amount_pence, d.currency, d.gift_aid, d.claim_status,
            d.payment_status, d.payment_channel, d.refunded_amount_pence, d.declaration_status, d.created_at, d.source, d.invoice_id
       FROM donations d
       JOIN donors dn ON dn.id = d.donor_id
       LEFT JOIN fundraisers fr ON fr.id = d.fundraiser_id
       ${whereSql}`;
  const parts = [...(withGifts ? [giftRows] : []), ...(withElf ? [`${ELF_ROWS}${elfWhere}`] : [])];
  const res = await pool.query<Omit<AdminDonationRow, "given_on_label" | "paid_by_label">>(
    `SELECT * FROM (${parts.join(" UNION ALL ")}) listed
      ORDER BY listed.created_at DESC, listed.kind = 'elf', listed.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values,
  );
  return { results: res.rows.map(withLabels), total: totalRes.rows[0].count };
}

// The plain words for a row's cards, by the one set of rules (src/donations/labels.ts).
function withLabels(r: Omit<AdminDonationRow, "given_on_label" | "paid_by_label">): AdminDonationRow {
  const kind = r.kind === "elf" ? "elf" : "donation";
  return {
    ...r,
    given_on_label: givenOnLabel({
      kind,
      source: r.source ?? null,
      paymentChannel: r.payment_channel,
      invoiceId: r.invoice_id ?? null,
      fundraiserTitle: r.fundraiser_title ?? null,
      pledgeId: r.pledge_id ?? null,
    }),
    paid_by_label: paidByLabel({
      kind,
      paymentChannel: r.payment_channel,
      payMethod: r.pay_method ?? null,
      payWallet: r.pay_wallet ?? null,
      cardBrand: r.card_brand ?? null,
      cardLast4: r.card_last4 ?? null,
    }),
  };
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
  cancelled_at: Date | null;
  updated_at: Date;
}

// List subscription dunning rows (at-risk / lapsed monthly gifts, REQ-057/065), most-recently
// updated first, optionally filtered by status ('active' | 'past_due' | 'lapsed'). Joins the donor.
export async function listDunning(status?: string): Promise<DunningRow[]> {
  const params: unknown[] = [];
  let whereSql = "";
  // TASK-245: 'cancelled' is a derived filter — a voluntary cancel is stamped in cancelled_at, not the
  // status enum ('active'/'past_due'/'lapsed') — so it filters on cancelled_at rather than sd.status.
  if (status === "cancelled") {
    whereSql = `WHERE sd.cancelled_at IS NOT NULL`;
  } else if (status) {
    params.push(status);
    whereSql = `WHERE sd.status = $1`;
  }
  const res = await pool.query<DunningRow>(
    `SELECT sd.id, sd.donor_id, dn.full_name AS donor_name, dn.email AS donor_email,
            sd.stripe_subscription_id, sd.status, sd.failed_attempts, sd.lapsed_at, sd.cancelled_at,
            sd.updated_at
       FROM subscription_dunning sd
       JOIN donors dn ON dn.id = sd.donor_id
       ${whereSql}
      ORDER BY sd.updated_at DESC, sd.id DESC`,
    params,
  );
  return res.rows;
}
