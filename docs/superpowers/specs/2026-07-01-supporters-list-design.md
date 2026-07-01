# TASK-023 — Tiered supporters list on supporters.html (REQ-035)

**Task:** fill the kept `.page-sections` slot on `supporters.html` (the TASK-022
shell) with the tiered supporters list — Bronze, Silver, Gold, in that order,
entries alphabetical within each tier, each entry marked as a person or an
organisation. Reuse existing systems only.

## Update mechanism — decision (the frequently-changing list)

**Decision: the list lives in the HTML** (hand-edited `<li>` entries), **not** a
client-fetched JSON file or a `main.js`-rendered list.

Options weighed:

| Approach | SEO | Perf budget | No-build fit | Update ergonomics |
|---|---|---|---|---|
| **Content in HTML (chosen)** | Names are crawlable, in the document | No extra request/parse; a few KB of text | Native — it is just more static HTML | Edit `supporters.html`: add/remove an `<li>` in the right tier |
| Client-fetched JSON + `main.js` render | Names absent from initial HTML (JS-dependent) | Extra request + render cost; risks the 150 KB / request budget | Adds a fetch + render path the rest of the site does not have | Edit a JSON file |
| Build-time templating | Good | Good | Breaks the deliberate **no-build** static-site model | Needs a build step |

The whole site is **no-build static HTML served by Express** and leans on
content being *in the document* for SEO and the low-weight perf budget
(REQ-033). A supporters/donors "wall of thanks" is exactly the kind of content
that should rank and render without JS. The list changes occasionally (not per
request), so hand-editing HTML is acceptable; the ordering + tier invariants are
guarded by `test/unit/supporters.test.ts` so an edit that breaks alphabetical
order or the tier set fails CI.

**Tradeoff accepted:** updates are a manual HTML edit (no CMS/JSON authoring
surface). If the list ever grows large or needs non-technical editing, revisit a
data-driven render — but that is out of scope and would trade away the SEO/perf
/no-build properties above.

**To update the list:** in `supporters.html`, add or remove an
`<li class="card supporter" data-type="person|organisation">` inside the correct
`.supporter-tier`, keeping the tier alphabetical by the `.supporter-name`.

## Markup (`supporters.html`)

Inside `<section class="page-sections" data-region="sections">` a
`<div class="supporter-tiers">` holds three `<section class="supporter-tier
reveal" aria-labelledby="tier-…-heading">` in Bronze → Silver → Gold order. Each
tier: an `<h2 class="supporter-tier-name">` (the tier name, also its accessible
name) and a `<ul class="supporter-grid">` of
`<li class="card supporter" data-type="person|organisation">`. Each entry: a
decorative `aria-hidden` inline-SVG `.supporter-icon` (person vs building,
`stroke="currentColor"`, no `<img>`), then `.supporter-meta` wrapping the
`.supporter-name` and a visible `.supporter-kind` label ("Individual" /
"Organisation") that carries the person/brand distinction for sighted and
assistive-tech users alike.

Entries are **placeholder** (Scottish-flavoured names, mixed individuals and
organisations) flagged `CONTENT VERIFICATION` pending the charity's real,
consented list. Copy is dash-free and uses "NBCC" (REQ-031). The intro
(eyebrow + `<h1>` + `.rule` + `.lede`) from TASK-022 is unchanged and sits above.

## CSS (`SUPPORTERS TIERS (REQ-035)` block)

Token-only, reusing the home pillars/why tinted-band pattern:

- `.supporter-tier` — tinted band: `background: var(--tan-soft)`, `--radius-lg`,
  the pillars/why padding + `margin-block`. `.supporter-tiers >
  .supporter-tier:nth-child(even)` flips the middle (Silver) band to
  `var(--holly-soft)` → tan / holly / tan rhythm.
- `.supporter-tier-name` — `var(--fs-section)`, centred (Playfair via the
  headings rule).
- `.supporter-grid` — `repeat(3, 1fr)` → 2-col ≤900px → 1-col ≤680px (the
  breakpoints used elsewhere); a reset `<ul>`.
- `.supporter` adds flex layout + padding to the shared `.card` surface (hover
  lift inherited from MOTION).
- `.supporter-icon { color: var(--crimson) }` — **forced choice**: like the
  pillar icons, icons are crimson because the brand-colours guard forbids
  `color: var(--holly)`/`--tan` on these light bands. `.supporter-name` is
  `--slate`, `.supporter-kind` is `--slate-soft`.

## Testing

`test/unit/supporters.test.ts` (`// @vitest-environment jsdom`, parse
`supporters.html`, mirrors `home-pillars.test.ts`): exactly three
`.supporter-tier`s named Bronze/Silver/Gold in order; each tier's
`.supporter-name`s are alphabetical; every `.supporter` has a valid `data-type`
and at least one person and one organisation render; icons are `aria-hidden`
SVG with no `<img>`; the intro is intact.

Existing guards stay green with no edits: `copy-rules` and `accessibility`
auto-include `supporters.html` (dash-free copy, landmarks, no bad `<img>` alt);
`brand-colours` (token-only, no hex/rgb outside `:root`); `perf-budget`
(unchanged — no new `<img>`/font, supporters is not in its four-page set).

README: "Supporters page (REQ-035)" subsection.

## Files

- Edit: `supporters.html`, `assets/css/styles.css`, `README.md`. New:
  `test/unit/supporters.test.ts`, this spec.
