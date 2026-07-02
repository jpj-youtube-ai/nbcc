import { z } from "zod";
import { declarationFieldsBase, refineDeclarationFields } from "./fields";

// The pure, DB-free partnership Gift Aid share model (REQ-051). A partnership donation is
// not covered by the single donations.declaration_id FK used for individuals/companies;
// instead it collects ONE Gift Aid declaration per partner, each carrying that partner's
// sharePence of the gift, and those shares must sum EXACTLY to the donation total. No
// pool/config/clock, so it is unit-tested DB-free like src/declarations/fields.ts. The
// join table these validated partners persist through is migration
// 1783015422184_partnership-shares (donation_partner_shares); this only validates them.

// A partner's captured input: a full Gift Aid declaration (same fields + rules as an
// individual, via the shared base + refinements) plus that partner's share of the gift.
// sharePence is a positive integer in pence — a partner with no share is not a partner.
export const partnerShareSchema = refineDeclarationFields(
  declarationFieldsBase.extend({
    sharePence: z.number().int().positive(),
  }),
);

export type PartnerShare = z.infer<typeof partnerShareSchema>;

// Thrown when a set of partner shares is not a valid partnership split: an empty list, a
// partner whose declaration fields are invalid, or shares that do not sum EXACTLY to the
// donation total (both over- and under-sums). A typed error so callers can distinguish it.
export class PartnerShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerShareError";
  }
}

// Validate that `partners` is a well-formed partnership split of a donation of
// `totalAmountPence`: at least one partner, every partner a valid declaration+share, and
// the shares summing EXACTLY to the total. Returns the parsed partners on success; throws
// a typed PartnerShareError otherwise. Pure — no DB, no clock.
export function validatePartnerShares(
  partners: unknown[],
  totalAmountPence: number,
): PartnerShare[] {
  if (!Array.isArray(partners) || partners.length === 0) {
    throw new PartnerShareError("a partnership donation needs at least one partner");
  }

  const parsed: PartnerShare[] = partners.map((partner, i) => {
    const result = partnerShareSchema.safeParse(partner);
    if (!result.success) {
      throw new PartnerShareError(`partner ${i} has an invalid Gift Aid declaration or share`);
    }
    return result.data;
  });

  const sum = parsed.reduce((acc, p) => acc + p.sharePence, 0);
  if (sum !== totalAmountPence) {
    throw new PartnerShareError(
      `partner shares (${sum}p) must sum exactly to the donation total (${totalAmountPence}p)`,
    );
  }

  return parsed;
}
