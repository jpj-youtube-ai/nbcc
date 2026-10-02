import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-494 review: after paying on a fundraiser's page, the giver comes back to THAT page with a
// thank you, not to the donate page's thank you. The page's address is worked out by the server
// from the fundraiser it names (never taken from the browser), and only for one that has a public
// page; anything else, and every donate page gift, goes back exactly where it always did. Every name
// and address here is invented.

const { create, getFundraiser, fundraisingOn } = vi.hoisted(() => ({ create: vi.fn(), getFundraiser: vi.fn(), fundraisingOn: { value: true } }));
const cfg = vi.hoisted(() => ({
  STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
  STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  STRIPE_DONATION_PRODUCT: undefined,
  STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
  NODE_ENV: "test",
}));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({ config: cfg }));
vi.mock("../../src/db/fundraisers", () => ({ getFundraiser, fundraisingIsOn: async () => fundraisingOn.value }));
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));

import { postCheckoutSession, thankYouReturnUrl } from "../../src/routes/api";

async function run(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const gift = { mode: "once", plan: null, amount: 2500, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };
const approved = { id: 7, slug: "robins-santa-dash", status: "approved", public: true, path: "raising" };
const PAGE = "https://nbcc.test/fundraise/robins-santa-dash";

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
  getFundraiser.mockReset().mockResolvedValue(approved);
});

describe("a gift on a fundraiser's page comes back to that page", () => {
  it("on the page (embedded), with a thank you", async () => {
    await run({ ...gift, uiMode: "embedded", fundraiserId: 7 });
    expect(getFundraiser).toHaveBeenCalledWith(7);
    expect(params().return_url).toBe(`${PAGE}?thanks=1&session_id={CHECKOUT_SESSION_ID}`);
    expect(params().success_url).toBeUndefined();
  });

  // A page opened before TASK-502 may still send a message with the gift.
  it("says when they left a message, so the thank you can mention the wall", async () => {
    await run({ ...gift, uiMode: "embedded", fundraiserId: 7, supporterMessage: "Go Robin" });
    expect(params().return_url).toBe(`${PAGE}?thanks=1&message=1&session_id={CHECKOUT_SESSION_ID}`);
  });

  // TASK-502: Stripe fills in the paid session's id, so the thank you can offer the wall step.
  it("carries Stripe's session id placeholder, unencoded, for Stripe to fill in", async () => {
    await run({ ...gift, fundraiserId: 7 });
    expect(params().success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(params().success_url).not.toContain("%7B");
  });

  // TASK-502: a finished fundraiser keeps its page and still takes gifts.
  it("comes back to a finished fundraiser's page too", async () => {
    getFundraiser.mockResolvedValueOnce({ ...approved, status: "finished" });
    await run({ ...gift, uiMode: "embedded", fundraiserId: 7 });
    expect(params().return_url).toBe(`${PAGE}?thanks=1&session_id={CHECKOUT_SESSION_ID}`);
  });

  it("on Stripe's own page (hosted): success to the thank you, cancel back to the page", async () => {
    await run({ ...gift, fundraiserId: 7 });
    expect(params().success_url).toBe(`${PAGE}?thanks=1&session_id={CHECKOUT_SESSION_ID}`);
    expect(params().cancel_url).toBe(PAGE);
  });

  it("goes back to the donate page's thank you for a fundraiser with no public page", async () => {
    for (const f of [null, { ...approved, status: "new" }, { ...approved, status: "declined" }, { ...approved, public: false }, { ...approved, path: "event" }]) {
      getFundraiser.mockResolvedValueOnce(f);
      await run({ ...gift, uiMode: "embedded", fundraiserId: 7 });
      expect(params().return_url).toBe(thankYouReturnUrl("once", "individual"));
    }
  });

  it("still takes the gift if the lookup fails, going back the donate page's way", async () => {
    getFundraiser.mockRejectedValueOnce(new Error("database down"));
    const res = await run({ ...gift, fundraiserId: 7 });
    expect(res.statusCode).toBe(200);
    expect(params().success_url).toBe(thankYouReturnUrl("once", "individual"));
    expect(params().cancel_url).toBe(cfg.STRIPE_CANCEL_URL);
  });
});

describe("a donate page gift", () => {
  it("comes back exactly where it always did, and no fundraiser is looked up", async () => {
    await run({ ...gift, uiMode: "embedded" });
    expect(params().return_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    await run(gift);
    expect(params().success_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    expect(params().cancel_url).toBe("https://nbcc.test/donate");
    expect(getFundraiser).not.toHaveBeenCalled();
  });
});

describe("while fundraising is switched off", () => {
  it("a gift naming a fundraiser goes back the donate page's way", async () => {
    fundraisingOn.value = false;
    await run({ ...gift, uiMode: "embedded", fundraiserId: 7 });
    expect(params().return_url).toBe(thankYouReturnUrl("once", "individual"));
    fundraisingOn.value = true;
  });
});
