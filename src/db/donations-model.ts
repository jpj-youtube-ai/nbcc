import { z } from "zod";

// Pure field-mapping / claim-eligibility logic for the unified donation model
// (REQ-036/REQ-037). NO pool, NO config, NO clock — importing this file touches
// nothing external, so it is unit-tested DB-free per CLAUDE.md. The atomic write
// helper that persists these rows (with the paired audit_log row) lives in
// src/db/donations.ts. Gift Aid is a FLAG/relationship on the donation, never a
// second store (REQ-036); a donation is claimable only when the donor is an
// individual, an active declaration covers it, and it is not (fully) refunded
// (REQ-037) — company donations are permanently not_eligible (REQ-053).

export const DONOR_TYPES = ["individual", "company"] as const;
export const MODES = ["once", "monthly"] as const;
export const PLANS = ["bronze", "silver", "gold", "platinum"] as const;
export const PAYMENT_CHANNELS = ["online", "in_person"] as const;
export const CLAIM_STATUSES = ["not_eligible", "eligible", "batched", "claimed"] as const;

export type DonorType = (typeof DONOR_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// The normalised input a caller hands to recordDonation. Mirrors the front-end
// checkout payload { mode, plan, amount, giftAid } (REQ-028) plus the donor type
// and the Stripe/declaration references a webhook (REQ-036, later) fills in.
export const donationInputSchema = z
  .object({
    donorType: z.enum(DONOR_TYPES),
    mode: z.enum(MODES),
    plan: z.enum(PLANS).nullable().default(null),
    amountPence: z.number().int().positive(),
    currency: z.string().min(1).default("GBP"),
    giftAid: z.boolean().default(false),
    // GASDS eligibility (REQ-058/TASK-078): set by cardPresentDonationInput for a small,
    // un-declared, non-Gift-Aided in-person gift; every other channel leaves it false (an
    // online/declared/Gift-Aided gift goes the Gift Aid route, never GASDS).
    gasdsEligible: z.boolean().default(false),
    paymentChannel: z.enum(PAYMENT_CHANNELS).default("online"),
    declarationId: z.number().int().positive().nullable().default(null),
    stripeSessionId: z.string().nullable().default(null),
    stripePaymentIntentId: z.string().nullable().default(null),
    stripeSubscriptionId: z.string().nullable().default(null),
    stripeChargeId: z.string().nullable().default(null),
  })
  // A monthly gift is a subscription keyed by plan (REQ-041); a one-off carries
  // its own amount. Mirrors the checkout-session refinement in src/routes/api.ts.
  .refine((d) => d.mode !== "monthly" || d.plan !== null, {
    message: "monthly giving requires a plan",
    path: ["plan"],
  });

export type DonationInput = z.infer<typeof donationInputSchema>;

// The donor identity fields (donor_type comes from the donation — one source of
// truth). A plain data shape, so pure event→record mappers can build it DB-free.
export interface DonorInput {
  fullName: string; // person name, or a company's contact name
  businessName?: string | null;
  companyNumber?: string | null;
  email?: string | null;
  emailConsent?: boolean;
  anonymous?: boolean;
  // Company billing details (REQ-038, donor_type='company' only); null for individuals.
  billingAddress?: string | null;
  billingPostcode?: string | null;
}

// A row ready to INSERT into donations (snake_case columns). created_at is left to
// the column default, so this stays pure/clock-free.
export interface DonationRow {
  donor_id: number;
  declaration_id: number | null;
  mode: (typeof MODES)[number];
  plan: string | null;
  amount_pence: number;
  currency: string;
  gift_aid: boolean;
  gasds_eligible: boolean;
  payment_channel: (typeof PAYMENT_CHANNELS)[number];
  claim_status: ClaimStatus;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_subscription_id: string | null;
  stripe_charge_id: string | null;
}

// Claim eligibility (REQ-037). Company donations are never claimable (REQ-053).
// An individual gift is claimable (eligible) only with Gift Aid opted in AND an
// active declaration covering it AND not fully refunded. Batched/claimed are set
// later by the claim pipeline (REQ-052), not here.
export function deriveClaimStatus(input: {
  donorType: DonorType;
  giftAid: boolean;
  hasDeclaration: boolean;
  fullyRefunded?: boolean;
}): ClaimStatus {
  if (input.donorType === "company") return "not_eligible";
  if (input.fullyRefunded) return "not_eligible";
  return input.giftAid && input.hasDeclaration ? "eligible" : "not_eligible";
}

// Build the donations row from a validated input + the donor FK. Pure: normalises
// currency to upper case and forces Gift Aid off / declaration null for company
// donors (they can never be claimed), then derives claim_status accordingly.
export function buildDonationRow(input: DonationInput, donorId: number): DonationRow {
  const isCompany = input.donorType === "company";
  const giftAid = isCompany ? false : input.giftAid;
  const declarationId = isCompany ? null : input.declarationId;
  return {
    donor_id: donorId,
    declaration_id: declarationId,
    mode: input.mode,
    plan: input.plan,
    amount_pence: input.amountPence,
    currency: input.currency.toUpperCase(),
    gift_aid: giftAid,
    // A company gift is never GASDS-eligible (nor Gift-Aid claimable); otherwise carry the
    // flag the mapper computed (isGasdsEligibleAmount already rules out any Gift-Aided gift).
    gasds_eligible: isCompany ? false : input.gasdsEligible,
    payment_channel: input.paymentChannel,
    claim_status: deriveClaimStatus({
      donorType: input.donorType,
      giftAid,
      hasDeclaration: declarationId !== null,
    }),
    stripe_session_id: input.stripeSessionId,
    stripe_payment_intent_id: input.stripePaymentIntentId,
    stripe_subscription_id: input.stripeSubscriptionId,
    stripe_charge_id: input.stripeChargeId,
  };
}

// Why a donation may NOT enter a claim batch, or null if it may. Pure decision (no
// pool/clock) — the transactional assignment in src/db/donations.ts reads the row and
// calls this before writing. Two rules enforce REQ-037: a donation must currently be
// `eligible` (the claim invariant — company/undeclared/refunded gifts are already
// not_eligible via deriveClaimStatus), AND it must not already be in a batch. The
// non-null claim_batch_id is checked FIRST, so a re-assignment is always reported as
// already_batched (the one-batch-per-donation guard) rather than not_eligible.
export type BatchBlockReason = "already_batched" | "not_eligible";

export function batchAssignmentBlock(current: {
  claimStatus: ClaimStatus;
  claimBatchId: number | null;
}): BatchBlockReason | null {
  if (current.claimBatchId !== null) return "already_batched";
  if (current.claimStatus !== "eligible") return "not_eligible";
  return null;
}

// REQ-039: an anonymous donor is pulled through to payment but is NEVER shown on the
// public donors page. This pure predicate captures that invariant on the one model, so
// the rule is testable here; the donors-page rendering that consumes it is REQ-047 and
// out of scope. A donor is publicly listable only when they did not opt to be anonymous.
export function isPubliclyListable(donor: { anonymous?: boolean }): boolean {
  return donor.anonymous !== true;
}

// The public supporters wall (TASK-071/REQ-035) groups donation-sourced donors into
// three display tiers. Ascending order — the order the page renders and the tier
// headings the supporters markup uses.
export const SUPPORTER_TIERS = ["bronze", "silver", "gold"] as const;
export type SupporterTier = (typeof SUPPORTER_TIERS)[number];

// Derive a supporter's tier from their donation amount, reusing the give-monthly tier
// thresholds (donate.html: bronze £10, silver £25, gold £50, platinum £100 — in pence).
// The public wall has three display tiers, so a platinum-level gift (≥ £50) sits in the
// top Gold band alongside gold. Pure.
export function supporterTierForAmount(amountPence: number): SupporterTier {
  if (amountPence >= 5000) return "gold";
  if (amountPence >= 2500) return "silver";
  return "bronze";
}

// The public display name: a company (or any donor carrying a business name) is listed
// by its business name; an individual by their full name. Mirrors the acceptance rule
// "business_name when donor_type is company (or businessName is set), otherwise full_name".
export function supporterDisplayName(donor: {
  donorType: DonorType;
  fullName: string;
  businessName?: string | null;
}): string {
  return donor.donorType === "company" || donor.businessName
    ? (donor.businessName ?? donor.fullName)
    : donor.fullName;
}

// A raw donor row (one per non-anonymous donor, carrying their largest gift) the DB read
// hands to the grouper.
export interface SupporterSourceRow {
  donorType: DonorType;
  fullName: string;
  businessName?: string | null;
  anonymous?: boolean;
  amountPence: number;
}

// A rendered supporter entry.
export interface PublicSupporter {
  name: string;
  kind: "person" | "organisation";
}

// Group raw donor rows into the three display tiers (TASK-071). Drops anonymous donors
// via isPubliclyListable (they are NEVER shown), derives each tier from the donor's
// amount and the person/organisation kind from donor_type, and sorts each tier
// alphabetically by display name. Pure — DB-free-testable; the SQL read lives in
// donations.ts and the HTML render in src/routes/site.ts.
export function groupPublicSupporters(
  rows: SupporterSourceRow[],
): Record<SupporterTier, PublicSupporter[]> {
  const tiers: Record<SupporterTier, PublicSupporter[]> = { bronze: [], silver: [], gold: [] };
  for (const row of rows) {
    if (!isPubliclyListable(row)) continue;
    tiers[supporterTierForAmount(row.amountPence)].push({
      name: supporterDisplayName(row),
      kind: row.donorType === "company" ? "organisation" : "person",
    });
  }
  for (const tier of SUPPORTER_TIERS) {
    tiers[tier].sort((a, b) => a.name.localeCompare(b.name));
  }
  return tiers;
}
