import { z } from "zod";
import { CHARITY_SHORT_NAME, REGISTRATION_TEXT, REGISTRATION_HTML } from "../legal/registration";

// Pure, DB-free content builder for the post-payment donation-confirmation email (REQ-060 · TASK-098,
// extending TASK-070). Mirrors src/donors/receipt.ts (buildCorporationTaxReceipt): no
// pool/config/clock, so it is unit-tested DB-free. The webhook (post-commit, best-effort) builds the
// content here and hands it to sendDonationConfirmation in src/clients/email.ts. It reflects ONLY
// what the donor actually did — a Gift Aid line only when Gift Aid was opted in, manage/cancel
// instructions only for a monthly (recurring) gift — and invents NO new legal wording (the verbatim
// HMRC statement lives in src/declarations/wording.ts and is bound at declaration time, not here).

// The charity short name now lives in the single source of truth src/legal/registration.ts;
// re-exported so existing importers keep resolving it from here.
export { CHARITY_SHORT_NAME };

// The Gift Aid confirmation line — a plain acknowledgement that Gift Aid was added, NOT the HMRC
// declaration statement. Only included when the donation actually opted into Gift Aid.
export const GIFT_AID_CONFIRMATION_LINE =
  "You added Gift Aid to your donation, so NBCC can reclaim 25% from HMRC at no extra cost to you. " +
  "Thank you for that extra kindness.";
// The enduring clause appended for a MONTHLY gift-aided gift (a monthly declaration is enduring, so
// it covers ongoing gifts) — still an acknowledgement, not new legal wording.
export const GIFT_AID_MONTHLY_CLAUSE =
  " This covers your ongoing monthly donations for as long as your declaration stands.";

// Manage/cancel instructions for a MONTHLY gift — reusing the verbatim REQ-026 reassurance copy from
// donate.html (there is no self-serve portal yet, REQ-061, to deep-link to, so this is the contact
// route). Only included for a monthly gift.
export const MANAGE_CANCEL_LINE =
  "Your monthly donation stays entirely in your hands. You can change or cancel it whenever you like, " +
  "and your Direct Debit is protected by the Direct Debit Guarantee. If anything ever comes up, " +
  "Jaimie Wakefield will gladly help, at giving@nbcc.scot or on 01292 811 015.";

// A warm, non-definitive closing line (Code of Fundraising Practice: "helps", never "£X provides Y").
// Woven into every confirmation so the receipt still reads clear but leaves the donor with the mission.
export const DONATION_IMPACT_LINE =
  "Kindness like yours helps NBCC bring comfort, dignity and a moment of joy to children, young " +
  "people and vulnerable adults across South West Scotland, at Christmas and all year round.";

export const confirmationInputSchema = z.object({
  fullName: z.string().trim().min(1),
  amountPence: z.number().int().positive(),
  currency: z.string().trim().min(1).default("GBP"),
  giftAid: z.boolean(),
  mode: z.enum(["once", "monthly"]),
  // Receipt details (TASK-203): a per-gift reference (NBCC-000123, from the donation id) and the
  // payment date, both optional so existing callers are unaffected. When present they render as a
  // labelled receipt line, so our confirmation email stands in for the Stripe receipt.
  reference: z.string().trim().min(1).optional(),
  donationDate: z.union([z.date(), z.string().min(1)]).optional(),
});
export type ConfirmationInput = z.input<typeof confirmationInputSchema>;

export interface DonationConfirmationContent {
  text: string;
  html: string;
}

function formatAmount(amountPence: number, currency: string): string {
  const decimal = (amountPence / 100).toFixed(2);
  return currency.toUpperCase() === "GBP" ? `£${decimal}` : `${decimal} ${currency.toUpperCase()}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The donor-facing receipt reference (TASK-203): the donation's own id as a tidy, zero-padded code
// (NBCC-000123) that a donor can quote and staff paste straight into the admin donation search.
// Pure — no clock/DB. Ids longer than the pad width are kept in full, never truncated.
export function donationReference(id: number): string {
  return `NBCC-${String(id).padStart(6, "0")}`;
}

// Build the confirmation email content. The thank-you always appears; the Gift Aid line only when
// Gift Aid was opted in (with the enduring clause for a monthly gift); the manage/cancel line only
// for a monthly gift. A one-off / non-Gift-Aid gift simply omits the parts that don't apply.
export function buildDonationConfirmation(input: ConfirmationInput): DonationConfirmationContent {
  const { fullName, amountPence, currency, giftAid, mode, reference, donationDate } =
    confirmationInputSchema.parse(input);
  const amount = formatAmount(amountPence, currency);
  const monthly = mode === "monthly";

  const thanks = monthly
    ? `Thank you, ${fullName}. Your monthly donation of ${amount} to ${CHARITY_SHORT_NAME} is all set up, ` +
      `and we are so grateful to have you with us. We will email you each time a monthly donation is taken.`
    : `Thank you, ${fullName}. Your donation of ${amount} to ${CHARITY_SHORT_NAME} has been received, ` +
      `and it truly matters.`;

  const paragraphs: string[] = [thanks];
  // Receipt details (TASK-203): reference and/or payment date, so our email doubles as the receipt
  // now that Stripe's own receipt email is off. Only the parts we were given are shown.
  const details: string[] = [];
  if (reference) details.push(`Reference: ${reference}`);
  if (donationDate) details.push(`Payment date: ${formatDate(donationDate)}`);
  if (details.length > 0) paragraphs.push(details.join(". ") + ".");
  if (giftAid) {
    paragraphs.push(GIFT_AID_CONFIRMATION_LINE + (monthly ? GIFT_AID_MONTHLY_CLAUSE : ""));
  }
  if (monthly) {
    paragraphs.push(MANAGE_CANCEL_LINE);
  }
  // A warm, non-definitive closing so every receipt still leaves the donor with the mission.
  paragraphs.push(DONATION_IMPACT_LINE);

  const text = paragraphs.join("\n\n") + "\n\n" + REGISTRATION_TEXT + "\n";
  const html =
    `<section class="donation-confirmation">` +
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    REGISTRATION_HTML +
    `</section>`;
  return { text, html };
}

// Format a refund date as DD/MM/YYYY (UTC components — no clock, no timezone drift), matching the
// receipt/export date format.
function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("refund confirmation: invalid refund date");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  return `${dd}/${mm}/${yyyy}`;
}

export const refundConfirmationInputSchema = z.object({
  fullName: z.string().trim().min(1),
  refundedPence: z.number().int().positive(),
  currency: z.string().trim().min(1).default("GBP"),
  refundDate: z.union([z.date(), z.string().min(1)]),
  full: z.boolean(), // a full refund vs a partial one
});
export type RefundConfirmationInput = z.input<typeof refundConfirmationInputSchema>;

// Build the refund-confirmation email content for an INDIVIDUAL donor (REQ-063 · TASK-099). Pure —
// no clock (the refund date is passed in). States the refunded amount + date; a full refund says the
// gift is cancelled, a partial one says the rest of the gift stands.
export function buildRefundConfirmation(input: RefundConfirmationInput): DonationConfirmationContent {
  const { fullName, refundedPence, currency, refundDate, full } = refundConfirmationInputSchema.parse(input);
  const amount = formatAmount(refundedPence, currency);
  const date = formatDate(refundDate);
  const line = full
    ? `Thank you, ${fullName}. Your donation to ${CHARITY_SHORT_NAME} has been refunded in full, ${amount} on ${date}. ` +
      `We are grateful you thought of us, and you would be welcome back any time.`
    : `Thank you, ${fullName}. We have refunded ${amount} of your donation to ${CHARITY_SHORT_NAME} on ${date}, ` +
      `and the rest of your donation still stands. Thank you for your kindness.`;
  const text = line + "\n\n" + REGISTRATION_TEXT + "\n";
  const html = `<section class="refund-confirmation"><p>${escapeHtml(line)}</p>${REGISTRATION_HTML}</section>`;
  return { text, html };
}
