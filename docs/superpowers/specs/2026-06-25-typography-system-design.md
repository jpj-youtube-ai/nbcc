# TASK-010 — Two-family typography system (REQ-005)

**Task:** TASK-010 — Playfair Display (headings) + Poppins (body) as a tokenised
type system, within the REQ-033 perf budget (≤ 2 font files, ≤ 150 KB/page).

## Font-delivery decision (brainstormed)

REQ-005 wants Google Fonts primary with a self-hosted `@font-face` fallback, but
the perf budget caps web-font **files** at 2 and counts **local** bytes toward the
150 KB/page transfer. Three facts decided it:

- Google Fonts' `gstatic` serves **already-latin-subset woff2** — downloadable
  directly, **no subsetting tools needed** (none are installed anyway).
- Self-hosted bytes are counted honestly by `perf-budget.test.ts`; Google Fonts
  bytes are external and invisible to it (so the GF route would pass the test
  without actually proving ≤ 2 loaded files).
- Poppins is **not** a variable font on Google Fonts, so ≤ 2 files means **one
  static weight per family** either way.

**Chosen: self-host two latin-subset woff2** — Playfair Display **700**
(headings, 23 KB) + Poppins **400** (body, 8 KB) in `assets/fonts/`, `@font-face`
with `font-display: swap`. ~31 KB total → ~50 KB/page (well under 150 KB);
`fontFiles` = 2. No external dependency, no build step, ships in the Docker image
(`assets/` is already COPYed). **Google Fonts is the documented alternative**
(preconnect + one non-`.css` stylesheet link per page).

**Weight tradeoff:** one static weight per family. Headings are 700 (baseline
headings are 700 — crisp). Body is 400. The few 500/600 UI weights (nav/footer)
**faux-synthesise** — acceptable for short labels; a future task can add weights
if the budget is raised.

## styles.css changes

`:root` — replace the single system-stack `--font-body` with the type tokens:

- `--font-head: "Playfair Display", Georgia, "Times New Roman", serif`
- `--font-body: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, …, sans-serif`
- clamp() scale: `--fs-hero`, `--fs-page-intro`, `--fs-section`, `--fs-lede`,
  `--fs-body`, `--fs-eyebrow`.

Add two `@font-face` blocks (no colours → `brand-colours.test.ts` stays green),
`src: url(/assets/fonts/…woff2) format("woff2")` (absolute path; served by Express
`/assets`, bytes counted by perf-budget).

Apply: `body` gets `font-size: var(--fs-body)` and keeps `font-family:
var(--font-body)`; headings rule `h1,h2,h3,h4 { font-family: var(--font-head);
color: var(--crimson); font-weight: 700 }` with `h1` sized `var(--fs-page-intro)`.
Nav/footer already inherit `--font-body` and reference shared tokens — unchanged.

Still **one** shared stylesheet + **one** shared script; no build step, no
per-page styles (golden rule).

## Testing (TDD)

`test/unit/typography.test.ts` (mirrors `brand-colours.test.ts`):

- Exactly two font families are declared as tokens — `--font-head` (Playfair
  Display) and `--font-body` (Poppins); no third `--font-*` family token.
- All six clamp scale tokens exist (`--fs-*: clamp(`).
- Exactly two `@font-face` blocks, families only Playfair/Poppins, `woff2`.
- Headings rule sets `font-family: var(--font-head)` + `color: var(--crimson)`.
- No third font family leaks: every `font-family:` in a rule references
  `var(--font-head)` or `var(--font-body)`.

`perf-budget.test.ts` must still pass (≤ 2 font files, ≤ 150 KB/page).

README: add a "Typography (REQ-005)" subsection and reconcile the perf-budget
"system font stack" note (now: 2 self-hosted woff2, still ≤ 2 files).

## Out of scope

Logo/photo asset pipeline (REQ-034); additional font weights; the "Charity Site"
→ NBCC rename.

## Files

- New: `assets/fonts/playfair-display-700-latin.woff2`,
  `assets/fonts/poppins-400-latin.woff2`, `test/unit/typography.test.ts`,
  this spec. Edit: `assets/css/styles.css`, `README.md`.
