# My Story — Page + Guided Form (Task A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public `/my-story` page with a warm, guided 3-step story-submission form (frontend only — the form submit is a preview stub until Task B wires `POST /api/my-story`).

**Architecture:** A static `my-story.html` served through the existing `_redirects` clean-URL router, styled with the shared token-only CSS, and progressively enhanced by a new `initStorySteps` controller in `assets/js/main.js`. The stepper reuses the donate page's existing `.give-progress` / `.give-step` / `slide-in` chrome, so it adds almost no new CSS. Without JS the three steps render as one scrollable form that still validates natively on submit.

**Tech Stack:** Static HTML + vanilla JS (IIFE with CommonJS test exports, jsdom), token-only CSS in `assets/css/styles.css`, Vitest (unit, `@vitest-environment jsdom`), Cucumber (BDD hitting `BASE_URL`). Full spec: [docs/superpowers/specs/2026-07-08-my-story-design.md](../specs/2026-07-08-my-story-design.md).

## Global Constraints

Copied verbatim from the spec + CLAUDE.md; every task below implicitly includes these.

- **Copy is dash-free** and uses "NBCC" (REQ-031): no `-`, `–`, `—` anywhere in visible copy (existing pages assert `.not.toMatch(/[–—-]/)`).
- **Token-only colours:** any new CSS must use `var(--…)` tokens — no `#hex`, no `rgb()/rgba()` (asserted per-page, e.g. `contact.test.ts`).
- **No `<img>` in content blocks; inline SVG icons carry `aria-hidden="true"`** (perf budget, golden rule 6 spirit).
- **Progressive enhancement:** the page works with no JS (golden rule / site convention). JS only enhances.
- **Clean URLs live in `_redirects`** (single source of truth) — `200` rewrite + `301!` canonicalisation, mirroring every existing page.
- **Every change is a green PR with tests** (golden rule 1 + 5): Vitest for logic/markup, Cucumber for the served page. Run `npm run lint && npm run build && npm run test:unit` before pushing.
- **Local environment has no Docker/Postgres**, so BDD (`npm run test:bdd`, needs the server + DB) **cannot run locally** — it is verified by CI's `pr.yml`. The portable **local** gate for the clean URL is the existing static `test/unit/clean-urls.test.ts` (parses `_redirects`, no server). Extend its `URL_MAP` for `/my-story`; keep the feature files correct for CI.
- **README.md updated in the same PR** (golden rule 7).
- **Branch `task-<key>-<slug>`, PR title `[TASK-NNN]`, squash-merge** — number assigned by the board at claim time.
- **Identifier consent opt-ins default OFF** (data minimisation). Email/phone labelled "never published".

---

## File Structure

- **Create:** `my-story.html` (repo root) — the page: shell (nav/footer/skip-link), SEO/OG/canonical, intro, and the 3-step form markup.
- **Modify:** `_redirects` — add the `/my-story` 200 rewrite + the `/my-story.html` 301! canonicalisation.
- **Modify:** `assets/js/main.js` — add `initStorySteps(doc, win)` (stepping, progress, conditional reveals, validation, preview-submit); export it and boot it.
- **Modify:** `assets/css/styles.css` — add a `MY STORY PAGE` token-only block for the few story-specific bits (consent choice cards, the reveal groups) on top of the reused `.give-*` chrome.
- **Modify:** footer "Explore" list on every marketing page so the page is reachable (exact file list built in Task A5).
- **Modify:** `README.md` — document the new route.
- **Create test:** `test/unit/my-story.test.ts` — markup/copy/accessibility guards + `initStorySteps` jsdom behaviour.
- **Create test:** `features/my-story.feature` — page renders at `/my-story`; canonical redirect. (Reuses shared steps in `health.steps.js` / `site.steps.js`.)
- **Modify test:** `features/site.feature` — add `/my-story` to the clean-URL + canonicalisation Examples.

Naming locked so later tasks match:
- Form id: `storyForm`. Steps root: `[data-story-steps]`. Status region: `#storyStatus`.
- Controller export: **`initStorySteps`**.
- Field `name`s (drive Task B's `POST /api/my-story` payload): `submitterRole`, `storyText`, `shortQuote`, `useScope`, `shareFirstName`, `shareTown`, `thirdPartyConsent`, `contactForMore`, `photoInterest`, `firstName`, `email`, `phone`, `ageBand`, `gender`, `town`, `recipientType`, `heardAbout`, `confirmOver16`. Honeypot field `name="website"` (hidden).

---

## Task A1: Page shell + intro + clean URL (reachable page)

**Files:**
- Create: `my-story.html`
- Modify: `_redirects` (after the `/privacy` line and the `/privacy.html` 301! line)
- Modify: `test/unit/clean-urls.test.ts` (add `/my-story` to `URL_MAP`) — the portable **local** gate
- Modify: `features/site.feature:10-21` (add clean-URL example) and `:29-38` (add canonicalisation example) — CI gate
- Create: `features/my-story.feature` — CI gate

**Interfaces:**
- Produces: the `/my-story` route (200 → `my-story.html`) and the `/my-story.html` → `/my-story` 301, consumed by every later task and by the footer links (A5).

- [ ] **Step 1: Write the failing local test (clean-urls.test.ts)**

Add to the `URL_MAP` array in `test/unit/clean-urls.test.ts` (this is the no-server gate that runs locally):
```ts
  { clean: "/my-story", file: "my-story.html", label: "Share your story" },
```
Also add the BDD examples (run in CI). In `features/site.feature` under "clean URLs serve the right page":
```
      | /my-story   | Share your story |
```
and under "raw .html paths canonicalise to the clean URL":
```
      | /my-story.html   | /my-story   |
```

- [ ] **Step 2: Run the local test to verify it fails**

Run: `npx vitest run test/unit/clean-urls.test.ts`
Expected: FAIL — no `_redirects` rule for `/my-story` and/or `my-story.html` missing / no `<title>` containing "Share your story". (BDD is not runnable locally — no Docker/Postgres — it is verified in CI.)

- [ ] **Step 3: Create `my-story.html` shell + intro**

Copy the `<head>`/nav/footer/skip-link shell from `contact.html` verbatim (same CSS/font preloads, `assets/js/main.js` defer), changing only:
- `<title>Share your story — Night Before Christmas Campaign</title>`
- `<meta name="description" …>` + OG/Twitter tags with the My Story message, `og:url`/canonical `https://nbcc.scot/my-story`.
- Nav: no `active` on existing links (My Story is not in the top nav).
- `<main>` intro mirrors `.contact-intro` structure (`.page-top`, `.intro-hero`, `.eyebrow` = "Your story", `<h1 id="story-heading">Share your story</h1>`, `.rule`, `.lede`). H1 must contain the literal `Share your story` (the BDD marker). Intro copy in the gentle, control-forward voice; dash-free; mentions anonymity + "you are always in control of how it is used".

```html
<main class="site-main" id="main" tabindex="-1">
  <section class="page-top story-intro" aria-labelledby="story-heading">
    <div class="wrap">
      <div class="intro-hero">
        <span class="eyebrow">Your story</span>
        <h1 id="story-heading">Share your story</h1>
        <div class="rule"><i></i></div>
        <p class="lede">Every story told casts a little more light on the work of NBCC. Share whatever feels right for you, a few lines or a longer reflection. You can stay anonymous, and you are always in control of how your words are used.</p>
      </div>
    </div>
  </section>
  <section class="section flush-top" aria-label="Share your story">
    <div class="wrap">
      <div class="page-sections" data-region="sections">
        <!-- form added in Task A2 -->
      </div>
    </div>
  </section>
</main>
```

- [ ] **Step 4: Add the clean-URL rules to `_redirects`**

```
/my-story      /my-story.html    200
```
and in the canonicalisation block:
```
/my-story.html    /my-story          301!
```

- [ ] **Step 5: Create `features/my-story.feature`**

```gherkin
Feature: My Story page
  The service serves the public story-sharing page at its clean URL.

  Scenario: the My Story page is served at its clean URL
    When I GET "/my-story"
    Then the response status should be 200
    And the response body should contain "Share your story"

  Scenario: the raw .html path canonicalises to the clean URL
    When I GET "/my-story.html" without following redirects
    Then the response status should be 301
    And the response should redirect to "/my-story"
```

- [ ] **Step 6: Run the local test to verify it passes**

Run: `npx vitest run test/unit/clean-urls.test.ts`
Expected: PASS — the `/my-story` rule + page + title are all present. (BDD `features/my-story.feature` + `features/site.feature` are verified by CI's `pr.yml`, which runs against a real Postgres + server.)

- [ ] **Step 7: Commit**

```bash
git add my-story.html _redirects features/my-story.feature features/site.feature
git commit -m "[TASK-NNN] My Story: page shell, intro and clean URL (REQ-NNN)"
```

---

## Task A2: The 3-step form markup

**Files:**
- Modify: `my-story.html` (fill the `.page-sections` region with the form)
- Create: `test/unit/my-story.test.ts` (markup + accessibility + copy guards)

**Interfaces:**
- Consumes: the page shell from A1.
- Produces: `#storyForm` inside `[data-story-steps]` with three `.give-step[data-step="1..3"]`, a `.give-progress` list, `[data-story-next]`/`[data-story-prev]`/`[data-story-submit]` buttons, `[data-err="1..3"]`, `#storyStatus[aria-live="polite"]`, the honeypot, and every named field. Consumed by A4 (controller) and Task B (payload names).

- [ ] **Step 1: Write the failing markup test**

Create `test/unit/my-story.test.ts` (mirror `contact.test.ts` header + jsdom parse):
```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(resolve(ROOT, "my-story.html"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("my story page shell (REQ-NNN)", () => {
  it("has a centred intro whose H1 is 'Share your story'", () => {
    const intro = doc.querySelector("section.story-intro");
    expect(intro).not.toBeNull();
    expect(norm(intro?.querySelector("h1")?.textContent)).toBe("Share your story");
    expect(intro?.querySelector(".rule")).not.toBeNull();
  });
  it("writes the intro dash-free and names NBCC (REQ-031)", () => {
    const intro = norm(doc.querySelector("section.story-intro")?.textContent);
    expect(intro).toContain("NBCC");
    expect(intro).not.toMatch(/[–—-]/);
  });
});

describe("my story form structure (REQ-NNN)", () => {
  const form = doc.querySelector("#storyForm");
  const steps = [...(doc.querySelectorAll("[data-story-steps] .give-step") ?? [])];
  const field = (n: string) => form?.querySelector(`[name="${n}"]`);

  it("is a 3-step guided form with a progress list and a polite status region", () => {
    expect(form).not.toBeNull();
    expect(steps).toHaveLength(3);
    expect(doc.querySelector("[data-story-steps] .give-progress")).not.toBeNull();
    expect(doc.querySelector("#storyStatus")?.getAttribute("aria-live")).toBe("polite");
  });
  it("step 1 has the required role choice and required story textarea", () => {
    expect(field("submitterRole")).not.toBeNull();
    const story = field("storyText");
    expect(story?.tagName).toBe("TEXTAREA");
    expect(story?.hasAttribute("required")).toBe(true);
  });
  it("step 2 has the required use-scope choice and default-OFF identifier opt-ins", () => {
    expect(form?.querySelector('[name="useScope"][required]')).not.toBeNull();
    const first = field("shareFirstName") as HTMLInputElement | null;
    const town = field("shareTown") as HTMLInputElement | null;
    expect(first?.getAttribute("type")).toBe("checkbox");
    expect(first?.hasAttribute("checked")).toBe(false);
    expect(town?.hasAttribute("checked")).toBe(false);
  });
  it("step 3 fields are optional except the final confirm; 'how did you hear' is optional", () => {
    for (const n of ["firstName", "email", "phone", "ageBand", "gender", "town", "recipientType", "heardAbout"]) {
      expect(field(n), `#${n} present`).not.toBeNull();
      expect(field(n)?.hasAttribute("required"), `${n} optional`).toBe(false);
    }
    expect((field("confirmOver16") as HTMLInputElement)?.hasAttribute("required")).toBe(true);
  });
  it("has a hidden honeypot field named website", () => {
    const hp = field("website") as HTMLInputElement | null;
    expect(hp).not.toBeNull();
    expect(hp?.closest("[hidden], [aria-hidden='true']") || hp?.hasAttribute("hidden")).toBeTruthy();
  });
  it("writes the retention and withdrawal notice", () => {
    const text = norm(form?.textContent);
    expect(text.toLowerCase()).toContain("archive");
    expect(text.toLowerCase()).toContain("remove");
  });
  it("keeps the form copy dash-free (REQ-031)", () => {
    expect(norm(form?.textContent)).not.toMatch(/[–—-]/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/my-story.test.ts`
Expected: FAIL — `#storyForm` is null (form not yet added).

- [ ] **Step 3: Add the form markup**

Inside the `.page-sections` region in `my-story.html`, add `#storyForm` with `data-story-steps`, mirroring the donate wizard's structure (`.give-main`/`.give-progress`/`.give-steps`/`.give-step[data-step]`/`.give-field`/`.give-step-err[data-err]`/`.give-nav`). Concretely:
- `<ol class="give-progress" aria-hidden="true">` with 3 `<li data-pstep="1|2|3">` (labels: "Your story", "How we can use it", "About you").
- **Step 1** (`data-step="1"`): a required radio group `name="submitterRole"` (values `supported`, `family_carer`, `volunteer`, `professional_partner`, `supporter_donor`, `other`); required `<textarea name="storyText" required>` with `.give-field-help` prompts; optional `<input name="shortQuote">`; the safeguarding note. `.give-nav` with only `[data-story-next]`.
- **Step 2** (`data-step="2" hidden`): required radio group `name="useScope"` (`public`, `internal_only`) with `required` on the inputs; a reveal container `[data-reveal="public"]` holding the two default-off checkboxes `shareFirstName`, `shareTown`; a reveal container `[data-reveal="professional"]` holding the `thirdPartyConsent` checkbox; optional `contactForMore` + `photoInterest` checkboxes; the static retention/withdrawal `.give-field-help` notice. `.give-nav` with `[data-story-prev]` + `[data-story-next]`.
- **Step 3** (`data-step="3" hidden`): optional inputs `firstName`, `email` (type email), `phone` (type tel), radio group `ageBand` (`16_24`/`25_44`/`45_64`/`65_plus`), `gender` text, `town` text, radio group `recipientType` (`child`/`young_person`/`vulnerable_adult`), `heardAbout` text (optional); the required `confirmOver16` checkbox with combined confirm copy. `.give-nav` with `[data-story-prev]` + `[data-story-submit]`.
- Before `</form>`: the honeypot `<div hidden aria-hidden="true"><label>Leave blank<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` and `<p class="form-status" id="storyStatus" role="status" aria-live="polite"></p>` and `<p class="give-step-err" data-err="1|2|3">` messages inside each step.

(Full literal markup is long; follow the donate wizard `donate.html:79-270` for exact class usage and the field list above for names/requiredness.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/my-story.test.ts`
Expected: PASS — all structure/copy/accessibility assertions green.

- [ ] **Step 5: Commit**

```bash
git add my-story.html test/unit/my-story.test.ts
git commit -m "[TASK-NNN] My Story: 3-step form markup with consent + safeguarding fields (REQ-NNN)"
```

---

## Task A3: Story-specific CSS (token-only)

**Files:**
- Modify: `assets/css/styles.css` (new `MY STORY PAGE` block)
- Modify: `test/unit/my-story.test.ts` (add a token-only CSS guard)

**Interfaces:**
- Consumes: reused `.give-*` chrome (already styled). Produces: styling for `.story-intro`, the consent choice, and `[data-reveal]` groups.

- [ ] **Step 1: Add the failing CSS guard test**

Append to `test/unit/my-story.test.ts`:
```ts
import { readFileSync as read2 } from "node:fs";
describe("my story CSS is token-only (REQ-NNN)", () => {
  const css = read2(resolve(ROOT, "assets/css/styles.css"), "utf8");
  it("declares a MY STORY PAGE block", () => {
    expect(css).toMatch(/MY STORY PAGE/);
  });
  it("uses no raw hex or rgb in the story block", () => {
    const block = (css.split("MY STORY PAGE")[1] || "").split("/*")[0];
    expect(block.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(block.match(/\brgba?\(/gi) ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/my-story.test.ts`
Expected: FAIL — no `MY STORY PAGE` block yet.

- [ ] **Step 3: Add the token-only CSS block**

Append a `/* ===== MY STORY PAGE (REQ-NNN) ===== */` block using only `var(--…)` tokens: style `[data-reveal][hidden]{display:none}`, the consent choice cards (reuse `.give-field` where possible), and any `.story-intro` tweak. Keep it minimal — the stepper chrome is inherited.

- [ ] **Step 4: Run to verify it passes + full unit run**

Run: `npx vitest run test/unit/my-story.test.ts && npm run lint`
Expected: PASS + clean lint.

- [ ] **Step 5: Commit**

```bash
git add assets/css/styles.css test/unit/my-story.test.ts
git commit -m "[TASK-NNN] My Story: token-only page styles (REQ-NNN)"
```

---

## Task A4: `initStorySteps` controller (progressive enhancement)

**Files:**
- Modify: `assets/js/main.js` (add `initStorySteps`, export it, boot it)
- Modify: `test/unit/my-story.test.ts` (jsdom behaviour block)

**Interfaces:**
- Consumes: `#storyForm`, `[data-story-steps]`, the field names, `#storyStatus` from A2.
- Produces: `initStorySteps(doc, win)` exported from `main.js`. Preview behaviour: on a valid final submit it shows a success message in `#storyStatus` and (in a real browser) best-effort `POST /api/my-story` — mirroring `initContactForm`'s `deliver()` (endpoint arrives in Task B; absent fetch = success-only preview).

- [ ] **Step 1: Write the failing behaviour tests**

Append to `test/unit/my-story.test.ts`:
```ts
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);

describe("my story stepping + validation (jsdom)", () => {
  const { initStorySteps } = require2(resolve(ROOT, "assets/js/main.js"));
  const formHtml = doc.querySelector("[data-story-steps]")?.outerHTML ?? "";
  const setVal = (n: string, v: string) => {
    (document.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLTextAreaElement).value = v;
  };
  const check = (n: string) => { (document.querySelector(`[name="${n}"]`) as HTMLInputElement).checked = true; };
  const clickNext = () => (document.querySelector("[data-story-next]") as HTMLButtonElement)?.click();
  const visibleStep = () =>
    [...document.querySelectorAll(".give-step")].find((s) => !(s as HTMLElement).hidden)?.getAttribute("data-step");

  beforeEach(() => {
    document.body.innerHTML = `<main>${formHtml}</main>`;
    (window as unknown as { fetch?: unknown }).fetch = undefined;
    initStorySteps(document, window);
  });

  it("exports initStorySteps", () => {
    expect(typeof initStorySteps).toBe("function");
  });
  it("starts on step 1 and blocks advancing until required fields are filled", () => {
    expect(visibleStep()).toBe("1");
    clickNext();
    expect(visibleStep()).toBe("1"); // still, story + role missing
    const err = document.querySelector('[data-err="1"]');
    expect(err?.classList.contains("show")).toBe(true);
  });
  it("advances to step 2 once role and story are provided", () => {
    check("submitterRole"); // first radio
    setVal("storyText", "The Red Bag brought my daughter such comfort.");
    clickNext();
    expect(visibleStep()).toBe("2");
  });
  it("reveals the public identifier opt-ins only when 'public' is chosen", () => {
    check("submitterRole");
    setVal("storyText", "A lovely moment.");
    clickNext();
    const publicRadio = document.querySelector('[name="useScope"][value="public"]') as HTMLInputElement;
    publicRadio.checked = true;
    publicRadio.dispatchEvent(new Event("change", { bubbles: true }));
    const reveal = document.querySelector('[data-reveal="public"]') as HTMLElement;
    expect(reveal.hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/my-story.test.ts`
Expected: FAIL — `initStorySteps is not a function`.

- [ ] **Step 3: Implement `initStorySteps`**

Add to `main.js` (before the export block), mirroring `initGiveSteps` (`go`, `validate`, next/prev, `.show` errors, reduced-motion, `slide-in`) but generalised: no tier selection. Add (a) conditional reveals: on `useScope` change toggle `[data-reveal="public"]` `hidden`; on `submitterRole` change toggle `[data-reveal="professional"]` for `professional_partner`; (b) honeypot check (`website` non-empty → silently drop, no submit); (c) final submit → `validate(step3)`; on success set `#storyStatus` to a warm "Thank you, your story becomes part of ours." `is-success` message, `form.reset()`, and best-effort `deliver()` to `/api/my-story` guarded by `typeof win.fetch === "function"` (mirror `initContactForm`).
```js
function initStorySteps(doc, win) {
  var root = doc.querySelector("[data-story-steps]");
  if (!root) return;
  // …mirror initGiveSteps go()/validate()/next()/prev(); add reveals + honeypot + submit…
}
```

- [ ] **Step 4: Export and boot it**

In the `module.exports` object add `initStorySteps,`; in the `else` boot branch add `initStorySteps(document, window);`.

- [ ] **Step 5: Run to verify it passes + full suite**

Run: `npx vitest run test/unit/my-story.test.ts && npm run test:unit && npm run lint && npm run build`
Expected: PASS across the board (new + existing 1296 tests), clean lint, clean build.

- [ ] **Step 6: Commit**

```bash
git add assets/js/main.js test/unit/my-story.test.ts
git commit -m "[TASK-NNN] My Story: guided-step controller with consent reveals and preview submit (REQ-NNN)"
```

---

## Task A5: Reachability (footer link) + README

**Files:**
- Modify: footer "Explore" list on each marketing page (build the exact list with `grep -l 'foot-col' *.html`).
- Modify: `README.md` (routes/pages section).
- Modify: `test/unit/my-story.test.ts` (assert the page's own footer links to nothing broken; footer-consistency is covered by the existing footer test — update it if it enumerates the link set).

**Interfaces:** consumes the `/my-story` route (A1). Produces: a discoverable link.

- [ ] **Step 1: Check the footer-consistency test**

Run: `npx vitest run test/unit -t footer` and read `test/unit/*footer*`/`nav.test.ts` to see whether the footer link set is enumerated (if so it will fail when a link is added, telling you exactly which pages to update).

- [ ] **Step 2: Add the footer "Explore" link on each page**

In every page's `<footer>` `.foot-col` "Explore" `<ul>`, add `<li><a href="/my-story">Share your story</a></li>`. Keep the list order consistent across pages.

- [ ] **Step 3: Update README**

Add `/my-story` to the routes/pages list and note it is the public story-submission page (form posts to `/api/my-story`, wired in the storage task).

- [ ] **Step 4: Run the full suite**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: PASS — footer test green on all pages, my-story tests green.

- [ ] **Step 5: Commit**

```bash
git add *.html README.md test/unit/my-story.test.ts
git commit -m "[TASK-NNN] My Story: link from footer and document the route (REQ-NNN)"
```

---

## PR + verification (golden rule 1, PR workflow)

- [ ] Run `npm run lint && npm run build && npm run test:unit` — all green.
- [ ] Bring up the server + DB and run BDD: `features/my-story.feature` + `features/site.feature` green.
- [ ] Open the PR (`[TASK-NNN]` title), watch `pr.yml` to green, squash-merge with `--delete-branch`.
- [ ] Use `superpowers:verification-before-completion` before claiming done.

## Design-skill pass (repo UI rule)

Before finalising A2–A3 markup/CSS, run the page through the design skills per CLAUDE.md "UI and design work": `impeccable` (anti-pattern audit) + a style skill (`high-end-visual-design` or `minimalist-ui` to match the existing brand), then `polish` + `audit`. Fold fixes back into `my-story.html` / the CSS block and keep the unit tests green.

---

## Self-review notes (author)

- **Spec coverage:** Step-1 role ✓ (A2), story/quote ✓ (A2), Step-2 scope + default-off opt-ins + professional confirm + contact-for-more + photo-interest + retention notice ✓ (A2/A4 reveal), Step-3 optional fields incl. kept `gender` and demoted `heardAbout` ✓ (A2), final combined confirm ✓ (A2), honeypot/spam-guard groundwork ✓ (A2/A4), progressive enhancement ✓ (A4 + no-JS fallback), clean URL ✓ (A1), reachability ✓ (A5). Storage (`POST /api/my-story`, `stories` table) and the admin tab are **Tasks B and C** — deliberately out of this plan; A4's submit is a preview stub against the future endpoint.
- **Type/name consistency:** field `name`s, `#storyForm`, `[data-story-steps]`, `[data-story-next/prev/submit]`, `[data-reveal="public"|"professional"]`, `#storyStatus`, and `initStorySteps` are used identically across A2/A4 and match the spec's data model column intents.
- **No placeholders:** every code step shows real test or markup; the one long literal (full form HTML, A2 Step 3) is bounded by the exact field list + the donate-wizard reference rather than inlined in full.
