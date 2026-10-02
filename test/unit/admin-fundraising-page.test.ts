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
let settings = { pageOn: false, updatedAt: null as string | null, updatedBy: null as string | null };
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let failures: Record<string, { status: number; body: unknown }> = {};
let calls: { method: string; path: string; body: unknown }[] = [];
let whatsNewAreas: unknown[] = [];

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
    return j(settings);
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
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
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
