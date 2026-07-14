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
    // TASK-215: the public publishable key the embedded response hands to the browser.
    STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_pk",
    NODE_ENV: "test",
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
  // A created session carries BOTH a hosted url and an embedded client_secret in the mock so
  // either mode can be exercised; the endpoint reads only the field for the requested uiMode.
  create.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/test_123",
    client_secret: "cs_test_secret_123",
  });
  mockConfig.STRIPE_DONATION_PRODUCT = undefined;
  // Default to a configured publishable key so embedded ENGAGES; the dormant test overrides to "".
  mockConfig.STRIPE_PUBLISHABLE_KEY = "pk_test_dummy_pk";
});

describe("POST /api/checkout-session — one-off (REQ-029)", () => {
  it("creates a payment session with inline GBP price_data from the amount (pence)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });

    expect(res.statusCode).toBe(200);
    expect((res.body as { url: string }).url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(create).toHaveBeenCalledOnce();

    const p = lastParams();
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["card", "bacs_debit"]);
    expect(p.line_items[0].quantity).toBe(1);
    expect(p.line_items[0].price_data.currency).toBe("gbp");
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
    expect(p.success_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.test/donate");
  });

  it("falls back to an inline product when STRIPE_DONATION_PRODUCT is unset", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const p = lastParams();
    expect(p.line_items[0].price_data.product).toBeUndefined();
    expect(p.line_items[0].price_data.product_data.name.length).toBeGreaterThan(0);
  });

  it("attaches the configured donation product to the inline price when set", async () => {
    mockConfig.STRIPE_DONATION_PRODUCT = "prod_donation_123";
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const p = lastParams();
    expect(p.line_items[0].price_data.product).toBe("prod_donation_123");
    expect(p.line_items[0].price_data.product_data).toBeUndefined();
    // The amount is still the donor's entered value (variable one-off).
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
  });
});

describe("POST /api/checkout-session — monthly (REQ-029)", () => {
  it("creates a subscription session using the plan's recurring price id", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });

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
      await run({ mode: "monthly", plan, amount: 1000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
      expect(lastParams().line_items[0].price).toBe(price);
    }
  });

  it("builds an inline monthly recurring price for a custom amount (no plan, REQ-041)", async () => {
    const res = await run({ mode: "monthly", plan: null, amount: 3000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    expect(res.statusCode).toBe(200);
    const p = lastParams();
    expect(p.mode).toBe("subscription");
    expect(p.line_items[0].price).toBeUndefined();
    expect(p.line_items[0].price_data.currency).toBe("gbp");
    expect(p.line_items[0].price_data.unit_amount).toBe(3000);
    expect(p.line_items[0].price_data.recurring.interval).toBe("month");
  });

  it("rolls the custom monthly price under the donation product when set, else an inline product", async () => {
    await run({ mode: "monthly", plan: null, amount: 3000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    expect(lastParams().line_items[0].price_data.product_data.name.length).toBeGreaterThan(0);
    mockConfig.STRIPE_DONATION_PRODUCT = "prod_donation_123";
    await run({ mode: "monthly", plan: null, amount: 3000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    const p = lastParams();
    expect(p.line_items[0].price_data.product).toBe("prod_donation_123");
    expect(p.line_items[0].price_data.product_data).toBeUndefined();
  });
});

describe("POST /api/checkout-session — payment methods (REQ-029 / TASK-089)", () => {
  it("offers both card and BACS Direct Debit on a one-off (payment) session", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const methods = lastParams().payment_method_types;
    expect(methods).toContain("card");
    expect(methods).toContain("bacs_debit");
  });

  it("offers both card and BACS Direct Debit on a monthly (subscription) session", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    const methods = lastParams().payment_method_types;
    expect(methods).toContain("card");
    expect(methods).toContain("bacs_debit");
  });
});

describe("POST /api/checkout-session — Gift Aid (REQ-023)", () => {
  it("records the declaration as metadata.giftAid='true' when opted in", async () => {
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true, email: "donor@example.com" });
    expect(lastParams().metadata.giftAid).toBe("true");
  });

  it("records metadata.giftAid='false' when not opted in", async () => {
    await run({ mode: "monthly", plan: "bronze", amount: 1000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    expect(lastParams().metadata.giftAid).toBe("false");
  });
});

describe("POST /api/checkout-session — Gift Aid wording binding (TASK-053)", () => {
  it("stamps the all-donations wording version + snapshot for a gift-aided monthly gift", async () => {
    // A monthly gift is enduring (all_donations scope), so it binds the multiple/all-
    // donations HMRC statement — the exact text selectDeclarationWording returns.
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: true, ageConfirmed: true, email: "donor@example.com" });
    const md = lastParams().metadata;
    const wording = selectDeclarationWording({ mode: "monthly", scope: "all_donations" });
    expect(md.giftAidWordingVersion).toBe(wording.wording_version);
    expect(md.giftAidWording).toBe(wording.wording_snapshot);
  });

  it("stamps the single-donation wording version + snapshot for a gift-aided one-off gift", async () => {
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true, email: "donor@example.com" });
    const md = lastParams().metadata;
    const wording = selectDeclarationWording({ mode: "once", scope: "this_donation" });
    expect(md.giftAidWordingVersion).toBe(wording.wording_version);
    expect(md.giftAidWording).toBe(wording.wording_snapshot);
  });

  it("binds distinct wording versions for monthly (enduring) vs one-off", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: true, ageConfirmed: true, email: "donor@example.com" });
    const monthly = lastParams().metadata.giftAidWordingVersion;
    await run({ mode: "once", plan: null, amount: 2500, giftAid: true, email: "donor@example.com" });
    const oneOff = lastParams().metadata.giftAidWordingVersion;
    expect(monthly).not.toBe(oneOff);
  });

  it("stamps NO wording metadata when Gift Aid is not opted in", async () => {
    await run({ mode: "monthly", plan: "bronze", amount: 1000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    const md = lastParams().metadata;
    expect(md.giftAid).toBe("false");
    expect(md.giftAidWordingVersion).toBeUndefined();
    expect(md.giftAidWording).toBeUndefined();
  });
});

describe("POST /api/checkout-session — donor-type routing (REQ-038)", () => {
  // A company payload now requires a valid company object (TASK-085); reused by the tests below.
  const companyDetails = {
    legalName: "Acme Ltd",
    contactName: "Ada Lovelace",
    contactEmail: "finance@acme.test",
    billingAddress: "1 Office Park, London",
    billingPostcode: "SW1A 1AA",
    considerationGiven: false,
  };

  it("stamps donorType and businessName onto the session metadata for a company", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: false,
      donorType: "company",
      businessName: "Acme Ltd",
      company: companyDetails,
    });
    const md = lastParams().metadata;
    expect(md.donorType).toBe("company");
    expect(md.businessName).toBe("Acme Ltd");
  });

  it("defaults donorType to 'individual' when omitted (the no-JS base contract is unchanged)", async () => {
    // startCheckout only folds donorType in once the REQ-038 enhancement is active;
    // a bare { mode, plan, amount, giftAid } body must still be accepted as an individual.
    await run({ mode: "once", plan: null, amount: 5000, giftAid: true, email: "donor@example.com" });
    expect(lastParams().metadata.donorType).toBe("individual");
  });

  it("stamps an empty businessName when none is supplied", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "individual", email: "donor@example.com" });
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
      company: companyDetails,
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

describe("POST /api/checkout-session — contact capture (REQ-039 / TASK-059)", () => {
  const monthly = {
    mode: "monthly",
    plan: "gold",
    amount: 5000,
    giftAid: false,
    ageConfirmed: true,
    email: "donor@example.com",
  };

  it("rejects a monthly payload that does not confirm 18 or over with 400 and never calls Stripe", async () => {
    // Monthly giving is set up by adults aged 18 or over (REQ-039).
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a monthly payload with ageConfirmed=false", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: false });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a monthly payload once 18 or over is confirmed", async () => {
    const res = await run(monthly);
    expect(res.statusCode).toBe(200);
  });

  it("does not require the 18+ confirmation for a one-off gift", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    expect(res.statusCode).toBe(200);
  });

  it("stamps the captured contact fields onto the session metadata", async () => {
    await run({
      ...monthly,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      emailConsent: true,
      anonymous: false,
    });
    const md = lastParams().metadata;
    expect(md.fullName).toBe("Ada Lovelace");
    expect(md.email).toBe("ada@example.com");
    expect(md.emailConsent).toBe("true");
    expect(md.anonymous).toBe("false");
    expect(md.ageConfirmed).toBe("true");
  });

  it("stamps empty/false contact metadata when the optional fields are absent (base contract; REQ-039 email is still mandatory)", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const md = lastParams().metadata;
    expect(md.fullName).toBe("");
    expect(md.email).toBe("donor@example.com");
    expect(md.emailConsent).toBe("false");
    expect(md.anonymous).toBe("false");
  });
});

describe("POST /api/checkout-session — individual supporters-wall opt-in (TASK-224)", () => {
  const monthly = {
    mode: "monthly" as const,
    plan: "gold" as const,
    amount: 5000,
    giftAid: false,
    ageConfirmed: true,
    email: "donor@example.com",
  };

  it("stamps listOnSupporters='true' and the display name when the donor opts in", async () => {
    await run({ ...monthly, listOnSupporters: true, creditName: "The Campbell Family" });
    const md = lastParams().metadata;
    expect(md.listOnSupporters).toBe("true");
    expect(md.creditName).toBe("The Campbell Family");
  });

  it("stamps listOnSupporters='false' and an empty creditName when the donor keeps private", async () => {
    await run({ ...monthly, listOnSupporters: false });
    const md = lastParams().metadata;
    expect(md.listOnSupporters).toBe("false");
    expect(md.creditName).toBe("");
  });

  it("defaults to listOnSupporters='false' / creditName='' when omitted (base contract unchanged)", async () => {
    await run(monthly);
    const md = lastParams().metadata;
    expect(md.listOnSupporters).toBe("false");
    expect(md.creditName).toBe("");
  });

  it("rejects a payload that opts in without a display name with 400 and never calls Stripe", async () => {
    const res = await run({ ...monthly, listOnSupporters: true });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a profane display name with 400 and never calls Stripe", async () => {
    const res = await run({ ...monthly, listOnSupporters: true, creditName: "Fuck Off Ltd" });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a benign name that merely contains a shorter blocked word (Scunthorpe-safe)", async () => {
    const res = await run({ ...monthly, listOnSupporters: true, creditName: "Scunthorpe Rovers" });
    expect(res.statusCode).toBe(200);
    expect(lastParams().metadata.creditName).toBe("Scunthorpe Rovers");
  });

  it("rejects a display name over 200 characters with 400", async () => {
    const res = await run({ ...monthly, listOnSupporters: true, creditName: "a".repeat(201) });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkout-session — declaration scope + currency (REQ-041 / TASK-060)", () => {
  it("stamps metadata.declarationScope='enduring' for a monthly gift (pairs with an enduring declaration)", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "donor@example.com" });
    expect(lastParams().metadata.declarationScope).toBe("enduring");
  });

  it("stamps metadata.declarationScope='this_donation' for a one-off gift", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    expect(lastParams().metadata.declarationScope).toBe("this_donation");
  });

  it("stamps the declaration scope regardless of the Gift Aid opt-in", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: true, ageConfirmed: true, email: "donor@example.com" });
    expect(lastParams().metadata.declarationScope).toBe("enduring");
  });

  it("captures the frequency (mode) and currency explicitly on the session (REQ-041)", async () => {
    // A one-off carries its amount + GBP currency inline on the session price; the
    // frequency rides on metadata.mode. (A monthly gift's currency lives on its Stripe
    // recurring price.)
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const p = lastParams();
    expect(p.metadata.mode).toBe("once");
    expect(p.line_items[0].price_data.currency).toBe("gbp");
    expect(p.line_items[0].price_data.unit_amount).toBe(5000);
  });
});

describe("POST /api/checkout-session — Gift Aid declaration (REQ-043 / TASK-063)", () => {
  const decl = {
    title: "Dr",
    firstName: "Ada",
    lastName: "Lovelace",
    houseNameNumber: "12",
    address: "Analytical Avenue, London",
    postcode: "SW1A 1AA",
    nonUk: false,
  };

  it("accepts a gift-aided individual with a valid declaration and stamps the fields onto metadata", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: true, declaration: decl, email: "donor@example.com" });
    expect(res.statusCode).toBe(200);
    const md = lastParams().metadata;
    expect(md.declFirstName).toBe("Ada");
    expect(md.declLastName).toBe("Lovelace");
    expect(md.declHouseNameNumber).toBe("12");
    expect(md.declAddress).toBe("Analytical Avenue, London");
    expect(md.declPostcode).toBe("SW1A 1AA");
    expect(md.declTitle).toBe("Dr");
    expect(md.declNonUk).toBe("false");
  });

  it("rejects a gift-aided declaration with a malformed postcode with 400 and never calls Stripe", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      declaration: { ...decl, postcode: "NOPE" },
    });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a gift-aided declaration missing the house name/number with 400", async () => {
    const { houseNameNumber, ...noHouse } = decl;
    void houseNameNumber;
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: true, declaration: noHouse });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("exempts a non-UK gift-aided declaration from the postcode requirement", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: {
        firstName: "Jean",
        lastName: "Le Maistre",
        houseNameNumber: "La Rue",
        address: "St Helier, Jersey",
        nonUk: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const md = lastParams().metadata;
    expect(md.declNonUk).toBe("true");
    expect(md.declPostcode).toBe("");
    expect(md.declFirstName).toBe("Jean");
  });

  it("accepts a declaration that carries an explicit scope (the give widget now folds it in, TASK-064)", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: { ...decl, scope: "this_donation" },
    });
    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledOnce();
  });

  it("stamps no declaration metadata when Gift Aid is not opted in", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    expect(lastParams().metadata.declFirstName).toBeUndefined();
  });
});

describe("POST /api/checkout-session — explicit declaration scope override (REQ-044 / TASK-065)", () => {
  const decl = {
    firstName: "Ada",
    lastName: "Lovelace",
    houseNameNumber: "12",
    address: "Analytical Avenue, London",
    postcode: "SW1A 1AA",
    nonUk: false,
  };

  it("lets an explicit declaration.scope='all_donations' override the once→this_donation default", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: { ...decl, scope: "all_donations" },
    });
    // The donor's explicit choice wins over the mode-derived default (once → this_donation).
    expect(lastParams().metadata.declarationScope).toBe("all_donations");
  });

  it("binds the all-donations wording when the donor overrides a one-off to all_donations", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: { ...decl, scope: "all_donations" },
    });
    const md = lastParams().metadata;
    const wording = selectDeclarationWording({ mode: "once", scope: "all_donations" });
    expect(md.giftAidWordingVersion).toBe(wording.wording_version);
    expect(md.giftAidWording).toBe(wording.wording_snapshot);
  });

  it("honours an explicit declaration.scope='this_donation' on a one-off", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: { ...decl, scope: "this_donation" },
    });
    expect(lastParams().metadata.declarationScope).toBe("this_donation");
  });

  it("falls back to the mode-derived default when declaration.scope is absent", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: true,
      email: "donor@example.com",
      declaration: decl,
    });
    expect(lastParams().metadata.declarationScope).toBe("this_donation");
  });
});

describe("POST /api/checkout-session — partnership shares (REQ-051 / TASK-081)", () => {
  const partner = (firstName: string, sharePence: number) => ({
    firstName,
    lastName: "Partner",
    houseNameNumber: "1",
    address: "Partnership House, London",
    postcode: "SW1A 1AA",
    nonUk: false,
    sharePence,
  });

  const partnershipBody = (partners: unknown[], amount = 10000) => ({
    mode: "once" as const,
    plan: null,
    amount,
    giftAid: true,
    donorType: "partnership" as const,
    email: "donor@example.com",
    partners,
  });

  it("accepts a partnership whose partner shares sum EXACTLY to the amount and stamps them onto metadata", async () => {
    const res = await run(partnershipBody([partner("Ada", 6000), partner("Grace", 4000)], 10000));
    expect(res.statusCode).toBe(200);
    expect(create).toHaveBeenCalledOnce();
    const md = lastParams().metadata;
    expect(md.donorType).toBe("partnership");
    const stamped = JSON.parse(md.partners);
    expect(stamped).toHaveLength(2);
    expect(stamped.reduce((a: number, p: { sharePence: number }) => a + p.sharePence, 0)).toBe(10000);
  });

  it("rejects a partnership whose shares OVER-sum the amount with 400 and never calls Stripe", async () => {
    const res = await run(partnershipBody([partner("Ada", 6000), partner("Grace", 5000)], 10000));
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a partnership whose shares UNDER-sum the amount with 400 and never calls Stripe", async () => {
    const res = await run(partnershipBody([partner("Ada", 6000), partner("Grace", 3000)], 10000));
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a partnership Gift Aid payload with no partners with 400", async () => {
    const res = await run(partnershipBody([], 10000));
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("does not stamp partners metadata for a partnership that did not opt into Gift Aid", async () => {
    // Without Gift Aid there is no declaration to make, so no partner shares are carried.
    const res = await run({
      mode: "once",
      plan: null,
      amount: 10000,
      giftAid: false,
      donorType: "partnership",
      email: "donor@example.com",
    });
    expect(res.statusCode).toBe(200);
    expect(lastParams().metadata.partners).toBeUndefined();
  });
});

describe("POST /api/checkout-session — company details (REQ-038 / TASK-085)", () => {
  const company = {
    legalName: "Acme Ltd",
    registrationNumber: "SC123456",
    contactName: "Ada Lovelace",
    contactEmail: "finance@acme.test",
    billingAddress: "1 Office Park, London",
    billingPostcode: "SW1A 1AA",
    considerationGiven: false,
  };
  const companyBody = (overrides = {}) => ({
    mode: "once" as const,
    plan: null,
    amount: 5000,
    giftAid: false,
    donorType: "company" as const,
    businessName: "Acme Ltd",
    company: { ...company, ...overrides },
  });

  it("accepts a valid company payload and stamps the company fields onto metadata", async () => {
    const res = await run(companyBody());
    expect(res.statusCode).toBe(200);
    const md = lastParams().metadata;
    expect(md.donorType).toBe("company");
    expect(md.companyLegalName).toBe("Acme Ltd");
    expect(md.companyRegistrationNumber).toBe("SC123456");
    expect(md.companyContactName).toBe("Ada Lovelace");
    expect(md.companyContactEmail).toBe("finance@acme.test");
    expect(md.companyBillingAddress).toBe("1 Office Park, London");
    expect(md.companyBillingPostcode).toBe("SW1A 1AA");
  });

  it("rejects a company payload missing the contactEmail with 400 and never calls Stripe", async () => {
    const { contactEmail, ...noEmail } = company;
    void contactEmail;
    const res = await run({ ...companyBody(), company: noEmail });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a company payload missing the billingAddress with 400", async () => {
    const { billingAddress, ...noAddr } = company;
    void billingAddress;
    const res = await run({ ...companyBody(), company: noAddr });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a company payload with no company object at all with 400", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "company", businessName: "Acme Ltd" });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts a company without a registration number (optional)", async () => {
    const { registrationNumber, ...noReg } = company;
    void registrationNumber;
    const res = await run({ ...companyBody(), company: noReg });
    expect(res.statusCode).toBe(200);
    expect(lastParams().metadata.companyRegistrationNumber).toBe("");
  });
});

describe("POST /api/checkout-session — invalid bodies return 400", () => {
  it.each([
    ["monthly with neither a plan nor an amount", { mode: "monthly", plan: null, amount: null, giftAid: false, ageConfirmed: true }],
    ["monthly not confirming 18 or over", { mode: "monthly", plan: "gold", amount: 5000, giftAid: false }],
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

describe("POST /api/checkout-session — mandatory email (REQ-039)", () => {
  it("rejects an individual donation with no email (REQ-039: email is mandatory)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 2500, giftAid: false, donorType: "individual" });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an individual donation with a malformed email", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 2500,
      giftAid: false,
      donorType: "individual",
      email: "not-an-email",
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts an individual donation that includes a valid email", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 2500,
      giftAid: false,
      donorType: "individual",
      email: "donor@example.com",
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/checkout-session — email pre-fill (TASK-203)", () => {
  it("pre-fills the Stripe email field with the captured email so the donor never retypes it", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    expect(lastParams().customer_email).toBe("donor@example.com");
  });

  it("pre-fills for a monthly gift too", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "ada@example.com" });
    expect(lastParams().customer_email).toBe("ada@example.com");
  });
});

describe("POST /api/checkout-session — embedded ui mode (TASK-215)", () => {
  it("returns { clientSecret, publishableKey } and no url for uiMode='embedded'", async () => {
    const res = await run({
      mode: "once",
      plan: null,
      amount: 5000,
      giftAid: false,
      email: "donor@example.com",
      uiMode: "embedded",
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { clientSecret?: string; publishableKey?: string; url?: string };
    expect(body.clientSecret).toBe("cs_test_secret_123");
    expect(body.publishableKey).toBe("pk_test_dummy_pk");
    expect(body.url).toBeUndefined();
  });

  it("sets ui_mode='embedded_page' + a return_url carrying {CHECKOUT_SESSION_ID}, and omits success_url/cancel_url", async () => {
    await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com", uiMode: "embedded" });
    const p = lastParams();
    // Stripe SDK enum: the inline UI is "embedded_page"; the hosted redirect is the unset default.
    expect(p.ui_mode).toBe("embedded_page");
    // The return_url reuses the SAME on-site base as the hosted success URL and carries the type-aware
    // mode+donor params (TASK-221) plus the session id template Stripe substitutes on redirect (the
    // braces must NOT be URL-encoded).
    expect(p.return_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    expect(p.success_url).toBeUndefined();
    expect(p.cancel_url).toBeUndefined();
  });

  it("keeps the hosted redirect { url } as the default when uiMode is absent (unchanged)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    const body = res.body as { url?: string; clientSecret?: string };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(body.clientSecret).toBeUndefined();
    const p = lastParams();
    expect(p.ui_mode).toBeUndefined();
    expect(p.success_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.test/donate");
  });

  it("returns { url } for an explicit uiMode='hosted' (byte-for-byte the existing behaviour)", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com", uiMode: "hosted" });
    const body = res.body as { url?: string; clientSecret?: string };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(body.clientSecret).toBeUndefined();
    expect(lastParams().ui_mode).toBeUndefined();
  });

  it("treats uiMode='embedded' as hosted { url } when no publishable key is configured (dormant)", async () => {
    // With no key set, embedded stays dormant: the server serves the hosted redirect (never mints an
    // embedded session the browser could not use), so shipping before the gated infra apply is safe.
    mockConfig.STRIPE_PUBLISHABLE_KEY = "";
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com", uiMode: "embedded" });
    expect(res.statusCode).toBe(200);
    const body = res.body as { url?: string; clientSecret?: string; publishableKey?: string };
    expect(body.url).toBe("https://checkout.stripe.com/c/pay/test_123");
    expect(body.clientSecret).toBeUndefined();
    expect(body.publishableKey).toBeUndefined();
    const p = lastParams();
    expect(p.ui_mode).toBeUndefined();
    expect(p.success_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
    expect(p.cancel_url).toBe("https://nbcc.test/donate");
  });

  it("stamps IDENTICAL metadata, line_items, mode and customer_email across hosted and embedded", async () => {
    // The webhook + confirmation email depend ONLY on the session metadata/line-items/mode, so the
    // two UI modes must differ solely in the redirect surface. A gift-aided monthly gift exercises
    // the richest metadata path (wording snapshot + declaration + scope).
    const bodyBase = {
      mode: "monthly" as const,
      plan: "gold" as const,
      amount: 5000,
      giftAid: true,
      ageConfirmed: true,
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      declaration: {
        firstName: "Ada",
        lastName: "Lovelace",
        houseNameNumber: "12",
        address: "Analytical Avenue, London",
        postcode: "SW1A 1AA",
        nonUk: false,
      },
    };
    await run({ ...bodyBase }); // hosted (default)
    const hosted = lastParams();
    await run({ ...bodyBase, uiMode: "embedded" }); // embedded
    const embedded = lastParams();
    expect(embedded.metadata).toEqual(hosted.metadata);
    expect(embedded.line_items).toEqual(hosted.line_items);
    expect(embedded.mode).toEqual(hosted.mode);
    expect(embedded.customer_email).toEqual(hosted.customer_email);
    expect(embedded.payment_method_types).toEqual(hosted.payment_method_types);
  });

  it("validates the body the same way in embedded mode (monthly not confirming 18+ is 400, never calls Stripe)", async () => {
    const res = await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, email: "donor@example.com", uiMode: "embedded" });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown uiMode with 400 and never calls Stripe", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com", uiMode: "popup" });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/checkout-session — type-aware thank-you redirect (TASK-221)", () => {
  const company = {
    legalName: "Acme Ltd",
    contactName: "Ada Lovelace",
    contactEmail: "finance@acme.test",
    billingAddress: "1 Office Park, London",
    billingPostcode: "SW1A 1AA",
    considerationGiven: false,
  };

  it("carries mode+donor+session_id on the hosted success_url for a monthly company gift", async () => {
    await run({
      mode: "monthly",
      plan: "platinum",
      amount: 10000,
      giftAid: false,
      ageConfirmed: true,
      donorType: "company",
      businessName: "Acme Ltd",
      company,
    });
    const p = lastParams();
    expect(p.success_url).toBe(
      "https://nbcc.test/donate/thank-you?mode=monthly&donor=company&session_id={CHECKOUT_SESSION_ID}",
    );
    // The braces of the Stripe session-id template must NOT be URL-encoded (Stripe substitutes them).
    expect(p.success_url).toContain("{CHECKOUT_SESSION_ID}");
  });

  it("carries mode+donor+session_id on the embedded return_url for a monthly company gift", async () => {
    await run({
      mode: "monthly",
      plan: "platinum",
      amount: 10000,
      giftAid: false,
      ageConfirmed: true,
      donorType: "company",
      businessName: "Acme Ltd",
      company,
      uiMode: "embedded",
    });
    const p = lastParams();
    expect(p.return_url).toBe(
      "https://nbcc.test/donate/thank-you?mode=monthly&donor=company&session_id={CHECKOUT_SESSION_ID}",
    );
    expect(p.success_url).toBeUndefined();
  });

  it("stamps donor=individual for an individual monthly gift", async () => {
    await run({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false, ageConfirmed: true, email: "ada@example.com" });
    expect(lastParams().success_url).toBe(
      "https://nbcc.test/donate/thank-you?mode=monthly&donor=individual&session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("stamps donor=partnership for a partnership gift", async () => {
    await run({
      mode: "once",
      plan: null,
      amount: 10000,
      giftAid: false,
      donorType: "partnership",
      email: "donor@example.com",
    });
    expect(lastParams().success_url).toBe(
      "https://nbcc.test/donate/thank-you?mode=once&donor=partnership&session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("keeps the hosted and embedded landing URLs identical (only the redirect surface differs)", async () => {
    const body = { mode: "monthly" as const, plan: "gold" as const, amount: 5000, giftAid: false, ageConfirmed: true, email: "ada@example.com" };
    await run(body);
    const hostedSuccess = lastParams().success_url;
    await run({ ...body, uiMode: "embedded" });
    const embeddedReturn = lastParams().return_url;
    expect(embeddedReturn).toBe(hostedSuccess);
  });
});

describe("POST /api/checkout-session — upstream failure", () => {
  it("returns 502 when the Stripe call throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    create.mockRejectedValueOnce(new Error("stripe unavailable"));
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, email: "donor@example.com" });
    expect(res.statusCode).toBe(502);
    expect(errSpy).toHaveBeenCalled(); // the failure is logged for diagnosis
    errSpy.mockRestore();
  });
});
