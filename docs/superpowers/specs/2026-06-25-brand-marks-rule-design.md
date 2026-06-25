# TASK-012 — Signature rule divider motif (REQ-007)

**Task:** TASK-012 — the NBCC signature divider: a thin Holly Green hairline with
a centred crimson diamond, under each page heading. CSS + markup only; reuses the
canonical tokens; no image (keeps the perf budget green).

## The motif (`.rule`)

Ported from the baseline, **adapted to an empty `<div class="rule"></div>`** (the
baseline used an `<i>` child for the diamond; the task wants an empty div, so the
diamond becomes a pseudo-element). New `BRAND MARKS (REQ-007)` block in
`assets/css/styles.css`:

- `.rule` — relative box, `max-width: 340px`, small top margin.
- `.rule::before` — the Holly Green hairline: full-width 2px bar centred
  vertically, `background: var(--holly)`, `opacity: .55`.
- `.rule::after` — the centred crimson diamond: a 9px rotated square
  (`rotate(45deg)`), `background: var(--crimson)`, with a `box-shadow: 0 0 0 4px
  var(--cream)` halo so the hairline appears to break around it.
- `.rule.center` — optional `margin-inline: auto` modifier (parity with the
  baseline; for future centred use).

Pseudo-elements/background only — **no image** (perf budget). Colours are
**token-only** (`--holly`, `--crimson`, `--cream`) — no hex/rgb outside `:root`,
so `brand-colours.test.ts` stays green. The diamond uses a `background`, not
`color:`, so the tan/holly contrast guard is unaffected.

## Placement

Insert `<div class="rule"></div>` directly under the page `<h1>` in `index.html`,
`about.html`, `donate.html`, `contact.html` (one per page for now). **Used only
under a heading**, never as a free-floating separator. Later content REQs
(REQ-010+) reuse the same class under their section heads.

## Testing

`test/unit/brand-marks.test.ts` (DB-free, mirrors `footer.test.ts` /
`layout-tokens.test.ts`):

- The `.rule` component exists in the stylesheet and uses `var(--holly)` +
  `var(--crimson)`.
- Each page has ≥ 1 `.rule`, **every** `.rule` immediately follows a heading
  (`</h1>`–`</h4>`), and none is free-floating (count of heading-preceded rules ==
  count of rules).

`brand-colours` / `perf-budget` / `static-site` / `nav` / `footer` / `typography`
/ `layout-tokens` stay green (token-only colours, no image, no new files, markup
limited to the `.rule` divs).

README: "Brand marks (REQ-007)" subsection.

## Files

- Edit: `assets/css/styles.css`, the four `*.html`, `README.md`. New:
  `test/unit/brand-marks.test.ts`, this spec.
