// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-506: news updates in Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-page.test.ts): an "Updates to check" pill on a sign up with updates waiting, and
// a News updates panel in the open sign up with each update (its words and its photo, fetched with
// the admin's own sign in, as a waiting photo has no public address), Approve and Don't use (with a
// reason kept for staff), and Hide for one already on the page. Every name here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
const fundraiser = (id: number, over: Record<string, unknown> = {}): Rec => ({
  id,
  slug: "test-walk-" + id,
  path: "raising",
  kind: "run_walk",
  kindLabel: "A run or walk",
  title: "Test Walk " + id,
  description: "Ten miles.",
  eventDate: "2026-12-05",
  startTime: null,
  venue: "",
  town: "Testtown",
  targetPence: 25000,
  public: true,
  status: "approved",
  name: "Robin Example",
  email: "robin@example.com",
  phone: "07700 900123",
  socialLink: null,
  socialOk: false,
  wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
  postAddress: null,
  newsletterOk: false,
  imageSrc: null,
  declinedReason: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  approvedAt: "2026-09-21T10:00:00.000Z",
  approvedBy: "admin:fern@example.com",
  updatedAt: "2026-09-21T10:00:00.000Z",
  updatedBy: null,
  pageUrl: "https://nbcc.scot/fundraise/test-walk-" + id,
  ...over,
});
const meter = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 25000, percent: 0, barPercent: 0, overTarget: false };

type News = Record<string, unknown> & { id: number; status: string };
const news = (id: number, over: Record<string, unknown> = {}): News => ({
  id,
  text: "We walked ten miles <b>today</b>!",
  status: "pending",
  statusWords: "Waiting for us to check",
  createdAt: "2026-11-20T10:00:00.000Z",
  photoUrl: null,
  decidedAt: null,
  decidedBy: null,
  rejectReason: null,
  ...over,
});

let records: Rec[] = [];
let updates: Record<number, News[]> = {};
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
let newsFails = false;

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    blob: () => Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body, auth: (init?.headers && init.headers.Authorization) || null });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraising/news-waiting") {
    const counts: Record<number, number> = {};
    for (const [id, list] of Object.entries(updates)) {
      const n = list.filter((u) => u.status === "pending").length;
      if (n) counts[Number(id)] = n;
    }
    return j({ counts });
  }
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((r) => r.id === id);
  if (!f) return j({ error: "That no longer exists" }, 404);
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/news") return newsFails ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ updates: updates[id] || [] });
  if (/^\/news\/\d+\/photo$/.test(rest)) return j({});
  const d = rest.match(/^\/news\/(\d+)\/(approve|reject|hide|show)$/);
  if (d && method === "POST") {
    const u = (updates[id] || []).find((x) => x.id === Number(d[1]))!;
    const to = { approve: "approved", reject: "rejected", hide: "hidden", show: "approved" }[d[2]]!;
    Object.assign(u, { status: to, decidedBy: "admin:fern@example.com", rejectReason: d[2] === "reject" ? (body && body.reason) || null : u.rejectReason });
    return j({ update: u });
  }
  return j({ error: "not here" }, 404);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);
const panel = () => q("#frNews");
const posts = () => calls.filter((c) => c.method === "POST" && /\/news\//.test(c.path));

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

let confirmed: string[] = [];
let confirmAnswer = true;

beforeEach(() => {
  records = [fundraiser(1), fundraiser(2)];
  updates = { 1: [news(31, { photoUrl: "/api/admin/fundraisers/1/news/31/photo" }), news(30, { status: "approved", statusWords: "On your page" })] };
  perms = effectivePermissions({ role: "admin", permissions: null });
  role = "admin";
  calls = [];
  newsFails = false;
  confirmed = [];
  confirmAnswer = true;
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return confirmAnswer;
  };
  window.alert = () => undefined;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

describe("the Updates to check pill", () => {
  it("is on a sign up with news waiting, and not on one without", async () => {
    await openFundraising();
    expect(row(1)?.querySelector(".fr-news-pill")?.textContent).toBe("Updates to check");
    expect(row(2)?.querySelector(".fr-news-pill")).toBeNull();
  });
});

describe("the News updates panel", () => {
  it("shows each update in the open sign up, its words escaped, waiting ones first", async () => {
    await openFundraising();
    await openRow(1);
    const p = panel()!;
    expect(p).not.toBeNull();
    expect(p.closest("section")?.querySelector("h4")?.textContent).toBe("News updates");
    const items = Array.from(p.querySelectorAll("[data-frnewsitem]"));
    expect(items.map((i) => i.getAttribute("data-frnewsitem"))).toEqual(["31", "30"]);
    expect(items[0].querySelector(".fr-news-text")?.innerHTML).toContain("&lt;b&gt;today&lt;/b&gt;");
    expect(text(items[0])).toContain("Waiting for us to check");
    expect(text(items[1])).toContain("On the page");
  });

  it("fetches a waiting photo with the admin's own sign in, and shows it small", async () => {
    await openFundraising();
    await openRow(1);
    const photoCall = calls.find((c) => c.path === "/api/admin/fundraisers/1/news/31/photo");
    expect(photoCall?.auth).toMatch(/^Bearer /);
    const img = panel()!.querySelector('[data-frnewsitem="31"] img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
    expect(img.className).toContain("fr-news-photo");
  });

  it("says when there are none yet", async () => {
    await openFundraising();
    await openRow(2);
    expect(text(panel())).toContain("No news updates yet.");
  });

  it("says when they could not load, and the rest of the sign up still shows", async () => {
    newsFails = true;
    await openFundraising();
    await openRow(1);
    expect(text(panel())).toContain("The news updates could not load just now.");
    expect(q("#frHistory")).not.toBeNull();
  });

  it("approves a waiting one after asking, and says it is on the page", async () => {
    await openFundraising();
    await openRow(1);
    (panel()!.querySelector('[data-frnews="approve"][data-frnewsid="31"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toContain("goes on the page straight away");
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/news/31/approve"]);
    expect(text(q("#frNewsStatus"))).toBe("Approved. It is on the page now, and the organiser is emailed to say so.");
    expect(text(panel()!.querySelector('[data-frnewsitem="31"]'))).toContain("On the page");
    expect(row(1)?.querySelector(".fr-news-pill")).toBeNull();
  });

  it("sends nothing when the question is answered no", async () => {
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (panel()!.querySelector('[data-frnews="approve"]') as HTMLElement).click();
    await settle();
    expect(posts()).toEqual([]);
  });

  it("does not use one, with the reason typed, kept for staff", async () => {
    await openFundraising();
    await openRow(1);
    const reason = panel()!.querySelector('[data-frnewsreason="31"]') as HTMLTextAreaElement;
    reason.value = "A poster, not a photo";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    (panel()!.querySelector('[data-frnews="reject"][data-frnewsid="31"]') as HTMLElement).click();
    await settle();
    expect(posts()[0]).toMatchObject({ path: "/api/admin/fundraisers/1/news/31/reject", body: { reason: "A poster, not a photo" } });
    const item = panel()!.querySelector('[data-frnewsitem="31"]');
    expect(text(item)).toContain("Not used");
    expect(text(item)).toContain("A poster, not a photo");
  });

  it("hides one on the page, and shows it again", async () => {
    await openFundraising();
    await openRow(1);
    (panel()!.querySelector('[data-frnews="hide"][data-frnewsid="30"]') as HTMLElement).click();
    await settle();
    expect(text(panel()!.querySelector('[data-frnewsitem="30"]'))).toContain("Hidden from the page");
    (panel()!.querySelector('[data-frnews="show"][data-frnewsid="30"]') as HTMLElement).click();
    await settle();
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/news/30/hide", "/api/admin/fundraisers/1/news/30/show"]);
  });

  it("lets someone who can only look see the updates, with no buttons", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(panel()!.querySelectorAll("[data-frnewsitem]").length).toBe(2);
    expect(panel()!.querySelector("[data-frnews]")).toBeNull();
    expect(panel()!.querySelector("[data-frnewsreason]")).toBeNull();
  });
});
