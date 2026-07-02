import type { PoolClient } from "pg";
import { pool } from "./pool";
import {
  buildDonationRow,
  batchAssignmentBlock,
  type DonationInput,
  type DonationRow,
  type DonorInput,
  type BatchBlockReason,
  type ClaimStatus,
} from "./donations-model";
import { buildDeclarationRow, type DeclarationRow } from "../declarations/fields";
import type { DeclarationWrite } from "./stripe-webhook-model";

// The unified donation model's write layer (REQ-036/REQ-037). Every state write and
// its matching audit_log row commit or roll back TOGETHER, inside one BEGIN…COMMIT
// (the truth model in CLAUDE.md). Pure field mapping / claim derivation lives in
// ./donations-model (unit-tested DB-free); this module owns only the transaction.
// The Stripe webhook processor (./stripe-webhook) reuses insertAudit +
// insertDonorAndDonation inside its own idempotent transaction.

export type { DonorInput } from "./donations-model";

export interface AuditInput {
  actor: string; // who/what performed the action (e.g. "system", "stripe", an admin)
  action: string; // e.g. "donation.created"
  entity: string; // "donation" | "donor" | "declaration" | ...
  entityId: number | null; // the affected row's id
  data?: Record<string, unknown>; // arbitrary snapshot/context, stored as jsonb
}

// Append one audit_log row using the supplied client (so it joins the caller's
// transaction). The audit_log table is append-only (a trigger blocks UPDATE/DELETE).
export async function insertAudit(client: PoolClient, audit: AuditInput): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [audit.actor, audit.action, audit.entity, audit.entityId, audit.data ?? {}],
  );
}

// The atomic helper. `write` performs the state change (insert/update on
// donors/declarations/donations) using the supplied client; `toAudit` maps its
// result to the audit row. Both the write and the audit INSERT run in one
// transaction — ANY throw (from either) rolls back BOTH, so an audited change is
// never half-persisted and the audit trail never drifts from the data.
export async function writeWithAudit<T>(
  write: (client: PoolClient) => Promise<T>,
  toAudit: (result: T) => AuditInput,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await write(client);
    await insertAudit(client, toAudit(result));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Insert a single donations row (already mapped + claim-derived) using the given
// client; returns its id. Shared by insertDonorAndDonation and the Stripe webhook
// processor's recurring-charge path, so the column list lives in one place.
export async function insertDonation(client: PoolClient, row: DonationRow): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO donations
       (donor_id, declaration_id, mode, plan, amount_pence, currency, gift_aid,
        payment_channel, claim_status, stripe_session_id, stripe_payment_intent_id,
        stripe_subscription_id, stripe_charge_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      row.donor_id,
      row.declaration_id,
      row.mode,
      row.plan,
      row.amount_pence,
      row.currency,
      row.gift_aid,
      row.payment_channel,
      row.claim_status,
      row.stripe_session_id,
      row.stripe_payment_intent_id,
      row.stripe_subscription_id,
      row.stripe_charge_id,
    ],
  );
  return res.rows[0].id;
}

// Insert a single declarations row (already mapped by buildDeclarationRow) using the
// given client; returns its id. The declarations table is immutable (REQ-046) — the app
// never updates a saved row. Shared by insertDonorAndDonation.
export async function insertDeclaration(client: PoolClient, row: DeclarationRow): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO declarations
       (donor_id, title, first_name, last_name, house_name_number, address, postcode,
        non_uk, scope, wording_version, wording_snapshot, confirmed_taxpayer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      row.donor_id,
      row.title,
      row.first_name,
      row.last_name,
      row.house_name_number,
      row.address,
      row.postcode,
      row.non_uk,
      row.scope,
      row.wording_version,
      row.wording_snapshot,
      row.confirmed_taxpayer,
    ],
  );
  return res.rows[0].id;
}

// Insert a donor and its donation row (mapped + claim-derived by buildDonationRow)
// using the given client, so it joins the caller's transaction. donor_type comes
// from the donation (one source of truth). When a Gift Aid declaration is supplied
// (REQ-043), it is inserted BETWEEN the donor and the donation and its id is wired onto
// the donation's declaration_id — so the declaration + donation commit together and the
// donation derives claim_status='eligible' from the now-present declaration. Shared by
// recordDonation and the Stripe webhook processor.
export async function insertDonorAndDonation(
  client: PoolClient,
  donor: DonorInput,
  donation: DonationInput,
  declaration?: DeclarationWrite,
): Promise<{ donorId: number; donationId: number; declarationId: number | null }> {
  const donorRes = await client.query<{ id: number }>(
    `INSERT INTO donors
       (donor_type, full_name, business_name, company_number, email, email_consent, anonymous)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      donation.donorType,
      donor.fullName,
      donor.businessName ?? null,
      donor.companyNumber ?? null,
      donor.email ?? null,
      donor.emailConsent ?? false,
      donor.anonymous ?? false,
    ],
  );
  const donorId = donorRes.rows[0].id;

  let declarationId: number | null = null;
  if (declaration) {
    declarationId = await insertDeclaration(
      client,
      buildDeclarationRow(declaration.fields, {
        donorId,
        scope: declaration.scope,
        wording: declaration.wording,
        confirmedTaxpayer: declaration.confirmedTaxpayer,
      }),
    );
  }

  // Set declarationId BEFORE buildDonationRow so claim_status derives from the
  // now-present declaration (an individual gift with a declaration is eligible).
  const donationInput = declarationId != null ? { ...donation, declarationId } : donation;
  const donationId = await insertDonation(client, buildDonationRow(donationInput, donorId));
  return { donorId, donationId, declarationId };
}

export interface RecordDonationInput {
  donor: DonorInput;
  donation: DonationInput; // carries donorType, mode, amount, giftAid, stripe/declaration refs
}

// Concrete use of writeWithAudit: insert the donor + donation and append the
// "donation.created" audit row, all atomically. Returns the new ids.
export async function recordDonation(
  input: RecordDonationInput,
): Promise<{ donorId: number; donationId: number }> {
  return writeWithAudit(
    (client) => insertDonorAndDonation(client, input.donor, input.donation),
    (r) => ({
      actor: "system",
      action: "donation.created",
      entity: "donation",
      entityId: r.donationId,
      data: { donorId: r.donorId, donorType: input.donation.donorType },
    }),
  );
}

// A donation cannot be assigned to a claim batch (REQ-037). Carries the pure reason
// (from batchAssignmentBlock) plus not_found for a missing id — a typed error like
// SamePlanError so callers/tests can branch on it rather than a bare Error.
export class BatchAssignmentError extends Error {
  constructor(
    public readonly reason: BatchBlockReason | "not_found",
    public readonly donationId: number,
  ) {
    super(`donation ${donationId} cannot be assigned to a claim batch: ${reason}`);
    this.name = "BatchAssignmentError";
  }
}

// Client-level state write: lock the donation row (FOR UPDATE, so concurrent claims
// race safely), enforce the claim invariant + one-batch-per-donation guard
// (batchAssignmentBlock), then set its claim_batch_id and claim_status='batched'.
// Takes the caller's client so it joins the transaction opened by assignDonationToBatch
// (or any future claim-pipeline caller). Throws BatchAssignmentError if the donation is
// missing, not eligible, or already batched — which rolls the whole transaction back.
export async function batchDonation(
  client: PoolClient,
  donationId: number,
  claimBatchId: number,
): Promise<{ donationId: number; claimBatchId: number }> {
  const current = (
    await client.query<{ claim_status: ClaimStatus; claim_batch_id: number | null }>(
      `SELECT claim_status, claim_batch_id FROM donations WHERE id = $1 FOR UPDATE`,
      [donationId],
    )
  ).rows[0];
  if (!current) throw new BatchAssignmentError("not_found", donationId);

  const block = batchAssignmentBlock({
    claimStatus: current.claim_status,
    claimBatchId: current.claim_batch_id,
  });
  if (block) throw new BatchAssignmentError(block, donationId);

  await client.query(
    `UPDATE donations SET claim_batch_id = $1, claim_status = 'batched' WHERE id = $2`,
    [claimBatchId, donationId],
  );
  return { donationId, claimBatchId };
}

// Concrete audited admin write (REQ-037/REQ-062): assign an eligible donation to a
// claim batch and append the "donation.batched" audit row, atomically — mirrors
// recordDonation. Any guard failure in batchDonation throws, so writeWithAudit rolls
// back BOTH the state change and the audit row (never a half-batched donation, never a
// drifted audit trail). actor defaults to "system"; an admin action passes its user.
export async function assignDonationToBatch(
  donationId: number,
  claimBatchId: number,
  actor = "system",
): Promise<{ donationId: number; claimBatchId: number }> {
  return writeWithAudit(
    (client) => batchDonation(client, donationId, claimBatchId),
    (r) => ({
      actor,
      action: "donation.batched",
      entity: "donation",
      entityId: r.donationId,
      data: { claimBatchId: r.claimBatchId },
    }),
  );
}
