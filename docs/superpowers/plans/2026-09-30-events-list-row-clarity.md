# Each Events list row clear on its own: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Events list's rows make sense on their own. The status says "On the website" or "Goes
up 14 Oct", each button is named after its event for a screen reader, and opening an event neither
re-reads the list nor loses your place.

**Architecture:** Three small edits to the list's markup in `evRenderList` (`assets/js/admin/app.js`),
one helper that moves focus to the editor when a row's button is pressed, and two attribute changes
in `admin.html`. There is no CSS change.

**Tech stack:** Plain browser JavaScript (the admin's classic `app.js`). Vitest with jsdom, via
`test/unit/admin-app.test.ts`, which runs the real `app.js` against the real `admin.html`.

Spec: `docs/superpowers/specs/2026-09-30-events-list-row-clarity-design.md`.

---

### Task 1: The failing tests

**Files:**
- Modify: `test/unit/admin-app.test.ts`:
  - fixtures near the top, after `teamMembers` (around line 98);
  - two `respond()` branches before its default return (around line 165);
  - reset `events` in the main `beforeEach` (around line 187);
  - a new `describe` at the end of the main `describe`, before its closing `});` (around line 843).

- [ ] **Step 1: Fixtures.** After `let teamMembers: TeamMember[] = [];`:

```ts
// TASK-465: the Events screen's events, as GET /api/admin/events returns them (none unless a test
// adds some). Every field the list and the editor read, with a test's own values laid on top.
const eventRecord = (over: Record<string, unknown>) => ({
  id: 1, slug: "e", name: "An event", subtitle: "", gist: "", date: "2026-11-04", start: "18:00",
  end: "22:00", timeTbc: false, venue: "The Hall", town: "Ayr", address: "", access: [],
  imageSrc: null, imageFit: "cover", imageGround: "night", imageAlt: "", cover: "crimson",
  costFront: "", costBack: "", flag: "", listHeading: "", whatsOn: "", note: "", runBy: "nbcc",
  partnerName: "", partnerFront: "Organised by", partnerCredit: "Organised by", partnerLogoSrc: null,
  partnerLine: "", bookingHow: "none", bookingUrl: "", bookingLabel: "", bookingNote: "",
  status: "live", showFrom: null, ...over,
});
let events: ReturnType<typeof eventRecord>[] = [];
```

- [ ] **Step 2: `respond()` branches.** Add these before `return j({ results: [] }); // queues / adjustment-due`:

```ts
  // TASK-465: the Events screen. The preview is checked first, since it shares the list's prefix.
  if (url.includes("/api/admin/events/preview")) {
    return j({ card: "<p>card</p>", page: "<p>page</p>", problems: [], onPage: true });
  }
  if (/\/api\/admin\/events$/.test(url)) {
    return j({ pageOn: false, updatedAt: null, updatedBy: null, today: "2026-09-30", events });
  }
```

and add `events = [];` in the main `beforeEach`, after `teamMembers = [];`.

- [ ] **Step 3: The tests.** Add them at the end of the main describe:

```ts
  // TASK-465: each Events list row clear on its own. In TASK-460's compact rows the column headings
  // are out of sight, so a scheduled event's "From 14 Oct" read like the event's own date, the status
  // said "On the page" where the editor says "On the website", and every button was a bare "Edit".
  // Opening an event also redrew the list inside a live region, so the list was read out again and
  // the button just pressed was gone.
  describe("the Events list: each row clear on its own (TASK-465)", () => {
    const realScrollIntoView = Element.prototype.scrollIntoView;
    beforeEach(() => {
      // jsdom does no layout, so it has no scrollIntoView, and the list's buttons scroll to the editor.
      Element.prototype.scrollIntoView = vi.fn();
      events = [
        eventRecord({ id: 1, name: "EmpowHer ’26", date: "2026-11-04", status: "live" }),
        eventRecord({ id: 2, name: "Christmas Jumper Day", date: "2026-12-09", status: "scheduled", showFrom: "2026-10-14" }),
        eventRecord({ id: 3, name: "Carols at the Cross", date: "2026-10-20", status: "scheduled", showFrom: "2026-09-20" }),
        eventRecord({ id: 4, name: "Festive Quiz Night", date: "2026-11-14", status: "draft" }),
        eventRecord({ id: 5, name: "Red Bag packing morning", date: "2026-09-18", status: "live" }),
      ];
    });
    afterEach(() => {
      Element.prototype.scrollIntoView = realScrollIntoView;
    });

    // Arriving opens the soonest event by itself: Carols at the Cross, on 20 Oct.
    async function openEvents() {
      await signIn();
      (document.querySelector('.admin-nav-link[data-view="events"]') as HTMLElement).click();
      await flush();
      await flush();
      await flush();
    }
    const pills = () => Array.from(el("evList").querySelectorAll(".admin-pill")).map((p) => p.textContent);
    const buttons = () => Array.from(el("evList").querySelectorAll<HTMLButtonElement>(".ev-admin-edit"));

    it("says an event that is up is on the website, and when one that is waiting goes up", async () => {
      await openEvents();
      expect(pills()).toEqual(["On the website", "On the website", "Goes up 14 Oct"]);
      expect(el("evList").textContent).not.toContain("On the page");

      (document.querySelector('[data-evlist="drafts"]') as HTMLElement).click();
      expect(pills()).toEqual(["Draft"]);
      (document.querySelector('[data-evlist="past"]') as HTMLElement).click();
      expect(pills()).toEqual(["Past"]);
    });

    // The visible word first, so "click Edit" still works for someone using speech input.
    it("names each event's button after its event, and marks the one that is open", async () => {
      await openEvents();
      expect(buttons().map((b) => b.textContent)).toEqual(["Open", "Edit", "Edit"]);
      expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open Carols at the Cross", "Edit EmpowHer ’26", "Edit Christmas Jumper Day",
      ]);
      expect(buttons().map((b) => b.getAttribute("aria-current"))).toEqual(["true", null, null]);
    });

    // It redraws whenever an event opens. Saving, deleting and a failed load each announce through
    // their own status line.
    it("is not a live region, so opening an event does not read the whole list out again", async () => {
      await openEvents();
      expect(el("evList").hasAttribute("aria-live")).toBe(false);
    });

    it("takes you to the editor when you open an event, rather than losing your place", async () => {
      await openEvents();
      buttons()[2].click();
      await flush();
      expect(document.activeElement).toBe(el("evEditorTitle"));
      expect(el("evEditorTitle").textContent).toBe("Editing: Christmas Jumper Day");
      expect(buttons()[2].getAttribute("aria-current")).toBe("true");
      expect(buttons()[0].getAttribute("aria-label")).toBe("Edit Carols at the Cross");
    });

    it("takes you to the editor from the event already open, too", async () => {
      await openEvents();
      buttons()[0].click();
      await flush();
      expect(document.activeElement).toBe(el("evEditorTitle"));
    });

    // Arriving opens the soonest event by itself, and must not pull focus away from where it is.
    it("leaves focus alone when the screen opens an event by itself", async () => {
      await openEvents();
      expect(document.activeElement).not.toBe(el("evEditorTitle"));
    });
  });
```

- [ ] **Step 4: Run them and watch them fail.**

Run: `npx vitest run test/unit/admin-app.test.ts`
Expected: five of the six new tests FAIL. The pills read "On the page" and "From 14 Oct", the buttons
have no `aria-label` or `aria-current`, `#evList` has `aria-live`, and focus is not on the heading.
"Leaves focus alone" PASSES, because it guards today's behaviour. Every existing test still PASSES.

### Task 2: The changes

**Files:**
- Modify: `assets/js/admin/app.js`, in `evRenderList` (the pill and button markup, around lines
  8995–9012) and in the `#evList` click handler inside `evWire` (around line 9441).
- Modify: `admin.html`, on `#evList` (around line 1097) and `#evEditorTitle` (around line 1101).

- [ ] **Step 1: The pills.** In `evRenderList`, change the scheduled and live pills to:

```js
        else if (e.status === "scheduled" && !evIsOnPage(e)) pill = '<span class="admin-pill admin-pill--pending">Goes up ' + H.escapeHtml(evShortDate(e.showFrom)) + "</span>";
        else pill = '<span class="admin-pill admin-pill--active">On the website</span>';
```

- [ ] **Step 2: The buttons.** Replace `var editing = e.id === evCurrentId;` and the button cell with:

```js
        var editing = e.id === evCurrentId;
        var action = editing ? "Open" : evCanWrite() ? "Edit" : "View";
```

```js
          '<td><button class="ev-admin-edit" type="button" data-evopen="' + e.id + '" aria-label="' +
          H.escapeHtml(action + " " + e.name) + '"' + (editing ? ' aria-current="true"' : "") + ">" + action +
          "</button></td></tr>"
```

- [ ] **Step 3: Focus to the editor.** Add after `evOpenNew`:

```js
  // Opening an event redraws the list, which takes away the button just pressed, and keyboard focus
  // would fall back to the page. It goes to the editor's heading instead, which is where the page is
  // scrolling anyway. Only ever after a person presses a row's button: arriving on the screen opens
  // the soonest event by itself, and must not pull focus away from wherever it is.
  function evFocusEditor() {
    var title = el("evEditorTitle");
    if (title && title.focus) title.focus({ preventScroll: true });
    el("evEditor").scrollIntoView({ behavior: "smooth", block: "start" });
  }
```

In the `#evList` click handler, replace both
`el("evEditor").scrollIntoView({ behavior: "smooth", block: "start" });` calls with
`evFocusEditor();`.

- [ ] **Step 4: `admin.html`.** Change `<div class="admin-table-wrap" id="evList" aria-live="polite">` to
  `<div class="admin-table-wrap" id="evList">`, and `<h3 id="evEditorTitle">` to
  `<h3 id="evEditorTitle" tabindex="-1">`.

- [ ] **Step 5: Run the tests.**

Run: `npx vitest run test/unit/admin-app.test.ts test/unit/admin-shell.test.ts test/unit/admin-fits-a-phone.test.ts`
Expected: all PASS.

- [ ] **Step 6: Run the full checks.** Run `npm run lint`, `npm run build` and `npm run test:unit`.
  Expected: lint and build exit 0, and only `perf-budget` fails (the known Windows line-ending
  artefact).

- [ ] **Step 7: Commit.**

```bash
git add assets/js/admin/app.js admin.html test/unit/admin-app.test.ts
git commit -m "[TASK-465] Each Events list row clear on its own"
```

### Task 3: Proof in a real browser

**Files:** none in the repo. Use the scratchpad stand-in and `measure-events.mjs`.

- [ ] **Step 1: Check the words.** Run with `EXTRA` reading the pills and the button labels, at 320px
  (compact rows) and 1280px (the table). Expect "On the website", "Goes up …" and "Open …" / "Edit …".
- [ ] **Step 2: Check focus.** Use a `PREP` that clicks the second row's button, then read
  `document.activeElement.id`. Expect `evEditorTitle`.
- [ ] **Step 3: Check nothing moved.** Re-run the TASK-460 checker (`list-check2.js`) at 320, 390,
  861, 1100, 1200 and 1280px. Expect everything clean.

### Task 4: README

**Files:** `README.md`. Add "## Each Events list row clear on its own (TASK-465)" after the TASK-460
section. It covers the four problems, the client's wording, what changes for a screen reader, and the
tests.

### Task 5: Ship

Follow the same steps as TASK-460:
- check the number (`gh pr list`, and `git branch --list "task-46*"`);
- sync with `main`, re-running Task 2's Step 6 if anything came in;
- push, then `gh pr create --title "[TASK-465] Each Events list row clear on its own"`;
- run the review as a background agent, and read `get_status` once it hands back;
- merge with `--squash`, then delete the branch on GitHub;
- watch the deploy found by SHA, then check `/health` and the live `app.js`.
