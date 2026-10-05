// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-NNN: the Read tick on Admin > Stories, in the admin's jsdom harness (admin.html's <body>, a
// fake fetch, app.js evaluated against it). "Read" is the status Reviewed, so a tick sends a status
// to the PATCH the screen already had. Every story here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
let perms: PermissionMap = {};
let calls: Call[] = [];
let patchStatus = 200; // what a PATCH answers
let stories: Array<Record<string, unknown>> = [];

const story = (id: number, status: string) => ({
  id, created_at: "2026-06-01T00:00:00Z", consent_captured_at: "2026-06-01T00:00:00Z",
  submitter_role: "family_carer", use_scope: "internal_only", consent_share_first_name: false,
  consent_share_town: false, third_party_consent: false, status, short_quote: null,
});
const detail = (id: number, status: string) => ({
  ...story(id, status), story_text: "A bag of presents arrived on Christmas Eve.", contact_for_more: false,
  submitter_first_name: "Ada", submitter_email: null, submitter_phone: null, submitter_town: "Exampleton",
  age_band: null, gender: null, recipient_type: null, heard_about: null, confirmed_over_16: true,
  admin_tags: [], admin_notes: null, archived_at: null,
});

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
  calls.push({ method, path, body: init?.body });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/stories") return j({ results: stories });
  const one = path.match(/^\/api\/admin\/stories\/(\d+)$/);
  if (one) {
    const found = stories.find((s) => s.id === Number(one[1]));
    if (method === "PATCH") {
      if (patchStatus !== 200) return j({ error: "Admin is temporarily unavailable" }, patchStatus);
      const next = JSON.parse(init?.body || "{}").status as string;
      if (found) found.status = next;
      return j(detail(Number(one[1]), next));
    }
    return j(detail(Number(one[1]), String(found ? found.status : "new")));
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const tick = (id: number) => document.querySelector(`#storiesTable [data-story-read="${id}"]`) as HTMLInputElement;
const statusOf = (id: number) =>
  ((tick(id).closest("tr") as HTMLElement).querySelector("[data-story-status]") as HTMLElement).textContent;
const patches = () => calls.filter((c) => c.method === "PATCH");

async function openStories() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="stories"]') as HTMLElement).click();
  await settle();
}
async function press(box: HTMLInputElement) {
  box.checked = !box.checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  patchStatus = 200;
  stories = [story(4, "new"), story(3, "reviewed"), story(2, "used"), story(1, "withdrawn")];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Read column on the Stories list", () => {
  it("has a tick for every story, under a Read heading that comes first", async () => {
    await openStories();
    const headings = Array.from(document.querySelectorAll("#storiesTable th")).map((th) => th.textContent);
    expect(headings[0]).toBe("Read");
    expect(document.querySelectorAll("#storiesTable [data-story-read]")).toHaveLength(4);
  });

  it("is not ticked for New, ticked for Reviewed, and ticked and locked for Used and Withdrawn", async () => {
    await openStories();
    expect([tick(4).checked, tick(4).disabled]).toEqual([false, false]);
    expect([tick(3).checked, tick(3).disabled]).toEqual([true, false]);
    expect([tick(2).checked, tick(2).disabled]).toEqual([true, true]);
    expect([tick(1).checked, tick(1).disabled]).toEqual([true, true]);
  });

  it("names each tick for a screen reader by its story", async () => {
    await openStories();
    expect(tick(4).getAttribute("aria-label")).toBe("Story 4 read");
  });

  it("does not open the story when its tick is pressed", async () => {
    await openStories();
    tick(4).click();
    await settle();
    expect(el("view-story").hidden).toBe(true);
  });
});

describe("ticking a story", () => {
  it("makes a New story Reviewed, in place, and the tick can come straight back off", async () => {
    await openStories();
    await press(tick(4));
    expect(patches()).toEqual([{ method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"reviewed"}' }]);
    expect(tick(4).checked).toBe(true);
    expect(tick(4).disabled).toBe(false);
    expect(statusOf(4)).toBe("Reviewed");
    await press(tick(4));
    expect(patches()[1]).toEqual({ method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"new"}' });
    expect(tick(4).checked).toBe(false);
    expect(statusOf(4)).toBe("New");
  });

  it("does not draw the list again, so nothing jumps", async () => {
    await openStories();
    const row = tick(4).closest("tr");
    await press(tick(4));
    expect(tick(4).closest("tr")).toBe(row);
    expect(calls.filter((c) => c.method === "GET" && c.path === "/api/admin/stories")).toHaveLength(1);
  });

  it("puts the tick back and says so when the save fails", async () => {
    patchStatus = 500;
    await openStories();
    await press(tick(4));
    expect(tick(4).checked).toBe(false);
    expect(tick(4).disabled).toBe(false);
    expect(statusOf(4)).toBe("New");
    expect(el("storiesListStatus").textContent).toBe("Could not mark that story as read. Please try again.");
    expect(el("storiesListStatus").className).toBe("ty-status is-error");
  });

  it("says as new when unticking fails, and clears the line on the next try", async () => {
    patchStatus = 500;
    await openStories();
    await press(tick(3));
    expect(tick(3).checked).toBe(true);
    expect(el("storiesListStatus").textContent).toBe("Could not mark that story as new. Please try again.");
    patchStatus = 200;
    await press(tick(3));
    expect(el("storiesListStatus").textContent).toBe("");
    expect(el("storiesListStatus").className).toBe("ty-status");
  });

  it("cannot be pressed again while it is saving", async () => {
    await openStories();
    const box = tick(4);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(box.disabled).toBe(true);
    await settle();
    expect(box.disabled).toBe(false);
  });

  it("is locked for someone who can only view Stories, and sends nothing", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await openStories();
    expect([tick(4).disabled, tick(3).disabled]).toEqual([true, true]);
    expect(patches()).toEqual([]);
  });
});

describe("an open story", () => {
  async function open(id: number) {
    await openStories();
    (document.querySelector(`#storiesTable [data-story="${id}"]`) as HTMLElement).click();
    await settle();
  }

  it("has Mark as read under the story's words while it is New, and it makes the story Reviewed", async () => {
    await open(4);
    const btn = el("storyReadBtn");
    expect(btn.textContent).toBe("Mark as read");
    expect(el("storyUnreadBtn")).toBeNull();
    // Under the words: it comes after the story's text in the page.
    const words = document.querySelector("#storyDetail .admin-story-text") as HTMLElement;
    expect(words.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    btn.click();
    await settle();
    expect(patches()).toEqual([{ method: "PATCH", path: "/api/admin/stories/4", body: '{"status":"reviewed"}' }]);
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyDetail").textContent).toContain("Marked as read.");
    expect(el("storyUnreadBtn").textContent).toBe("Mark as new");
  });

  it("has Mark as new while it is Reviewed, and it makes the story New again", async () => {
    await open(3);
    expect(el("storyReadBtn")).toBeNull();
    el("storyUnreadBtn").click();
    await settle();
    expect(patches()).toEqual([{ method: "PATCH", path: "/api/admin/stories/3", body: '{"status":"new"}' }]);
    expect(el("storyReadBtn").textContent).toBe("Mark as read");
  });

  it("keeps the keyboard on the button that took its place", async () => {
    await open(4);
    el("storyReadBtn").click();
    await settle();
    expect(document.activeElement).toBe(el("storyUnreadBtn"));
  });

  it("says so when it could not be saved, and keeps the button", async () => {
    await open(4);
    patchStatus = 500;
    el("storyReadBtn").click();
    await settle();
    expect(el("storyActionStatus").textContent).toBe("Could not mark the story as read.");
    expect(el("storyReadBtn")).not.toBeNull();
  });

  it.each([2, 1])("has neither button for a Used or Withdrawn story (story %i)", async (id) => {
    await open(id);
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
  });

  it("has neither button for someone who can only view Stories", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await open(4);
    expect(el("storyDetail").textContent).toContain("A bag of presents arrived on Christmas Eve.");
    expect(el("storyReadBtn")).toBeNull();
    expect(el("storyUnreadBtn")).toBeNull();
  });

  // One loud button a screen: Save changes is the form's. These are the admin's own small button
  // and its text link, so the undo is the quietest thing in the bar.
  it("uses the admin's small button to mark as read, and a plain link to undo it", async () => {
    await open(4);
    expect(el("storyReadBtn").className).toBe("admin-btn");
    el("storyReadBtn").click();
    await settle();
    expect(el("storyUnreadBtn").className).toBe("admin-link");
  });
});

describe("its styles", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(selector + "{");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  // In rem, not px: the heading's word grows with someone's larger text, and so must its column.
  it("gives the Read column a fixed, narrow width, so the other columns keep their room", () => {
    expect(rule(".stories-table th:first-child,.stories-table td:first-child")).toMatch(/[;{]width:\s*[\d.]+rem/);
  });

  it("makes the tick a target a finger can hit, 44px each way", () => {
    expect(rule(".admin-read-tick")).toMatch(/[;{]width:\s*44px/);
    expect(rule(".admin-read-tick")).toMatch(/min-height:\s*44px/);
  });

  // .admin-body input[type="checkbox"] resets every tick box's width to the browser's own (13px),
  // and outranks a plain class. Measured in Chrome: 13px until the rule named the same things.
  it("sizes the box with a rule that outranks the admin's tick box reset", () => {
    const box = rule('.admin-body .admin-read-tick input[type="checkbox"]');
    expect(box).toMatch(/width:\s*20px/);
    expect(box).toMatch(/height:\s*20px/);
  });

  it("shows where the keyboard is on the tick", () => {
    expect(rule(".admin-read-tick input:focus-visible")).toContain("outline:");
  });

  // Measured in Chrome: a status line that took no room while empty pushed the table down 35px the
  // moment a save failed, so a second press landed on the tick of the story above. The line keeps
  // one line of room always (its height when empty is its line's height), so its words never move
  // a row, and it is never collapsed or taken out of the page.
  it("keeps one line of room for the list's status line, so a message never moves the rows", () => {
    const line = rule("#storiesListStatus");
    const lineHeight = (line.match(/line-height:\s*([\d.]+)/) || [])[1];
    const minHeight = (line.match(/min-height:\s*([\d.]+)em/) || [])[1];
    expect(lineHeight).toBeTruthy();
    expect(minHeight).toBe(lineHeight);
    expect(css).not.toContain("#storiesListStatus:empty");
  });

  it("lets the open story's bar wrap on a narrow screen, with 44px targets", () => {
    expect(rule(".admin-read-bar")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".admin-read-bar .admin-btn,.admin-read-bar .admin-link")).toMatch(/min-height:\s*44px/);
  });
});
