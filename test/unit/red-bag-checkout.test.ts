import { describe, it, expect, vi, beforeEach } from "vitest";

// Fill a Red Bag: the one shared change, POST /api/checkout-session with the optional marker
// redBag: true (docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md, "The one shared change").
// Only with the marker: £2 at least, never with a fundraiser, one more metadata key, and return
// addresses the SERVER works out. While the page is switched off, only a signed in member of staff
// may make one. A donate page gift is untouched: it gains no keys and asks nothing of anyone.
// Every name and address here is invented.

const { create, getUserAuthRow, live } = vi.hoisted(() => ({ create: vi.fn(), getUserAuthRow: vi.fn(), live: { value: false } }));
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
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow }));
vi.mock("../../src/red-bag/switch", async (original) => ({
  ...(await original<typeof import("../../src/red-bag/switch")>()),
  redBagIsLive: () => live.value,
}));

import { buildSessionParams, postCheckoutSession } from "../../src/routes/api";
import { signAdminSession } from "../../src/admin/session";
import { DEFAULT_CARD_FEE } from "../../src/ball/pricing";

async function run(body: unknown, authorization?: string) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body, headers: authorization ? { authorization } : {} } as any, res as any);
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const params = (): any => create.mock.calls[create.mock.calls.length - 1][0];

const staffToken = (over: { secret?: string; now?: Date } = {}) =>
  `Bearer ${signAdminSession({ sub: 3, email: "sam@example.com", role: "viewer", now: over.now ?? new Date(), secret: over.secret ?? cfg.ADMIN_SESSION_SECRET }).token}`;

const gift = { mode: "once", plan: null, amount: 5410, giftAid: false, email: "alex@example.com", fullName: "Alex Example" };
const bag = { ...gift, redBag: true };
const PAGE = "https://nbcc.test/fill-a-red-bag";
const THANKS = `${PAGE}?thanks=1&session_id={CHECKOUT_SESSION_ID}`;

beforeEach(() => {
  live.value = false;
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
  getUserAuthRow.mockReset().mockResolvedValue({ id: 3, email: "sam@example.com", status: "active", role: "viewer", permissions: {} });
});

describe("a Red Bag gift's rules", () => {
  beforeEach(() => {
    live.value = true;
  });

  it("takes £2", async () => {
    expect((await run({ ...bag, amount: 200 })).statusCode).toBe(200);
  });

  it("refuses less than £2", async () => {
    const res = await run({ ...bag, amount: 199 });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("the smallest Fill a Red Bag gift is £2");
    expect(create).not.toHaveBeenCalled();
  });

  it("is never also a gift on a fundraiser's page", async () => {
    const res = await run({ ...bag, fundraiserId: 7 });
    expect(res.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves a donate page gift under £2 exactly as it was (no minimum of ours)", async () => {
    expect((await run({ ...gift, amount: 100 })).statusCode).toBe(200);
  });

  it("can be monthly, the donate page's way", async () => {
    const res = await run({ ...bag, mode: "monthly", ageConfirmed: true, coverFee: true });
    expect(res.statusCode).toBe(200);
    expect(params().mode).toBe("subscription");
    expect(params().metadata.redBag).toBe("true");
    // No fee cover on a monthly gift, as on the donate page.
    expect(params().metadata.feeCoverPence).toBe("0");
    expect(params().line_items).toHaveLength(1);
  });
});

describe("what a Red Bag gift's Stripe session carries", () => {
  beforeEach(() => {
    live.value = true;
  });

  it("is marked, with one key", async () => {
    await run(bag);
    expect(params().metadata.redBag).toBe("true");
  });

  it("is otherwise the donate page's session: same metadata, same line", async () => {
    const plain = buildSessionParams({ ...gift, coverFee: false, uiMode: "hosted", donorType: "individual" } as never, DEFAULT_CARD_FEE);
    const marked = buildSessionParams({ ...gift, coverFee: false, uiMode: "hosted", donorType: "individual", redBag: true } as never, DEFAULT_CARD_FEE);
    expect(marked.metadata).toStrictEqual({ ...plain.metadata, redBag: "true" });
    expect(marked.line_items).toStrictEqual(plain.line_items);
    expect(marked.mode).toBe(plain.mode);
    expect(marked.customer_email).toBe("alex@example.com");
  });

  it("comes back to the page with a thank you, and cancels back to the page (Stripe's own page)", async () => {
    await run(bag);
    expect(params().success_url).toBe(THANKS);
    expect(params().cancel_url).toBe(PAGE);
    expect(params().return_url).toBeUndefined();
  });

  it("comes back the same way when Stripe opens on our page", async () => {
    await run({ ...bag, uiMode: "embedded" });
    expect(params().ui_mode).toBe("embedded_page");
    expect(params().return_url).toBe(THANKS);
    expect(params().success_url).toBeUndefined();
    expect(params().cancel_url).toBeUndefined();
  });

  it("carries Stripe's session id placeholder unencoded, for Stripe to fill in", async () => {
    await run(bag);
    expect(params().success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
    expect(params().success_url).not.toContain("%7B");
  });

  it("never takes a return address from the browser", async () => {
    await run({ ...bag, success_url: "https://elsewhere.example/x", return_url: "https://elsewhere.example/y", cancel_url: "https://elsewhere.example/z", returnUrl: "https://elsewhere.example" });
    expect(JSON.stringify(params())).not.toContain("elsewhere.example");
    expect(params().success_url).toBe(THANKS);
  });
});

describe("a donate page gift gains nothing", () => {
  it("has no redBag key, whatever the switch says", async () => {
    for (const on of [false, true]) {
      live.value = on;
      await run(gift);
      expect(Object.keys(params().metadata)).not.toContain("redBag");
      expect(params().success_url).toBe("https://nbcc.test/donate/thank-you?mode=once&donor=individual&session_id={CHECKOUT_SESSION_ID}");
      expect(params().cancel_url).toBe("https://nbcc.test/donate");
    }
  });

  it("has exactly the keys it always had", () => {
    const p = buildSessionParams({ ...gift, coverFee: false, uiMode: "hosted", donorType: "individual" } as never, DEFAULT_CARD_FEE);
    expect(Object.keys(p.metadata ?? {}).sort()).toEqual(
      ["ageConfirmed", "anonymous", "businessName", "creditName", "declarationScope", "donorType", "email", "emailConsent", "feeCoverPence", "fullName", "giftAid", "listOnSupporters", "mode", "plan"].sort(),
    );
    expect(Object.keys(p).sort()).toEqual(["cancel_url", "customer_email", "line_items", "metadata", "mode", "payment_method_types", "success_url"]);
  });

  it("treats redBag: false as no marker at all", async () => {
    await run({ ...gift, redBag: false });
    expect(Object.keys(params().metadata)).not.toContain("redBag");
    expect(params().cancel_url).toBe("https://nbcc.test/donate");
  });

  it("never asks who is signed in", async () => {
    await run(gift, staffToken());
    expect(getUserAuthRow).not.toHaveBeenCalled();
  });
});

describe("while Fill a Red Bag is switched off", () => {
  it("refuses a Red Bag gift from the public, and never reaches Stripe", async () => {
    const res = await run(bag);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Fill a Red Bag is not open yet" });
    expect(create).not.toHaveBeenCalled();
  });

  it("still says what is wrong with a gift under £2 first", async () => {
    expect((await run({ ...bag, amount: 150 })).statusCode).toBe(400);
  });

  it("takes one from a signed in member of staff", async () => {
    const res = await run(bag, staffToken());
    expect(res.statusCode).toBe(200);
    expect(getUserAuthRow).toHaveBeenCalledWith(3);
    expect(params().metadata.redBag).toBe("true");
    expect(params().success_url).toBe(THANKS);
  });

  it("refuses a session that is forged, expired, or not a session", async () => {
    const day = 24 * 60 * 60 * 1000;
    for (const auth of [staffToken({ secret: "another-secret" }), staffToken({ now: new Date(Date.now() - day) }), "Bearer nonsense", "Basic abc"]) {
      expect((await run(bag, auth)).statusCode, auth).toBe(403);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses staff whose account is switched off or gone", async () => {
    getUserAuthRow.mockResolvedValueOnce({ id: 3, email: "sam@example.com", status: "disabled", role: "admin", permissions: {} });
    expect((await run(bag, staffToken())).statusCode).toBe(403);
    getUserAuthRow.mockResolvedValueOnce(null);
    expect((await run(bag, staffToken())).statusCode).toBe(403);
  });

  it("refuses when it cannot tell (the database is down)", async () => {
    getUserAuthRow.mockRejectedValueOnce(new Error("down"));
    expect((await run(bag, staffToken())).statusCode).toBe(403);
  });
});

describe("once it is switched on", () => {
  it("takes a Red Bag gift from anyone", async () => {
    live.value = true;
    expect((await run(bag)).statusCode).toBe(200);
    expect(getUserAuthRow).not.toHaveBeenCalled();
  });
});

// The marker adds rules; it takes none away. A company or a partnership filling a Red Bag is held
// to exactly what the donate page holds them to.
describe("a Red Bag gift keeps every existing rule for who is giving", () => {
  const company = {
    legalName: "Example Widgets Ltd",
    contactName: "Alex Example",
    contactEmail: "accounts@example.com",
    billingAddress: "1 Example Street, Exampleton",
    billingPostcode: "KA1 1AA",
    considerationGiven: false,
  };
  const partner = (sharePence: number, firstName: string) => ({
    firstName,
    lastName: "Example",
    houseNameNumber: "12",
    address: "Example Street, Exampleton",
    postcode: "KA1 1AA",
    nonUk: false,
    sharePence,
  });

  beforeEach(() => {
    live.value = true;
  });

  it("a company: takes one with its company details, and stamps them as the donate page does", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "company", company, redBag: true });
    expect(res.statusCode).toBe(200);
    expect(params().metadata).toMatchObject({ redBag: "true", donorType: "company", companyLegalName: "Example Widgets Ltd", companyContactEmail: "accounts@example.com", giftAid: "false" });
    expect(params().success_url).toBe(THANKS);
  });

  it("a company: still needs its company details", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "company", redBag: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a company donation requires company details");
    expect(create).not.toHaveBeenCalled();
  });

  it("a company: still cannot claim Gift Aid", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: true, donorType: "company", company, redBag: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a company donation cannot claim Gift Aid");
    expect(create).not.toHaveBeenCalled();
  });

  it("a company: is still held to £2", async () => {
    expect((await run({ mode: "once", plan: null, amount: 150, giftAid: false, donorType: "company", company, redBag: true })).statusCode).toBe(400);
  });

  it("a partnership: takes one whose partners' shares add up to the gift", async () => {
    const res = await run({ ...bag, amount: 5000, giftAid: true, donorType: "partnership", partners: [partner(3000, "Alex"), partner(2000, "Sam")] });
    expect(res.statusCode).toBe(200);
    expect(params().metadata.redBag).toBe("true");
    expect(params().metadata.donorType).toBe("partnership");
    expect(JSON.parse(params().metadata.partners)).toHaveLength(2);
  });

  it("a partnership: still refuses shares that do not add up, or no partners at all", async () => {
    expect((await run({ ...bag, amount: 5000, giftAid: true, donorType: "partnership", partners: [partner(3000, "Alex"), partner(1000, "Sam")] })).statusCode).toBe(400);
    expect((await run({ ...bag, amount: 5000, giftAid: true, donorType: "partnership" })).statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("a partnership: still needs an email", async () => {
    const res = await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "partnership", redBag: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toContain("a valid email is required");
  });

  it("a company or partnership is refused from the public like anyone else while it is switched off", async () => {
    live.value = false;
    expect((await run({ mode: "once", plan: null, amount: 5000, giftAid: false, donorType: "company", company, redBag: true })).statusCode).toBe(403);
    expect((await run({ ...bag, amount: 5000, giftAid: true, donorType: "partnership", partners: [partner(5000, "Alex")] })).statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
});
