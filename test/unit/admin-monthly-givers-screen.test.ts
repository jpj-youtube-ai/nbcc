// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Giving > Monthly givers, in the kit's look (2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-supporters.md): tiles that count and filter, a plain
// next step on anyone needing attention, search and sort, what it is worth in a year, and the emails
// and a spreadsheet of what is showing. Every name, address and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Giver = Record<string, unknown>;
function giver(id: number, over: Giver = {}): Giver {
  return {
    donorId: id, fullName: "Giver " + id, email: "giver" + id + "@example.com", monthlyPence: 1000,
    firstPaidAt: "2026-05-01T10:00:00Z", mostRecentPaidAt: "2026-11-01T10:00:00Z", paymentCount: 7,
    totalPence: 7000, giftAid: true, state: "active", cancelledAt: null, lapsedAt: null, failedAttempts: 0,
    thankedAt: "2026-05-03T10:00:00Z", ...over,
  };
}

let givers: Giver[] = [];
let copied: string[] = [];
let downloads: { name: string; rows: unknown[][] }[] = [];

const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;
function respond(url: string) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" },
  });
  const path = url.split("?")[0];
  if (path === "/api/admin/login") return j({ token, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/monthly-supporters") return j({ results: givers });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const view = () => el("view-monthly");
const names = () => [...view().querySelectorAll("#monthlyTable tbody tr .mg-name")].map((n) => n.textContent);
const tile = (key: string) => view().querySelector(`[data-mg-filter="${key}"]`) as HTMLElement;
const row = (id: number) => (view().querySelector(`#monthlyTable [data-donor="${id}"]`) as HTMLElement).closest("tr") as HTMLElement;
const type = (id: string, value: string, event = "input") => {
  const box = el(id) as HTMLInputElement;
  box.value = value;
  box.dispatchEvent(new Event(event, { bubbles: true }));
};

async function openMonthly() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="monthly"]') as HTMLElement).click();
  await settle();
}

beforeEach(() => {
  givers = [];
  copied = [];
  downloads = [];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = {
    ...Kit,
    copyText: (text: string) => { copied.push(text); return Promise.resolve(true); },
    downloadCsv: (name: string, rows: unknown[][]) => { downloads.push({ name, rows }); return true; },
  };
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => Promise.resolve(respond(String(url)));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

const mixed = () => [
  giver(1, { fullName: "Rowan Example", monthlyPence: 2000, totalPence: 4000, paymentCount: 2, firstPaidAt: "2026-09-01T10:00:00Z" }),
  giver(2, { fullName: "Morag Example", state: "past_due", failedAttempts: 2, thankedAt: null }),
  giver(3, { fullName: "Callum Example", state: "lapsed", lapsedAt: "2026-10-03T10:00:00Z", failedAttempts: 4, giftAid: false }),
  giver(4, { fullName: "Eilidh Example", giftAid: false, monthlyPence: 500, totalPence: 9000, firstPaidAt: "2025-01-01T10:00:00Z" }),
  giver(5, { fullName: "Fraser Example", state: "cancelled", cancelledAt: "2026-10-20T10:00:00Z" }),
];

describe("the screen in the kit's look", () => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  it("takes the kit's look, with its one sentence and no inline style", () => {
    const section = doc.getElementById("view-monthly")!;
    expect(section.classList.contains("ak")).toBe(true);
    expect(section.querySelector(".admin-view-intro")!.textContent).toContain("Businesses have their own tab");
    expect(section.innerHTML).not.toContain('style="');
  });
});

describe("the email is its own line, not run on from the name", () => {
  it("puts the email under the name as a link of its own", async () => {
    givers = [giver(1)];
    await openMonthly();
    const link = row(1).querySelector("a.mg-email") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:giver1@example.com");
    expect(row(1).querySelector(".admin-sub")).toBeNull();
  });
});

describe("tiles that count and filter", () => {
  it("counts who is giving, with what comes in a month, and the rest", async () => {
    givers = mixed();
    await openMonthly();
    const n = (key: string) => tile(key).querySelector(".ak-tile__n")!.textContent;
    // A failing card is not counted as still giving (as the summary line has always counted it).
    expect(n("giving")).toBe("2");
    expect(tile("giving").textContent).toContain("£25 a month");
    expect(n("attention")).toBe("2");
    expect(n("thanks")).toBe("1");
    expect(n("giftaid")).toBe("1");
    expect(n("")).toBe("5");
  });

  it("filters to the tile pressed, and keeps the Show list saying the same", async () => {
    givers = mixed();
    await openMonthly();
    tile("attention").click();
    expect(names()).toEqual(["Morag Example", "Callum Example"]);
    expect((el("monthlyStateFilter") as HTMLSelectElement).value).toBe("attention");
    tile("thanks").click();
    expect(names()).toEqual(["Morag Example"]);
    tile("giftaid").click();
    expect(names()).toEqual(["Eilidh Example"]);
    tile("").click();
    expect(names()).toHaveLength(5);
    expect(tile("").getAttribute("aria-pressed")).toBe("true");
  });

  it("starts hidden, and shows once a list has come, even an empty one", async () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.getElementById("monthlyTiles")!.hasAttribute("hidden")).toBe(true);
    await openMonthly();
    expect(el("monthlyTiles").hidden).toBe(false);
  });
});

describe("a plain next step on anyone needing attention", () => {
  it("says a failing card is still being tried, with a button that starts an email", async () => {
    givers = mixed();
    await openMonthly();
    tile("attention").click();
    const text = row(2).textContent || "";
    expect(text).toContain("Card failed 2 times");
    expect(text).toContain("still trying");
    const mail = row(2).querySelector("a[data-mg-mail]") as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toContain("mailto:giver2@example.com?subject=");
  });

  it("says when a gift stopped and after how many tries, and that an email is worth sending", async () => {
    givers = mixed();
    await openMonthly();
    tile("attention").click();
    const text = row(3).textContent || "";
    expect(text).toContain("Stopped on 3 October 2026 after 4 tries");
    expect(text).toContain("worth a friendly email");
    expect(row(3).querySelector("a[data-mg-mail]")).not.toBeNull();
  });

  it("offers no email button when there is no address, and says so", async () => {
    givers = [giver(3, { state: "lapsed", lapsedAt: "2026-10-03T10:00:00Z", failedAttempts: 4, email: null })];
    await openMonthly();
    type("monthlyStateFilter", "", "change");
    expect(row(3).querySelector("a[data-mg-mail]")).toBeNull();
    expect(row(3).textContent).toContain("No email");
  });

  it("never shows the database's own words", async () => {
    givers = mixed();
    await openMonthly();
    type("monthlyStateFilter", "", "change");
    const text = el("monthlyTable").textContent || "";
    expect(text).not.toMatch(/past_due|lapsed|Lapsed|\(2\)/);
  });
});

describe("thanked or not", () => {
  it("offers a way to the Thank you tab beside Not thanked yet", async () => {
    givers = mixed();
    await openMonthly();
    tile("thanks").click();
    const btn = row(2).querySelector('[data-goto-section="thank-you"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(row(2).textContent).toContain("Not thanked yet");
    btn.click();
    await settle();
    expect(el("view-thank-you").hidden).toBe(false);
  });
});

describe("last paid, and when it stopped", () => {
  it("says when they last paid and when they cancelled", async () => {
    givers = mixed();
    await openMonthly();
    type("monthlyStateFilter", "", "change");
    expect(row(1).textContent).toContain("1 November 2026");
    expect(row(5).textContent).toContain("Cancelled on 20 October 2026");
  });
});

describe("search and sort", () => {
  it("finds a giver by name or email", async () => {
    givers = mixed();
    await openMonthly();
    type("monthlyStateFilter", "", "change");
    type("monthlySearch", "morag");
    expect(names()).toEqual(["Morag Example"]);
    type("monthlySearch", "giver4@");
    expect(names()).toEqual(["Eilidh Example"]);
    type("monthlySearch", "nobody");
    expect(el("monthlyTable").textContent).toContain("Nobody matches that.");
  });

  it("sorts by amount, by how long, and by total", async () => {
    givers = mixed();
    await openMonthly();
    type("monthlyStateFilter", "", "change");
    type("monthlySort", "amount", "change");
    expect(names()[0]).toBe("Rowan Example");
    type("monthlySort", "longest", "change");
    expect(names()[0]).toBe("Eilidh Example");
    type("monthlySort", "total", "change");
    expect(names()[0]).toBe("Eilidh Example");
    expect(names()[names().length - 1]).toBe("Rowan Example");
  });
});

describe("what it is worth in a year", () => {
  it("says a year at today's amounts, and only about the Gift Aid on gifts that carry it", async () => {
    givers = mixed();
    await openMonthly();
    // Still giving: Rowan £20 a month with Gift Aid, Eilidh £5 without: £25 a month.
    const worth = el("monthlyWorth").textContent || "";
    expect(worth).toContain("£300 a year");
    // 25p on the pound on Rowan's £20 a month only: £60 a year.
    expect(worth).toContain("about £60 more in Gift Aid");
  });

  it("leaves the summary line exactly as it was", async () => {
    givers = [giver(7)];
    await openMonthly();
    expect(el("monthlySummary").textContent).toBe("1 giving, £10 a month");
  });
});

describe("the emails and a spreadsheet of what is showing", () => {
  it("copies the email addresses of the givers showing, and says how many beside the button", async () => {
    givers = mixed();
    await openMonthly();
    tile("attention").click();
    el("monthlyCopyEmails").click();
    await settle();
    expect(copied).toEqual(["giver2@example.com, giver3@example.com"]);
    expect(el("monthlyToolsStatus").textContent).toBe("Copied 2 email addresses.");
    expect(el("monthlyToolsStatus").classList.contains("is-ok")).toBe(true);
  });

  it("downloads a spreadsheet of the givers showing", async () => {
    givers = mixed();
    await openMonthly();
    tile("giftaid").click();
    el("monthlyDownload").click();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toMatch(/^monthly-givers-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(downloads[0].rows[0]).toContain("Email");
    expect(downloads[0].rows).toHaveLength(2);
    expect(downloads[0].rows[1]).toContain("Eilidh Example");
    expect(el("monthlyToolsStatus").textContent).toBe("Downloaded 1 giver.");
  });

  it("escapes what it shows", async () => {
    givers = [giver(1, { fullName: "<img src=x onerror=alert(1)>" })];
    await openMonthly();
    expect(view().querySelector("#monthlyTable img")).toBeNull();
  });
});
