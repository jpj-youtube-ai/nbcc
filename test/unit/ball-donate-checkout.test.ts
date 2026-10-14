import { describe, it, expect, vi, beforeEach } from "vitest";

// The Festive Ball's "Can't make it? Donate" page (/ball/donate, Jaimie, 14 October 2026). Its gifts
// go through the same checkout as the donate page, POST /api/checkout-session, with one optional
// marker: ball: true. Only with the marker: once only, £2 at least, never with a fundraiser or a Red
// Bag, one more metadata key, and Back from Stripe's own page returns to /ball/donate. The thank you
// is the donate page's own. A donate page gift is untouched. Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
const cfg = vi.hoisted(() => ({
  STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
  STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  STRIPE_DONATION_PRODUCT: undefined,
  STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
  PORTAL_BASE_URL: "https://nbcc.test/",
  ADMIN_SESSION_SECRET: "an-invented-secret-for-tests",
  NODE_ENV: "test",
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({ config: cfg }));

import { postCheckoutSession, thankYouReturnUrl } from "../../src/routes/api";

async function run(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers: {} } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const gift = { mode: "once", plan: null, amount: 2500, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };
const ballGift = { ...gift, ball: true };

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
});

describe("a Ball gift's rules", () => {
  it("takes £2, once", async () => {
    expect((await run({ ...ballGift, amount: 200 })).statusCode).toBe(200);
  });

  it("refuses less than £2", async () => {
    const res = await run({ ...ballGift, amount: 199 });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("the smallest Festive Ball gift is £2");
    expect(create).not.toHaveBeenCalled();
  });

  it("is once only", async () => {
    const res = await run({ ...ballGift, mode: "monthly", ageConfirmed: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a Festive Ball gift is a one off gift");
    expect(create).not.toHaveBeenCalled();
  });

  it("is never also a gift on a fundraiser's page, or a Red Bag", async () => {
    expect((await run({ ...ballGift, fundraiserId: 7 })).statusCode).toBe(400);
    expect((await run({ ...ballGift, redBag: true })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("is open to everyone, with no look at who is signed in", async () => {
    expect((await run(ballGift)).statusCode).toBe(200);
  });
});

describe("the session a Ball gift makes", () => {
  it("carries one more key, ball, and nothing else changes", async () => {
    await run(gift);
    const plain = params();
    await run(ballGift);
    const ball = params();
    expect(ball.metadata.ball).toBe("true");
    const rest = { ...ball.metadata };
    delete rest.ball;
    expect(rest).toEqual(plain.metadata);
    expect(ball.line_items).toEqual(plain.line_items);
    expect(ball.mode).toBe("payment");
  });

  it("lands on the donate page's own thank you, and Back from Stripe's page returns to the Ball's donate page", async () => {
    await run(ballGift);
    expect(params().success_url).toBe(thankYouReturnUrl("once", "individual"));
    expect(params().cancel_url).toBe("https://nbcc.test/ball/donate");
  });

  it("paid on the page, returns to the same thank you", async () => {
    await run({ ...ballGift, uiMode: "embedded" });
    expect(params().ui_mode).toBe("embedded_page");
    expect(params().return_url).toBe(thankYouReturnUrl("once", "individual"));
    expect(params().cancel_url).toBeUndefined();
  });
});

describe("a donate page gift", () => {
  it("gains no ball key", async () => {
    await run(gift);
    expect(params().metadata).not.toHaveProperty("ball");
    expect(params().cancel_url).toBe(cfg.STRIPE_CANCEL_URL);
  });

  it("a ball marker of false is an ordinary gift", async () => {
    await run({ ...gift, ball: false, amount: 100 });
    expect(params().metadata).not.toHaveProperty("ball");
  });
});
