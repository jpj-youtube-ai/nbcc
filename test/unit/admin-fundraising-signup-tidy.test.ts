// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// The sign up tidy (Jaimie, 2026-10-03) on Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-memory-panel.test.ts): each category has a Sporting tick (admins only); an open
// sign up shows the welcome pack's address, sport and the T-shirt size in What they told us; staff
// correct sport and the size; and a sporting event with no size says "Waiting for T-shirt size",
// with a button that emails the organiser a link to choose one. A fake fetch stands in for the API.
// Every person, place and number is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
type Rec = Record<string, unknown> & { id: number };
function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "ime-" + id, path: "raising", kind: "other", kindLabel: "Other", title: "Robin's Walk",
    description: "Five miles.", eventDate: null, startTime: null, venue: "", town: "Testtown", targetPence: 50000, public: true,
    status: "new", name: "Robin Example", email: "robin@example.com", phone: "07700 900123", socialLink: null, socialOk: false,
    wants: { ...NONE }, postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2025-09-20T10:00:00.000Z",
    approvedAt: "2025-09-21T10:00:00.000Z", approvedBy: "admin:fern@example.com", updatedAt: "2025-09-21T10:00:00.000Z", updatedBy: null,
    pageUrl: "https://nbcc.scot/fundraise/ime-" + id, finishedRequestedAt: null, offListAt: null, offListBy: null,
    inMemory: false, isSporting: null, tshirtSize: null, tshirtAskedAt: null, tshirtAskedBy: null,
    postLine1: "1 Example Road", postLine2: null, postTown: "Exampleton", postPostcode: "EX1 1EX",
    ...over,
  };
}
const meter = { raisedPence: 6000, onlinePence: 6000, cashPence: 0, targetPence: 50000, percent: 12, barPercent: 12, overTarget: false };

let records: Rec[] = [];
let wall: Array<Record<string, unknown>> = [];
let memoryCounts: Record<string, number> = {};
let cats: Array<Record<string, unknown> & { key: string }> = [];
let perms: PermissionMap;
let role = "admin";
let calls: { method: string; path: string; body: unknown }[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve("<!doctype html><title>x</title>"),
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
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  if (path === "/api/admin/fundraising/memory-waiting") return j({ counts: memoryCounts });
  if (path === "/api/admin/fundraising/team") return j({ today: "2026-10-03", me: 3, calls: {}, prompts: {}, invites: [], signers: [] });
  if (path === "/api/admin/fundraising/summary") return j({ recipients: [], lastWeek: null });
  if (path === "/api/admin/fundraising/requests") return j({ today: "2026-10-03", requests: {}, toDo: {}, notBack: {}, totals: {} });
  if (path === "/api/admin/fundraising/thanks-waiting") return j({ counts: {} });
  if (path === "/api/admin/fundraising/categories" && method === "GET") return j({ categories: cats });
  const cat = path.match(/^\/api\/admin\/fundraising\/categories\/([a-z0-9_]+)$/);
  if (cat && method === "PATCH") {
    const c = cats.find((x) => x.key === cat[1])!;
    Object.assign(c, body);
    return j({ category: c });
  }
  const pack = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/welcome-pack$/);
  if (pack && method === "PUT") {
    const f = records.find((x) => String(x.id) === pack[1])!;
    Object.assign(f, body);
    return j({ fundraiser: f });
  }
  const ask = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/tshirt-ask$/);
  if (ask && method === "POST") {
    const f = records.find((x) => String(x.id) === ask[1])!;
    Object.assign(f, { tshirtAskedAt: "2026-10-03T10:00:00.000Z", tshirtAskedBy: "admin:fern@example.com" });
    return j({ fundraiser: f });
  }
  const approve = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/wall\/(\d+)\/approve$/);
  if (approve && method === "POST") {
    const g = wall.find((w) => String(w.donationId) === approve[2])!;
    g.held = false;
    delete memoryCounts[approve[1]];
    return j({ donationId: Number(approve[2]), approved: true });
  }
  const done = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/memory\/year-on-done$/);
  if (done && method === "POST") {
    const f = records.find((x) => String(x.id) === done[1])!;
    Object.assign(f, { memoryYearOnDue: false, memoryReminderDoneAt: "2026-10-03T10:00:00.000Z", memoryReminderDoneBy: "admin:fern@example.com" });
    return j({ done: true });
  }
  const mem = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/memory$/);
  if (mem && method === "PUT") {
    const f = records.find((x) => String(x.id) === mem[1])!;
    Object.assign(f, body);
    return j({ fundraiser: f });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const f = records.find((x) => x.id === Number(m[1]))!;
  const rest = m[2] || "";
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: JSON.parse(JSON.stringify(wall)) });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/thanks") return j({ thanks: [] });
  if (rest === "/news") return j({ updates: [] });
  if (rest === "/scans") return j({ scans: {} });
  return j({ error: "not here" }, 404);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);

async function openFundraising() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="fundraising"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  (row(id) as HTMLElement).click();
  await settle();
}
function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

beforeEach(() => {
  records = [fundraiser(1), fundraiser(2, { isSporting: true, tshirtSize: null, title: "Sam's Santa Dash" }), fundraiser(3, { isSporting: true, tshirtSize: "adult_m" })];
  wall = [];
  cats = [
    { key: "quiz", label: "Quiz", active: true, sporty: false, used: 2 },
    { key: "walk", label: "Walk", active: true, sporty: true, used: 1 },
    { key: "memory_flowers", label: "Donations instead of flowers", active: true, sporty: false, memoryOnly: true, used: 0 },
    { key: "other", label: "Other", active: true, sporty: false, used: 0 },
  ];
  memoryCounts = {};
  asRole("admin");
  calls = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Categories card", () => {
  it("has a Sporting tick on each category, ticked for the sporting ones, and none for Other", async () => {
    await openFundraising();
    const tick = (key: string) => q(`[data-frcatsporty="${key}"]`) as HTMLInputElement | null;
    expect(tick("walk")!.checked).toBe(true);
    expect(tick("quiz")!.checked).toBe(false);
    expect(tick("other")).toBeNull();
    expect(tick("memory_flowers")).toBeNull();
    expect(text(el("frCatsList"))).toContain("In memory only");
    expect(text(tick("walk")!.closest("label"))).toBe("Sporting");
  });

  it("saves a tick, and says which list it is in now", async () => {
    await openFundraising();
    const tick = q('[data-frcatsporty="quiz"]') as HTMLInputElement;
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/admin/fundraising/categories/quiz", body: { sporty: true } });
    expect(text(el("frCatsStatus"))).toBe("Quiz is offered for a sporting event now.");
  });

  it("is not there for an editor", async () => {
    asRole("editor");
    await openFundraising();
    expect(el("frCats").hidden).toBe(true);
  });
});

/** What a row of the open sign up says, by its label. */
const told = (label: string) => {
  const dt = [...document.querySelectorAll(".fr-detail dt")].find((d) => text(d) === label);
  return dt ? text(dt.nextElementSibling) : null;
};

describe("what they told us", () => {
  it("shows the welcome pack's address, sport and the T-shirt size", async () => {
    await openFundraising();
    await openRow(3);
    expect(told("Address for the welcome pack")).toBe("1 Example Road Exampleton EX1 1EX");
    expect(told("Sporting event")).toBe("Yes");
    expect(told("T-shirt size")).toBe("Adult M");
  });

  it("says when the date is to be confirmed, and who the parent of a child's member page is", async () => {
    records[0] = fundraiser(1, { dateTbc: true, guardianFirstName: "Sarah", childConsent: true });
    await openFundraising();
    await openRow(1);
    expect(told("Date")).toBe("Date to be confirmed");
    expect(told("For someone under 18")).toBe("Their parent or guardian is Sarah. They ticked: happy for the first name and any photo to be shown");
    await openRow(1);
    await openRow(2);
    expect(told("Date")).toBe("No date");
  });

  it("shows a child, a business and Get involved", async () => {
    records[0] = fundraiser(1, { childFirstName: "Ella", childConsent: true, orgName: "Exampleton Bakery", employerMatch: "not_sure", offListBy: "organiser", offListAt: "2026-10-03T09:00:00.000Z" });
    await openFundraising();
    await openRow(1);
    expect(told("Fundraising for their child")).toBe("Ella. They ticked: parent or guardian, happy for the first name and any photo to be shown");
    expect(told("Business, school or group")).toBe("Exampleton Bakery");
    expect(told("Employer will match")).toBe("Not sure yet");
    expect(told("On the NBCC website")).toBe("A page of its own, but not on Get involved: only people they send the link to");
  });
});

describe("sport and the T-shirt", () => {
  it("says Waiting for T-shirt size, and offers to ask them", async () => {
    await openFundraising();
    await openRow(2);
    const panel = q("[data-frwelcome]")!;
    expect(text(panel.querySelector(".fr-tshirt-wait"))).toBe("Waiting for T-shirt size");
    expect(text(panel.querySelector("[data-frtshirtask]"))).toBe("Ask them for their T-shirt size");
    expect(text(panel)).toContain("Emails robin@example.com a private link to choose a size. Nothing is sent until you press it.");
  });

  it("emails them the link only when staff press the button", async () => {
    await openFundraising();
    await openRow(2);
    expect(calls.some((c) => c.path.endsWith("/tshirt-ask"))).toBe(false);
    (q("[data-frtshirtask]") as HTMLElement).click();
    await settle();
    expect(calls.find((c) => c.path === "/api/admin/fundraisers/2/tshirt-ask")?.method).toBe("POST");
    expect(text(q("[data-frwelcome]"))).toContain("Sent. They have a link to choose their size.");
    expect(text(q("[data-frwelcome]"))).toContain("Asked on");
    expect(text(q("[data-frtshirtask]"))).toBe("Ask them again for their T-shirt size");
  });

  it("lets an editor correct sport and the size", async () => {
    asRole("editor");
    await openFundraising();
    await openRow(1);
    const form = el("frWelcomeForm");
    expect((form.querySelector("#frTshirtSize") as HTMLSelectElement).disabled).toBe(true);
    const yes = form.querySelector("#frSportYes") as HTMLInputElement;
    yes.checked = true;
    yes.dispatchEvent(new Event("change", { bubbles: true }));
    const size = form.querySelector("#frTshirtSize") as HTMLSelectElement;
    expect(size.disabled).toBe(false);
    size.value = "kids_9_10";
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(calls.find((c) => c.method === "PUT")).toMatchObject({ path: "/api/admin/fundraisers/1/welcome-pack", body: { isSporting: true, tshirtSize: "kids_9_10" } });
    expect(told("T-shirt size")).toBe("Kids 9 to 10");
  });

  it("only shows a viewer where it is up to", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(2);
    expect(q("#frWelcomeForm")).toBeNull();
    expect(q("[data-frtshirtask]")).toBeNull();
    expect(text(q("[data-frwelcome]"))).toContain("Waiting for T-shirt size");
  });

  it("is not there for a page in memory of someone", async () => {
    records[0] = fundraiser(1, { inMemory: true, memoryName: "Margaret Exampleton", memorySetupWords: "A family member" });
    await openFundraising();
    await openRow(1);
    expect(q("[data-frwelcome]")).toBeNull();
  });
});
