import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-102 (REQ-055): POST /api/portal/:token/subscription/cancel — the "cancel" end of the
// reduce-instead-then-cancel flow. It authenticates the portal magic-link token, REQUIRES an
// explicit `accepted: 'reduce'|'cancel'` acknowledgement that reduce-instead was offered (missing →
// 400), and only on 'cancel' calls stripe.subscriptions.cancel, returning the cancelled sub.
// Mirrors change-plan.test.ts: mocks the Stripe SDK (so the real cancelSubscription wrapper runs)
// plus the pool (for the token auth read) — no SDK/network/DB touched.

const { cancel } = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("stripe", () => {
  class MockStripe {
    subscriptions = { retrieve: vi.fn(), update: vi.fn(), cancel };
    checkout = { sessions: { create: vi.fn() } };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: MockStripe };
});

// The portal token auth reads portal_access_tokens via pool.query.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    // Real-looking test key so the client uses `new Stripe(...)` (mocked), not its stub.
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    STRIPE_PRICE_BRONZE: "price_bronze_id",
    STRIPE_PRICE_SILVER: "price_silver_id",
    STRIPE_PRICE_GOLD: "price_gold_id",
    STRIPE_PRICE_PLATINUM: "price_platinum_id",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import { postCancelSubscription } from "../../src/routes/portal";

// A valid (unexpired, unused) token row for donor 42.
let tokenRow: { token: string; donor_id: number; expires_at: Date; used_at: Date | null } | undefined;

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (body: unknown, token = "tok_1"): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCancelSubscription({ params: { token }, body } as any, res as any);
  return res;
};

beforeEach(() => {
  cancel.mockReset();
  cancel.mockResolvedValue({
    id: "sub_demo_123",
    object: "subscription",
    status: "canceled",
    items: { data: [{ id: "si_1", price: { id: "price_current" } }] },
  });
  queryMock.mockReset();
  tokenRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() + 60_000), used_at: null };
  queryMock.mockImplementation(async (sql: string) =>
    /from portal_access_tokens/i.test(sql)
      ? { rows: tokenRow ? [tokenRow] : [], rowCount: tokenRow ? 1 : 0 }
      : { rows: [], rowCount: 0 },
  );
});

describe("POST /api/portal/:token/subscription/cancel (REQ-055 · TASK-102)", () => {
  it("returns 400 and does NOT cancel when the reduce-instead acknowledgement is missing", async () => {
    const res = await run({ subscriptionId: "sub_demo_123" });
    expect(res.statusCode).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels and returns the cancelled subscription when accepted='cancel'", async () => {
    const res = await run({ subscriptionId: "sub_demo_123", accepted: "cancel" });
    expect(res.statusCode).toBe(200);
    expect(cancel).toHaveBeenCalledWith("sub_demo_123");
    expect((res.body as { status: string }).status).toBe("canceled");
    expect((res.body as { id: string }).id).toBe("sub_demo_123");
  });

  it("refuses with 400 (no cancel) when the donor chose reduce instead (accepted='reduce')", async () => {
    const res = await run({ subscriptionId: "sub_demo_123", accepted: "reduce" });
    expect(res.statusCode).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects an unknown accepted value and a missing subscriptionId with 400", async () => {
    expect((await run({ subscriptionId: "sub_demo_123", accepted: "maybe" })).statusCode).toBe(400);
    expect((await run({ accepted: "cancel" })).statusCode).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("401s on an invalid/expired token before any cancel", async () => {
    tokenRow = undefined;
    const res = await run({ subscriptionId: "sub_demo_123", accepted: "cancel" }, "nope");
    expect(res.statusCode).toBe(401);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("returns 502 when the Stripe cancel throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cancel.mockRejectedValueOnce(new Error("stripe down"));
    const res = await run({ subscriptionId: "sub_demo_123", accepted: "cancel" });
    expect(res.statusCode).toBe(502);
    errSpy.mockRestore();
  });
});
