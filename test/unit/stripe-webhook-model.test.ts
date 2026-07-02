import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import {
  giftAidFromMetadata,
  donationFromCheckoutSession,
  declarationFromCheckoutSession,
  recurringChargeFromInvoice,
  recurringDonationInput,
  refundedPenceFromCharge,
  refundedPenceFromDispute,
  claimStatusAfterRefund,
} from "../../src/db/stripe-webhook-model";
import { buildDonationRow } from "../../src/db/donations-model";
import { buildDeclarationRow } from "../../src/declarations/fields";

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
    // Post-REQ-039, the donor's contact details are captured by the front-end and
    // stamped on metadata (consent-based); the webhook maps THESE onto the donor row.
    metadata: {
      mode: "once",
      plan: "",
      giftAid: "true",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      emailConsent: "true",
      anonymous: "false",
    },
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

describe("donationFromCheckoutSession — contact capture (REQ-039)", () => {
  it("maps the captured full name from metadata onto the donor", () => {
    const { donor } = donationFromCheckoutSession(
      session({
        metadata: { mode: "once", plan: "", giftAid: "false", fullName: "Captured Name" },
        customer_details: { name: "Stripe Name", email: "stripe@example.com" },
      }),
    );
    expect(donor.fullName).toBe("Captured Name");
  });

  it("falls back to the Stripe cardholder name when metadata omits the full name", () => {
    const { donor } = donationFromCheckoutSession(
      session({
        metadata: { mode: "once", plan: "", giftAid: "false" },
        customer_details: { name: "Stripe Name", email: "stripe@example.com" },
      }),
    );
    expect(donor.fullName).toBe("Stripe Name");
  });

  it("stores the email and marks consent ONLY when the donor opted in", () => {
    const { donor } = donationFromCheckoutSession(
      session({
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "false",
          email: "captured@example.com",
          emailConsent: "true",
        },
        customer_details: { name: "Ada", email: "stripe@example.com" },
      }),
    );
    // From OUR consent-based capture, never Stripe's separate receipt email.
    expect(donor.email).toBe("captured@example.com");
    expect(donor.emailConsent).toBe(true);
  });

  it("suppresses the email and consent when consent was NOT given (platform sends nothing)", () => {
    const { donor } = donationFromCheckoutSession(
      session({
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "false",
          email: "captured@example.com",
          emailConsent: "false",
        },
        customer_details: { name: "Ada", email: "stripe@example.com" },
      }),
    );
    expect(donor.email).toBeNull();
    expect(donor.emailConsent).toBe(false);
  });

  it("persists the anonymous flag from metadata", () => {
    const { donor } = donationFromCheckoutSession(
      session({ metadata: { mode: "once", plan: "", giftAid: "false", anonymous: "true", fullName: "Ada" } }),
    );
    expect(donor.anonymous).toBe(true);
  });

  it("defaults anonymous to false when metadata omits it", () => {
    const { donor } = donationFromCheckoutSession(
      session({ metadata: { mode: "once", plan: "", giftAid: "false", fullName: "Ada" } }),
    );
    expect(donor.anonymous).toBe(false);
  });
});

describe("donationFromCheckoutSession — donor-type routing (REQ-038)", () => {
  it("maps metadata.donorType='company' and metadata.businessName onto the donation + donor", () => {
    const { donor, donation } = donationFromCheckoutSession(
      session({
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "false",
          donorType: "company",
          businessName: "Acme Ltd",
        },
        customer_details: { name: "Ada Contact", email: "ada@example.com" },
      }),
    );
    expect(donation.donorType).toBe("company");
    expect(donor.businessName).toBe("Acme Ltd");
  });

  it("defaults to an individual donor when metadata omits donorType (no-JS base contract)", () => {
    const { donation } = donationFromCheckoutSession(
      session({ metadata: { mode: "once", plan: "", giftAid: "true" } }),
    );
    expect(donation.donorType).toBe("individual");
  });

  it("leaves businessName null when metadata carries no business name", () => {
    const { donor } = donationFromCheckoutSession(
      session({ metadata: { mode: "once", plan: "", giftAid: "true", donorType: "individual" } }),
    );
    expect(donor.businessName ?? null).toBeNull();
  });

  it("persists a company donation as gift_aid=false / not_eligible through buildDonationRow (REQ-036/REQ-053)", () => {
    // The end-to-end mapping the webhook performs: metadata → donation input →
    // donations row. donor_type is the single field driving Gift Aid suppression;
    // no second store. Even though this company session carries giftAid metadata,
    // buildDonationRow forces the flag off and derives not_eligible.
    const { donation } = donationFromCheckoutSession(
      session({
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "true", // a stray flag on a company session must not survive
          donorType: "company",
          businessName: "Acme Ltd",
        },
      }),
    );
    const row = buildDonationRow(donation, 42);
    expect(row.gift_aid).toBe(false);
    expect(row.declaration_id).toBeNull();
    expect(row.claim_status).toBe("not_eligible");
  });
});

describe("declarationFromCheckoutSession — Gift Aid declaration mapping (REQ-043)", () => {
  const declMeta = (over: Record<string, string> = {}) => ({
    mode: "once",
    plan: "",
    giftAid: "true",
    donorType: "individual",
    declarationScope: "this_donation",
    giftAidWordingVersion: "hmrc-single-2024-01",
    giftAidWording: "I want to Gift Aid my donation. I am a UK taxpayer ...",
    declTitle: "Dr",
    declFirstName: "Ada",
    declLastName: "Lovelace",
    declHouseNameNumber: "12",
    declAddress: "Analytical Avenue, London",
    declPostcode: "SW1A 1AA",
    declNonUk: "false",
    ...over,
  });

  it("builds a declaration write from the stamped metadata, with the wording + scope", () => {
    const w = declarationFromCheckoutSession(session({ metadata: declMeta() }));
    expect(w).not.toBeNull();
    expect(w?.fields.firstName).toBe("Ada");
    expect(w?.fields.lastName).toBe("Lovelace");
    expect(w?.fields.houseNameNumber).toBe("12");
    expect(w?.fields.postcode).toBe("SW1A 1AA");
    expect(w?.fields.nonUk).toBe(false);
    expect(w?.scope).toBe("this_donation");
    expect(w?.wording.wording_version).toBe("hmrc-single-2024-01");
    expect(w?.confirmedTaxpayer).toBe(true); // opting into Gift Aid confirms UK taxpayer status
  });

  it("maps an enduring monthly declarationScope onto the all-donations scope column (REQ-044)", () => {
    const w = declarationFromCheckoutSession(
      session({ metadata: declMeta({ mode: "monthly", declarationScope: "enduring" }) }),
    );
    expect(w?.scope).toBe("all_donations");
  });

  it("returns null when Gift Aid was not opted in (no declaration is made)", () => {
    expect(declarationFromCheckoutSession(session({ metadata: declMeta({ giftAid: "false" }) }))).toBeNull();
  });

  it("returns null when no declaration was captured (no decl fields stamped)", () => {
    expect(
      declarationFromCheckoutSession(
        session({ metadata: { mode: "once", plan: "", giftAid: "true", donorType: "individual" } }),
      ),
    ).toBeNull();
  });

  it("exempts a non-UK declaration from the postcode", () => {
    const w = declarationFromCheckoutSession(
      session({ metadata: declMeta({ declNonUk: "true", declPostcode: "" }) }),
    );
    expect(w?.fields.nonUk).toBe(true);
    expect(w?.fields.postcode ?? null).toBeNull();
  });

  it("feeds buildDeclarationRow to produce a donor-linked declarations row", () => {
    const w = declarationFromCheckoutSession(session({ metadata: declMeta() }));
    const row = buildDeclarationRow(w!.fields, {
      donorId: 42,
      scope: w!.scope,
      wording: w!.wording,
      confirmedTaxpayer: w!.confirmedTaxpayer,
    });
    expect(row.donor_id).toBe(42);
    expect(row.first_name).toBe("Ada");
    expect(row.postcode).toBe("SW1A 1AA");
    expect(row.scope).toBe("this_donation");
    expect(row.wording_version).toBe("hmrc-single-2024-01");
    expect(row.confirmed_taxpayer).toBe(true);
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

  it("records the ACTUAL charged amount (amount_paid) for a prorated invoice, not a tier preset (REQ-055)", () => {
    // A mid-subscription up/downgrade bills an odd prorated amount unlike any round
    // tier preset; the charge must carry that exact amount so Gift Aid claims the true value.
    const rec = recurringChargeFromInvoice(
      invoice({ billing_reason: "subscription_update", amount_paid: 1234 }),
    );
    expect(rec?.amountPence).toBe(1234);
  });

  it("does NOT skip a prorated (subscription_update) or renewal (subscription_cycle) invoice", () => {
    expect(
      recurringChargeFromInvoice(invoice({ billing_reason: "subscription_update" })),
    ).not.toBeNull();
    expect(
      recurringChargeFromInvoice(invoice({ billing_reason: "subscription_cycle" })),
    ).not.toBeNull();
  });

  it("skips ONLY the first (subscription_create) invoice — already captured at checkout", () => {
    expect(
      recurringChargeFromInvoice(invoice({ billing_reason: "subscription_create" })),
    ).toBeNull();
  });
});

describe("recurringDonationInput (REQ-055)", () => {
  // The invoice-derived charge (amount is the invoice's amount_paid) …
  const rec = {
    subscriptionId: "sub_test_1",
    amountPence: 1234, // a prorated amount, unlike any round tier preset
    currency: "GBP",
    paymentIntentId: "pi_test_2",
    chargeId: "ch_test_2",
  };
  // … combined with the Gift Aid / declaration carried from the ORIGINAL donation
  // (found via the subscription id in the processor).
  const parent = {
    donorType: "individual" as const,
    plan: "gold" as const,
    giftAid: true,
    declarationId: 7,
  };

  it("records the actual charged amount and carries Gift Aid + declaration from the original", () => {
    const donation = recurringDonationInput(rec, parent);
    expect(donation.amountPence).toBe(1234); // the invoice's amount_paid, NOT the tier preset
    expect(donation.giftAid).toBe(true); // carried from the original declaration
    expect(donation.declarationId).toBe(7); // the same declaration governs the prorated charge
    expect(donation.mode).toBe("monthly");
    expect(donation.plan).toBe("gold");
    expect(donation.stripeSubscriptionId).toBe("sub_test_1");
    expect(donation.stripePaymentIntentId).toBe("pi_test_2");
    expect(donation.stripeChargeId).toBe("ch_test_2");
  });

  it("carries gift_aid=false through when the original declaration had no Gift Aid", () => {
    expect(recurringDonationInput(rec, { ...parent, giftAid: false }).giftAid).toBe(false);
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
