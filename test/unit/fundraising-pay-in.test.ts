import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// TASK-501: "Pay in what you collected". The organiser pays in cash or sponsor money by card from
// their private area, through the same Stripe checkout as every gift. It is tied to their
// fundraiser and marked as paid in by the organiser: on the meter like any paid online gift, never
// on the wall, and never with Gift Aid (it is not their own gift). The donate page's checkout must
// not change at all. Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "",
    NODE_ENV: "test",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import { buildPayInSessionParams, payInSchema, postCheckoutSession, PAY_IN_MIN_PENCE, PAY_IN_MAX_PENCE } from "../../src/routes/api";
import { fundraiserGiftFromCheckoutSession, donationFromCheckoutSession, confirmationEmailFor } from "../../src/db/stripe-webhook-model";
import { buildDonationConfirmation, GIFT_AID_CONFIRMATION_LINE } from "../../src/donors/confirmation";
import { DEFAULT_CARD_FEE } from "../../src/ball/pricing";

const input = {
  fundraiserId: 7,
  amountPence: 12550,
  coverFee: false,
  name: "Sam Sample",
  email: "sam@example.com",
  manageUrl: "https://nbcc.test/fundraise/manage",
};

describe("the pay in checkout", () => {
  const params = buildPayInSessionParams(input, DEFAULT_CARD_FEE);

  it("is a one off payment of the amount, tied to the fundraiser and marked as paid in by the organiser", () => {
    expect(params.mode).toBe("payment");
    expect(params.line_items?.[0].price_data?.unit_amount).toBe(12550);
    expect(params.metadata).toMatchObject({
      mode: "once",
      fundraiserId: "7",
      paidInByOrganiser: "true",
      fullName: "Sam Sample",
      email: "sam@example.com",
      emailConsent: "false",
      anonymous: "true",
      showName: "false",
      showAmount: "false",
      supporterMessage: "",
    });
    expect(params.customer_email).toBe("sam@example.com");
  });

  it("never carries Gift Aid", () => {
    expect(params.metadata?.giftAid).toBe("false");
    for (const key of Object.keys(params.metadata ?? {})) expect(key).not.toMatch(/^(decl[A-Z]|giftAidWording|partners)/);
  });

  it("comes back to the private area, with a thank you, or as it was on a cancel", () => {
    expect(params.success_url).toBe("https://nbcc.test/fundraise/manage?paid=1");
    expect(params.cancel_url).toBe("https://nbcc.test/fundraise/manage");
    expect(params.ui_mode).toBeUndefined();
  });

  it("adds the card fee as its own line only when they choose to cover it", () => {
    expect(params.line_items).toHaveLength(1);
    const covered = buildPayInSessionParams({ ...input, coverFee: true }, DEFAULT_CARD_FEE);
    expect(covered.line_items).toHaveLength(2);
    expect(Number(covered.metadata?.feeCoverPence)).toBeGreaterThan(0);
  });
});

describe("what a pay in request may say", () => {
  it("is £1 to £10,000, in whole pence", () => {
    expect(PAY_IN_MIN_PENCE).toBe(100);
    expect(PAY_IN_MAX_PENCE).toBe(1_000_000);
    expect(payInSchema.safeParse({ amountPence: 100 }).success).toBe(true);
    expect(payInSchema.safeParse({ amountPence: 1_000_000 }).success).toBe(true);
    expect(payInSchema.safeParse({ amountPence: 99 }).success).toBe(false);
    expect(payInSchema.safeParse({ amountPence: 1_000_001 }).success).toBe(false);
    expect(payInSchema.safeParse({ amountPence: 12.5 }).success).toBe(false);
    expect(payInSchema.safeParse({}).success).toBe(false);
  });

  it("drops Gift Aid and anything else sent with it", () => {
    const r = payInSchema.safeParse({ amountPence: 500, giftAid: true, declaration: { firstName: "x" }, coverFee: true });
    expect(r.success && r.data).toEqual({ amountPence: 500, coverFee: true });
  });
});

describe("the donate page's checkout", () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/test_1", client_secret: "s" });
  });

  it("cannot mark a gift as paid in by an organiser, whatever it is sent", async () => {
    const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postCheckoutSession({ body: { mode: "once", plan: null, amount: 2500, giftAid: false, email: "alex@example.com", fullName: "Alex Example", fundraiserId: 7, paidInByOrganiser: true } } as any, res as any);
    expect(res.statusCode).toBe(200);
    const md = create.mock.calls[0][0].metadata;
    expect(md.paidInByOrganiser).toBeUndefined();
    expect(md.fundraiserId).toBe("7");
  });
});

const session = (metadata: Record<string, string>): Stripe.Checkout.Session =>
  ({
    id: "cs_test_pay_in",
    object: "checkout.session",
    amount_total: 12550,
    currency: "gbp",
    payment_status: "paid",
    payment_intent: "pi_test_pay_in",
    subscription: null,
    customer_details: { name: "Sam Sample", email: "sam@example.com" },
    metadata: { mode: "once", plan: "", giftAid: "false", donorType: "individual", fullName: "Sam Sample", email: "sam@example.com", ...metadata },
  }) as unknown as Stripe.Checkout.Session;

describe("the webhook reading a pay in", () => {
  it("reads it as paid in by the organiser, with nothing for the wall", () => {
    expect(fundraiserGiftFromCheckoutSession(session({ fundraiserId: "7", paidInByOrganiser: "true", supporterMessage: "x" }))).toEqual({
      fundraiserId: 7,
      message: null,
      showName: false,
      showAmount: false,
      paidIn: true,
    });
  });

  it("leaves a gift from a supporter exactly as it was", () => {
    expect(fundraiserGiftFromCheckoutSession(session({ fundraiserId: "7", supporterMessage: "Go Sam" }))).toEqual({
      fundraiserId: 7,
      message: "Go Sam",
      showName: true,
      showAmount: true,
    });
  });

  it("records no Gift Aid on the donation", () => {
    expect(donationFromCheckoutSession(session({ fundraiserId: "7", paidInByOrganiser: "true" })).donation.giftAid).toBe(false);
  });
});

describe("the email after a pay in", () => {
  it("thanks them for paying in, never as their own gift, and never claims Gift Aid", () => {
    const email = confirmationEmailFor(
      { email: "sam@example.com", fullName: "Sam Sample" },
      { amountPence: 12550, currency: "gbp", giftAid: false, mode: "once" },
      { reference: "NBCC-000055", paidIn: true },
    );
    expect(email?.paidIn).toBe(true);
    const built = buildDonationConfirmation({ fullName: "Sam Sample", amountPence: 12550, currency: "gbp", giftAid: true, mode: "once", paidIn: true });
    expect(built.text).toContain("Thank you, Sam Sample. The £125.50 you paid in for your fundraiser has reached NBCC.");
    expect(built.text).toContain("Please pass on our thanks to everyone who gave.");
    expect(built.text).not.toContain("Your donation of");
    expect(built.text).not.toContain(GIFT_AID_CONFIRMATION_LINE);
  });

  it("leaves the donate page's receipt word for word as it was", () => {
    const before = buildDonationConfirmation({ fullName: "Alex Example", amountPence: 2500, currency: "gbp", giftAid: true, mode: "once" });
    expect(before.text).toContain("Thank you, Alex Example. Your donation of £25.00 to NBCC has been received, and it truly matters.");
    expect(before.text).toContain(GIFT_AID_CONFIRMATION_LINE);
    expect(confirmationEmailFor({ email: "a@example.com", fullName: "A" }, { amountPence: 1, currency: "gbp", giftAid: false, mode: "once" })).not.toHaveProperty("paidIn");
  });
});
