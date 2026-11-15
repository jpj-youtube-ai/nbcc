// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Governance > Audit in the kit's look (the admin refresh, 2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-records.md): who did what, and when, in plain
// English. The admin's jsdom harness: admin.html's <body>, a fake fetch, app.js evaluated against
// it. Every person, address, reference and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;

// "Now" is Thursday 12 November 2026, 3pm. Only the clock is pretend: timers still run.
const NOW = new Date("2026-11-12T15:00:00Z");

type Row = {
  id: number; actor: string; action: string; entity: string; entity_id: number | null; data: unknown; created_at: string;
  actor_name?: string | null; about_name?: string | null; about_email?: string | null;
};
const line = (id: number, over: Partial<Row>): Row => ({
  id, actor: "admin:fern@example.com", actor_name: "Fern Example", action: "donor.updated", entity: "donor", entity_id: 77,
  data: {}, created_at: "2026-11-12T14:34:00Z", about_name: null, about_email: null, ...over,
});

const ROWS: Row[] = [
  line(909, { action: "admin_user.role_changed", entity: "user", entity_id: 4, data: { role: "editor" }, about_name: "Sam Example", about_email: "sam@example.com" }),
  line(908, { actor: "stripe", actor_name: null, action: "donation.refunded", entity: "donation", entity_id: 512,
    data: { eventId: "evt_pretend", refundedPence: 2500, claimStatus: "adjustment_due", donorId: 77 }, created_at: "2026-11-12T09:05:00Z" }),
  line(907, { actor: "system:schedule", actor_name: null, action: "fundraising.summary_sent", entity: "fundraising_settings", entity_id: 1,
    data: { sent: 3 }, created_at: "2026-11-11T08:00:00Z" }),
  line(906, { action: "zebra.stripes_counted", entity: "zebra", entity_id: 2, data: { stripes: 41 }, created_at: "2026-11-11T07:15:00Z" }),
  line(905, { actor: "organiser:olive@example.com", actor_name: null, action: "fundraiser.edit_requested", entity: "fundraiser", entity_id: 12,
    data: { editId: 5, fields: ["title", "targetPence"], via: "private area" }, created_at: "2026-11-05T19:45:00Z" }),
  // The clocks: half past eleven at night in UTC on 1 July is half past midnight on 2 July here.
  line(904, { actor: "admin:noname@example.com", actor_name: null, action: "analytics.collecting_switched", entity: "analytics_settings",
    entity_id: 1, data: { collecting: true, wasCollecting: false }, created_at: "2026-07-01T23:30:00Z" }),
];
const OLDER: Row[] = [
  line(903, { action: "donor.updated", entity: "donor", entity_id: 77, data: { fullName: "Rowan Example" }, created_at: "2026-06-30T10:00:00Z" }),
];
const COUNTS = { user: 3, donation: 40, donor: 12, fundraiser: 9, fundraising_settings: 2, analytics_settings: 1, zebra: 1 };
const PEOPLE = [{ email: "fern@example.com", name: "Fern Example" }, { email: "noname@example.com", name: null }];

type Call = { method: string; url: string; path: string; query: URLSearchParams };
let calls: Call[] = [];
let perms: PermissionMap = {};
let auditAnswer: (q: URLSearchParams) => { status: number; body: unknown };
let downloads: { name: string; rows: unknown[][] }[] = [];
let downloadWorks = true;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const [path, qs] = url.split("?");
  const query = new URLSearchParams(qs || "");
  calls.push({ method, url, path, query });
  if (path === "/api/admin/login") return j({ token, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/audit") {
    const a = auditAnswer(query);
    return j(a.body, a.status);
  }
  if (path === "/api/admin/donors/77") return j({ id: 77, fullName: "Rowan Example", email: "rowan@example.com", declarations: [], donations: [] });
  if (path === "/api/admin/fundraisers") return j({ pageOn: true, fundraisers: [] });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const view = () => el("view-audit");
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const lines = () => Array.from(view().querySelectorAll("[data-audit-line]")) as HTMLElement[];
const sentences = () => lines().map((li) => text(li.querySelector(".ak-item__name")));
const lineOf = (id: number) => view().querySelector('[data-audit-line="' + id + '"]') as HTMLElement;
const face = (id: number) => lineOf(id).querySelector(".ak-item__face") as HTMLElement;
const more = (id: number) => lineOf(id).querySelector(".ak-item__more") as HTMLElement;
const auditCalls = () => calls.filter((c) => c.path === "/api/admin/audit");
const lastAudit = () => auditCalls()[auditCalls().length - 1];
const tile = (area: string) => view().querySelector('[data-audit-area="' + area + '"]') as HTMLElement;

async function openAudit() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="audit"]') as HTMLElement).click();
  await settle();
}
async function press(target: HTMLElement) {
  target.click();
  await settle();
}
async function choose(id: string, value: string, event = "change") {
  const field = el(id) as HTMLInputElement;
  field.value = value;
  field.dispatchEvent(new Event(event, { bubbles: true }));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  downloads = [];
  downloadWorks = true;
  // The first 6 of 7 lines, then the seventh: a page, and one older.
  auditAnswer = (q) => {
    const offset = Number(q.get("offset") || 0);
    const body: Record<string, unknown> = { results: offset ? OLDER : ROWS, total: 7 };
    if (q.get("summary") === "1") {
      body.counts = COUNTS;
      body.people = PEOPLE;
    }
    return { status: 200, body };
  };
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = {
    ...Kit,
    downloadCsv: (name: string, rows: unknown[][]) => {
      if (!downloadWorks) return false;
      downloads.push({ name, rows });
      return true;
    },
  };
  window.confirm = () => true;
  window.alert = () => {
    throw new Error("alert() is never used");
  };
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the screen", () => {
  it("is in the kit's look and opens with one plain sentence saying what it is for", () => {
    expect(view().classList.contains("ak")).toBe(true);
    expect(text(view().querySelector("h2"))).toBe("Audit trail");
    expect(text(view().querySelector(".admin-view-intro"))).toMatch(/^Who did what, and when/);
  });

  it("asks for the newest 50 lines, with the counts and the people for its filters", async () => {
    await openAudit();
    expect(auditCalls()).toHaveLength(1);
    expect(lastAudit().query.get("limit")).toBe("50");
    expect(lastAudit().query.get("offset")).toBe("0");
    expect(lastAudit().query.get("summary")).toBe("1");
    expect(lastAudit().query.get("staff")).toBeNull();
  });
});

describe("each line, in plain English", () => {
  it("says who did what, naming the person it was done to", async () => {
    await openAudit();
    expect(sentences()[0]).toBe("Fern Example changed Sam Example's role to Editor");
  });

  it("takes a detail from what the line recorded", async () => {
    await openAudit();
    expect(sentences()[1]).toBe("Stripe recorded a refund of £25 on a donation");
  });

  it("calls a scheduled job an automatic job, and an organiser the organiser", async () => {
    await openAudit();
    expect(sentences()[2]).toBe("An automatic job sent the Monday fundraising summary");
    expect(sentences()[4]).toBe("The organiser asked for a change to their page");
  });

  it("uses the email address of someone who is no longer on the team", async () => {
    await openAudit();
    expect(sentences()[5]).toBe("noname@example.com started counting visits to the website");
  });

  it("falls back to a tidy version of a code it has no words for, never a blank", async () => {
    await openAudit();
    expect(sentences()[3]).toBe("Fern Example: Zebra stripes counted");
  });

  it("uses the plain form when the detail a sentence wants is not there", async () => {
    auditAnswer = () => ({ status: 200, body: { results: [line(1, { action: "admin_user.role_changed", entity: "user", entity_id: 4, data: {} })], total: 1 } });
    await openAudit();
    expect(sentences()).toEqual(["Fern Example changed a team member's role"]);
  });

  it("never shows a code where the words should be", async () => {
    await openAudit();
    const faces = lines().map((li) => text(li.querySelector(".ak-item__face"))).join(" ");
    expect(faces).not.toContain("admin:");
    expect(faces).not.toContain("admin_user");
    expect(faces).not.toContain("system:schedule");
    expect(faces).not.toContain("adjustment_due");
  });

  it("shows what the server sent as words, never as markup", async () => {
    const evil = '<img src=x onerror="window.__pwned=1">';
    auditAnswer = () => ({
      status: 200,
      body: { results: [line(1, { actor: "admin:" + evil, actor_name: evil, action: evil, entity: evil, data: { [evil]: evil, note: evil } })], total: 1 },
    });
    await openAudit();
    await press(face(1));
    expect(view().querySelectorAll("img")).toHaveLength(0);
    expect(text(lineOf(1))).toContain("<img src=x");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("days and times", () => {
  it("puts the lines under day headings: Today, Yesterday, then the day in words", async () => {
    await openAudit();
    expect(Array.from(view().querySelectorAll("#auditTable .ak-group")).map((h) => text(h))).toEqual([
      "Today", "Yesterday", "Thursday 5 November", "Thursday 2 July",
    ]);
  });

  it("gives each line its time of day, in UK time", async () => {
    await openAudit();
    const times = lines().map((li) => text(li.querySelector("[data-audit-time]")));
    expect(times).toEqual(["2:34pm", "9:05am", "8:00am", "7:15am", "7:45pm", "12:30am"]);
  });

  it("marks each line with the part of the admin it belongs to", async () => {
    await openAudit();
    const marks = lines().map((li) => text(li.querySelector(".ak-mark")));
    expect(marks).toEqual(["Team", "Donations", "Get involved", "Zebra", "Get involved", "Website"]);
  });
});

describe("Show older", () => {
  it("says how many of how many are showing", async () => {
    await openAudit();
    expect(el("auditFoot").hidden).toBe(false);
    expect(text(el("auditCount"))).toBe("Showing the newest 6 of 7 lines.");
    expect(el("auditOlder").hidden).toBe(false);
  });

  it("adds the next lines under what is showing, from where the list ends", async () => {
    await openAudit();
    await press(el("auditOlder"));
    expect(lastAudit().query.get("offset")).toBe("6");
    expect(lastAudit().query.get("summary")).toBeNull();
    expect(lines()).toHaveLength(7);
    expect(sentences()[6]).toBe("Fern Example changed a donor's details");
    expect(text(el("auditCount"))).toBe("Showing all 7 lines.");
    expect(el("auditOlder").hidden).toBe(true);
  });

  it("keeps a line open when older ones arrive", async () => {
    await openAudit();
    await press(face(909));
    await press(el("auditOlder"));
    expect(face(909).getAttribute("aria-expanded")).toBe("true");
    expect(more(909).hidden).toBe(false);
  });

  it("says so beside the button when the older lines could not load, and keeps what is showing", async () => {
    await openAudit();
    auditAnswer = () => ({ status: 500, body: { error: "Admin is temporarily unavailable" } });
    await press(el("auditOlder"));
    expect(lines()).toHaveLength(6);
    expect(text(el("auditFootSaid"))).toBe("The older lines could not load. Press Show older to try again.");
    expect(el("auditFootSaid").className).toContain("is-error");
    expect(el("auditOlder").hidden).toBe(false);
  });

  it("has nothing to show older when everything fits", async () => {
    auditAnswer = () => ({ status: 200, body: { results: ROWS.slice(0, 2), total: 2 } });
    await openAudit();
    expect(text(el("auditCount"))).toBe("Showing both lines.");
    expect(el("auditOlder").hidden).toBe(true);
  });
});

describe("a line opens where it is", () => {
  it("is shut to begin with, and opens and shuts on its own face", async () => {
    await openAudit();
    expect(face(909).getAttribute("aria-expanded")).toBe("false");
    expect(more(909).hidden).toBe(true);
    await press(face(909));
    expect(face(909).getAttribute("aria-expanded")).toBe("true");
    expect(more(909).hidden).toBe(false);
    expect(face(909).getAttribute("aria-controls")).toBe(more(909).id);
    await press(face(909));
    expect(more(909).hidden).toBe(true);
  });

  it("says when, who and what part of the admin, in full", async () => {
    await openAudit();
    await press(face(909));
    const facts = text(more(909));
    expect(facts).toContain("Thursday 12 November 2026 at 2:34pm");
    expect(facts).toContain("Fern Example (fern@example.com)");
    expect(facts).toContain("Team member: Sam Example (sam@example.com)");
  });

  it("shows what changed as plain facts: money as money, yes and no as words, lists as lists", async () => {
    await openAudit();
    await press(face(908));
    const facts = Array.from(more(908).querySelectorAll("dt")).map((dt) => [text(dt), text(dt.nextElementSibling)]);
    expect(facts).toContainEqual(["Refunded", "£25"]);
    expect(facts).toContainEqual(["Claim status", "Adjustment due"]);
    await press(face(905));
    const asked = Array.from(more(905).querySelectorAll("dt")).map((dt) => [text(dt), text(dt.nextElementSibling)]);
    expect(asked).toContainEqual(["Fields", "title, targetPence"]);
    await press(face(904));
    const switched = Array.from(more(904).querySelectorAll("dt")).map((dt) => [text(dt), text(dt.nextElementSibling)]);
    expect(switched).toContainEqual(["Collecting", "Yes"]);
    expect(switched).toContainEqual(["Was collecting", "No"]);
  });

  it("keeps the codes the line is stored under, where someone who needs them can find them", async () => {
    await openAudit();
    await press(face(909));
    const kept = text(more(909).querySelector("[data-audit-kept]"));
    expect(kept).toContain("909");
    expect(kept).toContain("admin_user.role_changed");
    expect(kept).toContain("user 4");
    expect(kept).toContain("admin:fern@example.com");
  });

  it("links a line about a donor to that donor", async () => {
    await openAudit();
    await press(face(908));
    const link = more(908).querySelector("[data-audit-donor]") as HTMLElement;
    expect(text(link)).toBe("Open this donor");
    await press(link);
    expect(calls.some((c) => c.path === "/api/admin/donors/77")).toBe(true);
    expect(el("view-donor").hidden).toBe(false);
  });

  it("links a line about a sign up to that sign up in Get involved", async () => {
    await openAudit();
    await press(face(905));
    const link = more(905).querySelector("[data-audit-signup]") as HTMLElement;
    expect(text(link)).toBe("Open this sign up");
    await press(link);
    expect(calls.some((c) => c.path === "/api/admin/fundraisers/12")).toBe(true);
    expect(el("view-get-involved").hidden).toBe(false);
  });

  it("offers no link to someone who may not open Donations or Get involved", async () => {
    perms = { overview: "view", audit: "view" };
    await openAudit();
    await press(face(908));
    await press(face(905));
    expect(view().querySelector("[data-audit-donor]")).toBeNull();
    expect(view().querySelector("[data-audit-signup]")).toBeNull();
  });
});

describe("the parts of the admin, as tiles", () => {
  it("counts the lines in each part, and steps back the parts with none", async () => {
    await openAudit();
    expect(text(tile("").querySelector(".ak-tile__n"))).toBe("68");
    expect(text(tile("team").querySelector(".ak-tile__n"))).toBe("3");
    expect(text(tile("donations").querySelector(".ak-tile__n"))).toBe("52");
    expect(text(tile("get-involved").querySelector(".ak-tile__n"))).toBe("11");
    expect(tile("ball").classList.contains("is-none")).toBe(true);
    expect(tile("").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows one part when its tile is pressed, and everything again from All", async () => {
    await openAudit();
    await press(tile("team"));
    expect(lastAudit().query.get("entities")).toBe("user");
    expect(lastAudit().query.get("offset")).toBe("0");
    expect(tile("team").getAttribute("aria-pressed")).toBe("true");
    expect(tile("team").classList.contains("is-active")).toBe(true);
    expect(tile("").getAttribute("aria-pressed")).toBe("false");
    await press(tile("donations"));
    expect((lastAudit().query.get("entities") || "").split(",")).toEqual(expect.arrayContaining(["donation", "donor", "declaration", "claim_batch"]));
    await press(tile(""));
    expect(lastAudit().query.get("entities")).toBeNull();
  });
});

describe("the filters", () => {
  it("lists the staff in the log by name, and shows one person's lines when chosen", async () => {
    await openAudit();
    const options = Array.from((el("auditPerson") as HTMLSelectElement).options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([["", "Anyone"], ["fern@example.com", "Fern Example"], ["noname@example.com", "noname@example.com"]]);
    await choose("auditPerson", "fern@example.com");
    expect(lastAudit().query.get("actor")).toBe("fern@example.com");
  });

  it("keeps the person chosen when the list is read again", async () => {
    await openAudit();
    await choose("auditPerson", "fern@example.com");
    expect((el("auditPerson") as HTMLSelectElement).value).toBe("fern@example.com");
  });

  it("takes a From and a To", async () => {
    await openAudit();
    await choose("auditFrom", "2026-11-01");
    await choose("auditTo", "2026-11-07");
    expect(lastAudit().query.get("from")).toBe("2026-11-01");
    expect(lastAudit().query.get("to")).toBe("2026-11-07");
  });

  it("looks for a word as it is typed, once the typing pauses", async () => {
    await openAudit();
    const before = auditCalls().length;
    const box = el("auditSearch") as HTMLInputElement;
    box.value = "NBC";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.value = "NBCC-1234";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(auditCalls()).toHaveLength(before);
    await pause(450);
    await settle();
    expect(auditCalls()).toHaveLength(before + 1);
    expect(lastAudit().query.get("q")).toBe("NBCC-1234");
  });

  it("Staff only leaves out what Stripe and automatic jobs wrote, and says what it does", async () => {
    await openAudit();
    expect(text(view().querySelector("#auditFilters .ak-says"))).toContain("Stripe");
    const box = el("auditStaffOnly") as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(lastAudit().query.get("staff")).toBe("1");
  });

  it("Clear puts every filter back and reads the whole trail again", async () => {
    await openAudit();
    await press(tile("team"));
    await choose("auditPerson", "fern@example.com");
    await choose("auditFrom", "2026-11-01");
    await press(el("auditClear"));
    const q = lastAudit().query;
    expect([q.get("entities"), q.get("actor"), q.get("from"), q.get("q"), q.get("staff")]).toEqual([null, null, null, null, null]);
    expect((el("auditFrom") as HTMLInputElement).value).toBe("");
    expect(tile("").getAttribute("aria-pressed")).toBe("true");
  });

  it("a slower answer for an earlier choice never replaces the newer one", async () => {
    await openAudit();
    let releaseSlow: () => void = () => undefined;
    const slow = new Promise<void>((r) => (releaseSlow = r));
    const real = (globalThis as unknown as { fetch: (u: unknown, i?: unknown) => Promise<unknown> }).fetch;
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
      String(url).includes("entities=user") ? slow.then(() => real(url, init)) : real(url, init);
    auditAnswer = (q) => ({ status: 200, body: { results: q.get("entities") === "user" ? [ROWS[0]] : [ROWS[1]], total: 1 } });
    tile("team").click();
    tile("").click();
    await settle();
    expect(sentences()).toEqual(["Stripe recorded a refund of £25 on a donation"]);
    releaseSlow();
    await settle();
    expect(sentences()).toEqual(["Stripe recorded a refund of £25 on a donation"]);
  });
});

describe("nothing to show, and could not load", () => {
  it("says there are no entries when the trail is empty", async () => {
    auditAnswer = () => ({ status: 200, body: { results: [], total: 0 } });
    await openAudit();
    expect(text(el("auditTable"))).toBe("No audit entries.");
    expect(el("auditFoot").hidden).toBe(true);
  });

  it("says nothing matches, and how to see more, when filters are why", async () => {
    await openAudit();
    auditAnswer = () => ({ status: 200, body: { results: [], total: 0 } });
    await press(tile("ball"));
    expect(text(el("auditTable"))).toBe("Nothing matches what you have chosen. Press Clear to see everything.");
  });

  it("says the audit log is unavailable when it cannot be read, in the page", async () => {
    auditAnswer = () => ({ status: 500, body: { error: "Admin is temporarily unavailable" } });
    await openAudit();
    expect(text(el("auditTable"))).toBe("The audit log is unavailable.");
    expect(el("auditFoot").hidden).toBe(true);
  });
});

describe("Download what is shown", () => {
  it("hands over a spreadsheet of the lines on the screen, in the words on the screen", async () => {
    await openAudit();
    await press(el("auditDownload"));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("nbcc-audit-2026-11-12.csv");
    const rows = downloads[0].rows;
    expect(rows[0]).toEqual(["Date", "Time", "Who", "What happened", "Part of the admin", "About", "What was recorded", "Stored as", "Line"]);
    expect(rows).toHaveLength(7);
    expect(rows[1].slice(0, 6)).toEqual(["12 November 2026", "2:34pm", "Fern Example (fern@example.com)", "Changed Sam Example's role to Editor", "Team", "Team member: Sam Example (sam@example.com)"]);
    expect(rows[1][6]).toBe("Role: Editor");
    expect(rows[1][7]).toBe("admin_user.role_changed");
    expect(rows[1][8]).toBe(909);
    expect(text(el("auditFootSaid"))).toBe("Downloaded 6 lines.");
  });

  it("says so, and hands over nothing, when the browser cannot make the file", async () => {
    downloadWorks = false;
    await openAudit();
    await press(el("auditDownload"));
    expect(downloads).toHaveLength(0);
    expect(text(el("auditFootSaid"))).toBe("This browser could not make the spreadsheet.");
    expect(el("auditFootSaid").className).toContain("is-error");
  });
});
