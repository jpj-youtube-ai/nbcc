// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-495: Admin > Fundraising in the admin's jsdom harness (admin-could-not-load.test.ts):
// admin.html's <body>, a fake fetch standing in for the core's admin API (README, "Community
// fundraising (TASK-493)"), app.js evaluated against it. Every person, place and amount is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };

function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id,
    slug: "test-dash-" + id,
    path: "raising",
    kind: "santa_dash",
    kindLabel: "A Santa dash",
    title: "Test Dash " + id,
    description: "Running round the park in red suits.",
    eventDate: "2026-12-05",
    startTime: "10:30",
    venue: "The Bandstand",
    town: "Testtown",
    targetPence: 25000,
    public: true,
    status: "new",
    name: "Robin Example",
    email: "robin@example.com",
    phone: "+44 (0)7700 900123",
    socialLink: "https://www.facebook.com/example-dash",
    socialOk: true,
    wants: { leaflets: 50, buckets: 2, shoutOut: true, attend: false },
    postAddress: "1 Example Road\nTesttown",
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    approvedAt: null,
    approvedBy: null,
    updatedAt: "2026-09-20T10:00:00.000Z",
    updatedBy: null,
    pageUrl: null,
    ...over,
  };
}

function meterOf(online: number, cash: number, target: number | null) {
  const raised = online + cash;
  const percent = target ? Math.floor((raised * 100) / target) : null;
  return {
    raisedPence: raised,
    onlinePence: online,
    cashPence: cash,
    targetPence: target,
    percent,
    barPercent: percent === null ? null : Math.min(100, percent),
    overTarget: target ? raised > target : false,
  };
}

type Wall = Record<string, unknown> & { donationId: number };
function gift(n: number, over: Record<string, unknown> = {}): Wall {
  return {
    donationId: 500 + n,
    fullName: "Giver Number" + n,
    shortName: "Giver N.",
    anonymous: false,
    showName: true,
    showAmount: true,
    amountPence: 1000 + n,
    refundedPence: 0,
    message: "Go on, message " + n,
    hidden: false,
    createdAt: "2026-09-2" + (n % 9) + "T12:00:00.000Z",
    ...over,
  };
}

// ---- the stand in server ----

let records: Rec[] = [];
let cashRows: Record<number, Rec[]> = {};
let wallRows: Record<number, Wall[]> = {};
let waiting: Record<number, Rec | null> = {};
let historyRows: Record<number, unknown[]> = {};
let online: Record<number, number> = {};
let settings: { pageOn: boolean; updatedAt: string | null; updatedBy: string | null; liveEmailsWaiting?: number } = {
  pageOn: false,
  updatedAt: null,
  updatedBy: null,
};
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let failures: Record<string, { status: number; body: unknown }> = {};
let calls: { method: string; path: string; body: unknown }[] = [];
let whatsNewAreas: unknown[] = [];
// A gate holds one answer back until the test releases it: "METHOD /path" -> a promise.
let gates: Record<string, Promise<unknown>> = {};
function gate(key: string) {
  let release!: () => void;
  gates[key] = new Promise<void>((r) => (release = r));
  return () => {
    delete gates[key];
    release();
  };
}

function meterFor(f: Rec) {
  const cash = (cashRows[f.id] || []).reduce((s, c) => s + Number(c.amountPence), 0);
  return meterOf(online[f.id] || 0, cash, (f.targetPence as number | null) ?? null);
}

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: whatsNewAreas });
  const fail = failures[method + " " + path];
  if (fail) return j(fail.body, fail.status);

  if (path === "/api/admin/fundraising/settings") {
    if (method === "PATCH") {
      settings = { pageOn: body.pageOn, updatedAt: "2026-10-02T09:00:00.000Z", updatedBy: "admin:fern@example.com" };
    }
    return j({ ...settings }); // a copy, as a real response is: later changes must not leak in
  }
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({
      pageOn: settings.pageOn,
      fundraisers: records.map((f) => ({ ...f, meter: meterFor(f), editWaiting: !!waiting[f.id] })),
    });
  }
  if (path === "/api/admin/fundraiser-images" && method === "POST") return j({ id: "abc", src: "/media/events/abc" }, 201);
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((r) => r.id === id);
  if (!f) return j({ error: "That no longer exists" }, 404);
  if (rest === "" && method === "GET") {
    const w = waiting[id];
    return j({
      fundraiser: f,
      meter: meterFor(f),
      waitingEdit: w || null,
      editWaiting: !!w,
      edits: w ? [w] : [],
      cash: cashRows[id] || [],
      wall: wallRows[id] || [],
    });
  }
  if (rest === "" && method === "PATCH") {
    Object.assign(f, body);
    return j({ fundraiser: f });
  }
  if (rest === "/history") return j({ history: historyRows[id] || [] });
  // TASK-504: a piece of its materials, a whole HTML page.
  const mat = rest.match(/^\/materials\/([a-z-]+)$/);
  if (mat && method === "GET") {
    return { status: 200, ok: true, json: () => Promise.reject(new Error("html")), text: () => Promise.resolve("<!doctype html><title>" + mat[1] + "</title>"), headers: { get: () => "text/html" } };
  }
  if (rest === "/approve") {
    Object.assign(f, { status: "approved", approvedAt: "2026-10-02T09:00:00.000Z", pageUrl: f.path === "raising" && f.public ? "https://nbcc.scot/fundraise/" + f.slug : null });
    return j({ fundraiser: f });
  }
  if (rest === "/decline") {
    Object.assign(f, { status: "declined", declinedReason: body && body.reason ? body.reason : null, pageUrl: null });
    return j({ fundraiser: f });
  }
  if (rest === "/finish") {
    Object.assign(f, { status: "finished", pageUrl: null });
    return j({ fundraiser: f });
  }
  const e = rest.match(/^\/edits\/(\d+)\/(approve|reject)$/);
  if (e) {
    const w = waiting[id];
    if (e[2] === "approve" && w) Object.assign(f, w.changes as object);
    waiting[id] = null;
    return j({ fundraiser: f });
  }
  if (rest === "/cash" && method === "POST") {
    const row = { id: 900 + (cashRows[id] || []).length, amountPence: body.amountPence, paidInOn: body.paidInOn, note: body.note || "", createdBy: "admin:fern@example.com", createdAt: "2026-10-02T09:00:00.000Z" };
    cashRows[id] = [...(cashRows[id] || []), row];
    return j({ cash: row }, 201);
  }
  const c = rest.match(/^\/cash\/(\d+)$/);
  if (c && method === "DELETE") {
    cashRows[id] = (cashRows[id] || []).filter((r) => r.id !== Number(c[1]));
    return j({ removed: Number(c[1]) });
  }
  const w = rest.match(/^\/wall\/(\d+)\/(hide|show)$/);
  if (w) {
    const row = (wallRows[id] || []).find((r) => r.donationId === Number(w[1]))!;
    row.hidden = w[2] === "hide";
    return j({ donationId: row.donationId, hidden: row.hidden });
  }
  return j({ error: "not here" }, 404);
}

// ---- driving the page ----

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const navLink = () => q('.admin-nav-link[data-view="fundraising"]') as HTMLElement;
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);
const detail = () => q("#frList [data-frdetail]");
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}
async function openFundraising() {
  await signIn();
  navLink().click();
  await settle();
}
async function openRow(id: number) {
  (row(id) as HTMLElement).click();
  await settle();
}
function setValue(sel: string, value: string) {
  const input = q(sel) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function submit(sel: string) {
  (q(sel) as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

let confirmAnswer = true;
let confirmed: string[] = [];

beforeEach(() => {
  records = [];
  cashRows = {};
  wallRows = {};
  waiting = {};
  historyRows = {};
  online = {};
  settings = { pageOn: false, updatedAt: null, updatedBy: null };
  perms = effectivePermissions({ role: "admin", permissions: null });
  role = "admin";
  failures = {};
  calls = [];
  whatsNewAreas = [];
  gates = {};
  confirmAnswer = true;
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return confirmAnswer;
  };
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) => {
    const i = init as { method?: string; body?: string } | undefined;
    const held = gates[(i?.method || "GET").toUpperCase() + " " + String(url).split("?")[0]];
    return held ? held.then(() => respond(String(url), i)) : Promise.resolve(respond(String(url), i));
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

// ---- the menu ----

describe("the Fundraising menu link", () => {
  it("sits in Content, after Events", () => {
    const views = qa(".admin-nav-link").map((b) => b.getAttribute("data-view"));
    expect(views.indexOf("fundraising")).toBe(views.indexOf("events") + 1);
  });

  for (const r of ["admin", "editor", "viewer"] as const) {
    it(`shows for ${r === "admin" ? "an" : "a"} ${r}`, async () => {
      asRole(r);
      await signIn();
      expect(navLink().hidden).toBe(false);
    });
  }

  it("is hidden from someone without fundraising access", async () => {
    perms = { ...effectivePermissions({ role: "admin", permissions: null }), fundraising: "none" };
    await signIn();
    expect(navLink().hidden).toBe(true);
  });

  it("carries the New pill when a sign up has arrived since the last visit", async () => {
    whatsNewAreas = [{ area: "fundraising", new: true, since: "2026-10-01T00:00:00.000Z" }];
    await signIn();
    expect(navLink().querySelector(".admin-new-pill")).not.toBeNull();
  });
});

// ---- the switch ----

describe("the switch", () => {
  it("lets an admin switch fundraising on, after asking", async () => {
    await openFundraising();
    expect(text(el("frSwitchState"))).toMatch(/^No\./);
    const btn = el("frSwitchBtn") as HTMLButtonElement;
    expect(btn.hidden).toBe(false);
    expect(el("frSwitchNote").hidden).toBe(true);
    btn.click();
    await settle();
    expect(confirmed[0]).toMatch(/switch fundraising on/i);
    expect(sent("PATCH", "/api/admin/fundraising/settings")[0].body).toEqual({ pageOn: true });
    expect(text(el("frSwitchState"))).toMatch(/^Yes\./);
    expect(el("frSwitch").classList.contains("is-on")).toBe(true);
    expect(text(el("frSwitchWho"))).toContain("fern@example.com");
    expect(text(el("frSwitchStatus"))).toMatch(/now on/i);
  });

  // TASK-497: switching on emails "Your page is live" to everyone approved while it was off.
  it("says switching on emails everyone waiting, with how many when the server says", async () => {
    settings.liveEmailsWaiting = 3;
    await openFundraising();
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toContain("“Your page is live” goes by email to the 3 fundraisers approved while it was off.");
  });

  it("says it in the singular for one, and not at all for nobody", async () => {
    settings.liveEmailsWaiting = 1;
    await openFundraising();
    confirmAnswer = false;
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toContain("goes by email to the 1 fundraiser approved while it was off.");
    settings.liveEmailsWaiting = 0;
    navLink().click();
    await settle();
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[1]).not.toContain("Your page is live");
  });

  it("asks the server for the count when the switch is pressed, not when the screen opened", async () => {
    // Approvals made after the screen opened (while it is off) add to the waiting list.
    settings.liveEmailsWaiting = 0;
    await openFundraising();
    settings.liveEmailsWaiting = 2;
    confirmAnswer = false;
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toContain("goes by email to the 2 fundraisers approved while it was off.");
  });

  it("still asks, without a number, when the count cannot be read", async () => {
    await openFundraising();
    failures["GET /api/admin/fundraising/settings"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    confirmAnswer = false;
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toMatch(/switch fundraising on/i);
    expect(confirmed[0]).toContain("goes by email to everyone approved while it was off.");
  });

  it("says it without a number when the server gives none", async () => {
    await openFundraising();
    confirmAnswer = false;
    el("frSwitchBtn").click();
    await settle();
    expect(confirmed[0]).toContain("“Your page is live” goes by email to everyone approved while it was off.");
  });

  it("does nothing when the admin says no to the question", async () => {
    await openFundraising();
    confirmAnswer = false;
    el("frSwitchBtn").click();
    await settle();
    expect(sent("PATCH", "/api/admin/fundraising/settings")).toHaveLength(0);
  });

  for (const r of ["editor", "viewer"] as const) {
    it(`is read only for ${r === "editor" ? "an editor" : "a viewer"}`, async () => {
      asRole(r);
      await openFundraising();
      expect(el("frSwitchBtn").hidden).toBe(true);
      expect(el("frSwitchNote").hidden).toBe(false);
      expect(text(el("frSwitchNote"))).toMatch(/only an admin/i);
    });
  }

  it("shows the server's reason when switching is refused", async () => {
    failures["PATCH /api/admin/fundraising/settings"] = { status: 403, body: { error: "Only an admin can do that" } };
    await openFundraising();
    el("frSwitchBtn").click();
    await settle();
    expect(text(el("frSwitchStatus"))).toBe("Only an admin can do that");
    expect(el("frSwitchStatus").classList.contains("is-error")).toBe(true);
  });

  it("says it could not check when the settings do not load", async () => {
    failures["GET /api/admin/fundraising/settings"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openFundraising();
    expect(text(el("frSwitchState"))).toMatch(/could not check/i);
    expect(el("frSwitchBtn").hidden).toBe(true);
  });
});

// ---- the list ----

describe("the list", () => {
  it("shows each sign up with its path, status, organiser, date and money", async () => {
    records = [
      fundraiser(1),
      fundraiser(2, { path: "event", kind: "bake_sale", kindLabel: "A bake sale or coffee morning", targetPence: null, status: "approved", title: "Cake Morning" }),
      fundraiser(3, { status: "declined", targetPence: null, eventDate: null }),
      fundraiser(4, { status: "finished" }),
    ];
    online = { 1: 5000 };
    cashRows = { 1: [{ id: 1, amountPence: 1000, paidInOn: "2026-09-30", note: "", createdBy: "admin:x", createdAt: "x" }] };
    await openFundraising();
    expect(text(row(1))).toContain("Test Dash 1");
    expect(text(row(1))).toContain("Robin Example");
    expect(text(row(1))).toContain("Raising money");
    expect(text(row(1))).toContain("05/12/2026");
    expect(text(row(1))).toContain("£60 of £250");
    expect(text(row(1))).toContain("24%");
    expect(text(row(2))).toContain("Holding an event");
    expect(text(row(3))).toContain("No date");
    expect(text(row(3))).toContain("£0 raised");
    expect(text(row(1)!.querySelector(".fr-status"))).toBe("New");
    expect(text(row(2)!.querySelector(".fr-status"))).toBe("Approved");
    expect(text(row(3)!.querySelector(".fr-status"))).toBe("Declined");
    expect(text(row(4)!.querySelector(".fr-status"))).toBe("Finished");
  });

  it("marks a sign up with a change waiting", async () => {
    records = [fundraiser(1, { status: "approved" }), fundraiser(2, { status: "approved" })];
    waiting = { 1: { id: 7, changes: { description: "New words" }, status: "waiting", createdAt: "2026-10-01T10:00:00.000Z" } };
    await openFundraising();
    expect(text(row(1)!.querySelector(".fr-changes-pill"))).toBe("Changes to check");
    expect(row(2)!.querySelector(".fr-changes-pill")).toBeNull();
  });

  it("gives the New pill only to sign ups since the last visit", async () => {
    whatsNewAreas = [{ area: "fundraising", new: true, since: "2026-10-01T00:00:00.000Z" }];
    records = [fundraiser(1, { createdAt: "2026-10-01T09:00:00.000Z" }), fundraiser(2, { createdAt: "2026-09-01T09:00:00.000Z" })];
    await openFundraising();
    expect(row(1)!.querySelector(".admin-new-pill")).not.toBeNull();
    expect(row(2)!.querySelector(".admin-new-pill")).toBeNull();
  });

  it("filters by status with the chips, and counts each", async () => {
    records = [fundraiser(1), fundraiser(2), fundraiser(3, { status: "approved" }), fundraiser(4, { status: "finished" })];
    await openFundraising();
    expect(text(q('[data-frcount="all"]'))).toBe("4");
    expect(text(q('[data-frcount="new"]'))).toBe("2");
    expect(text(q('[data-frcount="declined"]'))).toBe("0");
    (q('[data-frfilter="new"]') as HTMLElement).click();
    await settle();
    expect(qa("#frList tr[data-frtoggle]").map((r) => r.getAttribute("data-frtoggle"))).toEqual(["1", "2"]);
    expect(q('[data-frfilter="new"]')!.getAttribute("aria-pressed")).toBe("true");
    (q('[data-frfilter="declined"]') as HTMLElement).click();
    await settle();
    expect(text(el("frList"))).toMatch(/none declined/i);
  });

  it("says when nobody has signed up yet", async () => {
    await openFundraising();
    expect(text(el("frList"))).toMatch(/nobody has signed up yet/i);
  });

  it("shows the first 25 and a Show all that grows the page", async () => {
    records = Array.from({ length: 30 }, (_, i) => fundraiser(i + 1));
    await openFundraising();
    expect(qa("#frList tr[data-frtoggle]")).toHaveLength(25);
    const more = q('[data-frmore="list"]') as HTMLElement;
    expect(text(more)).toBe("Show all 30");
    more.click();
    await settle();
    expect(qa("#frList tr[data-frtoggle]")).toHaveLength(30);
  });

  it("says the list could not load, rather than that nobody has signed up", async () => {
    failures["GET /api/admin/fundraisers"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openFundraising();
    expect(text(el("frList"))).toMatch(/could not load/i);
    expect(text(el("frList"))).not.toMatch(/nobody/i);
  });

  it("sends you back to sign in when the session has gone", async () => {
    failures["GET /api/admin/fundraisers"] = { status: 401, body: { error: "Unauthorized" } };
    await openFundraising();
    expect(el("loginView").hidden).toBe(false);
  });
});

// ---- one sign up ----

describe("one sign up", () => {
  it("opens below its row with everything from the form", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    expect(row(1)!.getAttribute("aria-expanded")).toBe("true");
    const d = text(detail());
    expect(d).toContain("Running round the park in red suits.");
    expect(d).toContain("A Santa dash");
    expect(d).toContain("05/12/2026");
    expect(d).toContain("10:30");
    expect(d).toContain("The Bandstand, Testtown");
    expect(d).toContain("Show it on our website");
    expect(d).toContain("50 leaflets or posters");
    expect(d).toContain("2 buckets or tins");
    expect(d).toContain("A social media shout out");
    expect(d).toContain("1 Example Road");
    expect(d).toMatch(/Post about it on NBCC's social media\s*Yes/);
    expect(d).toMatch(/Newsletter\s*No/);
  });

  it("gives the phone, email and Facebook as links", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    expect(q('#frList a[href="tel:+447700900123"]')).not.toBeNull();
    expect(q('#frList a[href="mailto:robin@example.com"]')).not.toBeNull();
    const fb = q('#frList a[href="https://www.facebook.com/example-dash"]') as HTMLAnchorElement;
    expect(fb).not.toBeNull();
    expect(fb.getAttribute("rel")).toContain("noopener");
  });

  it("links the public page and its QR code once approved and public", async () => {
    records = [fundraiser(1, { status: "approved", pageUrl: "https://nbcc.scot/fundraise/test-dash-1" })];
    await openFundraising();
    await openRow(1);
    expect((el("frPageLink") as HTMLAnchorElement).getAttribute("href")).toBe("https://nbcc.scot/fundraise/test-dash-1");
    expect((el("frQrLink") as HTMLAnchorElement).getAttribute("href")).toBe("/fundraise/test-dash-1/qr.svg");
  });

  it("has no page link while it is not on the website", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    expect(q("#frPageLink")).toBeNull();
    expect(text(detail())).toMatch(/no page on the website/i);
  });

  it("closes again when its row is clicked", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    await openRow(1);
    expect(detail()).toBeNull();
    expect(row(1)!.getAttribute("aria-expanded")).toBe("false");
  });

  it("says it could not load, rather than showing an empty record", async () => {
    records = [fundraiser(1)];
    failures["GET /api/admin/fundraisers/1"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openFundraising();
    await openRow(1);
    expect(text(detail())).toMatch(/could not load/i);
    expect(q("#frEditForm")).toBeNull();
  });
});

// ---- approve, decline, finish ----

describe("approving, declining and finishing", () => {
  it("offers Approve and Decline for a new sign up, not Mark finished", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    expect(q('[data-fraction="approve"]')).not.toBeNull();
    expect(q('[data-fraction="decline"]')).not.toBeNull();
    expect(q('[data-fraction="finish"]')).toBeNull();
  });

  // TASK-502: a finished fundraiser's page stays up and still takes gifts, so the admin must not say
  // finishing takes it off the website (staff would rely on that to take a page down).
  it("says finishing takes it off the list, not off the website", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    confirmAnswer = false;
    (q('[data-fraction="finish"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toContain("It comes off the Get involved list.");
    expect(confirmed[0]).toContain("Its page stays up with a thank you banner and can still take gifts.");
    expect(confirmed[0]).not.toContain("It comes off the website");
  });

  it("explains a finished fundraiser's page is still up, and how to take it down", async () => {
    records = [fundraiser(1, { status: "finished" })];
    await openFundraising();
    await openRow(1);
    const words = text(q(".fx-letter .fx-state"));
    expect(words).toContain("its page stays up with a thank you banner and can still take gifts");
    expect(words).toContain("To take the page down, make it not public.");
    expect(words).not.toContain("no longer on the website");
  });

  it("approves after asking, then shows it approved", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toMatch(/approve Test Dash 1/i);
    expect(confirmed[0]).toMatch(/email/i);
    expect(sent("POST", "/api/admin/fundraisers/1/approve")).toHaveLength(1);
    expect(text(row(1)!.querySelector(".fr-status"))).toBe("Approved");
    expect(q('[data-fraction="finish"]')).not.toBeNull();
    expect(text(el("frDetailStatus"))).toMatch(/approved/i);
  });

  it("says what the organiser's email will hold, which depends on the switch", async () => {
    records = [fundraiser(1), fundraiser(2, { path: "event" }), fundraiser(3)];
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    // TASK-497: a page holder approved while fundraising is off is sent nothing yet.
    expect(confirmed[0]).toContain("Nothing is emailed yet:");
    expect(confirmed[0]).toContain("“Your page is live” by email automatically when fundraising is switched on.");
    expect(confirmed[0]).not.toMatch(/straight away/);
    expect(text(el("frDetailStatus"))).toBe("Approved. The organiser is emailed “Your page is live” when fundraising is switched on.");
    await openRow(2);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[1]).toMatch(/straight away: a short note to say they are on our list/);
    // The server sends the email after the approval, best effort, so the screen does not claim it went.
    expect(text(el("frDetailStatus"))).toBe("Approved. An email to the organiser is on its way.");
    settings.pageOn = true;
    navLink().click();
    await settle();
    await openRow(3);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[2]).toMatch(/their page link, and the page goes on the website/);
    expect(text(el("frDetailStatus"))).toBe("Approved. An email with their page link is on its way to the organiser.");
  });

  it("sends nothing when the question is answered no", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    confirmAnswer = false;
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/approve")).toHaveLength(0);
  });

  it("declines with the reason typed, kept inside NBCC", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue("#frDeclineReason", "Not something we can put our name to");
    (q('[data-fraction="decline"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/decline")[0].body).toEqual({ reason: "Not something we can put our name to" });
    expect(text(row(1)!.querySelector(".fr-status"))).toBe("Declined");
    expect(text(detail())).toContain("Not something we can put our name to");
    expect(text(detail())).toMatch(/never shown to them/i);
  });

  it("declines with no reason when none is typed", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="decline"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/decline")[0].body).toEqual({});
  });

  it("marks an approved one finished", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    expect(q('[data-fraction="approve"]')).toBeNull();
    (q('[data-fraction="finish"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toMatch(/finished/i);
    expect(sent("POST", "/api/admin/fundraisers/1/finish")).toHaveLength(1);
    expect(text(row(1)!.querySelector(".fr-status"))).toBe("Finished");
  });

  it("offers Approve again for a declined one", async () => {
    records = [fundraiser(1, { status: "declined" })];
    await openFundraising();
    await openRow(1);
    expect(q('[data-fraction="approve"]')).not.toBeNull();
    expect(q('[data-fraction="decline"]')).toBeNull();
  });

  it("shows the server's reason when it refuses", async () => {
    records = [fundraiser(1)];
    failures["POST /api/admin/fundraisers/1/approve"] = { status: 409, body: { error: "That cannot be done at this stage" } };
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(text(el("frDetailStatus"))).toBe("That cannot be done at this stage");
    expect(el("frDetailStatus").classList.contains("is-error")).toBe(true);
  });

  it("gives a viewer no buttons and no forms, only the record", async () => {
    asRole("viewer");
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1)] };
    await openFundraising();
    await openRow(1);
    expect(text(detail())).toContain("Running round the park");
    expect(qa('#frList [data-fraction]')).toHaveLength(0);
    expect(q("#frEditForm")).toBeNull();
    expect(q("#frCashForm")).toBeNull();
    expect(q("#frPhotoInput")).toBeNull();
    expect(q("[data-frhide]")).toBeNull();
  });
});

// ---- editing ----

describe("editing the details directly", () => {
  it("holds every field staff may change, filled in", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const form = el("frEditForm");
    const value = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    expect(value("title")).toBe("Test Dash 1");
    expect(value("kind")).toBe("santa_dash");
    expect(value("description")).toBe("Running round the park in red suits.");
    expect(value("eventDate")).toBe("2026-12-05");
    expect(value("startTime")).toBe("10:30");
    expect(value("venue")).toBe("The Bandstand");
    expect(value("town")).toBe("Testtown");
    expect(value("target")).toBe("250");
    expect(value("slug")).toBe("test-dash-1");
    expect((form.querySelector('[name="public"]') as HTMLInputElement).checked).toBe(true);
  });

  it("sends only what changed, the target in pence", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="title"]', "Test Dash Again");
    setValue('#frEditForm [name="target"]', "300.50");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ title: "Test Dash Again", targetPence: 30050 });
    expect(text(row(1))).toContain("Test Dash Again");
    expect(text(el("frEditStatus"))).toMatch(/saved/i);
  });

  it("clears the target when the box is emptied, and can make it private", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="target"]', "");
    (q('#frEditForm [name="public"]') as HTMLInputElement).checked = false;
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ targetPence: null, public: false });
  });

  it("says there is nothing to save when nothing changed", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")).toHaveLength(0);
    expect(text(el("frEditStatus"))).toMatch(/nothing has changed/i);
  });

  it("catches a target that is not money before sending", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="target"]', "lots");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")).toHaveLength(0);
    expect(text(q('[data-frerr="targetPence"]'))).toMatch(/pounds/i);
  });

  it("puts each message from the server under its own field", async () => {
    records = [fundraiser(1)];
    failures["PATCH /api/admin/fundraisers/1"] = {
      status: 400,
      body: { error: "Some of it needs another look", fields: { title: "Give it a name.", targetPence: "A target needs to be at least £10." } },
    };
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="title"]', "");
    setValue('#frEditForm [name="target"]', "5");
    submit("#frEditForm");
    await settle();
    expect(text(q('[data-frerr="title"]'))).toBe("Give it a name.");
    expect(text(q('[data-frerr="targetPence"]'))).toBe("A target needs to be at least £10.");
    expect(q('#frEditForm [name="title"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(text(el("frEditStatus"))).toBe("Some of it needs another look");
    // What was typed is still there to correct.
    expect((q('#frEditForm [name="target"]') as HTMLInputElement).value).toBe("5");
  });

  it("puts a web address already taken under the address", async () => {
    records = [fundraiser(1)];
    failures["PATCH /api/admin/fundraisers/1"] = { status: 409, body: { error: "Another fundraiser already uses that web address" } };
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="slug"]', "taken");
    submit("#frEditForm");
    await settle();
    expect(text(q('[data-frerr="slug"]'))).toBe("Another fundraiser already uses that web address");
  });

  it("uploads a photo through the fundraising upload, then saves it to the page", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const input = el("frPhotoInput") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "dash.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 4; i++) await settle();
    expect(sent("POST", "/api/admin/fundraiser-images")).toHaveLength(1);
    expect(sent("POST", "/api/admin/event-images")).toHaveLength(0);
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ imageSrc: "/media/events/abc" });
    expect((q("#frList img.fr-photo") as HTMLImageElement).getAttribute("src")).toBe("/media/events/abc");
  });
});

// ---- TASK-511: the sign up form, round two ----

describe("a sign up from the form's second round", () => {
  const roundTwo = (over: Record<string, unknown> = {}) =>
    fundraiser(1, {
      kind: "other",
      kindLabel: "Something else",
      kindOther: "A sponsored silence",
      name: "Robin Example",
      firstName: "Robin",
      lastName: "Example",
      socialLink: "https://www.instagram.com/robin.quiet",
      instagram: "https://www.instagram.com/robin.quiet",
      facebook: null,
      socialOk: false,
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 30, shoutOut: true, attend: false },
      postAddress: null,
      postLine1: "1 Example Road",
      postTown: "Testtown",
      postPostcode: "EX1 1EX",
      ...over,
    });

  it("shows the first name and surname, Something else in their words, each link, and printed QR codes", async () => {
    records = [roundTwo()];
    await openFundraising();
    await openRow(1);
    const d = text(detail());
    expect(d).toMatch(/First name\s*Robin/);
    expect(d).toMatch(/Surname\s*Example/);
    expect(d).toContain("Something else: A sponsored silence");
    expect(d).toMatch(/Facebook\s*Not given/);
    expect(q('#frList a[href="https://www.instagram.com/robin.quiet"]')).not.toBeNull();
    expect(d).not.toContain("Facebook or Instagram");
    expect(d).toContain("30 printed QR codes");
    expect(d).toContain("A social media shout out, but they have not said we can post about it yet");
  });

  it("edits the two parts of the name, the two links, Something else and QR codes, never the single name box", async () => {
    records = [roundTwo()];
    await openFundraising();
    await openRow(1);
    const form = el("frEditForm");
    const value = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value;
    expect(value("firstName")).toBe("Robin");
    expect(value("lastName")).toBe("Example");
    expect(value("kindOther")).toBe("A sponsored silence");
    expect(value("instagram")).toBe("https://www.instagram.com/robin.quiet");
    expect(value("facebook")).toBe("");
    expect(value("qrCount")).toBe("30");
    expect(form.querySelector('[name="name"]')).toBeNull();
    expect(form.querySelector('[name="socialLink"]')).toBeNull();
    setValue('#frEditForm [name="firstName"]', "Robyn");
    setValue('#frEditForm [name="facebook"]', "facebook.com/robyn");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ firstName: "Robyn", facebook: "facebook.com/robyn" });
  });

  it("keeps the QR codes asked for when another count changes", async () => {
    records = [roundTwo()];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="posterCount"]', "4");
    submit("#frEditForm");
    await settle();
    expect((sent("PATCH", "/api/admin/fundraisers/1")[0].body as { wants: Record<string, unknown> }).wants).toMatchObject({ posterCount: 4, qrCount: 30 });
  });

  it("leaves a sign up from before with its one name and one link", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const form = el("frEditForm");
    expect(form.querySelector('[name="name"]')).not.toBeNull();
    expect(form.querySelector('[name="socialLink"]')).not.toBeNull();
    expect(form.querySelector('[name="firstName"]')).toBeNull();
    expect(form.querySelector('[name="instagram"]')).toBeNull();
    expect(text(detail())).toContain("Facebook or Instagram");
  });

  it("says a changed web address keeps the old one working", async () => {
    records = [roundTwo()];
    await openFundraising();
    await openRow(1);
    expect(text(el("frEditForm"))).toContain("Change it and the old address still works, sending people on to the new one.");
  });
});

// ---- the waiting change ----

describe("a change waiting for staff", () => {
  beforeEach(() => {
    records = [fundraiser(1, { status: "approved", pageUrl: "https://nbcc.scot/fundraise/test-dash-1" })];
    waiting = { 1: { id: 7, changes: { description: "Now with reindeer.", targetPence: 50000, venue: "" }, status: "waiting", createdAt: "2026-10-01T10:00:00.000Z" } };
  });

  it("shows each change beside what is live now", async () => {
    await openFundraising();
    await openRow(1);
    const t = el("frChange");
    const lines = Array.from(t.querySelectorAll(":scope > tbody > tr")).map((r) => text(r));
    expect(lines[0]).toContain("Description");
    expect(lines[0]).toContain("Running round the park in red suits.");
    expect(lines[0]).toContain("Now with reindeer.");
    expect(lines[1]).toContain("£250");
    expect(lines[1]).toContain("£500");
    expect(lines[2]).toContain("The Bandstand");
    expect(lines[2]).toContain("Nothing");
  });

  it("applies it with Approve change", async () => {
    await openFundraising();
    await openRow(1);
    (q('[data-fredit="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toMatch(/approve this change/i);
    expect(confirmed[0]).toMatch(/the organiser is emailed to say so/);
    expect(sent("POST", "/api/admin/fundraisers/1/edits/7/approve")).toHaveLength(1);
    expect(q("#frChange")).toBeNull();
    expect(text(detail())).toContain("Now with reindeer.");
    expect(row(1)!.querySelector(".fr-changes-pill")).toBeNull();
  });

  it("drops it with Reject change", async () => {
    await openFundraising();
    await openRow(1);
    (q('[data-fredit="reject"]') as HTMLElement).click();
    await settle();
    // TASK-497: the organiser now gets "About your update".
    expect(confirmed[0]).toBe("Reject this change? The page stays as it is, and the organiser is emailed a short, kind note to say we will be in touch.");
    expect(sent("POST", "/api/admin/fundraisers/1/edits/7/reject")).toHaveLength(1);
    expect(q("#frChange")).toBeNull();
    expect(text(detail())).not.toContain("Now with reindeer.");
  });

  // The organiser can send a newer change while this one is open; the server then answers 409 and
  // the sign up is read again, so what is shown is what is waiting now.
  it("reads the sign up again when the change was replaced by a newer one, and says so", async () => {
    await openFundraising();
    await openRow(1);
    waiting = { 1: { id: 8, changes: { town: "Newtown" }, status: "waiting", createdAt: "2026-10-02T08:00:00.000Z" } };
    failures["POST /api/admin/fundraisers/1/edits/7/reject"] = { status: 409, body: { error: "This change has been replaced; look again" } };
    const reads = sent("GET", "/api/admin/fundraisers/1").length;
    (q('[data-fredit="reject"]') as HTMLElement).click();
    await settle();
    expect(sent("GET", "/api/admin/fundraisers/1").length).toBe(reads + 1);
    expect(text(el("frDetailStatus"))).toBe("This change has been replaced; look again");
    expect(text(el("frChange"))).toContain("Newtown");
    expect(text(el("frChange"))).not.toContain("Now with reindeer.");
    expect(q('[data-fredit="approve"]')!.getAttribute("data-freditid")).toBe("8");
  });

  it("says when the change was already dealt with", async () => {
    failures["POST /api/admin/fundraisers/1/edits/7/approve"] = { status: 409, body: { error: "That change has already been dealt with" } };
    await openFundraising();
    await openRow(1);
    (q('[data-fredit="approve"]') as HTMLElement).click();
    await settle();
    expect(text(el("frDetailStatus"))).toBe("That change has already been dealt with");
  });
});

// ---- the meter and cash ----

describe("the meter and cash paid in", () => {
  beforeEach(() => {
    records = [fundraiser(1, { status: "approved" })];
    online = { 1: 5000 };
    cashRows = { 1: [{ id: 7, amountPence: 1000, paidInOn: "2026-09-30", note: "Tin at the bakery", createdBy: "admin:fern@example.com", createdAt: "2026-09-30T12:00:00.000Z" }] };
  });

  it("shows raised, online and cash, and an accessible bar", async () => {
    await openFundraising();
    await openRow(1);
    const m = q("#frList .fr-meter") as HTMLElement;
    expect(text(m)).toContain("£60 raised of £250");
    expect(text(m)).toContain("24%");
    expect(text(m)).toContain("£50 online");
    expect(text(m)).toContain("£10 cash");
    const bar = m.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute("aria-valuenow")).toBe("24");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
  });

  it("holds the bar at 100 when it passes the target", async () => {
    online = { 1: 40000 };
    await openFundraising();
    await openRow(1);
    const m = q("#frList .fr-meter") as HTMLElement;
    expect(text(m)).toContain("164%");
    expect((m.querySelector(".fr-meter-fill") as HTMLElement).style.width).toBe("100%");
  });

  it("lists the cash with its date, note and who added it", async () => {
    await openFundraising();
    await openRow(1);
    const line = text(q('[data-frcash="7"]'));
    expect(line).toContain("£10");
    expect(line).toContain("30/09/2026");
    expect(line).toContain("Tin at the bakery");
    expect(line).toContain("fern@example.com");
  });

  it("adds cash in pounds, and the meter goes up", async () => {
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "12.50");
    setValue('#frCashForm [name="paidInOn"]', "2026-10-01");
    setValue('#frCashForm [name="note"]', "Bucket at the school fair");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")[0].body).toEqual({ amountPence: 1250, paidInOn: "2026-10-01", note: "Bucket at the school fair" });
    expect(text(q("#frList .fr-meter"))).toContain("£72.50 raised");
    expect(text(row(1))).toContain("£72.50 of £250");
    expect(text(el("frCashStatus"))).toMatch(/added/i);
  });

  it("sends one cash row however quickly Add is pressed twice", async () => {
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "5");
    submit("#frCashForm");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(1);
    // And the next one goes through once the first has finished.
    setValue('#frCashForm [name="amount"]', "6");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(2);
  });

  it("catches an amount that is not money before sending", async () => {
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "a tenner");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(0);
    expect(text(q('[data-frerr="amountPence"]'))).toMatch(/pounds/i);
  });

  it("shows the server's message under the date", async () => {
    failures["POST /api/admin/fundraisers/1/cash"] = { status: 400, body: { error: "Some of it needs another look", fields: { paidInOn: "That date does not exist." } } };
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "5");
    setValue('#frCashForm [name="paidInOn"]', "2026-02-30");
    submit("#frCashForm");
    await settle();
    expect(text(q('#frCashForm [data-frerr="paidInOn"]'))).toBe("That date does not exist.");
  });

  it("removes cash after asking, and the meter comes down", async () => {
    await openFundraising();
    await openRow(1);
    (q('[data-frcashremove="7"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toMatch(/remove £10/i);
    expect(sent("DELETE", "/api/admin/fundraisers/1/cash/7")).toHaveLength(1);
    expect(q('[data-frcash="7"]')).toBeNull();
    expect(text(q("#frList .fr-meter"))).toContain("£50 raised");
  });
});

// ---- the wall and history ----

describe("the supporter wall", () => {
  it("lists every gift with who gave, how it shows, the amount and the message", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1), gift(2, { anonymous: true, shortName: "Anonymous", hidden: true })] };
    await openFundraising();
    await openRow(1);
    const first = text(q('[data-frwall="501"]'));
    expect(first).toContain("Giver Number1");
    expect(first).toContain("Shown as Giver N.");
    expect(first).toContain("£10.01");
    expect(first).toContain("Go on, message 1");
    const second = q('[data-frwall="502"]') as HTMLElement;
    expect(text(second)).toContain("Shown as Anonymous");
    expect(text(second.querySelector(".fr-hidden-pill"))).toBe("Hidden");
  });

  it("hides and shows a message", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1), gift(2, { hidden: true })] };
    await openFundraising();
    await openRow(1);
    (q('[data-frhide="501"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/wall/501/hide")).toHaveLength(1);
    expect(q('[data-frwall="501"] .fr-hidden-pill')).not.toBeNull();
    (q('[data-frshow="502"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/wall/502/show")).toHaveLength(1);
    expect(q('[data-frwall="502"] .fr-hidden-pill')).toBeNull();
  });

  it("shows the newest 10, then Show all", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: Array.from({ length: 12 }, (_, i) => gift(i + 1)) };
    await openFundraising();
    await openRow(1);
    expect(qa("[data-frwall]")).toHaveLength(10);
    (q('[data-frmore="wall"]') as HTMLElement).click();
    await settle();
    expect(qa("[data-frwall]")).toHaveLength(12);
  });

  it("says when nobody has given yet", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    expect(text(el("frWall"))).toMatch(/no gifts on this page yet/i);
  });
});

describe("History", () => {
  it("says what happened, who did it and when", async () => {
    records = [fundraiser(1, { status: "approved" })];
    historyRows = {
      1: [
        { id: 3, actor: "admin:fern@example.com", action: "fundraiser.approved", data: {}, createdAt: "2026-10-01T09:00:00.000Z" },
        { id: 2, actor: "admin:fern@example.com", action: "fundraiser.cash_added", data: { amountPence: 1000 }, createdAt: "2026-09-30T09:00:00.000Z" },
        { id: 1, actor: "public", action: "fundraiser.signed_up", data: {}, createdAt: "2026-09-20T09:00:00.000Z" },
      ],
    };
    await openFundraising();
    await openRow(1);
    const h = text(el("frHistory"));
    expect(h).toContain("Approved");
    expect(h).toContain("Cash added: £10");
    expect(h).toContain("Signed up");
    expect(h).toContain("fern@example.com");
    expect(h).toContain("01/10/2026");
  });

  it("shows the latest 10, then Show all", async () => {
    records = [fundraiser(1)];
    historyRows = { 1: Array.from({ length: 14 }, (_, i) => ({ id: i, actor: "admin:x@example.com", action: "fundraiser.updated", data: {}, createdAt: "2026-10-01T09:00:00.000Z" })) };
    await openFundraising();
    await openRow(1);
    expect(qa("#frHistory li")).toHaveLength(10);
    (q('[data-frmore="history"]') as HTMLElement).click();
    await settle();
    expect(qa("#frHistory li")).toHaveLength(14);
  });

  it("says it could not load the history", async () => {
    records = [fundraiser(1)];
    failures["GET /api/admin/fundraisers/1/history"] = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await openFundraising();
    await openRow(1);
    expect(text(el("frHistory"))).toMatch(/could not load/i);
  });
});

// ---- from the review of #617 ----

describe("one change at a time", () => {
  it("keeps Add resting until the sign up has been read again, then empties the form", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    const release = gate("GET /api/admin/fundraisers/1");
    setValue('#frCashForm [name="amount"]', "5");
    setValue('#frCashForm [name="note"]', "Tin at the library");
    submit("#frCashForm");
    // Said at once, not after the answer.
    expect(text(el("frCashStatus"))).toBe("Adding…");
    await settle();
    // The POST has answered; the sign up is still being read again.
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(1);
    expect((q('#frCashForm button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(1);
    release();
    await settle();
    expect((q('#frCashForm [name="amount"]') as HTMLInputElement).value).toBe("");
    expect((q('#frCashForm [name="note"]') as HTMLInputElement).value).toBe("");
    expect((q('#frCashForm button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
    expect(text(el("frCashStatus"))).toMatch(/£5 added/);
  });

  it("shows Saving at once while the details are on their way", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const release = gate("PATCH /api/admin/fundraisers/1");
    setValue('#frEditForm [name="title"]', "Test Dash Renamed");
    submit("#frEditForm");
    expect(text(el("frEditStatus"))).toBe("Saving…");
    release();
    await settle();
    expect(text(el("frEditStatus"))).toBe("Saved.");
  });

  it("blocks a second photo while the first is uploading, and keeps an upload's error in view", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const release = gate("POST /api/admin/fundraiser-images");
    const choose = () => {
      const input = el("frPhotoInput") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    choose();
    for (let i = 0; i < 3; i++) await settle();
    choose();
    for (let i = 0; i < 3; i++) await settle();
    release();
    for (let i = 0; i < 4; i++) await settle();
    expect(sent("POST", "/api/admin/fundraiser-images")).toHaveLength(1);
    failures["POST /api/admin/fundraiser-images"] = { status: 413, body: { error: "That picture is too big (2 MB at most)" } };
    choose();
    for (let i = 0; i < 4; i++) await settle();
    expect(text(el("frPhotoStatus"))).toBe("That picture is too big (2 MB at most)");
    expect(el("frPhotoStatus").classList.contains("is-error")).toBe(true);
  });

  it("drops a message that arrives after another sign up was opened", async () => {
    records = [fundraiser(1), fundraiser(2)];
    await openFundraising();
    await openRow(1);
    const release = gate("PATCH /api/admin/fundraisers/1");
    setValue('#frEditForm [name="title"]', "Test Dash Renamed");
    submit("#frEditForm");
    await openRow(2);
    release();
    await settle();
    expect(detail()!.getAttribute("data-frdetail")).toBe("2");
    expect(text(el("frEditStatus"))).toBe("");
    expect(text(el("frDetailStatus"))).toBe("");
  });
});

describe("a typed change never undoes an approved one", () => {
  it("forgets what was typed once a change is approved, and saves only what is typed after", async () => {
    records = [fundraiser(1, { status: "approved" })];
    waiting = { 1: { id: 7, changes: { description: "Now with reindeer." }, status: "waiting", createdAt: "2026-10-01T10:00:00.000Z" } };
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="town"]', "Othertown");
    (q('[data-fredit="approve"]') as HTMLElement).click();
    await settle();
    expect((q('#frEditForm [name="description"]') as HTMLTextAreaElement).value).toBe("Now with reindeer.");
    expect((q('#frEditForm [name="town"]') as HTMLInputElement).value).toBe("Testtown");
    setValue('#frEditForm [name="title"]', "Test Dash Renamed");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ title: "Test Dash Renamed" });
  });

  it("keeps a typed box through another redraw, and only that box", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1)] };
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="venue"]', "The Old Mill");
    (q('[data-frhide="501"]') as HTMLElement).click();
    await settle();
    expect((q('#frEditForm [name="venue"]') as HTMLInputElement).value).toBe("The Old Mill");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({ venue: "The Old Mill" });
  });
});

describe("every detail staff may change", () => {
  it("holds the organiser's details, their requests and their choices", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    const form = el("frEditForm");
    const value = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).value;
    const ticked = (n: string) => (form.querySelector(`[name="${n}"]`) as HTMLInputElement).checked;
    expect(value("path")).toBe("raising");
    expect(value("name")).toBe("Robin Example");
    expect(value("email")).toBe("robin@example.com");
    expect(value("phone")).toBe("+44 (0)7700 900123");
    expect(value("socialLink")).toBe("https://www.facebook.com/example-dash");
    expect(value("postAddress")).toBe("1 Example Road\nTesttown");
    expect(value("leaflets")).toBe("50");
    expect(value("buckets")).toBe("2");
    expect(ticked("shoutOut")).toBe(true);
    expect(ticked("attend")).toBe(false);
    expect(ticked("socialOk")).toBe(true);
    expect(ticked("public")).toBe(true);
  });

  it("sends the organiser's details, and all of what they asked for when part of it changes", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="phone"]', "01632 960123");
    setValue('#frEditForm [name="buckets"]', "3");
    const attend = q('#frEditForm [name="attend"]') as HTMLInputElement;
    attend.checked = true;
    attend.dispatchEvent(new Event("change", { bubbles: true }));
    const social = q('#frEditForm [name="socialOk"]') as HTMLInputElement;
    social.checked = false;
    social.dispatchEvent(new Event("change", { bubbles: true }));
    setValue('#frEditForm [name="path"]', "event");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")[0].body).toEqual({
      path: "event",
      phone: "01632 960123",
      socialOk: false,
      // TASK-499: the whole of what they would like, the split counts at 0 for a sign up from before.
      wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 50, buckets: 3, qrCount: 0, shoutOut: true, attend: true },
    });
  });

  it("catches a count that is not a whole number before sending", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="leaflets"]', "lots");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")).toHaveLength(0);
    expect(text(q('[data-frerr="wants.leaflets"]'))).toMatch(/whole number/i);
  });

  it("puts the server's messages under the organiser's boxes", async () => {
    records = [fundraiser(1)];
    failures["PATCH /api/admin/fundraisers/1"] = {
      status: 400,
      body: {
        error: "Some of it needs another look",
        fields: {
          phone: "That does not look like a phone number.",
          email: "Please check your email address.",
          "wants.buckets": "We can lend up to 20 buckets or tins.",
          socialLink: "Paste the full link, starting https://",
        },
      },
    };
    await openFundraising();
    await openRow(1);
    setValue('#frEditForm [name="phone"]', "abc");
    submit("#frEditForm");
    await settle();
    expect(text(q('[data-frerr="phone"]'))).toBe("That does not look like a phone number.");
    expect(text(q('[data-frerr="email"]'))).toBe("Please check your email address.");
    expect(text(q('[data-frerr="wants.buckets"]'))).toBe("We can lend up to 20 buckets or tins.");
    expect(text(q('[data-frerr="socialLink"]'))).toBe("Paste the full link, starting https://");
    const buckets = q('#frEditForm [name="buckets"]') as HTMLInputElement;
    expect(buckets.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(buckets.getAttribute("aria-describedby")!)).toBe(q('[data-frerr="wants.buckets"]'));
  });
});

describe("pounds typed with commas", () => {
  it("takes a comma between thousands", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "£1,250.50");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")[0].body).toMatchObject({ amountPence: 125050 });
  });

  it("asks for a full stop rather than reading 12,50 as £1,250", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    setValue('#frCashForm [name="amount"]', "12,50");
    submit("#frCashForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/cash")).toHaveLength(0);
    expect(text(q('[data-frerr="amountPence"]'))).toBe("Use a full stop for the pence, like 12.50.");
    setValue('#frEditForm [name="target"]', "250,50");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/1")).toHaveLength(0);
    expect(text(q('[data-frerr="targetPence"]'))).toBe("Use a full stop for the pence, like 250.50.");
  });
});

// ---- the keyboard ----

describe("keyboard focus survives a redraw", () => {
  it("stays in the box you were typing in", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    (q("#frf-title") as HTMLInputElement).focus();
    submit("#frEditForm");
    await settle();
    expect(document.activeElement?.id).toBe("frf-title");
  });

  it("goes back to the sign up's row when the button pressed has gone", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1)] };
    await openFundraising();
    await openRow(1);
    const hide = q('[data-frhide="501"]') as HTMLButtonElement;
    hide.focus();
    hide.click();
    await settle();
    expect(document.activeElement).toBe(row(1));
  });

  it("opens and closes a sign up with Enter", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    row(1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(detail()).not.toBeNull();
  });
});

// ---- hostile text ----

describe("stored text is shown as text, never run", () => {
  it("renders every stored field inert", async () => {
    const evil = '<img src="x" onerror="window.__frPwned=1">';
    records = [
      fundraiser(1, {
        title: evil,
        name: evil,
        description: evil,
        venue: evil,
        town: evil,
        postAddress: evil,
        email: 'x"@example.com',
        phone: evil,
        socialLink: "javascript:alert(1)",
        declinedReason: evil,
        status: "declined",
        imageSrc: "javascript:alert(1)",
      }),
    ];
    waiting = { 1: { id: 7, changes: { description: evil, socialLink: "javascript:alert(2)" }, status: "waiting", createdAt: "2026-10-01T10:00:00.000Z" } };
    cashRows = { 1: [{ id: 7, amountPence: 1000, paidInOn: "2026-09-30", note: evil, createdBy: evil, createdAt: "x" }] };
    wallRows = { 1: [gift(1, { fullName: evil, shortName: evil, message: evil })] };
    historyRows = { 1: [{ id: 1, actor: evil, action: evil, data: { reason: evil }, createdAt: "2026-10-01T09:00:00.000Z" }] };
    await openFundraising();
    await openRow(1);
    const view = el("view-fundraising");
    expect(view.querySelector('img[src="x"]')).toBeNull();
    expect(view.querySelector("[onerror]")).toBeNull();
    expect(Array.from(view.querySelectorAll("a")).filter((a) => /^\s*javascript:/i.test(a.getAttribute("href") || ""))).toHaveLength(0);
    expect(Array.from(view.querySelectorAll("img")).filter((i) => /^\s*javascript:/i.test(i.getAttribute("src") || ""))).toHaveLength(0);
    expect(text(row(1))).toContain(evil);
    expect((window as unknown as { __frPwned?: number }).__frPwned).toBeUndefined();
  });
});

// ---- the stylesheet ----

describe("the stylesheet", () => {
  it("never scrolls inside a box on this screen", () => {
    const rules = css.split("}").filter((r) => r.includes("#view-fundraising") || /\.fr-[a-z]/.test(r));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r, r).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
      expect(r, r).not.toMatch(/white-space\s*:\s*nowrap/);
    }
  });
});

// TASK-499: the new answers from the sign up form: the requests split into posters, leaflets,
// buckets and tins, the address in its boxes, and for an event, the event questions. Staff see
// every one and can change every one; a sign up from before reads and saves as it always did.
describe("the new answers from the sign up form", () => {
  const answered = (id: number, over: Record<string, unknown> = {}) =>
    fundraiser(id, {
      path: "event",
      kind: "quiz_party",
      kindLabel: "A quiz or party",
      title: "The Test Quiz",
      targetPence: null,
      wants: { posterCount: 5, leafletCount: 100, bucketCount: 1, tinCount: 2, leaflets: 0, buckets: 0, shoutOut: false, attend: true },
      postAddress: null,
      postLine1: "2 Example Road",
      postLine2: "Flat 1",
      postTown: "Testtown",
      postPostcode: "TE1 1ST",
      cardLine: "Eight rounds and a raffle, all for NBCC.",
      endTime: "22:30",
      timeTbc: true,
      venueAddress: "Main Street, Testtown",
      venuePostcode: "KA1 1AA",
      access: ["step free entry", "a hearing loop"],
      price: "£5 on the door",
      booking: "away",
      ticketUrl: "https://tickets.example.com/quiz",
      ageLimit: "18 and over",
      dressCode: "Festive jumpers",
      included: "A mince pie",
      creditName: "The Quiz Team",
      ...over,
    });
  const form = () => el("frEditForm");
  const value = (n: string) => (form().querySelector(`[name="${n}"]`) as HTMLInputElement | null)?.value;
  const ticked = (n: string) => (form().querySelector(`[name="${n}"]`) as HTMLInputElement).checked;
  function tickBox(n: string, on: boolean) {
    const box = q(`#frEditForm [name="${n}"]`) as HTMLInputElement;
    box.checked = on;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("shows each request on its own, and the address from its boxes", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    const d = text(detail());
    for (const words of ["5 posters", "100 leaflets", "1 collection bucket", "2 collection tins", "2 Example Road", "Flat 1", "TE1 1ST"]) {
      expect(d).toContain(words);
    }
    expect(d).not.toContain("leaflets or posters");
  });

  it("shows every event answer, in the events editor's words", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    const d = text(detail());
    for (const words of [
      "Eight rounds and a raffle, all for NBCC.",
      "22:30",
      "The time is still to be confirmed",
      "Main Street, Testtown",
      "KA1 1AA",
      "Step free entry, Hearing loop",
      "£5 on the door",
      "Tickets are sold on another website",
      "18 and over",
      "Festive jumpers",
      "A mince pie",
      "The Quiz Team",
    ]) {
      expect(d).toContain(words);
    }
    const link = q('#frList a[href="https://tickets.example.com/quiz"]') as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("asks no event questions of someone raising money", async () => {
    records = [fundraiser(1)];
    await openFundraising();
    await openRow(1);
    expect(text(detail())).not.toContain("Front of the card");
    expect(form().querySelector('[name="cardLine"]')).toBeNull();
  });

  it("says what was not given for an event signed up before the questions", async () => {
    records = [fundraiser(3, { path: "event", targetPence: null })];
    await openFundraising();
    await openRow(3);
    const d = text(detail());
    expect(d).toMatch(/How people get in\s*Not given/);
    expect(d).toMatch(/Access\s*None ticked/);
    expect(d).toMatch(/Credit it to\s*Not given, so the card says Robin E\./);
  });

  it("keeps the old combined requests and address box only for a sign up from before", async () => {
    records = [fundraiser(1), answered(2)];
    await openFundraising();
    await openRow(1);
    expect(text(form().querySelector('label[for="frf-leaflets"]'))).toBe("Leaflets or posters");
    expect(text(form().querySelector('label[for="frf-buckets"]'))).toBe("Buckets or tins to borrow");
    expect(value("postAddress")).toBe("1 Example Road\nTesttown");
    await openRow(2);
    expect(form().querySelector('[name="leaflets"]')).toBeNull();
    expect(form().querySelector('[name="buckets"]')).toBeNull();
    expect(form().querySelector('[name="postAddress"]')).toBeNull();
  });

  it("holds every new answer, filled in", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    expect(value("posterCount")).toBe("5");
    expect(value("leafletCount")).toBe("100");
    expect(value("bucketCount")).toBe("1");
    expect(value("tinCount")).toBe("2");
    expect(value("postLine1")).toBe("2 Example Road");
    expect(value("postLine2")).toBe("Flat 1");
    expect(value("postTown")).toBe("Testtown");
    expect(value("postPostcode")).toBe("TE1 1ST");
    expect(value("cardLine")).toBe("Eight rounds and a raffle, all for NBCC.");
    expect(value("endTime")).toBe("22:30");
    expect(ticked("timeTbc")).toBe(true);
    expect(value("venueAddress")).toBe("Main Street, Testtown");
    expect(value("venuePostcode")).toBe("KA1 1AA");
    expect([0, 1, 2, 3].map((i) => ticked("access" + i))).toEqual([true, false, true, false]);
    expect(value("price")).toBe("£5 on the door");
    expect(value("booking")).toBe("away");
    expect(value("ticketUrl")).toBe("https://tickets.example.com/quiz");
    expect(value("ageLimit")).toBe("18 and over");
    expect(value("dressCode")).toBe("Festive jumpers");
    expect(value("included")).toBe("A mince pie");
    expect(value("creditName")).toBe("The Quiz Team");
    expect(text(form())).toContain("Access: tick only what the venue has confirmed");
  });

  it("sends only the event answers that changed", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    setValue('#frEditForm [name="price"]', "Free");
    setValue('#frEditForm [name="booking"]', "free");
    tickBox("access1", true);
    tickBox("timeTbc", false);
    setValue('#frEditForm [name="endTime"]', "");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/2")[0].body).toEqual({
      price: "Free",
      booking: "free",
      access: ["step free entry", "accessible toilets", "a hearing loop"],
      timeTbc: false,
      endTime: null,
    });
  });

  it("sends the address boxes that changed", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    setValue('#frEditForm [name="postLine2"]', "");
    setValue('#frEditForm [name="postPostcode"]', "te2 2st");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/2")[0].body).toEqual({ postLine2: "", postPostcode: "te2 2st" });
  });

  it("sends all of what they would like when one count changes", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    setValue('#frEditForm [name="tinCount"]', "4");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/2")[0].body).toEqual({
      wants: { posterCount: 5, leafletCount: 100, bucketCount: 1, tinCount: 4, leaflets: 0, buckets: 0, qrCount: 0, shoutOut: false, attend: true },
    });
  });

  it("catches a new count that is not a whole number before sending", async () => {
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    setValue('#frEditForm [name="tinCount"]', "two");
    submit("#frEditForm");
    await settle();
    expect(sent("PATCH", "/api/admin/fundraisers/2")).toHaveLength(0);
    expect(text(q('[data-frerr="wants.tinCount"]'))).toMatch(/whole number/i);
  });

  it("puts the server's messages under the new boxes", async () => {
    records = [answered(2)];
    failures["PATCH /api/admin/fundraisers/2"] = {
      status: 400,
      body: {
        error: "Some of it needs another look",
        fields: {
          ticketUrl: "Paste the full web address, starting https://",
          postPostcode: "That does not look like a UK postcode, like KA1 1AA.",
          endTime: "The finish time is before the start.",
        },
      },
    };
    await openFundraising();
    await openRow(2);
    setValue('#frEditForm [name="ticketUrl"]', "http://tickets.example.com");
    submit("#frEditForm");
    await settle();
    expect(text(q('[data-frerr="ticketUrl"]'))).toBe("Paste the full web address, starting https://");
    expect(text(q('[data-frerr="postPostcode"]'))).toBe("That does not look like a UK postcode, like KA1 1AA.");
    expect(text(q('[data-frerr="endTime"]'))).toBe("The finish time is before the start.");
    expect((q('#frEditForm [name="ticketUrl"]') as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("lets a viewer read the new answers, with no form", async () => {
    asRole("viewer");
    records = [answered(2)];
    await openFundraising();
    await openRow(2);
    expect(text(detail())).toContain("Tickets are sold on another website");
    expect(q("#frEditForm")).toBeNull();
  });
});

// ---- TASK-501: the private area's side of the admin ----

describe("what the organiser's private area adds", () => {
  it("marks a fundraiser whose organiser says they have finished", async () => {
    records = [
      fundraiser(1, { status: "approved", finishedRequestedAt: "2026-10-02T09:00:00.000Z" }),
      fundraiser(2, { status: "approved" }),
    ];
    await openFundraising();
    expect(text(row(1)!.querySelector(".fr-finished-pill"))).toBe("Says they've finished");
    expect(row(2)!.querySelector(".fr-finished-pill")).toBeNull();
    await openRow(1);
    expect(text(detail())).toContain("Says they've finished");
    expect(text(detail())).toContain("02/10/2026");
  });

  it("drops the pill once staff mark it finished", async () => {
    records = [fundraiser(1, { status: "finished", finishedRequestedAt: "2026-10-02T09:00:00.000Z" })];
    await openFundraising();
    expect(row(1)!.querySelector(".fr-finished-pill")).toBeNull();
  });

  it("shows the QR code itself, beside the link to download it", async () => {
    records = [fundraiser(1, { status: "approved", pageUrl: "https://nbcc.scot/fundraise/test-dash-1" })];
    await openFundraising();
    await openRow(1);
    const img = q("#frList img.fr-qr-preview") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/fundraise/test-dash-1/qr.svg");
    expect(img.getAttribute("alt")).toBe("QR code for Test Dash 1");
    expect((el("frQrLink") as HTMLAnchorElement).getAttribute("href")).toBe("/fundraise/test-dash-1/qr.svg");
  });

  it("shows an event's details in a waiting change, in words", async () => {
    records = [fundraiser(1, { status: "approved", path: "event", endTime: "22:00", booking: "door", access: [], timeTbc: false })];
    waiting = {
      1: {
        id: 8,
        changes: { endTime: "23:00", booking: "away", ticketUrl: "https://tickets.example.com/x", access: ["step free entry", "a hearing loop"], timeTbc: true, price: "£6" },
        status: "waiting",
        createdAt: "2026-10-01T10:00:00.000Z",
      },
    };
    await openFundraising();
    await openRow(1);
    const t = text(el("frChange"));
    expect(t).toContain("Finish time");
    expect(t).toContain("23:00");
    expect(t).toContain("Tickets are sold on another website");
    expect(t).toContain("Pay on the door, no booking needed");
    expect(t).toContain("Step free entry, Hearing loop");
    expect(t).toContain("Time still to be confirmed");
    expect(t).toContain("Yes");
    expect(t).toContain("https://tickets.example.com/x");
    expect(t).toContain("£6");
  });

  it("marks money the organiser paid in on the wall, with nothing to hide", async () => {
    records = [fundraiser(1, { status: "approved" })];
    wallRows = { 1: [gift(1), gift(2, { paidIn: true, message: null, showName: false, showAmount: false, shortName: "Anonymous" })] };
    await openFundraising();
    await openRow(1);
    const paid = q('[data-frwall="502"]') as HTMLElement;
    expect(text(paid.querySelector(".fr-paidin-pill"))).toBe("Paid in by the organiser");
    expect(paid.querySelector("[data-frhide]")).toBeNull();
    expect(q('[data-frwall="501"] .fr-paidin-pill')).toBeNull();
  });

  it("names the new things in History", async () => {
    records = [fundraiser(1, { status: "approved" })];
    historyRows = {
      1: [
        { id: 1, actor: "organiser", action: "fundraiser.finish_requested", data: {}, createdAt: "2026-10-02T09:00:00.000Z" },
        { id: 2, actor: "stripe", action: "fundraiser.paid_in", data: {}, createdAt: "2026-10-02T10:00:00.000Z" },
      ],
    };
    await openFundraising();
    await openRow(1);
    await settle();
    const h = text(el("frHistory"));
    expect(h).toContain("The organiser said they have finished");
    expect(h).toContain("The organiser paid in money they collected");
  });
});


// TASK-504: the materials, from one sign up. They open in their own tab, fetched with the staff
// member's session (a plain link would carry none), and the print size QR code sits beside the SVG.
describe("its materials", () => {
  type Tab = { closed: boolean; location: { href: string }; document: { title: string; body: { textContent: string } }; close: () => void };
  let tabs: Tab[];
  let blobs: string[];
  beforeEach(() => {
    tabs = [];
    blobs = [];
    window.open = (() => {
      const tab: Tab = { closed: false, location: { href: "" }, document: { title: "", body: { textContent: "" } }, close: () => (tab.closed = true) };
      tabs.push(tab);
      return tab;
    }) as unknown as typeof window.open;
    URL.createObjectURL = ((b: Blob) => {
      blobs.push(b.type);
      return "blob:nbcc.test/material-" + blobs.length;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => undefined;
  });

  const buttons = () => qa("#frList [data-frmaterial]").map((b) => b.getAttribute("data-frmaterial"));

  it("offers the poster, pictures, sponsor form and a certificate preview for an approved one", async () => {
    records = [fundraiser(1, { status: "approved", pageUrl: "https://nbcc.scot/fundraise/test-dash-1" })];
    await openFundraising();
    await openRow(1);
    expect(buttons()).toEqual(["poster", "social", "sponsor-form", "certificate"]);
    expect(text(q('#frList [data-frmaterial="certificate"]'))).toContain("preview");
  });

  it("offers the certificate itself once finished", async () => {
    records = [fundraiser(1, { status: "finished" })];
    await openFundraising();
    await openRow(1);
    expect(text(q('#frList [data-frmaterial="certificate"]'))).not.toContain("preview");
  });

  it("offers nothing for a sign up that is not approved", async () => {
    records = [fundraiser(1, { status: "new" }), fundraiser(2, { status: "declined" })];
    await openFundraising();
    await openRow(1);
    expect(buttons()).toEqual([]);
  });

  it("opens a piece in its own tab, fetched with the session", async () => {
    records = [fundraiser(1, { status: "approved" })];
    await openFundraising();
    await openRow(1);
    (q('#frList [data-frmaterial="poster"]') as HTMLButtonElement).click();
    await settle();
    expect(sent("GET", "/api/admin/fundraisers/1/materials/poster").length).toBe(1);
    expect(tabs.length).toBe(1);
    expect(blobs).toEqual(["text/html"]);
    expect(tabs[0].location.href).toBe("blob:nbcc.test/material-1");
  });

  it("closes the waiting tab and says so when it cannot be made", async () => {
    records = [fundraiser(1, { status: "approved" })];
    failures["GET /api/admin/fundraisers/1/materials/social"] = { status: 500, body: { error: "no" } };
    await openFundraising();
    await openRow(1);
    (q('#frList [data-frmaterial="social"]') as HTMLButtonElement).click();
    await settle();
    expect(tabs[0].closed).toBe(true);
    expect(text(el("frDetailStatus"))).toMatch(/could not open/i);
  });

  it("puts the print size PNG of the QR code beside the SVG", async () => {
    records = [fundraiser(1, { status: "approved", pageUrl: "https://nbcc.scot/fundraise/test-dash-1" })];
    await openFundraising();
    await openRow(1);
    const png = el("frQrPngLink") as HTMLAnchorElement;
    expect(png.getAttribute("href")).toBe("/fundraise/test-dash-1/qr.png");
    expect(png.getAttribute("download")).toBe("qr-test-dash-1.png");
  });
});
