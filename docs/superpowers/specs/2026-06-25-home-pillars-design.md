# TASK-017 — Home four-pillars tinted band (REQ-011)

**Task:** add the four-pillars band to `index.html`'s `<main>`, after `.hero` and
before the kept empty `.page-sections`. Reuse existing systems only.

## Markup (`index.html`)

A `<section class="pillars" aria-label="What we do">` (accessible name without
inventing visible heading copy) containing a `.pillar-grid` of four
`<article class="card pillar reveal">`. Each pillar: an inline-SVG icon
(`aria-hidden="true"`, `stroke="currentColor"` — markup like the footer socials,
no `<img>`), an `<h2 class="pillar-title">`, and a `<p class="pillar-line">`.

Exact leaflet copy (REQ-031 — no dashes, beneficiary phrasing):

| Title | Line |
|---|---|
| Volunteer run | Powered by kindness, driven by community |
| South West Scotland | Supporting children, young people and vulnerable adults from Girvan to Largs |
| Red Bags Full of Joy | Thoughtful gifts. Dignity. Comfort. Moments of joy. |
| 7,657 delivered in 2025 | Real impact. Real children, young people and vulnerable adults. Real difference. |

The `.page-sections[data-region="sections"]` placeholder is **kept** (after the
pillars) so `home-hero.test.ts` stays green; later sections append after it.

## CSS (`HOME PILLARS (REQ-011)` block)

Token-only:

- `.pillars` — tinted band: `background: var(--holly-soft)`, `--radius-lg`,
  padding, vertical margin. A contained rounded panel within `.site-main`'s 1180
  cap (clean, no full-bleed hacks).
- `.pillar-grid` — `repeat(4, 1fr)`; → 2-col ≤900px; → 1-col ≤680px (the
  breakpoint used elsewhere).
- `.pillar` adds padding to the shared `.card` surface (`var(--card)`,
  `var(--line)`, `var(--shadow)`, `var(--radius)` — reused, hover-lift inherited
  from MOTION).
- `.pillar-icon { color: var(--crimson) }` (icons inherit via `currentColor`),
  `.pillar-title { font-size: var(--fs-lede) }` (Playfair crimson via the headings
  rule), `.pillar-line { font-size: var(--fs-body); color: var(--slate-soft) }`.

### Forced choice (flagged)

Icons and pillar titles use **crimson**, not holly green: the brand-colours
contrast guard forbids `color: var(--holly)` on light surfaces and must stay
green. The band tint is `--holly-soft` (a background, allowed).

## Testing

`test/unit/home-pillars.test.ts` (`// @vitest-environment jsdom`, parse
`index.html`): exactly four `.pillar`s; the four `.pillar-title`s and
`.pillar-line`s match the exact copy; every `.pillar-icon` is `aria-hidden`
(REQ-032) and there is no `<img>` in the band.

Existing `static-site`, `perf-budget`, `brand-colours`, `home-hero`,
`seo-metadata` (and nav/footer/BDD) stay green — one shared CSS, no new
files/fonts/img, no hex/rgb outside `:root`, hero + `page-sections` untouched.

README: "Home pillars (REQ-011)" subsection.

## Files

- Edit: `index.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/home-pillars.test.ts`, this spec.
