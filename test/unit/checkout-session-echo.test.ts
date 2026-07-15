import { describe, it, expect, vi, beforeEach } from "vitest";

// The stub-mode echo (TASK-116): when Stripe is NOT configured and we are not in
// production, postCheckoutSession echoes the built session (id + metadata + mode) on
// the 200 body so the BDD journey can replay the REAL stamped metadata into the
// completion webhook. In production (or with a real key) the body stays { url }.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create } } },
  // Monthly checkout builds its recurring price inline from the amount now (TASK-231), so no
  // plan→STRIPE_PRICE_* mapping is needed here.
  // Not configured → the stub is active → the echo should appear.
  stripeConfigured: false,
}));

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined as string | undefined,
    NODE_ENV: "test",
  },
}));
vi.mock("../../src/config", () => ({ config: mockConfig }));

import { postCheckoutSession } from "../../src/routes/api";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  return res;
}
const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
};

beforeEach(() => {
  create.mockClear();
  create.mockResolvedValue({ id: "cs_preview_1", url: "https://checkout.stripe.com/c/pay/test_1" });
  mockConfig.NODE_ENV = "test";
});

describe("POST /api/checkout-session — stub-mode session echo (TASK-116)", () => {
  it("echoes the built session id + metadata + mode on the 200 body when stubbed and not in production", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: true, email: "donor@example.com" });
    expect(res.statusCode).toBe(200);
    const body = res.body as { url: string; session?: { id: string; mode: string; metadata: Record<string, string> } };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/test_1");
    expect(body.session).toBeDefined();
    expect(body.session!.id).toBe("cs_preview_1");
    expect(body.session!.mode).toBe("payment");
    // The echoed metadata is exactly what buildSessionParams stamped.
    expect(body.session!.metadata.giftAid).toBe("true");
    expect(body.session!.metadata.mode).toBe("once");
  });

  it("echoes mode='subscription' for a monthly gift", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    const body = res.body as { session?: { mode: string } };
    expect(body.session!.mode).toBe("subscription");
  });

  it("echoes the supporters opt-in metadata so the BDD can replay it into the webhook (TASK-224)", async () => {
    const res = await run({
      mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true,
      email: "donor@example.com", listOnSupporters: true, creditName: "The Campbell Family",
    });
    const md = (res.body as { session?: { metadata: Record<string, string> } }).session!.metadata;
    expect(md.listOnSupporters).toBe("true");
    expect(md.creditName).toBe("The Campbell Family");
  });

  it("does NOT echo the session in production even when stubbed", async () => {
    mockConfig.NODE_ENV = "production";
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    expect((res.body as { session?: unknown }).session).toBeUndefined();
  });
});
