import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-050 (REQ-055): POST /api/subscription/change-plan moves a monthly
// subscription up or down a tier. It validates { subscriptionId, plan } zod-first,
// then — via changeSubscriptionPlan in src/clients/stripe — retrieves the sub and
// swaps its single recurring item to the target plan's STRIPE_PRICE_* id with
// proration_behavior 'create_prorations' (one Price per tier, so proration is
// Stripe's job). Unknown/missing/duplicate plans are 400; an upstream Stripe
// failure is 502 (same error shape as the checkout endpoint).
//
// DB-free: the `stripe` SDK and config are mocked, so no SDK/network/env is touched.
// Unlike checkout-session.test.ts (which mocks the whole client module), this file
// mocks the `stripe` PACKAGE and lets the REAL changeSubscriptionPlan wrapper run,
// so the price id + proration flag it passes to subscriptions.update are asserted.

// Hoisted so the (hoisted) vi.mock factory below can reference the same spies.
const { retrieve, update } = vi.hoisted(() => ({ retrieve: vi.fn(), update: vi.fn() }));

// Mock the Stripe SDK itself: `new Stripe(...)` yields an instance whose
// subscriptions.retrieve/update are our spies. A real-looking key in the config
// mock below keeps stripeConfigured=true, so the client uses this mock rather than
// its offline stub — letting us drive retrieve/update return values and assertions.
vi.mock("stripe", () => {
  class MockStripe {
    subscriptions = { retrieve, update };
    checkout = { sessions: { create: vi.fn() } };
    webhooks = { constructEvent: vi.fn() };
  }
  return { default: MockStripe };
});

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    // Real-looking test key (matches the sk_test_ + 20+ chars pattern) so the
    // client uses `new Stripe(...)` (mocked above), not its placeholder-key stub.
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    STRIPE_PRICE_BRONZE: "price_bronze_id",
    STRIPE_PRICE_SILVER: "price_silver_id",
    STRIPE_PRICE_GOLD: "price_gold_id",
    STRIPE_PRICE_PLATINUM: "price_platinum_id",
  },
}));

import { postChangePlan } from "../../src/routes/api";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
  } as MockRes;
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b: unknown) => {
    res.body = b;
    return res;
  };
  return res;
}

const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postChangePlan({ body } as any, res as any);
  return res;
};

// The most recent [id, params] passed to subscriptions.update.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastUpdate = (): any[] => update.mock.calls[update.mock.calls.length - 1];

beforeEach(() => {
  retrieve.mockClear();
  update.mockClear();
  // Default: the subscription is on an unmanaged price (not one of the four plan
  // prices), so any plan change proceeds. Tests override for duplicate/failure.
  retrieve.mockResolvedValue({
    id: "sub_test_123",
    items: { data: [{ id: "si_test_1", price: { id: "price_current_unmanaged" } }] },
  });
  update.mockResolvedValue({
    id: "sub_test_123",
    object: "subscription",
    status: "active",
    items: { data: [{ id: "si_test_1", price: { id: "price_gold_id" } }] },
  });
});

describe("POST /api/subscription/change-plan — valid change (REQ-055)", () => {
  it("swaps the single item to the target plan's price with create_prorations proration", async () => {
    const res = await run({ subscriptionId: "sub_test_123", plan: "gold" });

    expect(res.statusCode).toBe(200);
    // Retrieved first to find the existing item id (omitting it would ADD an item).
    expect(retrieve).toHaveBeenCalledWith("sub_test_123");
    expect(update).toHaveBeenCalledOnce();

    const [id, params] = lastUpdate();
    expect(id).toBe("sub_test_123");
    expect(params.items).toEqual([{ id: "si_test_1", price: "price_gold_id" }]);
    expect(params.proration_behavior).toBe("create_prorations");

    // Returns the updated subscription verbatim.
    expect((res.body as { id: string }).id).toBe("sub_test_123");
    expect((res.body as { status: string }).status).toBe("active");
  });

  it("maps each plan to its configured recurring price id", async () => {
    for (const [plan, price] of [
      ["bronze", "price_bronze_id"],
      ["silver", "price_silver_id"],
      ["gold", "price_gold_id"],
      ["platinum", "price_platinum_id"],
    ] as const) {
      update.mockClear();
      await run({ subscriptionId: "sub_test_123", plan });
      expect(lastUpdate()[1].items[0].price).toBe(price);
    }
  });
});

describe("POST /api/subscription/change-plan — duplicate plan returns 400", () => {
  it("rejects a change to the plan the subscription is already on and never updates", async () => {
    retrieve.mockResolvedValueOnce({
      id: "sub_test_123",
      items: { data: [{ id: "si_test_1", price: { id: "price_gold_id" } }] },
    });
    const res = await run({ subscriptionId: "sub_test_123", plan: "gold" });
    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/subscription/change-plan — invalid bodies return 400", () => {
  it.each([
    ["an unknown plan", { subscriptionId: "sub_test_123", plan: "diamond" }],
    ["a missing subscription id", { plan: "gold" }],
    ["an empty subscription id", { subscriptionId: "", plan: "gold" }],
    ["a missing plan", { subscriptionId: "sub_test_123" }],
    ["an empty body", {}],
  ])("rejects %s and never calls Stripe", async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(retrieve).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/subscription/change-plan — upstream failure returns 502", () => {
  it("returns 502 when the retrieve call throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    retrieve.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await run({ subscriptionId: "sub_missing", plan: "gold" });
    expect(res.statusCode).toBe(502);
    expect(errSpy).toHaveBeenCalled(); // the failure is logged for diagnosis
    errSpy.mockRestore();
  });

  it("returns 502 when the update call throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    update.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await run({ subscriptionId: "sub_test_123", plan: "gold" });
    expect(res.statusCode).toBe(502);
    errSpy.mockRestore();
  });
});
