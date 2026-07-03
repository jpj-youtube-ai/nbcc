import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import { findActiveDeclarationIdForDonor, DeclarationCancellationError } from "./declarations";
import { buildDeclarationCancellation } from "../declarations/cancellation";

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
