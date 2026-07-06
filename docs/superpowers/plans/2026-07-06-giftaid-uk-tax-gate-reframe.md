# Gift Aid UK-tax-gate reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reword the Channel Islands / Isle of Man Gift Aid handling so eligibility reads as "do you pay UK tax" (the existing HMRC liability statement) and the address/postcode reads as a matching detail — framing only, no logic change.

**Architecture:** Edit donor-facing copy in `gift-aid.html` + `donate.html` (checkbox text + a new UK-taxpayer note), reframe misleading code comments in `src/declarations/fields.ts` and `assets/js/main.js`. A new Vitest guard reads the static HTML and pins the new framing. No identifier/column rename, no validation change.

**Tech Stack:** Static HTML served by Express, vanilla `assets/js/main.js`, TypeScript, Vitest (unit), Cucumber (BDD).

## Global Constraints

- Behaviour unchanged: validation, persistence, HMRC claim output, and the `nonUk`/`non_uk` identifiers all stay. Framing only.
- Eligibility gate stays the verbatim HMRC statement (`src/declarations/wording.ts`); no new control.
- Reworded checkbox copy, verbatim:
  - Donor: `I have no UK postcode — for example, my home address is in the Channel Islands or Isle of Man.`
  - Partner: `This partner has no UK postcode — for example, a home address in the Channel Islands or Isle of Man.`
- UK-taxpayer note, verbatim: `Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you live — you can still Gift Aid from an overseas address if you are a UK taxpayer.`
- Old eligibility framing string `I live outside the UK (Channel Islands or Isle of Man), so I have no UK postcode.` must not remain in any shipped page.
- Repo `autocrlf=true`: keep HTML edits CRLF-consistent.
- Do NOT edit `SPEC.md` (generated projection). One PR, `[TASK-127]` title, branch `task-127-giftaid-uk-tax-gate-reframe`. Lint + build + unit + BDD green before self-merge.

---

### Task 1: Reword the donor-facing copy + add the UK-taxpayer note

**Files:**
- Modify: `gift-aid.html`, `donate.html`
- Test: `test/unit/giftaid-uk-tax-framing.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: static HTML carrying the new framing (asserted by the guard).

- [ ] **Step 1: Write the failing guard test** `test/unit/giftaid-uk-tax-framing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-127 (REQ-043): Gift Aid eligibility is paying UK tax (the verbatim HMRC
// liability statement), NOT a residency/postcode flag. The overseas-address
// checkbox is a matching detail only. Guard the framing shown to donors.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const OLD_FRAMING =
  "I live outside the UK (Channel Islands or Isle of Man), so I have no UK postcode.";
const DONOR_CHECKBOX =
  "I have no UK postcode — for example, my home address is in the Channel Islands or Isle of Man.";
const PARTNER_CHECKBOX =
  "This partner has no UK postcode — for example, a home address in the Channel Islands or Isle of Man.";
const TAX_NOTE =
  "Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you live";

describe("Gift Aid UK-tax framing (TASK-127)", () => {
  for (const page of ["gift-aid.html", "donate.html"]) {
    it(`${page} drops the old residency-eligibility framing`, () => {
      expect(read(page)).not.toContain(OLD_FRAMING);
    });
    it(`${page} carries the UK-taxpayer eligibility note`, () => {
      expect(read(page)).toContain(TAX_NOTE);
    });
    it(`${page} uses the address-as-matching-detail donor checkbox`, () => {
      expect(read(page)).toContain(DONOR_CHECKBOX);
    });
  }

  it("donate.html reworic partner checkbox is address-only", () => {
    expect(read("donate.html")).toContain(PARTNER_CHECKBOX);
  });
});
```

  (Fix the typo before saving: the last `it` title should read "donate.html partner checkbox is address-only".)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- giftaid-uk-tax-framing`
Expected: FAIL — new strings absent, old framing present.

- [ ] **Step 3: Implement the copy edits.**

  In `gift-aid.html`, replace the checkbox span (currently line ~93):

```html
                <span class="give-check-text">I have no UK postcode — for example, my home address is in the Channel Islands or Isle of Man.</span>
```

  and add the note immediately after the `</label>` that closes the checkbox (before `</fieldset>`):

```html
              <p class="give-declaration-help">Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you live — you can still Gift Aid from an overseas address if you are a UK taxpayer.</p>
```

  In `donate.html`, replace the donor checkbox span (line ~323):

```html
<span class="give-check-text">I have no UK postcode — for example, my home address is in the Channel Islands or Isle of Man.</span>
```

  replace the partner checkbox span (line ~363):

```html
<span class="give-check-text">This partner has no UK postcode — for example, a home address in the Channel Islands or Isle of Man.</span>
```

  and add the same note after the donor checkbox `</label>` in the give widget's declaration fieldset (match `donate.html`'s existing indentation/formatting):

```html
<p class="give-declaration-help">Gift Aid depends on paying UK Income Tax or Capital Gains Tax, not on where you live — you can still Gift Aid from an overseas address if you are a UK taxpayer.</p>
```

  Keep the checkbox `input` (`id/name="nonUk"`, `data-field="nonUk"`) unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- giftaid-uk-tax-framing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gift-aid.html donate.html test/unit/giftaid-uk-tax-framing.test.ts
git commit -m "[TASK-127] Reframe Gift Aid checkbox + add UK-taxpayer eligibility note"
```

---

### Task 2: Reframe the misleading code comments

**Files:**
- Modify: `src/declarations/fields.ts`, `assets/js/main.js`, `test/unit/declaration-capture.test.ts` (comment only)

**Interfaces:**
- Consumes / Produces: nothing (comment-only; no code behaviour changes).

- [ ] **Step 1: Edit `src/declarations/fields.ts` comments.** Change the header note (lines ~7-8) from the "non-UK flag … that omits the postcode" wording to:

```ts
// and a UK postcode — with an overseas-ADDRESS flag (no UK postcode, e.g. Channel
// Islands / Isle of Man) that omits the postcode. That flag is only an HMRC matching
// detail; Gift Aid ELIGIBILITY is the UK-taxpayer liability declaration (wording.ts),
// not this flag. No pool/config/clock, so it is unit-tested DB-free like
```

  Update the two refinement comments (lines ~52-58) to describe the flag as "an overseas-address declaration (no UK postcode)" rather than "non-UK declaration", and the row-builder note (lines ~89-91) to "an overseas-address declaration stores no postcode (REQ-043)". Keep all code identical.

- [ ] **Step 2: Edit `assets/js/main.js` comment (line ~257).** Replace with:

```js
    // JS. This wires the overseas-address checkbox (a donor whose home address has no UK
    // postcode, e.g. Channel Islands / Isle of Man, so it hides, disables and un-requires
    // the postcode). This is only a matching detail — it does NOT affect Gift Aid
    // eligibility, which is the UK-taxpayer declaration the donor agrees to on submit — and
```

  Keep the function/variable names (`applyNonUk`, `nonUkBox`, etc.) unchanged.

- [ ] **Step 3: Edit `test/unit/declaration-capture.test.ts:11` comment** to describe an "overseas-address checkbox (no UK postcode, e.g. Channel Islands / Isle of Man)" instead of a "non-UK donor checkbox". Comment only.

- [ ] **Step 4: Verify nothing broke**

Run: `npm run lint && npm run test:unit -- declaration-capture declaration-fields`
Expected: PASS (comment-only edits; behaviour unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/declarations/fields.ts assets/js/main.js test/unit/declaration-capture.test.ts
git commit -m "[TASK-127] Reframe overseas-address comments: matching detail, not the eligibility gate"
```

---

### Task 3: Full green — README, guards, BDD, PR

**Files:**
- Modify: `README.md` (only if it repeats the old framing)
- Verify only: full unit suite, `features/*.feature`

- [ ] **Step 1: Check README for the old framing.**

Run: `grep -n "non-UK\|Channel Island\|Isle of Man\|live outside" README.md`
If any line frames the flag as an eligibility/residency route, reword it to "overseas-address (no UK postcode) matching detail; eligibility is the UK-taxpayer declaration". If none, skip the README edit.

- [ ] **Step 2: Full unit suite**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green.

- [ ] **Step 3: Full BDD locally (or rely on CI).**

`features/donation-journey.feature` exercises the declaration flow. Run `npm run test:bdd` against a local app if a declaration scenario asserts copy; otherwise CI `pr.yml` runs it on a fresh DB. Expected: green.

- [ ] **Step 4: Commit any README change, push, open PR**

```bash
git add README.md
git commit -m "[TASK-127] Docs: overseas address is a matching detail, not the Gift Aid gate"
git push -u origin task-127-giftaid-uk-tax-gate-reframe
gh pr create --title "[TASK-127] Reframe Gift Aid eligibility around UK tax, not a postcode flag" --body "..."
```

- [ ] **Step 5: Drive to green + squash-merge**

`gh pr checks <pr> --watch`; green ⇒ `gh pr merge <pr> --squash --delete-branch`. Red ⇒ fix + repeat.

---

## Self-Review

- **Spec coverage:** checkbox copy (Task 1) ✓; UK-taxpayer note (Task 1) ✓; comment reframe fields.ts + main.js (Task 2) ✓; identifiers unchanged ✓; guard test + no-old-framing (Task 1) ✓; SPEC.md untouched (noted, no task) ✓; README (Task 3) ✓.
- **Placeholders:** PR `--body "..."` filled at creation from the spec summary. Note the deliberate typo-fix instruction in Task 1 Step 1.
- **Type consistency:** no new identifiers introduced; all edits are copy/comments. `nonUk`/`non_uk` unchanged throughout.
