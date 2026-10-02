import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

// TASK-502 changed what a gift on a fundraiser's page sends to Stripe and where it comes back to.
// Jaimie's rule is that Donate never breaks, so this pins a donate page gift's Stripe session, field
// for field, exactly as it was before (one off on Stripe's page and on ours, and monthly), and the
// receipt the webhook builds from it. Every name and address here is invented.

vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: vi.fn() } } }, stripeConfigured: true }));

import { buildSessionParams } from "../../src/routes/api";
import { confirmationEmailFromCheckoutSession } from "../../src/db/stripe-webhook-model";
import { DEFAULT_CARD_FEE } from "../../src/ball/pricing";

const once = {
  mode: "once" as const,
  plan: null,
  amount: 2500,
  giftAid: false,
  coverFee: false,
  uiMode: "hosted" as const,
  donorType: "individual" as const,
  fullName: "Alex Example",
  email: "alex@example.com",
  emailConsent: true,
};

const metadata = {
  mode: "once",
  plan: "",
  giftAid: "false",
  feeCoverPence: "0",
  donorType: "individual",
  businessName: "",
  fullName: "Alex Example",
  email: "alex@example.com",
  emailConsent: "true",
  anonymous: "false",
  ageConfirmed: "false",
  listOnSupporters: "false",
  creditName: "",
  declarationScope: "this_donation",
};

const RETURN = "https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}";
const oneOffLine = { quantity: 1, price_data: { currency: "gbp", unit_amount: 2500, product_data: { name: "Donation to NBCC" } } };

describe("a donate page gift's Stripe session", () => {
  it("is exactly as it was, one off, on Stripe's own page", () => {
    expect(buildSessionParams(once, DEFAULT_CARD_FEE)).toStrictEqual({
      payment_method_types: ["card", "bacs_debit"],
      metadata,
      customer_email: "alex@example.com",
      success_url: RETURN,
      cancel_url: "https://nbcc.test/donate",
      mode: "payment",
      line_items: [oneOffLine],
    });
  });

  it("is exactly as it was, one off, on our page", () => {
    expect(buildSessionParams({ ...once, uiMode: "embedded" }, DEFAULT_CARD_FEE)).toStrictEqual({
      payment_method_types: ["card", "bacs_debit"],
      metadata,
      customer_email: "alex@example.com",
      ui_mode: "embedded_page",
      return_url: RETURN,
      mode: "payment",
      line_items: [oneOffLine],
    });
  });

  it("is exactly as it was, monthly", () => {
    const params = buildSessionParams({ ...once, mode: "monthly", plan: "bronze", amount: 1000, ageConfirmed: true }, DEFAULT_CARD_FEE);
    expect(params).toStrictEqual({
      payment_method_types: ["card", "bacs_debit"],
      metadata: { ...metadata, mode: "monthly", plan: "bronze", ageConfirmed: "true", declarationScope: "enduring" },
      customer_email: "alex@example.com",
      success_url: "https://nbcc.test/donate/thank-you?mode=monthly&donor=individual&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://nbcc.test/donate",
      mode: "subscription",
      line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: 1000, recurring: { interval: "month" }, product_data: { name: "Monthly donation to NBCC" } } }],
    });
  });
});

describe("a donate page gift's receipt", () => {
  it("is exactly as it was", () => {
    const session = {
      id: "cs_test_donate",
      object: "checkout.session",
      amount_total: 2500,
      currency: "gbp",
      payment_status: "paid",
      payment_intent: "pi_test_donate",
      subscription: null,
      customer_details: { name: "Alex Example", email: "alex@example.com" },
      metadata: { ...metadata, giftAid: "true" },
    } as unknown as Stripe.Checkout.Session;
    expect(confirmationEmailFromCheckoutSession(session)).toStrictEqual({
      email: "alex@example.com",
      fullName: "Alex Example",
      amountPence: 2500,
      currency: "GBP",
      giftAid: true,
      mode: "once",
    });
  });
});
