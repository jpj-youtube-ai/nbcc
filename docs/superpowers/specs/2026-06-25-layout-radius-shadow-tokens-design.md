# TASK-011 — Layout, radius & shadow tokens (REQ-006)

**Task:** TASK-011 — extend the single canonical `:root` (REQ-004) with the
remaining layout/radius/shadow tokens and route the inline literals to them.
CSS-only (plus test/README/spec); no markup churn, no new files/fonts.

## Tokens added to `:root`

Existing `--maxw: 1180px`, `--nav-h: 78px`, `--shadow-sm`, `--shadow` are
**extended, not duplicated**:

- `--pad: clamp(20px, 5vw, 48px)` — fluid side padding (was inline in
  `.nav .wrap`, the mobile menu, and `.site-footer .wrap`).
- `--radius: 16px` (standard), `--radius-lg: 24px` (large cards/figures),
  `--radius-pill: 999px` (pills/buttons — was hardcoded in `.nav-links a` /
  `.nav-cta`).
- Three **maroon-tinted** shadow levels (rgba off maroon `#800000`):
  - `--shadow-sm: 0 2px 10px rgba(128,0,0,.06)` (re-tinted from neutral grey),
  - `--shadow: 0 16px 44px -20px rgba(128,0,0,.28)` (already maroon, unchanged),
  - `--shadow-lg: 0 30px 70px -28px rgba(128,0,0,.40)` (new).

rgba literals are permitted inside `:root` per the brand-colours contract.
`--content-width: 70ch` is **removed** (superseded by the 1180px capped layout).

## Applied

- Route the three inline `clamp(20px,5vw,48px)` → `var(--pad)`.
- Route the two `999px` → `var(--radius-pill)`.
- **Content container:** `.site-main` reconciled from `--content-width` (70ch) to
  `max-width: var(--maxw)` + horizontal `var(--pad)` — a 1180px capped layout
  matching `.nav .wrap` / `.site-footer .wrap`. Its `padding-top: var(--nav-h)`
  (clears the fixed nav on load) is kept.
- **Anchor offset:** `scroll-margin-top: calc(var(--nav-h) + 1rem)` on the
  headings rule and on `[id]`, so anchored headings/sections aren't hidden under
  the 78px sticky nav.

The new `--radius`/`--radius-lg`/`--shadow-lg` tokens are declared for the design
system; cards/figures that use them arrive with later content REQs. (Small UI
radii like the 10px socials/burger are lengths, not colours, and stay as-is.)

## Testing

`test/unit/layout-tokens.test.ts` (mirrors `brand-colours`/`typography`): asserts,
in the **single** `:root` block, `--maxw: 1180px`, `--pad: clamp(20px,5vw,48px)`,
`--radius: 16px`, `--radius-lg: 24px`, `--radius-pill: 999px`, `--nav-h: 78px`,
and three shadow tokens (`--shadow-sm/--shadow/--shadow-lg`) each **maroon-tinted**
(`rgba(128,0,0,…)`).

`brand-colours.test.ts` stays green (no hex/rgb added outside `:root`); `perf-budget`,
`nav`, `footer`, `typography`, `static-site`, `clean-urls` unaffected (CSS token
wiring only).

README: "Layout, radius and shadow tokens (REQ-006)" subsection.

## Files

- Edit: `assets/css/styles.css`, `README.md`. New:
  `test/unit/layout-tokens.test.ts`, this spec.
