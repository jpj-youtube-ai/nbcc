import { z } from "zod";

// Pure, DB-free content builder for the post-payment donation-confirmation email (REQ-060 · TASK-098,
// extending TASK-070). Mirrors src/donors/receipt.ts (buildCorporationTaxReceipt): no
// pool/config/clock, so it is unit-tested DB-free. The webhook (post-commit, best-effort) builds the
// content here and hands it to sendDonationConfirmation in src/clients/email.ts. It reflects ONLY
// what the donor actually did — a Gift Aid line only when Gift Aid was opted in, manage/cancel
// instructions only for a monthly (recurring) gift — and invents NO new legal wording (the verbatim
// HMRC statement lives in src/declarations/wording.ts and is bound at declaration time, not here).

export const CHARITY_SHORT_NAME = "NBCC";

// The Gift Aid confirmation line — a plain acknowledgement that Gift Aid was added, NOT the HMRC
// declaration statement. Only included when the donation actually opted into Gift Aid.
export const GIFT_AID_CONFIRMATION_LINE =
  "You added Gift Aid to your donation, so NBCC can reclaim 25% from HMRC at no extra cost to you.";
// The enduring clause appended for a MONTHLY gift-aided gift (a monthly declaration is enduring, so
// it covers ongoing gifts) — still an acknowledgement, not new legal wording.
export const GIFT_AID_MONTHLY_CLAUSE =
  " This covers your ongoing monthly gifts while your declaration stands.";

// Manage/cancel instructions for a MONTHLY gift — reusing the verbatim REQ-026 reassurance copy from
// donate.html (there is no self-serve portal yet, REQ-061, to deep-link to, so this is the contact
// route). Only included for a monthly gift.
export const MANAGE_CANCEL_LINE =
  "Managing your monthly gift: monthly donations can be changed or cancelled whenever you like, and " +
  "Direct Debits are protected by the Direct Debit Guarantee. Any problems, contact Jaimie Wakefield " +
  "at giving@nightbeforechristmas.co.uk or call 01292 811 015.";

export const confirmationInputSchema = z.object({
  fullName: z.string().trim().min(1),
  amountPence: z.number().int().positive(),
  currency: z.string().trim().min(1).default("GBP"),
  giftAid: z.boolean(),
  mode: z.enum(["once", "monthly"]),
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

// Build the confirmation email content. The thank-you always appears; the Gift Aid line only when
// Gift Aid was opted in (with the enduring clause for a monthly gift); the manage/cancel line only
// for a monthly gift. A one-off / non-Gift-Aid gift simply omits the parts that don't apply.
export function buildDonationConfirmation(input: ConfirmationInput): DonationConfirmationContent {
  const { fullName, amountPence, currency, giftAid, mode } = confirmationInputSchema.parse(input);
  const amount = formatAmount(amountPence, currency);
  const monthly = mode === "monthly";

  const thanks = monthly
    ? `Thank you ${fullName}, your monthly donation of ${amount} to ${CHARITY_SHORT_NAME} is set up. ` +
      `We will email you when each monthly gift is taken.`
    : `Thank you ${fullName}, your donation of ${amount} to ${CHARITY_SHORT_NAME} has been received.`;

  const paragraphs: string[] = [thanks];
  if (giftAid) {
    paragraphs.push(GIFT_AID_CONFIRMATION_LINE + (monthly ? GIFT_AID_MONTHLY_CLAUSE : ""));
  }
  if (monthly) {
    paragraphs.push(MANAGE_CANCEL_LINE);
  }

  const text = paragraphs.join("\n\n") + "\n";
  const html =
    `<section class="donation-confirmation">` +
    paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
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
    ? `Thank you ${fullName}. Your donation to ${CHARITY_SHORT_NAME} has been refunded in full: ${amount} on ${date}.`
    : `Thank you ${fullName}. A refund of ${amount} was made to your donation to ${CHARITY_SHORT_NAME} on ${date}; ` +
      `the rest of your gift still stands.`;
  const text = line + "\n";
  const html = `<section class="refund-confirmation"><p>${escapeHtml(line)}</p></section>`;
  return { text, html };
}
