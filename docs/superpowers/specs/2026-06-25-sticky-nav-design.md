# TASK-007 — Sticky top navigation (REQ-002)

**Task:** TASK-007 — a sticky nav with a scroll state, active link, persistent
Donate CTA, and a mobile burger. Ported from the **NBCC baseline**
(`nbcc-preview.html`) into our architecture. **Scope chosen (owner): nav only,
system fonts** — defer the full design-token system + web fonts to REQ-004/006,
the footer to REQ-003, hero/content to their own ideas.

## Architecture reconciliation

The baseline is a single-file SPA (`.page` divs toggled by JS, raw `.html` links,
Google Fonts). Ours is four separate static pages at clean URLs served by Express
(TASK-002/005). So the baseline's nav is **ported**, not dropped in:

- Links use the clean URLs: Home `/`, About `/about-us`, Donate `/donate`,
  Contact `/contact` (not the baseline's `index.html` etc.).
- The SPA `route()` / `data-page` page-switching is **dropped** — each link is a
  real navigation.
- The active link is set **per page** (the current page's link is hardcoded
  `class="active"` + `aria-current="page"`) instead of JS path-compare — robust,
  works without JS, statically testable, same result.
- Brand shows **"NBCC"** text (the baseline's logo image is REQ-034). Page
  `<title>`s still say "Charity Site" (TASK-001 placeholder) — a separate rename,
  out of scope here.

## Markup (each page's `<header>` slot)

Replaces the empty `<header class="site-header" data-region="nav">` with:

```html
<header class="nav" id="nav" data-region="nav">
  <div class="wrap">
    <a class="brand" href="/">NBCC</a>
    <nav aria-label="Primary">
      <ul class="nav-links" id="navLinks">
        <li><a href="/">Home</a></li>
        <li><a href="/about-us">About</a></li>
        <li><a href="/donate">Donate</a></li>
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
    <a class="nav-cta" href="/donate">Donate</a>
    <button class="burger" id="burger" aria-label="Open menu"
            aria-expanded="false" aria-controls="navLinks">
      <span></span><span></span><span></span>
    </button>
  </div>
</header>
```

Per page, the matching link gets `class="active" aria-current="page"` (e.g.
`/about-us` on `about.html`). The Donate link lives in the list **and** as the
`.nav-cta` button, so Donate stays reachable in the open mobile menu (where
`.nav-cta` is hidden but the list is shown).

## Styling (`assets/css/styles.css`)

Add the **nav-relevant token subset** from the baseline (commented as a subset;
full system is REQ-004/006): `--crimson #C02238`, `--maroon #800000`,
`--cream #F8F5EE`, `--line #E9DFD2`, `--slate #333`, `--shadow-sm`, `--shadow`,
`--nav-h 78px`, `--maxw 1180px`. Then the baseline's nav CSS:

- `.nav` fixed, transparent (`rgba(248,245,238,0)`), `height:--nav-h`.
- `.nav.scrolled` → `rgba(248,245,238,.9)` + `backdrop-filter: blur` +
  `--shadow-sm` + `1px` `--line` bottom border.
- `.wrap` (centered max-width row), `.brand`, `.nav-links`, `.nav-links a.active`
  (crimson + underline), `.nav-cta`, `.burger` (+ open-state X animation).
- `@media (max-width:680px)`: hide inline `.nav-links`/`.nav-cta`, show `.burger`;
  `.nav.open .nav-links` becomes a dropdown panel (cream, hairline, shadow).
- `:focus-visible` outline (already present; keep) — REQ-032.
- `.site-main { padding-top: var(--nav-h); }` so placeholder content clears the
  fixed nav.

## Behavior (`assets/js/main.js`)

Restructured to an exported, testable `initNav(doc, win)` (keeps the existing
`dataset.js="ready"`), run in the browser via a `module`-guard so it stays a
classic `<script defer>` yet is requireable in tests:

- **Scroll state:** `scroll` listener `{ passive: true }` + `requestAnimationFrame`
  throttle, toggling `.scrolled` when `win.scrollY > 24` (applied once on load).
- **Burger:** click toggles `.open` on the nav and flips `aria-expanded`.
- **Focus management:** `Escape` closes the menu and returns focus to the burger
  (native `<button>` gives keyboard operability for free).

Still one CSS file + one JS file, no inline style/script, no new `.html` links —
so `static-site`, `clean-urls`, `seo-metadata`, and `perf-budget` tests stay green
(system fonts → still 0 web fonts; markup additions are tiny).

## Testing (golden rules 1 & 5)

`test/unit/nav.test.ts` (`// @vitest-environment jsdom`, adds the `jsdom` devDep):

- **Static markup (per page):** brand → `/`; the four links with the clean-URL
  hrefs; the current page's link has `class="active"` + `aria-current="page"`;
  `.nav-cta` → `/donate`; the burger `<button>` has `aria-expanded="false"` +
  `aria-controls="navLinks"`.
- **Behavior (jsdom):** inject the real nav markup + run `initNav`; assert
  `scrollY > 24` adds `.scrolled` (rAF stubbed sync), burger click toggles
  `.open` + `aria-expanded`, `Escape` closes.
- Live keyboard/visual/responsive check via Playwright locally (documented; not
  in CI).

README gets a nav subsection.

## Out of scope

- Web fonts + full design tokens (REQ-004/006), footer (REQ-003), hero/pillars/
  give-widget, the logo image asset (REQ-034), and the "Charity Site" → NBCC
  rename of titles/SEO.

## Files

- New: `test/unit/nav.test.ts`, this spec. Edit: the four `*.html` (nav markup),
  `assets/css/styles.css`, `assets/js/main.js`, `README.md`, `package.json` +
  lockfile (jsdom devDep).
