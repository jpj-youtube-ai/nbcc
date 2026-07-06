import { z } from "zod";
import { MODES } from "../db/donations-model";

// Pure, DB-free HMRC Gift Aid donor-benefit cap logic (REQ-045). NO pool/config/clock —
// importing this file touches nothing external, so it is unit-tested DB-free like
// src/db/donations-model.ts and src/declarations/wording.ts. The transactional writer that
// persists donation_benefits rows and flips donations.benefit_cap_breached lives in
// src/db/donations.ts (recordDonationBenefits); this module only decides values + breach.

// HMRC's donor-benefit limit on the ANNUALISED donation amount (a regular monthly gift is
// annualised ×12 before the test applies — see annualisePence). Since 6 April 2019 this is the
// single "relevant value test": there is no longer a three-tier / flat-£25 band. The cap is
//   25% of the first £100  +  5% of everything above £100,  capped at £2,500 in total.
// So a £100 gift caps at £25; a £1,200/yr (Platinum) gift caps at £25 + 5% of £1,100 = £80.
// A gift breaches the cap when the (annualised) total benefit value exceeds that cap. All money is
// in integer pence, matching the DB columns.
export const FIRST_BAND_MAX_PENCE = 10_000; // £100 — the 25% band ceiling
export const FIRST_BAND_RATE = 0.25; // 25% of the first £100
export const ABOVE_BAND_RATE = 0.05; // 5% of everything above £100
export const AGGREGATE_MAX_CAP_PENCE = 250_000; // £2,500 total cap

const donationPenceSchema = z.number().int().nonnegative();

// The maximum benefit value (pence) a donation of the given ANNUALISED size may carry before Gift
// Aid is lost, per the relevant value test. The two-band sum floors to whole pence (a fractional
// penny never widens what is allowed), then the £2,500 aggregate cap applies.
export function benefitCapPence(annualisedDonationPence: number): number {
  const donation = donationPenceSchema.parse(annualisedDonationPence);
  const firstBand = Math.min(donation, FIRST_BAND_MAX_PENCE);
  const aboveBand = Math.max(0, donation - FIRST_BAND_MAX_PENCE);
  const raw = Math.floor(firstBand * FIRST_BAND_RATE + aboveBand * ABOVE_BAND_RATE);
  return Math.min(raw, AGGREGATE_MAX_CAP_PENCE);
}

// The breach decision, mirroring deriveClaimStatus in donations-model.ts: a validated
// input shape, a pure boolean out. Both values are ANNUALISED (the caller annualises the
// donation AND the benefit total the same way) so the bands compare like with like.
export const benefitCapInputSchema = z.object({
  annualisedDonationPence: z.number().int().nonnegative(),
  benefitValuePence: z.number().int().nonnegative(),
});
export type BenefitCapInput = z.infer<typeof benefitCapInputSchema>;

export function deriveBenefitCapBreach(input: BenefitCapInput): boolean {
  const { annualisedDonationPence, benefitValuePence } = benefitCapInputSchema.parse(input);
  return benefitValuePence > benefitCapPence(annualisedDonationPence);
}

// A regular monthly gift is annualised ×12 before the bands apply; a one-off stands as
// its single value. Used for BOTH the donation amount and the benefit total so they are
// compared on the same yearly basis.
export type Mode = (typeof MODES)[number];
export function annualisePence(mode: Mode, pence: number): number {
  return mode === "monthly" ? pence * 12 : pence;
}

// The named recognition perks seeded by the benefit-tracking migration
// (1783003547726). These are low-/no-value acknowledgements (a name on a page, a
// thank-you) that HMRC disregards, so they are ALWAYS recorded at £0 regardless of any
// admin-entered value (REQ-045).
export const RECOGNITION_PERKS = [
  "name-on-page",
  "impact update",
  "social thank-you",
  "digital badge",
  "certificate",
] as const;
export type RecognitionPerk = (typeof RECOGNITION_PERKS)[number];

const RECOGNITION_PERK_SET: ReadonlySet<string> = new Set(RECOGNITION_PERKS);

export function isRecognitionPerk(name: string): boolean {
  return RECOGNITION_PERK_SET.has(name);
}

// A benefit awarded against a donation (admin/webhook input). name identifies the
// benefit_type so recognition perks can be forced to £0; benefitTypeId is the FK the row
// stores; valuePence is the admin-entered value (ignored for a recognition perk).
export const benefitAwardSchema = z.object({
  benefitTypeId: z.number().int().positive(),
  name: z.string().min(1),
  valuePence: z.number().int().nonnegative(),
});
export type BenefitAward = z.infer<typeof benefitAwardSchema>;

// The value a benefit is actually recorded at: £0 for a named recognition perk, else the
// admin-entered value. Pure, so the transactional writer stays a thin persistence layer.
export function recordedBenefitValuePence(benefit: { name: string; valuePence: number }): number {
  return isRecognitionPerk(benefit.name) ? 0 : benefit.valuePence;
}
