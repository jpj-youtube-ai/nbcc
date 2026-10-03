// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Event pages, in Admin > Fundraising (assets/js/admin/app.js), in the admin's jsdom harness with a
// stand in server: an event cannot be approved until its short name is set, and the screen says so
// in place of the Approve button, with a button to keep the suggested one; an approved event links
// its page and QR codes at /event/<short name>. Every name here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };

function event(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "eqn", path: "event", kind: "quiz", kindLabel: "Quiz", title: "Exampleton Quiz Night", description: "A quiz.",
    eventDate: "2026-12-05", startTime: "19:00", venue: "The Hall", town: "Exampleton", targetPence: null, public: true,
    status: "new", name: "Alex Example", email: "alex@example.com", phone: "07700 900222", socialLink: null, socialOk: true,
    wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false, imageSrc: null,
    declinedReason: null, createdAt: "2026-09-20T10:00:00.000Z", approvedAt: null, approvedBy: null,
    updatedAt: "2026-09-20T10:00:00.000Z", updatedBy: null, pageUrl: null, pagePath: "/event/eqn", slugSetAt: null,
    ...over,
  };
}

const METER = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: null, percent: null, barPercent: null, overTarget: false };
let records: Rec[] = [];
let calls: { method: string; path: string; body: unknown }[] = [];
let approveAnswer: { status: number; body: unknown } | null = null;
let confirmed: string[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role: "admin" } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: false, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({ pageOn: false, fundraisers: records.map((f) => ({ ...f, meter: METER, editWaiting: false })) });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const f = records.find((r) => r.id === Number(m[1]));
  const rest = m[2] || "";
  if (!f) return j({ error: "That no longer exists" }, 404);
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter: METER, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "" && method === "PATCH") {
    Object.assign(f, body, typeof body.slug === "string" ? { slugSetAt: "2026-10-03T09:00:00.000Z", pagePath: "/event/" + body.slug } : {});
    return j({ fundraiser: f });
  }
  if (rest === "/approve") {
    if (approveAnswer) return j(approveAnswer.body, approveAnswer.status);
    Object.assign(f, { status: "approved", approvedAt: "2026-10-03T10:00:00.000Z", pageUrl: "https://nbcc.scot/event/" + f.slug });
    return j({ fundraiser: f });
  }
  if (rest === "/history") return j({ history: [] });
  if (rest === "/scans") return j({ scans: [], total: 0 });
  return j({ error: "not here" }, 404);
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();

async function openEvent(id: number) {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="fundraising"]') as HTMLElement).click();
  await settle();
  (q(`#frList tr[data-frtoggle="${id}"]`) as HTMLElement).click();
  await settle();
}

beforeEach(() => {
  records = [];
  calls = [];
  approveAnswer = null;
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => (confirmed.push(String(msg)), true);
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("an event with no short name yet", () => {
  it("cannot be approved, and the screen says why, with its address as it would be", async () => {
    records = [event(1)];
    await openEvent(1);
    expect(q('[data-fraction="approve"]')).toBeNull();
    const block = q("#frShortName");
    expect(text(block)).toContain("Give this event a short name first, for its web address.");
    expect(text(block)).toContain("nbcc.scot/event/eqn");
    expect(q('[data-fraction="decline"]')).not.toBeNull();
  });

  it("keeps the suggested one at a press, and then offers Approve", async () => {
    records = [event(1)];
    await openEvent(1);
    (q("[data-frshortname]") as HTMLElement).click();
    await settle();
    expect(calls.filter((c) => c.method === "PATCH" && c.path === "/api/admin/fundraisers/1").map((c) => c.body)).toEqual([{ slug: "eqn" }]);
    expect(q("#frShortName")).toBeNull();
    expect(q('[data-fraction="approve"]')).not.toBeNull();
  });

  it("names nbcc.scot/event/ under Web address in the editor", async () => {
    records = [event(1)];
    await openEvent(1);
    expect(text(q('label[for="frf-slug"]')?.closest(".fr-field") ?? null)).toContain("nbcc.scot/event/");
  });

  it("shows the server's words if approving is refused all the same", async () => {
    records = [event(1, { slugSetAt: "2026-10-03T09:00:00.000Z" })];
    approveAnswer = { status: 409, body: { error: "Give this event a short name first, for its web address." } };
    await openEvent(1);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(text(el("frDetailStatus"))).toBe("Give this event a short name first, for its web address.");
  });
});

describe("an approved event", () => {
  it("is approved as a page holder: nothing is emailed while fundraising is off", async () => {
    records = [event(1, { slugSetAt: "2026-10-03T09:00:00.000Z" })];
    await openEvent(1);
    (q('[data-fraction="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toContain("“Your page is live” by email automatically when fundraising is switched on.");
  });

  it("keeps its page when taken off Get involved, and says so", async () => {
    records = [event(1, { status: "approved", slugSetAt: "2026-10-03T09:00:00.000Z", pageUrl: "https://nbcc.scot/event/eqn",
      offListAt: "2026-12-06T09:00:00.000Z", offListBy: "admin:fern@example.com" })];
    await openEvent(1);
    expect(text(q(".fx-letter .fx-state"))).toBe("Approved, and taken off the Get involved list. Its page stays up and can still take gifts.");
    expect(text(q("#frList [data-frdetail]"))).toContain("Its page and giving link still work, so late gifts still count.");
  });

  it("links its page and its QR codes at /event/", async () => {
    records = [event(1, { status: "approved", slugSetAt: "2026-10-03T09:00:00.000Z", pageUrl: "https://nbcc.scot/event/eqn" })];
    await openEvent(1);
    expect(q("#frPageLink")?.getAttribute("href")).toBe("https://nbcc.scot/event/eqn");
    expect(q("#frQrLink")?.getAttribute("href")).toBe("/event/eqn/qr.svg");
    expect(q("#frQrPngLink")?.getAttribute("href")).toBe("/event/eqn/qr.png");
    expect(text(q(".fx-letter .fx-state"))).toContain("Its page is on the website");
  });
});
