# TASK-018 — Home "why your donation matters" section (REQ-012)

**Task:** add the donation-matters section to `index.html`'s `<main>`, after
`.pillars` and before the kept empty `.page-sections`. Copy/layout from the
"Prototype NBCC website" (the uploaded `nbcc-preview.html`, section lines
428-445). Reuse existing systems only.

## Markup (`index.html`)

`<section class="why" aria-labelledby="why-heading">` with a `.why-grid`
two-column layout (copy + photo slot):

- `.why-copy` (`.reveal`): `<span class="eyebrow">Why your donation matters</span>`;
  `<h2 id="why-heading">Every pound reminds someone they have not been
  forgotten.</h2>`; `<div class="rule">` directly under the heading (REQ-007 —
  brand-marks requires a rule to follow a heading); **two** verbatim leaflet
  paragraphs; `<a class="btn btn-primary" href="/donate">Support NBCC</a>` (the
  arrow comes from the global `.btn::after`).
- `.photo-slot` (`.reveal`): a `<figure>` placeholder — a decorative `aria-hidden`
  camera inline-SVG + a `<figcaption>` describing the intended photo. **No
  `<img>`** (avoids a broken image + the perf-budget img rules); the real
  packing/delivery photo is REQ-034.

Exact copy (REQ-031 — no dashes, "NBCC", warm dignified tone), verbatim from the
prototype:
- P1: "Your donation helps NBCC provide thoughtful gifts, essential support and
  moments of comfort, dignity and joy for people who may otherwise go without at
  Christmas."
- P2: "Donations also help cover the essential costs of running the charity, so we
  can keep reaching those who need us year after year."

`.page-sections[data-region="sections"]` is **kept** (home-hero.test relies on it).

## CSS (`HOME WHY-YOUR-DONATION-MATTERS (REQ-012)` block)

Token-only, mirroring HOME PILLARS:

- `.why` — tinted band: `background: var(--tan-soft)`, `--radius-lg`, padding,
  vertical margin (varies from the pillars' holly-soft).
- `.why-grid` — two columns → 1-col ≤680px.
- `.why-copy h2` (`--fs-section`, Playfair crimson via the headings rule), `p`
  (`--fs-body`, `var(--slate)`).
- `.photo-slot` — a `var(--card)` box, dashed `var(--line)` border, `--radius`,
  `min-height`, `color: var(--slate-soft)`; the camera icon inherits `--slate-soft`
  via `currentColor`. (Not `--tan`/`--holly` text — the contrast guard forbids it.)

## Testing

`test/unit/home-why.test.ts` (`// @vitest-environment jsdom`, `DOMParser`): the
`.why` section exists; the eyebrow + exact h2; a `.rule` immediately follows the
heading; exactly two `.why-copy p`; the "Support NBCC" `.btn` → `/donate`; a
`.photo-slot` present.

Existing `home-hero`, `home-pillars`, `perf-budget`, `brand-colours`,
`brand-marks`, `static-site`, `seo-metadata` (+ nav/footer/BDD) stay green.

README: "Home why-your-donation-matters (REQ-012)" subsection.

## Files

- Edit: `index.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/home-why.test.ts`, this spec.
