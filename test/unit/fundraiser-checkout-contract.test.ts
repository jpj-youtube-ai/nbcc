// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-494: the contract between the fundraiser page's give form (assets/js/fundraiser.js) and the
// real POST /api/checkout-session. The body the browser builds is fed, unchanged, to the real route
// handler (Stripe mocked), so if either side changes shape this fails rather than a gift failing on
// the night. TASK-502: the same for the optional step on the thank you after paying and the real
// POST /api/fundraisers/:slug/wall-message. Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
const wall = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/db/fundraisers", () => ({
  fundraisingIsOn: async () => true,
  getFundraiser: async () => null,
  getBySlug: async () => ({ id: 41, slug: "robins-santa-dash", status: "approved", public: true, path: "raising" }),
  addWallMessage: wall.add,
}));
vi.mock("../../src/db/fundraiser-sign-in", () => ({}));
vi.mock("../../src/fundraising/send", () => ({ fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}` }));
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/config", () => ({
  config: {
    ADMIN_SESSION_SECRET: "a-test-secret",
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "",
    NODE_ENV: "test",
  },
}));

import { postCheckoutSession } from "../../src/routes/api";
import { postWallMessage } from "../../src/routes/fundraise";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter } from "../../src/fundraising/model";

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initGiveForm, initWallStep } = require(resolve(ROOT, "assets/js/fundraiser.js"));

function browserBody(fill: (set: (id: string, v: string | boolean) => void) => void): Record<string, unknown> {
  const html = renderFundraiserPage(
    readFileSync(resolve(ROOT, "fundraiser.html"), "utf8"),
    {
      id: 41, slug: "robins-santa-dash", path: "raising", kind: "santa_dash", kindLabel: "A Santa dash", title: "Robin's Santa Dash",
      description: "Five kilometres.", eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, organisedBy: "Robin Q.",
      url: "/fundraise/robins-santa-dash", meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }), wall: [],
      giving: { fundraiserId: 41, minimumPence: 200 },
    },
    { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date() },
  );
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  const api = initGiveForm(document, window, { assign: () => {} });
  fill((id, v) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (typeof v === "boolean") el.checked = v;
    else el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return api.payload();
}

async function post(body: unknown) {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postCheckoutSession({ body } as any, res as any);
  return res;
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "cs_test_1", url: "https://checkout.stripe.test/1", client_secret: "s" });
});

describe("the give form's body, through the real checkout", () => {
  it("is accepted with Gift Aid, and carries the fundraiser to Stripe", async () => {
    const body = browserBody((set) => {
      set("frOwnAmount", "12.50");
      set("frFirstName", "Alex");
      set("frSurname", "Example");
      set("frEmail", "alex@example.com");
      set("frGiftAid", true);
      set("frHouse", "12");
      set("frAddress", "Example Road, Exampleton");
      set("frPostcode", "KA1 1AA");
      set("frCoverFee", true);
    });
    const res = await post(body);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe("payment");
    // TASK-502: no message, and the name off the wall until the giver chooses after paying.
    expect(params.metadata).toMatchObject({ fundraiserId: "41", supporterMessage: "", showName: "false", showAmount: "true", giftAid: "true" });
  });

  it("is accepted at the smallest amount, with no Gift Aid", async () => {
    const body = browserBody((set) => {
      set("frOwnAmount", "2");
      set("frFirstName", "Sam");
      set("frSurname", "Sample");
      set("frEmail", "sam@example.com");
    });
    const res = await post(body);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(create.mock.calls[0][0].metadata).toMatchObject({ giftAid: "false", fundraiserId: "41" });
  });

  it("is accepted from a home outside the UK, with no postcode", async () => {
    const body = browserBody((set) => {
      set("frOwnAmount", "5");
      set("frFirstName", "Pat");
      set("frSurname", "Example");
      set("frEmail", "pat@example.com");
      set("frGiftAid", true);
      set("frHouse", "3");
      set("frAddress", "Example Street, Example Town, Isle of Example");
      set("frNonUk", true);
    });
    const res = await post(body);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
  });
});

// --- TASK-502: the optional step on the thank you after paying -----------------------------------

const SESSION = "cs_test_contract1";

/** The body the thank you's step sends, as the browser builds it. */
async function stepBody(fill: (set: (id: string, v: string | boolean) => void) => void): Promise<Record<string, unknown>> {
  const html = renderFundraiserPage(
    readFileSync(resolve(ROOT, "fundraiser.html"), "utf8"),
    {
      id: 41, slug: "robins-santa-dash", path: "raising", kind: "santa_dash", kindLabel: "A Santa dash", title: "Robin's Santa Dash",
      description: "Five kilometres.", eventDate: null, startTime: null, venue: "", town: "", imageSrc: null, organisedBy: "Robin Q.",
      url: "/fundraise/robins-santa-dash", meter: meter({ onlinePence: 0, cashPence: 0, targetPence: null }), wall: [],
      giving: { fundraiserId: 41, minimumPence: 200 },
    },
    { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(), thanks: { message: false, sessionId: SESSION } },
  );
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  let sent: { url: string; body: Record<string, unknown> } | null = null;
  const win = {
    fetch: (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
    },
  };
  initWallStep(document, win, { assign: () => {} });
  fill((id, v) => {
    const el = document.getElementById(id) as HTMLInputElement;
    if (typeof v === "boolean") el.checked = v;
    else el.value = v;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  document.getElementById("frWallForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(sent!.url).toBe("/api/fundraisers/robins-santa-dash/wall-message");
  return sent!.body;
}

async function postStep(body: unknown) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader() { return this; },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await postWallMessage({ body, params: { slug: "robins-santa-dash" }, ip: "10.3.0.1", headers: { host: "nbcc.test", "sec-fetch-site": "same-origin" } } as any, res as any);
  return res;
}

describe("the thank you's step, through the real route", () => {
  beforeEach(() => wall.add.mockReset().mockResolvedValue({ verdict: "ok", entry: null }));

  it("is accepted, with the words and the two choices", async () => {
    const body = await stepBody((set) => {
      set("frMessage", "Go Robin");
      set("frShowNameNo", true);
      set("frShowAmount", false);
    });
    const res = await postStep(body);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(wall.add).toHaveBeenCalledWith(SESSION, 41, { message: "Go Robin", showName: false, showAmount: false });
  });

  // The step shows a refusal of the words beside the message box by reading fields.message
  // (test/unit/fundraiser-page.test.ts); this pins that the real route answers in that shape.
  it("refuses rude words where the step looks for it", async () => {
    const body = await stepBody((set) => set("frMessage", "what a load of bollocks"));
    const res = await postStep(body);
    expect(res.statusCode).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const said = (res.body as any)?.fields?.message;
    expect(typeof said).toBe("string");
    expect(said.length).toBeGreaterThan(0);
    expect(wall.add).not.toHaveBeenCalled();
  });
});
