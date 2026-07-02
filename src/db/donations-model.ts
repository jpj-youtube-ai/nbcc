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
