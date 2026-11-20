// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// The admin refresh (2026-11-14): Admin > Analytics in the kit's look, with the harness of
// admin-analytics-page.test.ts. TASK-482: Admin > Analytics in the admin's jsdom harness (admin-could-not-load.test.ts): admin.html's
// <body>, a fake fetch, app.js evaluated against it. Every number, place and label here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
let perms: PermissionMap = {};
type Served = { status: number; body: unknown; wait?: Promise<unknown> };
let served: Record<string, Served> = {};
let calls: Call[] = [];
let downloads: { name: string; rows: unknown[][] }[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ method, path: url, body: init?.body });
  const path = url.split("?")[0];
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  const hit = served[method + " " + url] || served[method + " " + path];
  if (hit) return hit.wait ? hit.wait.then(() => j(hit.body, hit.status)) : j(hit.body, hit.status);
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const text = (id: string) => (el(id).textContent || "").replace(/\s+/g, " ").trim();
const navLink = () => document.querySelector('.admin-nav-link[data-view="analytics"]') as HTMLElement;

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
async function openAnalytics() {
  await signIn();
  navLink().click();
  await settle();
}

// ---- invented numbers ----

function panels(scale: number) {
  const days = Array.from({ length: 7 }, (_, i) => ({ day: `2026-09-${String(24 + i).padStart(2, "0")}`, visitors: (i + 1) * scale }));
  const towns = ["Aberlady", "Belhaven", "Cockenzie", "Dirleton", "Drem", "Gifford", "Gullane", "Humbie", "Longniddry", "Ormiston", "Pencaitland", "Stenton"];
  return {
    headline: { visitors: 40 * scale, visits: 50 * scale, views: 90 * scale, bounceShare: 30 + scale },
    daily: days,
    channels: [
      { channel: "search", visits: 30 },
      { channel: "newsletter", visits: 12 },
      { channel: "direct", visits: 8 },
      { channel: "qr", visits: 5 },
    ],
    otherWebsites: [{ source: "www.example.org", visits: 4 }],
    // TASK-492: QR code scans, by the page whose code it was.
    qrCodes: [{ label: "Festive Ball", visits: 5 }],
    newsletters: [{ campaign: "41", label: "Our winter news", visits: 12 }],
    cities: towns.map((city, i) => ({ city, region: "Scotland", country: "GB", visitors: 20 - i })),
    countries: [
      { country: "GB", name: "United Kingdom", visitors: 36 },
      { country: "FR", name: "France", visitors: 2 },
    ],
    pages: [
      { path: "/", views: 60, visitors: 35, avgActiveSeconds: 75, avgScroll: 62, entryShare: 70 },
      { path: "/donate", views: 20, visitors: 15, avgActiveSeconds: null, avgScroll: null, entryShare: 10 },
    ],
    clickKinds: [{ kind: "donate", clicks: 9 }],
    clicks: [{ kind: "donate", label: "Donate now", clicks: 9 }],
    devices: [
      { device: "phone", visitors: 28 },
      { device: "computer", visitors: 12 },
    ],
    browsers: [{ browser: "Safari", visitors: 22 }],
  };
}
function empty() {
  return {
    headline: { visitors: 0, visits: 0, views: 0, bounceShare: 0 },
    daily: [{ day: "2026-09-30", visitors: 0 }],
    channels: [],
    otherWebsites: [],
    qrCodes: [],
    newsletters: [],
    cities: [],
    countries: [],
    pages: [],
    clickKinds: [],
    clicks: [],
    devices: [],
    browsers: [],
  };
}
function comparison(scale: number) {
  const p = panels(scale);
  return { headline: p.headline, daily: p.daily };
}
const REPORT = {
  days: 30,
  current: { from: "2026-09-24", to: "2026-09-30", until: "2026-09-30T08:00:00.000Z", ...panels(2) },
  previous: { from: "2026-09-17", to: "2026-09-23", until: "2026-09-23T08:00:00.000Z", ...comparison(1) },
  rightNow: { collecting: true, people: 3 },
  generatedAt: "2026-09-30T08:00:00.000Z",
};
const EMPTY = {
  days: 30,
  current: { from: "a", to: "b", until: "2026-09-30T08:00:00.000Z", ...empty() },
  previous: { from: "a", to: "b", until: "2026-09-23T08:00:00.000Z", headline: empty().headline, daily: empty().daily },
  rightNow: { collecting: true, people: 0 },
};
const ON = { collecting: true, updatedAt: "2026-09-28T09:00:00.000Z", updatedBy: "admin:admin@nbcc" };


beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  served = {
    "GET /api/admin/analytics": { status: 200, body: REPORT },
    "GET /api/admin/analytics/settings": { status: 200, body: ON },
  };
  calls = [];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  downloads = [];
  (window as unknown as { AdminKit: unknown }).AdminKit = { ...Kit, downloadCsv: (name: string, rows: unknown[][]) => (downloads.push({ name, rows }), true) };
  window.confirm = () => true;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});


describe("the look", () => {
  it("is in the kit's look", () => {
    expect(el("view-analytics").classList.contains("ak")).toBe(true);
  });
});

describe("a summary in words", () => {
  it("says how many came, against the period before, where most came from and the page looked at most", async () => {
    await openAnalytics();
    expect(text("anSummary")).toBe(
      "80 people visited in the last 30 days, twice as many as the 30 days before. Most visits came from a search (about 55%). The home page was looked at most, with 60 views.",
    );
  });

  it("makes no comparison when there is nothing before to compare with", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: { ...REPORT, previous: { ...REPORT.previous, headline: { visitors: 0, visits: 0, views: 0, bounceShare: 0 } } } };
    await openAnalytics();
    expect(text("anSummary")).toMatch(/^80 people visited in the last 30 days\. /);
  });

  it("says about, and the biggest share rather than most, when no way of arriving had over half", async () => {
    const channels = [{ channel: "search", visits: 40 }, { channel: "newsletter", visits: 35 }, { channel: "direct", visits: 25 }];
    served["GET /api/admin/analytics"] = { status: 200, body: { ...REPORT, previous: { ...REPORT.previous, headline: { ...REPORT.previous.headline, visitors: 60 } }, current: { ...REPORT.current, channels } } };
    await openAnalytics();
    expect(text("anSummary")).toContain("about 33% more than the 30 days before");
    expect(text("anSummary")).toContain("The biggest share of visits came from a search (about 40%).");
  });

  it("says nobody has visited, and nothing more, when nobody has", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: EMPTY };
    await openAnalytics();
    expect(text("anSummary")).toBe("Nobody has been counted visiting in the last 30 days.");
  });

  it("says nothing when the numbers could not load", async () => {
    served["GET /api/admin/analytics"] = { status: 500, body: {} };
    await openAnalytics();
    expect(text("anSummary")).toBe("");
  });
});

describe("one part at a time on a phone", () => {
  it("has a bar of the six parts, each with its own part", async () => {
    await openAnalytics();
    const keys = Array.from(document.querySelectorAll("#view-analytics [data-akpart]")).map((b) => b.getAttribute("data-akpart"));
    expect(keys).toEqual(["glance", "from", "where", "pages", "clicks", "devices"]);
    const names = Array.from(document.querySelectorAll("#view-analytics [data-akpart]")).map((b) => (b.textContent || "").trim());
    expect(names).toEqual(["At a glance", "Where from", "Where", "Pages", "Clicks", "Devices"]);
    for (const k of keys) expect(document.querySelector('#view-analytics [data-akpart-body="' + k + '"]')).not.toBeNull();
    expect((document.querySelector('#view-analytics [data-akpart-body="glance"]') as HTMLElement).hidden).toBe(false);
    expect((document.querySelector('#view-analytics [data-akpart-body="pages"]') as HTMLElement).hidden).toBe(true);
    (document.querySelector('#view-analytics [data-akpart="pages"]') as HTMLElement).click();
    expect((document.querySelector('#view-analytics [data-akpart-body="pages"]') as HTMLElement).hidden).toBe(false);
    expect((document.querySelector('#view-analytics [data-akpart-body="glance"]') as HTMLElement).hidden).toBe(true);
  });
});

// TASK-643: on a laptop the bar is not shown, so every part must be. styles.css hides [hidden] with
// !important, so no stylesheet can bring a hidden part back: the script takes the attribute off.
describe("every part down the page on a laptop", () => {
  type Listener = () => void;
  function laptop(wide: boolean) {
    const mq = { matches: wide, media: "(min-width: 861px)", listeners: [] as Listener[] };
    const api = {
      get matches() { return mq.matches; },
      media: mq.media,
      addEventListener: (_: string, fn: Listener) => mq.listeners.push(fn),
      removeEventListener: () => undefined,
      addListener: (fn: Listener) => mq.listeners.push(fn),
      removeListener: () => undefined,
    };
    (window as unknown as { matchMedia: unknown }).matchMedia = (q: string) =>
      q.includes("861px") ? api : { matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
    return { set(w: boolean) { mq.matches = w; mq.listeners.forEach((fn) => fn()); } };
  }
  const shown = () =>
    Array.from(document.querySelectorAll("#view-analytics [data-akpart-body]"))
      .filter((p) => !(p as HTMLElement).hidden)
      .map((p) => p.getAttribute("data-akpart-body"));

  it("shows all six parts, none of them hidden, on a laptop", async () => {
    laptop(true);
    await openAnalytics();
    expect(shown()).toEqual(["glance", "from", "where", "pages", "clicks", "devices"]);
    expect((document.querySelector('#view-analytics [data-an-go="qr"]') as HTMLElement).closest("[hidden]")).toBeNull();
  });

  it("goes back to one part at a time when the window narrows to a phone's, and all again when it widens", async () => {
    const screen = laptop(true);
    await openAnalytics();
    screen.set(false);
    expect(shown()).toEqual(["glance"]);
    (document.querySelector('[data-akpart="pages"]') as HTMLElement).click();
    expect(shown()).toEqual(["pages"]);
    screen.set(true);
    expect(shown()).toHaveLength(6);
  });

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
});

describe("each figure says what it counts", () => {
  it("has a line under each of the four", async () => {
    await openAnalytics();
    const says = Array.from(el("anFigures").querySelectorAll(".rc-fig-says")).map((p) => (p.textContent || "").trim());
    expect(says).toHaveLength(4);
    expect(says[0]).toContain("each counted once");
    expect(says[1]).toContain("one person can visit many times");
  });

  it("says the share before beside a change in points", async () => {
    await openAnalytics();
    expect(text("anFigures")).toContain("Up 1 point on the 30 days before (31% then)");
  });
});

describe("Download the numbers", () => {
  it("hands over a spreadsheet of every number for the days shown, and says so beside the button", async () => {
    await openAnalytics();
    el("anDownload").click();
    await settle();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("nbcc-website-visits-last-30-days.csv");
    const rows = downloads[0].rows;
    expect(rows[0]).toEqual(["Part", "What", "Number", "Share"]);
    expect(rows).toContainEqual(["At a glance", "Visitors", 80, ""]);
    expect(rows).toContainEqual(["At a glance", "Visitors in the 30 days before", 40, ""]);
    expect(rows).toContainEqual(["Where from", "Search", 30, "55%"]);
    expect(rows).toContainEqual(["Pages", "Home page (views)", 60, ""]);
    expect(rows).toContainEqual(["Visitors each day", "30 September", 14, ""]);
    expect(text("anDownloadSaid")).toBe("Downloaded the numbers for the last 30 days.");
  });

  it("says there is nothing to download when the numbers could not load", async () => {
    served["GET /api/admin/analytics"] = { status: 500, body: {} };
    await openAnalytics();
    el("anDownload").click();
    await settle();
    expect(downloads).toHaveLength(0);
    expect(el("anDownloadSaid").className).toContain("is-error");
  });
});

describe("remembering, and the way through", () => {
  it("remembers the days chosen for the rest of the visit", async () => {
    await openAnalytics();
    (document.querySelector('[data-andays="7"]') as HTMLElement).click();
    await settle();
    expect(window.sessionStorage.getItem("nbccAdminAnDays")).toBe("7");
  });

  it("opens on the days remembered", async () => {
    window.sessionStorage.setItem("nbccAdminAnDays", "90");
    await openAnalytics();
    expect(calls.some((c) => c.path === "/api/admin/analytics?days=90")).toBe(true);
    expect(document.querySelector('[data-andays="90"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("links QR codes scanned to QR codes, and Newsletter issues to Newsletter", async () => {
    await openAnalytics();
    const qr = document.querySelector('[data-an-go="qr"]') as HTMLElement;
    const nl = document.querySelector('[data-an-go="newsletter"]') as HTMLElement;
    expect(qr.hidden).toBe(false);
    expect(nl.hidden).toBe(false);
    qr.click();
    await settle();
    expect(el("view-qr").hidden).toBe(false);
  });

  it("does not offer a way through to a screen this person cannot open", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), analytics: "view", site: "none", newsletter: "none" };
    await openAnalytics();
    expect((document.querySelector('[data-an-go="qr"]') as HTMLElement).hidden).toBe(true);
    expect((document.querySelector('[data-an-go="newsletter"]') as HTMLElement).hidden).toBe(true);
  });
});
