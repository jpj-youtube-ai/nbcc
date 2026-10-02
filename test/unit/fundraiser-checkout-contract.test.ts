// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-494: the contract between the fundraiser page's give form (assets/js/fundraiser.js) and the
// real POST /api/checkout-session. The body the browser builds is fed, unchanged, to the real route
// handler (Stripe mocked), so if either side changes shape this fails rather than a gift failing on
// the night. Every name and address here is invented.

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../src/clients/stripe", () => ({ stripe: { checkout: { sessions: { create } } }, stripeConfigured: true }));
vi.mock("../../src/config", () => ({
  config: {
    STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
    STRIPE_CANCEL_URL: "https://nbcc.test/donate",
    STRIPE_DONATION_PRODUCT: undefined,
    STRIPE_PUBLISHABLE_KEY: "",
    NODE_ENV: "test",
  },
}));

import { postCheckoutSession } from "../../src/routes/api";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter } from "../../src/fundraising/model";

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const { initGiveForm } = require(resolve(ROOT, "assets/js/fundraiser.js"));

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
      set("frMessage", "Go Robin");
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
    expect(params.metadata).toMatchObject({ fundraiserId: "41", supporterMessage: "Go Robin", showName: "true", showAmount: "true", giftAid: "true" });
  });

  it("is accepted anonymously, with the amount hidden and no Gift Aid", async () => {
    const body = browserBody((set) => {
      set("frOwnAmount", "2");
      set("frFirstName", "Sam");
      set("frSurname", "Sample");
      set("frEmail", "sam@example.com");
      set("frShowNameNo", true);
      set("frShowAmount", false);
    });
    const res = await post(body);
    expect(res.statusCode, JSON.stringify(res.body)).toBe(200);
    expect(create.mock.calls[0][0].metadata).toMatchObject({ showName: "false", showAmount: "false" });
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

describe("a message the core refuses", () => {
  // The core checks the supporter's message as it checks a name on the supporters wall. The give form
  // shows the refusal beside the message box by reading details.fieldErrors.supporterMessage
  // (test/unit/fundraiser-page.test.ts); this pins that the real route answers in that shape.
  it("comes back where the give form looks for it", async () => {
    const body = browserBody((set) => {
      set("frOwnAmount", "5");
      set("frFirstName", "Alex");
      set("frSurname", "Example");
      set("frEmail", "alex@example.com");
      set("frMessage", "what a load of bollocks");
    });
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const said = (res.body as any)?.details?.fieldErrors?.supporterMessage?.[0];
    expect(typeof said).toBe("string");
    expect(said.length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });
});
