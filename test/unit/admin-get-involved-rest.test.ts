// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Get involved: Tickets and pledges, Emails and Settings in the look of Sign ups and Our events
// (2026-11-15, docs/superpowers/specs/2026-11-14-admin-refresh-get-involved-rest.md). Counts as tiles,
// what waits for an admin as a tile and a dot on the Emails button, a line under each website switch
// saying what pressing it does, and the house rules for the parts' styles. The whole admin page in
// jsdom with its card scripts and a fake fetch. Every name and amount is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const html = read("admin.html");
const appSrc = read("assets/js/admin/app.js");
const kitSrc = read("assets/js/admin/kit.js");
const cardSrcs = ["event-tickets.js", "pledges.js", "all-emails.js"].map((f) => read("assets/js/admin/" + f));
const css = read("assets/css/admin-get-involved.css");
const ticketsCss = read("assets/css/admin-event-tickets.css");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

let waiting = 2;
let pageOn = true;
let downloads: { name: string; text: string }[] = [];

const EVENTS = [
  { id: 41, title: "Pretend Quiz", slug: "pretend-quiz", status: "approved", eventDate: "2026-12-04", proposedTypes: 1, proposedLimit: false, sold: 38, ticketPence: 38000, openRequests: 0, salesClosed: false },
  { id: 52, title: "Pretend Ceilidh", slug: "pretend-ceilidh", status: "approved", eventDate: "2026-12-12", proposedTypes: 0, proposedLimit: false, sold: 12, ticketPence: 18050, openRequests: 1, salesClosed: false },
  { id: 53, title: "Pretend Carols", slug: "pretend-carols", status: "approved", eventDate: "2026-12-20", proposedTypes: 0, proposedLimit: false, sold: 0, ticketPence: 0, openRequests: 0, salesClosed: false },
];
const pledge = (id: number, name: string, amountPence: number, status: string, email: string | null) => ({
  id, name, amountPence, paidAmountPence: status === "paid" ? amountPence : null, status, statusWords: status === "open" ? "Not paid yet" : "Paid online",
  giftAid: false, createdAt: "2026-10-01T10:00:00.000Z", hidden: false, email, message: null, messageHidden: false,
  payEmailSentAt: null, reminderSentAt: null, paidTwice: false, canSend: status === "open", canCancel: status === "open",
});
const PLEDGES = {
  today: "2026-11-15",
  fundraisers: [{
    id: 7, title: "Pretend Walk", organiser: "Sam Example", slug: "pretend-walk", status: "finished", eventDate: "2026-10-10", payDue: "2026-10-11",
    totals: { openPence: 1500, paidPence: 2000, cashPence: 1000, pledgedPence: 4500, openCount: 1, paidCount: 1, cashCount: 1 }, unpaidTwoWeeks: 1,
    pledges: [pledge(1, "Granny Example", 2000, "paid", "granny@example.com"), pledge(2, "=Fergus Pretend", 1500, "open", "fergus@example.com")],
  }],
  totals: { openPence: 1500, paidPence: 2000, cashPence: 1000, pledgedPence: 4500, openCount: 1, paidCount: 1, cashCount: 1 },
  unpaidTwoWeeks: 1, paidTwice: 0,
  emails: { on: true, approvalsUnavailable: false, kinds: [] },
};

function respond(url: string) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const path = url.split("?")[0];
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role: "admin" } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/events") return j({ pageOn, updatedAt: null, updatedBy: null, today: "2026-11-15", events: [] });
  if (path === "/api/admin/fundraisers") return j({ pageOn: true, fundraisers: [] });
  if (path === "/api/admin/event-tickets") return j({ events: EVENTS });
  if (path === "/api/admin/fundraising/pledges") return j(PLEDGES);
  if (path === "/api/admin/fundraising/emails/summary") return j({ count: 12, waiting, approvalsUnavailable: false });
  if (path === "/api/admin/fundraising/emails") {
    const e = (id: string, state: string | null) => ({ id, name: "Email " + id, subject: "S", who: "Goes to someone.", touchKind: null, state, waitingVersion: state === "waiting" ? "usual" : null, versions: [{ id: "usual", label: "Usual", approval: null }] });
    return j({ count: 3, waiting, approvalsUnavailable: false, groups: [
      { id: "signup", name: "Signing up", emails: [e("a", null)] },
      { id: "pledges", name: "Sponsor pledges", emails: [e("b", "approved"), e("c", waiting ? "waiting" : "approved")] },
    ] });
  }
  if (path.startsWith("/api/admin/fundraising/emails/")) return j({ subject: "S", html: "<p>Hi</p>" });
  return j({ results: [] });
}

beforeEach(() => {
  waiting = 2;
  pageOn = true;
  downloads = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => Promise.resolve(respond(String(url)));
  // eslint-disable-next-line no-eval
  (0, eval)(kitSrc);
  const kit = (window as unknown as { AdminKit: { downloadCsv: (n: string, rows: unknown[][]) => boolean; toCsv: (rows: unknown[][]) => string } }).AdminKit;
  kit.downloadCsv = (name: string, rows: unknown[][]) => {
    downloads.push({ name, text: kit.toCsv(rows) });
    return true;
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
  // eslint-disable-next-line no-eval
  cardSrcs.forEach((src) => (0, eval)(src));
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const tile = (box: string, name: string) => qa(`#${box} .ak-tile`).find((t) => text(t.querySelector(".ak-tile__name")) === name) || null;
const tileN = (box: string, name: string) => text(tile(box, name)?.querySelector(".ak-tile__n") || null);

async function openTab(section?: string) {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="get-involved"]') as HTMLElement).click();
  await settle();
  if (section) {
    (q(`#giSections [data-gi-section="${section}"]`) as HTMLElement).click();
    await settle();
  }
}

describe("Tickets and pledges: the counts as tiles", () => {
  it("counts the tickets sold, the ticket money and the events waiting for you", async () => {
    await openTab("tickets");
    expect(el("etTiles").hidden).toBe(false);
    expect(tileN("etTiles", "Tickets sold")).toBe("50");
    expect(tileN("etTiles", "Ticket money")).toBe("£560.50");
    expect(tileN("etTiles", "Waiting for you")).toBe("2");
  });

  it("lists only the events waiting for you when that tile is pressed, and all of them again after", async () => {
    await openTab("tickets");
    const needs = tile("etTiles", "Waiting for you") as HTMLElement;
    needs.click();
    await settle();
    expect(qa("#etAdminList [data-et-event]").map((li) => li.getAttribute("data-et-event"))).toEqual(["41", "52"]);
    // The tiles are drawn again, so the tile is looked up again.
    expect(tile("etTiles", "Waiting for you")!.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(tile("etTiles", "Waiting for you"));
    (tile("etTiles", "Waiting for you") as HTMLElement).click();
    await settle();
    expect(qa("#etAdminList [data-et-event]").length).toBe(3);
  });

  it("totals the pledges: promised, paid and still owed, and the ones to chase", async () => {
    await openTab("tickets");
    expect(el("frPledgesTiles").hidden).toBe(false);
    expect(tileN("frPledgesTiles", "Promised")).toBe("£45");
    expect(tileN("frPledgesTiles", "Paid")).toBe("£30");
    expect(tileN("frPledgesTiles", "Still owed")).toBe("£15");
    expect(tileN("frPledgesTiles", "To chase")).toBe("1");
  });

  it("downloads the pledges showing as a spreadsheet, a formula kept as words", async () => {
    await openTab("tickets");
    const btn = el("frPledgesCsv");
    expect(btn).toBeTruthy();
    btn.click();
    await settle();
    expect(downloads.length).toBe(1);
    expect(downloads[0].name).toContain("pledges");
    expect(downloads[0].text).toContain("Granny Example");
    expect(downloads[0].text).toContain("'=Fergus Pretend");
    expect(text(el("frPledgesStatus"))).toContain("2 pledges");
  });

  it("offers to copy a sponsor's email address", async () => {
    await openTab("tickets");
    const copy = q('[data-pledge-copy="1"]');
    expect(copy).not.toBeNull();
    expect(text(copy)).toContain("Copy email");
  });
});

describe("Emails: what waits for an admin", () => {
  it("counts the emails waiting for sign off as a tile, and dots the Emails button, from the moment the tab opens", async () => {
    await openTab();
    const btn = q('#giSections [data-gi-section="emails"]') as HTMLElement;
    expect(btn.querySelector(".ak-part-dot")).not.toBeNull();
    expect(text(btn.querySelector(".sr-only"))).toContain("waiting");
    (btn as HTMLElement).click();
    await settle();
    expect(el("frEmailsTiles").hidden).toBe(false);
    expect(text(el("frEmailsWaitingN"))).toBe("2");
    expect(el("frEmailsWaitingTile").classList.contains("is-none")).toBe(false);
  });

  it("has no dot when nothing is waiting, and the tile steps back", async () => {
    waiting = 0;
    await openTab("emails");
    expect(q('#giSections [data-gi-section="emails"] .ak-part-dot')).toBeNull();
    expect(el("frEmailsWaitingTile").classList.contains("is-none")).toBe(true);
  });

  it("opens All emails at the first email waiting when the tile is pressed", async () => {
    await openTab("emails");
    el("frEmailsWaitingTile").click();
    await settle();
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
    expect((q('[data-emails-group="pledges"]') as HTMLDetailsElement).open).toBe(true);
    expect(el("frEmailRow-c").getAttribute("aria-expanded")).toBe("true");
  });

  it("finds an email by its name", async () => {
    await openTab("emails");
    (el("frAllEmailsFold") as HTMLDetailsElement).open = true;
    el("frAllEmailsFold").dispatchEvent(new Event("toggle"));
    await settle();
    const box = el("frAllEmailsSearch") as HTMLInputElement;
    box.value = "email c";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(qa("#frAllEmailsGroups [data-email]").filter((li) => !li.hidden).map((li) => li.getAttribute("data-email"))).toEqual(["c"]);
    expect((q('[data-emails-group="signup"]') as HTMLElement).hidden).toBe(true);
    expect((q('[data-emails-group="pledges"]') as HTMLDetailsElement).open).toBe(true);
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(qa("#frAllEmailsGroups [data-email]").filter((li) => !li.hidden).length).toBe(3);
  });
});

describe("Settings: each website switch says what pressing it does", () => {
  it("says what switching fundraising off does, while it is on", async () => {
    await openTab("settings");
    expect(text(el("frSwitchSays"))).toContain("Switching it off closes the Fundraise for us form");
    expect(text(el("frSwitchSays"))).toContain("asked first");
  });

  it("says what switching fundraising on does, while it is off", async () => {
    pageOn = false;
    await openTab("settings");
    expect(text(el("frSwitchSays"))).toContain("Switching it on opens the Fundraise for us form");
  });

  it("says what taking the Get involved page off does", async () => {
    await openTab("settings");
    expect(text(el("evSwitchSays"))).toContain("Taking it off hides Get involved and What");
  });

  it("puts the settings under plain headings", () => {
    expect(qa("#view-get-involved .gi-group").map((h) => text(h))).toEqual(["On the website", "The sign up form and the pages"]);
  });
});

describe("the three parts' styles", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const mine = strip(css.slice(css.indexOf("/* ---- Tickets and pledges, Emails and Settings")));
  const tix = strip(ticketsCss);

  it("names every new rule through one of the three parts, so Sign ups and Our events are untouched", () => {
    const heads = [...mine.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((h) => h && !h.startsWith("@") && !/^(from|to)$/.test(h));
    expect(heads.length).toBeGreaterThan(10);
    // Split on the commas between selectors, never the ones inside :where( ... ) or :not( ... ).
    const split = (head: string) => {
      const out: string[] = [];
      let depth = 0;
      let one = "";
      for (const ch of head) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) {
          out.push(one);
          one = "";
        } else one += ch;
      }
      return out.concat(one);
    };
    for (const h of heads) for (const s of split(h)) expect(s.trim().startsWith("#view-get-involved .gi-rest"), s).toBe(true);
  });

  it("never scrolls inside a box and never uses !important", () => {
    for (const r of [mine, tix]) {
      expect(r).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
      expect(r).not.toContain("!important");
    }
  });

  it("moves only transform, and only for someone happy with motion", () => {
    for (const r of [mine, tix]) {
      const outside = r.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
      expect(outside).not.toMatch(/transition\s*:/);
      for (const m of r.matchAll(/transition\s*:\s*([^;]+);/g)) expect(m[1].trim().startsWith("transform")).toBe(true);
    }
  });

  it("gives every button a finger's height and every field 16px words", () => {
    expect(mine).toMatch(/\.gi-rest :where\(\.admin-btn, \.btn, \.fr-link-btn\)[^{]*\{[^}]*min-height:\s*44px/);
    expect(mine).toMatch(/\.gi-rest :where\(\.fx-call-input, select, textarea, input\[type="text"\], input\[type="email"\], input\[type="number"\][^{]*\{[^}]*font-size:\s*1rem/);
    expect(mine).toMatch(/input\[type="checkbox"\][^{]*\{[^}]*width:\s*22px/);
  });
});
