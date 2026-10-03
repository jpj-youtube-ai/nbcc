import { describe, it, expect, vi } from "vitest";

// Sponsor pledges: the Stripe session for paying a pledge. It is the SAME session a gift on the
// fundraiser's page makes (buildSessionParams in src/routes/api.ts), so the one webhook records the
// donation, links it to the fundraiser and writes the Gift Aid declaration exactly as it does for any
// gift, plus the pledge's id. Every name and address here is invented.

vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create: vi.fn() } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
    NODE_ENV: "test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { buildPledgeSessionParams, parsePayAmount } from "../../src/pledges/checkout";
import { pledgeDeclarationWording } from "../../src/pledges/model";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { declarationFromCheckoutSession, fundraiserGiftFromCheckoutSession, donationFromCheckoutSession } from "../../src/db/stripe-webhook-model";
import { pledgeFromSession, type PledgeRecord } from "../../src/db/pledges";

const NOW = new Date("2026-12-06T09:00:00Z");
const wording = pledgeDeclarationWording(1000);

const pledge = (over: Partial<PledgeRecord> = {}): PledgeRecord => ({
  id: 5,
  fundraiserId: 7,
  firstName: "Alex",
  surname: "Example",
  email: "alex@example.com",
  amountPence: 1000,
  message: "Go on Robin!",
  messageHidden: false,
  showName: true,
  showAmount: true,
  giftAid: true,
  status: "open",
  createdAt: "2026-11-01T10:00:00.000Z",
  payEmailClaimedAt: null,
  payEmailSentAt: null,
  reminderClaimedAt: null,
  reminderSentAt: null,
  paidAt: null,
  paidAmountPence: null,
  cashMarkedAt: null,
  cancelledAt: null,
  anonymisedAt: null,
  refunded: false,
  tokenNonce: "nonce-a",
  gaHouse: "12",
  gaAddress: "Example Street, Exampleton",
  gaPostcode: "KA1 1AA",
  gaNonUk: false,
  gaWordingVersion: wording.wording_version,
  gaWordingSnapshot: wording.wording_snapshot,
  gaDeclaredAt: "2026-11-01T10:00:00.000Z",
  donationId: null,
  ...over,
});

const build = (over: Partial<Parameters<typeof buildPledgeSessionParams>[0]> = {}) =>
  buildPledgeSessionParams(
    {
      pledge: pledge(),
      payPence: 1000,
      giftAid: true,
      coverFee: false,
      payUrl: "https://nbcc.test/pledge/pay?t=5.sig",
      fundraiserPage: "https://nbcc.test/fundraise/robins-santa-dash",
      ...over,
    },
    undefined,
    NOW,
  );

// What Stripe would send back to the webhook for this session.
const asSession = (params: ReturnType<typeof build>, total: number) =>
  ({ id: "cs_test_1", metadata: params.metadata, amount_total: total, currency: "gbp", mode: "payment", created: 1, payment_status: "paid" }) as never;

describe("the checkout for paying a pledge", () => {
  it("is a one off card payment of the amount, in pounds sterling", () => {
    const p = build();
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.line_items?.[0].price_data).toMatchObject({ currency: "gbp", unit_amount: 1000 });
    expect(p.customer_email).toBe("alex@example.com");
  });

  it("carries the pledge and its fundraiser, so the webhook links the donation and marks the pledge paid", () => {
    const p = build();
    expect(p.metadata).toMatchObject({ pledgeId: "5", fundraiserId: "7", mode: "once", donorType: "individual", fullName: "Alex Example" });
    expect(pledgeFromSession(asSession(p, 1000))).toEqual({ pledgeId: 5, paidPence: 1000, declaredAt: "2026-11-01T10:00:00.000Z" });
    expect(fundraiserGiftFromCheckoutSession(asSession(p, 1000))).toEqual({ fundraiserId: 7, message: "Go on Robin!", showName: true, showAmount: true });
  });

  it("carries the Gift Aid declaration made with the pledge, word for word, and when it was made", () => {
    const p = build();
    expect(p.metadata).toMatchObject({
      giftAid: "true",
      giftAidWordingVersion: wording.wording_version,
      giftAidWording: wording.wording_snapshot,
      pledgeDeclaredAt: "2026-11-01T10:00:00.000Z",
      declarationScope: "this_donation",
    });
    const decl = declarationFromCheckoutSession(asSession(p, 1000));
    expect(decl).toMatchObject({
      scope: "this_donation",
      confirmedTaxpayer: true,
      wording,
      fields: { firstName: "Alex", lastName: "Example", houseNameNumber: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA", nonUk: false },
    });
  });

  it("records the donation as gift aided, for the amount paid", () => {
    const { donation } = donationFromCheckoutSession(asSession(build(), 1000));
    expect(donation).toMatchObject({ amountPence: 1000, giftAid: true, mode: "once" });
  });

  it("when they pay a different amount, the declaration is the standard one they confirmed on the pay page", () => {
    const p = build({ payPence: 1500 });
    expect(p.line_items?.[0].price_data?.unit_amount).toBe(1500);
    expect(p.metadata).toMatchObject({ giftAidWordingVersion: SINGLE_DONATION_WORDING.wording_version, giftAidWording: SINGLE_DONATION_WORDING.wording_snapshot });
    // Still dated: the pledge's own declaration is kept on the pledge.
    expect(p.metadata?.pledgeDeclaredAt).toBe("2026-11-01T10:00:00.000Z");
  });

  it("carries no Gift Aid at all when they untick it on the pay page", () => {
    const p = build({ giftAid: false });
    expect(p.metadata?.giftAid).toBe("false");
    expect(p.metadata?.declFirstName).toBeUndefined();
    expect(p.metadata?.giftAidWording).toBeUndefined();
    expect(declarationFromCheckoutSession(asSession(p, 1000))).toBeNull();
  });

  it("can never add Gift Aid that was not declared with the pledge", () => {
    const p = build({
      pledge: pledge({ giftAid: false, gaHouse: null, gaAddress: null, gaPostcode: null, gaWordingSnapshot: null, gaWordingVersion: null, gaDeclaredAt: null }),
      giftAid: true,
    });
    expect(p.metadata?.giftAid).toBe("false");
    expect(declarationFromCheckoutSession(asSession(p, 1000))).toBeNull();
  });

  it("keeps the fee they offered to cover apart from the donation", () => {
    const p = build({ coverFee: true });
    expect(p.line_items?.length).toBe(2);
    const fee = Number(p.metadata?.feeCoverPence);
    expect(fee).toBeGreaterThan(0);
    expect(pledgeFromSession(asSession(p, 1000 + fee))).toMatchObject({ pledgeId: 5, paidPence: 1000 });
  });

  it("keeps a name they asked to keep off the page off it, and a message staff hid", () => {
    const p = build({ pledge: pledge({ showName: false, messageHidden: true }) });
    expect(p.metadata).toMatchObject({ showName: "false", anonymous: "true", supporterMessage: "" });
  });

  it("comes back to the fundraiser's page with a thank you, and a cancel goes back to the pay page", () => {
    const p = build();
    expect(p.success_url).toBe("https://nbcc.test/fundraise/robins-santa-dash?thanks=1&message=1&session_id={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.test/pledge/pay?t=5.sig");
  });

  it("closes after half an hour, so a payment left open cannot complete days later", () => {
    expect(build().expires_at).toBe(Math.floor(NOW.getTime() / 1000) + 31 * 60);
  });

  it("stays within Stripe's limits: 50 keys, 500 characters a value", () => {
    const md = build({ coverFee: true }).metadata ?? {};
    expect(Object.keys(md).length).toBeLessThanOrEqual(50);
    for (const [k, v] of Object.entries(md)) expect(String(v).length, k).toBeLessThanOrEqual(500);
  });
});

describe("the amount typed on the pay page", () => {
  // Jaimie, 2026-10-03: a sponsor may pay MORE than they pledged, never less. One who cannot pay
  // uses "I can't pay this after all" instead.
  it.each([
    ["10", 1000],
    ["12.50", 1250],
    [" 10 ", 1000],
    ["10.5", 1050],
    ["1,000", 100000],
    ["£15", 1500],
  ])("reads %s", (typed, pence) => {
    expect(parsePayAmount(typed, 1000)).toEqual({ pence });
  });

  it("never takes less than was pledged, and says what to do instead", () => {
    const words = "You pledged £10, so that is the least you can pay here. You can give more. If you can't pay it after all, use the link further down this page.";
    expect(parsePayAmount("9.99", 1000)).toEqual({ error: words });
    expect(parsePayAmount("2", 1000)).toEqual({ error: words });
    expect(parsePayAmount("12.49", 1250)).toEqual({ error: words.replace("£10", "£12.50") });
  });

  it.each([
    ["", "Give the amount in pounds, like 10 or 12.50."],
    ["ten", "Give the amount in pounds, like 10 or 12.50."],
    ["10.999", "Give the amount in pounds, like 10 or 12.50."],
    ["-5", "Give the amount in pounds, like 10 or 12.50."],
    ["20000", "You can pay up to £10,000 here. For more, please call us on 01292 811 015."],
  ])("refuses %s in words", (typed, error) => {
    expect(parsePayAmount(typed, 1000)).toEqual({ error });
  });
});
