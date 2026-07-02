import { z } from "zod";

// Pure, DB-free Gift Aid Small Donations Scheme (GASDS) logic (REQ-058). NO pool/config/
// clock — importing this file touches nothing external, so it is unit-tested DB-free like
// src/benefits/caps.ts and src/db/donations-model.ts. GASDS lets a charity claim a Gift-Aid-
// style top-up on SMALL cash/contactless donations for which it holds NO Gift Aid declaration
// (e.g. an in-person card-present tap). This module only decides eligibility + the pool
// limit; the code that sets donations.gasds_eligible on ingestion and the claim pipeline that
// reads it are later tasks.

const pencePence = z.number().int().nonnegative();

// The GASDS individual small-donation ceiling: £30 (HMRC). A gift above this is not a small
// donation and must go the Gift Aid route instead.
export const GASDS_SMALL_DONATION_MAX_PENCE = 3_000; // £30

// Whether a single donation is claimable under GASDS. GASDS applies ONLY to a small gift for
// which the charity has no Gift Aid declaration and did not claim Gift Aid — otherwise the
// gift is (or should be) a Gift Aid claim, and the same gift can never be claimed under both.
// So a gift is GASDS-eligible only when it is £30 or less AND carries no declaration AND is
// not Gift-Aided. (The one-off nature of an eligible gift is enforced by the caller — GASDS
// is for small cash/contactless gifts, not standing Gift Aid subscriptions.)
export function isGasdsEligibleAmount(
  amountPence: number,
  context: { hasDeclaration: boolean; giftAid: boolean },
): boolean {
  const amount = pencePence.parse(amountPence);
  if (context.hasDeclaration || context.giftAid) return false;
  return amount > 0 && amount <= GASDS_SMALL_DONATION_MAX_PENCE;
}

// The three GASDS caps on the small-donations pool a charity may claim on in a tax year:
//   • an £8,000 annual small-donations ceiling,
//   • a £2,000 top-up-cap component,
//   • a ceiling of ten times the Gift Aid claimed in the same year.
export const GASDS_ANNUAL_CEILING_PENCE = 800_000; // £8,000
export const GASDS_TOP_UP_CAP_PENCE = 200_000; // £2,000
export const GASDS_GIFT_AID_MULTIPLE = 10; // 10× the Gift Aid claimed this year

export const gasdsPoolInputSchema = z.object({
  smallDonationsClaimedPenceThisYear: z.number().int().nonnegative(),
  giftAidClaimedPenceThisYear: z.number().int().nonnegative(),
});
export type GasdsPoolInput = z.infer<typeof gasdsPoolInputSchema>;

// The remaining GASDS small-donations headroom (pence) this tax year — the binding (lowest)
// of the three caps, minus what has already been claimed, never negative.
//
// ASSUMPTION — needs NBCC finance sign-off. HMRC's actual GASDS rules interrelate these
// figures (the £2,000 top-up is 25% of the £8,000 ceiling; the 10× rule is a matching
// requirement on donations, not the top-up), and the source wording for this task was garbled
// ("GAseparately within its limits"). Pending clarification we treat the three figures as
// THREE INDEPENDENT CEILINGS on the pool and return the minimum remaining — the safest
// (most conservative) reading, since it can only under-claim, never over-claim. Revisit once
// finance confirms the intended relationship.
export function gasdsPoolLimitPence(input: GasdsPoolInput): number {
  const { smallDonationsClaimedPenceThisYear, giftAidClaimedPenceThisYear } =
    gasdsPoolInputSchema.parse(input);
  const ceilings = [
    GASDS_ANNUAL_CEILING_PENCE,
    GASDS_TOP_UP_CAP_PENCE,
    GASDS_GIFT_AID_MULTIPLE * giftAidClaimedPenceThisYear,
  ];
  const bindingCeiling = Math.min(...ceilings);
  return Math.max(0, bindingCeiling - smallDonationsClaimedPenceThisYear);
}
