import { donationInputSchema, type DonationInput, type DonorInput } from "../db/donations-model";
import type { DeclarationWrite } from "../db/stripe-webhook-model";
import { declarationFieldsSchema, type DeclarationFields } from "../declarations/fields";
import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { classifyCompanyGift } from "../donors/receipt";
import type { InvoiceStatus, PayerKind } from "./model";

// What a payment on an invoice becomes: the pure decisions behind settleInvoice (src/db/invoices.ts),
// the one path card payments (the Stripe webhook) and bank transfers (staff pressing Mark paid) share.
//
//   - A payment on a waiting invoice pays it. A payment on an invoice already paid is a second
//     payment: money taken is always recorded, so it becomes its own donation and staff are told. A
//     payment on a cancelled invoice is recorded too, and the invoice shows it was paid after cancelling.
//   - A person is an individual donor, and their saved Gift Aid declaration (if it is complete) goes
//     with the gift, but never with a second payment, which is usually a mistake to refund (as a pledge
//     paid twice carries no Gift Aid, src/db/stripe-webhook.ts). A business or a group is a company donor, so the gift is never claimed for Gift Aid,
//     whatever was stored.
//   - The receipt: a person the usual donation receipt; a business the usual Corporation Tax receipt,
//     or, when we give them something in return, a flag for the trustees instead; a group a plain one.

export type SettleKind = "paid" | "paid-twice" | "paid-after-cancel";

export function settleKind(status: InvoiceStatus): SettleKind {
  if (status === "paid") return "paid-twice";
  if (status === "cancelled") return "paid-after-cancel";
  return "paid";
}

export interface InvoiceForDonation {
  payerKind: PayerKind;
  contactName: string;
  orgName: string | null;
  email: string;
  address: string | null;
  postcode: string | null;
  considerationGiven: boolean | null;
  amountPence: number;
  giftAid: unknown;
}

/** A person's saved Gift Aid declaration, only when it is complete; never for a business or a group. */
export function giftAidFrom(inv: Pick<InvoiceForDonation, "payerKind" | "giftAid">): DeclarationFields | null {
  if (inv.payerKind !== "person" || !inv.giftAid) return null;
  const parsed = declarationFieldsSchema.safeParse(inv.giftAid);
  return parsed.success ? parsed.data : null;
}

export function donationWrite(
  inv: InvoiceForDonation,
  pay: { sessionId: string | null; paymentIntentId: string | null },
  kind: SettleKind = "paid",
): { donor: DonorInput; donation: DonationInput; declaration: DeclarationWrite | undefined } {
  const person = inv.payerKind === "person";
  const fields = kind === "paid-twice" ? null : giftAidFrom(inv);
  const donor: DonorInput = person
    ? { fullName: inv.contactName, email: inv.email, emailConsent: false }
    : {
        fullName: inv.contactName,
        businessName: inv.orgName,
        email: inv.email,
        emailConsent: false,
        billingAddress: inv.address,
        billingPostcode: inv.postcode,
      };
  const donation = donationInputSchema.parse({
    donorType: person ? "individual" : "company",
    mode: "once",
    amountPence: inv.amountPence,
    giftAid: Boolean(fields),
    paymentChannel: "online",
    paymentStatus: "paid",
    gasdsEligible: false,
    stripeSessionId: pay.sessionId,
    stripePaymentIntentId: pay.paymentIntentId,
  });
  const declaration: DeclarationWrite | undefined = fields
    ? { fields, scope: "this_donation", wording: SINGLE_DONATION_WORDING, confirmedTaxpayer: true }
    : undefined;
  return { donor, donation, declaration };
}

export type ReceiptPlan = "person" | "business" | "trustees" | "group";

export function receiptPlan(inv: Pick<InvoiceForDonation, "payerKind" | "considerationGiven">): ReceiptPlan {
  if (inv.payerKind === "person") return "person";
  if (inv.payerKind === "group") return "group";
  return classifyCompanyGift({ considerationGiven: inv.considerationGiven === true }) === "receipt" ? "business" : "trustees";
}
