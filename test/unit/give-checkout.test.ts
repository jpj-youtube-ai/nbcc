// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-036 (REQ-028): the donate front-end checkout contract. Every tier/amount
// control in #tiersOnce and #tiersMonthly, plus the choose-your-own custom-amount
// control, carries data-mode (once/monthly), data-plan (bronze/silver/gold/
// platinum, empty for one-off) and data-amount (pence, empty for custom), and
// calls startCheckout(button). startCheckout reads those plus the #giftAid
// checkbox (REQ-023) into one { mode, plan, amount, giftAid } payload: in preview
// it shows the payload (alert); in production it POSTs to /api/checkout-session
// (REQ-029) and redirects to the returned Stripe url, degrading to the preview
// when that endpoint is absent/unavailable. Static markup is parsed with jsdom;
// behaviour runs against the real startCheckout/initCheckout from main.js,
// mirroring give-once-tiers / give-monthly-tiers / contact tests.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "donate.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

// The four amounts (pence) in tier order, shared by once and monthly.
const ONCE_PENCE = [1000, 2500, 5000, 10000];
const MONTHLY = [
  { plan: "bronze", amount: 1000 },
  { plan: "silver", amount: 2500 },
  { plan: "gold", amount: 5000 },
  { plan: "platinum", amount: 10000 },
];

describe("donate checkout contract markup (REQ-028)", () => {
  const onceTiers = [...doc.querySelectorAll("#tiersOnce .give-tier")];
  const monthlyTiers = [...doc.querySelectorAll("#tiersMonthly .give-tier")];

  it("wires every once tier: data-mode=once, empty data-plan, data-amount in pence", () => {
    expect(onceTiers).toHaveLength(4);
    onceTiers.forEach((t, i) => {
      expect(t.getAttribute("data-mode")).toBe("once");
      expect(t.getAttribute("data-plan")).toBe("");
      expect(t.getAttribute("data-amount")).toBe(String(ONCE_PENCE[i]));
    });
  });

  it("wires every monthly tier: data-mode=monthly, data-plan, data-amount in pence", () => {
    expect(monthlyTiers).toHaveLength(4);
    monthlyTiers.forEach((t, i) => {
      expect(t.getAttribute("data-mode")).toBe("monthly");
      expect(t.getAttribute("data-plan")).toBe(MONTHLY[i].plan);
      expect(t.getAttribute("data-amount")).toBe(String(MONTHLY[i].amount));
    });
  });

  it("wires the choose-your-own control on the .give-tier-custom container: once, empty plan, empty amount (TASK-210)", () => {
    const custom = doc.querySelector("#tiersOnce .give-tier-custom");
    expect(custom).not.toBeNull();
    // TASK-210: the redundant per-amount Donate button was removed. The container itself now
    // carries the checkout contract (data-mode/data-plan/data-amount) and the single step CTA
    // drives startCheckout with it, so the /api/checkout-session payload shape is unchanged.
    expect(custom?.getAttribute("data-mode")).toBe("once");
    expect(custom?.getAttribute("data-plan")).toBe("");
    expect(custom?.getAttribute("data-amount")).toBe("");
    expect(custom?.querySelector("#customAmount")).not.toBeNull();
    expect(custom?.querySelector("button")).toBeNull();
  });

  it("keeps the once/monthly toggle buttons OUT of the contract (no data-amount)", () => {
    expect(doc.querySelector("#giveOnce")?.hasAttribute("data-amount")).toBe(false);
    expect(doc.querySelector("#giveMonthly")?.hasAttribute("data-amount")).toBe(false);
  });
});

describe("startCheckout behaviour (jsdom)", () => {
  const { startCheckout, initCheckout } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";

  let alerts: string[];
  const lastPayload = () => {
    const a = alerts[alerts.length - 1];
    return JSON.parse(a.slice(a.indexOf("{")));
  };
  const onceTier = (i: number) =>
    document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;
  const monthlyTier = (i: number) =>
    document.querySelectorAll("#tiersMonthly .give-tier")[i] as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `<main>${cardHtml}</main>`;
    alerts = [];
    window.alert = (m?: string) => {
      alerts.push(String(m));
    };
    // Preview behaviour: no backend wired, so the payload is shown (REQ-029).
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initCheckout(document, window);
  });

  it("exports startCheckout and initCheckout from the shared script", () => {
    expect(typeof startCheckout).toBe("function");
    expect(typeof initCheckout).toBe("function");
  });

  it("a selected once tier assembles the once payload in preview", () => {
    startCheckout(onceTier(0), window); // £10
    expect(alerts).toHaveLength(1);
    expect(lastPayload()).toEqual({ mode: "once", plan: null, amount: 1000, giftAid: false });
  });

  it("includes giftAid:true when the Gift Aid box is checked (REQ-023)", () => {
    (document.getElementById("giftAid") as HTMLInputElement).checked = true;
    startCheckout(onceTier(1), window); // £25
    expect(lastPayload()).toEqual({ mode: "once", plan: null, amount: 2500, giftAid: true });
  });

  it("a selected monthly tier assembles the monthly payload with its plan", () => {
    startCheckout(monthlyTier(2), window); // gold £50
    expect(lastPayload()).toEqual({ mode: "monthly", plan: "gold", amount: 5000, giftAid: false });
  });

  it("the custom-amount control builds the amount (pence) from the entered value", () => {
    (document.getElementById("customAmount") as HTMLInputElement).value = "30";
    // TASK-210: startCheckout reads the custom amount from the .give-tier-custom container now
    // (the per-amount button was removed); the assembled payload shape is unchanged.
    const custom = document.querySelector("#tiersOnce .give-tier-custom") as HTMLElement;
    startCheckout(custom, window);
    expect(lastPayload()).toEqual({ mode: "once", plan: null, amount: 3000, giftAid: false });
  });

  it("startCheckout returns the assembled payload", () => {
    const payload = startCheckout(monthlyTier(0), window); // bronze £10
    expect(payload).toEqual({ mode: "monthly", plan: "bronze", amount: 1000, giftAid: false });
  });
});

// TASK-215: Stripe Embedded Checkout progressive enhancement. When JS + Stripe.js + the on-page
// mount are present, startCheckout requests uiMode:"embedded", gets a { clientSecret, publishableKey }
// and mounts inline. On ANY failure (Stripe.js absent, embedded init throws) it falls back to the
// EXISTING hosted redirect (POST with no uiMode → { url } → location.href), so the button is never
// dead. A fake `win` is passed so location.href assignment never triggers jsdom navigation, and the
// returned/previewed payload stays the exact REQ-028 contract (uiMode rides only on the wire body).
describe("startCheckout embedded checkout (jsdom, TASK-215)", () => {
  const { startCheckout } = require(resolve(ROOT, "assets/js/main.js"));
  const cardHtml = doc.querySelector(".give-card")?.outerHTML ?? "";
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function setupDom(): void {
    document.body.innerHTML =
      `<main>${cardHtml}</main>` +
      `<div id="embeddedCheckoutModal" hidden aria-hidden="true">` +
      `<button id="embeddedCheckoutClose" type="button">Close</button>` +
      `<div id="embeddedCheckout"></div></div>`;
  }
  const onceTier = (i: number) =>
    document.querySelectorAll("#tiersOnce .give-tier")[i] as HTMLElement;

  it("requests uiMode:embedded and mounts Stripe Embedded Checkout when Stripe.js + container are present", async () => {
    setupDom();
    let mountedInto: unknown = null;
    let sentBody: Record<string, unknown> | null = null;
    let pkUsed = "";
    const fakeCheckout = { mount: (el: unknown) => { mountedInto = el; }, destroy: () => {} };
    const fakeStripe = { initEmbeddedCheckout: () => Promise.resolve(fakeCheckout) };
    const win = {
      Stripe: (pk: string) => { pkUsed = pk; return fakeStripe; },
      fetch: (_url: string, opts: { body: string }) => {
        sentBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ clientSecret: "cs_test_secret", publishableKey: "pk_test_123" }) });
      },
    };
    const payload = startCheckout(onceTier(2), win as unknown as Window); // £50
    await flush();
    // The wire body carries uiMode:"embedded"; the RETURNED payload stays the clean REQ-028 contract.
    expect(sentBody!.uiMode).toBe("embedded");
    expect(sentBody!.amount).toBe(5000);
    expect(payload).toEqual({ mode: "once", plan: null, amount: 5000, giftAid: false });
    expect(pkUsed).toBe("pk_test_123");
    expect(mountedInto).toBe(document.getElementById("embeddedCheckout"));
    expect((document.getElementById("embeddedCheckoutModal") as HTMLElement).hidden).toBe(false);
  });

  it("falls back to the hosted redirect when Stripe.js is unavailable (no dead button)", async () => {
    setupDom();
    let sentBody: Record<string, unknown> | null = null;
    const win = {
      // no Stripe on the window → embedded cannot run
      fetch: (_url: string, opts: { body: string }) => {
        sentBody = JSON.parse(opts.body);
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ url: "https://checkout.stripe.com/c/pay/redirect_1" }) });
      },
      location: { href: "" },
    };
    startCheckout(onceTier(0), win as unknown as Window); // £10
    await flush();
    expect(sentBody!.uiMode).toBeUndefined(); // hosted request omits uiMode; the server defaults to hosted
    expect(win.location.href).toBe("https://checkout.stripe.com/c/pay/redirect_1");
  });

  it("falls back to the hosted redirect when embedded init throws", async () => {
    setupDom();
    let hostedRequested = false;
    const fakeStripe = { initEmbeddedCheckout: () => Promise.reject(new Error("init failed")) };
    const win = {
      Stripe: () => fakeStripe,
      fetch: (_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body);
        if (body.uiMode === "embedded") {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ clientSecret: "cs", publishableKey: "pk" }) });
        }
        hostedRequested = true;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ url: "https://checkout.stripe.com/c/pay/redirect_2" }) });
      },
      location: { href: "" },
    };
    startCheckout(onceTier(0), win as unknown as Window);
    await flush();
    await flush();
    expect(hostedRequested).toBe(true);
    expect(win.location.href).toBe("https://checkout.stripe.com/c/pay/redirect_2");
  });
});
