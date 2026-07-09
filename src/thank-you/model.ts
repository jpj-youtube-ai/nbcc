// TASK-161 (REQ-069): pure, DB-free model for the admin thank-you letters feature.
// These helpers + the Zod input schema are unit-tested; the transactional write
// layer lives in src/db/thank-you.ts and is exercised via BDD (CLAUDE.md rule 5).
import { z } from "zod";

// A thank-you is for a monetary gift or a gift in kind. A money gift carries an
// amount (pence); an in-kind gift carries a free-text description of what was given.
export const thankYouInputSchema = z
  .object({
    // NULL for a giver who isn't a donor row (e.g. a company/church gift in kind).
    donorId: z.number().int().positive().nullable(),
    thankYouName: z.string().trim().min(1), // "Thank you, <name>." — person or organisation
    addressedTo: z.string().trim().min(1), // "Dear <name>," — the contact person
    recipientEmail: z.string().trim().email(),
    giftType: z.enum(["money", "in_kind"]),
    giftAmountPence: z.number().int().positive().nullable(),
    giftInKind: z.string().trim().min(1).nullable(),
    giftAided: z.boolean(),
    personalMessage: z.string().trim().min(1).nullable(),
    signedByName: z.string().trim().min(1),
    sentBy: z.string().trim().min(1), // the logged-in admin (audit)
  })
  .refine((v) => (v.giftType === "money" ? v.giftAmountPence != null : v.giftInKind != null), {
    message: "A money gift needs an amount; an in-kind gift needs a description of what was given.",
  });

export type ThankYouInput = z.infer<typeof thankYouInputSchema>;

// HMRC adds 25% of a Gift-Aided donation. Rounded to the nearest penny.
export function giftAidUpliftPence(amountPence: number): number {
  return Math.round(amountPence * 0.25);
}

// Money is stored as integer pence everywhere; format for display (matches the
// inline formatter used in receipts/confirmations — no thousands grouping).
export function formatGiftAmount(amountPence: number, currency = "GBP"): string {
  const decimal = (amountPence / 100).toFixed(2);
  return currency.toUpperCase() === "GBP" ? `£${decimal}` : `${decimal} ${currency.toUpperCase()}`;
}

// One-line summary of the gift, used for the audit-trail entry and the Sent history.
export function giftSummary(
  input: Pick<ThankYouInput, "giftType" | "giftAmountPence" | "giftInKind" | "giftAided">,
): string {
  if (input.giftType === "money") {
    const amount = formatGiftAmount(input.giftAmountPence ?? 0);
    return input.giftAided ? `${amount} (Gift Aided)` : amount;
  }
  return `Gift in kind: ${input.giftInKind ?? ""}`.trim();
}
