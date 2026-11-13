// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Get involved, laid out so someone new can find their way (2026-11-13,
// docs/superpowers/specs/2026-11-13-get-involved-refresh-design.md). An open sign up shows one part
// at a time behind a bar of six; the Sign ups filters sit in labelled groups with Needs you as tiles;
// the event editor has a bar of its eight steps. Every person, place and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-get-involved.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
function signup(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "pretend-" + id, path: "raising", kind: "walk", kindLabel: "A walk", title: "Pretend Walk " + id,
    description: "A walk round the loch.", eventDate: "2026-12-05", startTime: "10:00", venue: "The Pier", town: "Testtown",
    targetPence: 20000, public: true, status: "approved", name: "Sam Example", email: "sam@example.com", phone: "07700 900111",
    socialLink: null, socialOk: true, wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null,
    newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-01T10:00:00.000Z",
    approvedAt: "2026-10-02T10:00:00.000Z", approvedBy: "admin:fern@example.com", updatedAt: "2026-10-02T10:00:00.000Z",
    updatedBy: null, pageUrl: "https://nbcc.scot/fundraise/pretend-" + id, pagePath: "/fundraise/pretend-" + id, ...over,
  };
}
const METER = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 20000, percent: 0, barPercent: 0, overTarget: false };

let records: Rec[] = [];
let waitingEdit: Record<number, unknown> = {};
let calls: { method: string; path: string }[] = [];

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  calls.push({ method, path });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role: "admin" } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/events") return j({ pageOn: true, updatedAt: null, updatedBy: null, today: "2026-11-13", events: [] });
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter: METER, editWaiting: !!waitingEdit[f.id] })) });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const f = records.find((r) => r.id === Number(m[1]));
  if (!f) return j({ error: "That no longer exists" }, 404);
  const rest = m[2] || "";
  if (rest === "" && method === "GET") {
    const w = waitingEdit[f.id] || null;
    return j({ fundraiser: f, meter: METER, waitingEdit: w, editWaiting: !!w, edits: w ? [w] : [], cash: [], wall: [] });
  }
  if (rest === "/history") return j({ history: [] });
  if (rest === "/cash" && method === "POST") return j({ cash: { id: 1, amountPence: 500, paidInOn: "2026-11-13", note: "", createdBy: "admin:fern@example.com", createdAt: "2026-11-13T09:00:00.000Z" } }, 201);
  return j({ results: [] });
}

beforeEach(() => {
  records = [];
  waitingEdit = {};
  calls = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  // jsdom draws nothing, so it cannot scroll; the editor and the parts bar ask it to.
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const partBtn = (key: string) => q(`#frList [data-frpart="${key}"]`) as HTMLElement;
const partBody = (key: string) => q(`#frList [data-frpart-body="${key}"]`) as HTMLElement;
const shown = () => qa("#frList [data-frpart-body]").filter((p) => !p.hidden).map((p) => p.getAttribute("data-frpart-body"));

async function openSignups() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="get-involved"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  (q(`#frList tr[data-frtoggle="${id}"]`) as HTMLElement).click();
  await settle();
}

describe("an open sign up, in parts", () => {
  it("has a bar of six parts, in order, and opens on At a glance", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    expect(qa("#frList [data-frpart]").map((b) => text(b))).toEqual([
      "At a glance", "Keeping in touch", "Their page", "Money", "Their details", "History",
    ]);
    expect(shown()).toEqual(["glance"]);
    expect(partBtn("glance").getAttribute("aria-pressed")).toBe("true");
    expect(q("#frList .fr-parts")!.getAttribute("role")).toBe("group");
    expect(q("#frList .fr-parts")!.getAttribute("aria-label")).toBeTruthy();
  });

  it("opens each part with a plain sentence saying what it is for", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    for (const p of qa("#frList [data-frpart-body]")) {
      expect(text(p.querySelector(".fr-part-intro")).length, p.getAttribute("data-frpart-body")!).toBeGreaterThan(30);
    }
    expect(text(partBody("money").querySelector(".fr-part-intro"))).toContain("Add cash here when they pay it in");
  });

  it("keeps every box it always had, each in its part", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    const inPart = (heading: string) =>
      qa("#frList [data-frdetail] .fx-panel h4").find((h) => text(h) === heading)?.closest("[data-frpart-body]")?.getAttribute("data-frpart-body");
    expect(inPart("Where it is up to")).toBe("glance");
    expect(inPart("Calls")).toBe("touch");
    expect(inPart("Photo for its page")).toBe("page");
    expect(inPart("Supporter wall")).toBe("page");
    expect(inPart("Money raised")).toBe("money");
    expect(inPart("Cash paid in")).toBe("money");
    expect(inPart("What they told us")).toBe("details");
    expect(inPart("Change the details")).toBe("details");
    expect(inPart("History")).toBe("history");
  });

  it("shows the part pressed, and only that part", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    partBtn("money").click();
    expect(shown()).toEqual(["money"]);
    expect(partBtn("money").getAttribute("aria-pressed")).toBe("true");
    expect(partBtn("glance").getAttribute("aria-pressed")).toBe("false");
    expect(partBtn("money").classList.contains("is-active")).toBe(true);
  });

  it("moves along the bar with the arrow keys, Home and End", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    partBtn("glance").focus();
    partBtn("glance").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(shown()).toEqual(["touch"]);
    expect(document.activeElement).toBe(partBtn("touch"));
    partBtn("touch").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(shown()).toEqual(["history"]);
    partBtn("history").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(shown()).toEqual(["glance"]);
  });

  it("stays on the part you were in when a save redraws it", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    partBtn("money").click();
    // Any redraw of the list does what a save does: draws the open sign up again.
    (q('#frKindFilter [data-frkind=""]') as HTMLElement).click();
    await settle();
    expect(shown()).toEqual(["money"]);
  });

  it("goes back to At a glance when another sign up opens", async () => {
    records = [signup(1), signup(2)];
    await openSignups();
    await openRow(1);
    partBtn("history").click();
    await openRow(2);
    expect(shown()).toEqual(["glance"]);
  });

  it("puts a dot on a part with something waiting, and says it in words", async () => {
    records = [signup(1, { status: "new", approvedAt: null, pageUrl: null })];
    await openSignups();
    await openRow(1);
    expect(partBtn("glance").querySelector(".fr-part-dot")).not.toBeNull();
    expect(text(partBtn("glance").querySelector(".sr-only"))).toBe(", needs you");
    expect(partBtn("money").querySelector(".fr-part-dot")).toBeNull();
  });

  it("marks At a glance when a change is waiting to be checked", async () => {
    records = [signup(1)];
    waitingEdit[1] = { id: 9, changes: { description: "A longer walk." }, createdAt: "2026-11-12T10:00:00.000Z" };
    await openSignups();
    await openRow(1);
    expect(partBtn("glance").querySelector(".fr-part-dot")).not.toBeNull();
    expect(partBody("glance").textContent).toContain("Changes to check");
  });
});

describe("what the big buttons do, said under them", () => {
  it("says what Approve does", async () => {
    records = [signup(1, { status: "new", approvedAt: null, pageUrl: null })];
    await openSignups();
    await openRow(1);
    expect(text(q("#frList .fr-action-says"))).toContain("Approve says yes. We email them");
  });

  it("says what Mark finished does", async () => {
    records = [signup(1)];
    await openSignups();
    await openRow(1);
    expect(text(q("#frList .fr-action-says"))).toContain("Mark finished is for when everything is in");
  });
});

describe("the Sign ups filters", () => {
  it("has three labelled groups: Needs you, Show and What kind", () => {
    expect(qa("#frFilter .fr-filter-label").map((h) => text(h))).toEqual(["Needs you", "Show", "What kind"]);
  });

  it("gives each Needs you tile a line saying what it means", () => {
    const tiles = qa("#frFilter .fr-tile");
    expect(tiles.map((t) => text(t.querySelector(".fr-tile__name")))).toEqual(["New", "Calls due", "Requests to do", "Buckets not back", "Packs to send"]);
    for (const t of tiles) expect(text(t.querySelector(".fr-tile__says")).length).toBeGreaterThan(8);
  });

  it("lets a tile with nothing in it step back", async () => {
    records = [signup(1, { status: "new", approvedAt: null, pageUrl: null })];
    await openSignups();
    expect(q('[data-frfilter="new"]')!.classList.contains("is-none")).toBe(false);
    expect(q('[data-frfilter="calls"]')!.classList.contains("is-none")).toBe(true);
  });

  it("still filters: New lists only the new ones", async () => {
    records = [signup(1, { status: "new", approvedAt: null, pageUrl: null, title: "Brand New Walk" }), signup(2)];
    await openSignups();
    (q('[data-frfilter="new"]') as HTMLElement).click();
    await settle();
    expect(qa("#frList tr[data-frtoggle]").map((r) => r.getAttribute("data-frtoggle"))).toEqual(["1"]);
    expect(q('[data-frfilter="new"]')!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the event editor's steps", () => {
  it("names the eight steps, in the form's order", () => {
    const legends = qa("#evForm fieldset.ev-step > legend").map((l) => text(l).replace(/^\d+/, ""));
    expect(qa("#evSteps [data-evstep]").map((b) => text(b).replace(/^\d+/, ""))).toEqual(legends);
    expect(legends.length).toBe(8);
  });

  it("takes you to a step, with the focus on it", async () => {
    await openSignups();
    (q('#giSections [data-gi-section="events"]') as HTMLElement).click();
    await settle();
    el("evAdd").click();
    await settle();
    (q('#evSteps [data-evstep="5"]') as HTMLElement).click();
    expect(document.activeElement).toBe(qa("#evForm fieldset.ev-step")[4]);
  });
});

describe("its styles", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  it("never scrolls inside a box, and never uses !important", () => {
    expect(rules).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
    expect(rules).not.toContain("!important");
  });

  it("pins the parts bar on a laptop, and not on a phone", () => {
    expect(rules).toMatch(/\.fr-parts\s*\{[^}]*position:\s*sticky/);
    const phone = rules.slice(rules.indexOf("@media (max-width: 860px)"));
    expect(phone).toMatch(/\.fr-parts\s*\{[^}]*position:\s*static/);
  });

  it("moves things only for someone happy with motion, and only by transform", () => {
    for (const m of rules.matchAll(/transition:\s*([^;]+);/g)) expect(m[1]).toMatch(/^transform\b/);
    const at = rules.indexOf("transition:");
    expect(rules.lastIndexOf("prefers-reduced-motion: no-preference", at)).toBeGreaterThan(-1);
  });

  it("is loaded after the Overview's stylesheet", () => {
    expect(html.indexOf("/assets/css/admin-get-involved.css")).toBeGreaterThan(html.indexOf("/assets/css/admin-overview.css"));
  });
});
