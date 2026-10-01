// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-482: Admin > Analytics in the admin's jsdom harness (admin-could-not-load.test.ts): admin.html's
// <body>, a fake fetch, app.js evaluated against it. Every number, place and label here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
let perms: PermissionMap = {};
type Served = { status: number; body: unknown; wait?: Promise<unknown> };
let served: Record<string, Served> = {};
let calls: Call[] = [];

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
    ],
    otherWebsites: [{ source: "www.example.org", visits: 4 }],
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
// The same report with set visitors each day, to read the line's axis.
function withDaily(visitors: number[]) {
  const daily = visitors.map((v, i) => ({ day: `2026-09-${String(24 + i).padStart(2, "0")}`, visitors: v }));
  return { ...REPORT, current: { ...REPORT.current, daily }, previous: { ...REPORT.previous, daily: daily.map((d) => ({ ...d, visitors: 0 })) } };
}
function deferred() {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  return { wait, release };
}
const OFF = { collecting: false, updatedAt: null, updatedBy: null };
const ON = { collecting: true, updatedAt: "2026-09-28T09:00:00.000Z", updatedBy: "admin:admin@nbcc" };

const PANELS = ["anChannels", "anWebsites", "anNewsletters", "anCities", "anCountries", "anPages", "anClickKinds", "anClicks", "anDevices", "anBrowsers"];

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
  window.confirm = () => true;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the nav item", () => {
  it("shows for someone with the analytics permission, in the Admin group", async () => {
    await signIn();
    expect(navLink().hidden).toBe(false);
    expect(el("teamNavGroup").hidden).toBe(false);
  });

  it("is hidden without it", async () => {
    perms = effectivePermissions({ role: "editor", permissions: null });
    await signIn();
    expect(navLink().hidden).toBe(true);
  });

  it("shows the Admin group for someone given analytics but not Team", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), analytics: "view" };
    await signIn();
    expect(navLink().hidden).toBe(false);
    expect(el("teamNavGroup").hidden).toBe(false);
  });
});

describe("the collecting switch", () => {
  it("off: explains what switching on starts counting and links the privacy notice", async () => {
    served["GET /api/admin/analytics/settings"] = { status: 200, body: OFF };
    await openAnalytics();
    expect(el("anSwitch").classList.contains("is-on")).toBe(false);
    expect(text("anSwitchState")).toMatch(/^Off\./);
    expect(text("anSwitchState")).toContain("no cookies");
    expect(el("anSwitchState").querySelector('a[href="/privacy#counting-visits"]')).not.toBeNull();
    expect(el("anSwitchBtn").hidden).toBe(false);
    expect(el("anSwitchBtn").textContent).toBe("Start counting visits");
  });

  it("on: says since when", async () => {
    await openAnalytics();
    expect(el("anSwitch").classList.contains("is-on")).toBe(true);
    expect(text("anSwitchState")).toContain("since 28/09/2026");
    expect(el("anSwitchBtn").textContent).toBe("Stop counting visits");
  });

  it("is read only without analytics edit", async () => {
    perms = { ...effectivePermissions({ role: "viewer", permissions: null }), analytics: "view" };
    await openAnalytics();
    expect(el("anSwitchBtn").hidden).toBe(true);
    expect(el("anSwitchNote").hidden).toBe(false);
  });

  it("flips with a PUT and shows the new state", async () => {
    served["GET /api/admin/analytics/settings"] = { status: 200, body: OFF };
    served["PUT /api/admin/analytics/settings"] = { status: 200, body: ON };
    await openAnalytics();
    el("anSwitchBtn").click();
    await settle();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.path).toBe("/api/admin/analytics/settings");
    expect(JSON.parse(put?.body || "{}")).toEqual({ collecting: true });
    expect(el("anSwitch").classList.contains("is-on")).toBe(true);
    expect(text("anSwitchStatus")).toBe("Counting visits is now on.");
  });

  it("does nothing if the confirmation is cancelled", async () => {
    window.confirm = () => false;
    await openAnalytics();
    el("anSwitchBtn").click();
    await settle();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("says when it could not be changed", async () => {
    served["PUT /api/admin/analytics/settings"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openAnalytics();
    el("anSwitchBtn").click();
    await settle();
    expect(el("anSwitchStatus").className).toContain("is-error");
    expect(el("anSwitch").classList.contains("is-on")).toBe(true);
  });

  it("says when it could not be checked", async () => {
    served["GET /api/admin/analytics/settings"] = { status: 500, body: {} };
    await openAnalytics();
    expect(text("anSwitchState")).toBe("Could not check whether visits are being counted.");
    expect(el("anSwitchBtn").hidden).toBe(true);
  });
});

describe("the numbers", () => {
  it("asks for 30 days first and another period from its chip", async () => {
    await openAnalytics();
    expect(calls.some((c) => c.path === "/api/admin/analytics?days=30")).toBe(true);
    (document.querySelector('[data-andays="7"]') as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.path === "/api/admin/analytics?days=7")).toBe(true);
    expect(document.querySelector('[data-andays="7"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('[data-andays="30"]')?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the headline figures with the change on the period before", async () => {
    await openAnalytics();
    const figures = text("anFigures");
    expect(figures).toContain("80");
    expect(figures).toContain("Visitors");
    expect(figures).toContain("Up 100% on the 30 days before");
    // one page share: 32% now, 31% before
    expect(figures).toContain("32%");
    expect(figures).toContain("Up 1 point on the 30 days before");
  });

  it("draws the visitors per day, with a summary for screen readers", async () => {
    await openAnalytics();
    expect(el("anLine").querySelector("svg")).not.toBeNull();
    expect(text("anLineSummary")).toContain("highest 14 on 30 September");
  });

  it("fills every panel", async () => {
    await openAnalytics();
    expect(text("anChannels")).toContain("Search");
    expect(text("anWebsites")).toContain("www.example.org");
    expect(text("anNewsletters")).toContain("Our winter news");
    expect(text("anCities")).toContain("Aberlady");
    expect(text("anCountries")).toContain("United Kingdom");
    expect(text("anPages")).toContain("Home page");
    expect(text("anPages")).toContain("1 min 15 sec");
    expect(text("anPages")).toContain("62%");
    expect(text("anClickKinds")).toContain("Donate buttons");
    expect(text("anClicks")).toContain("Donate now");
    expect(text("anDevices")).toContain("Phone");
    expect(text("anBrowsers")).toContain("Safari");
    expect(text("anNow")).toContain("3");
  });

  it("credits DB-IP under the places", async () => {
    await openAnalytics();
    const credit = document.querySelector('#view-analytics a[href="https://db-ip.com"]');
    expect(credit?.textContent).toBe("IP geolocation by DB-IP");
  });

  it("shows the top 10 of a long list, and Show all grows it", async () => {
    await openAnalytics();
    expect(el("anCities").querySelectorAll("li")).toHaveLength(10);
    const more = el("anCities").querySelector("[data-anmore]") as HTMLElement;
    expect(more.textContent).toBe("Show all 12");
    more.click();
    expect(el("anCities").querySelectorAll("li")).toHaveLength(12);
    expect((el("anCities").querySelector("[data-anmore]") as HTMLElement).textContent).toBe("Show the top 10");
  });

  // The server sends at most 100 of a long list, so the button never says "all" of a list it cut.
  it("says top 100, not all, when the list reached the server's limit", async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ city: "Town " + i, region: "Scotland", country: "GB", visitors: 200 - i }));
    served["GET /api/admin/analytics"] = { status: 200, body: { ...REPORT, current: { ...REPORT.current, cities: many } } };
    await openAnalytics();
    expect((el("anCities").querySelector("[data-anmore]") as HTMLElement).textContent).toBe("Show the top 100");
  });

  it("says Not enough visits yet in every panel with nothing to show", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: EMPTY };
    await openAnalytics();
    for (const id of [...PANELS, "anLine"]) expect(text(id)).toBe("Not enough visits yet.");
  });

  it("says each panel could not load when the numbers fail", async () => {
    served["GET /api/admin/analytics"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openAnalytics();
    for (const id of [...PANELS, "anLine", "anFigures", "anNow"]) expect(text(id)).toContain("could not be loaded");
    expect(text("anFigures")).not.toContain("0");
  });
});

describe("review of #605", () => {
  it("says which times it compares: today so far against the same time of day before", async () => {
    await openAnalytics();
    const note = text("anPeriodNote");
    expect(note).toContain("24 September to now");
    expect(note).toContain("17 September to 23 September");
    expect(note).toContain("up to 09:00");
  });

  it("labels the line only with whole numbers that sit on its gridlines", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: withDaily([1, 3, 2]) };
    await openAnalytics();
    expect(Array.from(el("anLine").querySelectorAll(".an-y span")).map((s) => s.textContent)).toEqual(["4", "2", "0"]);
  });

  it("gives a line of ones a whole middle too", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: withDaily([1, 0, 1]) };
    await openAnalytics();
    expect(Array.from(el("anLine").querySelectorAll(".an-y span")).map((s) => s.textContent)).toEqual(["2", "1", "0"]);
  });

  it("shows it is loading a new period, and a slower earlier answer cannot replace the newer one", async () => {
    const slow = deferred();
    served["GET /api/admin/analytics?days=30"] = { status: 200, body: REPORT, wait: slow.wait };
    const week = { ...REPORT, days: 7, current: { ...REPORT.current, headline: { visitors: 7777, visits: 1, views: 1, bounceShare: 0 } } };
    const pending = deferred();
    served["GET /api/admin/analytics?days=7"] = { status: 200, body: week, wait: pending.wait };
    await openAnalytics();
    (document.querySelector('[data-andays="7"]') as HTMLElement).click();
    await settle();
    expect(el("view-analytics").getAttribute("aria-busy")).toBe("true");
    expect(el("view-analytics").classList.contains("is-loading")).toBe(true);
    expect(text("anLoading")).toBe("Loading the last 7 days…");
    pending.release();
    await settle();
    expect(text("anFigures")).toContain("7,777");
    expect(el("view-analytics").classList.contains("is-loading")).toBe(false);
    slow.release();
    await settle();
    expect(text("anFigures")).toContain("7,777");
  });

  it("checks right now on its own, without reloading every panel", async () => {
    served["GET /api/admin/analytics/now"] = { status: 200, body: { collecting: true, people: 9 } };
    await openAnalytics();
    const before = calls.filter((c) => c.path.startsWith("/api/admin/analytics?")).length;
    (el("anNow").querySelector("[data-anrefresh]") as HTMLElement).click();
    await settle();
    expect(calls.filter((c) => c.path.startsWith("/api/admin/analytics?")).length).toBe(before);
    expect(calls.some((c) => c.path === "/api/admin/analytics/now")).toBe(true);
    expect(text("anNow")).toContain("9 people on the website");
  });

  it("says counting is off rather than that nobody is on the website", async () => {
    served["GET /api/admin/analytics"] = { status: 200, body: { ...REPORT, rightNow: { collecting: false, people: 0 } } };
    await openAnalytics();
    expect(text("anNow")).toContain("Counting is off");
    expect(text("anNow")).not.toContain("0 people");
  });

  it("shows stored text as text, never as markup", async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    const hostile = {
      ...REPORT,
      current: {
        ...REPORT.current,
        otherWebsites: [{ source: evil, visits: 2 }],
        newsletters: [{ campaign: "41", label: evil, visits: 2 }],
        cities: [{ city: evil, region: evil, country: "GB", visitors: 2 }],
        countries: [{ country: "ZZ", name: evil, visitors: 2 }],
        pages: [{ path: evil, views: 1, visitors: 1, avgActiveSeconds: 1, avgScroll: 1, entryShare: 1 }],
        clickKinds: [{ kind: evil, clicks: 1 }],
        clicks: [{ kind: evil, label: evil, clicks: 1 }],
        browsers: [{ browser: evil, visitors: 1 }],
      },
    };
    served["GET /api/admin/analytics"] = { status: 200, body: hostile };
    await openAnalytics();
    expect(el("view-analytics").querySelectorAll("img")).toHaveLength(0);
    for (const id of ["anWebsites", "anNewsletters", "anCities", "anCountries", "anPages", "anClickKinds", "anClicks", "anBrowsers"]) {
      expect(text(id)).toContain("<img src=x");
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("carries a New pill until it is opened (TASK-478)", async () => {
    served["GET /api/admin/whats-new"] = { status: 200, body: { areas: [{ area: "analytics", new: true, since: "2026-09-30T00:00:00.000Z" }] } };
    served["POST /api/admin/whats-new/seen"] = { status: 200, body: { area: "analytics", seenAt: "2026-10-01T09:00:00.000Z" } };
    await signIn();
    expect(navLink().querySelector(".admin-new-pill")).not.toBeNull();
    navLink().click();
    await settle();
    expect(navLink().querySelector(".admin-new-pill")).toBeNull();
    const seen = calls.find((c) => c.method === "POST" && c.path === "/api/admin/whats-new/seen");
    expect(JSON.parse(seen?.body || "{}")).toEqual({ area: "analytics" });
  });
});
