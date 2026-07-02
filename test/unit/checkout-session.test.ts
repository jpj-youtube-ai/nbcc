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

// Mutable so individual tests can toggle the optional donation product.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined as string | undefined,
  },
}));

vi.mock("../../src/config", () => ({ config: mockConfig }));

import { postCheckoutSession } from "../../src/routes/api";
import { selectDeclarationWording } from "../../src/declarations/wording";

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
  mockConfig.STRIPE_DONATION_PRODUCT = undefined;
});

describe("POST /api/checkout-session — one-off (REQ-029)", () => {
  it("creates a payment session with inline GBP price_data from the amount (pence)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });

    expect(res.statusCode).toBe(200);
    expect((res.body as { url: string }).url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(create).toHaveBeenCalledOnce();

    const p = lastParams();
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card"]);
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data.currency).toBe("gbp");
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
    expect(p.success_url).toBe("https://nbcc.test/donate/thank-you");
    expect(p.cancel_url).toBe("https://nbcc.test/donate");
  });

  it("falls back to an inline product when STRIPE_DONATION_PRODUCT is unset", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    const p = lastParams();
    expect(p.line_items[0].price_data.product).toBeUndefined();
    expect(p.line_items[0].price_data.product_data.name.length).toBeGreaterThan(0);
  });

  it("attaches the configured donation product to the inline price when set", async () => {
    mockConfig.STRIPE_DONATION_PRODUCT = "prod_donation_123";
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    const p = lastParams();
    expect(p.line_items[0].price_data.product).toBe("prod_donation_123");
    expect(p.line_items[0].price_data.product_data).toBeUndefined();
    // The amount is still the donor's entered value (variable one-off).
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
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

describe("POST /api/checkout-session — Gift Aid wording binding (TASK-053)", () => {
  it("stamps the all-donations wording version + snapshot for a gift-aided monthly gift", async () => {
    // A monthly gift is enduring (all_donations scope), so it binds the multiple/all-
    // donations HMRC statement — the exact text selectDeclarationWording returns.
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: true });
    const md = lastParams().metadata;
    const wording = selectDeclarationWording({ mode: "monthly", scope: "all_donations" });
    expect(md.giftAidWordingVersion).toBe(wording.wording_version);
    expect(md.giftAidWording).toBe(wording.wording_snapshot);
  });

  it("stamps the single-donation wording version + snapshot for a gift-aided one-off gift", async () => {
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true });
    const md = lastParams().metadata;
    const wording = selectDeclarationWording({ mode: "once", scope: "this_donation" });
    expect(md.giftAidWordingVersion).toBe(wording.wording_version);
    expect(md.giftAidWording).toBe(wording.wording_snapshot);
  });

  it("binds distinct wording versions for monthly (enduring) vs one-off", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: true });
    const monthly = lastParams().metadata.giftAidWordingVersion;
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true });
    const oneOff = lastParams().metadata.giftAidWordingVersion;
    expect(monthly).not.toBe(oneOff);
  });

  it("stamps NO wording metadata when Gift Aid is not opted in", async () => {
    await run({ mode: "monthly", plan: "bronze", amount: 1000, giftAid: false });
    const md = lastParams().metadata;
    expect(md.giftAid).toBe("false");
    expect(md.giftAidWordingVersion).toBeUndefined();
    expect(md.giftAidWording).toBeUndefined();
  });
});

describe("POST /api/checkout-session — donor-type routing (REQ-038)", () => {
  it("stamps donorType and businessName onto the session metadata for a company", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: false,
      donorType: "company",
      businessName: "Acme Ltd",
    });
    const md = lastParams().metadata;
    expect(md.donorType).toBe("company");
    expect(md.businessName).toBe("Acme Ltd");
  });

  it("defaults donorType to 'individual' when omitted (the no-JS base contract is unchanged)", async () => {
    // startCheckout only folds donorType in once the REQ-038 enhancement is active;
    // a bare { mode, plan, amount, giftAid } body must still be accepted as an individual.
    await run({ mode: "once", plan: null, amount: 5000, giftAid: true });
    expect(lastParams().metadata.donorType).toBe("individual");
  });

  it("stamps an empty businessName when none is supplied", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "individual" });
    expect(lastParams().metadata.businessName).toBe("");
  });

  it("accepts a company donation without Gift Aid (companies take the no-Gift-Aid path)", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: false,
      donorType: "company",
      businessName: "Acme Ltd",
    });
    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects a company payload that also asserts giftAid=true with 400 and never calls Stripe", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      donorType: "company",
      businessName: "Acme Ltd",
    });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
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
    ["an unknown donorType", { mode: "once", plan: null, amount: 1000, giftAid: false, donorType: "trust" }],
    ["a company asserting Gift Aid", { mode: "once", plan: null, amount: 1000, giftAid: true, donorType: "company" }],
    ["an empty body", {}],
  ])("rejects %s and never calls Stripe", async (_label, body) => {
    const res = await run(body);
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkout-session — upstream failure", () => {
  it("returns 502 when the Stripe call throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    create.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false });
    expect(res.statusCode).toBe(502);
    expect(errSpy).toHaveBeenCalled(); // the failure is logged for diagnosis
    errSpy.mockRestore();
  });
});
