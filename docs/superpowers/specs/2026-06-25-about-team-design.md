# TASK-024 — About "meet the team" responsive grid (REQ-016)

**Task:** add the team section to `about.html`'s `<main>`, after `.our-story` and
before the `.page-sections` placeholder / `.closing-cta` strip. Copy/layout from
`prototypes/prototype-nbcc-website.html` (the About meet-the-team block, lines
499-514). Reuse existing systems only.

## Markup (`about.html`)

A tinted band holding a responsive grid of ten member cards:

```
<section class="meet-team" aria-labelledby="meet-team-heading">
  <h2 id="meet-team-heading">Meet the team</h2>
  <p class="team-intro">NBCC is powered by volunteers who give their time so that
    more reaches the people who need it.</p>
  <!-- CONTENT VERIFICATION (REQ-016): the six "Volunteer Elf" roles are
       placeholders to be confirmed with NBCC (real names/roles + headshots are
       REQ-034). -->
  <div class="team-grid">
    <article class="member reveal">
      <div class="photo-slot"><svg class="photo-slot-icon" … aria-hidden="true">(person)</svg></div>
      <p class="member-name">Tygan</p>
      <p class="member-role">Founder</p>
    </article>
    … ten total
  </div>
</section>
```

Ten members (name / role): Tygan / Founder; Jodie / Head Elf and Founder;
Isabella / Co founder; Jaimie / Donations; then **six "Volunteer Elf"** — Dawn,
Jill, Jon, Kenny, Liz, Vicky.

- Each member's portrait is the `.photo-slot` placeholder pattern (a 4:5 box with a
  decorative `aria-hidden` person SVG, **no `<img>`** — real headshots are REQ-034).
- The six "Volunteer Elf" placeholder roles are flagged with a
  `CONTENT VERIFICATION` HTML comment (mirrors the REQ-015 convention).
- Copy honours REQ-031 (no dashes — "Co founder", not "Co-founder"; "NBCC").
  Semantic `<section>` named by its `<h2>` (REQ-032).

`.about-intro`, `.our-story`, `.page-sections` and `.closing-cta` stay intact.

## CSS (`ABOUT MEET THE TEAM (REQ-016)` block)

Token-only, mirroring the tinted bands + `.pillar-grid` breakpoints:

- `.meet-team` — tinted band: `background: var(--holly-soft)`, `--radius-lg`,
  padding, vertical margin.
- `.team-grid` — `repeat(5, 1fr)` desktop → `repeat(3, 1fr)` ≤900px →
  `repeat(2, 1fr)` ≤680px (the documented breakpoints).
- `.member` (centred); `.member .photo-slot` overrides to a 4:5 portrait (reuses
  the `.photo-slot` surface/icon); `.member-name` (Playfair, `--crimson`),
  `.member-role` (`--slate-soft`). `.reveal` reused.

## Testing

`test/unit/about-team.test.ts` (`// @vitest-environment jsdom`, `DOMParser` over
`about.html`): the `.meet-team` section exists and is named by its heading;
exactly **ten** `.member` cards, each with a `.member-name`, a `.member-role`, an
`aria-hidden` icon and **no `<img>`**; exactly **six** roles read "Volunteer Elf";
a comment flags the "Volunteer Elf" placeholders; the `.team-grid` CSS declares
**5 / 3 / 2** columns at the documented breakpoints; and
`.about-intro`/`.our-story`/`.page-sections`/`.closing-cta` remain.

Existing `static-site`, `perf-budget`, `brand-colours`, `brand-marks`,
`seo-metadata`, `nav`, `footer` (+ site BDD) stay green — no `<img>`, no new fonts,
no hex/rgb outside `:root`.

README: "About meet-the-team grid (REQ-016)" subsection.

## Files

- Edit: `about.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/about-team.test.ts`, this spec.
