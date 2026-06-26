import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-038 (REQ-029): POST /api/checkout-session builds a Stripe Checkout session
// from the REQ-028 payload { mode, plan, amount, giftAid } and returns { url }.
// A one-off (mode=once) is a `payment` session with inline GBP price_data built
// from the amount (pence); a monthly (mode=monthly) is a `subscription` using the
// recurring STRIPE_PRICE_* id keyed by plan. Invalid bodies are rejected with 400.
// DB-free: the Stripe client and config are mocked, so no SDK/network/env is
// touched. Mirrors the schema-style validation in src/config/schema.ts.

// Hoisted so the (hoisted) vi.mock factory below can reference it.
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("../../src/clients/stripe", () => ({
  stripe: { checkout: { sessions: { create } } },
  stripePriceByPlan: {
    bronze: "price_bronze_id",
    silver: "price_silver_id",
    gold: "price_gold_id",
    platinum: "price_platinum_id",
  },
  stripeConfigured: true,
}));

vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  },
}));

import { postCheckoutSession } from "../../src/routes/api";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = async (body: unknown): Promise<MockRes> => {
  const res = mockRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lastParams = (): any => create.mock.calls[create.mock.calls.length - 1][0];

beforeEach(() => {
  create.mockClear();
  create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/test_123" });
});

describe("POST /api/checkout-session — one-off (REQ-029)", () => {
  it("creates a payment session with inline GBP price_data from the amount (pence)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });

    expect(res.statusCode).toBe(200);
    expect((res.body as { url: string }).url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(create).toHaveBeenCalledOnce();

    const p = lastParams();
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card", "bacs_debit"]);
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data.currency).toBe("gbp");
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
    expect(p.success_url).toBe("https://nbcc.test/donate/thank-you");
    expect(p.cancel_url).toBe("https://nbcc.test/donate");
  });
});

describe("POST /api/checkout-session — monthly (REQ-029)", () => {
  it("creates a subscription session using the plan's recurring price id", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false });

    expect(res.statusCode).toBe(200);
    const p = lastParams();
    expect(p.mode).toBe("subscription");
    expect(p.line_items[0].price).toBe("price_gold_id");
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data).toBeUndefined();
  });

  it("maps each plan to its configured price id", async () => {
    for (const [plan, price] of [
      ["bronze", "price_bronze_id"],
      ["silver", "price_silver_id"],
      ["platinum", "price_platinum_id"],
    ] as const) {
      create.mockClear();
      await run({ mode: "monthly", plan, amount: 1000, giftAid: false });
      expect(lastParams().line_items[0].price).toBe(price);
    }
  });
});

describe("POST /api/checkout-session — Gift Aid (REQ-023)", () => {
  it("records the declaration as metadata.giftAid='true' when opted in", async () => {
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true });
    expect(lastParams().metadata.giftAid).toBe("true");
  });

  it("records metadata.giftAid='false' when not opted in", async () => {
    await run({ mode: "monthly", plan: "bronze", amount: 1000, giftAid: false });
    expect(lastParams().metadata.giftAid).toBe("false");
  });
});

describe("POST /api/checkout-session — invalid bodies return 400", () => {
  it.each([
    ["monthly without a plan", { mode: "monthly", plan: null, amount: 1000, giftAid: false }],
    ["once without an amount", { mode: "once", plan: null, amount: null, giftAid: false }],
    ["an unknown mode", { mode: "annual", plan: null, amount: 1000, giftAid: false }],
    ["a non-boolean giftAid", { mode: "once", plan: null, amount: 1000, giftAid: "yes" }],
    ["a zero/negative amount", { mode: "once", plan: null, amount: -5, giftAid: false }],
    ["an unknown plan", { mode: "monthly", plan: "diamond", amount: 1000, giftAid: false }],
    ["an empty body", {}],
  ])("rejects %s and never calls Stripe", async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkout-session — upstream failure", () => {
  it("returns 502 when the Stripe call throws", async () => {
    create.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    expect(res.statusCode).toBe(502);
  });
});
