# A Read tick on Stories: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff tick a story as read on the admin Stories list (or press Mark as read on an open story), it becomes Reviewed for everyone, and it stops counting in the Overview's "new stories are waiting to be read".

**Architecture:** Screen only. "Read" is the existing status Reviewed, so the tick and the button send `{ "status": "reviewed" | "new" }` to the existing `PATCH /api/admin/stories/:id` (stories edit). The Overview already counts live stories whose status is New, so it follows by itself. No server code, no migration.

**Tech Stack:** The admin's classic script `assets/js/admin/app.js` (ES5 style, string-built markup), `admin.html`, `assets/css/admin.css`; Vitest with jsdom; Cucumber against Postgres in CI only (there is no local database on this machine).

**Spec:** `docs/superpowers/specs/2026-10-05-stories-read-tick-design.md`

**House rules that bite here:**
- Comments use the stand-in `TASK-NNN` until the PR is opened. Replace it then, in this branch's own lines only (`TASK-NNN` is also a generic placeholder in `CLAUDE.md`, the ship skill and older plans).
- The tick must not carry the attribute `data-story`: one delegated click listener on `.admin-content` opens a story for anything inside `[data-story]` (`app.js`, about line 7503).
- Nothing scrolls sideways, inside a box or otherwise. `.admin-table` is `table-layout: fixed`, so a new column takes its share unless it is given a width.
- Visible wording has no en or em dashes and no hyphenated words.
- `test/unit/admin-app.test.ts` is where parallel admin work collides. This plan adds its own test file instead.
- Commit with plain, single `git` commands (the session's worktree guard refuses compound ones).

## File structure

| File | Change | Responsibility |
|---|---|---|
| `test/unit/admin-stories-read-tick.test.ts` | create | The tick and the button, in the admin's jsdom harness |
| `assets/js/admin/app.js` | modify | `storyIsRead`, `storyReadTick`, the Read column in `storiesTable`, `setStoryRead`, the button in `renderStory` |
| `admin.html` | modify | `#storiesListStatus`, the list's status line |
| `assets/css/admin.css` | modify | the tick column and the button's bar |
| `features/admin-overview.feature`, `features/steps/admin-overview.steps.js` | modify | a story marked Reviewed leaves the Overview's count |
| `README.md` | modify | the Stories notes and the Overview's list |

---

### Task 1: The Read column on the list

**Files:**
- Create: `test/unit/admin-stories-read-tick.test.ts`
- Modify: `assets/js/admin/app.js` (`storiesTable`, about lines 2190 to 2208)

- [ ] **Step 1: Write the failing tests**

Create `test/unit/admin-stories-read-tick.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: 4 failures. The first says `expected 'ID' to be 'Read'`; the others fail on `null` (there is no `[data-story-read]` yet).

- [ ] **Step 3: Draw the column**

In `assets/js/admin/app.js`, replace the whole `storiesTable` function with:

```js
  // TASK-NNN: "read" is the status that already says so. New is unread. Reviewed is read and can be
  // unticked. Used and Withdrawn say more than read, so their tick is locked: a stray click must
  // never undo them. The attribute is data-story-read, never data-story, which opens the story.
  function storyIsRead(status) {
    return status !== "new";
  }
  function storyReadTick(r) {
    var locked = !canEdit("stories") || r.status === "used" || r.status === "withdrawn";
    return (
      '<label class="admin-read-tick"><input type="checkbox" data-story-read="' + r.id + '"' +
      (storyIsRead(r.status) ? " checked" : "") + (locked ? " disabled" : "") +
      ' aria-label="Story ' + r.id + ' read" /></label>'
    );
  }
  function storiesTable(rows) {
    if (!rows.length) return '<p class="admin-empty">No stories yet.</p>';
    var body = rows
      .map(function (r) {
        return (
          "<tr><td>" + storyReadTick(r) + "</td><td>" + r.id + "</td><td>" +
          H.escapeHtml(H.storyLabel("submitterRole", r.submitter_role)) +
          "</td><td>" + scopeConsentBadges(r) + '</td><td><span class="admin-pill" data-story-status>' +
          H.escapeHtml(H.storyLabel("status", r.status)) + "</span></td><td>" +
          H.escapeHtml(H.consentAge(r.consent_captured_at)) + "</td><td>" + H.fmtDate(r.created_at) +
          '</td><td><button class="admin-link" type="button" data-story="' + r.id + '">View</button></td></tr>'
        );
      })
      .join("");
    return (
      '<table class="admin-table stories-table"><thead><tr><th>Read</th><th>ID</th><th>Role</th><th>Scope / consent</th>' +
      "<th>Status</th><th>Consent age</th><th>Submitted</th><th></th></tr></thead><tbody>" +
      body + "</tbody></table>"
    );
  }
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add test/unit/admin-stories-read-tick.test.ts assets/js/admin/app.js
git commit -m "Stories read tick: a Read column on the list"
```

---

### Task 2: Ticking saves the status

**Files:**
- Modify: `test/unit/admin-stories-read-tick.test.ts`
- Modify: `assets/js/admin/app.js` (after the `#storiesStatusFilter` wiring, about line 2181)
- Modify: `admin.html` (the Stories view, between the filters and `#storiesTable`, about line 346)

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/admin-stories-read-tick.test.ts`, after the first `describe`:

```ts
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
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: four of the new tests fail (no PATCH is sent, and `#storiesListStatus` is `null`). Two pass already: the viewer test, because Task 1 locks the ticks, and "does not draw the list again", because nothing happens yet. That one becomes a real guard once a tick saves.

- [ ] **Step 3: Add the status line**

In `admin.html`, in the Stories view, between the closing `</div>` of `.admin-search-bar` and the `#storiesTable` line, add:

```html
              <!-- TASK-NNN: what a Read tick could not save. Empty while all is well. -->
              <p class="ty-status" id="storiesListStatus" role="status" aria-live="polite"></p>
```

- [ ] **Step 4: Save a tick**

In `assets/js/admin/app.js`, straight after the `#storiesStatusFilter` wiring (the `forEach` that ends about line 2181) and before `scopeConsentBadges`, add:

```js
  // TASK-NNN: one listener on the list's box, which stays while the table inside it is drawn again
  // on every load. A tick saves at once and the row stays where it is, so the next story does not
  // move under the pointer and the tick can come straight back off.
  if (el("storiesTable")) {
    el("storiesTable").addEventListener("change", function (e) {
      var box = e.target;
      if (box && box.hasAttribute && box.hasAttribute("data-story-read")) setStoryRead(box);
    });
  }
  function setStoryRead(box) {
    var status = box.checked ? "reviewed" : "new";
    var line = el("storiesListStatus");
    line.textContent = "";
    line.className = "ty-status";
    box.disabled = true;
    authFetch("/api/admin/stories/" + box.getAttribute("data-story-read"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: status }),
    })
      .then(okJson)
      .then(function (updated) {
        box.checked = storyIsRead(updated.status);
        var row = box.closest("tr");
        var pill = row && row.querySelector("[data-story-status]");
        if (pill) pill.textContent = H.storyLabel("status", updated.status);
        box.disabled = false;
      })
      .catch(function (err) {
        if (err && err.message === "unauthorized") return;
        box.checked = status !== "reviewed";
        box.disabled = false;
        line.textContent = "Could not mark that story as " + (status === "reviewed" ? "read" : "new") + ". Please try again.";
        line.className = "ty-status is-error";
      });
  }
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: 10 passed.

- [ ] **Step 6: Commit**

```bash
git add test/unit/admin-stories-read-tick.test.ts assets/js/admin/app.js admin.html
git commit -m "Stories read tick: a tick saves the status, in place"
```

---

### Task 3: Mark as read on an open story

**Files:**
- Modify: `test/unit/admin-stories-read-tick.test.ts`
- Modify: `assets/js/admin/app.js` (`renderStory` and `wireStoryActions`, about lines 2462 to 2566)

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/admin-stories-read-tick.test.ts`, after the second `describe`:

```ts
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
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: the first four of the new tests fail on `null` (no `#storyReadBtn` or `#storyUnreadBtn`). The last three pass already: nothing draws either button yet.

- [ ] **Step 3: Draw and wire the button**

In `assets/js/admin/app.js`, in `renderStory`, directly before the line `var actions = "";`, add:

```js
    // TASK-NNN: where reading ends. Used and Withdrawn say more than read, so they get no button.
    var readBar = "";
    if (canWrite && s.status === "new") {
      readBar = '<p class="admin-read-bar"><button class="btn btn-primary" type="button" id="storyReadBtn">Mark as read</button></p>';
    } else if (canWrite && s.status === "reviewed") {
      readBar =
        '<p class="admin-read-bar"><span class="admin-read-done">Marked as read.</span> ' +
        '<button class="btn btn-ghost" type="button" id="storyUnreadBtn">Mark as new</button></p>';
    }
```

In the same function, change

```js
    el("storyDetail").innerHTML = info + actions;
```

to

```js
    el("storyDetail").innerHTML = info + readBar + actions;
```

In `wireStoryActions`, directly before `bindClick("withdrawStoryBtn", function () {`, add:

```js
    // TASK-NNN: the same status the list's tick sends. The story is drawn again with the other
    // button, which takes the keyboard's place so it is not left on nothing.
    bindClick("storyReadBtn", function () {
      patchStory({ status: "reviewed" }, "", "Could not mark the story as read.").then(function () {
        if (el("storyUnreadBtn")) el("storyUnreadBtn").focus();
      });
    });
    bindClick("storyUnreadBtn", function () {
      patchStory({ status: "new" }, "", "Could not mark the story as new.").then(function () {
        if (el("storyReadBtn")) el("storyReadBtn").focus();
      });
    });
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: 17 passed.

- [ ] **Step 5: Run the existing Stories tests**

Run: `npx vitest run test/unit/admin-app.test.ts test/unit/admin-could-not-load.test.ts test/unit/admin-shell.test.ts`
Expected: all pass (the list's View button is still the only `[data-story]`).

- [ ] **Step 6: Commit**

```bash
git add test/unit/admin-stories-read-tick.test.ts assets/js/admin/app.js
git commit -m "Stories read tick: Mark as read on an open story"
```

---

### Task 4: The styles

**Files:**
- Modify: `test/unit/admin-stories-read-tick.test.ts`
- Modify: `assets/css/admin.css` (after the `.admin-check` rules, about line 209)

Before writing any CSS, load the design skills the user's hook asks for (`redesign-existing-projects`, since this changes an existing screen; then `polish` and `audit` on the result). They are a check on the choices below, not a licence to restyle the screen: the admin has its own tokens and parts, and these rules use only those.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/admin-stories-read-tick.test.ts`, at the end:

```ts
describe("its styles", () => {
  const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(selector + "{");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  it("gives the Read column a fixed, narrow width, so the other columns keep their room", () => {
    expect(rule(".stories-table th:first-child,.stories-table td:first-child")).toMatch(/width:\s*\d+px/);
  });

  it("makes the tick a target a finger can hit, 44px each way", () => {
    expect(rule(".admin-read-tick")).toMatch(/min-width:\s*44px/);
    expect(rule(".admin-read-tick")).toMatch(/min-height:\s*44px/);
  });

  it("shows where the keyboard is on the tick", () => {
    expect(rule(".admin-read-tick input:focus-visible")).toContain("outline:");
  });

  it("lets the button's bar wrap on a narrow screen", () => {
    expect(rule(".admin-read-bar")).toMatch(/flex-wrap:\s*wrap/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts`
Expected: the 4 new tests fail (each rule is the empty string).

- [ ] **Step 3: Add the rules**

In `assets/css/admin.css`, directly after the line `.admin-check input{width:18px;height:18px;accent-color:var(--crimson)}`, add:

```css
/* TASK-NNN: the Read tick on the Stories list, and Mark as read on an open story. The column is
   narrow and fixed, so the other seven keep their share of a fixed-layout table. The label is a
   44px target; its negative margins take that back out of the row's height, which stays as it
   was. Holly, the admin's colour for something settled (Replied, Public). */
.stories-table th:first-child,.stories-table td:first-child{width:64px}
.admin-read-tick{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;margin:-11px 0 -11px -12px;cursor:pointer}
.admin-read-tick input{width:20px;height:20px;margin:0;accent-color:var(--holly);cursor:pointer}
.admin-read-tick input:disabled{cursor:default}
.admin-read-tick input:focus-visible{outline:3px solid var(--crimson);outline-offset:2px}
.admin-read-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin:18px 0 0}
.admin-read-done{font-weight:600;color:var(--holly-dark)}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run test/unit/admin-stories-read-tick.test.ts test/unit/admin-screen-styles.test.ts test/unit/admin-no-sideways-scroll.test.ts test/unit/admin-fits-a-phone.test.ts`
Expected: all pass (21 in the new file).

- [ ] **Step 5: Look at it in a real browser**

There is no local database, so use a stand-in for the admin API (a small `node:http` script in the session scratchpad that serves this worktree's `admin.html` and assets, answers `GET /api/admin/me` with every section at edit, `GET /api/admin/stories` with a dozen invented rows across the four statuses, `GET` and `PATCH /api/admin/stories/:id`, and empty lists for everything else), and headless Chrome over the DevTools protocol. Sign in by seeding `sessionStorage.nbcc_admin_token` (base64url of `{"email":"…","role":"admin","exp":<now + 8h in ms>}` plus `.x`) and `nbccAdminView = "stories"`.

Check, at 1280px and at 390px (as a phone):
- `document.documentElement.scrollWidth === clientWidth` on the list and on an open story, and no element inside `#view-stories` has `scrollWidth > clientWidth`;
- the first column measures 64px, and a row is no taller than before the change (for "before", have the stand-in serve `git show origin/main:assets/js/admin/app.js` and `origin/main:assets/css/admin.css`, saved to the scratchpad, in place of the worktree's);
- the label measures at least 44 by 44;
- a real click on a New story's tick sends one PATCH, the row's Status reads Reviewed, and the row has not moved;
- the open story shows Mark as read under the story's words, and pressing it swaps to "Marked as read." and Mark as new.

Save a picture of the list and of an open story at both widths. Fix anything that fails before going on, and adjust the rules in Step 3 here if a value changes.

- [ ] **Step 6: Commit**

```bash
git add test/unit/admin-stories-read-tick.test.ts assets/css/admin.css
git commit -m "Stories read tick: the tick column and the button's bar"
```

---

### Task 5: The Overview follows (BDD)

**Files:**
- Modify: `features/admin-overview.feature` (add at the end)
- Modify: `features/steps/admin-overview.steps.js` (add at the end)

There is no local database: this scenario runs in CI. Check its steps resolve with a dry run.

- [ ] **Step 1: Write the scenario**

Add to the end of `features/admin-overview.feature`:

```gherkin

  # TASK-NNN: the Read tick on Stories sends the status Reviewed. A story that is Reviewed is no
  # longer waiting to be read, so the Overview stops counting it.
  @admin-stories
  Scenario: a story marked as read is no longer waiting to be read
    Given a submitted story with text "A story waiting to be read (bdd-admin-stories)."
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then the overview answer is 200
    And it says new stories are waiting to be read, with a button to "Stories"
    When I PATCH the admin story status to "reviewed" as "ann.overview.admin.bdd@example.com" with password "overview-pw-123"
    Then the admin response status should be 200
    When "ann.overview.admin.bdd@example.com" reads the overview
    Then one fewer story is waiting to be read
```

`@admin-stories` brings the hook in `features/steps/admin-stories.steps.js` that deletes every story whose text carries `(bdd-admin-stories)`, before and after. "a submitted story with text", "I PATCH the admin story status to" and "the admin response status should be" already exist.

- [ ] **Step 2: Write the two new steps**

Add to the end of `features/steps/admin-overview.steps.js`:

```js

// TASK-NNN: stories waiting to be read. Other scenarios may leave New stories of their own, so the
// second reading is compared with the first, not with a number.
const storiesWaiting = (world) => {
  const line = (world.ovBody.needs || []).find((n) => n.key === "storiesNew");
  return line ? Number(line.text.match(/^(\d+) /)[1]) : 0;
};

Then("it says new stories are waiting to be read, with a button to {string}", function (button) {
  const line = (this.ovBody.needs || []).find((n) => n.key === "storiesNew");
  assert.ok(line, JSON.stringify(this.ovBody));
  assert.match(line.text, /^\d+ new (story is|stories are) waiting to be read$/);
  assert.equal(line.button, button);
  assert.equal(line.view, "stories");
  assert.deepEqual(this.ovBody.failed, []);
  this.storiesWaitingBefore = storiesWaiting(this);
});

Then("one fewer story is waiting to be read", function () {
  assert.deepEqual(this.ovBody.failed, [], JSON.stringify(this.ovBody));
  assert.equal(storiesWaiting(this), this.storiesWaitingBefore - 1);
});
```

- [ ] **Step 3: Dry run**

Run: `npx cucumber-js --dry-run`
Expected: the last lines show the scenario count one higher than on `main`, every scenario `skipped`, and none `undefined` or `ambiguous`.

- [ ] **Step 4: Commit**

```bash
git add features/admin-overview.feature features/steps/admin-overview.steps.js
git commit -m "Stories read tick: a story marked as read leaves the Overview's count (BDD)"
```

---

### Task 6: README

**Files:**
- Modify: `README.md` (the Stories notes, about line 2187; the Overview's list, about line 6277)

- [ ] **Step 1: The Stories note**

In `README.md`, directly before the paragraph that begins `**Public unsubscribe route (REQ-069 · TASK-161 · TASK-297).**`, add:

```markdown
**A Read tick on Stories (TASK-NNN).** The Stories list has a **Read** column, one tick box a story,
and an open story has **Mark as read** under its words. "Read" is the status that already existed,
**Reviewed**: a tick sends `{ "status": "reviewed" }` to `PATCH /api/admin/stories/:id`, and unticking
sends `"new"`, so it counts for the whole team and nothing new is stored. Used and Withdrawn show as
read with the tick locked, because those statuses say more and a stray click must never undo them.
It needs stories edit, like every other change to a story; someone who can only view sees the ticks
locked. The tick saves at once and the row stays where it is (`setStoryRead` in
`assets/js/admin/app.js`), so the tick can come straight back off, even on a list filtered to New.
A story ticked here stops counting in the Overview's "new stories are waiting to be read", which
counts the live stories still at New. Design:
`docs/superpowers/specs/2026-10-05-stories-read-tick-design.md`. Tested in
`test/unit/admin-stories-read-tick.test.ts` (the admin's jsdom harness: the four statuses, saving,
a failed save, a viewer, the open story's two buttons, and the styles) and end to end in
`features/admin-overview.feature`.

```

- [ ] **Step 2: The Overview's list**

In `README.md`, in the section `## The admin Overview: Needs you (TASK-508), …`, change the line

```markdown
     - new stories;
```

to

```markdown
     - new stories (a story ticked Read on the Stories screen is Reviewed, so it leaves this count);
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Stories read tick: README"
```

---

### Task 7: Verify, show Jaimie, ship

- [ ] **Step 1: Lint, build, and the tests that cover this**

Run, each on its own:
- `npm run lint` (expect exit 0)
- `npm run build` (expect exit 0)
- `npx vitest run test/unit/admin-stories-read-tick.test.ts test/unit/admin-app.test.ts test/unit/admin-could-not-load.test.ts test/unit/admin-shell.test.ts test/unit/admin-screen-styles.test.ts test/unit/admin-no-sideways-scroll.test.ts test/unit/admin-fits-a-phone.test.ts test/unit/admin-overview.test.ts test/unit/admin-overview-route.test.ts` (expect all pass)

- [ ] **Step 2: Pictures to Jaimie**

Send the four pictures from Task 4 Step 5 (the list and an open story, at 1280px and 390px). She was promised them before anything is live. Tell her the button sits under the story's words, where reading ends, not at the very top. Wait for her yes.

- [ ] **Step 3: Independent review**

This changes behaviour, so it gets a review before merge (superpowers:requesting-code-review, a background agent, read only): the spec and this plan, the diff from `origin/main`, and these questions in particular: can a tick ever open the story or act on the wrong story; can a failed save leave a tick showing something untrue; does a viewer ever send a PATCH; does the Used or Withdrawn lock hold when the list is drawn for an editor; is the BDD scenario safe beside the other scenarios that add stories. Fix anything Critical or Important.

- [ ] **Step 4: Ship**

Claim the next task number at PR time (GitHub runs, PR titles and `git branch -a`), put it in place of `TASK-NNN` in this branch's own lines only, and follow `/ship`: push as `task-<n>-stories-read-tick`, open the PR titled `[TASK-<n>] A Read tick on Stories`, read CI through the app's PR status (no polling), squash-merge on green with no `--delete-branch`, find the deploy by the merge SHA, and check the live `app.js` and `admin.css` are byte for byte the repo's. The diff touches no `infra/` and no migration.

- [ ] **Step 5: Notes**

Tick the item in `nbcc-open-todos.md` with the PR, the merge SHA and what was checked live.
