# TASK-021 — About "our story" section (REQ-015)

**Task:** add the "our story" section to `about.html`'s `<main>`, after
`.about-intro` and before the `.page-sections` placeholder / `.closing-cta` strip.
Copy from `prototypes/prototype-nbcc-website.html` (the About "our story" block,
lines 474-489). Reuse existing systems only.

## Markup (`about.html`)

A content-verification comment, then a semantic section:

```
<!-- CONTENT VERIFICATION (REQ-015): the "our story" copy is carried from the
     existing NBCC site (not the 2025 leaflet) and must be verified with the charity. -->
<section class="our-story" aria-labelledby="our-story-heading">
  <div class="story-grid">
    <div class="story-prose reveal">
      <h2 id="our-story-heading" class="eyebrow">Our story</h2>
      <p class="quote">&ldquo;Do all children get a Christmas Eve box like I do?&rdquo;</p>
      <p class="by">Tygan, age twelve, Annbank, 2015</p>
      <p>That single question … became the Night Before Christmas Campaign …</p>
      <p>In their first year they delivered 90 boxes …</p>
      <p class="story-close">The story continues, and you can be part of it.</p>
    </div>
    <figure class="photo-slot reveal">
      <svg class="photo-slot-icon" … aria-hidden="true"> (person)</svg>
      <figcaption>Tygan, whose question in 2015 started it all.</figcaption>
    </figure>
  </div>
</section>
```

- **Heading:** "Our story" is a real `<h2 class="eyebrow">` (so `aria-labelledby`
  has a heading to point at, REQ-032) styled to look like the existing eyebrow.
- **Headshot placeholder:** reuses the `.photo-slot` pattern + HOME WHY CSS — a
  `<figure>` with a decorative `aria-hidden` person icon and a real `<figcaption>`;
  **no `<img>`** (perf budget). The real Tygan headshot is REQ-034.
- **Quote** is Playfair italic (synthesised — only Playfair 700 normal is
  self-hosted), `var(--crimson)`.

### Copy notes (REQ-031)

Origin narrative pulled verbatim from the prototype (the one section carried from
the existing site, not the leaflet — hence the verification comment). No dashes;
beneficiary/child phrasing kept as the historical origin story. The narrative says
"became the Night Before Christmas Campaign" — the full name is correct at the
naming/founding moment, and NBCC is already introduced in `.about-intro` above.

## CSS (`ABOUT OUR STORY (REQ-015)` block)

Token-only: `.story-grid` two-column → 1-col ≤680px; `.our-story .eyebrow`
(font-family body so the `h2` reads as an eyebrow); `.story-prose .quote`
(Playfair italic, `--crimson`), `.story-prose .by` (`--slate-soft`),
`.story-prose p` (`--slate`), `.story-close` (semibold). `.photo-slot`/`.reveal`
reused, not redefined.

## Testing

`test/unit/about-our-story.test.ts` (`// @vitest-environment jsdom`, `DOMParser`
over `about.html`): the `.our-story` section exists with the founding quote and
Tygan/2015 attribution; ≥2 narrative paragraphs incl. the naming + "first year"
lines; a captioned `.photo-slot` `<figure>` (figcaption present, no `<img>`,
aria-hidden icon); the content-verification comment is present; and `.about-intro`,
its `.rule`, `.page-sections` and `.closing-cta` remain intact.

Existing `static-site`, `perf-budget`, `brand-colours`, `brand-marks`,
`seo-metadata`, `nav`, `footer` (+ site BDD) stay green.

README: "About our story (REQ-015)" subsection.

## Files

- Edit: `about.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/about-our-story.test.ts`, this spec.
