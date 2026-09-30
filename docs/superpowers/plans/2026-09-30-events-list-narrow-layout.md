# The Events list where the table does not fit: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wherever the admin's Events list is narrower than 900px, show each event as a compact row
(the date and time, the event, who runs it, then its status and button on one line) instead of a
five-column table that breaks. Leave the table exactly as it is from 900px up.

**Architecture:** CSS only, in the Events block of `assets/css/admin.css`. The list (`#evList`)
becomes a size container named `evlist`. Every compact-row rule sits in
`@container evlist (max-width: 899px)`, so the switch follows the list's own width, whether a small
screen or the side menu is what makes it narrow. There is no markup change.

**Tech stack:** Plain CSS (container queries), and Vitest static assertions over the canonicalised
stylesheet. Checking in a real browser uses the scratchpad stand-in server and headless Chrome over
CDP, because this laptop has no local database.

Spec: `docs/superpowers/specs/2026-09-30-events-list-narrow-layout-design.md`.

---

### Task 1: The failing tests

**Files:**
- Modify: `test/unit/admin-fits-a-phone.test.ts`. The `parse()` function (around line 48) learns
  `@container`, and a new `describe` block is added at the end of the file.

- [ ] **Step 1: Teach the parser container queries.** In `parse()`, replace the line

```ts
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) rules.push(...parse(body, prelude));
```

with

```ts
    if (/^@(media|supports|container)\b/.test(prelude)) rules.push(...parse(body, prelude));
```

- [ ] **Step 2: Append the tests.** Add at the end of the file:

```ts
// TASK-460: the Events list is a five-column table that needs about 850px. Wherever the list is
// narrower (every phone and tablet, and laptops up to about 1150px, where the side menu takes the
// room) its buttons broke their own labels ("Ed / it"), times broke mid-word, the date badge ran
// into the event's name, and on a phone the list scrolled sideways inside its box. There, each event
// is now a compact row instead. The switch is measured on the list itself, not the screen, because
// the list is narrowest on a laptop just past 860px, with the side menu beside it.
describe("the Events list becomes compact rows wherever its table does not fit", () => {
  const NARROW = "@container evlist (max-width:899px)";

  it("measures the list itself, so the side menu's squeeze counts as well as a small screen", () => {
    expect(rule("#view-events #evList")).toContain("container:evlist / inline-size");
    expect(RULES.some((r) => r.media === NARROW)).toBe(true);
  });

  it("stops laying the events out as a table, one row per event", () => {
    expect(rule("#view-events .ev-admin-table", NARROW)).toContain("display:block");
    expect(rule("#view-events .ev-admin-table tbody", NARROW)).toContain("display:block");
    expect(rule("#view-events .ev-admin-table tr", NARROW)).toContain("display:grid");
    expect(rule("#view-events .ev-admin-table td", NARROW)).toContain("display:block");
  });

  // Top to bottom, like a diary entry: the date and time, the event, who runs it, then where it
  // stands and the button, sharing the last line.
  it("reads each event top to bottom, with its status and button on the last line", () => {
    expect(rule("#view-events .ev-admin-table tr", NARROW)).toContain(
      'grid-template-areas:"when when" "event event" "run run" "state open"',
    );
    ["when", "event", "run", "state", "open"].forEach((area, i) => {
      expect(rule(`#view-events .ev-admin-table td:nth-child(${i + 1})`, NARROW), area).toContain(`grid-area:${area}`);
    });
  });

  // Without its column heading, "NBCC" on its own could be anything.
  it("says who runs it in words, since the column heading is out of sight", () => {
    expect(rule("#view-events .ev-admin-table td:nth-child(3)::before", NARROW)).toContain('content:"Run by "');
  });

  // Hidden the way the house stacks hide theirs: out of sight, but still read out, so a screen
  // reader keeps the headings.
  it("keeps the headings for screen readers rather than removing them", () => {
    const head = rule("#view-events .ev-admin-table thead", NARROW);
    expect(head).toContain("clip:rect(0 0 0 0)");
    expect(head).not.toContain("display:none");
  });

  // A value that cannot wrap would push a compact row wider than its list: the fault this replaces.
  // The hidden headings' nowrap is the visually-hidden pattern (clipped to a pixel) and is allowed.
  it("has no rule in the list, at any width, that stops its words wrapping", () => {
    const offenders = RULES.filter((r) => r.selectors.some((s) => /ev-admin|evList/.test(s)))
      .filter((r) => /white-space:(nowrap|pre)/.test(r.body) && !/clip:rect/.test(r.body))
      .map((r) => `${r.media ?? ""} ${r.selectors.join(",")}{${r.body}}`);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail.**

Run: `npx vitest run test/unit/admin-fits-a-phone.test.ts`
Expected: the first 5 new tests FAIL, the first with "a rule for #view-events #evList". The sweep
(the 6th) already passes: it guards the new rules and is proved in Task 2's Step 2b. The 16
existing tests PASS, so the parser change has not disturbed them.

### Task 2: The compact rows

**Files:**
- Modify: `assets/css/admin.css`. Insert after
  `#view-events .ev-admin-empty { … }` (the last "the list" rule, around line 1841) and before
  `/* ---- the editor: the form, and the card beside it ---- */`.

- [ ] **Step 1: Add the rules.**

```css
/* TASK-460: wherever the list is too narrow for its table, each event is a compact row instead.
   The table needs about 850px: below that its buttons break their own label ("Ed / it"), then the
   times break, the badge runs into the name, and on a phone the list scrolls sideways inside its
   box. Measured on the list itself, not the screen, because the list is narrowest on a laptop just
   past 860px, with the side menu beside it. Each event reads top to bottom: the date and time, the
   event, who runs it, then its status and the button on one line. From 900px up the table is
   untouched. The headings stay, out of sight, for screen readers. */
#view-events #evList { container: evlist / inline-size; }
@container evlist (max-width: 899px) {
  #view-events .ev-admin-table,
  #view-events .ev-admin-table tbody { display: block; width: auto; }
  #view-events .ev-admin-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  #view-events .ev-admin-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "when when" "event event" "run run" "state open";
    column-gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
  }
  #view-events .ev-admin-table tr:last-child { border-bottom: 0; }
  #view-events .ev-admin-table tr.is-editing { background: color-mix(in srgb, var(--crimson) 7%, var(--card)); }
  #view-events .ev-admin-table td { display: block; width: auto; padding: 0; border: 0; }
  #view-events .ev-admin-table td:nth-child(1) { grid-area: when; margin-bottom: 10px; }
  #view-events .ev-admin-table td:nth-child(2) { grid-area: event; }
  #view-events .ev-admin-table td:nth-child(3) { grid-area: run; margin-top: 4px; font-size: 0.88rem; }
  #view-events .ev-admin-table td:nth-child(3)::before { content: "Run by "; color: var(--slate-soft); }
  #view-events .ev-admin-table td:nth-child(4) { grid-area: state; align-self: center; margin-top: 12px; }
  #view-events .ev-admin-table td:nth-child(5) { grid-area: open; align-self: center; margin-top: 12px; }
}
```

- [ ] **Step 2: Run the two phone test files.**

Run: `npx vitest run test/unit/admin-fits-a-phone.test.ts test/unit/admin-no-sideways-scroll.test.ts`
Expected: all PASS (22 + 7). The thead's `white-space: nowrap` is allowed by both sweeps, because
it sits beside `clip: rect`, the visually-hidden pattern.

- [ ] **Step 2b: Prove the guards can fail.**
  - Temporarily add `@container evlist (max-width: 899px) { #view-events .ev-admin-name { white-space: nowrap; } }`
    to `admin.css`. The sweep must FAIL, naming that rule.
  - Temporarily change `display: grid` on the row to `display: block`. The "stops laying the events
    out as a table" test must FAIL.
  - Undo both edits, confirm `git diff` shows only the Step 1 block, and re-run: all PASS.

- [ ] **Step 3: Run the full checks.**

Run: `npm run lint`, then `npm run build`, then `npm run test:unit`.
Expected: lint and build exit 0. Every unit test passes except `perf-budget` (donate.html), which
is the known Windows line-ending artefact and passes in CI.

- [ ] **Step 4: Commit.**

```bash
git add assets/css/admin.css test/unit/admin-fits-a-phone.test.ts
git commit -m "[TASK-460] The Events list becomes compact rows wherever its table does not fit"
```

### Task 3: Proof in a real browser

**Files:** none in the repo. Everything runs from the scratchpad (`events-standin.mts`,
`measure-events.mjs`, `list-check.js`).

- [ ] **Step 1: Measure every width.** Keep the stand-in running from the worktree
  (`PORT=4321 node_modules/.bin/tsx <scratchpad>/events-standin.mts`), then run:

```bash
STATES=off SHOT="#evList" EXTRA="$(cat list-check.js)" WIDTHS=320,375,390,430,768,861,960,1024,1100,1180,1200,1280 node measure-events.mjs listafter
```

Expected, at every width:
- the page's `scrollWidth` equals its `clientWidth`;
- `listScrollsBy` is 0;
- `problems` is empty: nothing sticks out of its cell and no word breaks mid-word.

- [ ] **Step 2: Show the table is untouched where it fits.** Compare `listafter-off-1200.png` and
  `listafter-off-1280.png` with the `tablenow-off-*.png` taken before the change. Their SHA-256
  hashes must match.

- [ ] **Step 3: Check the other two lists.** Run Step 1's command at 320px with
  `PREP='document.querySelector("[data-evlist=past]").click()'`, then again with
  `[data-evlist=drafts]`. Expected: the "Past" and "Draft" pills and the "Edit" button sit on the
  last line, and nothing is flagged.

- [ ] **Step 4: Look at the screenshots** at 320, 390, 960 and 1280px. They should match the
  approved prototype B, with the table at 1280.

### Task 4: README (golden rule 7)

**Files:**
- Modify: `README.md`. Change the "**Not fixed here: …**" paragraph at the end of
  "## The Events switch fits the smallest phones (TASK-455)", and add a new section after it.

- [ ] **Step 1: Point the TASK-455 paragraph at the fix.** Change its first sentence to
  "**Not fixed there, since fixed in TASK-460: the list of events on the same screen broke on a
  phone.**", and add at its end: "See
  [The Events list where the table does not fit](#the-events-list-where-the-table-does-not-fit-task-460)."

- [ ] **Step 2: Add the section** "## The Events list where the table does not fit (TASK-460)". It
  covers:
  - the measured problem, with the widths;
  - the choice: compact rows, chosen from two rendered prototypes, and why not the house stack;
  - the container query and why it is used;
  - what was verified, and the tests.

- [ ] **Step 3: Commit.**

```bash
git add README.md
git commit -m "[TASK-460] README: the Events list where the table does not fit"
```

### Task 5: Ship (`/ship`, adapted for the desktop app)

- [ ] **Step 1: Check the number.** Just before the PR, confirm 460 is still free: run
  `gh pr list --state all --limit 8` and `git branch --list "task-46*"`.
- [ ] **Step 2: Sync.** Run `git fetch origin`. If `main` moved, run `git rebase origin/main` and
  re-run Task 2's Step 3.
- [ ] **Step 3: Open the PR.** Push, then run
  `gh pr create --base main --title "[TASK-460] The Events list becomes compact rows wherever its table does not fit"`.
- [ ] **Step 4: Review.** Start the code review as a background agent. Its hand-back is the moment
  to read the PR's status once, with ccd_pr `get_status`. Do not poll.
- [ ] **Step 5: Merge.** When the checks pass and the PR is mergeable, run
  `gh pr merge <n> --squash --subject "[TASK-460] … (#n)"`, then
  `git push origin --delete task-460-events-list-phone`.
- [ ] **Step 6: Watch the deploy.** Find the run whose `headSha` is the merge commit with
  `gh run list --workflow=deploy-prod.yml --limit 5` (no `--branch`). Watch it in the background.
  Then confirm that `https://nbcc.scot/health` reports the merge SHA, and that the live
  `admin.css` holds the `@container evlist` rule.
