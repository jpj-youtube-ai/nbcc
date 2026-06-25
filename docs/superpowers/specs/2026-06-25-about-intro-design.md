# TASK-020 — About intro section (REQ-014)

**Task:** replace the placeholder `<h1>About</h1>` + `.rule` + paragraph in
`about.html`'s `<main>` with the About intro, mirroring the Home hero markup
pattern. Reuse existing systems only. Keep `.page-sections` and the closing CTA
strip intact. Copy from `prototypes/prototype-nbcc-website.html` (lines 463-470).

## Markup (`about.html`)

A centred page intro (mirrors the prototype's `.intro-hero`):

```
<section class="about-intro">
  <span class="eyebrow">About us</span>
  <h1>Powered by kindness, driven by community</h1>
  <div class="rule center"></div>
  <p class="lede">The Night Before Christmas Campaign (NBCC) is a volunteer run
    charity in Annbank, Ayrshire, supporting children, young people and vulnerable
    adults across South West Scotland, from Girvan to Largs.</p>
</section>
```

- Reuses `.eyebrow` (crimson, REQ-005/010), the base `h1` (Playfair crimson,
  `--fs-page-intro`), `.rule.center` (REQ-007/012), `.lede` and the tokens.
- **H1 has no trailing period** (the task's exact string is "Powered by kindness,
  driven by community"; the prototype's period is dropped).
- **Lede introduces the full name with (NBCC)** — the prototype spells out "The
  Night Before Christmas Campaign", REQ-031 says "always NBCC"; the
  introduce-with-acronym form honours both and is natural on the About page. No
  dashes, beneficiary phrasing, names Annbank/Ayrshire and the Girvan to Largs
  reach.

`.page-sections[data-region="sections"]` and the `.closing-cta` strip are kept.

## CSS (`ABOUT INTRO (REQ-014)` block)

Small, token-only — just the centred layout the prototype's `.intro-hero` uses
(the type/colour/divider all come from existing rules):

```
.about-intro { text-align: center; max-width: 760px; margin-inline: auto;
               padding-block: clamp(8px, 3vw, 40px); }
.about-intro .lede { margin-inline: auto; }
```

(`.eyebrow` is inline-block and `.rule.center` auto-margins, so both centre within
the centred container.)

## Testing

`test/unit/about-intro.test.ts` (`// @vitest-environment jsdom`, `DOMParser` over
`about.html`), mirroring `home-hero.test.ts`: the `.about-intro` exists; eyebrow
"About us"; `<h1>` exactly "Powered by kindness, driven by community"; a `.rule`
immediately follows the heading; the `.lede` references Annbank, Ayrshire and
"Girvan to Largs"; the placeholder copy is gone; `.page-sections` and
`.closing-cta` remain.

Existing `static-site`, `footer`, `nav`, `seo-metadata`, `perf-budget`,
`closing-cta`, `brand-marks` (+ BDD) stay green — no new fonts/img, no hex/rgb
outside `:root`.

README: "About intro (REQ-014)" subsection.

## Files

- Edit: `about.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/about-intro.test.ts`, this spec.
