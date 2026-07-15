import { z } from "zod";
import { bandForMonthlyAmount } from "../donors/fulfilment";
import { containsBlockedWord } from "../donors/display-name-filter";

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
// Payment settlement state (REQ-065/TASK-090): a card gift is 'paid' at checkout; a BACS gift is
// 'pending' until Stripe confirms the mandate ('paid') or reports failure ('failed').
export const PAYMENT_STATUSES = ["pending", "paid", "failed"] as const;

export type DonorType = (typeof DONOR_TYPES)[number];
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

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
    // Settlement state (REQ-065/TASK-090): defaults to 'paid' (card / in-person), so existing
    // callers are unchanged; a BACS checkout maps Stripe's 'unpaid' onto 'pending'.
    paymentStatus: z.enum(PAYMENT_STATUSES).default("paid"),
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
  // TASK-224: the individual supporters-wall opt-in + optional public display name (donors
  // .list_on_supporters / credit_name). Default false/null; the wall falls back to full_name.
  listOnSupporters?: boolean;
  creditName?: string | null;
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
  payment_status: PaymentStatus;
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
  // Settlement gate (REQ-065/TASK-090): only a settled ('paid') gift is ever claimable. A BACS
  // mandate awaiting confirmation ('pending') or a failed one ('failed') is never eligible,
  // regardless of Gift Aid + declaration. Defaults to 'paid' so existing callers are unchanged.
  paymentStatus?: PaymentStatus;
}): ClaimStatus {
  if (input.donorType === "company") return "not_eligible";
  if (input.fullyRefunded) return "not_eligible";
  if (input.paymentStatus !== undefined && input.paymentStatus !== "paid") return "not_eligible";
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
    payment_status: input.paymentStatus,
    claim_status: deriveClaimStatus({
      donorType: input.donorType,
      giftAid,
      hasDeclaration: declarationId !== null,
      paymentStatus: input.paymentStatus,
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

// The public supporters wall (TASK-071/REQ-035; opt-in monthly 4-band rework TASK-223) groups
// donation-sourced supporters into four metal display bands. Ascending order — the order the page
// renders and the tier headings the supporters markup uses. The band set + thresholds are the
// business-supporter bands in src/donors/fulfilment.ts (bronze £10, silver £25, gold £50, platinum
// £100 per month); the wall reuses them so a monthly supporter's wall band matches their recognition
// band exactly.
export const SUPPORTER_TIERS = ["bronze", "silver", "gold", "platinum"] as const;
export type SupporterTier = (typeof SUPPORTER_TIERS)[number];

// TASK-240 (supporters-wall accuracy): grace window before an opt-in supporter whose monthly support
// has ENDED (every monthly subscription cancelled/lapsed) drops off the public wall. 30 days ~ one
// monthly billing cycle plus a buffer, and it clears Stripe's ~2-week dunning retry window, so a
// mid-cycle cancel does not vanish instantly. Applied in the listPublicSupporters SQL; grandfathered
// donors (TASK-228) are exempt. Tune here if a longer/shorter window is wanted.
export const SUPPORTER_GRACE_DAYS = 30;

// The GRANDFATHER path's banding (TASK-228). TASK-223 made the wall opt-in + monthly-only; to keep
// everyone the OLD (pre-223) wall recognised, a grandfathered donor is banded by their MAX PAID amount
// across ANY frequency using the four metal thresholds but with NO £10/mo floor — so every donor the
// old wall showed (incl. small and one-off gifts) keeps a place. Reuses bandForMonthlyAmount's
// thresholds (>= £100 platinum, >= £50 gold, >= £25 silver) and floors the sub-£10 (else-null) case to
// bronze. Pure — a plain function on a number, like bandForMonthlyAmount / the former supporterTierForAmount.
export function bandForGrandfatheredAmount(pence: number): SupporterTier {
  return bandForMonthlyAmount(pence) ?? "bronze";
}

// The public display name for the pre-opt-in raw fallback: a company (or any donor carrying a business
// name) is listed by its business name; an individual by their full name. The opt-in custom name
// (credit_name) is layered on top of this in resolvePublicSupporter. Mirrors the original acceptance
// rule "business_name when donor_type is company (or businessName is set), otherwise full_name".
export function supporterDisplayName(donor: {
  donorType: DonorType;
  fullName: string;
  businessName?: string | null;
}): string {
  return donor.donorType === "company" || donor.businessName
    ? (donor.businessName ?? donor.fullName)
    : donor.fullName;
}

// A supporter is a BUSINESS on the wall when they are an incorporated company OR carry a non-empty
// business_name (a partnership / sole-trader-with-a-name donates under donor_type 'individual' WITH a
// business_name — see donationFromCheckoutSession). A business lists as an Organisation and consents
// through its business_supporter_fulfilment record; everyone else lists as an Individual and consents
// through the donors.list_on_supporters flag. One predicate so both call sites agree. Mirrors the
// isBusiness rule in fulfilmentBandFor.
function isBusinessSupporter(row: { donorType: DonorType; businessName?: string | null }): boolean {
  return row.donorType === "company" || (row.businessName ?? "").trim().length > 0;
}

// One raw supporter row the DB read hands to the grouper. It carries everything the pure opt-in +
// banding rules need, so the "who is shown, under what name, in which band" decision is DB-free
// testable (the SQL read in donations.ts only gathers these fields + the greatest PAID MONTHLY gift).
export interface SupporterSourceRow {
  donorType: DonorType;
  fullName: string;
  businessName?: string | null;
  // Display-suppression flags (never shown when either is set): the donor's own anonymity preference
  // and the admin "hide from wall" override.
  anonymous?: boolean;
  hiddenFromSupporters?: boolean;
  // The greatest PAID MONTHLY gift in pence, or null when the donor has no paid monthly donation. A
  // one-off-only donor is null → excluded from the opt-in monthly path (but may still be grandfathered);
  // a monthly gift under £10/mo bands to null → excluded from the opt-in path.
  monthlyAmountPence: number | null;
  // TASK-228 grandfather flag (donors.grandfathered_on_supporters): a pre-223 snapshot donor kept on the
  // wall WITHOUT the TASK-223 opt-in. When true (and not anonymous/hidden), the donor is shown even with
  // no monthly gift, banded by maxPaidAmountPence. Defaults false (a new donor must opt in).
  grandfathered?: boolean;
  // The greatest PAID gift across ANY frequency in pence — the grandfather path's band input — or null
  // when the donor has no paid donation. Distinct from monthlyAmountPence (monthly-only, opt-in path).
  maxPaidAmountPence?: number | null;
  // Individual consent (donors table): opted in + the individual's chosen public display name.
  individualListOptIn?: boolean;
  individualCreditName?: string | null;
  // Business consent (business_supporter_fulfilment): opted in (list_on_supporters AND the thank-you
  // form was submitted, i.e. captured_at IS NOT NULL) + the business's chosen public display name.
  businessListOptIn?: boolean;
  businessCreditName?: string | null;
  // TASK-240 (supporters-wall accuracy): true when the donor's monthly support has ENDED — every one of
  // their monthly subscriptions is cancelled/lapsed AND the most recent end is beyond the grace window
  // (SUPPORTER_GRACE_DAYS, applied in the listPublicSupporters SQL). It gates the OPT-IN monthly path
  // only: an ended opt-in supporter drops off, while a grandfathered donor (TASK-228) is kept regardless.
  // Defaults false (still current) when absent.
  monthlySupportEnded?: boolean;
}

// A rendered supporter entry.
export interface PublicSupporter {
  name: string;
  kind: "person" | "organisation";
}

// A resolved wall entry: the display name, the person/organisation kind, and the band it belongs in.
interface ResolvedSupporter extends PublicSupporter {
  band: SupporterTier;
}

// Decide whether ONE raw row appears on the wall, and if so its final display name, kind and band.
// Suppression first (never shown when either holds): anonymous (REQ-039) or admin-hidden. Then a donor
// is shown when EITHER path qualifies, checked in precedence order:
//   1. OPT-IN MONTHLY (TASK-223): a paid monthly gift that bands (>= £10/mo) AND opted in on the right
//      channel — a business via its fulfilment record (list_on_supporters + captured), an individual via
//      donors.list_on_supporters. Banded by the MONTHLY amount. Takes PRECEDENCE, so a donor who is both
//      grandfathered and a qualifying opt-in monthly supporter is banded by their monthly gift.
//   2. GRANDFATHERED (TASK-228): a pre-223 snapshot donor kept on the wall WITHOUT opting in, banded by
//      their MAX PAID amount across ANY frequency (four metal thresholds, NO £10 floor) — so every donor
//      the OLD wall showed, incl. small and one-off gifts, keeps a place.
// The FINAL display name (credit_name if set, else business_name/full_name via supporterDisplayName)
// must not trip the bad-word filter (render-time safety net). Pure — the single source of truth both
// groupPublicSupporters and its tests use.
export function resolvePublicSupporter(row: SupporterSourceRow): ResolvedSupporter | null {
  if (!isPubliclyListable(row)) return null; // anonymous → never shown (REQ-039)
  if (row.hiddenFromSupporters) return null; // admin hide → never shown

  const business = isBusinessSupporter(row);
  const kind: "person" | "organisation" = business ? "organisation" : "person";
  // The channel-appropriate display name, shared by both paths: a business by its fulfilment credit_name
  // (else business name), an individual by donors.credit_name (else full name).
  const name = business
    ? (row.businessCreditName ?? "").trim() || supporterDisplayName(row)
    : (row.individualCreditName ?? "").trim() || row.fullName;

  // Path 1 — opt-in monthly (takes precedence). Only a paid monthly gift that bands AND an opt-in on the
  // matching channel qualifies; a monthly gift without the opt-in falls through to the grandfather check.
  // TASK-240: an opt-in supporter whose monthly support has ENDED beyond the grace window
  // (monthlySupportEnded) no longer qualifies here — they drop off unless the grandfather path keeps them.
  let band: SupporterTier | null = null;
  if (row.monthlyAmountPence != null && !row.monthlySupportEnded) {
    const monthlyBand = bandForMonthlyAmount(row.monthlyAmountPence);
    const optedIn = business ? !!row.businessListOptIn : !!row.individualListOptIn;
    if (monthlyBand && optedIn) band = monthlyBand;
  }

  // Path 2 — grandfathered: banded by the greatest PAID gift across any frequency, no £10 floor.
  if (band == null && row.grandfathered) {
    band = bandForGrandfatheredAmount(row.maxPaidAmountPence ?? 0);
  }

  if (band == null) return null; // neither a qualifying opt-in monthly supporter nor grandfathered
  if (containsBlockedWord(name)) return null; // render-time bad-word safety net
  return { name, kind, band };
}

// Group raw supporter rows into the four metal bands (TASK-223). Each row is resolved through
// resolvePublicSupporter (opt-in + banding + suppression + bad-word net); survivors are placed in
// their band and each band is sorted alphabetically by display name. Pure — DB-free-testable; the SQL
// read lives in donations.ts and the HTML render in src/routes/site.ts.
export function groupPublicSupporters(
  rows: SupporterSourceRow[],
): Record<SupporterTier, PublicSupporter[]> {
  const tiers: Record<SupporterTier, PublicSupporter[]> = {
    bronze: [],
    silver: [],
    gold: [],
    platinum: [],
  };
  for (const row of rows) {
    const resolved = resolvePublicSupporter(row);
    if (!resolved) continue;
    tiers[resolved.band].push({ name: resolved.name, kind: resolved.kind });
  }
  for (const tier of SUPPORTER_TIERS) {
    tiers[tier].sort((a, b) => a.name.localeCompare(b.name));
  }
  return tiers;
}
