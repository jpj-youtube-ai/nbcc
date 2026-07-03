import type { PoolClient } from "pg";
import { pool } from "./pool";
import {
  buildDonationRow,
  batchAssignmentBlock,
  groupPublicSupporters,
  type DonationInput,
  type DonationRow,
  type DonorInput,
  type DonorType,
  type BatchBlockReason,
  type ClaimStatus,
  type SupporterSourceRow,
  type SupporterTier,
  type PublicSupporter,
} from "./donations-model";
import {
  buildDeclarationRow,
  type DeclarationRow,
  type DeclarationFields,
} from "../declarations/fields";
import {
  selectDeclarationWording,
  declarationScopeForMode,
  scopeFromDeclarationScope,
} from "../declarations/wording";
import { applyDeclarationEvent, type DeclarationStatus } from "../declarations/status";
import { deriveClaimStatus } from "./donations-model";
import type { DeclarationWrite, PartnerShareWrite } from "./stripe-webhook-model";
import type { ClaimRowInput } from "../claims/charities-online";
import {
  annualisePence,
  deriveBenefitCapBreach,
  recordedBenefitValuePence,
  type BenefitAward,
  type Mode,
} from "../benefits/caps";

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
        gasds_eligible, payment_channel, claim_status, stripe_session_id,
        stripe_payment_intent_id, stripe_subscription_id, stripe_charge_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      row.donor_id,
      row.declaration_id,
      row.mode,
      row.plan,
      row.amount_pence,
      row.currency,
      row.gift_aid,
      row.gasds_eligible,
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

// Insert one donation_partner_shares row (donation FK + a partner's declaration FK + that
// partner's share in pence) using the given client, so it joins the caller's transaction;
// returns its id. Enables many declarations per donation for a partnership (REQ-051), one
// per partner, instead of the single donations.declaration_id used for individuals.
export async function insertPartnerShare(
  client: PoolClient,
  donationId: number,
  declarationId: number,
  sharePence: number,
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO donation_partner_shares (donation_id, declaration_id, share_pence)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [donationId, declarationId, sharePence],
  );
  return res.rows[0].id;
}

// Insert a donor and its donation row (mapped + claim-derived by buildDonationRow)
// using the given client, so it joins the caller's transaction. donor_type comes
// from the donation (one source of truth). When a Gift Aid declaration is supplied
// (REQ-043), it is inserted BETWEEN the donor and the donation and its id is wired onto
// the donation's declaration_id — so the declaration + donation commit together and the
// donation derives claim_status='eligible' from the now-present declaration. For a business
// PARTNERSHIP (REQ-051) there is no single declaration_id; instead `partners` are inserted
// AFTER the donation (they FK its id) as one immutable declarations row + one
// donation_partner_shares row each, all in the SAME transaction. Shared by recordDonation and
// the Stripe webhook processor.
export async function insertDonorAndDonation(
  client: PoolClient,
  donor: DonorInput,
  donation: DonationInput,
  declaration?: DeclarationWrite,
  partners?: PartnerShareWrite[],
): Promise<{
  donorId: number;
  donationId: number;
  declarationId: number | null;
  partnerShareIds: number[];
}> {
  const donorRes = await client.query<{ id: number }>(
    `INSERT INTO donors
       (donor_type, full_name, business_name, company_number, email, email_consent, anonymous,
        billing_address, billing_postcode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      donation.donorType,
      donor.fullName,
      donor.businessName ?? null,
      donor.companyNumber ?? null,
      donor.email ?? null,
      donor.emailConsent ?? false,
      donor.anonymous ?? false,
      donor.billingAddress ?? null,
      donor.billingPostcode ?? null,
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

  // Partnership (REQ-051): one immutable declarations row + one donation_partner_shares row
  // per partner, inserted AFTER the donation (the share FKs its id). Each partner is an
  // individual in law with their own declaration; the shares were validated at checkout to
  // sum to the donation amount. donations.declaration_id stays null — the partner shares carry
  // the declarations, not the single-declaration link used for individuals.
  const partnerShareIds: number[] = [];
  if (partners) {
    for (const partner of partners) {
      const partnerDeclarationId = await insertDeclaration(
        client,
        buildDeclarationRow(partner.fields, {
          donorId,
          scope: partner.scope,
          wording: partner.wording,
          confirmedTaxpayer: partner.confirmedTaxpayer,
        }),
      );
      partnerShareIds.push(
        await insertPartnerShare(client, donationId, partnerDeclarationId, partner.sharePence),
      );
    }
  }

  return { donorId, donationId, declarationId, partnerShareIds };
}

// Read the publicly listable supporters for the donors wall (TASK-071/REQ-035). Selects
// each donor with at least one donation and their LARGEST gift (MAX amount_pence), then
// the pure groupPublicSupporters places them into the three display tiers (alphabetical
// within tier). Anonymous donors are dropped by isPubliclyListable inside the grouper —
// selected here so the invariant is enforced by the shared helper, never re-implemented
// in SQL — so they never reach the page. Read-only; no audit row.
export async function listPublicSupporters(): Promise<Record<SupporterTier, PublicSupporter[]>> {
  const res = await pool.query<{
    donor_type: DonorType;
    full_name: string;
    business_name: string | null;
    anonymous: boolean;
    max_amount: string | number;
  }>(
    `SELECT dn.donor_type, dn.full_name, dn.business_name, dn.anonymous,
            MAX(d.amount_pence) AS max_amount
       FROM donors dn JOIN donations d ON d.donor_id = dn.id
      GROUP BY dn.id, dn.donor_type, dn.full_name, dn.business_name, dn.anonymous`,
  );
  const rows: SupporterSourceRow[] = res.rows.map((r) => ({
    donorType: r.donor_type,
    fullName: r.full_name,
    businessName: r.business_name,
    anonymous: r.anonymous,
    amountPence: Number(r.max_amount),
  }));
  return groupPublicSupporters(rows);
}

// One claimable donation + its declaration, shaped for the Charities Online row builder
// (src/claims/charities-online.ts). Extends ClaimRowInput (donation + declaration) with the
// donation id and donor name for logging/traceability — the CSV itself uses only the nested
// donation + declaration fields.
export interface ClaimableExportRow extends ClaimRowInput {
  donationId: number;
  donorFullName: string;
}

interface ClaimableExportDbRow {
  id: number;
  full_name: string;
  title: string | null;
  first_name: string;
  last_name: string;
  house_name_number: string;
  postcode: string | null;
  created_at: Date;
  amount_pence: number;
}

// Read the donations ready for a Charities Online Gift Aid claim (REQ-052): every
// claim_status='eligible' donation joined to its immutable declarations row and its donor.
// Read-only (pool.query, no transaction/audit — mirrors listPublicSupporters). Eligibility is
// NOT re-derived here: claim_status='eligible' is set at write time by deriveClaimStatus
// (individual donor + Gift Aid + an active declaration, not refunded — REQ-037), so the filter
// alone excludes company and otherwise non-claimable gifts, and the INNER JOIN to declarations
// excludes any eligible row without a declaration. Optionally scoped to a single claim batch
// (claim_batch_id). Ordered by donation id for a stable file. The pure row builder / CSV
// serializer (src/claims/charities-online.ts) formats the result.
export async function listClaimableDonationsForExport(
  claimBatchId?: number,
): Promise<ClaimableExportRow[]> {
  const filterByBatch = claimBatchId != null;
  const res = await pool.query<ClaimableExportDbRow>(
    `SELECT d.id, dn.full_name,
            dec.title, dec.first_name, dec.last_name, dec.house_name_number, dec.postcode,
            d.created_at, d.amount_pence
       FROM donations d
       JOIN declarations dec ON dec.id = d.declaration_id
       JOIN donors dn ON dn.id = d.donor_id
      WHERE d.claim_status = 'eligible'
        ${filterByBatch ? "AND d.claim_batch_id = $1" : ""}
      ORDER BY d.id ASC`,
    filterByBatch ? [claimBatchId] : [],
  );
  return res.rows.map((r) => ({
    donationId: r.id,
    donorFullName: r.full_name,
    declaration: {
      title: r.title,
      first_name: r.first_name,
      last_name: r.last_name,
      house_name_number: r.house_name_number,
      postcode: r.postcode,
    },
    donation: {
      created_at: r.created_at,
      amount_pence: r.amount_pence,
    },
  }));
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

// Insert one donation_benefits row (donation FK + benefit_type FK + the recorded value)
// using the given client, so it joins the caller's transaction; returns its id. The value
// is already normalised by the caller (recognition perks forced to £0).
export async function insertDonationBenefit(
  client: PoolClient,
  donationId: number,
  benefitTypeId: number,
  valuePence: number,
): Promise<number> {
  const res = await client.query<{ id: number }>(
    `INSERT INTO donation_benefits (donation_id, benefit_type_id, value_pence)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [donationId, benefitTypeId, valuePence],
  );
  return res.rows[0].id;
}

export interface RecordBenefitsResult {
  donationId: number;
  donorId: number;
  benefitIds: number[];
  capBreached: boolean;
}

// Concrete audited admin write (REQ-045): record the benefits awarded against a donation
// and flag whether they breach the HMRC donor-benefit cap, atomically — mirrors
// recordDonation / assignDonationToBatch. In ONE BEGIN…COMMIT it (a) locks the donation
// (FOR UPDATE, so the flag update races safely), (b) inserts one donation_benefits row per
// benefit — each a NAMED recognition perk is forced to £0 regardless of admin input
// (recordedBenefitValuePence), (c) derives the cap breach from the ANNUALISED donation vs
// the ANNUALISED benefit total (a monthly gift ×12, so the bands compare on a yearly
// basis — the pure logic in src/benefits/caps.ts), and (d) sets donations.benefit_cap_breached.
// Any throw rolls BOTH the benefit rows and the audit row back (never a half-recorded set,
// never a drifted audit trail). actor defaults to "system"; an admin action passes its user.
export async function recordDonationBenefits(
  donationId: number,
  donorId: number,
  benefits: BenefitAward[],
  actor = "system",
): Promise<RecordBenefitsResult> {
  return writeWithAudit(
    async (client) => {
      const donation = (
        await client.query<{ amount_pence: number; mode: Mode }>(
          `SELECT amount_pence, mode FROM donations WHERE id = $1 FOR UPDATE`,
          [donationId],
        )
      ).rows[0];
      if (!donation) throw new Error(`donation ${donationId} not found`);

      const benefitIds: number[] = [];
      let benefitTotalPence = 0;
      for (const benefit of benefits) {
        const value = recordedBenefitValuePence(benefit); // recognition perks → £0
        benefitTotalPence += value;
        benefitIds.push(await insertDonationBenefit(client, donationId, benefit.benefitTypeId, value));
      }

      const capBreached = deriveBenefitCapBreach({
        annualisedDonationPence: annualisePence(donation.mode, donation.amount_pence),
        benefitValuePence: annualisePence(donation.mode, benefitTotalPence),
      });
      await client.query(`UPDATE donations SET benefit_cap_breached = $1 WHERE id = $2`, [
        capBreached,
        donationId,
      ]);

      return { donationId, donorId, benefitIds, capBreached };
    },
    (r) => ({
      actor,
      action: "donation.benefits_recorded",
      entity: "donation",
      entityId: r.donationId,
      data: { donorId: r.donorId, benefitIds: r.benefitIds, capBreached: r.capBreached },
    }),
  );
}

// Why a token-scoped declaration completion cannot proceed (TASK-076/REQ-057): the token
// matched no donation, or the donation is not in a completable state (already completed, or
// an online donation that needs no separate confirmation). A typed error like
// BatchAssignmentError so the route can map it (404 / 409) rather than a bare 500.
export class GiftAidCompletionError extends Error {
  constructor(public readonly reason: "not_found" | "not_completable") {
    super(`gift aid declaration cannot be completed: ${reason}`);
    this.name = "GiftAidCompletionError";
  }
}

// The donation a valid completion token addresses, for rendering the form (GET) — the
// verbatim wording the donor will agree to, and whether it is already done. Pure lookup, no
// mutation, so a GET never advances declaration_status off 'sent'/'undelivered'.
export interface GiftAidDeclarationContext {
  donationId: number;
  amountPence: number;
  currency: string;
  declarationStatus: DeclarationStatus;
  alreadyCompleted: boolean;
  wordingVersion: string;
  wordingSnapshot: string;
}

interface TokenDonationRow {
  id: number;
  donor_id: number;
  donor_type: DonorType;
  mode: Mode;
  amount_pence: number;
  currency: string;
  declaration_status: DeclarationStatus;
}

// Read the donation a completion token addresses. Returns its context (incl. the verbatim
// HMRC wording it would record) WITHOUT any write — the GET render path (REQ-048). Throws
// GiftAidCompletionError('not_found') for an unknown token. A `completed` token still
// resolves (alreadyCompleted=true) so the page can show a done state; the caller does not
// mutate here, so a mere GET never reads as / advances to completed.
export async function getGiftAidDeclarationContext(
  token: string,
): Promise<GiftAidDeclarationContext> {
  const row = (
    await pool.query<TokenDonationRow>(
      `SELECT d.id, d.donor_id, dn.donor_type, d.mode, d.amount_pence, d.currency, d.declaration_status
         FROM donations d JOIN donors dn ON dn.id = d.donor_id
        WHERE d.declaration_token = $1`,
      [token],
    )
  ).rows[0];
  if (!row) throw new GiftAidCompletionError("not_found");
  const scope = scopeFromDeclarationScope(declarationScopeForMode(row.mode));
  const wording = selectDeclarationWording({ mode: row.mode, scope });
  return {
    donationId: row.id,
    amountPence: row.amount_pence,
    currency: row.currency,
    declarationStatus: row.declaration_status,
    alreadyCompleted: row.declaration_status === "completed",
    wordingVersion: wording.wording_version,
    wordingSnapshot: wording.wording_snapshot,
  };
}

export interface CompleteDeclarationResult {
  donationId: number;
  donorId: number;
  declarationId: number;
}

// Concrete audited write (REQ-048/REQ-057): the donor completes their Gift Aid declaration
// via the token-scoped link. In ONE transaction (writeWithAudit, mirroring
// assignDonationToBatch) it locks the donation by its declaration_token (FOR UPDATE, so a
// double submit races safely), enforces the legal declaration transition
// (applyDeclarationEvent(current, 'confirm') — only 'sent'/'undelivered' complete; an
// already-'completed' or 'not_required' token throws GiftAidCompletionError), inserts the
// IMMUTABLE declarations row (buildDeclarationRow, with the verbatim wording), links it onto
// donations.declaration_id, and — because the donor has now Gift-Aided the gift — sets
// gift_aid=true and declaration_status='completed' and recomputes claim_status. Any throw
// rolls BOTH the declaration insert and the audit row back, so a token that merely rendered
// the form is never read as completed until this write succeeds.
export async function completeDeclaration(
  token: string,
  fields: DeclarationFields,
): Promise<CompleteDeclarationResult> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<TokenDonationRow>(
          `SELECT d.id, d.donor_id, dn.donor_type, d.mode, d.amount_pence, d.currency, d.declaration_status
             FROM donations d JOIN donors dn ON dn.id = d.donor_id
            WHERE d.declaration_token = $1 FOR UPDATE`,
          [token],
        )
      ).rows[0];
      if (!row) throw new GiftAidCompletionError("not_found");

      // Enforce the legal transition: only a 'sent' or bounced 'undelivered' confirmation
      // completes. 'completed' (already done) / 'not_required' / 'pending' throw.
      let nextStatus: DeclarationStatus;
      try {
        nextStatus = applyDeclarationEvent(row.declaration_status, "confirm");
      } catch {
        throw new GiftAidCompletionError("not_completable");
      }

      const scope = scopeFromDeclarationScope(declarationScopeForMode(row.mode));
      const wording = selectDeclarationWording({ mode: row.mode, scope });
      const declarationId = await insertDeclaration(
        client,
        buildDeclarationRow(fields, { donorId: row.donor_id, scope, wording, confirmedTaxpayer: true }),
      );

      // The donor has now Gift-Aided this gift: flip gift_aid on, link the declaration, and
      // recompute claim_status (an individual with Gift Aid + a declaration is eligible).
      const claimStatus = deriveClaimStatus({
        donorType: row.donor_type,
        giftAid: true,
        hasDeclaration: true,
      });
      await client.query(
        `UPDATE donations
            SET declaration_id = $1, gift_aid = true, declaration_status = $2, claim_status = $3
          WHERE id = $4`,
        [declarationId, nextStatus, claimStatus, row.id],
      );

      return { donationId: row.id, donorId: row.donor_id, declarationId };
    },
    (r) => ({
      actor: "donor",
      action: "declaration.completed",
      entity: "declaration",
      entityId: r.declarationId,
      data: { donationId: r.donationId, donorId: r.donorId },
    }),
  );
}
