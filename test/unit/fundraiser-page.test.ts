// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter, type PublicPage, type WallEntry } from "../../src/fundraising/model";

// TASK-494: a fundraiser's page in the browser. The give form builds the donate page's checkout
// body plus the fundraiser's four fields and opens Stripe the way the donate page does (on the page
// first, Stripe's own page if that cannot work); the wall shows ten then Show all; the share button
// copies the link. Every name, address and number here is invented.

const ROOT = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const shared = require(resolve(ROOT, "assets/js/main.js"));
const { initGiveForm, initWall, initShare } = require(resolve(ROOT, "assets/js/fundraiser.js"));
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");

const wallEntry = (i: number): WallEntry => ({
  name: `Giver${i} T.`,
  amountPence: 1000,
  message: null,
  createdAt: new Date(Date.UTC(2026, 9, 1) - i * 3600_000).toISOString(),
});

const page = (wall: WallEntry[] = []): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
  wall,
  giving: { fundraiserId: 41, minimumPence: 200 },
});

let calls: Array<{ url: string; body: Record<string, unknown> }>;
let answer: { status: number; body: unknown };
let assigned: string | null;

function load(wall: WallEntry[] = []) {
  const html = renderFundraiserPage(template, page(wall), { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(Date.UTC(2026, 9, 2)) });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  calls = [];
  assigned = null;
  answer = { status: 200, body: { url: "https://checkout.stripe.test/session" } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.fetch = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return Promise.resolve({ ok: answer.status === 200, status: answer.status, json: () => Promise.resolve(answer.body) });
  });
  w.Stripe = undefined;
  w.NBCCFormValidation = { validateForm: shared.validateForm, clearValidation: shared.clearValidation };
  const nav = { assign: (u: string) => (assigned = u) };
  return initGiveForm(document, window, nav);
}

const $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => document.querySelector<T>(sel)!;
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const type = (id: string, value: string) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const tick = (id: string, on = true) => {
  const el = $<HTMLInputElement>(`#${id}`);
  el.checked = on;
  el.dispatchEvent(new Event("change", { bubbles: true }));
};
const choose = (pence: number) => {
  const r = document.querySelector<HTMLInputElement>(`input[name="frAmount"][value="${pence}"]`)!;
  r.checked = true;
  r.dispatchEvent(new Event("change", { bubbles: true }));
};
const submit = async () => {
  $("#frGiveForm").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
};
function fillDetails() {
  type("frFirstName", "Alex");
  type("frSurname", "Example");
  type("frEmail", "alex@example.com");
}

describe("choosing an amount", () => {
  beforeEach(() => load());

  it("a preset fills the button with the amount", () => {
    choose(2000);
    expect($("[data-give-submit]").textContent).toBe("Give £20 now");
  });

  it("typing your own amount clears the preset, and choosing a preset clears what you typed", () => {
    choose(1000);
    type("frOwnAmount", "12.50");
    expect(document.querySelector<HTMLInputElement>('input[name="frAmount"]:checked')).toBeNull();
    expect($("[data-give-submit]").textContent).toBe("Give £12.50 now");
    choose(500);
    expect($<HTMLInputElement>("#frOwnAmount").value).toBe("");
  });

  it("shows what Gift Aid adds and what the card fee is, for the amount chosen", () => {
    choose(1000);
    expect($("[data-giftaid-headline]").textContent).toBe("Make your £10 worth £12.50");
    expect($("[data-cover-fee-amount]").textContent).toBe("£0.32");
  });

  it("will not send less than £2", async () => {
    fillDetails();
    type("frOwnAmount", "1.50");
    await submit();
    expect(calls).toHaveLength(0);
    expect(document.getElementById("frOwnAmount-error")?.textContent).toBe("The smallest donation here is £2.");
  });

  it("will not send without an amount", async () => {
    fillDetails();
    await submit();
    expect(calls).toHaveLength(0);
    expect(document.getElementById("frOwnAmount-error")?.textContent).toBe("Please choose an amount, or type your own.");
  });
});

describe("Gift Aid", () => {
  beforeEach(() => load());

  it("asks for the home address only once Gift Aid is ticked", () => {
    expect($("#frDeclaration").hidden).toBe(true);
    tick("frGiftAid");
    expect($("#frDeclaration").hidden).toBe(false);
    tick("frGiftAid", false);
    expect($("#frDeclaration").hidden).toBe(true);
  });

  it("drops the postcode for a home outside the UK", () => {
    tick("frGiftAid");
    tick("frNonUk");
    expect($("#frPostcodeField").hidden).toBe(true);
    expect($<HTMLInputElement>("#frPostcode").required).toBe(false);
  });
});

describe("the message", () => {
  it("counts down from 200", () => {
    load();
    type("frMessage", "Go Robin");
    expect($("[data-message-count]").textContent).toBe("192 characters left.");
  });
});

describe("the checkout body", () => {
  it("is the donate page's one off gift, plus the fundraiser, the message and the two wall choices", async () => {
    load();
    choose(2000);
    fillDetails();
    tick("frEmailConsent");
    type("frMessage", "  Go Robin  ");
    tick("frShowNameNo");
    tick("frShowAmount", false);
    tick("frCoverFee");
    await submit();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/checkout-session");
    expect(calls[0].body).toEqual({
      mode: "once",
      plan: null,
      amount: 2000,
      giftAid: false,
      coverFee: true,
      donorType: "individual",
      fullName: "Alex Example",
      email: "alex@example.com",
      emailConsent: true,
      fundraiserId: 41,
      supporterMessage: "Go Robin",
      showName: false,
      showAmount: false,
    });
    expect(assigned).toBe("https://checkout.stripe.test/session");
  });

  it("carries the Gift Aid declaration when ticked, for this gift only", async () => {
    load();
    type("frOwnAmount", "15");
    fillDetails();
    tick("frGiftAid");
    type("frHouse", "12");
    type("frAddress", "Example Road, Exampleton");
    type("frPostcode", "KA1 1AA");
    await submit();
    expect(calls[0].body.amount).toBe(1500);
    expect(calls[0].body.giftAid).toBe(true);
    expect(calls[0].body.declaration).toEqual({
      firstName: "Alex",
      lastName: "Example",
      houseNameNumber: "12",
      address: "Example Road, Exampleton",
      postcode: "KA1 1AA",
      nonUk: false,
      scope: "this_donation",
    });
  });

  it("needs the address to send Gift Aid", async () => {
    load();
    choose(1000);
    fillDetails();
    tick("frGiftAid");
    await submit();
    expect(calls).toHaveLength(0);
    expect($("#frHouse").getAttribute("aria-invalid")).toBe("true");
  });

  it("leaves out an empty message", async () => {
    load();
    choose(1000);
    fillDetails();
    await submit();
    expect(calls[0].body).not.toHaveProperty("supporterMessage");
    expect(calls[0].body.showName).toBe(true);
    expect(calls[0].body.showAmount).toBe(true);
  });

  it("opens Stripe on the page when it can, exactly as the donate page does", async () => {
    load();
    const mount = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Stripe = vi.fn(() => ({ initEmbeddedCheckout: () => Promise.resolve({ mount, destroy: vi.fn() }) }));
    answer = { status: 200, body: { clientSecret: "cs_test_secret", publishableKey: "pk_test_key" } };
    choose(1000);
    fillDetails();
    await submit();
    expect(calls[0].body.uiMode).toBe("embedded");
    expect(mount).toHaveBeenCalled();
    expect($("#embeddedCheckoutModal").hidden).toBe(false);
    expect(assigned).toBeNull();
  });

  it("falls back to Stripe's own page when the page cannot host it", async () => {
    load();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Stripe = vi.fn(() => ({ initEmbeddedCheckout: () => Promise.reject(new Error("blocked")) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).fetch = vi.fn((url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body });
      const out = body.uiMode === "embedded" ? { clientSecret: "cs_test_secret", publishableKey: "pk_test_key" } : { url: "https://checkout.stripe.test/session" };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(out) });
    });
    choose(1000);
    fillDetails();
    await submit();
    await flush();
    expect(calls.map((c) => c.body.uiMode)).toEqual(["embedded", undefined]);
    expect(assigned).toBe("https://checkout.stripe.test/session");
  });

  it("puts the server's message about the supporter's message next to the message box", async () => {
    load();
    choose(1000);
    fillDetails();
    type("frMessage", "something rude");
    answer = {
      status: 400,
      body: {
        error: "Invalid checkout request",
        details: { fieldErrors: { supporterMessage: ["Please choose different words for your message."] } },
      },
    };
    await submit();
    expect($("#frMessage").getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("frMessage-error")?.textContent).toBe("Please choose different words for your message.");
    expect(assigned).toBeNull();
    expect($<HTMLButtonElement>("[data-give-submit]").disabled).toBe(false);
  });

  it("also understands a plain fields answer for the message", async () => {
    load();
    choose(1000);
    fillDetails();
    answer = { status: 400, body: { error: "Please choose different words.", fields: { supporterMessage: "Please choose different words." } } };
    await submit();
    expect(document.getElementById("frMessage-error")?.textContent).toBe("Please choose different words.");
  });

  it("says plainly when payment is not available, and keeps what they typed", async () => {
    load();
    choose(1000);
    fillDetails();
    answer = { status: 502, body: { error: "Checkout is temporarily unavailable" } };
    await submit();
    expect($("[data-give-error]").hidden).toBe(false);
    expect($("[data-give-error]").textContent).toMatch(/not working just now/);
    expect($<HTMLInputElement>("#frFirstName").value).toBe("Alex");
  });
});

describe("the supporter wall", () => {
  it("shows the newest ten, and Show all grows the page with the rest", () => {
    load(Array.from({ length: 14 }, (_, i) => wallEntry(i)));
    initWall(document);
    const items = [...document.querySelectorAll<HTMLElement>(".fr-wall__item")];
    expect(items.filter((i) => !i.hidden)).toHaveLength(10);
    const more = $<HTMLButtonElement>("[data-wall-show-all]");
    expect(more.hidden).toBe(false);
    more.click();
    expect(items.filter((i) => !i.hidden)).toHaveLength(14);
    expect(more.hidden).toBe(true);
    // Focus goes to the first one that was tucked away, so a keyboard user carries on from there.
    expect(document.activeElement).toBe(items[10]);
  });

  it("does nothing with ten or fewer", () => {
    load(Array.from({ length: 4 }, (_, i) => wallEntry(i)));
    expect(initWall(document)).toBeNull();
  });
});

describe("sharing", () => {
  it("shows the copy button only where copying works, and says when it has copied", async () => {
    load();
    const writeText = vi.fn(() => Promise.resolve());
    initShare(document, { navigator: { clipboard: { writeText } } });
    const btn = $<HTMLButtonElement>("[data-copy-link]");
    expect(btn.hidden).toBe(false);
    btn.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith("https://nbcc.test/fundraise/robins-santa-dash");
    expect($("[data-copy-status]").textContent).toBe("Link copied. You can paste it anywhere.");
  });

  it("leaves the button hidden where there is no clipboard", () => {
    load();
    initShare(document, { navigator: {} });
    expect($("[data-copy-link]").hidden).toBe(true);
  });
});

describe("once the script runs", () => {
  it("shows the give form and hides the no JavaScript line", () => {
    load();
    expect($("#frGiveForm").hidden).toBe(false);
    expect($("[data-nojs]").hidden).toBe(true);
  });
});
