import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  giftAidFromMetadata,
  donationFromCheckoutSession,
  recurringChargeFromInvoice,
  refundedPenceFromCharge,
  refundedPenceFromDispute,
  claimStatusAfterRefund,
} from "../../src/db/stripe-webhook-model";

// TASK-046 (REQ-036): the PURE event→record mapping for the single Stripe webhook
// handler. No pool/config/network — importing this touches only the pure donation
// model, so it is unit-tested DB-free per CLAUDE.md. The transactional persistence
// + idempotency lives in src/db/stripe-webhook.ts and is exercised by the BDD.

const session = (over: Record<string, unknown> = {}): Stripe.Checkout.Session =>
  ({
    id: "cs_test_1",
    object: "checkout.session",
    amount_total: 5000,
    currency: "gbp",
    mode: "payment",
    payment_intent: "pi_test_1",
    subscription: null,
    customer_details: { name: "Ada Lovelace", email: "ada@example.com" },
    metadata: { mode: "once", plan: "", giftAid: "true" },
    ...over,
  }) as unknown as Stripe.Checkout.Session;

describe("giftAidFromMetadata", () => {
  it("is true only for the literal string 'true' the checkout endpoint stamps", () => {
    expect(giftAidFromMetadata({ giftAid: "true" } as Stripe.Metadata)).toBe(true);
    expect(giftAidFromMetadata({ giftAid: "false" } as Stripe.Metadata)).toBe(false);
    expect(giftAidFromMetadata({} as Stripe.Metadata)).toBe(false);
    expect(giftAidFromMetadata(null)).toBe(false);
  });
});

describe("donationFromCheckoutSession", () => {
  it("maps a one-off gift-aided session, carrying gift_aid as a flag from metadata", () => {
    const { donor, donation } = donationFromCheckoutSession(session());
    expect(donation.donorType).toBe("individual");
    expect(donation.mode).toBe("once");
    expect(donation.amountPence).toBe(5000);
    expect(donation.currency).toBe("GBP");
    expect(donation.giftAid).toBe(true); // from metadata.giftAid === 'true'
    expect(donation.stripeSessionId).toBe("cs_test_1");
    expect(donation.stripePaymentIntentId).toBe("pi_test_1");
    expect(donation.stripeSubscriptionId).toBeNull();
    expect(donor.fullName).toBe("Ada Lovelace");
    expect(donor.email).toBe("ada@example.com");
    expect(donor.emailConsent).toBe(true);
  });

  it("carries gift_aid=false when metadata says so", () => {
    const { donation } = donationFromCheckoutSession(
      session({ metadata: { mode: "once", plan: "", giftAid: "false" } }),
    );
    expect(donation.giftAid).toBe(false);
  });

  it("maps a monthly subscription session (mode + plan + subscription id)", () => {
    const { donation } = donationFromCheckoutSession(
      session({
        mode: "subscription",
        payment_intent: null,
        subscription: "sub_test_1",
        metadata: { mode: "monthly", plan: "gold", giftAid: "true" },
      }),
    );
    expect(donation.mode).toBe("monthly");
    expect(donation.plan).toBe("gold");
    expect(donation.stripeSubscriptionId).toBe("sub_test_1");
    expect(donation.stripePaymentIntentId).toBeNull();
  });
});

describe("recurringChargeFromInvoice", () => {
  const invoice = (over: Record<string, unknown> = {}): Stripe.Invoice =>
    ({
      id: "in_test_1",
      object: "invoice",
      amount_paid: 2500,
      currency: "gbp",
      subscription: "sub_test_1",
      payment_intent: "pi_test_2",
      charge: "ch_test_2",
      billing_reason: "subscription_cycle",
      ...over,
    }) as unknown as Stripe.Invoice;

  it("maps a renewal invoice to a recurring charge against the same subscription", () => {
    const rec = recurringChargeFromInvoice(invoice());
    expect(rec).not.toBeNull();
    expect(rec?.subscriptionId).toBe("sub_test_1");
    expect(rec?.amountPence).toBe(2500);
    expect(rec?.paymentIntentId).toBe("pi_test_2");
    expect(rec?.chargeId).toBe("ch_test_2");
  });

  it("skips the first (subscription_create) invoice — already captured at checkout", () => {
    expect(recurringChargeFromInvoice(invoice({ billing_reason: "subscription_create" }))).toBeNull();
  });
});

describe("refund / dispute amount extraction", () => {
  it("reads the absolute amount_refunded off a charge (idempotent replay)", () => {
    expect(
      refundedPenceFromCharge({ amount_refunded: 5000 } as unknown as Stripe.Charge),
    ).toBe(5000);
  });

  it("reads the disputed amount off a dispute", () => {
    expect(refundedPenceFromDispute({ amount: 5000 } as unknown as Stripe.Dispute)).toBe(5000);
  });
});

describe("claimStatusAfterRefund (REQ-037)", () => {
  const claimable = {
    donorType: "individual" as const,
    giftAid: true,
    hasDeclaration: true,
    amountPence: 5000,
  };

  it("stays eligible on a partial refund of a claimable gift", () => {
    expect(claimStatusAfterRefund(claimable, 1000)).toBe("eligible");
  });

  it("becomes not_eligible once fully refunded", () => {
    expect(claimStatusAfterRefund(claimable, 5000)).toBe("not_eligible");
  });

  it("stays not_eligible for a company donation regardless of refund", () => {
    expect(
      claimStatusAfterRefund({ ...claimable, donorType: "company" }, 0),
    ).toBe("not_eligible");
  });
});
