import { describe, it, expect, vi, beforeEach } from "vitest";

// What brought someone to give, stamped on the Stripe session by the checkout (Donations gift log,
// Task 1). The page sends the page before it as cameFrom; the request's own Referer is the giving
// page. DB-free: the Stripe client and config are mocked, as in checkout-session.test.ts.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create } } },
  stripeConfigured: true,
}));
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    PORTAL_BASE_URL: "https://nbcc.test",
    STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
    NODE_ENV: "test",
  },
}));
vi.mock("../../src/config", () => ({ config: mockConfig }));

import { buildSessionParams, postCheckoutSession } from "../../src/routes/api";

const GIFT = { mode: "once", plan: null, amount: 1000, giftAid: false, email: "sam@example.com" };
const ARRIVAL_KEYS = ["arrChannel", "arrSource", "arrCampaign", "givenOn"];

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; json: (b: unknown) => Res };
function mockRes(): Res {
  const res = { statusCode: 200, body: undefined } as Res;
  res.status = (c) => ((res.statusCode = c), res);
  res.json = (b) => ((res.body = b), res);
  return res;
}

async function run(body: unknown, headers: Record<string, string> = {}): Promise<{ res: Res; metadata: Record<string, string> }> {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers, hostname: "nbcc.test" } as any, res as any);
  const params = create.mock.calls[create.mock.calls.length - 1]?.[0] as { metadata: Record<string, string> } | undefined;
  return { res, metadata: params?.metadata ?? {} };
}

const arrivalKeys = (m: Record<string, string>) => Object.keys(m).filter((k) => ARRIVAL_KEYS.includes(k));

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: "cs_test_arrival", url: "https://checkout.stripe.test/c/pay/cs_test_arrival" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("buildSessionParams with what brought the giver", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = { ...GIFT, coverFee: false, uiMode: "hosted", donorType: "individual" } as any;

  it("stamps only the keys there is something for", () => {
    const params = buildSessionParams(body, undefined, null, { channel: "qr", source: null, campaign: "c12", givenOn: "/donate" });
    expect(params.metadata).toMatchObject({ arrChannel: "qr", arrCampaign: "c12", givenOn: "/donate" });
    expect(params.metadata).not.toHaveProperty("arrSource");
  });

  it("stamps nothing without one, so every other session is exactly as it was", () => {
    expect(arrivalKeys(buildSessionParams(body, undefined, null, null).metadata as Record<string, string>)).toEqual([]);
    expect(buildSessionParams(body, undefined, null).metadata).toEqual(buildSessionParams(body, undefined, null, null).metadata);
  });
});

describe("POST /api/checkout-session and what brought the giver", () => {
  it("stamps the QR code a giver scanned onto the Donate page", async () => {
    const { res, metadata } = await run({ ...GIFT, cameFrom: "" }, { referer: "https://nbcc.test/donate?utm_medium=qr&utm_campaign=c12" });
    expect(res.statusCode).toBe(200);
    expect(metadata).toMatchObject({ arrChannel: "qr", arrCampaign: "c12", givenOn: "/donate" });
    expect(metadata).not.toHaveProperty("arrSource");
  });

  it("stamps another page of ours, by its path", async () => {
    const { metadata } = await run(
      { ...GIFT, cameFrom: "https://nbcc.scot/get-involved" },
      { referer: "https://nbcc.scot/donate" },
    );
    expect(metadata).toMatchObject({ arrChannel: "site", arrSource: "/get-involved", givenOn: "/donate" });
  });

  it("knows the site's own address from the request too", async () => {
    const { metadata } = await run({ ...GIFT, cameFrom: "https://nbcc.test/get-involved" }, { referer: "https://nbcc.test/fill" });
    expect(metadata).toMatchObject({ arrChannel: "site", arrSource: "/get-involved", givenOn: "/fill" });
  });

  it.each([
    ["Do Not Track", { dnt: "1" }],
    ["Global Privacy Control", { "sec-gpc": "1" }],
  ])("stamps none of it when the browser sends %s", async (_what, privacy) => {
    const { res, metadata } = await run(
      { ...GIFT, cameFrom: "https://www.google.com/" },
      { referer: "https://nbcc.test/donate?utm_medium=qr&utm_campaign=c12", ...privacy },
    );
    expect(res.statusCode).toBe(200);
    expect(arrivalKeys(metadata)).toEqual([]);
  });

  it("stamps none of it when the page did not send where it came from", async () => {
    const { metadata } = await run(GIFT, { referer: "https://nbcc.test/donate" });
    expect(arrivalKeys(metadata)).toEqual([]);
  });

  it("never puts the page before it into the session as it was sent", async () => {
    const { metadata } = await run(
      { ...GIFT, cameFrom: "https://www.example.org/a/private/path?token=abc" },
      { referer: "https://nbcc.test/donate" },
    );
    expect(metadata).toMatchObject({ arrChannel: "other_websites", arrSource: "example.org" });
    expect(JSON.stringify(metadata)).not.toContain("private");
    expect(JSON.stringify(metadata)).not.toContain("token");
  });

  it("never refuses a gift over it: an overlong or odd cameFrom is cut or dropped", async () => {
    const long = await run({ ...GIFT, cameFrom: "https://www.example.org/" + "x".repeat(5000) }, { referer: "https://nbcc.test/donate" });
    expect(long.res.statusCode).toBe(200);
    expect(long.metadata).toMatchObject({ arrChannel: "other_websites", arrSource: "example.org" });
    const odd = await run({ ...GIFT, cameFrom: { not: "a string" } }, { referer: "https://nbcc.test/donate" });
    expect(odd.res.statusCode).toBe(200);
    expect(arrivalKeys(odd.metadata)).toEqual([]);
  });
});
