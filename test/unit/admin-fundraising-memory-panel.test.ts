// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// In memory pages (Jaimie, 2026-10-03) on Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-thanks-panel.test.ts): an in memory page is marked on the list, with its messages
// to check and the quiet reminder a year on; the open sign up shows who it remembers, who set it up
// with the family's permission, the target choice, the funeral collection envelopes, and every
// message waiting for staff with Approve. A fake fetch stands in for the API. Every person, place
// and number is invented.

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
    id, slug: "ime-" + id, path: "raising", kind: "other", kindLabel: "Other", title: "In memory of Margaret Exampleton",
    description: "Remembering Margaret.", eventDate: null, startTime: null, venue: "", town: "Testtown", targetPence: 50000, public: true,
    status: "approved", name: "Robin Example", email: "robin@example.com", phone: "07700 900123", socialLink: null, socialOk: false,
    wants: { ...NONE }, postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2025-09-20T10:00:00.000Z",
    approvedAt: "2025-09-21T10:00:00.000Z", approvedBy: "admin:fern@example.com", updatedAt: "2025-09-21T10:00:00.000Z", updatedBy: null,
    pageUrl: "https://nbcc.scot/fundraise/ime-" + id, finishedRequestedAt: null, offListAt: null, offListBy: null,
    inMemory: true, memoryName: "Margaret Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "funeral_director", memoryPermission: true,
    memoryShowTarget: false, memoryReminderDoneAt: null, memoryReminderDoneBy: null,
    memorySetupWords: "A funeral director, with the family's permission", memoryYearOnDue: true,
    ...over,
  };
}
const meter = { raisedPence: 6000, onlinePence: 6000, cashPence: 0, targetPence: 50000, percent: 12, barPercent: 12, overTarget: false };

let records: Rec[] = [];
let wall: Array<Record<string, unknown>> = [];
let memoryCounts: Record<string, number> = {};
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
  records = [fundraiser(1), fundraiser(2, { inMemory: false, memoryName: null, title: "Robin's Walk", memorySetupWords: undefined, memoryYearOnDue: undefined })];
  wall = [
    { donationId: 41, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 2000, refundedPence: 0,
      message: "Thinking of you all.", hidden: false, createdAt: "2026-10-02T10:00:00.000Z", paidIn: false, giftAid: false, held: true,
      familyNotify: true, shortName: "Alex E." },
  ];
  memoryCounts = { "1": 1 };
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

describe("an in memory page on the list", () => {
  it("is marked In memory, with its messages to check and the reminder a year on", async () => {
    await openFundraising();
    expect(text(row(1)!.querySelector(".fr-memory-pill"))).toBe("In memory");
    expect(text(row(1)!.querySelector(".fr-memory-msgs-pill"))).toBe("Messages to check");
    expect(text(row(1)!.querySelector(".fr-memory-yearon-pill"))).toBe("A year on");
    expect(row(2)!.querySelector(".fr-memory-pill")).toBeNull();
  });
});

describe("an in memory page, open", () => {
  it("shows who it remembers, who set it up with the family's permission, and the target choice", async () => {
    await openFundraising();
    await openRow(1);
    const panel = q("[data-frmemory]")!;
    expect(text(panel)).toContain("Margaret Exampleton (1948 to 2026)");
    expect(text(panel)).toContain("A funeral director, with the family's permission");
    expect(text(panel)).toContain("Hidden on the page, as they chose");
    expect(text(panel)).toContain("No automatic emails");
    expect(panel.querySelector('[data-frmaterial="envelopes"]')).not.toBeNull();
  });

  it("holds each message for staff, and approving puts it on the page", async () => {
    await openFundraising();
    await openRow(1);
    const item = q('[data-frwall="41"]')!;
    expect(text(item)).toContain("Waiting for you to check");
    expect(text(item)).toContain("Asked to let the family know");
    (item.querySelector("[data-frmemapprove]") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/fundraisers/1/wall/41/approve")).toBe(true);
    expect(text(q('[data-frwall="41"]'))).not.toContain("Waiting for you to check");
  });

  it("asks staff to decide, a year on, whether to get in touch, and records that it was dealt with", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(q("[data-frmemory]"))).toContain("decide whether to get in touch");
    const note = q("#frMemoryNote") as HTMLTextAreaElement;
    note.value = "Rang Robin, all well.";
    (q("[data-frmemyearon]") as HTMLElement).click();
    await settle();
    const sent = calls.find((c) => c.method === "POST" && c.path === "/api/admin/fundraisers/1/memory/year-on-done");
    expect(sent?.body).toEqual({ note: "Rang Robin, all well." });
    expect(text(q("[data-frmemory]"))).toContain("Dealt with");
  });

  it("lets a viewer look, but not approve or mark done", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(q("[data-frmemapprove]")).toBeNull();
    expect(q("[data-frmemyearon]")).toBeNull();
  });

  it("shows nothing about memory on any other page", async () => {
    await openFundraising();
    await openRow(2);
    expect(q("[data-frmemory]")).toBeNull();
  });
});

describe("an admin correcting the in memory details", () => {
  it("can change the name, dates, who set it up and the target choice, but never the permission", async () => {
    await openFundraising();
    await openRow(1);
    const form = q("[data-frmemform]")!;
    expect(form).not.toBeNull();
    expect(form.querySelector("[name=memoryPermission]")).toBeNull();
    (q("#frMemName") as HTMLInputElement).value = "Margaret Ann Exampleton";
    (q("#frMemDates") as HTMLInputElement).value = "1948 to 2026";
    (q("#frMemSetupBy") as HTMLSelectElement).value = "family";
    (q("#frMemShowYes") as HTMLInputElement).checked = true;
    (q("[data-frmemsave]") as HTMLElement).click();
    await settle();
    const sent = calls.find((c) => c.method === "PUT" && c.path === "/api/admin/fundraisers/1/memory");
    expect(sent?.body).toEqual({ memoryName: "Margaret Ann Exampleton", memoryDates: "1948 to 2026", memorySetupBy: "family", memoryShowTarget: true });
    expect(text(q("[data-frmemory]"))).toContain("Margaret Ann Exampleton");
  });

  it("is not offered to an editor", async () => {
    asRole("editor");
    await openFundraising();
    await openRow(1);
    expect(q("[data-frmemform]")).toBeNull();
  });
});

describe("review: in the admin", () => {
  it("offers no certificate for an in memory page", async () => {
    records = [fundraiser(1, { status: "finished" })];
    await openFundraising();
    await openRow(1);
    expect(q('[data-frmaterial="certificate"]')).toBeNull();
    expect(q('[data-frmaterial="poster"]')).not.toBeNull();
  });

  it("says to ring an in memory sign up with no public page, as no email goes", async () => {
    records = [fundraiser(1, { public: false, pageUrl: null })];
    await openFundraising();
    await openRow(1);
    expect(text(q("[data-frmemory]"))).toContain("No email goes for this one: please ring them.");
  });
});
