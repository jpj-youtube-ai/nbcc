# Canonical Charity-Registration Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put one exact, verbatim charity-registration statement in every page footer and every donor-facing receipt/thank-you letter, sourced from a single module.

**Architecture:** New `src/legal/registration.ts` holds the wording once (text + HTML forms). The four letter/receipt content builders import it and append it as their footer, replacing their variant identity lines. The nine static-page `.legal` strips are edited to the exact wording (OSCR link wrapped invisibly on the number). Tests updated first (TDD).

**Tech Stack:** TypeScript, Vitest (unit), Cucumber (BDD), static HTML pages served by Express.

## Global Constraints

- Exact mandated wording, verbatim (two lines):
  - `Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.`
  - `Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.`
- `CHARITY_NAME` = `Night Before Christmas Campaign`; `CHARITY_SHORT_NAME` = `NBCC`; `OSCR_NUMBER` = `SC047995`.
- OSCR register URL (verbatim): `https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995`.
- Never read `process.env` directly; new module is pure/DB-free/no-clock.
- Repo `autocrlf=true`: all HTML page edits must stay CRLF; the footer must remain **byte-identical** across the five core pages (`test/unit/footer.test.ts`).
- One PR, title starts `[TASK-126]`, branch `task-126-charity-registration-line`. Lint + build + unit + BDD green before self-merge. Update README in the same PR.

---

### Task 1: Single-source-of-truth module

**Files:**
- Create: `src/legal/registration.ts`
- Test: `test/unit/registration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CHARITY_NAME: string`, `CHARITY_SHORT_NAME: string`, `OSCR_NUMBER: string`
  - `OSCR_REGISTER_URL: string`
  - `REGISTRATION_LINES: readonly [string, string]`
  - `REGISTRATION_TEXT: string` (the two lines joined by `\n`)
  - `REGISTRATION_HTML: string` (`<p class="charity-registration">line1<br />line2</p>`, HTML-escaped content)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  CHARITY_NAME,
  CHARITY_SHORT_NAME,
  OSCR_NUMBER,
  OSCR_REGISTER_URL,
  REGISTRATION_LINES,
  REGISTRATION_TEXT,
  REGISTRATION_HTML,
} from "../../src/legal/registration";

const LINE1 =
  "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.";
const LINE2 =
  "Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.";

describe("charity registration (TASK-126)", () => {
  it("exposes the canonical identity constants", () => {
    expect(CHARITY_NAME).toBe("Night Before Christmas Campaign");
    expect(CHARITY_SHORT_NAME).toBe("NBCC");
    expect(OSCR_NUMBER).toBe("SC047995");
    expect(OSCR_REGISTER_URL).toContain("oscr.org.uk");
    expect(OSCR_REGISTER_URL).toContain("SC047995");
  });

  it("exposes the two exact mandated lines", () => {
    expect(REGISTRATION_LINES).toEqual([LINE1, LINE2]);
  });

  it("joins the lines for plain-text letters", () => {
    expect(REGISTRATION_TEXT).toBe(`${LINE1}\n${LINE2}`);
  });

  it("renders an HTML fragment carrying both lines", () => {
    expect(REGISTRATION_HTML).toContain(LINE1);
    expect(REGISTRATION_HTML).toContain(LINE2);
    expect(REGISTRATION_HTML).toContain("<br />");
    expect(REGISTRATION_HTML).toContain('class="charity-registration"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- registration`
Expected: FAIL — cannot find module `../../src/legal/registration`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/legal/registration.ts
// TASK-126: the single source of truth for NBCC's charity-registration statement.
// The exact, verbatim wording that must appear in every page footer and every
// donor-facing receipt / thank-you letter. Pure, DB-free, no clock — like
// src/declarations/wording.ts. All other modules import from here; none re-declare
// the wording.

export const CHARITY_NAME = "Night Before Christmas Campaign";
export const CHARITY_SHORT_NAME = "NBCC";
export const OSCR_NUMBER = "SC047995";

export const OSCR_REGISTER_URL =
  "https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995";

// The two exact mandated lines (verbatim — do not reword).
export const REGISTRATION_LINES: readonly [string, string] = [
  `${CHARITY_NAME}, known as ${CHARITY_SHORT_NAME}, is a Scottish Charitable Incorporated Organisation.`,
  `Scottish Charity Number ${OSCR_NUMBER}. Regulated by the Scottish Charity Regulator, OSCR.`,
];

// Plain-text form (letters / receipt text renderings).
export const REGISTRATION_TEXT = REGISTRATION_LINES.join("\n");

// HTML form (email / receipt html renderings). Content is static and known-safe
// (no user input), so no escaping needed here.
export const REGISTRATION_HTML =
  `<p class="charity-registration">${REGISTRATION_LINES[0]}<br />${REGISTRATION_LINES[1]}</p>`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- registration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/legal/registration.ts test/unit/registration.test.ts
git commit -m "[TASK-126] Add single source of truth for charity-registration wording"
```

---

### Task 2: Corporation Tax receipt + company refund notice carry the line

**Files:**
- Modify: `src/donors/receipt.ts`
- Test: `test/unit/corporation-tax-receipt.test.ts`

**Interfaces:**
- Consumes: `REGISTRATION_TEXT`, `REGISTRATION_HTML`, `CHARITY_NAME`, `CHARITY_SHORT_NAME`, `OSCR_NUMBER` from `src/legal/registration`.
- Produces: unchanged public API (`buildCorporationTaxReceipt`, `buildCompanyRefundNotice`, `classifyCompanyGift`, and the re-exported `OSCR_NUMBER`, `GENUINE_DONATION_STATEMENT`, `NO_GIFT_AID_STATEMENT`).

- [ ] **Step 1: Add the failing assertions** to `test/unit/corporation-tax-receipt.test.ts`. Inside `describe("buildCorporationTaxReceipt (REQ-053)")` add:

```ts
  it("carries the canonical charity-registration line (text + html)", () => {
    const receipt = buildCorporationTaxReceipt(input);
    expect(receipt.text).toContain(
      "known as NBCC, is a Scottish Charitable Incorporated Organisation.",
    );
    expect(receipt.text).toContain(
      "Regulated by the Scottish Charity Regulator, OSCR.",
    );
    expect(receipt.html).toContain('class="charity-registration"');
  });
```

And inside `describe("buildCompanyRefundNotice ...")` add:

```ts
  it("carries the canonical charity-registration line", () => {
    const notice = buildCompanyRefundNotice({ ...base, action: "void", refundedPence: 100000 });
    expect(notice.text).toContain("Regulated by the Scottish Charity Regulator, OSCR.");
    expect(notice.html).toContain('class="charity-registration"');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- corporation-tax-receipt`
Expected: FAIL — canonical line not present.

- [ ] **Step 3: Implement.** In `src/donors/receipt.ts`:

  1. Replace the local declarations of `CHARITY_NAME`, `CHARITY_SHORT_NAME`, `OSCR_NUMBER` with a re-export from the new module (keeps existing importers working):

```ts
import {
  CHARITY_NAME,
  CHARITY_SHORT_NAME,
  OSCR_NUMBER,
  REGISTRATION_TEXT,
  REGISTRATION_HTML,
} from "../legal/registration";

// Re-exported so existing importers (tests, callers) keep resolving these from here.
export { CHARITY_NAME, CHARITY_SHORT_NAME, OSCR_NUMBER };
```

  2. In `buildCorporationTaxReceipt`, replace the `Registered Scottish charity, OSCR number ${OSCR_NUMBER}` identity lines (in both `text` and `html`) and append the canonical block to the end of each rendering:

     - `text`: end the string with `\n\n${REGISTRATION_TEXT}\n`.
     - `html`: insert `${REGISTRATION_HTML}` as the last child before `</section>`.
     - Keep the `${CHARITY_NAME} (${CHARITY_SHORT_NAME})` heading line (it still names the charity); just drop the now-redundant `Registered Scottish charity, OSCR number …` line since the canonical block states the registration.

  3. Do the same in `buildCompanyRefundNotice` (drop the `Registered Scottish charity, OSCR number …` line, append `REGISTRATION_TEXT` / `REGISTRATION_HTML`).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- corporation-tax-receipt`
Expected: PASS (new assertions + all pre-existing ones — `NBCC`, `SC047995`, genuine-donation / no-Gift-Aid still present).

- [ ] **Step 5: Commit**

```bash
git add src/donors/receipt.ts test/unit/corporation-tax-receipt.test.ts
git commit -m "[TASK-126] CT receipt + company refund notice carry the registration line"
```

---

### Task 3: Donation-confirmation + refund-confirmation letters carry the line

**Files:**
- Modify: `src/donors/confirmation.ts`
- Test: `test/unit/` confirmation tests (the files importing `buildDonationConfirmation` / `buildRefundConfirmation` — confirm names with `git grep -l buildDonationConfirmation test/`)

**Interfaces:**
- Consumes: `REGISTRATION_TEXT`, `REGISTRATION_HTML`, `CHARITY_SHORT_NAME` from `src/legal/registration`.
- Produces: unchanged public API (`buildDonationConfirmation`, `buildRefundConfirmation`, re-exported `CHARITY_SHORT_NAME`).

- [ ] **Step 1: Add failing assertions** to the confirmation test file:

```ts
  it("carries the canonical charity-registration line", () => {
    const c = buildDonationConfirmation({
      fullName: "Ada", amountPence: 5000, currency: "GBP", giftAid: false, mode: "once",
    });
    expect(c.text).toContain("Regulated by the Scottish Charity Regulator, OSCR.");
    expect(c.html).toContain('class="charity-registration"');
  });
```

And for refunds (in the refund-confirmation test/describe):

```ts
  it("carries the canonical charity-registration line", () => {
    const c = buildRefundConfirmation({
      fullName: "Ada", refundedPence: 5000, currency: "GBP",
      refundDate: "2026-01-05T00:00:00Z", full: true,
    });
    expect(c.text).toContain("Regulated by the Scottish Charity Regulator, OSCR.");
    expect(c.html).toContain('class="charity-registration"');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- confirmation`
Expected: FAIL — canonical line absent.

- [ ] **Step 3: Implement.** In `src/donors/confirmation.ts`:

  1. Replace `export const CHARITY_SHORT_NAME = "NBCC";` with:

```ts
import { CHARITY_SHORT_NAME, REGISTRATION_TEXT, REGISTRATION_HTML } from "../legal/registration";
export { CHARITY_SHORT_NAME };
```

  2. In `buildDonationConfirmation`, append the block: after building `paragraphs`, set
     `const text = paragraphs.join("\n\n") + "\n\n" + REGISTRATION_TEXT + "\n";`
     and append `REGISTRATION_HTML` before `</section>` in `html`.

  3. In `buildRefundConfirmation`, likewise:
     `const text = line + "\n\n" + REGISTRATION_TEXT + "\n";`
     and append `REGISTRATION_HTML` before `</section>` in `html`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- confirmation`
Expected: PASS (new + all existing assertions — thanks line, Gift Aid line, manage/cancel still present).

- [ ] **Step 5: Commit**

```bash
git add src/donors/confirmation.ts test/unit/*confirmation*.test.ts
git commit -m "[TASK-126] Donor confirmation + refund letters carry the registration line"
```

---

### Task 4: Page footers show the exact line (all nine pages, byte-identical core five)

**Files:**
- Modify: `index.html`, `about.html`, `donate.html`, `contact.html`, `supporters.html`, `thank-you.html`, `portal.html`, `privacy.html`, `gift-aid.html`
- Test: `test/unit/footer.test.ts`

**Interfaces:**
- Consumes: nothing (static HTML).
- Produces: identical `.legal` strip markup across all pages.

- [ ] **Step 1: Update the failing test** `test/unit/footer.test.ts` — replace the legal-strip `it(...)` body with the exact-wording assertions:

```ts
  it("has a legal strip with the exact charity-registration wording and OSCR link", () => {
    expect(footer).toMatch(/class="legal"/);
    expect(footer).toContain(
      "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.",
    );
    expect(footer).toMatch(/Scottish Charity Number\s*<a[^>]*>SC047995<\/a>\.\s*Regulated by the Scottish Charity Regulator, OSCR\./);
    expect(footer).toMatch(/href="[^"]*oscr\.org\.uk[^"]*SC047995[^"]*"/i);
    expect(footer).not.toContain("&copy; 2026");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- footer`
Expected: FAIL — old `© 2026` markup still present, new wording absent.

- [ ] **Step 3: Implement.** In every one of the nine pages, replace the two `.legal` `<span>` lines with exactly (same indentation, CRLF line endings):

```html
          <span>Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.</span>
          <span>Scottish Charity Number <a href="https://www.oscr.org.uk/about-charities/search-the-register/charity-details?number=SC047995" target="_blank" rel="noopener">SC047995</a>. Regulated by the Scottish Charity Regulator, OSCR.</span>
```

  The surrounding `<div class="legal"><div class="wrap">…</div></div>` stays. The replacement string is identical in every file so the five core pages stay byte-identical. After editing, verify line endings are CRLF (`git diff --stat` should show only the two changed lines per file; if `Write`/`Edit` introduced LF, re-normalise with `unix2dos` or re-save).

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:unit -- footer`
Expected: PASS, including the byte-identical assertion across the five core pages.

- [ ] **Step 5: Commit**

```bash
git add index.html about.html donate.html contact.html supporters.html thank-you.html portal.html privacy.html gift-aid.html test/unit/footer.test.ts
git commit -m "[TASK-126] Page footers show the exact charity-registration line"
```

---

### Task 5: Full green — guards, BDD, README, PR

**Files:**
- Modify: `README.md` (footer/legal section note)
- Verify only: `test/unit/*` guards (accessibility, seo, copy-rules), `features/site.feature`

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green. If a guard (seo/copy-rules/accessibility) asserts on footer text, update it to the exact wording and re-run.

- [ ] **Step 2: Run full BDD locally**

Start the app (`npm run dev` on the local port) and run `npm run test:bdd` against it (see memory: page-text edits trip `site.feature` footer markers). If a marker checks the old `© 2026` / `Charity No.` text, update the `.feature` step to the new wording.
Expected: all scenarios pass.

- [ ] **Step 3: Update README**

In the README section describing the footer / pages, note that the canonical charity-registration line is sourced from `src/legal/registration.ts` and appears in every footer and every donor-facing receipt/letter.

- [ ] **Step 4: Commit + push + open PR**

```bash
git add README.md features
git commit -m "[TASK-126] Docs + BDD markers for the canonical registration line"
git push -u origin task-126-charity-registration-line
gh pr create --title "[TASK-126] Canonical charity-registration line on every page + receipt/letter" --body "..."
```

- [ ] **Step 5: Drive to green + squash-merge**

Run: `gh pr checks <pr> --watch`; on green `gh pr merge <pr> --squash --delete-branch`. Red ⇒ fix + repeat.

---

## Self-Review

- **Spec coverage:** module (Task 1) ✓; 4 builders (Tasks 2–3) ✓; 9 footers (Task 4) ✓; tests each task ✓; BDD + README + PR (Task 5) ✓. Out-of-scope notification emails explicitly not touched ✓.
- **Placeholders:** PR `--body "..."` filled at creation time from this plan's summary; no other placeholders.
- **Type consistency:** `REGISTRATION_TEXT` / `REGISTRATION_HTML` / `CHARITY_*` / `OSCR_NUMBER` names used identically across Tasks 1–3; re-exports keep existing importers resolving.
