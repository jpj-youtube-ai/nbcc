# TASK-019 — Recurring crimson closing CTA strip (REQ-013)

**Task:** add a reusable crimson conversion strip at the very end of
`<main class="site-main">` (after the content sections, before `</main>`) on
**index.html and about.html only** — donate/contact are out of scope. Layout from
`prototypes/prototype-nbcc-website.html` (`.cta-strip`, lines 254-258 / 452-458).

## Markup (`index.html` + `about.html`)

A shared, byte-identical structure (only the headline + sub-copy differ per page):

```
<section class="closing-cta reveal" aria-labelledby="closing-cta-heading">
  <h2 id="closing-cta-heading">[headline]</h2>
  <p>[sub-copy]</p>
  <a class="btn btn-primary" href="/donate">Donate now</a>
</section>
```

- **Home** headline: exactly `Help us reach even more in 2026` (no period);
  sub-copy (prototype verbatim): "The need grows every year. A single gift, or a
  small monthly amount, helps NBCC bring a magical Christmas to those who need it
  most."
- **About** headline: `Be part of the next chapter` (prototype rallying line);
  sub-copy: "Whether you give, volunteer or share our story, you help NBCC reach
  more children, young people and vulnerable adults each Christmas."

Copy honours REQ-031 (no dashes, "NBCC", warm dignified). Semantic `<section>`
named by its `<h2>` via `aria-labelledby` (REQ-032). `.reveal` reused (REQ-008).

## CSS (`CLOSING CTA STRIP (REQ-013)` block)

Token-only, mirroring HOME PILLARS / HOME WHY:

- `.closing-cta` — `background: var(--crimson)`, `color: var(--cream)`,
  `text-align: center`, `--radius-lg`, fluid padding, vertical margin.
- `.closing-cta h2` — `color: var(--cream)` (overrides the headings rule's crimson,
  which would be invisible on the crimson strip), `--fs-section`, centred.
- `.closing-cta p` — `color: var(--cream)`, max-width, centred.
- **Inverted Donate button** (matches the prototype; user-approved): the global
  `.btn .btn-primary` is reused, with a scoped contextual override
  `.closing-cta .btn-primary { background: var(--cream); color: var(--crimson) }`
  (hover → `var(--tan-soft)`). A crimson button on a crimson strip is invisible and
  fails REQ-032; this inversion keeps it high-contrast. Token-only — no new colours,
  no change to the global button.

## Testing

`test/unit/closing-cta.test.ts` (`// @vitest-environment jsdom`, `DOMParser` over
all four pages): the `.closing-cta` section exists on index + about; Home's `<h2>`
is exactly "Help us reach even more in 2026"; About has its own (different)
headline; each has a `.btn-primary` → `/donate`; the strip is **absent** from
donate.html and contact.html.

Existing `home-hero`, `home-pillars`, `home-why`, `perf-budget`, `static-site`,
`brand-colours`, `brand-marks`, `seo-metadata` (+ nav/footer/BDD) stay green — no
new files/fonts/img, no inline styles, no hex/rgb outside `:root`, `.page-sections`
kept.

README: "Closing CTA strip (REQ-013)" subsection.

## Files

- Edit: `index.html`, `about.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/closing-cta.test.ts`, this spec.
