import { z } from "zod";

// Pure, DB-free Corporation Tax receipt content builder for a COMPANY donation (REQ-038 /
// REQ-053). An incorporated company's gift is never Gift Aided; instead the company deducts it
// from its taxable profits as a qualifying charitable donation (Corporation Tax relief), which
// needs a receipt from the charity. Like src/donors/company.ts this touches nothing external —
// no pool/config/clock (it formats an already-known donation date, never `now()`) — so it is
// unit-tested in isolation. The fixed statement text is held here as an immutable source of
// truth, mirroring the verbatim wording in src/declarations/wording.ts. The later wiring into a
// send (an email/PDF) is out of scope — this only builds the content, like the pure email-content
// builders in src/db/stripe-webhook-model.ts.

// NBCC's identity — the verbatim charity name + the OSCR (Scottish charity regulator)
// registration number, an immutable source of truth (as with the HMRC wording).
export const CHARITY_NAME = "Night Before Christmas Campaign";
export const CHARITY_SHORT_NAME = "NBCC";
export const OSCR_NUMBER = "SC047995";

// The two fixed statements a Corporation Tax receipt must carry, verbatim (immutable):
//  1. it is a GENUINE donation with nothing of value given in return (a qualifying charitable
//     donation gets no benefit back — a benefit would disqualify the relief and is flagged
//     for the trustees instead, see classifyCompanyGift);
//  2. NBCC has NOT and WILL NOT claim Gift Aid on it (a company gift is relieved via
//     Corporation Tax, never Gift Aid — the two must never both apply).
export const GENUINE_DONATION_STATEMENT =
  "This is a genuine donation and " +
  CHARITY_SHORT_NAME +
  " has given nothing of value in return for it.";
export const NO_GIFT_AID_STATEMENT =
  CHARITY_SHORT_NAME + " has not claimed and will not claim Gift Aid on this donation.";

// The captured receipt inputs. amountPence is the gift in integer pence; donationDate is the
// gift's date (a Date, or an ISO string) — formatted, never the current time.
export const receiptInputSchema = z.object({
  legalName: z.string().trim().min(1),
  amountPence: z.number().int().positive(),
  currency: z.string().trim().min(1).default("GBP"),
  donationDate: z.union([z.date(), z.string().min(1)]),
});

export type ReceiptInput = z.input<typeof receiptInputSchema>;

export interface CorporationTaxReceipt {
  text: string;
  html: string;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Corporation Tax receipt: invalid donation date");
  }
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  return `${dd}/${mm}/${yyyy}`;
}

// A plain money amount: "£50.00" for GBP, else "50.00 USD" (amount is pence / 100, two places).
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

// Build the Corporation Tax receipt content for a company donation. Returns both a plain-text
// and an HTML rendering, each carrying NBCC's name, the OSCR registration number, the amount +
// date, and the two verbatim statements (genuine donation / no Gift Aid). Pure — no clock, no
// eligibility re-derivation; the caller (via classifyCompanyGift) ensures nothing of value was
// given in return before issuing a receipt.
export function buildCorporationTaxReceipt(input: ReceiptInput): CorporationTaxReceipt {
  const { legalName, amountPence, currency, donationDate } = receiptInputSchema.parse(input);
  const amount = formatAmount(amountPence, currency);
  const date = formatDate(donationDate);
  const title = `${CHARITY_SHORT_NAME} donation receipt for Corporation Tax purposes`;

  const text =
    `${title}\n\n` +
    `${CHARITY_NAME} (${CHARITY_SHORT_NAME})\n` +
    `Registered Scottish charity, OSCR number ${OSCR_NUMBER}\n\n` +
    `Received with thanks from ${legalName}: a donation of ${amount} on ${date}.\n\n` +
    `${GENUINE_DONATION_STATEMENT}\n` +
    `${NO_GIFT_AID_STATEMENT}\n\n` +
    `Please keep this receipt to support your company's claim for Corporation Tax relief on ` +
    `qualifying charitable donations.`;

  const html =
    `<section class="ct-receipt">` +
    `<h1>${escapeHtml(title)}</h1>` +
    `<p><strong>${escapeHtml(CHARITY_NAME)} (${CHARITY_SHORT_NAME})</strong><br />` +
    `Registered Scottish charity, OSCR number ${OSCR_NUMBER}</p>` +
    `<p>Received with thanks from ${escapeHtml(legalName)}: a donation of ${escapeHtml(amount)} on ${date}.</p>` +
    `<p>${escapeHtml(GENUINE_DONATION_STATEMENT)}</p>` +
    `<p>${escapeHtml(NO_GIFT_AID_STATEMENT)}</p>` +
    `<p>Please keep this receipt to support your company's claim for Corporation Tax relief on ` +
    `qualifying charitable donations.</p>` +
    `</section>`;

  return { text, html };
}

// The action for a company refund (REQ-063/TASK-095): 'void' the whole Corporation Tax receipt on
// a full refund, or issue a 'correct'ed one for a partial refund. Matches src/claims/refund.ts.
export type CompanyRefundAction = "void" | "correct";

// Build the void/correction notice content for a COMPANY refund, reusing NBCC's identity + the
// money/date formatting. Pure (no clock — donationDate is the gift's date). A 'void' notice states
// the receipt is cancelled (full refund); a 'correct' notice states the corrected retained amount.
export function buildCompanyRefundNotice(input: {
  legalName: string;
  action: CompanyRefundAction;
  originalAmountPence: number;
  refundedPence: number;
  currency: string;
  donationDate: Date | string;
}): CorporationTaxReceipt {
  const { legalName, action, originalAmountPence, refundedPence, currency, donationDate } = input;
  const original = formatAmount(originalAmountPence, currency);
  const refunded = formatAmount(refundedPence, currency);
  const retained = formatAmount(Math.max(0, originalAmountPence - refundedPence), currency);
  const date = formatDate(donationDate);
  const title =
    action === "void"
      ? `${CHARITY_SHORT_NAME} donation receipt VOIDED for Corporation Tax purposes`
      : `${CHARITY_SHORT_NAME} donation receipt CORRECTED for Corporation Tax purposes`;
  const body =
    action === "void"
      ? `The donation of ${original} on ${date} from ${legalName} was refunded in full, so its ` +
        `Corporation Tax receipt is VOID. Please do not claim Corporation Tax relief on it.`
      : `The donation of ${original} on ${date} from ${legalName} was partly refunded (${refunded}). ` +
        `The corrected, retained donation is ${retained}; claim Corporation Tax relief on that amount only.`;

  const text =
    `${title}\n\n` +
    `${CHARITY_NAME} (${CHARITY_SHORT_NAME})\n` +
    `Registered Scottish charity, OSCR number ${OSCR_NUMBER}\n\n` +
    `${body}\n`;
  const html =
    `<section class="ct-receipt ct-receipt-refund">` +
    `<h1>${escapeHtml(title)}</h1>` +
    `<p><strong>${escapeHtml(CHARITY_NAME)} (${CHARITY_SHORT_NAME})</strong><br />` +
    `Registered Scottish charity, OSCR number ${OSCR_NUMBER}</p>` +
    `<p>${escapeHtml(body)}</p>` +
    `</section>`;
  return { text, html };
}

// The receipt guard (REQ-053). A qualifying charitable donation must be a genuine gift with
// NOTHING of value given in return — if the company received a benefit/consideration, it is NOT
// a plain donation and must NOT get a receipt; it is flagged for the trustees to assess
// (benefit rules, potential trading income). Returns a distinct outcome so the caller issues a
// receipt only for a clean gift.
export type CompanyGiftOutcome = "receipt" | "flag_for_trustees";

export function classifyCompanyGift(input: { considerationGiven: boolean }): CompanyGiftOutcome {
  return input.considerationGiven ? "flag_for_trustees" : "receipt";
}
