// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Governance > Email audit in the kit's look (the admin refresh, 2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-records.md). The red band and its buttons are
// pinned by admin-email-audit-remove-ui.test.ts; this is the rest: a card per email on a phone with
// the time, status tiles, search as you type, the types grouped, an address to press, and a
// download. Every address, name and subject here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const sheet = readFileSync(resolve(ROOT, "assets/css/admin-records.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;

const ROWS = [
  { id: 2, kind: "receipt", recipient: "bo@example.org", recipientName: "Bo Example", subject: "Your receipt", status: "sent", error: null,
    deliveryStatus: "delivered", deliveryAt: "2026-11-12T14:36:00Z", deliveryDetail: null, createdAt: "2026-11-12T14:34:00Z",
    removedAt: null, removedBy: null, removedKind: null },
  { id: 1, kind: "newsletter", recipient: "ada@example.org", recipientName: null, subject: "Winter update", status: "sent", error: null,
    deliveryStatus: null, deliveryAt: null, deliveryDetail: null, createdAt: "2026-07-01T23:30:00Z",
    removedAt: null, removedBy: null, removedKind: null },
];

type Call = { method: string; path: string; query: URLSearchParams };
let calls: Call[] = [];
let downloads: { name: string; rows: unknown[][] }[] = [];
let downloadWorks = true;

function respond(url: string, init?: { method?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const [path, qs] = url.split("?");
  calls.push({ method: (init?.method || "GET").toUpperCase(), path, query: new URLSearchParams(qs || "") });
  if (path === "/api/admin/login") return j({ token, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  if (path === "/api/admin/email-log") return j({ results: ROWS, total: ROWS.length, failures: [] });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const logCalls = () => calls.filter((c) => c.path === "/api/admin/email-log");
const lastLog = () => logCalls()[logCalls().length - 1];
const rows = () => Array.from(document.querySelectorAll("#emailAuditTable tbody tr")) as HTMLElement[];
const tile = (status: string) => document.querySelector('[data-email-tile="' + status + '"]') as HTMLElement;

async function openIt() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="email-audit"]') as HTMLElement).click();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T15:00:00Z"));
  calls = [];
  downloads = [];
  downloadWorks = true;
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = {
    ...Kit,
    downloadCsv: (name: string, r: unknown[][]) => {
      if (!downloadWorks) return false;
      downloads.push({ name, rows: r });
      return true;
    },
  };
  window.confirm = () => true;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) => Promise.resolve(respond(String(url), init as { method?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the look, and the list on a phone", () => {
  it("is in the kit's look", () => {
    expect(el("view-email-audit").classList.contains("ak")).toBe(true);
  });

  // The fault: three columns pinned to 400px in a 356px box, so the list scrolled sideways. Now a
  // card per email on a phone, each cell named from its column.
  it("draws the list as cards on a phone, with every cell named", async () => {
    await openIt();
    const table = el("emailAuditTable").querySelector("table") as HTMLTableElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    const labels = Array.from(rows()[0].querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["When", "Type", "To", "Subject", "Status"]);
    expect(table.querySelector("td")?.classList.contains("ak-cards__lead")).toBe(false);
  });

  it("frees the pinned columns on a phone, so nothing is wider than the screen", () => {
    const phone = sheet.slice(sheet.indexOf("@media (max-width: 860px)"));
    expect(phone).toContain("#view-email-audit .email-audit-table th, #view-email-audit .email-audit-table td { width: auto; }");
    expect(el("emailAuditSearch").hasAttribute("style")).toBe(false);
  });
});

describe("each email", () => {
  it("says the day and the time it was sent, in UK time", async () => {
    await openIt();
    expect(text(rows()[0].querySelector("td"))).toBe("12 November 2026 2:34pm");
    expect(text(rows()[1].querySelector("td"))).toBe("2 July 2026 12:30am");
  });

  it("says when the mailbox answered", async () => {
    await openIt();
    expect(text(rows()[0])).toContain("Delivered 12 November 2026 at 2:36pm");
  });

  it("lets you press an address to see everything sent to it", async () => {
    await openIt();
    const to = rows()[0].querySelector("[data-email-to]") as HTMLElement;
    expect(to.getAttribute("aria-label")).toBe("Everything sent to bo@example.org");
    to.click();
    await settle();
    expect((el("emailAuditSearch") as HTMLInputElement).value).toBe("bo@example.org");
    expect(lastLog().query.get("q")).toBe("bo@example.org");
    expect(lastLog().query.get("offset")).toBe("0");
  });
});

describe("finding an email", () => {
  it("searches as you type, once the typing pauses", async () => {
    await openIt();
    const before = logCalls().length;
    const box = el("emailAuditSearch") as HTMLInputElement;
    box.value = "Winter";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(logCalls()).toHaveLength(before);
    await pause(450);
    await settle();
    expect(lastLog().query.get("q")).toBe("Winter");
  });

  it("groups the types, A to Z inside each group, with every type there once", async () => {
    await openIt();
    const groups = Array.from(el("emailAuditType").querySelectorAll("optgroup"));
    expect(groups.map((g) => g.getAttribute("label"))).toEqual([
      "Donations", "Festive Ball", "Get involved", "Elf Detective School", "Newsletter", "Signing in", "Businesses", "Behind the scenes",
    ]);
    for (const g of groups) {
      const words = Array.from(g.querySelectorAll("option")).map((o) => o.textContent || "");
      expect(words).toEqual([...words].sort((a, b) => a.localeCompare(b, "en-GB")));
    }
    const values = Array.from(el("emailAuditType").querySelectorAll("option")).map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(values.length).toBe(new Set(values).size);
    const block = (appSrc.match(/var EMAIL_KINDS = \[([\s\S]*?)\];/) || ["", ""])[1];
    const kinds = [...block.matchAll(/\["([A-Za-z]+)", "[^"]+"\]/g)].map((m) => m[1]);
    expect([...values].sort()).toEqual([...kinds].sort());
    expect(el("emailAuditType").querySelector('option[value=""]')?.textContent).toBe("All types");
  });

  it("filters by status from its tiles", async () => {
    await openIt();
    expect(tile("").getAttribute("aria-pressed")).toBe("true");
    tile("problems").click();
    await settle();
    expect(lastLog().query.get("status")).toBe("problems");
    expect(tile("problems").getAttribute("aria-pressed")).toBe("true");
    expect(tile("").getAttribute("aria-pressed")).toBe("false");
    tile("delivered").click();
    await settle();
    expect(lastLog().query.get("status")).toBe("delivered");
    expect((el("emailAuditStatus") as HTMLSelectElement).value).toBe("delivered");
    tile("").click();
    await settle();
    expect(lastLog().query.get("status")).toBeNull();
  });

  it("keeps the finer choices in the Status list, and the tiles follow it", async () => {
    await openIt();
    const status = el("emailAuditStatus") as HTMLSelectElement;
    expect(Array.from(status.options).map((o) => o.value)).toEqual(["", "problems", "failed", "bounced", "complained", "delivered", "sent"]);
    status.value = "bounced";
    status.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(lastLog().query.get("status")).toBe("bounced");
    expect(tile("problems").getAttribute("aria-pressed")).toBe("false");
    expect(tile("").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("Download what is shown", () => {
  it("hands over a spreadsheet of the emails on the screen, and says so beside the button", async () => {
    await openIt();
    el("emailAuditDownload").click();
    await settle();
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("nbcc-email-audit-2026-11-12.csv");
    expect(downloads[0].rows[0]).toEqual(["Sent", "Type", "To", "Name", "Subject", "What happened", "When the mailbox answered", "Why"]);
    expect(downloads[0].rows[1]).toEqual(["12 November 2026 2:34pm", "Company receipt", "bo@example.org", "Bo Example", "Your receipt", "Delivered", "12 November 2026 2:36pm", ""]);
    expect(text(el("emailAuditDownloadSaid"))).toBe("Downloaded 2 emails.");
  });

  it("says so, and hands over nothing, when the browser cannot make the file", async () => {
    downloadWorks = false;
    await openIt();
    el("emailAuditDownload").click();
    await settle();
    expect(downloads).toHaveLength(0);
    expect(el("emailAuditDownloadSaid").className).toContain("is-error");
  });
});
