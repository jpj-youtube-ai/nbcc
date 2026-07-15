// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// TASK-221: the TYPE-AWARE post-checkout thank-you page. Stripe returns the donor to /donate/thank-you
// with mode+donor+session_id on the query string; assets/js/thank-you.js reveals exactly one of the
// four variants (defaulting to a generic thanks when the params are absent, so an old link still
// works), and for the business-monthly variant drives the READ-ONLY by-session lookup + the SHARED
// inline recognition form (assets/js/business-thankyou.js mountBusinessForm). Static markup is parsed
// with jsdom; behaviour runs against the real thankYouVariant / initThankYou, mirroring
// business-thank-you.test.ts.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const html = readFileSync(resolve(ROOT, "thank-you.html"), "utf8");
const doc0 = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const { thankYouVariant, initThankYou } = require(resolve(ROOT, "assets/js/thank-you.js"));
const { mountBusinessForm } = require(resolve(ROOT, "assets/js/business-thankyou.js"));

const PLATINUM_PERKS = {
  supportersListing: true,
  newsletter: true,
  socialThankYou: true,
  digitalBadge: true,
  certificate: true,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeWin(fetchImpl: any, search: string): any {
  return {
    fetch: fetchImpl,
    location: { search: search, href: "" },
    setTimeout: vi.fn(),
    NBCCBusinessThankYou: { mountBusinessForm: mountBusinessForm },
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const hidden = (id: string) => document.getElementById(id)!.hidden;

beforeEach(() => {
  document.body.innerHTML = doc0.querySelector("main")?.outerHTML ?? "";
});

// The five variant containers; exactly one variant path reveals its block.
const VARIANTS = ["tyGeneric", "tyIndividualOnce", "tyIndividualMonthly", "tyBusinessOnce", "tyBusinessMonthly"];

describe("thank-you.html markup carries the five variant blocks + the shared contact line", () => {
  it("ships every variant block hidden, and the shared contact card visible", () => {
    for (const id of VARIANTS) {
      const el = doc0.getElementById(id);
      expect(el, `#${id} missing`).not.toBeNull();
      expect(el?.hasAttribute("hidden"), `#${id} must start hidden`).toBe(true);
    }
    const contact = doc0.getElementById("tyContact");
    expect(contact).not.toBeNull();
    expect(contact?.hasAttribute("hidden")).toBe(false); // always visible
  });

  it("keeps the TASK-219 contact line (phone + giving email) in the always-visible shared card", () => {
    const contact = doc0.getElementById("tyContact");
    expect(contact?.querySelector('a[href^="tel:"]')).not.toBeNull();
    expect(contact?.querySelector('a[href^="mailto:giving@nbcc.scot"]')).not.toBeNull();
  });

  it("embeds the shared business recognition form (same bty-* ids the shared core drives)", () => {
    for (const id of ["btyForm", "btyName", "btyBand", "btyLede", "btyConfirm", "btySubmit", "btyRecSupporters"]) {
      expect(doc0.getElementById(id), `#${id} missing`).not.toBeNull();
    }
  });
});

describe("thankYouVariant (pure selection)", () => {
  it("returns generic when the mode param is absent (old / paramless link)", () => {
    expect(thankYouVariant({})).toBe("generic");
    expect(thankYouVariant({ mode: "", donor: "company" })).toBe("generic");
    expect(thankYouVariant({ mode: "annual" })).toBe("generic");
  });

  it("routes a one-off by donor: company → business, anything else → individual", () => {
    expect(thankYouVariant({ mode: "once", donor: "individual" })).toBe("individual-once");
    expect(thankYouVariant({ mode: "once", donor: "company" })).toBe("business-once");
    expect(thankYouVariant({ mode: "once", donor: "partnership" })).toBe("individual-once");
  });

  it("routes a plain individual monthly straight to individual-monthly (no by-session call)", () => {
    expect(thankYouVariant({ mode: "monthly", donor: "individual", hasSession: true })).toBe("individual-monthly");
  });

  it("routes a company/partnership monthly WITH a session to the business-monthly lookup", () => {
    expect(thankYouVariant({ mode: "monthly", donor: "company", hasSession: true })).toBe("business-monthly");
    expect(thankYouVariant({ mode: "monthly", donor: "partnership", hasSession: true })).toBe("business-monthly");
  });

  it("falls back to individual-monthly for a company monthly with NO usable session", () => {
    expect(thankYouVariant({ mode: "monthly", donor: "company", hasSession: false })).toBe("individual-monthly");
  });
});

describe("initThankYou reveals the right variant (jsdom)", () => {
  it("reveals the generic block for a paramless link", async () => {
    const fetchMock = vi.fn();
    initThankYou(document, makeWin(fetchMock, ""));
    await flush();
    expect(hidden("tyGeneric")).toBe(false);
    expect(hidden("tyIndividualOnce")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reveals the individual one-off block for mode=once&donor=individual", async () => {
    const fetchMock = vi.fn();
    initThankYou(document, makeWin(fetchMock, "?mode=once&donor=individual"));
    await flush();
    expect(hidden("tyIndividualOnce")).toBe(false);
    expect(hidden("tyGeneric")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reveals the business one-off block for mode=once&donor=company", async () => {
    initThankYou(document, makeWin(vi.fn(), "?mode=once&donor=company"));
    await flush();
    expect(hidden("tyBusinessOnce")).toBe(false);
  });

  it("reveals the individual monthly block for mode=monthly&donor=individual (no fetch)", async () => {
    const fetchMock = vi.fn();
    initThankYou(document, makeWin(fetchMock, "?mode=monthly&donor=individual&session_id=cs_1"));
    await flush();
    expect(hidden("tyIndividualMonthly")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled(); // individual monthly never calls Stripe
  });
});

describe("business-monthly variant: by-session lookup + shared inline form (jsdom)", () => {
  const search = "?mode=monthly&donor=company&session_id=cs_biz_123";

  function fetchReturning(payload: unknown, ok = true) {
    return vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => payload }) as unknown as Response);
  }

  it("renders the inline recognition form when the lookup is ready", async () => {
    const fetchMock = fetchReturning({
      status: "ready",
      token: "tok_sess",
      businessName: "Acme Ltd",
      band: "platinum",
      perks: PLATINUM_PERKS,
      captured: false,
      preferences: null,
    });
    initThankYou(document, makeWin(fetchMock, search));
    await flush();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/business/fulfilment/by-session/cs_biz_123");
    expect(hidden("tyBusinessMonthly")).toBe(false);
    expect(hidden("tyBizCard")).toBe(false);
    expect(hidden("btyForm")).toBe(false);
    expect(hidden("tyBizStatus")).toBe(true); // the "setting up" line is cleared once the form shows
    expect(norm(document.getElementById("btyName")?.textContent)).toContain("Acme Ltd");
  });

  it("renders the read-only confirmation when the lookup is already captured", async () => {
    const fetchMock = fetchReturning({
      status: "captured",
      token: "tok_sess",
      businessName: "Acme Ltd",
      band: "platinum",
      perks: PLATINUM_PERKS,
      captured: true,
      preferences: {
        listOnSupporters: true,
        creditName: "Acme Ltd",
        wantSocial: false,
        wantBadge: true,
        wantCertificate: false,
        certificateDelivery: null,
      },
    });
    initThankYou(document, makeWin(fetchMock, search));
    await flush();
    expect(hidden("tyBizCard")).toBe(false);
    expect(hidden("btyConfirm")).toBe(false);
    expect(hidden("btyForm")).toBe(true);
    expect(norm(document.getElementById("btyConfirm")?.textContent)).toContain("You are all set");
  });

  it("shows the individual-monthly variant instead when the lookup returns none", async () => {
    const fetchMock = fetchReturning({ status: "none" });
    initThankYou(document, makeWin(fetchMock, search));
    await flush();
    expect(hidden("tyBusinessMonthly")).toBe(true);
    expect(hidden("tyIndividualMonthly")).toBe(false);
  });

  it("shows the setting-up message and schedules a poll while the record is pending", async () => {
    const fetchMock = fetchReturning({ status: "pending" });
    const win = makeWin(fetchMock, search);
    initThankYou(document, win);
    await flush();
    expect(hidden("tyBizStatus")).toBe(false);
    expect(norm(document.getElementById("tyBizStatus")?.textContent).toLowerCase()).toContain("setting up");
    expect(hidden("tyBizCard")).toBe(true);
    expect(hidden("tyBizFallback")).toBe(true);
    expect(win.setTimeout).toHaveBeenCalled(); // a retry is scheduled
  });

  it("shows the emailed-link fallback when the lookup errors", async () => {
    const fetchMock = fetchReturning({}, false);
    initThankYou(document, makeWin(fetchMock, search));
    await flush();
    expect(hidden("tyBizFallback")).toBe(false);
    expect(hidden("tyBizCard")).toBe(true);
  });
});
