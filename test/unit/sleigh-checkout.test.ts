import { describe, it, expect, vi, beforeEach } from "vitest";

// The Kilmarnock Santa Sleigh page (/sleigh, docs/superpowers/specs/2026-11-10-santa-sleigh-design.md).
// Its gifts go through the same checkout as the donate page, POST /api/checkout-session, with one
// optional marker: sleigh: true. Only with the marker: once only, £2 at least, from a person, never
// with a fundraiser, a Red Bag, a Ball donate gift or red bags at the Ball, card only, always on
// Stripe's own page, coming back to /sleigh/thank-you. Every name and address here is invented.

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
import { SLEIGH_MIN_PENCE } from "../../src/sleigh/model";

async function run(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers: {} } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const person = { mode: "once", plan: null, giftAid: false, email: "kit@example.com", fullName: "Kit Example" };
const gift = (amount: unknown, over: Record<string, unknown> = {}) => ({ ...person, amount, sleigh: true, ...over });
const declaration = { firstName: "Kit", lastName: "Example", houseNameNumber: "4", address: "Example Road, Exampleton", postcode: "KA1 2BB" };

const THANKS = "https://nbcc.test/sleigh/thank-you?session_id={CHECKOUT_SESSION_ID}";
const PAGE = "https://nbcc.test/sleigh";

beforeEach(() => {
  cfg.STRIPE_DONATION_PRODUCT = undefined;
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
});

describe("a sleigh gift's rules", () => {
  it("takes £2 and more, and refuses £1.99", async () => {
    expect(SLEIGH_MIN_PENCE).toBe(200);
    expect((await run(gift(200))).statusCode).toBe(200);
    const res = await run(gift(199));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("the smallest Santa Sleigh gift is £2");
  });

  it("is once only", async () => {
    const res = await run(gift(1000, { mode: "monthly", ageConfirmed: true }));
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a Santa Sleigh gift is a one off gift");
  });

  it("is a gift from a person: a company or a partnership gives on the donate page", async () => {
    const company = { legalName: "Example Sleds Ltd", contactName: "Kit Example", contactEmail: "accounts@example.com", billingAddress: "1 Example Road, Exampleton", billingPostcode: "KA1 2BB", considerationGiven: false };
    const c = await run(gift(1000, { donorType: "company", company }));
    expect(c.statusCode).toBe(400);
    expect(JSON.stringify(c.body)).toContain("a Santa Sleigh gift is a gift from a person");
    expect((await run(gift(1000, { donorType: "partnership" }))).statusCode).toBe(400);
  });

  // Review focus 5: a sleigh body that also carries another marker is refused.
  it.each([
    ["a Fill a Red Bag gift", { redBag: true }],
    ["a Ball donate page gift", { ball: true }],
    ["a gift on a fundraiser's page", { fundraiserId: 7 }],
    ["red bags at the Ball", { ballBags: 2 }],
  ])("is never also %s", async (_what, extra) => {
    const res = await run(gift(1000, extra));
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("never reaches Stripe when refused", async () => {
    await run(gift(150));
    await run(gift(1000, { mode: "monthly", ageConfirmed: true }));
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the session a sleigh gift makes", () => {
  it("is card only (which brings Apple Pay and Google Pay), with no Direct Debit", async () => {
    await run(gift(1000));
    expect(params().payment_method_types).toStrictEqual(["card"]);
  });

  it("is one line named for the sleigh, even when a donation product is set", async () => {
    cfg.STRIPE_DONATION_PRODUCT = "prod_test_donation";
    await run(gift(2000));
    expect(params().mode).toBe("payment");
    expect(params().line_items[0]).toStrictEqual({ quantity: 1, price_data: { currency: "gbp", unit_amount: 2000, product_data: { name: "Santa Sleigh gift to NBCC" } } });
  });

  it("comes back to /sleigh/thank-you, and Back on Stripe's page returns to /sleigh", async () => {
    const res = await run(gift(1000));
    expect(params().success_url).toBe(THANKS);
    expect(params().cancel_url).toBe(PAGE);
    expect(params().ui_mode).toBeUndefined();
    expect(res.body).toStrictEqual({ url: "https://checkout.stripe.test/1" });
  });

  it("is always on Stripe's own page, even when our page is asked for", async () => {
    const res = await run(gift(1000, { uiMode: "embedded" }));
    expect(res.statusCode).toBe(200);
    expect(params().success_url).toBe(THANKS);
    expect(params().ui_mode).toBeUndefined();
    expect(params().return_url).toBeUndefined();
    expect(res.body).toStrictEqual({ url: "https://checkout.stripe.test/1" });
  });

  it("carries the sleigh as one more key, and otherwise the metadata of the same one off gift", async () => {
    await run({ ...person, amount: 1000 });
    const plain = params().metadata;
    await run(gift(1000));
    expect(params().metadata).toStrictEqual({ ...plain, sleigh: "true" });
  });

  it("takes Gift Aid exactly as any person's one off gift does", async () => {
    await run({ ...person, amount: 1000, giftAid: true, declaration });
    const plain = params().metadata;
    await run(gift(1000, { giftAid: true, declaration }));
    expect(params().metadata).toStrictEqual({ ...plain, sleigh: "true" });
  });

  it("leaves a gift without the marker exactly as it was", async () => {
    await run({ ...person, amount: 1000 });
    expect(params().metadata.sleigh).toBeUndefined();
    expect(params().success_url).not.toContain("/sleigh");
  });
});
