# TASK-016 — Home hero section (REQ-010)

**Task:** build the Home hero in `index.html` only, mounting the existing systems
(buttons/card REQ-009, `.rule`/logo REQ-007, tokens, motion). Add a `HOME HERO`
CSS block. Other pages, nav, footer untouched.

## Markup (`index.html` `<main>`)

Replaces the placeholder `h1`+`.rule`+`<p>` (above the empty `.page-sections`):

- `<section class="hero">` (two-column grid) →
  - **content:** `<span class="eyebrow">Volunteer run Scottish charity</span>`;
    `<h1>No one should feel <em class="hero-emph">forgotten</em> on Christmas
    Eve</h1>`; `<div class="rule">` (brand-marks, under the heading); a `.lede`
    on the volunteer run, year round mission (NBCC, beneficiary phrasing); a
    `.hero-cta` with `<a class="btn btn-primary" href="/donate">Donate now</a>`
    and `<a class="btn btn-ghost" href="/about-us">Who we help</a>`.
  - **art:** the logo `<img src="/assets/img/nbcc-logo.png" alt="…" width="148"
    height="148" loading="lazy">` + a floating `<div class="card proof reveal">`
    reading **7,657 Red Bags Full of Joy delivered in 2025**.

Copy honours REQ-031 (no dashes: "volunteer run", "year round"; "NBCC";
beneficiary phrasing) and REQ-032 (meaningful `alt`, keyboard-focusable `<a>`
CTAs).

## CSS (`HOME HERO (REQ-010)` block)

Token-only. `.eyebrow` (`--fs-eyebrow`, uppercase, **`var(--crimson)`**),
`.hero` two-column grid → stacks ≤680px, `.hero h1` (`--fs-hero`), `.hero-emph`
(`var(--maroon)`, italic), `.lede` (`--fs-lede`), `.hero-cta` (flex), `.hero-art`
(relative; logo capped ~200px), `.proof`/`.proof-num`/`.proof-lbl` (floating,
static on mobile). Buttons, `.card`, `.rule`, `.reveal` and the hover-lift are
**reused** from existing blocks — not redefined.

### Forced deviations (flagged)

- **Eyebrow is crimson, not holly green** (the baseline used holly). The
  brand-colours contrast guard forbids `color: var(--holly)` on light surfaces and
  must stay green, so the eyebrow uses `var(--crimson)`.
- **`.hero-emph` italic is synthesised** — only Playfair 700 *normal* is
  self-hosted (TASK-010); the italic face is a later REQ-005/REQ-034 refinement.
- Hero logo reuses the 148px `nbcc-logo.png` (per the task), shown ≤~200px to stay
  crisp and within the perf budget (now referenced 3× on `index.html` → counted
  3× ≈ 36 KB; page transfer well under 150 KB). The hi-res hero asset is REQ-034.
- `.reveal` is applied only to the (secondary) proof card — the critical hero
  text/CTAs stay always-visible (above the fold; avoids hiding key content if JS
  is off).

## Testing

`test/unit/home-hero.test.ts` (`// @vitest-environment jsdom`, parse `index.html`
with `DOMParser`): eyebrow text; H1 with `forgotten` inside an `em`/`.hero-emph`;
`.btn-primary` → `/donate` "Donate now"; `.btn-ghost` "Who we help"; `.hero-art`
logo `<img>` with non-empty `alt` + width/height; `.proof` (a `.card`) reading
"7,657 Red Bags Full of Joy delivered in 2025".

Existing `perf-budget` (img width/height/lazy + transfer), `static-site`,
`seo-metadata`, `clean-urls`, `nav`, `footer`, `brand-marks` stay green.

README: "Home hero (REQ-010)" subsection.

## Files

- Edit: `index.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/home-hero.test.ts`, this spec.
