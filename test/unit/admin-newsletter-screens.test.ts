// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Newsletter: the Overview, Audiences & people, All newsletters and Results, in the kit's
// look (2026-11-14, docs/superpowers/specs/2026-11-14-admin-refresh-newsletter-screens.md). The
// faults the audit found, each proved both ways, then the features. Same harness as
// newsletter-builder-ui.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js run against it.
// Every person, address, subject and figure here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Init = { method?: string; body?: string };
type Call = { method: string; path: string; body: Record<string, unknown> };
type Answer = unknown | ((call: Call) => unknown);
type Failure = { status: number; body?: unknown };

let role = "admin";
let served: Record<string, Answer> = {};
let failing: Record<string, Failure> = {};
let calls: Call[] = [];
let csvText = "email,name";

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function row(id: number, subject: string, over: Record<string, unknown> = {}) {
  return {
    id, subject, status: "sent", sentAt: null, recipientCount: null, sentCount: null, failedCount: null, failedEmails: null,
    redactedAt: null, sentBy: "fern@example.com", audience: "Newsletter", deliveredCount: null, clickedCount: null, ...over,
  };
}
const draft = (id: number, subject: string) => row(id, subject, { status: "draft", sentBy: null, audience: null });
const sent = (id: number, subject: string, days: number, out: number, delivered: number | null, clicked: number | null, over: Record<string, unknown> = {}) =>
  row(id, subject, { sentAt: ago(days), recipientCount: out, sentCount: out, failedCount: 0, failedEmails: [], deliveredCount: delivered, clickedCount: clicked, ...over });

const LISTS = [
  { id: 1, slug: "newsletter", name: "Newsletter", kind: "everyone", visibility: "public", memberCount: 120 },
  { id: 2, slug: "donors", name: "Donors", kind: "donors", visibility: "private", memberCount: 80 },
  { id: 3, slug: "volunteers", name: "Volunteers", kind: "manual", visibility: "private", memberCount: 3 },
];
const DOC = { blocks: [{ type: "text", variant: 0, data: { text: "Invented words for a newsletter." } }] };

function respond(url: string, init?: Init) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  let body: Record<string, unknown> = {};
  try { body = init?.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  const call = { method, path, body };
  calls.push(call);
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  const failure = failing[method + " " + path] || failing[path];
  if (failure) return j(failure.body ?? { error: "Admin is temporarily unavailable" }, failure.status);
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: role as "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/newsletters/subscribers.csv") return j(csvText);
  const key = method + " " + path in served ? method + " " + path : path;
  if (key in served) {
    const a = served[key];
    return j(typeof a === "function" ? (a as (c: Call) => unknown)(call) : a);
  }
  const one = path.match(/^\/api\/admin\/newsletters\/(\d+)$/);
  if (one && method === "GET") {
    const list = (served["/api/admin/newsletters"] as { id: number }[]) || [];
    const found = list.find((n) => String(n.id) === one[1]);
    return found ? j({ ...found, bodyHtml: "", bodyJson: DOC }) : j({ error: "Newsletter not found" }, 404);
  }
  if (path === "/api/admin/newsletter-templates") return j([]);
  if (path === "/api/admin/subscriber-lists/archived") return j([]);
  if (path === "/api/admin/newsletters/suppressions") return j([]);
  if (path === "/api/admin/newsletters/send-jobs/inflight") return j(null);
  if (path === "/api/admin/newsletters/preflight") return j({ findings: [] });
  if (path === "/api/admin/newsletters/preview") return j({ html: "<p>preview</p>" });
  if (/\/send-job$/.test(path)) return j({ error: "No send job" }, 404);
  if (/\/attachments$/.test(path)) return j({ attachments: [] });
  return j({ results: [] });
}

let timers: ReturnType<typeof vi.spyOn> | null = null;
let copied: string[] = [];
let downloads: { name: string; rows: unknown[][] }[] = [];

beforeEach(() => {
  role = "admin";
  served = { "/api/admin/subscriber-lists": LISTS, "/api/admin/newsletters": [] };
  failing = {};
  calls = [];
  copied = [];
  downloads = [];
  csvText = "email,name";
  timers = vi.spyOn(globalThis, "setTimeout");
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  // The kit's helpers, with the two that leave the page (a file to save, the clipboard) recorded.
  (window as unknown as { AdminKit: unknown }).AdminKit = {
    ...Kit,
    downloadCsv: (name: string, rows: unknown[][]) => { downloads.push({ name, rows }); return true; },
    copyText: (text: string) => { copied.push(text); return Promise.resolve(true); },
  };
  window.confirm = () => true;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) => Promise.resolve(respond(String(url), init as Init));
});
afterEach(() => {
  for (const r of timers?.mock.results ?? []) if (r.type === "return") clearTimeout(r.value as ReturnType<typeof setTimeout>);
  timers?.mockRestore();
  timers = null;
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const panel = () => qa("#view-newsletter .nl-panel").filter((p) => !p.hidden).map((p) => p.id);
const got = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const type = (id: string, value: string) => {
  (el(id) as HTMLInputElement).value = value;
  el(id).dispatchEvent(new Event("input", { bubbles: true }));
};

async function open(as = "admin") {
  role = as;
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
  await settle();
}
async function go(panelId: string) {
  (q('#nlSteps [data-nl-panel="' + panelId + '"]') as HTMLElement).click();
  await settle();
}
const tile = (name: string) => qa("#nlOverviewTiles .ak-tile").find((t) => text(t).includes(name)) as HTMLElement;

describe("the Overview's figures", () => {
  it("works out Usually delivered from the sends that have delivery figures, and says how many those are", async () => {
    served["/api/admin/newsletters"] = [
      sent(5, "Invented November news", 3, 100, 90, 10),
      sent(4, "Invented October news", 30, 100, 80, 12),
      // Sent before deliveries were recorded: nothing is known, which is not the same as none arrived.
      sent(3, "Invented spring news", 200, 300, null, null),
    ];
    await open();
    expect(text(tile("Usually delivered"))).toContain("85.0%");
    expect(text(tile("Usually delivered"))).toContain("2 sends");
    expect(text(tile("Usually delivered"))).not.toContain("3 sends");
  });

  it("gives no delivered figure when no send has been measured", async () => {
    served["/api/admin/newsletters"] = [sent(3, "Invented spring news", 200, 300, null, null)];
    await open();
    expect(text(tile("Usually delivered"))).not.toContain("%");
    expect(text(tile("Usually delivered"))).toContain("No send has delivery figures yet");
  });

  it("makes each of the four figures a button that goes where its number lives", async () => {
    served["/api/admin/newsletters"] = [sent(5, "Invented November news", 3, 100, 90, 10)];
    served["/api/admin/newsletters/suppressions"] = [{ id: 1, email: "gone@example.com", reason: "bounced", detail: null, createdAt: ago(3) }];
    await open();
    expect(qa("#nlOverviewTiles button.ak-tile").length).toBe(4);
    tile("People you can reach").click();
    await settle();
    expect(panel()).toEqual(["nlPanelAudience"]);
    await go("nlPanelOverview");
    tile("Sent this year").click();
    await settle();
    expect(panel()).toEqual(["nlPanelHistory"]);
    await go("nlPanelOverview");
    tile("Usually delivered").click();
    await settle();
    expect(panel()).toEqual(["nlPanelHistory"]);
    await go("nlPanelOverview");
    tile("Blocked").click();
    await settle();
    expect(panel()).toEqual(["nlPanelAudience"]);
    expect((el("nlSuppressions") as HTMLDetailsElement).open).toBe(true);
  });

  it("says the last send was the latest by date, whatever order they were written in", async () => {
    served["/api/admin/newsletters"] = [
      sent(9, "Written last, sent long ago", 90, 50, 45, 5),
      sent(8, "Written first, sent yesterday", 1, 50, 45, 5),
    ];
    await open();
    expect(text(tile("Sent this year"))).toContain("yesterday");
    expect(text(q("#nlRecentSends tbody tr"))).toContain("Written first, sent yesterday");
  });
});

describe("starting a newsletter from the Overview", () => {
  it("carries on the latest draft that has not been sent, and says so", async () => {
    served["/api/admin/newsletters"] = [
      sent(13, "Invented November news", 2, 100, 90, 10),
      draft(12, "Invented Christmas thank you"),
      draft(7, "An older invented idea"),
    ];
    await open();
    const start = el("nlStartWriting");
    expect(text(start)).toBe("Carry on with your draft");
    expect(text(el("nlStartSays"))).toContain("Invented Christmas thank you");
    start.click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
    expect((el("newsletterSave") as HTMLButtonElement).disabled).toBe(false);
    expect(text(el("nlComposeSaved"))).toBe("Carrying on with your draft");
  });

  it("starts a new, empty newsletter when every one so far has been sent, and never opens a sent one", async () => {
    served["/api/admin/newsletters"] = [sent(13, "Invented November news", 2, 100, 90, 10)];
    await open();
    const start = el("nlStartWriting");
    expect(text(start)).toBe("Start a new newsletter");
    start.click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("");
    expect(text(el("nlCanvas"))).toContain("No blocks yet");
    expect((el("newsletterSave") as HTMLButtonElement).disabled).toBe(false);
    expect(text(el("nlComposeSubject"))).toBe("Untitled newsletter");
    expect(text(el("nlComposeSaved"))).toBe("A new newsletter, not saved yet");
    // The blocks can be added: it is not the sent one's read only view.
    expect(el("nlPalette").querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("offers a new one beside the draft, and the row's own Write a newsletter does the same as the band", async () => {
    served["/api/admin/newsletters"] = [draft(12, "Invented Christmas thank you")];
    await open();
    el("nlStartNew").click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    (q("#nlComposeClose") as HTMLElement).click();
    await settle();
    (q("#nlSteps .nl-dest-write") as HTMLElement).click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
  });

  it("does not let the newest newsletter, still loading from opening the tab, land on top of a new one", async () => {
    served["/api/admin/newsletters"] = [sent(13, "Invented November news", 2, 100, 90, 10)];
    let release: (v: unknown) => void = () => {};
    const slow = new Promise((r) => { release = r; });
    const real = (globalThis as unknown as { fetch: (u: unknown, i?: unknown) => Promise<unknown> }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
      String(url) === "/api/admin/newsletters/13" ? slow.then(() => respond(String(url), init as Init)) : real(url, init);
    await open();
    el("nlStartWriting").click();
    await settle();
    release(null);
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("");
  });
});

describe("Worth a look", () => {
  const cards = () => qa("#nlAttention .ak-row");
  const card = (words: string) => cards().find((c) => text(c).includes(words)) as HTMLElement;

  it("shows a draft that is waiting, and opens it", async () => {
    served["/api/admin/newsletters"] = [draft(12, "Invented Christmas thank you"), sent(11, "Invented November news", 2, 100, 97, 10)];
    await open();
    expect(text(card("Invented Christmas thank you"))).toContain("written but not sent");
    card("Invented Christmas thank you").click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
  });

  it("shows a send where some addresses could not be sent to, and opens its results", async () => {
    served["/api/admin/newsletters"] = [sent(11, "Invented November news", 2, 100, 97, 10, { failedCount: 2 })];
    await open();
    expect(text(card("could not be sent"))).toContain("2 addresses");
    // Opening the tab reads the newest send's figures once already, for the composer's own panel.
    const before = got("GET", "/api/admin/newsletters/11/stats").length;
    card("could not be sent").click();
    await settle();
    expect(panel()).toEqual(["nlPanelResults"]);
    expect(got("GET", "/api/admin/newsletters/11/stats").length).toBe(before + 1);
  });

  it("shows the last measured send when fewer than 90% arrived, and opens its results", async () => {
    served["/api/admin/newsletters"] = [
      sent(12, "Invented spring news, never measured", 1, 300, null, null),
      sent(11, "Invented November news", 2, 200, 172, 10),
      sent(10, "Invented October news", 40, 200, 100, 10),
    ];
    await open();
    expect(text(card("86.0%"))).toContain("Invented November news");
    // Only the last one measured: an old poor send is not news.
    expect(cards().filter((c) => text(c).includes("Invented October news")).length).toBe(0);
    card("86.0%").click();
    await settle();
    expect(panel()).toEqual(["nlPanelResults"]);
    expect(text(el("nlResultsTitle"))).toBe("Invented November news");
  });

  it("shows how many addresses are blocked, and opens the list of them", async () => {
    served["/api/admin/newsletters"] = [sent(11, "Invented November news", 2, 100, 97, 10)];
    served["/api/admin/newsletters/suppressions"] = [
      { id: 1, email: "gone@example.com", reason: "bounced", detail: null, createdAt: ago(3) },
      { id: 2, email: "cross@example.com", reason: "complained", detail: null, createdAt: ago(9) },
    ];
    await open();
    expect(text(card("blocked"))).toContain("2 addresses are blocked");
    card("blocked").click();
    await settle();
    expect(panel()).toEqual(["nlPanelAudience"]);
    expect((el("nlSuppressions") as HTMLDetailsElement).open).toBe(true);
  });

  it("says nothing needs you when nothing does", async () => {
    served["/api/admin/newsletters"] = [sent(11, "Invented November news", 2, 100, 97, 10)];
    await open();
    expect(cards().length).toBe(0);
    expect(text(el("nlAttention"))).toContain("Nothing needs your attention");
  });

  it("keeps the advice for a first send while nothing has been sent", async () => {
    await open();
    expect(text(el("nlAttention"))).toContain("Nothing has been sent yet");
  });
});

describe("Recent sends and Your audiences", () => {
  it("gives every recent send an Open and a Results button, and says a send was not measured in words", async () => {
    served["/api/admin/newsletters"] = [
      sent(11, "Invented November news", 2, 200, 172, 10),
      sent(3, "Invented spring news", 200, 300, null, null),
    ];
    await open();
    const rows = qa("#nlRecentSends tbody tr");
    expect(rows.length).toBe(2);
    expect(text(rows[0])).toContain("86.0%");
    expect(text(rows[1])).toContain("Not measured");
    expect(text(rows[1])).not.toContain("—");
    (rows[0].querySelector('[data-edit-newsletter="11"]') as HTMLElement).click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    await go("nlPanelOverview");
    const before = got("GET", "/api/admin/newsletters/11/stats").length;
    (qa("#nlRecentSends tbody tr")[0].querySelector('button[data-who-got="11"]') as HTMLElement).click();
    await settle();
    expect(panel()).toEqual(["nlPanelResults"]);
    // Pressing the button is one visit to the results, not two (the row it sits in is pressable too).
    expect(got("GET", "/api/admin/newsletters/11/stats").length).toBe(before + 1);
  });

  it("names each cell for the phone's card, with the subject leading it", async () => {
    served["/api/admin/newsletters"] = [sent(11, "Invented November news", 2, 200, 172, 10)];
    await open();
    const table = q("#nlRecentSends table") as HTMLElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    const cells = qa("#nlRecentSends tbody tr td");
    expect(cells[0].classList.contains("ak-cards__lead")).toBe(true);
    expect(cells[1].getAttribute("data-label")).toBe("Delivered");
    expect(cells[2].getAttribute("data-label")).toBe("Clicked");
  });

  it("opens an audience from Your audiences", async () => {
    await open();
    const vol = qa("#nlAudienceSnapshot .ak-row").find((b) => text(b).includes("Volunteers")) as HTMLElement;
    expect(text(vol)).toContain("3 people");
    vol.click();
    await settle();
    expect(panel()).toEqual(["nlPanelAudience"]);
    expect((el("audiencePick") as HTMLSelectElement).value).toBe("3");
    expect(got("GET", "/api/admin/subscriber-lists/3/members").length).toBeGreaterThan(0);
  });
});

describe("All newsletters", () => {
  const listRow = (id: number) => (q(`#newsletterList [data-edit-newsletter="${id}"]`) as HTMLElement).closest("tr") as HTMLElement;
  const rows = () => [
    draft(12, "Invented Christmas thank you"),
    sent(11, "Invented November news", 2, 100, 86, 10, { recipientCount: 102, sentCount: 100, failedCount: 2 }),
    sent(3, "Invented spring news", 200, 300, null, null),
  ];

  it("says whether each one is sent in plain words, never the word the database holds", async () => {
    served["/api/admin/newsletters"] = rows();
    await open();
    await go("nlPanelHistory");
    expect(qa("#newsletterList .admin-pill").map(text)).toEqual(["Draft, not sent", "Sent", "Sent"]);
  });

  it("shows how many it was sent out to, delivered and clicked, with each cell named for the phone's card", async () => {
    served["/api/admin/newsletters"] = rows();
    await open();
    await go("nlPanelHistory");
    expect((q("#newsletterList table") as HTMLElement).classList.contains("ak-cards")).toBe(true);
    const cells = Array.from(listRow(11).children) as HTMLElement[];
    expect(cells[0].classList.contains("ak-cards__lead")).toBe(true);
    expect(cells.slice(1, 5).map((c) => c.getAttribute("data-label"))).toEqual(["Status", "Sent out", "Delivered", "Clicked"]);
    expect(text(cells[2])).toContain("100 of 102");
    expect(text(cells[2])).toContain("2 could not be sent");
    expect(text(cells[3])).toContain("86.0%");
    expect(text(cells[4])).toContain("10.0%");
    expect(text(listRow(3))).toContain("Not measured");
    // A draft has gone to nobody: its figures are empty, not noughts.
    expect(text(Array.from(listRow(12).children)[2] as HTMLElement)).toBe("");
  });

  it("offers Results and Use this again on a sent one only, and neither where the content was deleted", async () => {
    served["/api/admin/newsletters"] = [...rows(), sent(2, "Invented summer news", 150, 90, 80, 9, { redactedAt: ago(100) })];
    await open();
    await go("nlPanelHistory");
    const has = (id: number, attr: string) => !!listRow(id).querySelector(`[${attr}="${id}"]`);
    expect([has(11, "data-who-got"), has(11, "data-use-again")]).toEqual([true, true]);
    expect([has(12, "data-who-got"), has(12, "data-use-again")]).toEqual([false, false]);
    expect([has(2, "data-who-got"), has(2, "data-use-again")]).toEqual([true, false]);
    expect(text(listRow(2))).toContain("Content deleted");
  });

  it("opens a past newsletter's content as a new draft that is not saved, with its subject", async () => {
    served["/api/admin/newsletters"] = rows();
    await open();
    await go("nlPanelHistory");
    (listRow(11).querySelector('[data-use-again="11"]') as HTMLElement).click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Invented November news");
    expect(text(el("nlComposeSubject"))).toBe("Invented November news");
    expect(el("nlCanvas").querySelectorAll(".nl-block").length).toBe(1);
    expect((el("newsletterSave") as HTMLButtonElement).disabled).toBe(false);
    expect(text(el("nlComposeSaved"))).toBe("A copy of a sent newsletter, not saved yet");
    expect(calls.filter((c) => c.method === "POST" || c.method === "PUT").map((c) => c.path).filter((p) => /newsletters(\/\d+)?$/.test(p))).toEqual([]);
    // Saving it makes a new newsletter: the one that was sent is never written to.
    el("newsletterForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    const saves = calls.filter((c) => (c.method === "POST" || c.method === "PUT") && /newsletters(\/\d+)?$/.test(c.path));
    expect(saves.map((c) => c.method + " " + c.path)).toEqual(["POST /api/admin/newsletters"]);
    expect(saves[0].body.subject).toBe("Invented November news");
    expect((saves[0].body.bodyJson as { blocks: unknown[] }).blocks.length).toBe(1);
  });

  it("says so when the newsletter to use again could not be read, and opens nothing", async () => {
    served["/api/admin/newsletters"] = rows();
    await open();
    await go("nlPanelHistory");
    failing["/api/admin/newsletters/11"] = { status: 500 };
    (listRow(11).querySelector('[data-use-again="11"]') as HTMLElement).click();
    await settle();
    expect(panel()).toEqual(["nlPanelHistory"]);
    expect(text(el("nlHistoryMsg"))).toBe("Could not open that newsletter to use it again. Please try again.");
    expect(el("nlHistoryMsg").classList.contains("is-error")).toBe(true);
  });

  it("does not offer Use this again to someone who may only look", async () => {
    served["/api/admin/newsletters"] = rows();
    await open("viewer");
    await go("nlPanelHistory");
    expect(qa("#newsletterList [data-use-again]").length).toBe(0);
    expect(qa("#newsletterList [data-who-got]").length).toBe(2);
  });

  it("keeps the draft you saved in the editor, not the newest newsletter there is", async () => {
    served["/api/admin/newsletters"] = [draft(12, "Invented Christmas thank you"), draft(8, "An older invented idea")];
    served["PUT /api/admin/newsletters/8"] = { id: 8 };
    await open();
    await go("nlPanelHistory");
    (q('#newsletterList [data-edit-newsletter="8"]') as HTMLElement).click();
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("8");
    el("newsletterForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(got("PUT", "/api/admin/newsletters/8").length).toBe(1);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("8");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("An older invented idea");
  });

  it("says a draft was deleted beside the list, and stays on the list", async () => {
    served["/api/admin/newsletters"] = rows();
    served["DELETE /api/admin/newsletters/12"] = { status: "deleted", id: 12 };
    await open();
    await go("nlPanelHistory");
    (q('#newsletterList [data-delete-newsletter="12"]') as HTMLElement).click();
    await settle();
    expect(got("DELETE", "/api/admin/newsletters/12").length).toBe(1);
    expect(panel()).toEqual(["nlPanelHistory"]);
    expect(text(el("nlHistoryMsg"))).toBe("Draft deleted.");
    expect(el("nlHistoryMsg").classList.contains("is-ok")).toBe(true);
  });

  it("says so beside the list when a draft could not be deleted", async () => {
    served["/api/admin/newsletters"] = rows();
    failing["DELETE /api/admin/newsletters/12"] = { status: 500 };
    await open();
    await go("nlPanelHistory");
    (q('#newsletterList [data-delete-newsletter="12"]') as HTMLElement).click();
    await settle();
    expect(text(el("nlHistoryMsg"))).toBe("Could not delete that newsletter.");
    expect(el("nlHistoryMsg").classList.contains("is-error")).toBe(true);
  });
});

describe("Results", () => {
  const STATS = {
    sends: 200, delivered: 172, bounced: 5, complained: 1, unsubscribed: 2, opened: 50, clicked: 30,
    links: [
      { link: "https://example.org/donate", uniqueClicks: 20, totalClicks: 26 },
      { link: "javascript:alert(1)", uniqueClicks: 1, totalClicks: 1 },
    ],
    bouncedEmails: ["gone@example.com", "typo@example.com"],
  };
  const theSend = () => sent(11, "Invented November news", 2, 200, 172, 30);
  const before = () => sent(10, "Invented October news", 30, 100, 95, 10);
  const tileOf = (name: string) => qa("#nlResultsTiles .ak-tile").find((t) => text(t).includes(name)) as HTMLElement;

  async function results(list: unknown[], from = "nlPanelHistory", stats: unknown = STATS) {
    served["/api/admin/newsletters"] = list;
    served["/api/admin/newsletters/11/stats"] = stats;
    await open();
    if (from !== "nlPanelOverview") await go(from);
    const within = from === "nlPanelOverview" ? "#nlRecentSends" : "#newsletterList";
    (q(within + ' button[data-who-got="11"]') as HTMLElement).click();
    await settle();
  }

  it("goes back to All newsletters when that is where you came from, and says so", async () => {
    await results([theSend()]);
    expect(text(el("nlResultsBack"))).toContain("Back to All newsletters");
    el("nlResultsBack").click();
    await settle();
    expect(panel()).toEqual(["nlPanelHistory"]);
  });

  it("goes back to the Overview when that is where you came from", async () => {
    await results([theSend()], "nlPanelOverview");
    expect(text(el("nlResultsBack"))).toContain("Back to the Overview");
    el("nlResultsBack").click();
    await settle();
    expect(panel()).toEqual(["nlPanelOverview"]);
  });

  it("says when, who by and who to, and leaves out what is not known", async () => {
    await results([{ ...theSend(), sentBy: null }]);
    expect(text(el("nlResultsMeta"))).toContain("to Newsletter");
    expect(text(el("nlResultsMeta"))).not.toContain(" by ");
    expect(text(el("nlPanelResults"))).not.toContain("not recorded");
    expect(text(el("nlPanelResults"))).not.toContain("undefined");
  });

  it("shows six figures, with marked as spam one of them, and never an open rate", async () => {
    await results([theSend()]);
    expect(qa("#nlResultsTiles .ak-tile").map((t) => text(t.querySelector(".ak-tile__name")))).toEqual(
      ["Sent out", "Delivered", "Clicked", "Bounced", "Unsubscribed", "Marked as spam"]);
    expect(text(tileOf("Sent out"))).toContain("200");
    expect(text(tileOf("Delivered"))).toContain("172");
    expect(text(tileOf("Delivered"))).toContain("86.0%");
    expect(text(tileOf("Marked as spam"))).toContain("1");
    // Open tracking is off on purpose: nothing here shows or implies how many opened it.
    expect(text(el("nlPanelResults")).toLowerCase()).not.toContain("open rate");
    expect(text(el("nlPanelResults"))).not.toContain("Opened");
  });

  it("sets delivered and clicked against the send before it, in words", async () => {
    await results([theSend(), before()]);
    expect(text(tileOf("Delivered"))).toContain("Down from 95.0% on the send before");
    expect(text(tileOf("Clicked"))).toContain("Up from 10.0% on the send before");
  });

  it("compares with nothing when the send before was never measured, or there is none", async () => {
    await results([theSend(), sent(3, "Invented spring news", 200, 300, null, null)]);
    expect(text(el("nlResultsTiles"))).not.toContain("send before");
  });

  it("makes each link people clicked one you can press, and leaves anything that is not a web address as words", async () => {
    await results([theSend()]);
    const link = q('#nlResultsLinks a[href="https://example.org/donate"]') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(text(el("nlResultsLinks"))).toContain("20 people");
    expect(qa("#nlResultsLinks a").length).toBe(1);
    expect(text(el("nlResultsLinks"))).toContain("javascript:alert(1)");
  });

  it("copies the addresses that bounced, and says how many", async () => {
    await results([theSend()]);
    expect(text(el("nlResultsBounced"))).toContain("gone@example.com");
    el("nlResultsCopyBounced").click();
    await settle();
    expect(copied).toEqual(["gone@example.com\ntypo@example.com"]);
    expect(text(el("nlResultsCopyMsg"))).toBe("Copied 2 addresses.");
    expect(el("nlResultsCopyMsg").classList.contains("is-ok")).toBe(true);
  });

  it("says so when the addresses could not be copied, and still shows them", async () => {
    await results([theSend()]);
    (window as unknown as { AdminKit: { copyText: unknown } }).AdminKit.copyText = () => Promise.resolve(false);
    el("nlResultsCopyBounced").click();
    await settle();
    expect(text(el("nlResultsCopyMsg"))).toBe("Could not copy them. Select the addresses above and copy them yourself.");
    expect(el("nlResultsCopyMsg").classList.contains("is-error")).toBe(true);
    expect(text(el("nlResultsBounced"))).toContain("typo@example.com");
  });

  it("offers no copy button when nothing bounced", async () => {
    await results([theSend()], "nlPanelHistory", { ...STATS, bounced: 0, bouncedEmails: [] });
    expect(el("nlResultsBounced").hidden).toBe(true);
  });

  it("uses this newsletter again from its results", async () => {
    await results([theSend()]);
    el("nlResultsAgain").click();
    await settle();
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Invented November news");
  });
});

describe("Who got it", () => {
  const OUTCOMES = ["arrived", "arrived", "arrived", "arrived", "bounced", "sent-unconfirmed"];
  const LABELS: Record<string, string> = { arrived: "Arrived", bounced: "Blocked or bounced", "sent-unconfirmed": "Sent, not yet confirmed" };
  const people = (n: number) => Array.from({ length: n }, (_, i) => {
    const outcome = OUTCOMES[i % OUTCOMES.length];
    return {
      email: "person" + i + "@example.com", status: "sent", sentAt: ago(2), mailboxEvent: null, outcome, outcomeLabel: LABELS[outcome],
      lastError: outcome === "bounced" ? "The mailbox does not exist" : null,
    };
  });
  const shownRows = () => qa("#nlWhoGot tbody tr");
  const filter = (words: string) => qa("#nlWhoGot .admin-seg").find((b) => text(b).startsWith(words)) as HTMLElement;

  async function whoGot(n: number) {
    served["/api/admin/newsletters"] = [sent(11, "Invented November news", 2, n, n, 3)];
    served["/api/admin/newsletters/11/send-job/recipients"] = people(n);
    await open();
    (q('#nlRecentSends button[data-who-got="11"]') as HTMLElement).click();
    await settle();
    el("nlResultsWho").click();
    await settle();
  }

  it("is in the page, not a box over it, the first fifty with Show more", async () => {
    await whoGot(120);
    expect(q(".nl-modal-overlay")).toBeNull();
    expect(el("nlPanelResults").contains(q(".nl-who-body"))).toBe(true);
    expect(shownRows().length).toBe(50);
    expect(text(el("nlWhoCount"))).toBe("Showing 50 of 120 people");
    el("nlWhoMore").click();
    expect(shownRows().length).toBe(100);
    el("nlWhoMore").click();
    expect(shownRows().length).toBe(120);
    expect(el("nlWhoMore").hidden).toBe(true);
    expect(text(el("nlWhoCount"))).toBe("Showing all 120 people");
  });

  it("names each cell for the phone's card, with the address leading it", async () => {
    await whoGot(6);
    const table = q("#nlWhoGot table") as HTMLElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    const cells = Array.from(shownRows()[4].children) as HTMLElement[];
    expect(cells[0].classList.contains("ak-cards__lead")).toBe(true);
    expect(cells.slice(1).map((c) => c.getAttribute("data-label"))).toEqual(["What happened", "When", "Problem"]);
    expect(text(cells[1])).toBe("Blocked or bounced");
    expect(text(cells[3])).toBe("The mailbox does not exist");
  });

  it("finds one person by their address", async () => {
    await whoGot(120);
    type("nlWhoSearch", "PERSON11");
    // person11, and person110 to person119.
    expect(shownRows().length).toBe(11);
    expect(text(el("nlWhoCount"))).toBe("Showing all 11 people who match");
    type("nlWhoSearch", "nobody-like-this");
    expect(shownRows().length).toBe(0);
    expect(text(q("#nlWhoGot .nl-who-list"))).toContain("No one matches that.");
  });

  it("filters by what happened, with how many of each", async () => {
    await whoGot(120);
    expect(text(filter("Everyone"))).toBe("Everyone 120");
    expect(text(filter("Arrived"))).toBe("Arrived 80");
    expect(text(filter("Blocked or bounced"))).toBe("Blocked or bounced 20");
    filter("Blocked or bounced").click();
    expect(filter("Blocked or bounced").getAttribute("aria-pressed")).toBe("true");
    expect(shownRows().length).toBe(20);
    expect(shownRows().every((r) => text(r).includes("Blocked or bounced"))).toBe(true);
    filter("Everyone").click();
    expect(shownRows().length).toBe(50);
  });

  it("downloads the list you are looking at", async () => {
    await whoGot(120);
    filter("Blocked or bounced").click();
    el("nlWhoDownload").click();
    expect(downloads.length).toBe(1);
    expect(downloads[0].name).toMatch(/^who-got-invented-november-news.*\.csv$/);
    expect(downloads[0].rows[0]).toEqual(["Email", "What happened", "When", "Problem"]);
    expect(downloads[0].rows.length).toBe(21);
    expect(downloads[0].rows[1][0]).toBe("person4@example.com");
    expect(downloads[0].rows[1][1]).toBe("Blocked or bounced");
  });

  it("says so in the page when the browser cannot hand over the file", async () => {
    await whoGot(6);
    (window as unknown as { AdminKit: { downloadCsv: unknown } }).AdminKit.downloadCsv = () => false;
    el("nlWhoDownload").click();
    expect(text(el("nlWhoMsg"))).toBe("Could not make the file in this browser.");
    expect(el("nlWhoMsg").classList.contains("is-error")).toBe(true);
  });

  it("starts afresh for the next send you look at", async () => {
    await whoGot(6);
    expect(el("nlWhoGot").hidden).toBe(false);
    el("nlResultsBack").click();
    await settle();
    (q('#nlRecentSends button[data-who-got="11"]') as HTMLElement).click();
    await settle();
    expect(el("nlWhoGot").hidden).toBe(true);
  });
});

describe("the section's own stylesheet keeps the kit's house rules", () => {
  const sheet = readFileSync(resolve(ROOT, "assets/css/admin-newsletter.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("is in the kit's look: the class ak is on the section, and on no panel", () => {
    expect(html).toContain('<section class="admin-view ak" id="view-newsletter"');
    expect(html).not.toMatch(/class="nl-panel [^"]*"/);
  });

  it("names every rule through the section", () => {
    const heads = [...sheet.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim()).filter((h) => h && !h.startsWith("@"));
    const stray = heads.flatMap((h) => h.split(/,(?![^(]*\))/).map((s) => s.trim())).filter((s) => !s.startsWith("#view-newsletter"));
    expect(stray).toEqual([]);
  });

  it("never uses !important, never scrolls inside a box, and moves only for someone happy with motion", () => {
    expect(sheet).not.toContain("!important");
    expect(sheet).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
    const outside = sheet.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/transition\s*:|animation\s*:/);
    expect(sheet).not.toMatch(/border-left\s*:\s*\d+px solid/);
  });

  it("gives the composer's fields 16px words, and lifts its foot above the phone's bottom bar", () => {
    expect(sheet).toContain("#view-newsletter .nl-block .nl-field input");
    expect(sheet).toMatch(/nl-field select,[\s\S]*?\{ font-size: 1rem; min-height: 46px; \}/);
    const phone = sheet.slice(sheet.indexOf("@media (max-width: 860px)"));
    expect(phone).toContain("#view-newsletter.is-composing .nl-cp-foot { bottom: calc(92px");
    expect(phone).toContain("#view-newsletter .nl-preview-wrap { height: auto; overflow: visible; }");
  });
});

describe("Audiences & people", () => {
  const member = (i: number, over: Record<string, unknown> = {}) => ({
    id: i, name: "Person Example " + i, email: "person" + i + "@example.com", phone: null, consentSource: "admin",
    consentedAt: ago(40 + i), addedBy: "fern@example.com", ...over,
  });
  async function audience(id: string, members: unknown[], as = "admin") {
    served["/api/admin/subscriber-lists/" + id + "/members"] = members;
    await open(as);
    await go("nlPanelAudience");
    (el("audiencePick") as HTMLSelectElement).value = id;
    el("audiencePick").dispatchEvent(new Event("change"));
    await settle();
  }
  const rows = () => qa("#audienceMembers tbody tr");

  it("puts Add a person above the list of people", async () => {
    await audience("3", [member(1)]);
    const add = el("nlAddPerson");
    const list = el("audienceMembers");
    expect(add.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says where the donors are rather than that nobody is on Donors, and takes you there", async () => {
    await audience("2", []);
    expect(text(el("audienceMembers"))).not.toContain("No one on this audience yet.");
    expect(text(el("audienceMembers"))).toContain("80 donors");
    const go2 = el("nlSeeDonors");
    go2.click();
    await settle();
    expect((el("subManage") as HTMLDetailsElement).open).toBe(true);
    expect(got("GET", "/api/admin/newsletters/subscribers").length).toBeGreaterThan(0);
  });

  it("still says nobody is on an audience of your own when nobody is", async () => {
    await audience("3", []);
    expect(text(el("audienceMembers"))).toContain("No one on this audience yet.");
  });

  it("says how someone joined in plain words, and leaves out who added them when we never recorded it", async () => {
    await audience("3", [member(1, { consentSource: "elf", addedBy: null }), member(2, { consentSource: "import", addedBy: null })]);
    expect(text(el("audienceMembers"))).toContain("Signed up through Elf Detective School");
    expect(text(el("audienceMembers"))).not.toMatch(/\belf\b/);
    expect(text(el("audienceMembers"))).not.toContain("not recorded");
  });

  it("shows the first fifty, with Show more, and finds one person by name or address", async () => {
    await audience("3", Array.from({ length: 120 }, (_, i) => member(i + 1)));
    expect(rows().length).toBe(50);
    el("nlPeopleMore").click();
    expect(rows().length).toBe(100);
    type("nlPeopleSearch", "person11");
    expect(rows().length).toBe(11);
    type("nlPeopleSearch", "Person Example 7");
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => text(r).includes("Person Example 7"))).toBe(true);
  });

  it("names each cell for the phone's card, with the person leading it", async () => {
    await audience("3", [member(1)]);
    const table = q("#audienceMembers table") as HTMLElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    expect((rows()[0].children[0] as HTMLElement).classList.contains("ak-cards__lead")).toBe(true);
    expect((rows()[0].children[1] as HTMLElement).getAttribute("data-label")).toBe("Added");
  });

  it("says how many joined this month on an audience of your own", async () => {
    await audience("3", [member(1, { consentedAt: new Date().toISOString() }), member(2), member(3)]);
    expect(text(el("nlPeopleCount"))).toContain("3 people");
    expect(text(el("nlPeopleCount"))).toContain("1 joined this month");
  });

  it("downloads the audience you are looking at", async () => {
    await audience("3", [member(1), member(2, { phone: "07700 900123" })]);
    el("nlPeopleDownload").click();
    expect(downloads.length).toBe(1);
    expect(downloads[0].name).toBe("audience-volunteers.csv");
    expect(downloads[0].rows[0]).toEqual(["Name", "Email", "Phone", "Joined", "How they joined", "Added by"]);
    expect(downloads[0].rows.length).toBe(3);
    expect(downloads[0].rows[2][2]).toBe("07700 900123");
  });

  it("asks before stopping a donor's emails, says what it does, and does nothing if you say no", async () => {
    served["/api/admin/newsletters/subscribers"] = { count: 1, subscribers: [{ email: "giver@example.com", name: "Giver Example" }] };
    await open();
    await go("nlPanelAudience");
    (el("subManage") as HTMLDetailsElement).open = true;
    el("subManage").dispatchEvent(new Event("toggle"));
    await settle();
    const btn = q("#subList [data-remove-sub]") as HTMLElement;
    expect(text(btn)).toBe("Stop their emails");
    let asked = "";
    window.confirm = (m?: string) => { asked = String(m); return false; };
    btn.click();
    await settle();
    expect(asked).toContain("giver@example.com");
    expect(asked).toContain("all our emails");
    expect(got("POST", "/api/admin/newsletters/subscribers/remove").length).toBe(0);
    window.confirm = () => true;
    btn.click();
    await settle();
    expect(got("POST", "/api/admin/newsletters/subscribers/remove").length).toBe(1);
    expect(text(el("subMsg"))).toContain("giver@example.com");
  });

  it("does not hand over a broken file when the donors list could not be downloaded", async () => {
    failing["/api/admin/newsletters/subscribers.csv"] = { status: 500 };
    await open();
    await go("nlPanelAudience");
    el("subExport").click();
    await settle();
    expect(text(el("subMsg"))).toBe("Could not download the list just now. Please try again.");
    expect(el("subMsg").classList.contains("is-error")).toBe(true);
  });

  it("tells someone who may only look why there is nothing to change here", async () => {
    await open("viewer");
    await go("nlPanelAudience");
    expect(el("nlAudienceViewerNote").hidden).toBe(false);
    expect(text(el("nlAudienceViewerNote"))).toContain("someone who can edit");
  });

  it("shows every row of the sheet before importing, and what will happen to each", async () => {
    served["POST /api/admin/subscriber-list-import/preview"] = {
      rows: [{ name: "Ready Example", email: "ready@example.com" }, { name: "", email: "there@example.com" }, { name: "Gone Example", email: "gone@example.com" }],
      issues: [], readyCount: 1, audiences: [{ listId: 3, listName: "Volunteers", alreadyOnList: 1 }],
      alreadyOnEvery: ["there@example.com"], previouslyUnsubscribed: ["gone@example.com"],
    };
    await open();
    await go("nlPanelAudience");
    const tick = el("importAudiences").querySelector('input[value="3"]') as HTMLInputElement;
    tick.checked = true;
    tick.dispatchEvent(new Event("change", { bubbles: true }));
    const file = new File(["name,email"], "people.csv", { type: "text/csv" });
    Object.defineProperty(el("importFile"), "files", { value: [file], configurable: true });
    el("importPreviewBtn").click();
    await wait(50);
    await settle();
    const fold = el("importRows") as HTMLDetailsElement;
    expect(fold.hidden).toBe(false);
    expect(text(fold.querySelector("summary"))).toBe("See the rows before importing (3)");
    const cells = qa("#importRows tbody tr").map(text);
    expect(cells[0]).toContain("Will be added");
    expect(cells[1]).toContain("Already on every audience you picked");
    expect(cells[2]).toContain("Asked us to stop, so will not be added");
  });
});

describe("work not saved is never thrown away without asking (review of #763)", () => {
  const list = () => [draft(12, "Invented Christmas thank you"), draft(8, "An older invented idea"), sent(11, "Invented November news", 2, 100, 97, 10)];
  let asked: string[] = [];
  const answer = (yes: boolean) => { asked = []; window.confirm = (m?: string) => { asked.push(String(m)); return yes; }; };
  async function editing(id: number) {
    served["/api/admin/newsletters"] = list();
    await open();
    await go("nlPanelHistory");
    (q(`#newsletterList [data-edit-newsletter="${id}"]`) as HTMLElement).click();
    await settle();
  }

  it("just shows the Write step when the draft asked for is the one already open, keeping the changes", async () => {
    await editing(12);
    type("newsletterSubject", "Invented Christmas thank you, changed");
    answer(true);
    (q("#nlComposeClose") as HTMLElement).click();
    await settle();
    el("nlStartWriting").click();
    await settle();
    expect(asked).toEqual([]);
    expect(panel()).toEqual(["nlPanelWrite"]);
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Invented Christmas thank you, changed");
  });

  it("asks before Worth a look's draft replaces changes that are not saved, and keeps them if you say no", async () => {
    await editing(8);
    type("newsletterSubject", "An older invented idea, changed");
    (q("#nlComposeClose") as HTMLElement).click();
    await settle();
    answer(false);
    (q('#nlAttention [data-nl-go="draft:12"]') as HTMLElement).click();
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain("Your changes to");
    expect(asked[0]).toContain("An older invented idea, changed");
    expect(asked[0]).toContain("are not saved. Leave them?");
    expect((el("newsletterId") as HTMLInputElement).value).toBe("8");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("An older invented idea, changed");
    answer(true);
    (q('#nlAttention [data-nl-go="draft:12"]') as HTMLElement).click();
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
  });

  it("asks before Use this again replaces changes that are not saved", async () => {
    await editing(8);
    type("newsletterSubject", "An older invented idea, changed");
    (q("#nlComposeClose") as HTMLElement).click();
    await settle();
    await go("nlPanelHistory");
    answer(false);
    (q('#newsletterList [data-use-again="11"]') as HTMLElement).click();
    await settle();
    expect(asked.length).toBe(1);
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("An older invented idea, changed");
    expect(got("GET", "/api/admin/newsletters/11").length).toBe(0);
  });

  it("asks nothing when nothing has changed since it was opened", async () => {
    await editing(8);
    (q("#nlComposeClose") as HTMLElement).click();
    await settle();
    answer(false);
    (q('#nlAttention [data-nl-go="draft:12"]') as HTMLElement).click();
    await settle();
    expect(asked).toEqual([]);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
  });

  it("makes a newsletter read only once it has been sent, as it was before", async () => {
    await editing(12);
    served["POST /api/admin/newsletters/12/send"] = () => {
      served["/api/admin/newsletters"] = (served["/api/admin/newsletters"] as { id: number }[]).map((n) =>
        n.id === 12 ? { ...n, status: "sent", sentAt: new Date().toISOString(), recipientCount: 3, sentCount: 0 } : n);
      return { status: "queued", jobId: 1, recipientCount: 3, rollout: "immediate", scheduledAt: null };
    };
    expect((el("newsletterSave") as HTMLButtonElement).disabled).toBe(false);
    el("newsletterSend").click();
    await settle();
    (q(".nl-modal-confirm") as HTMLButtonElement).click();
    await settle();
    expect(got("POST", "/api/admin/newsletters/12/send").length).toBe(1);
    expect((el("newsletterSave") as HTMLButtonElement).disabled).toBe(true);
    expect(text(el("newsletterMsg"))).toBe("This newsletter has been sent and is read-only.");
  });
});
