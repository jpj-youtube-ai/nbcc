# TASK-014 — Restrained motion system (REQ-008)

**Task:** ship the motion *system* — scroll reveal + hover lifts — plus the
non-negotiable `prefers-reduced-motion` off-switch (REQ-032). No new page content
(the elements that carry `.reveal` — hero/pillars/tiers — arrive in REQ-010+).

## CSS (`assets/css/styles.css`)

Motion tokens added to the single `:root` (durations/easing, consistent with the
nav timings — 0.15s/0.3s, `ease`):

- `--ease: ease`, `--motion-fast: 0.15s` (hover lift), `--motion: 0.3s` (state),
  `--reveal: 0.5s` (scroll reveal).

New `MOTION (REQ-008)` block:

- `.reveal { opacity: 0; transform: translateY(16px); transition: opacity
  var(--reveal) var(--ease), transform var(--reveal) var(--ease); }` →
  `.reveal.is-visible { opacity: 1; transform: none; }`.
- Hover lift following the `.nav-cta` pattern (`translateY(-1px)`), extended to the
  future `.card`, `.btn`, `.tier` selectors (REQ-009) so they inherit it when
  added: `transition: transform var(--motion-fast) var(--ease)` + `:hover {
  transform: translateY(-1px) }`.
- **Reduced-motion off-switch** (REQ-032): `@media (prefers-reduced-motion:
  reduce)` disables ALL motion (`*,*::before,*::after { animation: none
  !important; transition: none !important; }`) and forces `.reveal { opacity: 1
  !important; transform: none !important; }` so content is never hidden when
  motion is off.

The nav scroll-state transition (TASK-007) is reused, not reimplemented. No new
colours → `brand-colours.test.ts` stays green; motion tokens aren't `--font-*` or
the layout tokens, so typography/layout-tokens tests are unaffected.

## JS (`assets/js/main.js`)

Add and export `initReveal(doc, win)` alongside `initNav` (same CommonJS-guard
pattern; both called in the browser branch):

- `IntersectionObserver` adds `.is-visible` to `.reveal` elements on entry, then
  `unobserve`s them.
- **Fallback:** if `matchMedia('(prefers-reduced-motion: reduce)').matches` OR
  `IntersectionObserver` is absent, reveal every `.reveal` immediately (no
  observer).

## Testing

`test/unit/motion.test.ts` (`// @vitest-environment jsdom`, `createRequire` to
load `main.js`; stubs `IntersectionObserver` + `matchMedia`):

1. `.reveal` elements get `.is-visible` when observed and the stubbed observer
   fires `isIntersecting`.
2. When `matchMedia('(prefers-reduced-motion: reduce)')` matches, every `.reveal`
   is made visible immediately with **no** observer constructed.
3. (also) when `IntersectionObserver` is unavailable, everything reveals.
4. The stylesheet has a `prefers-reduced-motion: reduce` block that zeroes
   `transition`/`animation` (`none !important`).

`nav` / `perf-budget` / `static-site` and the rest stay green (one shared JS/CSS,
no new files/colours).

README: "Motion system (REQ-008)" subsection.

## Files

- Edit: `assets/css/styles.css`, `assets/js/main.js`, `README.md`. New:
  `test/unit/motion.test.ts`, this spec.
