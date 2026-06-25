# TASK-013 — Master logo lockup in nav & footer (REQ-007)

**Task:** wire the whole NBCC logo lockup into the nav (50px) and footer (74px)
across the four pages, with accessible `alt` and intrinsic `width`/`height`,
within the perf budget. The optimised/responsive asset pipeline is **REQ-034**.

## The asset

The supplied master logo is a **2000×2000 PNG, 175.6 KB**, embedded as a base64
data URI in the design HTML (same image used in nav, hero and footer). At
175.6 KB it would blow the perf budget (it's referenced twice — nav + footer — so
`perf-budget.test.ts` counts it twice).

It's used **whole, never rebuilt from parts** — but downscaled to display
resolution: a **148×148 PNG (~12 KB)** at `assets/img/nbcc-logo.png` (148 = 2× the
74px footer render, i.e. retina-sharp at both sizes). Produced once by downscaling
the master (jimp, installed `--no-save` so it never enters the repo deps). The
**final optimised / responsive asset is REQ-034**; this is a lightweight
display-sized stand-in so the lockup ships now within budget.

## Markup (all four pages)

- **Nav:** replace `<a class="brand" href="/">NBCC</a>` with
  `<a class="brand" href="/"><img src="/assets/img/nbcc-logo.png"
  alt="Night Before Christmas Campaign" width="50" height="50" loading="lazy"></a>`
  — brand link still points to `/`, accessible alt names the link.
- **Footer:** replace the `<p class="foot-name">…</p>` in the `.foot-brand` column
  with the same logo `<img …>` at `width="74" height="74"` (kept **byte-identical**
  across all four footers — `footer.test.ts` asserts this).

Every `<img>` declares `width`/`height` and `loading="lazy"` to satisfy
`perf-budget.test.ts`. (Lazy on the above-the-fold nav logo is a minor LCP
tradeoff the budget rule mandates; the file is tiny so impact is negligible.)

## Styling (BRAND MARKS / REQ-007 block)

```
.brand img      { display: block; height: 50px; width: auto; }
.foot-brand img { display: block; height: 74px; width: auto; margin-bottom: 14px; }
```

The footer `margin-bottom` plus the nav `.wrap` gap give the lockup its **clear
space**. The now-unused `.foot-name` rule is removed.

## Testing

- `nav.test.ts`: brand link still `/`, and now contains the logo `<img>`
  (`nbcc-logo.png`) with non-empty `alt`.
- `footer.test.ts`: `.foot-brand` contains the logo `<img>`; footer still
  byte-identical across pages.
- `perf-budget.test.ts` unchanged and green: ≤ 2 fonts; the logo `<img>` has
  width/height/lazy; page transfer ~76 KB (< 150 KB) — logo ~12 KB ×2.
- `brand-colours` / `static-site` / `clean-urls` / `typography` / `layout-tokens`
  / `brand-marks` unaffected.

README: update the nav / footer / brand-marks subsections.

## Out of scope

The optimised/responsive asset pipeline (**REQ-034**) and the larger Home hero
logo illustration (**REQ-010**).

## Files

- New: `assets/img/nbcc-logo.png`, this spec. Edit: the four `*.html`,
  `assets/css/styles.css`, `test/unit/nav.test.ts`, `test/unit/footer.test.ts`,
  `README.md`.
