import type Stripe from "stripe";
import {
  donationInputSchema,
  deriveClaimStatus,
  type DonationInput,
  type DonorInput,
  type DonorType,
  type ClaimStatus,
} from "./donations-model";

// PURE event→record mapping for the single Stripe webhook handler (REQ-036). No
// pool/config/network/clock — imports only the pure donation model, so it is
// unit-tested DB-free. The transactional persistence + event-id idempotency lives
// in ./stripe-webhook.ts. Stripe types are type-only imports (erased at runtime).

export interface DonationWrite {
  donor: DonorInput;
  donation: DonationInput;
}

// The REQ-029 checkout endpoint stamps metadata.giftAid as the string "true"/"false".
export function giftAidFromMetadata(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.giftAid === "true";
}

const asString = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" ? v.id : null;

// checkout.session.completed → the donation record. Gift Aid is carried as a FLAG
// (gift_aid boolean from metadata); the declaration relationship is captured later
// (REQ-040/043), so declaration_id is null and buildDonationRow derives the
// claim_status accordingly (a flagged-but-undeclared gift is not yet claimable).
export function donationFromCheckoutSession(session: Stripe.Checkout.Session): DonationWrite {
  const md = session.metadata ?? {};
  const mode = md.mode === "monthly" ? "monthly" : "once";
  const donation = donationInputSchema.parse({
    donorType: "individual", // the current REQ-029 donate flow; company flow is REQ-053
    mode,
    plan: md.plan ? md.plan : null,
    amountPence: session.amount_total ?? 0,
    currency: (session.currency ?? "gbp").toUpperCase(),
    giftAid: giftAidFromMetadata(session.metadata),
    declarationId: null,
    paymentChannel: "online",
    stripeSessionId: session.id,
    stripePaymentIntentId: asString(session.payment_intent),
    stripeSubscriptionId: asString(session.subscription),
    stripeChargeId: null,
  });
  const name = session.customer_details?.name ?? null;
  const email = session.customer_details?.email ?? null;
  return {
    donor: {
      fullName: name ?? "Anonymous donor",
      email,
      emailConsent: email != null,
      anonymous: name == null,
    },
    donation,
  };
}

export interface RecurringCharge {
  subscriptionId: string;
  amountPence: number;
  currency: string;
  paymentIntentId: string | null;
  chargeId: string | null;
}

// invoice.paid / invoice.payment_succeeded → a recurring monthly charge to record
// as a further donation against the SAME subscription/donor. The first invoice
// (billing_reason 'subscription_create') is skipped — it is already captured by
// checkout.session.completed, so recording it again would double-count.
export function recurringChargeFromInvoice(invoice: Stripe.Invoice): RecurringCharge | null {
  if (invoice.billing_reason === "subscription_create") return null;
  // Read the subscription/charge refs defensively: older Stripe API versions put
  // them as flat fields on the invoice, newer ones nest the subscription under
  // parent.subscription_details. A webhook delivers whichever the account is on.
  const inv = invoice as unknown as {
    subscription?: string | { id: string } | null;
    payment_intent?: string | { id: string } | null;
    charge?: string | { id: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  };
  const subscriptionId =
    asString(inv.subscription) ?? asString(inv.parent?.subscription_details?.subscription);
  if (!subscriptionId) return null;
  return {
    subscriptionId,
    amountPence: invoice.amount_paid ?? 0,
    currency: (invoice.currency ?? "gbp").toUpperCase(),
    paymentIntentId: asString(inv.payment_intent),
    chargeId: asString(inv.charge),
  };
}

// The Gift Aid / declaration context carried from the ORIGINAL donation on the
// subscription (found via the subscription id in the processor). A monthly gift's
// declaration governs every later charge on that subscription — including prorated
// up/downgrades — so it is inherited, never re-derived here (REQ-055/REQ-059).
export interface RecurringDonationParent {
  donorType: DonorType;
  plan: string | null;
  giftAid: boolean;
  declarationId: number | null;
}

// Assemble the donation input for a recurring OR prorated charge. The amount is the
// invoice's ACTUALLY-charged amount (rec.amountPence = invoice.amount_paid), NOT the
// plan's preset tier value — a mid-subscription up/downgrade bills a prorated amount,
// and Gift Aid is claimed on the true amount charged, needing no special handling
// (REQ-055). Gift Aid + declaration + plan come from the original declaration on the
// subscription; each charge becomes its own donation row against the same donor.
export function recurringDonationInput(
  rec: RecurringCharge,
  parent: RecurringDonationParent,
): DonationInput {
  return donationInputSchema.parse({
    donorType: parent.donorType,
    mode: "monthly",
    plan: parent.plan,
    amountPence: rec.amountPence,
    currency: rec.currency,
    giftAid: parent.giftAid,
    declarationId: parent.declarationId,
    paymentChannel: "online",
    stripeSubscriptionId: rec.subscriptionId,
    stripePaymentIntentId: rec.paymentIntentId,
    stripeChargeId: rec.chargeId,
  });
}

// charge.refunded carries the ABSOLUTE total refunded so far, so replaying the
// event is idempotent (we set, never increment).
export function refundedPenceFromCharge(charge: Stripe.Charge): number {
  return charge.amount_refunded ?? 0;
}

export function refundedPenceFromDispute(dispute: Stripe.Dispute): number {
  return dispute.amount ?? 0;
}

// Recompute claim_status when a donation is refunded/disputed: a fully-refunded
// gift is never claimable; otherwise eligibility is unchanged (still governed by
// donor type + Gift Aid + an active declaration — REQ-037).
export function claimStatusAfterRefund(
  existing: { donorType: DonorType; giftAid: boolean; hasDeclaration: boolean; amountPence: number },
  refundedPence: number,
): ClaimStatus {
  return deriveClaimStatus({
    donorType: existing.donorType,
    giftAid: existing.giftAid,
    hasDeclaration: existing.hasDeclaration,
    fullyRefunded: refundedPence >= existing.amountPence,
  });
}
