# TASK-015 — Global UI components: buttons + card (REQ-009)

**Task:** ship the reusable button system (3 pill variants, animated arrow) and
the shared `.card` surface — token-only, CSS-only. Consumers (pillars / tiers /
reassurance / team) arrive in REQ-010+; this ships only the system (as TASK-014
shipped motion without its content).

## CSS — `GLOBAL UI COMPONENTS (REQ-009)` block

**`.btn` pill base** (mirrors the `.nav-cta` pattern): `inline-flex` + `gap`,
`--font-body` (inherited Poppins), `font-weight: 600`, `padding: 11px 24px`
(matches `.nav-cta`), `border-radius: var(--radius-pill)`, `box-shadow:
var(--shadow-sm)`. The hover-lift transition + `translateY(-1px)` are **inherited
from the MOTION (REQ-008) block** (`.btn` is already in its group) — not
re-declared.

**Variants** (token-only):
- `.btn-primary` — `background: var(--crimson)`, `color: var(--cream)`; hover
  `background: var(--maroon)` (mirrors `.nav-cta`).
- `.btn-ghost` — `background: transparent`, `color: var(--maroon)`, `1.6px solid
  var(--maroon)` border, no shadow; hover `background: var(--maroon)`, `color:
  var(--cream)`.
- `.btn-holly` — `background: var(--holly)`, `color: var(--cream)` (hover feedback
  = the inherited lift + arrow; no darker-holly token exists, so no bg change).

**Animated arrow** — a **pseudo-element** `.btn::after { content: "\2192";
transition: transform var(--motion-fast) var(--ease); }` that translates on
`:hover`/`:focus-visible`. Gated through the motion tokens, so the
`prefers-reduced-motion: reduce` off-switch in the MOTION block (`* { transition:
none !important }`) disables it. No `<img>`.

> Hover backgrounds swap instantly (the transitioned affordance is the lift +
> arrow). Transitioning the bg too would require re-declaring `.btn`'s `transition`
> shorthand, which the task forbids — so it's intentionally left to MOTION's
> transform transition.

**`.card` surface:** `background: var(--card)`, `1px solid var(--line)` border,
`box-shadow: var(--shadow)`, `border-radius: var(--radius)` (a `.card-lg` modifier
uses `--radius-lg` for large figures). A comment notes the hover-lift is inherited
from MOTION — not re-declared.

All colours are `var(--…)` → no new hex/rgb outside `:root`
(`brand-colours.test.ts` stays green).

## Testing

`test/unit/ui-components.test.ts` (mirrors `brand-marks` / `layout-tokens`):
`.btn` + the three variants declared with the correct tokens; `.card` uses
`var(--card)` + `var(--line)` border + a shadow token + a radius token; the hover
arrow is a pseudo-element with `transform` and no `url()`; and no `.btn`/`.card`
rule contains a hex/rgb literal.

`brand-colours` / `perf-budget` / `motion` / `static-site` / nav / footer stay
green (one shared CSS, no markup change, no new files).

README: "Global UI components (REQ-009)" subsection.

## Files

- Edit: `assets/css/styles.css`, `README.md`. New:
  `test/unit/ui-components.test.ts`, this spec.
