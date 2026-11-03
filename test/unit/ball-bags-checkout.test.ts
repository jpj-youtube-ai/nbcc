import { describe, it, expect, vi, beforeEach } from "vitest";

// Red bags at the Festive Ball (/bag, docs/superpowers/specs/2026-11-02-ball-table-bags-design.md).
// Guests scan a table card and give £50 a red bag. Their gift goes through the same checkout as the
// donate page, POST /api/checkout-session, with one optional marker: ballBags, a number of bags from
// 1 to 20. Only with the marker: the SERVER sets the amount (bags x £50, whatever the browser says),
// once only, from a person, never with a fundraiser, a Red Bag or a Ball donate gift, card only, and
// always on Stripe's own page, coming back to /bag/thank-you. Gift Aid is exactly a one off gift's.
// Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
const cfg = vi.hoisted(() => ({
  STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
  STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  STRIPE_DONATION_PRODUCT: undefined as string | undefined,
  STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
  PORTAL_BASE_URL: "https://nbcc.test/",
  ADMIN_SESSION_SECRET: "an-invented-secret-for-tests",
  NODE_ENV: "test",
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({ config: cfg }));

import { postCheckoutSession } from "../../src/routes/api";
import { BALL_BAG_PENCE, BALL_BAGS_MAX, BALL_BAGS_PATH, BALL_BAGS_THANKS_PATH, ballBagsPence } from "../../src/ball/bags";

async function run(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers: {} } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const person = { mode: "once", plan: null, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };
const bags = (n: unknown, over: Record<string, unknown> = {}) => ({ ...person, ballBags: n, ...over });
const declaration = { firstName: "Alex", lastName: "Example", houseNameNumber: "12", address: "Example Street, Exampleton", postcode: "KA1 1AA" };

const THANKS = "https://nbcc.test/bag/thank-you?session_id={CHECKOUT_SESSION_ID}";
const PAGE = "https://nbcc.test/bag";

beforeEach(() => {
  cfg.STRIPE_DONATION_PRODUCT = undefined;
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
});

describe("the red bags numbers", () => {
  it("are £50 a bag, up to 20 bags, at /bag and /bag/thank-you", () => {
    expect(BALL_BAG_PENCE).toBe(5000);
    expect(BALL_BAGS_MAX).toBe(20);
    expect(BALL_BAGS_PATH).toBe("/bag");
    expect(BALL_BAGS_THANKS_PATH).toBe("/bag/thank-you");
  });

  it("price a number of bags in pence", () => {
    expect(ballBagsPence(1)).toBe(5000);
    expect(ballBagsPence(3)).toBe(15000);
    expect(ballBagsPence(20)).toBe(100000);
  });
});

describe("the server sets the amount", () => {
  it("prices the bags at £50 each, whatever amount the browser sends", async () => {
    const res = await run(bags(3, { amount: 1 }));
    expect(res.statusCode).toBe(200);
    expect(params().line_items).toStrictEqual([
      { quantity: 1, price_data: { currency: "gbp", unit_amount: 15000, product_data: { name: "Red bags at the Festive Ball" } } },
    ]);
  });

  it("ignores a forged larger amount too", async () => {
    await run(bags(2, { amount: 999999 }));
    expect(params().line_items[0].price_data.unit_amount).toBe(10000);
  });

  it("needs no amount at all", async () => {
    expect((await run(bags(1))).statusCode).toBe(200);
    expect(params().line_items[0].price_data.unit_amount).toBe(5000);
    expect((await run(bags(4, { amount: null }))).statusCode).toBe(200);
    expect(params().line_items[0].price_data.unit_amount).toBe(20000);
  });

  it("names the line for the bags even when a donation product is set", async () => {
    cfg.STRIPE_DONATION_PRODUCT = "prod_test_donation";
    await run(bags(1));
    expect(params().line_items[0].price_data).toStrictEqual({ currency: "gbp", unit_amount: 5000, product_data: { name: "Red bags at the Festive Ball" } });
  });

  it("takes 1 bag and 20 bags", async () => {
    expect((await run(bags(1))).statusCode).toBe(200);
    expect((await run(bags(20))).statusCode).toBe(200);
    expect(params().line_items[0].price_data.unit_amount).toBe(100000);
  });

  it.each([
    ["no bags", 0],
    ["21 bags", 21],
    ["a part of a bag", 2.5],
    ["fewer than none", -1],
    ["a number written as words", "3"],
    ["nothing", null],
  ])("refuses %s, and never reaches Stripe", async (_what, n) => {
    const res = await run(bags(n, { amount: 5000 }));
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("a red bags gift's rules", () => {
  it("is once only", async () => {
    const res = await run(bags(2, { mode: "monthly", ageConfirmed: true }));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("Red bags at the Ball are a one off gift");
  });

  it("is a gift from a person: a company or a partnership gives on the donate page", async () => {
    const company = { legalName: "Example Widgets Ltd", contactName: "Alex Example", contactEmail: "accounts@example.com", billingAddress: "1 Example Street, Exampleton", billingPostcode: "KA1 1AA", considerationGiven: false };
    const c = await run(bags(2, { donorType: "company", company }));
    expect(c.statusCode).toBe(400);
    expect(JSON.stringify(c.body)).toContain("Red bags at the Ball are a gift from a person");
    expect((await run(bags(2, { donorType: "partnership" }))).statusCode).toBe(400);
  });

  it.each([
    ["a Fill a Red Bag gift", { redBag: true }],
    ["a Ball donate page gift", { ball: true }],
    ["a gift on a fundraiser's page", { fundraiserId: 7 }],
  ])("is never also %s", async (_what, extra) => {
    const res = await run(bags(2, extra));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("Red bags at the Ball are not a gift on a fundraising page, a Red Bag or a Ball donate gift");
  });

  it("still needs an email, as every person's gift does", async () => {
    const res = await run(bags(2, { email: "" }));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a valid email is required");
  });

  it("never reaches Stripe when refused", async () => {
    await run(bags(2, { mode: "monthly", ageConfirmed: true }));
    await run(bags(2, { redBag: true }));
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the session a red bags gift makes", () => {
  it("is card only (which brings Apple Pay and Google Pay), with no Direct Debit", async () => {
    await run(bags(2));
    expect(params().payment_method_types).toStrictEqual(["card"]);
  });

  it("is a one off payment, with the email filled in", async () => {
    await run(bags(2));
    expect(params().mode).toBe("payment");
    expect(params().customer_email).toBe("alex@example.com");
  });

  it("comes back to /bag/thank-you, and Back on Stripe's page returns to /bag", async () => {
    const res = await run(bags(2));
    expect(params().success_url).toBe(THANKS);
    expect(params().cancel_url).toBe(PAGE);
    expect(params().ui_mode).toBeUndefined();
    expect(params().return_url).toBeUndefined();
    expect(res.body).toStrictEqual({ url: "https://checkout.stripe.test/1" });
  });

  it("is always on Stripe's own page, even when our page is asked for", async () => {
    const res = await run(bags(2, { uiMode: "embedded" }));
    expect(res.statusCode).toBe(200);
    expect(params().success_url).toBe(THANKS);
    expect(params().cancel_url).toBe(PAGE);
    expect(params().ui_mode).toBeUndefined();
    expect(params().return_url).toBeUndefined();
    expect(res.body).toStrictEqual({ url: "https://checkout.stripe.test/1" });
  });

  it("never takes a return address from the browser", async () => {
    await run(bags(2, { success_url: "https://elsewhere.example/x", cancel_url: "https://elsewhere.example/z", returnUrl: "https://elsewhere.example" }));
    expect(JSON.stringify(params())).not.toContain("elsewhere.example");
  });

  it("carries the number of bags as one more key, and otherwise the metadata of the same one off gift", async () => {
    await run({ ...person, amount: 10000 });
    const plain = params().metadata;
    await run(bags(2));
    const marked = params().metadata;
    expect(marked.ballBags).toBe("2");
    expect(marked).toStrictEqual({ ...plain, ballBags: "2" });
  });

  it("takes Gift Aid exactly as any person's one off gift does", async () => {
    await run({ ...person, amount: 10000, giftAid: true, declaration });
    const plain = params().metadata;
    await run(bags(2, { giftAid: true, declaration }));
    const marked = params().metadata;
    expect(marked.giftAidWordingVersion).toBe(plain.giftAidWordingVersion);
    expect(marked.declPostcode).toBe("KA1 1AA");
    expect(marked).toStrictEqual({ ...plain, ballBags: "2" });
  });

  it("covers the card fee on the bags' total, as any one off gift would, when asked", async () => {
    await run(bags(2, { coverFee: true }));
    expect(params().line_items).toHaveLength(2);
    expect(Number(params().metadata.feeCoverPence)).toBeGreaterThan(0);
  });
});

describe("any other gift", () => {
  it("gains no ballBags key and keeps Direct Debit", async () => {
    await run({ ...person, amount: 2500 });
    expect(params().metadata).not.toHaveProperty("ballBags");
    expect(params().payment_method_types).toStrictEqual(["card", "bacs_debit"]);
    expect(params().line_items[0].price_data.product_data).toStrictEqual({ name: "Donation to NBCC" });
  });

  it("still needs an amount without the marker", async () => {
    expect((await run({ ...person })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});
