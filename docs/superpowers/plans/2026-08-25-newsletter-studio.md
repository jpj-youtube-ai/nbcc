# Newsletter Studio Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin Newsletter tab as three destinations (Overview · Audiences &
people · All newsletters) with composing as a full-screen three-step takeover, and let a person
or a spreadsheet be added to several audiences at once — without losing a single existing control.

**Architecture:** Two PRs. **A** adds the multi-audience API additively (the existing single-list
endpoints stay, untouched, so nothing in flight breaks) with the decision logic in a pure,
DB-free module. **B** restructures `admin.html` / `admin.css` / `app.js` and wires the new
endpoints. Approved design: <https://claude.ai/code/artifact/7bff9031-f497-497d-b2ef-923ebccda719>

**Tech stack:** Express + TypeScript, Zod, node-pg-migrate (none needed here), Vitest,
Cucumber, vanilla JS admin (`assets/js/admin/app.js`).

---

## Facts established before planning (do not re-derive)

| Fact | Consequence |
|---|---|
| `shouldSendWelcome` returns true **only** for `"footer"` (`src/newsletter/welcome.ts:39`) | Admin-add and import send **no** welcome email. Multi-audience cannot cause a mailout. Pin with a test; do not add welcome logic. |
| `listNotManageable` (`src/routes/admin.ts:547`) refuses only `kind === "donors"` and archived lists | Newsletter (`everyone`) and every `manual` list are valid targets. Donors is shown greyed in the UI, never posted. |
| `addListSubscriber(listId, person, source, opts)` returns `"added" \| "exists" \| "previously_unsubscribed"` | Multi-add is a loop over one proven call. No new DB primitive needed. |
| Import commit uses `revive: false`; admin-add uses `revive: true` | Preserve exactly. A spreadsheet may never overrule an opt-out. |
| `admin.html` is **not** in `PAGES` in `test/unit/perf-budget.test.ts` | The page-weight ceiling does not constrain this work. Do not touch `assets/css/styles.css` or `assets/js/main.js`. |
| `test/unit/newsletter-builder-ui.test.ts` (1112 lines) drives the real `app.js` against the real `admin.html` | This is the safety net for PR B. It must stay green without being weakened. |
| `app.js` binds by element id | **Never remove or rename an id.** Wrap and restyle. Verify the id set before and after. |
| Highest migration is `1785500000000` | Neither PR needs a migration. If that changes, renumber above this. |

---

## File structure

**PR A**
- Create `src/newsletter/audience-targets.ts` — pure: validate a set of target list ids, and
  fold per-list outcomes into one summary. No DB, no Express.
- Create `test/unit/newsletter-audience-targets.test.ts`.
- Modify `src/routes/admin.ts` — three new handlers + three route lines.
- Modify `features/newsletter.feature` + `features/steps/*` — BDD for the new endpoints.
- Modify `README.md`.

**PR B**
- Modify `admin.html` — restructure the newsletter section. Every existing id preserved.
- Modify `assets/css/admin.css` — new `.nl-*` styles.
- Modify `assets/js/admin/app.js` — destination routing, compose steps, results detail,
  tick lists posting to the PR-A endpoints.
- Create `test/unit/newsletter-studio-ui.test.ts` — jsdom, same harness as
  `newsletter-builder-ui.test.ts`.
- Modify `README.md`.

---

# PR A — TASK-282: add a person or a spreadsheet to several audiences

### Task A1: the pure targets module

**Files:**
- Create: `src/newsletter/audience-targets.ts`
- Test: `test/unit/newsletter-audience-targets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseTargetListIds, foldOutcomes, MAX_TARGETS } from "../../src/newsletter/audience-targets";

describe("parseTargetListIds", () => {
  it("accepts a list of positive integers", () => {
    expect(parseTargetListIds([3, 7, 11])).toEqual([3, 7, 11]);
  });

  it("removes duplicates so one audience cannot be written twice", () => {
    expect(parseTargetListIds([4, 4, 9])).toEqual([4, 9]);
  });

  it("rejects an empty selection rather than silently doing nothing", () => {
    expect(parseTargetListIds([])).toBeNull();
  });

  it("rejects anything that is not a positive integer id", () => {
    expect(parseTargetListIds([1, 0])).toBeNull();
    expect(parseTargetListIds([1, -2])).toBeNull();
    expect(parseTargetListIds([1, 2.5])).toBeNull();
    expect(parseTargetListIds(["3"])).toBeNull();
    expect(parseTargetListIds("3")).toBeNull();
    expect(parseTargetListIds(undefined)).toBeNull();
  });

  it("refuses an absurd number of audiences", () => {
    const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => i + 1);
    expect(parseTargetListIds(many)).toBeNull();
  });
});

describe("foldOutcomes", () => {
  it("counts each outcome and keeps the per-audience detail", () => {
    const folded = foldOutcomes([
      { listId: 3, listName: "Volunteers", outcome: "added" },
      { listId: 7, listName: "Newsletter", outcome: "exists" },
      { listId: 9, listName: "Bag packers", outcome: "previously_unsubscribed" },
    ]);
    expect(folded.added).toBe(1);
    expect(folded.alreadyOnList).toBe(1);
    expect(folded.previouslyUnsubscribed).toBe(1);
    expect(folded.perList).toHaveLength(3);
    expect(folded.addedTo).toEqual(["Volunteers"]);
  });

  it("reports nothing added when every audience already had them", () => {
    const folded = foldOutcomes([
      { listId: 3, listName: "Volunteers", outcome: "exists" },
      { listId: 7, listName: "Newsletter", outcome: "exists" },
    ]);
    expect(folded.added).toBe(0);
    expect(folded.addedTo).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/unit/newsletter-audience-targets.test.ts`
Expected: FAIL — cannot resolve `../../src/newsletter/audience-targets`.

- [ ] **Step 3: Write the module**

```ts
// TASK-282: one person, or one spreadsheet, going to SEVERAL audiences at once.
//
// The rules live here rather than in the route handler because they decide what gets written to
// whom, and that is the part worth pinning with tests that do not need a database. The route stays
// a thin shell: authorise, parse, loop the already-proven addListSubscriber, fold, audit.

export const MAX_TARGETS = 20;

export type AddOutcome = "added" | "exists" | "previously_unsubscribed";

export interface TargetOutcome {
  listId: number;
  listName: string;
  outcome: AddOutcome;
}

export interface FoldedOutcomes {
  added: number;
  alreadyOnList: number;
  previouslyUnsubscribed: number;
  /** Names of the audiences the person actually joined — what the confirmation says back. */
  addedTo: string[];
  perList: TargetOutcome[];
}

/**
 * Validate the audiences a write is aimed at.
 *
 * Returns null (not an empty array) for anything invalid, so a caller cannot mistake "nothing
 * selected" for "proceed with no targets" — a silent no-op that reports success is the worst
 * outcome here, because the volunteer walks away believing the person was added.
 *
 * Duplicates are dropped rather than rejected: two ticks resolving to the same audience is a UI
 * accident, not an error worth refusing, and writing the same membership twice is pointless.
 */
export function parseTargetListIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0 || raw.length > MAX_TARGETS) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) return null;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Fold per-audience results into the one summary the UI and the audit row both read. */
export function foldOutcomes(results: TargetOutcome[]): FoldedOutcomes {
  const folded: FoldedOutcomes = {
    added: 0,
    alreadyOnList: 0,
    previouslyUnsubscribed: 0,
    addedTo: [],
    perList: results,
  };
  for (const r of results) {
    if (r.outcome === "added") {
      folded.added++;
      folded.addedTo.push(r.listName);
    } else if (r.outcome === "exists") folded.alreadyOnList++;
    else folded.previouslyUnsubscribed++;
  }
  return folded;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run test/unit/newsletter-audience-targets.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/newsletter/audience-targets.ts test/unit/newsletter-audience-targets.test.ts
git commit -m "[TASK-282] Pure rules for writing one person to several audiences"
```

---

### Task A2: pin that multi-audience never mails anybody

**Files:**
- Modify: `test/unit/newsletter-welcome.test.ts`

- [ ] **Step 1: Add the test**

```ts
  // TASK-282: adding one person to five audiences must not become five emails — or even one.
  // The multi-audience routes call addListSubscriber with source 'admin' / 'import', and neither
  // gets a welcome. Pinned here so a future "be friendlier, send a welcome" change has to come
  // past this test and think about the import case first.
  it("stays false for every source the multi-audience routes use", () => {
    for (const source of ["admin", "import"] as const) {
      expect(shouldSendWelcome(source)).toBe(false);
    }
  });
```

- [ ] **Step 2: Run and confirm it passes immediately**

Run: `npx vitest run test/unit/newsletter-welcome.test.ts`
Expected: PASS. It is a characterisation test — green from the start is correct.

- [ ] **Step 3: Commit**

```bash
git add test/unit/newsletter-welcome.test.ts
git commit -m "[TASK-282] Pin that a multi-audience add never sends a welcome"
```

---

### Task A3: `POST /api/admin/subscriber-list-members`

**Files:**
- Modify: `src/routes/admin.ts` (new handler near `postAdminListMember` at :608; route line near :2133)

The path is deliberately **not** under `/subscriber-lists/:id/` — there is no single `:id`. The
existing single-list endpoint stays exactly as it is.

- [ ] **Step 1: Write the handler**

```ts
// TASK-282: add ONE person to SEVERAL audiences in one action. The single-list endpoint above is
// untouched and still serves anything that targets one audience.
//
// Not a transaction: each membership is an independent, idempotent row, and a partial success is
// both recoverable (press it again — 'exists' is a no-op) and honestly reportable. Wrapping five
// independent writes in a transaction would buy atomicity nobody asked for and hide which audience
// actually failed.
export async function postAdminListMembersMulti(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = z
    .object({
      listIds: z.array(z.number()).min(1),
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email(),
      phone: z.string().trim().max(30).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A valid email address is needed" });
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  // Check EVERY audience before writing ANY. A half-done add that reports success is worse than a
  // clean refusal: the volunteer has no way to tell which half happened.
  const lists = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const results: TargetOutcome[] = [];
  for (const list of lists) {
    const outcome = await addListSubscriber(
      list.id,
      { name: parsed.data.name ?? null, email: parsed.data.email, phone: parsed.data.phone ?? null },
      "admin",
      { revive: true, addedBy: claims.email },
    );
    results.push({ listId: list.id, listName: list.name, outcome });
  }
  const folded = foldOutcomes(results);
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.added_multi",
      entity: "subscriber_list",
      entityId: lists[0].id,
      data: { email: parsed.data.email, audiences: lists.map((l) => l.slug), added: folded.added },
    });
  } catch (err) {
    console.error("multi-add audit failed:", err instanceof Error ? err.message : err);
  }
  return res.status(folded.added > 0 ? 201 : 200).json(folded);
}
```

- [ ] **Step 2: Add the import and the route line**

Add to the existing `audience-targets` import block at the top of `src/routes/admin.ts`:

```ts
import { parseTargetListIds, foldOutcomes, type TargetOutcome } from "../newsletter/audience-targets";
```

Add beside the other subscriber-list routes (after line 2133):

```ts
// Multi-audience writes: no single :id, so they sit outside /subscriber-lists/:id.
adminRouter.post("/api/admin/subscriber-list-members", postAdminListMembersMulti);
```

- [ ] **Step 3: Lint and typecheck**

Run: `npm run lint`
Expected: clean. (`npm run build` needs `exceljs`, which the owner's machine cannot install —
CI covers it.)

- [ ] **Step 4: Commit**

```bash
git add src/routes/admin.ts
git commit -m "[TASK-282] Endpoint: add one person to several audiences"
```

---

### Task A4: multi-audience import preview and commit

**Files:**
- Modify: `src/routes/admin.ts` (near `postAdminListImportPreview` at :662)

- [ ] **Step 1: Write the preview handler**

```ts
// TASK-282: preview an import against SEVERAL audiences.
//
// "Already on the list" is per-audience, so the aggregate has to mean something precise: a row is
// READY if it would join at least one of the chosen audiences. A person already on Volunteers but
// not on Newsletter is genuinely work to do, and calling them "already on the list" would tell the
// volunteer nothing was needed when 400 additions were.
export async function postAdminListImportPreviewMulti(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "newsletter", "edit"))) return;
  const parsed = importFileSchema.extend({ listIds: z.array(z.number()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Upload a CSV or Excel file" });
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  const lists = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const data = Buffer.from(parsed.data.dataBase64, "base64");
  if (data.length > IMPORT_MAX_BYTES) return res.status(413).json({ error: "File too large (2 MB max)" });
  let fileRows;
  try {
    fileRows = await parseImportFile(parsed.data.filename, data);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : "Could not read that file" });
  }

  const emails = fileRows.rows.map((r) => r.email);
  const optedOut = new Set<string>();
  const activeEverywhere = new Map<string, number>();
  const perList = [];
  for (const list of lists) {
    const states = await getMembershipStates(list.id, emails);
    const active = states.filter((s) => !s.unsubscribed).map((s) => s.email);
    states.filter((s) => s.unsubscribed).forEach((s) => optedOut.add(s.email));
    active.forEach((e) => activeEverywhere.set(e, (activeEverywhere.get(e) ?? 0) + 1));
    perList.push({ listId: list.id, listName: list.name, alreadyOnList: active.length });
  }

  // Ready = would join at least one chosen audience, and is not opted out anywhere.
  const ready = fileRows.rows.filter(
    (r) => !optedOut.has(r.email) && (activeEverywhere.get(r.email) ?? 0) < lists.length,
  );
  return res.json({
    rows: fileRows.rows,
    issues: fileRows.issues,
    readyCount: ready.length,
    audiences: perList,
    alreadyOnEvery: fileRows.rows
      .filter((r) => !optedOut.has(r.email) && (activeEverywhere.get(r.email) ?? 0) === lists.length)
      .map((r) => r.email),
    previouslyUnsubscribed: fileRows.rows.filter((r) => optedOut.has(r.email)).map((r) => r.email),
  });
}
```

- [ ] **Step 2: Write the commit handler**

```ts
// TASK-282: commit an import into SEVERAL audiences. revive:false is preserved per audience —
// a spreadsheet may never overrule an opt-out, and doing it once per audience keeps that rule
// exactly where it already is rather than restating it.
export async function postAdminListImportMulti(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "newsletter", "edit");
  if (!claims) return;
  const parsed = importCommitSchema.extend({ listIds: z.array(z.number()).min(1) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Confirm these people have agreed to be contacted before importing" });
  }
  const listIds = parseTargetListIds(parsed.data.listIds);
  if (!listIds) return res.status(400).json({ error: "Choose at least one audience" });

  const lists = [];
  for (const id of listIds) {
    const list = await getSubscriberList(id);
    if (!list) return res.status(404).json({ error: "Subscriber list not found" });
    const refusal = listNotManageable(list);
    if (refusal) return res.status(400).json({ error: refusal });
    lists.push(list);
  }

  const audiences = [];
  let added = 0;
  let alreadyOnList = 0;
  let previouslyUnsubscribed = 0;
  for (const list of lists) {
    const counts = { added: 0, alreadyOnList: 0, previouslyUnsubscribed: 0 };
    for (const row of parsed.data.rows) {
      const outcome = await addListSubscriber(
        list.id,
        { name: row.name, email: row.email, phone: null },
        "import",
        { revive: false, addedBy: claims.email },
      );
      if (outcome === "added") counts.added++;
      else if (outcome === "exists") counts.alreadyOnList++;
      else counts.previouslyUnsubscribed++;
    }
    added += counts.added;
    alreadyOnList += counts.alreadyOnList;
    previouslyUnsubscribed += counts.previouslyUnsubscribed;
    audiences.push({ listId: list.id, listName: list.name, ...counts });
  }
  try {
    await recordAudit({
      actor: claims.email,
      action: "subscribers.imported",
      entity: "subscriber_list",
      entityId: lists[0].id,
      data: {
        lists: lists.map((l) => l.slug),
        attestation: true,
        rows: parsed.data.rows.length,
        added,
        alreadyOnList,
        previouslyUnsubscribed,
      },
    });
  } catch (err) {
    console.error("import audit failed:", err instanceof Error ? err.message : err);
  }
  return res.status(200).json({ added, alreadyOnList, previouslyUnsubscribed, audiences });
}
```

- [ ] **Step 3: Add the route lines**

```ts
adminRouter.post("/api/admin/subscriber-list-import/preview", postAdminListImportPreviewMulti);
adminRouter.post("/api/admin/subscriber-list-import", postAdminListImportMulti);
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.ts
git commit -m "[TASK-282] Endpoints: preview and import a spreadsheet into several audiences"
```

---

### Task A5: BDD for the new endpoints

**Files:**
- Modify: `features/newsletter.feature`

- [ ] **Step 1: Add the scenarios**

```gherkin
  # TASK-282: one action, several audiences.
  Scenario: A volunteer adds one person to two audiences at once
    Given I am signed in to the admin as an editor
    When I add "isla.beattie@example.com" to the "Volunteers" and "Business supporters" audiences
    Then the response status should be 201
    And the response should say they were added to 2 audiences

  Scenario: Adding to no audience is refused rather than silently doing nothing
    Given I am signed in to the admin as an editor
    When I add "isla.beattie@example.com" to no audiences
    Then the response status should be 400

  Scenario: Donors refuses a manual add even inside a multi-audience request
    Given I am signed in to the admin as an editor
    When I add "isla.beattie@example.com" to the "Volunteers" and "Donors" audiences
    Then the response status should be 400
    And nobody should have been added to "Volunteers"
```

The last scenario is the one that matters: it proves the check-all-then-write ordering, so a
refusal cannot leave a half-finished add behind.

- [ ] **Step 2: Write the steps in `features/steps/newsletter.steps.js`**, following the existing
      `fetch(BASE_URL + ...)` pattern in that file.

- [ ] **Step 3: Run BDD**

Run: `npm run test:bdd`
Expected: all scenarios pass. (Needs a local server + DB; otherwise CI covers it.)

- [ ] **Step 4: Commit**

```bash
git add features/
git commit -m "[TASK-282] BDD: multi-audience add, empty selection, Donors refusal"
```

---

### Task A6: README, then ship PR A

- [ ] **Step 1:** Add a section to `README.md` under the newsletter documentation describing the
      three new endpoints, the check-all-then-write ordering, why it is not a transaction, and
      that no path sends a welcome email.
- [ ] **Step 2:** `npm run lint && npx vitest run`
- [ ] **Step 3:** `/ship` — it assigns TASK-282, opens the PR, watches to green, self-merges,
      watches the staging deploy, and stops at the production boundary.
- [ ] **Step 4:** Promote to production with the SHA `/ship` prints.

---

# PR B — TASK-283: the Newsletter Studio redesign

**Rule for every task below:** run `node -e` over `admin.html` before and after and diff the id
set. A missing id is a broken tab, and `app.js` will not tell you at build time.

```bash
node -e "const s=require('fs').readFileSync('admin.html','utf8');console.log([...s.matchAll(/\sid=\"([^\"]+)\"/g)].map(m=>m[1]).sort().join('\n'))" > /tmp/ids-before.txt
```

### Task B1: capture the id set as a test

**Files:**
- Create: `test/unit/newsletter-studio-ui.test.ts`

- [ ] **Step 1: Write the guard test** — assert every id `app.js` binds in the newsletter tab is
      present in `admin.html`, derived by scanning `app.js` for `el("…")` rather than hand-listing:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const app = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");

const idsInHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

// TASK-283: the redesign moves almost every element in the newsletter tab. app.js binds by id and
// fails silently at runtime when one goes missing, so the contract is pinned here instead: every
// id app.js reaches for must exist in the markup. This is what makes a large restructure safe.
describe("admin.html keeps every id app.js binds", () => {
  const bound = [...new Set([...app.matchAll(/\bel\("([A-Za-z][\w-]*)"\)/g)].map((m) => m[1]))];

  it("finds a meaningful number of bindings to check", () => {
    expect(bound.length).toBeGreaterThan(80);
  });

  it.each(bound)("admin.html still has #%s", (id) => {
    expect(idsInHtml.has(id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it against the CURRENT markup**

Run: `npx vitest run test/unit/newsletter-studio-ui.test.ts`
Expected: PASS. If any id fails now, `el()` is being called with a non-newsletter id built
dynamically — narrow the regex to exclude it and note why, rather than weakening the assertion.

- [ ] **Step 3: Commit**

```bash
git add test/unit/newsletter-studio-ui.test.ts
git commit -m "[TASK-283] Pin every element id app.js binds, before restructuring"
```

### Task B2: destinations replace the four-step rail

**Files:** `admin.html`, `assets/css/admin.css`, `assets/js/admin/app.js`

- [ ] Replace `.nl-steps` (admin.html:281-285) with a three-button `.nl-dests` rail —
      `nlDestOverview`, `nlDestPeople`, `nlDestArchive`. **Keep** `#nlSteps` in the DOM as a
      hidden element if `app.js` binds it; check first.
- [ ] Panels: `#nlPanelAudience` becomes the People destination; `#nlPanelHistory` becomes the
      Archive destination; a new `#nlPanelOverview` is added. `#nlPanelWrite` and `#nlPanelSend`
      move inside the compose takeover (Task B4).
- [ ] Port `.dest`, `.tile`, `.stats`, `.act`, `.rate`, `.att`, `.pill` rules from the prototype
      into `assets/css/admin.css`, renamed to the `.nl-` prefix used by the file.
- [ ] Run `npx vitest run` — B1 and `newsletter-builder-ui` must both stay green.
- [ ] Commit.

### Task B3: the Overview destination

- [ ] Build the stat tiles, in-flight strip, recent-sends table, "worth a look" panel and audience
      snapshot, fed from the existing `GET /api/admin/newsletters` and `/subscriber-lists`.
- [ ] Row click opens the results detail (Task B5).
- [ ] Commit.

### Task B4: compose as a takeover

- [ ] Wrap `#nlPanelWrite` and `#nlPanelSend` in `#nlCompose`, with a sticky step rail
      (Write · Who · Send) and a sticky footer action bar.
- [ ] Step 2 "Who" hosts the existing `#sendListPick` and `#sendAudienceNote`, plus the reach
      panel showing on-list / unsubscribed / blocked.
- [ ] Step 3 "Send" hosts the existing `#sendScheduleWrap`, `#sendRollout`, `#sendProgress`,
      `#newsletterSend` and the preflight results.
- [ ] `newsletter-builder-ui.test.ts` must stay green — it drives the palette and canvas directly.
- [ ] Commit.

### Task B5: results detail

- [ ] A `#nlPanelResults` destination rendering the existing
      `GET /api/admin/newsletters/:id/stats` into the five tiles, plus who/when/audience and the
      click breakdown. Replaces `#nlStats` living inside the Write panel — keep the `#nlStats`
      and `#nlStatsGrid` ids, relocated.
- [ ] Commit.

### Task B6: the multi-audience tick lists

- [ ] Replace `#amList` and `#importListPick` `<select>`s with tick lists. **Keep both ids** on a
      hidden input carrying the first selected id, so any code path still reading them works.
- [ ] Post to the PR-A endpoints. Button text counts the selection.
- [ ] Changing the ticks after previewing invalidates the preview and disables the commit button —
      this is the multi-audience version of the TASK-271 bug where a sheet previewed against one
      audience could be committed into another.
- [ ] Commit.

### Task B7: README, then ship PR B

- [ ] Document the three destinations, the compose takeover, and the id-set guard test in
      `README.md`.
- [ ] `npm run lint && npx vitest run`
- [ ] `/ship`, then promote to production.

---

## Self-review

- **Spec coverage:** three destinations (B2, B3, B5), compose takeover (B4), multi-audience add
  (A1, A3, B6), multi-audience import (A4, B6), no-welcome guarantee (A2). All covered.
- **Type consistency:** `TargetOutcome` / `FoldedOutcomes` defined in A1 are the exact names used
  in A3 and A4. `parseTargetListIds` and `foldOutcomes` match across all three.
- **Known gap:** the prototype's per-hour delivery chart (results detail) is drawn from data the
  system does not store per-hour today. B5 ships the five tiles and the click breakdown; the chart
  waits until send-queue timestamps are aggregated. Do not fake it.
