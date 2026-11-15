// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Monitor > Search (#view-search), in the kit's look (2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-people.md): one box that asks all three searches at
// once, results under People, Gifts and Gift Aid declarations, a tile for each with its count, the
// last search kept for coming back from a donor. Every person and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Json = Record<string, unknown>;
const person = (over: Json = {}): Json => ({ id: 7, donor_type: "individual", full_name: "Rowan Example", business_name: null, email: "rowan@example.com", anonymous: false, ...over });
const giftRow = (over: Json = {}): Json => ({
  id: 11, donor_id: 7, donor_name: "Rowan Example", donor_email: "rowan@example.com", mode: "once", plan: null, amount_pence: 2500,
  currency: "gbp", gift_aid: true, claim_status: "eligible", payment_status: "paid", refunded_amount_pence: 0,
  payment_channel: "online", created_at: "2026-11-02T09:30:00Z", source: null, invoice_id: null, ...over,
});
const declaration = (over: Json = {}): Json => ({ id: 31, donor_id: 7, first_name: "Rowan", last_name: "Example", postcode: "KA1 1AA", scope: "all_donations", revoked_at: null, created_at: "2025-12-24T18:00:00Z", ...over });

let answers: Record<string, unknown[]>;
let fail: Record<string, number>;
let perms: PermissionMap | null;
let asked: string[];

function respond(url: string) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" },
  });
  const path = url.split("?")[0];
  if (path.startsWith("/api/admin/search/")) asked.push(url);
  if (fail[path]) return j({ error: "Search is temporarily unavailable" }, fail[path]);
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role: "admin" } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms ?? effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  const kind = path.match(/^\/api\/admin\/search\/(\w+)$/);
  if (kind) return j({ results: answers[kind[1]] || [] });
  if (path === "/api/admin/donors/7") return j({ donorId: 7, fullName: "Rowan Example", email: null, emailConsent: false, anonymous: false, hiddenFromSupporters: false, subscriptionPlan: null, subscriptionId: null, giftAid: false, houseNameNumber: null, address: null, postcode: null, declaration: null });
  return j({ results: [] });
}

beforeEach(() => {
  answers = { donors: [person()], donations: [giftRow()], declarations: [declaration()] };
  fail = {};
  perms = null;
  asked = [];
  window.sessionStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => Promise.resolve(respond(String(url)));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  q('.admin-nav-link[data-view="search"]')!.click();
  await settle();
}
async function search(words: string) {
  (el("searchQuery") as HTMLInputElement).value = words;
  el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
const count = (kind: string) => text(q(`#view-search .pp-kind[data-kind="${kind}"] [data-kind-count]`));

describe("one box that looks everywhere", () => {
  it("opens with one plain sentence, and a tile for each kind of search saying what it looks in", async () => {
    await signIn();
    expect(text(q("#view-search .admin-view-intro")).length).toBeGreaterThan(40);
    expect(qa("#view-search .pp-kind").map((t) => text(t.querySelector(".ak-tile__name")))).toEqual(["People", "Gifts", "Gift Aid declarations"]);
    expect(text(q('#view-search .pp-kind[data-kind="donors"] .ak-tile__says'))).toContain("postcodes");
  });

  it("asks all three searches at once, and draws each under its own heading with its count", async () => {
    await signIn();
    await search("rowan");
    expect(asked.map((u) => u.split("?")[0]).sort()).toEqual(["/api/admin/search/declarations", "/api/admin/search/donations", "/api/admin/search/donors"]);
    expect(asked.every((u) => u.endsWith("?q=rowan"))).toBe(true);
    expect(qa("#searchResults .pp-found h3").map((h) => text(h))).toEqual(["People 1", "Gifts 1", "Gift Aid declarations 1"]);
    expect([count("donors"), count("donations"), count("declarations")]).toEqual(["1", "1", "1"]);
  });

  it("shows a person as a card that opens them, with the business name first", async () => {
    answers.donors = [person({ donor_type: "company", business_name: "Pretend Bakery Ltd", anonymous: true })];
    await signIn();
    await search("bakery");
    const card = q('#searchResults [data-found="donors"] button[data-donor="7"]')!;
    expect(text(card.querySelector(".ak-row__name"))).toBe("Pretend Bakery Ltd");
    expect(text(card)).toContain("Contact: Rowan Example");
    expect(text(card)).toContain("Business");
    expect(text(card)).toContain("Anonymous");
    expect(text(card)).not.toContain("company");
  });

  it("shows a declaration in plain words, never the database's headings, and opens its donor", async () => {
    answers.declarations = [declaration({ revoked_at: "2026-03-01T10:00:00Z" })];
    await signIn();
    await search("ka1");
    const card = q('#searchResults [data-found="declarations"] [data-donor="7"]')!;
    expect(text(card)).toContain("Rowan Example");
    expect(text(card)).toContain("KA1 1AA");
    expect(text(card)).toContain("Covers all their gifts");
    expect(text(card)).toContain("Ended on 1 March 2026");
    expect(text(q("#searchResults"))).not.toContain("first_name");
    expect(text(q("#searchResults"))).not.toContain("all_donations");
  });

  it("jumps to a heading when its tile is pressed", async () => {
    await signIn();
    await search("rowan");
    const head = q('#searchResults [data-found="declarations"] h3')!;
    const into = vi.fn();
    head.scrollIntoView = into;
    q('#view-search .pp-kind[data-kind="declarations"]')!.click();
    expect(into).toHaveBeenCalled();
    expect(document.activeElement).toBe(head);
  });

  it("says when a list was cut at 50, so you know to type more", async () => {
    answers.donors = Array.from({ length: 50 }, (_, i) => person({ id: 100 + i }));
    await signIn();
    await search("a");
    expect(count("donors")).toBe("50+");
    expect(text(q('#searchResults [data-found="donors"]'))).toContain("Showing the first 50, type more to narrow it.");
    expect(text(q('#searchResults [data-found="donations"]'))).not.toContain("Showing the first 50");
  });

  it("says nothing was found, in words, when nothing was", async () => {
    answers = { donors: [], donations: [], declarations: [] };
    await signIn();
    await search("zz");
    expect(text(el("searchResults"))).toContain("No results");
    expect([count("donors"), count("donations"), count("declarations")]).toEqual(["0", "0", "0"]);
  });

  it("says which part could not be searched, and still shows the rest", async () => {
    fail["/api/admin/search/declarations"] = 500;
    await signIn();
    await search("rowan");
    expect(text(q('#searchResults [data-found="declarations"]'))).toContain("Search is unavailable.");
    expect(text(q('#searchResults [data-found="donors"]'))).toContain("Rowan Example");
    expect(count("declarations")).toBe("–");
  });

  it("does nothing for an empty box", async () => {
    await signIn();
    await search("   ");
    expect(asked).toHaveLength(0);
  });

  it("shows a name typed with markup in it as words", async () => {
    answers.donors = [person({ full_name: '<img src=x onerror="window.hacked=1">' })];
    await signIn();
    await search("x");
    expect(q("#searchResults img")).toBeNull();
  });
});

describe("the gifts it finds", () => {
  // The fault: every gift said Paid, failed ones included, because the search did not return the
  // payment's status. The pill is worked out as the Donations list works it out.
  it("says Failed, Pending, Refunded or Paid, as the payment went", async () => {
    answers.donations = [
      giftRow({ id: 1, payment_status: "failed" }),
      giftRow({ id: 2, payment_status: "pending" }),
      giftRow({ id: 3, refunded_amount_pence: 2500 }),
      giftRow({ id: 4 }),
    ];
    await signIn();
    await search("rowan");
    expect(qa('#searchResults td[data-label="Payment"] .admin-pill').map((p) => text(p))).toEqual(["Failed", "Pending", "Refunded", "Paid"]);
  });

  it("gives someone who may search but not open a donor no button that would only say no, and says why", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), donations: "none" };
    await signIn();
    await search("rowan");
    expect(q("#searchResults [data-donor]")).toBeNull();
    expect(text(el("searchResults"))).toContain("opening a donor needs Donations");
    expect(text(el("searchResults"))).toContain("Rowan Example");
  });
});

describe("coming back from a donor, and your last searches", () => {
  it("keeps the last search and its results for when you come back", async () => {
    await signIn();
    await search("rowan");
    q('#searchResults [data-found="donors"] [data-donor="7"]')!.click();
    await settle();
    expect(el("view-donor").hidden).toBe(false);
    el("donorBack").click();
    await settle();
    expect(el("view-search").hidden).toBe(false);
    expect((el("searchQuery") as HTMLInputElement).value).toBe("rowan");
    expect(text(q('#searchResults [data-found="donors"]'))).toContain("Rowan Example");
    expect(count("donors")).toBe("1");
  });

  it("offers your last searches as buttons, kept for this tab only", async () => {
    await signIn();
    await search("rowan");
    await search("ka1 1aa");
    expect(qa("#searchRecent [data-search-again]").map((b) => text(b))).toEqual(["ka1 1aa", "rowan"]);
    expect(JSON.parse(window.sessionStorage.getItem("nbcc_admin_recent_searches")!)).toEqual(["ka1 1aa", "rowan"]);
    expect(window.localStorage.getItem("nbcc_admin_recent_searches")).toBeNull();
    asked = [];
    q('#searchRecent [data-search-again="rowan"]')!.click();
    await settle();
    expect((el("searchQuery") as HTMLInputElement).value).toBe("rowan");
    expect(asked).toHaveLength(3);
    el("searchForget").click();
    expect(el("searchRecent").hidden).toBe(true);
    expect(window.sessionStorage.getItem("nbcc_admin_recent_searches")).toBeNull();
  });
});
