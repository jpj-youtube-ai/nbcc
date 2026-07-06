# charity-site

Containerised TypeScript service on AWS Fargate, fronted by an ALB, with a
Postgres (RDS) database and a couple of external API integrations. Two
environments (staging, production) with a build-once, promote-the-same-artifact
pipeline.

## What's here

```
src/                 Express + TypeScript app (health, static site, /api stubs, config, db)
migrations/          node-pg-migrate migrations (expand-contract)
test/unit/           Vitest unit tests (DB-free)
features/            Cucumber BDD (.feature + JS step defs)
scripts/             bootstrap-aws.sh, branch-protection.sh (one-time) + smoke.sh
infra/modules/app/   Reusable Terraform module (VPC, ALB, ECS, RDS, secrets)
infra/envs/          Thin per-env roots: staging/ and production/
.github/workflows/   pr.yml, deploy-staging.yml, deploy-prod.yml, infra.yml
.claude/             Claude Code automation (hooks, reviewer agents, skills)
.mcp.json            MCP servers for this repo (github, postgres)
index.html …         Static site: Home, About, Donate, Contact (HTML pages)
assets/              Shared site stylesheet (css/styles.css) + script (js/main.js)
_redirects           Clean-URL rewrite/redirect rules for the static site
```

## Static site

A four-page static site lives at the repo root and is **served by the Express
service** (TASK-005 / REQ-033): `index.html` (Home), `about.html` (About),
`donate.html` (Donate), `contact.html` (Contact). Each is a complete HTML5
document that links the **one** shared stylesheet `assets/css/styles.css` and the
**one** shared script `assets/js/main.js` (loaded with `defer`) — no inline or
per-page styles/scripts, no build step. View it by opening any page in a browser,
or by running the app (below) and visiting the clean URLs.

It is intentionally a skeleton: navigation, footer, and page content sections
arrive in their own requirements (REQ-002, REQ-003, REQ-010+) and are empty
placeholders in the markup for now. The shared-asset wiring is verified by
`test/unit/static-site.test.ts` (`npm run test:unit`). `src/routes/site.ts`
serves `/`, the clean URLs and `/assets`, and the Dockerfile copies the five
pages + `assets/` + `_redirects` into the runtime image — so the marketing site
ships and deploys with the service.

### Clean URLs

Each page is served at a clean, canonical URL (no `.html`):

| Clean URL     | Serves            |
|---------------|-------------------|
| `/`           | `index.html`      |
| `/about-us`   | `about.html`      |
| `/donate`     | `donate.html`     |
| `/contact`    | `contact.html`    |
| `/supporters` | `supporters.html` |
| `/donate/thank-you` | `thank-you.html` |
| `/donor-portal` | `portal.html` |
| `/privacy` | `privacy.html` |

`/donate/thank-you` is the post-payment confirmation page Stripe returns the
donor to on a successful checkout (`STRIPE_SUCCESS_URL`, REQ-028/REQ-029); it is a
landing page, not a primary nav destination. `/donor-portal` is the self-serve
donor portal page (REQ-061), reached via the magic-link token in the URL query
string (`?token=…`); it is a private landing page (`noindex`), not a nav
destination. `/privacy` is the data-protection privacy notice (REQ-064), linked
from the footer and from the consent controls on the contact and donate pages,
not a primary nav destination.

The mapping lives in the repo-root **`_redirects`** file, a host-agnostic
Netlify-style format. The Express site router (`src/routes/site.ts`) parses it
and applies the same rules at runtime, and the file is also honoured natively by
**Netlify** / **Cloudflare Pages** for any future static host:

```
/about-us         /about.html       200    # rewrite: serve the page, URL stays clean
/donate           /donate.html      200
/contact          /contact.html     200
/supporters       /supporters.html  200
/donate/thank-you /thank-you.html   200
/donor-portal     /portal.html      200
/privacy          /privacy.html     200
/index.html       /                 301!   # canonicalise raw .html onto the clean URL
/about.html       /about-us         301!   # ! forces the redirect over the real file
/donate.html      /donate           301!
/contact.html     /contact          301!
/supporters.html  /supporters       301!
/thank-you.html   /donate/thank-you 301!
/portal.html      /donor-portal     301!
/privacy.html     /privacy          301!
```

`200` is a *rewrite* (content served, address bar unchanged); `301!` is a forced
permanent redirect — the `!` is required because the `.html` files physically
exist and would otherwise be served directly. `/` serves `index.html`
automatically, so it needs no rewrite rule. REQ-033 (hosting) is resolved by
serving the site from the existing Express/ECS service (see the API + budget
notes below); the same `_redirects` file stays valid for a static host later.

**Equivalent rules on other hosts** (if `_redirects` isn't honoured), should the
host decision land elsewhere:

- **Netlify `netlify.toml`** — one block per rule:
  ```toml
  [[redirects]]
  from = "/about-us"
  to = "/about.html"
  status = 200
  [[redirects]]
  from = "/about.html"
  to = "/about-us"
  status = 301
  force = true
  ```
- **Vercel `vercel.json`** — `rewrites` for the clean URLs, `redirects` (with
  `"permanent": true`) for the `.html → clean` canonicalisation.
- **nginx** — `location = /about-us { try_files /about.html =404; }` for the
  rewrite, plus `location = /about.html { return 301 /about-us; }`.
- **Apache `.htaccess`** — `RewriteRule ^about-us$ about.html [L]` for the
  rewrite, plus `RewriteRule ^about\.html$ /about-us [R=301,L]`.

To exercise the acceptance check locally, run the app (`npm run build && node
dist/index.js`) and request `/`, `/about-us`, `/donate`, `/contact`, `/supporters`. The
`features/site.feature` BDD asserts this end-to-end against the running app, and
`test/unit/clean-urls.test.ts` + `test/unit/site.test.ts` verify the rules
host-free. The `_redirects` file also works as-is on a static host
(e.g. `npx netlify dev`).

### Navigation

Every page mounts the same sticky top nav in its `<header class="nav">` slot
(REQ-002, ported from the NBCC design): the logo lockup (50px) linking to `/`,
links to `/`, `/about-us`, `/donate`, `/contact`, `/supporters`, a persistent
Donate button, and a mobile burger.
Behaviour lives in the one shared `assets/js/main.js` (`initNav`): a passive +
`requestAnimationFrame`-throttled scroll listener flips the bar from transparent
to a cream/hairline/shadow state past 24px; the burger toggles the link panel
(`aria-expanded`/`aria-controls`) and Escape closes it and restores focus. The
current page's link is marked `class="active" aria-current="page"`. Verified by
`test/unit/nav.test.ts` (static markup + jsdom behaviour).

> The brand is the **master logo lockup** (nav 50px, footer 74px) — a lightweight
> ~12 KB display-sized PNG at `assets/img/nbcc-logo.png` with `alt`, intrinsic
> `width`/`height` and `loading="lazy"`. The optimised/responsive asset pipeline
> is REQ-034. Page `<title>`s still carry the "Charity Site" placeholder (a later
> rename).

### Footer

Every page mounts the same maroon footer in its `<footer class="site-footer">`
slot (REQ-003, ported from the NBCC design), **identical across all five pages**:
three columns — the logo lockup (74px) + social links (Instagram/Facebook/X),
**Explore** (the clean URLs `/`, `/about-us`, `/donate`, `/contact`, `/supporters`), and
**Ways to give** (`/donate`, `/contact`) — plus a legal strip carrying the exact,
mandated charity-registration statement (TASK-126): *"Night Before Christmas
Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation.
Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator,
OSCR."* — the `SC047995` wrapping the OSCR register link. This exact wording is
the single source of truth in `src/legal/registration.ts` and also appears in
every donor-facing receipt and thank-you letter (the Corporation Tax receipt +
refund notice in `src/donors/receipt.ts`, and the donation- and refund-
confirmation letters in `src/donors/confirmation.ts`). Styling lives in the
shared `assets/css/styles.css` under a commented `FOOTER (REQ-003)` block (maroon
background, cream text, reuses `--maroon`/`--cream`/`--line`/`--maxw`; columns
stack at ≤680px). The logo is the only `<img>` (social icons are inline SVG) and
declares width/height + `loading="lazy"`, so the perf budget holds. Verified by
`test/unit/footer.test.ts`.

### Accessibility floor — skip link & landmarks (REQ-032)

Every page's `<body>` opens with a **skip link** — `<a class="skip-link"
href="#main">Skip to content</a>` — as its **first focusable element**, so the
first Tab from page load lands on it. It's off-screen until focused (a
token-only `.skip-link` rule near the focus/nav block: cream-on-maroon, sliding
into the top-left over the fixed nav), then the global `:focus-visible` holly
ring applies on top and the `prefers-reduced-motion` off-switch zeroes the
slide. Activating it jumps to `<main id="main" tabindex="-1">`; the `tabindex`
makes `<main>` a valid focus target so focus actually moves into the content
(not just the scroll position).

Each page carries the full semantic landmark set — `<header>`/`<nav>` (REQ-002),
`<main id="main">`, content `<section>`s and `<footer>` (REQ-003) — and every
content `<section>` is **named** via `aria-labelledby` pointing at its heading id
(e.g. the four page-intro sections are named by their `<h1>`), so each surfaces
as a labelled region. The one exception is the `.page-sections[data-region]`
wrapper, an empty/programmatic JS-mount slot that is intentionally left unnamed
(naming it would announce an empty or redundant region). Verified by
`test/unit/skip-link.test.ts` (skip link + focusable `#main` + landmark set +
section naming, per page). The reduced-motion half of REQ-032 lives in the
**Motion system** section above.

**AA floor guard + manual audit.** `test/unit/accessibility.test.ts` enforces the
*structural* WCAG 2.1 AA invariants across all five pages in CI: a skip link as
the first tabbable element targeting an existing `#main`; exactly one `<main>`
plus the header/nav/footer landmarks; non-empty `alt` on every `<img>`
(decorative SVGs use `aria-hidden` instead); a `<label for>` on every form
control with `required` fields also carrying `aria-required`; and the shared
stylesheet's Holly Green `:focus-visible` ring + `prefers-reduced-motion`
off-switch. As with the performance budget, this structural test is paired with a
**full automated audit** that needs a running app + headless Chrome, so run it
manually against the served pages (accessibility is one of Lighthouse's
categories; `axe` is the alternative):

```bash
npm run build && node dist/index.js &     # serve on :3000
npx lighthouse http://localhost:3000/ --only-categories=accessibility --view
# or: npx @axe-core/cli http://localhost:3000/
# repeat for /about-us, /donate, /contact
```

### SEO & social metadata

Every page's `<head>` carries a unique set of SEO + social-share tags following
one shared structure (same tags/order on each page; only the values differ):
`<title>`, `<meta name="description">`, a `<link rel="canonical">`, Open Graph
(`og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`) and
Twitter card tags. `canonical` and `og:url` are absolute and match the clean URL
above; no title/description/canonical is duplicated across pages. Verified by
`test/unit/seo-metadata.test.ts`.

> **Placeholder domain:** canonical/`og:url`/`og:image` use
> `https://www.example.org` because there's no production domain / custom
> hostname yet. Replace it across the five pages + `test/unit/seo-metadata.test.ts`
> in one find/replace when the real domain lands. The share image
> (`/assets/img/og-image.png`) is **referenced only** — the asset/pipeline is
> REQ-034.

### Brand colour system (REQ-004)

All colours are defined once as CSS custom properties in a single `:root` block in
`assets/css/styles.css`. The six official NBCC colours — Deep Crimson `#C02238`
(`--crimson`), Rich Maroon `#800000` (`--maroon`), Natural Cream `#F8F5EE`
(`--cream`), Elfin Tan `#D29C8A` (`--tan`), Dark Slate `#333333` (`--slate`),
Holly Green `#1A531A` (`--holly`) — plus derived surfaces `--card`, `--line`,
`--tan-soft`, `--holly-soft`, `--slate-soft` (and `--cream-NN` alpha tints for
dark surfaces). **Every `color`/`background`/`border` value references a
`var(--…)` token**; the only hex/rgb literals live inside `:root`.

Contrast rule: body/long-form text is never set in Elfin Tan or Holly Green on
cream/card surfaces. Enforced by `test/unit/brand-colours.test.ts`. Typography is
documented below (REQ-005); the logo asset is REQ-034.

### Typography (REQ-005)

Two families, both **self-hosted** as `woff2` in `assets/fonts/` (two files, to
stay within the perf budget's ≤ 2 font files): a **Playfair Display** variable
face covering weights 400–800 for headings (`--font-head`, set in `var(--crimson)`)
and **Poppins 400** for body, nav, buttons and labels (`--font-body`). Each token
includes a system fallback stack. Sizes come from `clamp()` scale tokens —
`--fs-hero`, `--fs-page-intro`, `--fs-section`, `--fs-lede`, `--fs-body`,
`--fs-eyebrow`. The two `@font-face` blocks live in the one shared stylesheet (no
build step); Poppins' medium/semibold (nav/footer 500/600) and Playfair's italic
synthesise from the self-hosted faces. **Google Fonts** (preconnect + a non-`.css`
stylesheet link per page) is the documented alternative. Enforced by
`test/unit/typography.test.ts`.

### Layout, radius and shadow tokens (REQ-006)

Layout primitives live in the same canonical `:root` as the colours and type:

- **Width & padding:** `--maxw: 1180px` caps the shared content container, with
  fluid side padding `--pad: clamp(20px, 5vw, 48px)`. The nav, footer and
  `.site-main` all use this pair, so every page region lines up at 1180 px.
- **Radius:** `--radius: 16px` (cards), `--radius-lg: 24px` (large cards/figures),
  `--radius-pill: 999px` (pills/buttons).
- **Shadows:** three levels, all **warm-tinted off maroon `#800000`** (not neutral
  grey) — `--shadow-sm`, `--shadow`, `--shadow-lg`.
- **Sticky-nav offset:** `--nav-h: 78px`; headings and `[id]` anchors get
  `scroll-margin-top: calc(var(--nav-h) + 1rem)` so anchored content isn't hidden
  under the fixed nav.

Every padding/radius/shadow value references a token (no inline literals — keeps
the brand-colours contract). Enforced by `test/unit/layout-tokens.test.ts`.

### Brand marks (REQ-007)

The signature divider — a thin **Holly Green** hairline with a centred **crimson**
diamond — is the `.rule` component in the shared stylesheet (`BRAND MARKS`
block). It's drawn entirely with pseudo-elements (`::before` = the hairline,
`::after` = a rotated-square diamond with a `--cream` halo) — **no image**, so the
perf budget is unaffected — and uses token-only colours (`--holly`, `--crimson`).
Use it **sparingly, directly under a heading** (`<div class="rule"></div>` sits
under each page `<h1>`); later section heads reuse the same class. Enforced by
`test/unit/brand-marks.test.ts`.

The same `BRAND MARKS` block also sizes the **master logo lockup** — `.brand img`
(nav, 50px) and `.foot-brand img` (footer, 74px) — and gives it clear space (the
footer `margin-bottom` plus the nav `.wrap` gap). The lockup is used whole; see
the Navigation note for the asset (REQ-034 owns the optimised pipeline).

### Motion system (REQ-008)

Restrained, token-driven motion (`--ease`, `--motion-fast`, `--motion`,
`--reveal`, consistent with the nav timings) in the shared `MOTION` CSS block:

- **Scroll reveal:** `.reveal` starts faded + nudged down; `initReveal` in
  `assets/js/main.js` (exported alongside `initNav`) uses an `IntersectionObserver`
  to add `.is-visible` as each element enters the viewport.
- **Hover lifts:** interactive surfaces lift `translateY(-1px)` on hover, following
  the `.nav-cta` pattern — extended to `.card` / `.btn` / `.tier` so they inherit
  it when those arrive (REQ-009).
- **Reduced-motion off-switch (REQ-032):** `@media (prefers-reduced-motion:
  reduce)` disables all transitions/animations (`none !important`) and forces
  `.reveal` fully visible. `initReveal` also reveals everything immediately when
  reduced motion is set or `IntersectionObserver` is unavailable — content is
  never left hidden.

The elements that carry `.reveal` (hero, pillars, tiers) arrive in REQ-010+; this
ships the system + the guard. Verified by `test/unit/motion.test.ts`.

### Global UI components (REQ-009)

Reusable, token-only components in the shared `GLOBAL UI COMPONENTS` block:

- **Buttons** — `.btn` is the pill base (mirrors the `.nav-cta` pattern:
  `--radius-pill`, Poppins, `11px 24px`, `--shadow-sm`) with three variants:
  `.btn-primary` (crimson fill / cream text, maroon hover), `.btn-ghost`
  (transparent + maroon outline/text, fills maroon on hover), `.btn-holly` (holly
  fill / cream text). An **animated arrow** (`.btn::after`, a pseudo-element)
  slides on hover/focus, gated by `--motion-fast`/`--ease` so the
  prefers-reduced-motion off-switch disables it — no `<img>`.
- **Card** — `.card` is the shared surface (`var(--card)` bg, `var(--line)`
  hairline, `var(--shadow)`, `var(--radius)`; `.card-lg` uses `--radius-lg`).

`.btn`/`.card`/`.tier` inherit the hover-lift transition from the MOTION block —
it isn't re-declared. All colours are tokens (no hex/rgb outside `:root`). The
consumers (pillars/tiers/reassurance/team) mount these classes in REQ-010+; this
ships only the system. Verified by `test/unit/ui-components.test.ts`.

### Home hero (REQ-010)

`index.html`'s `<main>` opens with the hero — the first page to mount the design
system as content. It **reuses** existing systems only: the `.btn`/`.card`
components (REQ-009), the `.rule` divider + logo lockup (REQ-007), `.reveal`
(REQ-008) and the `:root` tokens. A `HOME HERO (REQ-010)` CSS block adds only
hero-specific layout (two-column grid stacking ≤680px, `.eyebrow`, the emphasised
`em`/`.allyear` headline treatment, proof-card positioning) — token-only colours.

Content: a crimson eyebrow ("Volunteer run Scottish charity · Annbank, Ayrshire"),
an emotive H1 ("You know us at Christmas. We're here all year.") with an emphasised
element, a lede on the volunteer run, year round mission, two CTAs (**Donate now**
`.btn-primary` → `/donate`, **What we do all year** `.btn-ghost` → `/about-us`), the
logo lockup as the illustration, and a floating proof card (`.card`) reading "7,657
Red Bags Full of Joy delivered in 2025". Honours the copy rules (REQ-031, no dashes)
and accessibility floor (REQ-032: alt text, keyboard-focusable CTAs). Verified by
`test/unit/home-hero.test.ts`.

> The eyebrow uses crimson rather than the baseline's holly green because the
> brand-colours contrast guard forbids holly text on light surfaces; `.hero-emph`
> italic is synthesised (only Playfair 700 normal is self-hosted). The hi-res hero
> logo asset is REQ-034.

### Home pillars (REQ-011)

Below the hero, a tinted band (`HOME PILLARS` CSS block, `var(--holly-soft)`
background, `--radius-lg`) holds four `.card` pillars in a responsive grid
(4-across → 2-col ≤900px → 1-col ≤680px). Each pillar is an `<article class="card
pillar reveal">` with a decorative `aria-hidden` inline-SVG icon (crimson via
`currentColor` — the contrast guard forbids holly text), an `<h2>` title and a
one-line of leaflet copy: **Volunteer run**, **South West Scotland**, **Red Bags
Full of Joy**, **7,657 delivered in 2025**. Reuses `.card`/`.reveal`/tokens only —
no `<img>`, no new fonts, token-only colours. Verified by
`test/unit/home-pillars.test.ts`.

### Home why-your-donation-matters (REQ-012)

After the pillars, a tinted band (`HOME WHY-YOUR-DONATION-MATTERS` CSS block,
`var(--tan-soft)` background, `--radius-lg`) in a two-column layout (copy + photo
slot, stacking ≤680px). The copy column has an eyebrow ("Why your donation
matters"), an emotive `<h2>` ("Every pound reminds someone they have not been
forgotten."), the `.rule` divider under it, two leaflet paragraphs, and a
**Support NBCC** `.btn-primary` linking to `/donate`. The photo column is a
`.photo-slot` placeholder (a `<figure>` with a decorative camera icon + caption,
**no `<img>` yet** — the real packing/delivery photo is REQ-034). Token-only
colours, reusing `.btn`/`.rule`/`.reveal`/`.card` tokens. Verified by
`test/unit/home-why.test.ts`.

### Closing CTA strip (REQ-013)

A reusable crimson conversion panel (`CLOSING CTA STRIP` CSS block,
`background: var(--crimson)`, cream text, `--radius-lg`, centred) at the foot of
`<main>` on **index.html and about.html only** (donate/contact are out of scope).
Each is a semantic `<section class="closing-cta reveal" aria-labelledby="...">`
with an `<h2>` and a **Donate now** `.btn-primary` → `/donate`. The structure is
shared; only the headline differs: Home is "Help us reach even more in 2026",
About is "Be part of the next chapter". On the crimson strip the global
`.btn-primary` is reused with a scoped token-only inversion (cream fill, crimson
text) so it stays high-contrast (REQ-032) — matching the prototype; the global
button is unchanged. Token-only colours, `.reveal` reused. Verified by
`test/unit/closing-cta.test.ts`.

### About intro (REQ-014)

`about.html`'s `<main>` opens with a centred intro (`ABOUT INTRO` CSS block) that
reuses the home systems: a crimson `.eyebrow` ("About us"), the base `<h1>`
("Powered by kindness, driven by community"), the `.rule` divider under it, and a
`.lede` introducing **The Night Before Christmas Campaign (NBCC)** in Annbank,
Ayrshire, supporting children, young people and vulnerable adults across South
West Scotland, from Girvan to Largs. The full name is introduced with the acronym
so the copy still leads with "NBCC" elsewhere (REQ-031). No new fonts/images,
token-only; the `.page-sections` placeholder and the closing CTA strip are kept.
Verified by `test/unit/about-intro.test.ts`.

### About our story (REQ-015)

Below the intro, a two-column "our story" section (`ABOUT OUR STORY` CSS block)
tells the founding narrative: an "Our story" `<h2>` (styled as the eyebrow), the
founding quote "Do all children get a Christmas Eve box like I do?" (Playfair
italic, crimson) attributed to **Tygan, age twelve, Annbank, 2015**, the origin
paragraphs, and a captioned headshot placeholder — a `.photo-slot` `<figure>` with
a decorative `aria-hidden` person icon and a `<figcaption>` (no `<img>` yet; the
real Tygan headshot is REQ-034). This is the one section carried from the existing
NBCC site rather than the 2025 leaflet, so its copy is flagged with a
`CONTENT VERIFICATION` HTML comment. Reuses `.photo-slot`/`.reveal`/tokens;
token-only colours. Stacks ≤680px. Verified by
`test/unit/about-our-story.test.ts`.

### About meet-the-team grid (REQ-016)

Below the story, a tinted band (`ABOUT MEET THE TEAM` CSS block,
`var(--holly-soft)`, `--radius-lg`) holds a responsive grid of ten member cards
(`.team-grid`: 5-across desktop → 3 ≤900px → 2 ≤680px, mirroring `.pillar-grid`).
Each `.member` is a 4:5 `.photo-slot` portrait placeholder (decorative
`aria-hidden` person icon, **no `<img>`** — real headshots are REQ-034) with a
Playfair crimson `.member-name` and a `.member-role`: Tygan/Founder,
Jodie/Head Elf and Founder, Isabella/Co founder, Jaimie/Donations, then six
**Volunteer Elf** placeholders (Dawn, Jill, Jon, Kenny, Liz, Vicky) flagged with a
`CONTENT VERIFICATION` HTML comment for NBCC to confirm. Semantic `<section>` named
by its `<h2>` (REQ-032); token-only colours; `.reveal` reused. Verified by
`test/unit/about-team.test.ts`.

### About age-reach figures (REQ-017)

Below the team, a maroon band (`ABOUT AGE-REACH FIGURES` CSS block,
`var(--maroon)`, `--radius-lg`) presents the 2025 reach by age. A semantic
`<dl class="ages">` holds eight `.age` name/value pairs — `<dt class="age-label">`
the age band, `<dd class="age-num">` the count — laid out 8-across desktop → 4
≤900px → 2 ≤680px. Each band shows the figure on top (Playfair `--font-head`,
REQ-005) with the label beneath; `column-reverse` keeps the markup a valid
`<dt>`-before-`<dd>` pair. The eight counts total **exactly 7,657**: 0 to 12
months 182, 1 to 3 years 762, 4 to 7 years 1,663, 8 to 11 years 1,990, 12 to 15
years 1,719, 16 to 17 years 587, 18 and over 528, not stated 226. Cream-on-maroon
tints only — eyebrow/heading/labels in `--cream`/`--cream-82`, never tan/holly
body text — following the footer's token approach; **no image tags** so the perf
budget holds. Age ranges are written with "to"/"and over"/words (no dashes,
REQ-031). Semantic `<section>` named by its `<h2>` (REQ-032), reusing the `.rule`
divider (REQ-007) and `.reveal` (REQ-008); token-only colours. Verified by
`test/unit/about-age-reach.test.ts`.

### About top-10 communities (REQ-018)

Below the age-reach band, a tinted band (`ABOUT TOP-10 COMMUNITIES` CSS block,
`var(--holly-soft)`, `--radius-lg`, mirroring `.meet-team`/`.pillars`) ranks the
ten communities NBCC reached most in 2025. A semantic `<ol class="communities">`
carries the rank order; each `<li class="rank">` lays out rank position, name, a
**pure-CSS** horizontal bar (`.rank-bar` track + `.rank-fill`), and the value
(count plus that community's share of the 7,657 total). Each bar's width is
**proportional to Ayr at 100%** — set via the `--w` custom property
(`count ÷ Ayr's 2,096`), so Ayr is full width: Ayr 2,096 (27.4%), Kilwinning 692
(9.0%), Stevenston 547 (7.1%), Kilmarnock 532 (6.9%), Auchinleck 510 (6.7%),
Maybole 370 (4.8%), Dalmellington 332 (4.3%), Ardrossan 301 (3.9%), Irvine 280
(3.7%), Girvan 205 (2.7%). Counts render in Playfair (`--font-head`, REQ-005);
the fill is a `--crimson`→`--maroon` gradient on a `--tan-soft` track. **No image
tags** — bars are CSS, so the perf budget holds. Responsive down to ~360px (the
bar drops onto its own full-width row below ~560px). Semantic `<section>` named
by its `<h2>` (REQ-032), reusing the `.rule` divider (REQ-007) and `.reveal`
(REQ-008); copy is dash-free (REQ-031); token-only colours. A geographic map is
explicitly a later enhancement, out of scope here. Verified by
`test/unit/about-top-communities.test.ts`.

### Donate intro (REQ-019)

`donate.html`'s `<main>` opens with a centred intro (`DONATE INTRO` CSS block,
mirroring `ABOUT INTRO`) that reuses the home systems: a crimson `.eyebrow`
("Donate"), the base `<h1>` ("Your gift becomes someone's Christmas"), the
`.rule` divider under it (centred by the `.donate-intro` auto-margin, as on
`.about-intro`), and a `.lede` noting that everyone at **NBCC** is a volunteer and
that **around £50 is the value of one Red Bag Full of Joy**, with a give-once or
give-monthly framing. Copy leads with "NBCC" and is dash-free (REQ-031). No new
fonts/images, token-only colours; the `.page-sections` placeholder (for the give
widget, REQ-020+) and the shared nav/footer are kept. Verified by
`test/unit/donate-intro.test.ts`.

### Give widget shell (REQ-020)

Inside the donate `.page-sections` slot, below the intro, the give widget
(`GIVE WIDGET` CSS block) is the conversion card: a `.give-card` two-column grid
on the shared `.card`/`.card-lg` surface (REQ-009) that stacks ≤680px — a main
column (the once/monthly toggle and the tier containers) beside a **Holly Green**
(`var(--holly)`) side panel. The panel is **cream-on-holly** only (eyebrow/text in
`--cream-82`, never holly body text), inverted like the `.age-reach`/footer tints
so the `brand-colours` guard holds; token-only colours, no hex/rgb outside
`:root`. The mode toggle is a segmented pill of two labelled `<button>`s ("Give
once" / "Give monthly") with `aria-pressed` + `aria-controls`, wired by a new
`initGiveToggle()` in `assets/js/main.js` (exported and called alongside
`initNav`/`initReveal`). It shows/hides two placeholder tier containers,
`#tiersOnce` and `#tiersMonthly`; **give monthly is the default** (leaflet
emphasis) and the markup ships with `#tiersOnce` `hidden`, so it works without JS
(progressive enhancement) and native buttons give keyboard activation for free
(no animation, reduced-motion safe). Tier content is out of scope here — REQ-021
mounts the one-off amounts into `#tiersOnce`, REQ-022 the monthly plans into
`#tiersMonthly`, and REQ-024 fills the side panel (each named in HTML comments).
Semantic `<section>` named by its `<h2>` (REQ-032); copy uses "give once"/"give
monthly" and "NBCC", dash-free (REQ-031). Verified by
`test/unit/give-widget.test.ts` (static markup + the toggle behaviour in jsdom).

### Give once tiers (REQ-021)

The give-once amounts are mounted into the shell's `#tiersOnce` container
(`GIVE ONCE TIERS` CSS block): four selectable amount tiles plus a
choose-your-own-amount field, laid out on the shared `.give-tiers` grid (two
columns, collapsing to one ~360px). Each amount is a `.card.tier.give-tier`
`<button>` — reusing the `.card`/`.tier` surface (REQ-009) and the hover-lift
(REQ-008) — showing a Playfair crimson `.give-amount` and a `.give-tier-desc`:
**£10** (cosy essentials), **£25** (towards a Red Bag, marked **"Most chosen"**
via a floating `.give-flag` on the crimson-outlined `.is-featured` tile), **£50**
(one full Red Bag) and **£100** (a whole family). The custom option is a
full-width `.give-tier-custom` card with a real `<label for="customAmount">` tied
to a number `#customAmount` input (REQ-032). Token-only colours, no hex/rgb
outside `:root`; copy is dash-free and uses "NBCC" (REQ-031). These one-off
amounts are flagged with a `CONTENT VERIFICATION (REQ-021)` comment — the 2025
leaflet specifies only monthly tiers, so they are a suggestion to confirm. Each
tile now carries the `data-mode`/`data-plan`/`data-amount` + `startCheckout`
checkout contract (REQ-028, see **Checkout contract** below). Verified by
`test/unit/give-once-tiers.test.ts`.

### Give monthly tiers (REQ-022)

The monthly plans are mounted into the shell's `#tiersMonthly` container (the
default-visible group) and **reuse** the GIVE ONCE TIERS surface — the same
`.give-tiers` grid, `.card.tier.give-tier` tiles, `.give-amount`,
`.give-tier-desc`, and `.is-featured`/`.give-flag`. A small `GIVE MONTHLY TIERS`
CSS block adds only the monthly-specific pieces: the `.give-tier-name`, the
`.give-cadence` ("per month") label on the `.give-price` row, the
`.give-tier-head` headline, and the `.give-other` contact line. The four leaflet
tiers carry their exact copy and order: **Bronze £10 per month** ("Building
towards Christmas joy"), **Silver £25 per month** ("Halfway to a Red Bag Full of
Joy"), **Gold £50 per month** ("One Christmas made brighter", marked **"Around
one Red Bag"** on the featured tile), and **Platinum £100 per month** ("More joy,
every month"), each with its leaflet description. A `.give-other` line links to
`mailto:giving@nightbeforechristmas.co.uk` for other monthly amounts. Token-only
colours, no hex/rgb outside `:root`; copy is dash-free and uses "NBCC" / "per
month" (REQ-031). Each tile now carries the `data-mode`/`data-plan`/`data-amount`
+ `startCheckout` checkout contract (REQ-028, see **Checkout contract** below).
Verified by `test/unit/give-monthly-tiers.test.ts`.

### Gift Aid callout (REQ-023)

Beneath the tiers in the `.give-main` column sits a holly-tinted Gift Aid opt-in
(`GIFT AID CALLOUT` CSS block): a `#giftAid` checkbox tied to a real
`<label for="giftAid">`. The label leads with plain-language framing — Gift Aid
grows an eligible gift by **25%** (NBCC reclaims 25p per £1 from HMRC, at no cost
to the donor) — then shows the **verbatim HMRC declaration** the tick actually
agrees to (REQ-042). The box is **not** pre-ticked — the donor opts in. Token-only
colours: to satisfy the `brand-colours` guard (no holly *text* on light surfaces)
the emphasis is `--maroon` and the tick `accent-color` is `--crimson`, on a
`--holly-soft` panel with a `--holly` border; the checkbox keeps the global
`:focus-visible` holly ring (REQ-032). Copy is dash-free and names "NBCC"
(REQ-031). The `#giftAid` id is the hook the **REQ-028** checkout contract reads:
`startCheckout` folds its checked state into the payload (the live POST target
`/api/checkout-session` is REQ-029).

**Versioned, mode-matched declaration wording (REQ-042).** The statement shown is
the exact `wording_snapshot` from `src/declarations/wording.ts` (the versioned
source of truth, TASK-049): the **single-donation** template for **give once** and
the **all-donations** template for **give monthly** (the default). Both statements
ship inside the label as `.giftaid-statement[data-mode]` spans — monthly visible,
once `hidden` — and `initGiveToggle` swaps the visible one with the give mode,
exactly as it toggles `#tiersOnce`/`#tiersMonthly`. A `.giftaid-statement[hidden]`
`display:none` rule collapses the inactive one (a `display` rule otherwise beats
the bare `hidden` attribute, the same reason the `DONOR TYPE` block needs
`.giftaid[hidden]`). There is no build step, so the wording is hand-synced into
`donate.html`; `test/unit/gift-aid.test.ts` imports both snapshots and fails the
moment the page copy drifts from the source of truth.

> **Gating — pending registration decision (REQ-023).** The callout is shown only
> if NBCC is registered with HMRC to claim Gift Aid (flagged with a
> `CONTENT VERIFICATION (REQ-023)` comment). It is wrapped by a single documented
> switch: the `<!-- GIFT AID CALLOUT START (REQ-023) -->` … `<!-- GIFT AID CALLOUT
> END (REQ-023) -->` comment pair in `donate.html`. **To remove it cleanly if NBCC
> is not registered**, delete everything between those two markers, then delete the
> matching `.giftaid` rules (the `GIFT AID CALLOUT (REQ-023)` block) in
> `assets/css/styles.css`. No other markup depends on it.

Verified by `test/unit/gift-aid.test.ts`.

### Donor-type routing (REQ-038)

At the top of the give-card's `.give-main` column, above the once/monthly toggle,
the tiers and the Gift Aid callout, a `.give-donor` `<fieldset>` (`DONOR TYPE` CSS
block) asks **"Are you donating as an individual or on behalf of a business?"** —
two native radios (`#donorIndividual` / `#donorBusiness`, each with a real
`<label for>`, REQ-032) defaulting to **individual**, so the Gift Aid path works
without JS. Helper text explains a **sole trader** and **business partners** are
individuals in law and keep Gift Aid, while only an **incorporated company (Ltd,
PLC, LLP)** takes the path with no Gift Aid. An optional business-name field
(`#businessName`, a real `<label for>`) is a **Donors Page display label only** and
**never** switches the Gift Aid path.

`initDonorType` in `assets/js/main.js` (exported and called alongside
`initGiveToggle`/`initCheckout`) wires the radios: choosing **A business** hides
and unticks the `#giftAid` callout (a company cannot claim Gift Aid) and reveals
the business-name field; **Individual** restores the callout and hides the field.
Because the callout is `display:flex`, the `DONOR TYPE` block adds
`.giftaid[hidden]` / `.give-business[hidden]` `display:none` rules so the bare
`hidden` attribute actually collapses them. On wiring, the control is marked
`data-ready`, so `startCheckout` folds **`donorType`** (and **`businessName`** when
filled) into the REQ-028 payload only once the enhancement is active — the base
`{ mode, plan, amount, giftAid }` contract is unchanged without JS. Token-only
colours (slate body, maroon legend, crimson accents; the `brand-colours` guard
forbids holly/tan text here). Dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/give-donor-type.test.ts`.

### Contact capture (REQ-039)

Below the donor-type fieldset and above the tiers, a `.give-contact` `<fieldset>`
(`CONTACT CAPTURE` CSS block) captures consent-based contact details: a **required**
full name (`#donorName`, `required` + `aria-required`), an **optional** email
(`#donorEmail`) paired with an email-consent checkbox (`#emailConsent`) that is
**never ticked in advance** (NBCC only emails with clear permission), an anonymous
option (`#anonymousDonor`) that keeps the gift off the public Donors Page, and a
monthly-only **18 or over** confirmation (`#ageConfirmed`). Every control has a real
`<label for>` (REQ-032). The 18+ row (`#ageConfirmField`) shows **only in give-monthly
mode**: `initGiveToggle` toggles it alongside the tier swap and the Gift Aid statement,
and a `.give-age[hidden]` rule collapses the flex row (mirroring `.giftaid[hidden]`); it
ships visible because monthly is the default. `initContactCapture` marks the fieldset
`data-ready`, so `startCheckout` folds **`fullName`**, **`email`**, **`emailConsent`**,
**`anonymous`** and (monthly) **`ageConfirmed`** into the REQ-028 payload only once the
enhancement is active — the base `{ mode, plan, amount, giftAid }` contract is unchanged
without JS (durable persistence is the REQ-039 webhook/back-end, out of scope here).
Token-only colours (slate body, maroon legend, crimson accents; the `brand-colours`
guard forbids holly/tan text here). Dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/give-contact-capture.test.ts`.

**Server-side (REQ-039, revised):** `POST /api/checkout-session` now requires a
valid `email` for the individual/partnership donor paths — a missing or
malformed email is rejected with 400. A company donation is exempt, since it
already carries its own required `company.contactEmail`. Email is always
stored (not gated on `emailConsent`, which now governs marketing consent only)
so every donor can be sent a thank-you and a donor-portal link; see
`test/unit/checkout-session.test.ts` and the `features/checkout.feature`
"without an email is rejected" scenario.

### Gift Aid declaration capture (REQ-043)

Below the Gift Aid callout, a `.give-declaration` `<fieldset>` (`GIFT AID DECLARATION`
markup) captures the HMRC declaration: an optional `title` and a **required** first name
(`#declFirstName`), last name (`#declLastName`) and house name/number (`#declHouse`) — the
HMRC matching keys, all `required` + `aria-required` — plus the **one** home address
(`#declAddress`, no work / c-o address) and a `postcode` (`#declPostcode`). An overseas-address
checkbox (`#declNonUk`, no UK postcode — e.g. Channel Islands / Isle of Man) drives
`initDeclarationCapture`, which **hides, disables and un-requires** the postcode. That flag is
only an HMRC matching detail; Gift Aid **eligibility** is paying UK Income Tax / CGT (the
verbatim taxpayer declaration the donor agrees to on submit), never a postcode. A short note by
the declaration says so, so an overseas UK taxpayer knows they can still Gift Aid. Every
field has a real `<label for>` (REQ-032). `initDeclarationCapture` marks the fieldset
`data-ready`, so `startCheckout` folds a **`declaration`** object (`{ title?, firstName,
lastName, houseNameNumber, address, postcode?, nonUk, scope }`) into the REQ-028 payload
**only when `#giftAid` is checked** (mirroring the `donorType` gate) — a declaration is made
only with Gift Aid, and without JS the base `{ mode, plan, amount, giftAid }` contract is
unchanged. A `#declScope` radio pair (REQ-044 · TASK-064) keyed to the `declarations.scope`
values — `all_donations` (this gift plus the past 4 years and future) vs `this_donation` —
**defaults from the give mode**: `initDeclarationCapture` sets it and `initGiveToggle`
re-syncs it (`all_donations` for monthly, `this_donation` for once, alongside the tier and
Gift Aid statement swap) until the donor picks one, after which their choice sticks. The
field validation + declarations-row builder it feeds is `src/declarations/fields.ts`
(REQ-043 · TASK-061), which **accepts** the explicit `scope` (so the strict schema does not
reject it); the checkout endpoint validates + stamps the declaration and the webhook persists
an immutable `declarations` row (TASK-063). The donor's explicit `scope` now **overrides** the
give-mode default when present (REQ-044 · TASK-065) — a one-off donor can opt into an enduring
`all_donations` declaration — and requests that omit it fall back to the mode-derived default,
so the no-JS/no-choice path is unchanged. Token-only colours
(slate body, maroon legend, crimson accents). Dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/declaration-capture.test.ts`.

### Partnership donor path (REQ-051)

Choosing **A business** reveals a sub-type question (`#businessTypeField`, `businessType`
radios) — an **incorporated company** (no Gift Aid) or a **business partnership** (partners
are individuals in law, so Gift Aid stays). `initDonorType` derives the donor path
(`currentDonorPath`: `individual` / `company` / `partnership`) from the donor-type +
sub-type radios and drives visibility: the company path hides + unticks the Gift Aid callout;
the **partnership** path keeps it and swaps the single `.give-declaration` for the repeatable
`.give-partners` `<fieldset>` (one Gift Aid declaration per partner). `initPartnershipCapture`
clones `#partnerRowTemplate` into one partner row on load and wires **add** (`#addPartner`) /
**remove** (`[data-remove-partner]`, hidden while one partner remains); each row captures the
same declaration fields as `.give-declaration` (with its own overseas-address postcode toggle) **plus a
required share** of the gift, and gets a per-row unique id base (`partner-N-*`) so every
`<label for>`/input id stays matched and unique (REQ-032). `startCheckout` folds a **`partners`**
array (`[{ title?, firstName, lastName, houseNameNumber, address, postcode?, nonUk, sharePence }]`,
share captured in pounds → pence) into the REQ-028 payload **instead of** a single `declaration`
**only** on the partnership path with `#giftAid` checked; the shares must sum to the donation
total, which the pure `validatePartnerShares` (`src/declarations/partnership.ts`, REQ-051 ·
TASK-079) enforces server-side. Without JS the base `{ mode, plan, amount, giftAid }` contract
is unchanged. Token-only colours; dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/give-partnership.test.ts`.

### Company capture (REQ-038 · TASK-084)

On the **incorporated-company** path a `.give-company` `<fieldset>` (`#companyCapture`)
captures the company-specific fields: an **optional** registration number
(`#companyRegNumber`) plus a **required** contact name (`#companyContactName`), contact email
(`#companyContactEmail`, a real email input), billing address (`#companyBillingAddress`) and
billing postcode (`#companyBillingPostcode`) — each `required` + `aria-required` with a real
`<label for>` (REQ-032); the company's legal name is the existing `#businessName` field.
`initDonorType` reveals `.give-company` **only** on the company path (the `.give-company[hidden]`
rule collapses the flex/grid box) and **disables** its inputs otherwise, so a hidden required
field never blocks submission or leaks a value. `startCheckout` folds a **`company`** object
(`{ legalName, registrationNumber, contactName, contactEmail, billingAddress, billingPostcode }`)
into the REQ-028 payload on the company path and **forces `giftAid: false`** (an incorporated
company can never claim Gift Aid — its callout is already hidden by REQ-038). The individual and
partnership paths are unaffected (no `company` object). The consent-based
`#anonymousDonor`/contact capture (REQ-039) is reused as-is. Token-only colours; dash-free copy,
"NBCC" (REQ-031). Verified by `test/unit/give-company-capture.test.ts`.

The fieldset also asks (REQ-053 · TASK-087) whether **NBCC gave anything of value in return**
(advertising, logo placement) — a **required** Yes/No radio pair (`#companyConsideration`, real
labels) defaulting to **No** (a genuine donation). `startCheckout` folds it as
`company.considerationGiven` (true only on "Yes"); `companyFieldsSchema` accepts the flag (so the
`.strict()` schema does not reject the widget's payload). A gift **with** consideration is not a
plain donation — the receipt guard `classifyCompanyGift` (`src/donors/receipt.ts`, TASK-086)
returns `flag_for_trustees` for it instead of issuing a Corporation Tax receipt.

### Give side panel content (REQ-024)

The give-card's Holly Green `.give-side` `<aside>` is filled out (`GIVE SIDE
PANEL` CSS block, next to `GIVE WIDGET`): a "Where your gift goes" eyebrow and
short lede, a semantic `.side-list` of **three** points (thoughtful gifts and
essential support not salaries; the everyday costs of keeping NBCC running;
reaching **children, young people and vulnerable adults** in hardship), then a
`.side-foot` with the **SC047995** charity number — linked to the OSCR register,
reusing the footer's reference style — and four payment-method chips (**Card,
Direct Debit, Apple Pay, Google Pay**) as a labelled `.side-pay` list of pure-CSS
pills. Inverted **cream-on-holly** tints only (text `--cream`/`--cream-82`/
`--cream-90`, chip surfaces `--cream-12`/`--cream-16`), never holly/tan body text,
so the `brand-colours` guard holds; the check icons are inline SVG via
`currentColor`, `aria-hidden`, **no `<img>`** so the perf budget holds (REQ-032).
Dash-free copy, "NBCC" (REQ-031). **Out of scope here:** the reassurance items
(REQ-026), the monthly donor benefits (REQ-025), and the checkout contract
(REQ-028). Verified by `test/unit/donate-side-panel.test.ts`.

### Monthly donor benefits (REQ-025)

Below the give widget, still inside the donate `.page-sections` slot, a **tan-soft
tinted band** (`MONTHLY DONOR BENEFITS` CSS block) thanks monthly donors, reusing
the `.why`/`.meet-team` band pattern (`--radius-lg`, clamp padding). It is a
semantic `<section class="donor-benefits">` named by its own `<h2>`
("What monthly donors receive") via `aria-labelledby` (REQ-032), with an eyebrow,
a centred `.rule`, and a `.reveal` intro. Two `.card` `.benefit-group` columns make
the split **structurally clear**:

- **All monthly donors** — your name (or business name) added to the **Donors
  Page** unless you choose to stay anonymous (cross-linked to the **Supporters
  page** `/supporters`, REQ-035), plus a post Christmas impact update.
- **Platinum donors also receive** — a social media thank you, an optional
  **digital supporter badge**, and a personalised **supporter certificate**.

On this light surface body text stays `--slate` with maroon headings and crimson
check icons, never holly/tan, so the `brand-colours` guard holds; the check icons
are inline SVG via `currentColor`, `aria-hidden`, **no image tags** so the perf
budget holds. Dash-free copy, "NBCC" in full, and the **children, young people and
vulnerable adults** phrasing (REQ-031). Verified by
`test/unit/monthly-donor-benefits.test.ts`.

### Donate reassurance (REQ-026)

The last band in the donate `.page-sections` slot, below the monthly donor
benefits and before the footer, is a row of **three `.card` trust items**
(`DONATE REASSURANCE` CSS block). It is a semantic `<section class="reassure">`
named by its own `<h2>` ("Giving with confidence") via `aria-labelledby`
(REQ-032), with an eyebrow, a centred `.rule`, and a `.reveal` intro. Each item
carries an inline-SVG icon and a heading + line:

- **Cancel any time** — monthly gifts can be changed or cancelled whenever you
  like; Direct Debits are protected by the **Direct Debit Guarantee**.
- **Secure and simple** — donations are handled securely by **Stripe**; monthly
  giving should be set up by adults aged **18 or over**.
- **Need a hand?** — contact **Jaimie Wakefield** by email
  (`mailto:giving@nightbeforechristmas.co.uk`) or phone (`tel:+441292811015`,
  shown as **01292 811 015**).

On this light surface body text stays `--slate` with maroon titles and crimson
icons, never holly/tan, so the `brand-colours` guard holds; icons are inline SVG
via `currentColor`, `aria-hidden`, **no image tags** so the perf budget holds. The
email and phone are real links with accessible text that keep the global
`:focus-visible` ring (REQ-032). Dash-free copy, "NBCC" not "NB4CC" (REQ-031).
Verified by `test/unit/donate-reassurance.test.ts`.

### Contact page (REQ-027)

`contact.html` opens with a centred intro (`CONTACT PAGE` CSS block) mirroring the
About/Donate intros — a crimson `.eyebrow` ("Contact"), a base `<h1>`, the
centred `.rule`, and a `.lede`. Below it a two-column `.contact-grid` pairs NBCC's
contact points with the enquiry form:

- **Contact points** — four `.card` tiles, each with an inline `aria-hidden` SVG
  icon: general enquiries (`info@nightbeforechristmas.co.uk`), the phone
  (`tel:+441292811015`, shown as **01292 811 015**), donations via **Jaimie
  Wakefield** (`giving@nightbeforechristmas.co.uk`), and **Annbank Village Hall**
  as the base.
- **Enquiry form** — a `.card` form with a real `<label for=…>` on every field
  (REQ-032): required **First name**, optional **Last name**, required **Email**,
  required **Message** `<textarea>`; required fields carry `required` +
  `aria-required` and a `*` marker.

`initContactForm()` in the shared `assets/js/main.js` (exported alongside
`initNav`/`initReveal`/`initGiveToggle`) validates the required fields and the
email format on submit, surfaces inline errors via `aria-invalid` +
`aria-describedby`, and on a valid submit shows a cream-on-holly success message
(the preview behaviour). In production it best-effort POSTs
`{firstName,lastName,email,message}` to **`/api/contact`** and falls back to the
visitor's mail client (`mailto`) if that endpoint is absent or unavailable; the
endpoint itself is **REQ-030** (out of scope here, currently a `501` stub). Inputs
keep the global `:focus-visible` holly ring. Token-only colours honouring the
`brand-colours` guard (slate body, maroon labels, crimson icons, never holly/tan
text); inline SVG icons, no image tags. Dash-free copy, "NBCC" in full (REQ-031).
Verified by `test/unit/contact.test.ts` (static markup + jsdom validation
behaviour).

### Supporters page (REQ-035)

`supporters.html` opens with a centred intro (the `SUPPORTERS PAGE` CSS block,
mirroring the About/Donate/Contact intros) and then fills its `.page-sections`
slot with the tiered supporters list (`SUPPORTERS TIERS` block). Three
`.supporter-tier` tinted bands — **Bronze → Silver → Gold**, in that order,
alternating tan/holly tint — each hold a `.supporter-grid` of `.card` entries
listed **alphabetically within the tier**. Every entry carries a
`data-type="person"`/`"organisation"` marker, a decorative `aria-hidden` inline
SVG icon (person vs building, no image tags), and a visible **Individual** /
**Organisation** label so the person-vs-brand distinction is clear to sighted and
assistive-tech users. Reuses `.card` / `.reveal` / the pillars-and-why
tinted-band pattern / tokens; icons are crimson (the `brand-colours` guard forbids
holly/tan text on light bands). Dash-free copy, "NBCC" (REQ-031). The entries are
**placeholder** (`CONTENT VERIFICATION`) pending the charity's real, consented
list; it also serves as the **Donors Page** referenced by REQ-024/REQ-025.

**Rendering (TASK-071):** the `/supporters` clean URL is **rendered server-side**
from the real donor records, not served as the static file. `GET /supporters`
(`src/routes/site.ts`) calls `listPublicSupporters` (`src/db/donations.ts`), which
selects each donor with a donation and their **largest gift**, then the pure
`groupPublicSupporters` (`src/db/donations-model.ts`) drops anonymous donors (via
`isPubliclyListable`), derives each donor's tier from the amount using the
give-monthly thresholds (bronze £10 / silver £25 / gold £50 / platinum £100 — a
platinum-level gift folds into the top **Gold** tier), and sorts each tier
alphabetically. A **company** (or any donor carrying a `business_name`) is listed by
its business name, an **individual** by full name; the `person`/`organisation` marker
comes from `donor_type`. The rendered HTML is injected into the **same**
`supporters.html` markup, which stays the **template and the fallback** (served as-is
if the DB read fails).

`supporters.html`'s own static entries remain **placeholder** (`CONTENT
VERIFICATION`) and are what the structure guards read: `test/unit/supporters.test.ts`
(three tiers in order, alphabetical within each, person + organisation both render)
plus `copy-rules`/`accessibility`/`brand-colours` auto-cover the file and stay green.
The server-render is covered DB-free by `test/unit/supporters-render.test.ts` +
`test/unit/supporters-read.test.ts` (pure grouping + HTML injection, mocked pool), and
DB-backed end to end by `features/supporters.feature` (seed via the signed webhook,
then assert a non-anonymous individual and company appear and an anonymous donor never
does). This **supersedes** the earlier "list lives in hand-edited HTML" decision for
donation-sourced entries; the rationale and rejected alternatives are recorded in
`docs/superpowers/specs/2026-07-01-supporters-list-design.md`.

### Confirmation page (REQ-035)

`thank-you.html` is the post-payment confirmation page Stripe redirects the donor
to on a successful checkout — it is the target of `STRIPE_SUCCESS_URL` at the clean
URL `/donate/thank-you`. It is the fifth clean-URL page and shares the same nav /
footer / `assets/css/styles.css` / `assets/js/main.js` as the rest of the site,
with its own unique SEO + social metadata (`test/unit/seo-metadata.test.ts`). A
centred intro (the `CONFIRMATION` CSS block, mirroring the About/Donate/Contact/
Supporters intros) sits above a single reassurance `.card` in the `.page-sections`
slot. The copy thanks the donor, **notes that a confirmation email follows when an
email address was provided** (the email-send task owns actually sending it),
explains how a monthly gift continues, and links back into the site. Being a
landing page rather than a nav destination, no nav link is marked active. Dash-free
copy, "NBCC" in full (REQ-031); skip-link + landmarks (REQ-032). Online declarations
need **no 30-day confirmation letter**, so this page and its email are the whole of
the post-gift confirmation. `clean-urls` / `site` / `seo-metadata` / `copy-rules` /
`accessibility` auto-cover the page and stay green.

### Donor portal page (REQ-061 · TASK-104)

`portal.html` is the **self-serve donor portal** page, served at the clean URL
`/donor-portal` and reached via the one-time magic-link token in the URL query
string (`?token=…`, issued by TASK-100). It shares the same nav / footer /
`assets/css/styles.css` / `assets/js/main.js` shell as the rest of the site, with
its own unique SEO metadata and a `noindex` robots tag (it is a private, token-gated
page). A centred intro (the `DONOR PORTAL` CSS block) sits above a stack of `.card`
sections. `initPortal` (`assets/js/main.js`, exported + unit-tested like
`initContactForm`) reads the token from the query string and, on load, calls **`GET
/api/portal/:token`**, rendering the donor's name/email, monthly-gift plan and Gift
Aid status from the snapshot. Cancelling the monthly gift is **gated behind a
reduce-instead choice** (REQ-055): the cancel action lives inside `#reduceChoice`,
which stays hidden until the donor asks to cancel, so reducing is always offered
first; confirming posts to **`POST /api/portal/:token/subscription/cancel`** with
`accepted: 'cancel'` and the snapshot's `subscriptionId`. A Gift Aid cancel control
posts to **`POST /api/portal/:token/gift-aid/cancel`** (TASK-103). To drive the
cancel flow, `getDonorPortalSnapshot` (`src/db/portal.ts`) now also returns
`subscriptionId` (the most-recent monthly-gift donation's Stripe subscription id, or
null). A **donation-history dashboard** (REQ-061 revised, TASK-122) renders the
snapshot's `history` field (`{ totalPence, count, donations[] }`, aggregated by the
donor's email): a "Your giving" card shows the running total and donation count, and
a per-donation table (date, amount, type, Gift Aid, status), with an empty-state note
when the donor has no recorded donations. Being a private landing page, no nav link is
marked active. Dash-free copy,
"NBCC" in full (REQ-031); skip-link + landmarks (REQ-032). Proven by
`test/unit/donor-portal.test.ts` (static markup + jsdom against the real `initPortal`)
and the `@db`-free `features/site.feature` clean-URL rows; `seo-metadata` /
`copy-rules` / `accessibility` register the page and stay green.

### Privacy notice page (REQ-064 · TASK-111)

`privacy.html` is the data-protection **privacy notice**, served at the clean URL `/privacy` and
sharing the same nav / footer / `assets/css/styles.css` / `assets/js/main.js` shell as the rest of the
site, with its own unique SEO metadata. A centred intro (the `PRIVACY NOTICE` CSS block) sits above a
single readable `.card` of prose covering what NBCC collects, why, the legal basis, sharing (never
sold), the six-year Gift Aid retention window, and the donor's rights. It is linked from the **footer**
and, per REQ-039/REQ-064, from **next to the consent controls** on the two pages that capture personal
data: the contact enquiry form (`contact.html`) and the donate give-widget contact-capture fieldset
(`donate.html`, alongside `#emailConsent`/`#anonymousDonor`). Being a reference page rather than a nav
destination, no nav link is marked active. Dash-free copy, "NBCC" in full (REQ-031); skip-link +
landmarks (REQ-032). Registered in the sitewide `seo-metadata` / `accessibility` / `copy-rules` /
`clean-urls` / `site` guards and the `dockerfile-site-assets` COPY check; the two consent-adjacent
links and the clean-URL wiring are proven by `test/unit/privacy-links.test.ts`, and `/privacy` serving
end to end by the `features/site.feature` clean-URL rows.

### Checkout contract (REQ-028)

Every amount control wires the one front-end → backend integration point. Each
tier button in `#tiersOnce`/`#tiersMonthly`, and the choose-your-own **Give**
button, carries:

- `data-mode` — `once` or `monthly`
- `data-plan` — `bronze`/`silver`/`gold`/`platinum`, **empty** for one-off
- `data-amount` — the amount in **pence** (`1000`/`2500`/`5000`/`10000`),
  **empty** for choose-your-own

`startCheckout(button)` in the shared `assets/js/main.js` (exported alongside the
other inits; the controls are bound on load by `initCheckout`, which targets
`[data-amount]` so the once/monthly toggle stays with `initGiveToggle`) reads
those attributes plus the `#giftAid` checkbox (REQ-023) into a single
`{ mode, plan, amount, giftAid }` payload (`plan`/`amount` normalise to `null`
when empty; the choose-your-own amount is built from the `#customAmount` value ×
100) — and, once the donor-type control (REQ-038) is wired, folds in
**`donorType`** and an optional **`businessName`** (see **Donor-type routing**
above). It then mirrors `initContactForm`'s best-effort pattern: in production it
POSTs the payload to **`/api/checkout-session`** and redirects to the returned
Stripe `{ url }`; with no working backend (the current `501` stub) it degrades to
**showing the payload** (an `alert`, the preview). The buttons are native
`<button>`s (keyboard-activatable, global `:focus-visible` ring; REQ-032). The
live endpoint is **REQ-029**, out of scope here. Verified by
`test/unit/give-checkout.test.ts` (markup + jsdom payload behaviour) and the
per-tier checks in `give-once-tiers` / `give-monthly-tiers`.

### API endpoints

| Method + path | Status | Requirement |
|---|---|---|
| `POST /api/checkout-session` | **implemented** | REQ-029 (payment) |
| `POST /api/subscription/change-plan` | **implemented** | REQ-055 (tier up/down) |
| `POST /api/contact` | **implemented** | REQ-030 (contact form) |
| `GET /api/portal/:token` | **implemented** | REQ-061 (donor portal read) |
| `PATCH /api/portal/:token` | **implemented** | REQ-061 (donor portal update) |
| `POST /api/portal/:token/subscription/cancel` | **implemented** | REQ-055 (reduce-instead-then-cancel) |
| `POST /api/portal/:token/gift-aid/cancel` | **implemented** | REQ-061 (cancel Gift Aid — revoke declaration) |
| `POST /api/portal/request` | **implemented** | REQ-061 (donor self-request portal magic link) |
| `POST /api/admin/login` | **implemented** | REQ-062 (role-based admin login) |
| `GET /api/admin/donors/:id` | **implemented** | REQ-062 (admin donor read; incl. postal address — declaration for an individual, billing for a company) |
| `PATCH /api/admin/donors/:id` | **implemented** | REQ-062 (admin donor update) |
| `POST /api/admin/donors/:id/subscription/cancel` | **implemented** | REQ-062 (admin cancel subscription) |
| `POST /api/admin/donors/:id/gift-aid/cancel` | **implemented** | REQ-062 (admin cancel Gift Aid) |
| `GET /api/admin/search/donors?q=` | **implemented** | REQ-062 (admin donor search) |
| `GET /api/admin/search/declarations?q=` | **implemented** | REQ-062 (admin declaration search) |
| `GET /api/admin/search/donations?q=` | **implemented** | REQ-062 (admin donation search) |
| `POST /api/admin/claim-batches` | **implemented** | REQ-052/REQ-062 (open a new claim batch) |
| `POST /api/admin/claim-batches/:id/donations` | **implemented** | REQ-052/REQ-062 (assign eligible donations to a batch) |
| `GET /api/admin/claims/eligible` | **implemented** | REQ-052 (eligible-unbatched donations, ready to claim) |
| `POST /api/admin/claim-batches/:id/submit` | **implemented** | REQ-052/REQ-062 (mark claim batch submitted) |
| `GET /api/admin/claims/adjustment-due` | **implemented** | REQ-063 (adjustment-due queue) |
| `GET /api/admin/queues/retention-expiry` | **implemented** | REQ-046 (retention-expiry queue) |
| `GET /api/admin/queues/awaiting-declaration` | **implemented** | REQ-049 (awaiting-declaration queue) |
| `GET /api/admin/donations` | **implemented** | REQ-066 (browse all donations, paginated) |
| `GET /api/admin/claim-batches` | **implemented** | REQ-066 (list claim batches) |
| `GET /api/admin/claim-batches/:id/export` | **implemented** | REQ-052/REQ-066 (Charities Online CSV export) |
| `GET /api/admin/audit` | **implemented** | REQ-066 (append-only audit trail) |
| `GET /api/admin/subscriptions/dunning` | **implemented** | REQ-066 (at-risk / lapsed monthly gifts) |

They live in `src/routes/api.ts` (the donor-portal routes in `src/routes/portal.ts`, the admin
routes in `src/routes/admin.ts`).

**`GET` / `PATCH /api/portal/:token` (REQ-061 · TASK-101).** The self-serve donor portal, entered
via the one-time, expiring magic-link token (TASK-100). **Every** route authenticates the token with
`authenticatePortalToken` → `verifyPortalToken` and rejects an invalid / expired / used token with
**401** (it does *not* mark the token used, so it stays valid for repeated requests within its
life). **`GET`** returns the donor's `getDonorPortalSnapshot` (`src/db/portal.ts`, a read-only
`pool.query` like `listClaimableDonationsForExport`): `fullName`, `email`, `emailConsent`,
`anonymous`, the current `subscriptionPlan` (the most recent monthly subscription donation's plan,
or null), its `subscriptionId` (that donation's Stripe subscription id, or null — added for the
TASK-104 portal page's reduce-instead-then-cancel flow) and `giftAid` (whether any gift-aided
donation is on file). **`PATCH`** validates a
zod-first `{ fullName?, email?, emailConsent?, anonymous? }` (`.strict()`, at least one field, valid
email) and calls `updateDonorPortal`, which updates only the supplied `donors` columns **and appends
a `donor.updated` audit_log row in the SAME `writeWithAudit` transaction** (the truth model), then
returns the fresh snapshot. Proven DB-free by `test/unit/portal-api.test.ts` (mocked pool) and end to
end by the `@db` `features/portal.feature`.

**`POST /api/portal/:token/subscription/cancel` (REQ-055 · TASK-102).** The "cancel" end of the
**reduce-instead-then-cancel** flow. Token-authenticated like the other portal routes. The body must
carry an **explicit `accepted: 'reduce'|'cancel'` acknowledgement** that reduce-instead was offered —
a **missing/invalid** one is **400** (the donor cannot cancel without being shown the reduce option
first). `accepted: 'cancel'` calls `cancelSubscription` (`src/clients/stripe.ts` — a thin
`subscriptions.cancel` wrapper alongside the existing `changeSubscriptionPlan`, with the same offline
stub so it runs without a Stripe account) and returns the cancelled subscription; `accepted:
'reduce'` is refused with **400** (reducing is done via `change-plan`, not here); an upstream Stripe
failure is **502**. Reducing itself reuses the existing `POST /api/subscription/change-plan`
unchanged. Proven by `test/unit/subscription-cancel.test.ts` (mocked SDK + pool) and end to end by
the `@db` `features/subscription-cancel.feature`.

**`POST /api/portal/:token/gift-aid/cancel` (REQ-061 · TASK-103).** Cancel Gift Aid — the donor
revokes their **active** declaration, stopping future claims, with **no superseding replacement**
(unlike an *edit*, REQ-059, which revokes-and-supersedes). Token-authenticated like the other portal
routes. It resolves the donor's currently-active declaration (`findActiveDeclarationIdForDonor` —
`revoked_at IS NULL`, most recent) and calls `cancelDeclaration` (`src/db/declarations.ts`), which in
ONE transaction locks the row `FOR UPDATE`, sets `revoked_at` and appends a single
`declaration.revoked` audit_log row — inserting **no** new declaration and setting **no**
`superseded_by_declaration_id`. No active declaration → **404**; a concurrent cancel that already
revoked it → **409** (the `FOR UPDATE` re-check throws `DeclarationCancellationError`). The pure
revoke+audit decision lives in `src/declarations/cancellation.ts` (`buildDeclarationCancellation`,
DB-free, clock injected — like `buildDeclarationRevision`). Proven DB-free by
`test/unit/gift-aid-cancel.test.ts` (mocked pool) and end to end by the `@db` `features/portal.feature`.

**`PATCH /api/portal/:token/declaration` (REQ-059 · TASK-129).** Edit the **identity / address** on the
donor's active Gift Aid declaration — the donor-facing surface for TASK-128's **amend** path. The body
is validated by `declarationFieldsSchema` (`title?`, first/last name, house name/number, address,
`postcode?`, `nonUk`); the route holds `scope` + `confirmed_taxpayer` at the active declaration's
**current** values (read via `getActiveDeclarationForDonor`), so `reviseDeclaration` always **amends in
place** (a `declaration.amended` audit note, no new row) rather than revoking-and-superseding — a
scope/consent change is deliberately out of scope here. It also syncs `donors.full_name` to
`"First Last"` so the account name and the declaration name **cannot diverge** (`updateDonorPortal`);
the two writes are separate audited transactions (declaration first — a name-sync failure leaves the
declaration correct and only the display name stale, a documented single-transaction follow-up). No
active declaration → **404**; invalid body → **400**; invalid token → **401**. The portal page shows a
prefilled **"Your Gift Aid declaration details"** form (`#portalDeclaration`, shown only when a
declaration is present; `GET /api/portal/:token` now carries `declaration`). Proven by
`test/unit/portal-declaration-edit.test.ts` + `test/unit/portal-active-declaration.test.ts` and end to
end by the `@db` `features/portal.feature`.

- `POST /api/portal/request` `{ email }` — a donor requests a one-time portal magic link. The
  donor is matched by their **stored `donors.email`** (`findNewestDonorByEmail`, case-insensitive,
  newest row wins) — since email is now mandatory and always stored, this reaches ANY donor,
  including one-off donors with no Stripe subscription — and, on a match, emailed a link
  (`issuePortalAccessToken` → `portalMagicLink` → `sendPortalMagicLink`). Always returns an
  identical generic `200` — no email enumeration. Rate-limited per email and per IP (in-memory,
  per-task; a distributed limiter is a follow-up).

**`POST /api/admin/login` (REQ-062 · TASK-105).** The role-based admin login. The `users` table
(TASK-056) already carries the `role` enum (`viewer`/`editor`/`admin`, NOT NULL default `viewer`); an
additive, nullable `password_hash` column (migration `1783078996722`) adds the missing credential — a
salted **scrypt** hash (`scrypt$salt$key`, `src/admin/password.ts`, Node's built-in crypto, no
dependency; the plaintext never hits the DB or logs). The endpoint validates a zod-first `{ email,
password }`, looks the user up (`findUserByEmail`, `src/db/admin.ts`), verifies the password in
constant time (and against a dummy hash when the email is unknown, so timing does not reveal whether
an account exists), and on success returns a **signed session token** — the bearer-token analogue of
the donor portal's magic link. The token is stateless: `base64url(claims).base64url(hmac)`, HMAC-signed
with `ADMIN_SESSION_SECRET` over `{ sub, email, role, iat, exp }` (`signAdminSession` /
`verifyAdminSession`, `src/admin/session.ts`, pure with an injected clock like `src/portal/tokens.ts`),
default 8h TTL. Invalid credentials (unknown email, wrong password, or a null-hash account) all return a
generic **401**; a malformed body is **400**. The role-gated admin actions that consume the token are
**TASK-106**. Proven by `test/unit/admin-auth.test.ts` (mocked pool — both paths, the pure
password/session helpers, and that the migration is additive-only) and end to end by the `@db`
`features/admin-auth.feature`.

**Admin seed (REQ-062 · TASK-107).** Kenny and Isabella are the two NBCC staff who hold the
Admin/Claims permission. The data-only migration `1783080586661_grant-kenny-isabella-admin.js` seeds
their `users` rows (`kenny@`/`isabella@nightbeforechristmas.co.uk`) with `role='admin'`, idempotent
via `ON CONFLICT (email) DO UPDATE SET role='admin'` (so a re-run, or a pre-existing row, is upgraded
rather than duplicated). No `password_hash` is set — the accounts cannot log in until a password is set
out of band (golden rule 4), the safe default. Additive/expand-contract (a data INSERT, no schema
change); guarded by `test/unit/admin-seed-migration.test.ts` and applied by CI's migrations job.

**`GET`/`PATCH /api/admin/donors/:id`, `POST …/subscription/cancel`, `POST …/gift-aid/cancel`
(REQ-062 · TASK-106).** The role-gated admin actions that let an Editor/Admin act on a donor's
behalf — the mirror of the self-serve donor-portal routes (`src/routes/portal.ts`), but authorised by
the **admin session token** (`Authorization: Bearer …`) instead of a magic-link token, and addressing
a donor by id. A shared `authorizeAdmin(req, res, minRole)` helper (the admin analogue of portal's
`authOrReject`) rejects a **missing/invalid/expired token with 401** and enforces the role rank
`viewer < editor < admin`: **GET** needs `viewer` (read-only, any role); the three writes need
`editor`, so a **Viewer gets 403** on any of them. Each endpoint **reuses the existing audited write
helpers** rather than duplicating logic: **PATCH** → `updateDonorPortal` (same `donor.updated`
`writeWithAudit` transaction as self-serve, now with the admin as `actor`); **subscription cancel** →
the same reduce-instead gate (REQ-055), then `cancelSubscription` (Stripe) + a
`recordAdminSubscriptionCancellation` audit row via `writeWithAudit`; **gift-aid cancel** →
`adminCancelGiftAid` (`src/db/admin.ts`), which reuses the pure `buildDeclarationCancellation` and, in
one `writeWithAudit` transaction, locks the donor's active declaration, sets `revoked_at` and appends
the `declaration.revoked` audit row (no new declaration, no `superseded_by`). So **every admin write
appends its audit_log row in the same transaction as the state change** (the truth model), recording
which admin acted. No active declaration → 404; a concurrent revoke → 409; a non-numeric id → 400.
Proven by `test/unit/admin-api.test.ts` (mocked pool — the full 401/403/200 role matrix and that each
successful write is audited) and end to end by the `@db` `features/admin-api.feature`.

**`GET /api/admin/search/{donors,declarations,donations}?q=` (REQ-062 · TASK-108).** Read-only admin
search over the three core tables by a free `?q=` query — a name, email, id or postcode. Each is
authorised by the same `authorizeAdmin` gate at **`viewer`** (read-only, so any staff role may search),
so a **missing/invalid token is 401**; a **missing/blank `q` is 400**. The queries live in
`src/db/admin.ts` (`searchDonors`/`searchDeclarations`/`searchDonations`, read-only `pool.query` like
the other admin reads): each matches the query case-insensitively (`ILIKE '%q%'`) across the relevant
text columns — donor name/business/email; declaration first/last name + postcode; donation donor
name/email + Stripe ids — and additionally by numeric **id** when the query is all digits (declarations
and donations also match a numeric **donor id**; donations join the donor for the name/email match).
Results are **capped** (`LIMIT 50`) so an over-broad query stays bounded. Proven by the search block in
`test/unit/admin-api.test.ts` (401 + the viewer/editor/admin 200 matrix, the ILIKE/numeric params, and
the blank-`q` 400) and end to end by the `@db` `features/admin-api.feature`.

**`POST /api/admin/claim-batches/:id/submit` + `GET /api/admin/claims/adjustment-due` (REQ-052/REQ-063
· TASK-109).** The admin claim operations. **Submit** marks a claim batch submitted — a state change,
so `authorizeAdmin` at **`editor`** (a Viewer gets 403). `submitClaimBatch` (`src/db/admin.ts`) mirrors
`assignDonationToBatch`: in one `writeWithAudit` transaction it locks the batch row `FOR UPDATE`,
rejects an unknown id (**404**) or a non-`open` batch (already submitted / adjustment_due → **409**),
sets `status='submitted', submitted_at=now()` and appends **exactly one `claim_batch.submitted` audit
row** in the same transaction. The Charities Online export that produces the batch file is
`src/claims/charities-online.ts`; this only flips its status. **Adjustment-due** is a read (`viewer`
and up): `listAdjustmentDueDonations` lists the donations with `claim_status='adjustment_due'` (REQ-063),
joined to their donor and the `claim_adjustments` row (owed amount + reason) for the admin adjustment
queue. Proven by the claim-ops block in `test/unit/admin-api.test.ts` (401/403, the editor/admin
submit-200 with the audited transaction asserted, 404/409 guards, and the viewer-or-above 200 on the
queue) and the `@db` `features/admin-api.feature`.

**`GET /api/admin/queues/retention-expiry` + `GET /api/admin/queues/awaiting-declaration` (REQ-046/
REQ-049 · TASK-110).** Two read-only admin queues (`viewer` and up, so a missing/invalid token is
**401**). **Retention-expiry** — `listRetentionExpiryDeclarations` (`src/db/admin.ts`) reads every
declaration that has a claimed donation and runs the pure `computeRetentionExpiry` calculator
(`src/declarations/retention.ts`, REQ-046: six years after the final claimed charge, indefinite while
an enduring declaration is live) per row, mapping `cancelledAt = revoked_at` (a revoked declaration is
inactive, so `subscriptionActive = revoked_at IS NULL`) and the anchor to the most recent claimed
donation's date. It returns only declarations flagged **`expired`** (window already closed) or
**`expiring`** (closes within a six-month horizon), with the computed `retentionExpiry`; a live
enduring declaration (retained indefinitely) is omitted. **Awaiting-declaration** —
`listAwaitingDeclarationDonations` lists donations whose in-person/postal confirmation was sent but not
completed: `declaration_status IN ('sent','undelivered')` (REQ-049/REQ-057 — **bounced/undelivered
emails included**), joined to the donor and carrying the `declaration_token` that addresses the link.
Proven by the queues block in `test/unit/admin-api.test.ts` (401, the viewer/editor/admin 200s, the
expired-flag computation, that a live enduring declaration is omitted, and the sent/undelivered filter)
and the `@db` `features/admin-api.feature`.

**Dashboard read lists (REQ-066 · TASK-114).** The reads that back the admin cockpit UI, all `viewer`
and up (missing/invalid token → **401**) except the CSV export. `GET /api/admin/donations` browses
every donation newest-first with optional `?status`/`?channel` filters and a bounded `?limit`/`?offset`
page (the pure `clampPage` clamps to ≤ 100), returning `{ results, total }`. `GET /api/admin/claim-batches`
lists the batches with their donation count and summed pence. `GET /api/admin/audit` reads the
append-only trail newest-first, optionally scoped by `?entity`/`?entityId` and paged the same way.
`GET /api/admin/subscriptions/dunning` lists at-risk / lapsed monthly gifts (optional `?status`). The
one **Editor and up** route (a claims op, like submit) is `GET /api/admin/claim-batches/:id/export`: it
reuses `listClaimableDonationsForExport(batchId)` + the pure `toCharitiesOnlineCsv` serializer and
streams the batch's Charities Online CSV as a `text/csv` download. No new config (reuses
`ADMIN_SESSION_SECRET`). Proven by `test/unit/admin-read.test.ts` (the `clampPage` clamp, 401/403/400
gating and the viewer-200s DB-free) and the `@db` `features/admin-api.feature`.

**Gift Aid claims pipeline (REQ-052/REQ-062).** The Claims view drives the full HMRC reclaim workflow:
`eligible → batch → export → submit`. `GET /api/admin/claims/eligible` (Viewer+) lists the Gift-Aided,
declared, still-unbatched donations; `POST /api/admin/claim-batches` (Editor+) opens a new batch;
`POST /api/admin/claim-batches/:id/donations` (Editor+) assigns one or many eligible donations to it
(each via the audited `assignDonationToBatch`, aggregating per-id success/failure so a partial failure is
reported). **A batch's CSV export selects its donations by `claim_batch_id`** — NOT by
`claim_status='eligible'`, which is unsatisfiable once a donation is batched (`batched`/`claimed`) and
made every batch export empty (fixed; regression-guarded in `test/unit/charities-online-query.test.ts`).
The Claims page presents the three stages (Ready to claim · Claim batches · Adjustment due) with
plain-English guidance and a checkbox picker to add eligible gifts to a batch.

**Admin dashboard UI (REQ-066 · TASK-115).** `admin.html` is a private, token-authed staff SPA served
at `/admin` (a clean-URL rewrite in `_redirects`; `noindex`, and outside the marketing nav/footer so it
is exempt from the marketing guards). It signs in via `POST /api/admin/login`, holds the bearer session
token in `sessionStorage` (cleared on tab close; the 8h TTL still applies), attaches it as
`Authorization: Bearer` and, on any `401`, clears it and returns to sign-in. It renders over the
`/api/admin/*` JSON API: **Overview** (the three operational queue counts + recent donations) and
**Search** (donors / declarations / donations). The pure formatting / claim-decoding / role-gating
helpers live in `assets/js/admin/helpers.js` (unit-tested, `test/unit/admin-helpers.test.ts`);
`assets/js/admin/app.js` is the DOM glue; `assets/css/admin.css` layers the dashboard layout over the
shared brand tokens in `styles.css`. The shell's own accessibility floor (a skip link to a focusable
`<main id="admin-main">`, the landmark set, and a labelled required login form) is guarded by
`test/unit/admin-shell.test.ts`, and `/admin` serving + the `/admin.html` → `/admin` canonical are
covered by `features/site.feature`. The image bakes `admin.html` in via the Dockerfile COPY (guarded by
`test/unit/dockerfile-site-assets.test.ts`). No new config.

The dashboard's remaining views + donor detail (REQ-066 · TASK-117) build on that shell over the same
`/api/admin/*` API with **no new backend**: **Donations** (browse all, paged), **Claims** (the
adjustment-due queue + the claim batches, with **Submit** and **Export CSV** shown only to Editor+),
**Subscriptions** (dunning / at-risk gifts) and the **Audit** trail. A **donor detail** view is opened
from any donor/donation row and shows the snapshot plus role-gated actions — edit fields
(`PATCH /api/admin/donors/:id`), cancel subscription and cancel Gift Aid — reusing the REQ-062 write
endpoints (the UI hides write controls below Editor via `roleCan`; the server still enforces). The CSV
export is fetched with the bearer token and saved via a blob download (a plain link cannot carry the
`Authorization` header). `admin-shell.test.ts` covers the six nav sections + the donor detail view.

**Retention-expiry anonymisation (REQ-064 · TASK-112).** `anonymizeDonorPersonalData(declarationId)`
(`src/db/admin.ts`) is the audited write behind the retention-expiry queue: once a declaration's HMRC
six-year window has **closed**, it erases the captured personal data. It reuses the pure
`computeRetentionExpiry` calculator **verbatim** (`src/declarations/retention.ts`) to classify the
declaration and acts **only on an `expired` row** (expiry ≤ now); an `expiring` or indefinitely-retained
(live enduring) declaration is **left completely untouched — no write, no audit row**. For an expired
declaration it, in ONE `writeWithAudit` transaction (the truth model, like `updateDonorPortal` /
`cancelDeclaration`): redacts the donor's name (`full_name → "Redacted"`, a NOT NULL column) and nulls
its contact/business fields, redacts the declaration's captured personal fields (name, address,
house name/number → `"Redacted"`; title, postcode → NULL), and appends **exactly one
`donor.personal_data_anonymized` audit row** — any throw rolls back both. The immutable declaration
keeps its `wording_version`/`snapshot` + `scope` (not personal data). The batch job that finds the
expired rows (via `listRetentionExpiryDeclarations`) and runs the helper is
`scripts/anonymize-retention-expired.mjs` (`npm run anonymize:retention-expired`, run via `tsx` through
`src/db/pool.ts`, with a `--dry` preview), intended to run on a schedule. Proven DB-free by
`test/unit/retention-anonymize.test.ts` (mocked pool — the expired redaction + single audit row in one
transaction, and that `expiring` / indefinitely-retained / unknown declarations are untouched).

```
npm run anonymize:retention-expired            # anonymise every expired declaration
npm run anonymize:retention-expired -- --dry   # list what WOULD be anonymised, write nothing
```

**`POST /api/checkout-session` (REQ-029).** Turns the REQ-028 front-end payload
`{ mode, plan, amount, giftAid }` — plus optional `donorType`
(`individual`|`company`, defaulting to `individual`), `businessName`, and the REQ-039
contact capture (`fullName`, `email`, `emailConsent`, `anonymous`, `ageConfirmed`)
folded in by the give widget — into a Stripe Checkout session and returns its
`{ url }` (which `startCheckout` redirects to). The body is validated zod-first
(same style as `src/config/schema.ts`); impossible combinations are rejected with
**400** (a monthly gift with **neither a plan nor an amount** (REQ-041 — a monthly
gift takes a preset tier *or* a custom amount), a one-off with no amount, a bad
mode/plan, a non-positive amount, an unknown `donorType`, a `company` payload that also
asserts `giftAid=true` — companies take the no-Gift-Aid path — or a **monthly** gift
that does not confirm 18 or over (`ageConfirmed`, REQ-039)). All captured contact
fields are stamped onto the session metadata for the webhook.

A **company** payload (`donorType: 'company'`, REQ-038/REQ-053 · TASK-085) must also carry a
valid `company` object `{ legalName, registrationNumber?, contactName, contactEmail,
billingAddress, billingPostcode }`, validated by `companyFieldsSchema` in `src/donors/company.ts`
(`.strict()`; registration number optional, the rest required, `contactEmail` a valid email,
`billingPostcode` a valid UK postcode). A **missing or invalid** company object on the company
path is rejected with **400** (e.g. no `contactEmail` or `billingAddress`). On success the fields
are stamped onto the session metadata (`companyLegalName`/`companyRegistrationNumber`/
`companyContactName`/`companyContactEmail`/`companyBillingAddress`/`companyBillingPostcode`)
alongside `donorType`/`businessName`; the webhook maps them onto the donor row via
`buildCompanyDonorRow` (see **Company donations** under the data model). A company makes no Gift
Aid declaration.

A one-off is a `mode: payment` session with inline GBP
`price_data` built from the amount in **pence** — attached to the
`STRIPE_DONATION_PRODUCT` product when that optional id is set, otherwise an inline
product is named — and a monthly is a `mode: subscription` session: a preset tier
uses the recurring `STRIPE_PRICE_*` id keyed by plan, while a **custom monthly
amount** (`plan: null`, `amount` in pence, REQ-041) builds an **inline recurring
`price_data`** (`recurring.interval: 'month'`) rolled under `STRIPE_DONATION_PRODUCT`
when set, else an inline product — so no per-amount Stripe Product is needed.
`payment_method_types` is
`['card', 'bacs_debit']` on **both** session shapes (Apple Pay / Google Pay ride on
the card method; BACS Direct Debit is offered for our GBP-only UK donations, which
satisfy Stripe's BACS currency/country requirement — REQ-029 · TASK-089).
`success_url` / `cancel_url` come from config. When
`giftAid` is affirmatively true the consent is bound to the **exact verbatim HMRC
statement** the donor saw (REQ-042 · TASK-053): alongside `metadata.giftAid='true'`,
the handler stamps `metadata.giftAidWordingVersion` and `metadata.giftAidWording` (the
version id + full snapshot from `selectDeclarationWording({ mode, scope })` in
`src/declarations/wording.ts` — the all-donations/enduring statement for a monthly gift,
the single-donation statement for a one-off), so the REQ-036 webhook can persist them
onto the immutable declaration. A `giftAid=false` gift stamps **no** wording metadata.
Independently of Gift Aid, **every** session also carries `metadata.declarationScope`
— defaulting to `enduring` for a monthly gift, `this_donation` for a one-off (REQ-041 ·
TASK-060), unless the donor's `declaration.scope` **overrides** it (REQ-044 · TASK-065),
in which case that raw `this_donation`/`all_donations` value is stamped instead. It is
derived once via `declarationScopeForMode` in `src/declarations/wording.ts` and, along
with the donor override, collapsed by `scopeFromDeclarationScope` (same module) to pick
the matching verbatim wording AND the persisted `declarations.scope`, so the mode→scope
decision is never duplicated. The
persisted donation itself captures the gift's **amount**, **frequency** (`mode`) and
**currency** (defaulting to `GBP`) explicitly (REQ-041).
When Gift Aid is opted in, the give widget (TASK-062) also captures the **HMRC
declaration** (`{ title?, firstName, lastName, houseNameNumber, address, postcode?, nonUk }`);
the endpoint validates it with the shared `declarationFieldsSchema`
(`src/declarations/fields.ts`, REQ-043 · TASK-061) — a malformed postcode or a missing
house name/number returns **400**, and a non-UK donor is exempt from the postcode — and
stamps the `decl*` fields onto `metadata` so the webhook can persist an immutable
`declarations` row (REQ-043/REQ-046). The `donorType` and `businessName` are likewise
stamped onto `metadata` (alongside `giftAid`) so the webhook can persist them onto the
donor record (REQ-038 → REQ-036). An upstream Stripe failure returns **502**, which the
front-end degrades to its preview.

> **Stub seam (no live account needed).** `src/clients/stripe.ts` uses the real
> Stripe SDK when given a real key — standard (`sk_test_…`/`sk_live_…`) or
> restricted (`rk_test_…`/`rk_live_…`). **Outside
> production**, when the key is a placeholder (local dev, CI, fresh `REPLACE_ME`
> SSM params), it falls back to a thin stub whose `checkout.sessions.create`
> returns a deterministic preview URL that reflects the session's mode and Gift Aid
> opt-in — so the full request → `{ url }` flow (including the gift-aided path) is
> exercised end to end (see `features/checkout.feature`) without a Stripe account.
> Production **never** stubs, so a missing real key surfaces loudly. Verified by
> `test/unit/checkout-session.test.ts` (mocked client) + the BDD scenarios.
>
> **Pinned API version.** Both real SDK clients (the checkout/subscription client
> and the webhook verifier) are constructed with an explicit `apiVersion`
> (`STRIPE_API_VERSION`, `src/clients/stripe.ts`) instead of the SDK's implicit
> default, which shifts on every `stripe` package bump. The literal is type-checked
> against the SDK's `LatestApiVersion` at the `new Stripe(...)` call site, so an
> out-of-date pin fails the build — bump it in lockstep when upgrading `stripe`, and
> align the webhook endpoint's API version in the Stripe dashboard so delivered
> events match the pinned types. Verified by `test/unit/stripe-api-version.test.ts`.

**`POST /api/subscription/change-plan` (REQ-055).** Moves a monthly subscription up
or down a tier. The body `{ subscriptionId, plan }` is validated zod-first (same
style as checkout); an unknown `plan`, a missing/empty `subscriptionId`, or a `plan`
the subscription is already on is rejected with **400**. The client wrapper
`changeSubscriptionPlan` (`src/clients/stripe.ts`) retrieves the subscription — Stripe
*adds* an item when the item id is omitted, so the existing item id is needed to swap
in place — and calls `stripe.subscriptions.update`, swapping its single recurring item
to the target plan's `STRIPE_PRICE_*` id (the same config-wired mapping the checkout
endpoint uses) with `proration_behavior: 'create_prorations'`. **One Price per tier, so
proration is Stripe's job, not ours** (REQ-055: Gift Aid is claimed on each actual
charge, needing no special handling). It returns the updated subscription; an upstream
Stripe failure returns **502**, matching the checkout endpoint's error shape. This is
the **backend capability only** — the donor-facing triggers are out of scope here: the
self-serve donor portal (REQ-061) and role-based admin-on-behalf (REQ-062). The offline
stub implements `subscriptions.retrieve`/`update`, so the flow runs end to end without a
Stripe account. Verified by `test/unit/change-plan.test.ts` (mocked SDK) +
`features/change-plan.feature`.

### Donation data model (REQ-036 / REQ-037)

The unified donation platform's **one** persistence model — the foundation every
channel writes through. Added by the additive, expand-contract migration
`migrations/1782923222001_unified-donation-model.js` (four new tables, no existing
table touched, so a code-level rollback stays safe — golden rule 2):

- **`donors`** — an individual or a company (`donor_type`), a `full_name`, optional
  business name / registration number (`company_number`), an optional consent-based `email` +
  `email_consent`, an `anonymous` flag, and nullable `billing_address` / `billing_postcode`
  (REQ-038/REQ-039/REQ-053). The contact
  fields are captured by the give widget (TASK-058), carried through the checkout
  session metadata and mapped on by the webhook: `email` + `email_consent` are stored
  **only** when the donor opted in — otherwise no email, so the platform sends nothing —
  and `anonymous` drives `isPubliclyListable` (an anonymous donor is paid through but
  never shown on the public donors page, REQ-047). **Company donations** (REQ-038/REQ-053 ·
  TASK-085) fill `business_name` (legal name), `company_number` (registration number, optional),
  `full_name` + `email` (the billing contact) and the two `billing_*` columns (added by the
  additive migration `1783054395270_donor-billing-address.js`, nullable — individuals/partnerships
  leave them NULL). The pure `src/donors/company.ts` (`companyFieldsSchema` + `buildCompanyDonorRow`)
  validates + maps them; the webhook writes the donor in the **same** `writeWithAudit` transaction
  as the donation, with **no** declarations row and `claim_status='not_eligible'`, `declaration_id`
  null (`buildDonationRow`/`deriveClaimStatus` force a company non-claimable — REQ-053). A company
  gift is relieved via **Corporation Tax**, not Gift Aid: the pure `src/donors/receipt.ts`
  (`buildCorporationTaxReceipt`, REQ-053 · TASK-086) builds the receipt content — text + HTML
  carrying NBCC's name, the OSCR number `SC047995`, the amount/date, and the verbatim
  genuine-donation (nothing given in return) and no-Gift-Aid statements. Its guard
  `classifyCompanyGift({ considerationGiven })` returns `flag_for_trustees` (not a receipt) when
  the company received anything of value in return. Pure/DB-free (no pool/config/clock), unit-tested
  in `test/unit/corporation-tax-receipt.test.ts`. The webhook wires this up (REQ-053 · TASK-088):
  the required `company.considerationGiven` flag (validated by `companyFieldsSchema`, stamped as
  `metadata.companyConsiderationGiven`) drives the choice — a **clean** gift (no consideration)
  emails the Corporation Tax receipt to the billing contact **after commit** (best-effort, via
  `sendCompanyReceipt`, mirroring the donation-confirmation send); a gift **with** consideration
  appends a `donation.flagged_for_trustees` `audit_log` row **inside** the same transaction and
  sends **no** receipt. Either way the donation stays non-claimable. Verified DB-free against a
  mocked pool + email client in `test/unit/company-receipt-webhook.test.ts`.
- **`declarations`** — the immutable Gift Aid / HMRC declaration: the matching
  fields (title, names, `house_name_number`, address, `postcode`, `non_uk`), the
  `scope` (this-donation vs enduring), and the versioned wording the donor saw
  (`wording_version` + `wording_snapshot`) (REQ-040/REQ-043/REQ-044/REQ-046). Two nullable
  columns record revocation/supersession (REQ-059 · TASK-096, added by migration
  `1783068943728_declaration-revocation.js`): `revoked_at` (set when the declaration is
  revoked) and `superseded_by_declaration_id` (a self-FK `onDelete RESTRICT` to the corrected
  declaration that replaces it — a **consent** edit revokes-and-supersedes; an identity/address edit
  amends the row's matching columns in place, TASK-128). The pure revision builder + audited write
  are wired in TASK-097 (see **Declaration revision** below).
- **`donations`** — **THE** one donation record: FK `donor_id`, `mode`
  (once/monthly), `plan`, `amount_pence`, `currency`, the Stripe ids,
  `refunded_amount_pence`, `claim_status`, `payment_channel`, and Gift Aid as a
  **flag** (`gift_aid` boolean + nullable `declaration_id` FK) — never a second
  store (REQ-036). A donation is claimable only when the donor is an individual,
  an active declaration covers it and it is not (fully) refunded; company
  donations are permanently `not_eligible` (REQ-037/REQ-053). A nullable
  `claim_batch_id` FK (`onDelete RESTRICT`, added by the claim-batches migration —
  see **Claim batches + users** below) links a donation to **at most one** claim
  batch; that single column *is* the "a donation enters at most one claim batch"
  invariant (REQ-037). A NOT-NULL-defaulted `benefit_cap_breached` boolean (added by the
  benefit-tracking migration — see **Benefit tracking** below) records whether this gift's
  benefits breach the Gift Aid cap (REQ-045). A NOT-NULL-defaulted `declaration_status`
  (default `not_required`) plus a unique nullable `declaration_token` (added by the
  declaration-confirmation migration `1783010739790_declaration-status-and-token.js`) track
  the Gift Aid declaration-confirmation lifecycle — see **Declaration confirmation lifecycle**
  below (REQ-057). A NOT-NULL-defaulted `gasds_eligible` boolean (default `false`, added by
  migration `1783014186353_gasds-eligible.js`) marks a small gift claimable under the Gift
  Aid Small Donations Scheme — see **GASDS eligibility** below (REQ-058). A NOT-NULL-defaulted
  `payment_status` (`text`, CHECK `pending`/`paid`/`failed`, default `paid`, added by migration
  `1783062309816_donation-payment-status.js`) tracks settlement for the async **BACS Direct Debit**
  method (REQ-065 · TASK-090): a card gift is `paid` at checkout, a BACS gift lands `pending`
  (Stripe's `payment_status='unpaid'`) and flips to `paid`/`failed` on the async payment events. It
  **gates claimability** — `deriveClaimStatus` returns `eligible` only when `payment_status='paid'`,
  so a pending or failed BACS gift is never claimable regardless of Gift Aid + declaration — see
  **BACS pending payments** below.
- **`audit_log`** — an **append-only** trail (`actor`, `action`, `entity`,
  `entity_id`, `data` jsonb); a DB trigger rejects any `UPDATE`/`DELETE`.
- **`donation_partner_shares`** — the many-declarations-per-donation join for a
  **partnership** gift (added by the additive migration
  `1783015422184_partnership-shares.js`): `donation_id` + `declaration_id` (both indexed,
  `onDelete RESTRICT`) and a positive `share_pence`. Where an individual/company gift uses
  the single `donations.declaration_id` FK, a partnership records **one declaration per
  partner** here, each with that partner's share — and the shares must sum exactly to the
  donation total (see **Partnership shares** below, REQ-051).

**Write layer.** `src/db/donations-model.ts` holds the **pure** field mapping and
claim derivation (`donationInputSchema`, `buildDonationRow`, `deriveClaimStatus`,
`batchAssignmentBlock`, `isPubliclyListable`) — no pool/config/clock, so it is unit-tested DB-free
(`test/unit/donations-model.test.ts`). `src/db/donations.ts` owns the
transaction: `writeWithAudit(write, toAudit)` runs a state write (insert/update on
donors/declarations/donations) **and** its matching `audit_log` row inside one
`BEGIN…COMMIT`, rolling **both** back on any throw (the truth model in CLAUDE.md);
`recordDonation()` is the concrete "create a donor + donation, audit
`donation.created`" use. Verified against the local DB: the row and its audit row
commit together, a throwing write persists neither, and `audit_log` rejects
deletes.

**Claim-batch assignment (REQ-037 · TASK-057).** `assignDonationToBatch(donationId,
batchId, actor?)` is the concrete audited admin write that enforces the claim
invariant and one-batch-per-donation. It locks the donation (`SELECT … FOR UPDATE`),
applies the pure guard `batchAssignmentBlock` (a donation may be batched only when it
is currently `eligible` **and** not already in a batch — the non-null `claim_batch_id`
is checked first, so a re-assignment is rejected as `already_batched`), then sets
`claim_batch_id` + `claim_status='batched'` and appends a `donation.batched`
`audit_log` row in the **same** transaction (mirroring `recordDonation`'s audit shape).
A blocked donation throws a typed `BatchAssignmentError` (`already_batched` /
`not_eligible` / `not_found`), so `writeWithAudit` rolls **both** the state and audit
writes back — never a half-batched donation. The transaction shape is unit-tested
DB-free against a mocked pool (`test/unit/donations-batch.test.ts`); the real SQL is
verified against the local DB (the batched row + its audit row commit together; a
second assignment on the same donation throws and writes neither). The claim-export /
submission pipeline (REQ-052) and the admin RBAC that gates it (REQ-062) that will
*call* this helper are separate follow-ups.

**Charities Online export row builder (REQ-052 · TASK-082).** `src/claims/charities-online.ts`
is the **pure**, DB-free formatter that turns an already-eligible donation + its linked
declarations row into HMRC's Charities Online claim columns, in order: **Title, First name,
Last name, House name/number, Postcode, Donation date, Amount** (`CHARITIES_ONLINE_COLUMNS` is
the single source of the ordering). It is **read-only formatting** — it sources only existing
columns (declarations `title`/`first_name`/`last_name`/`house_name_number`/`postcode` and
donations `created_at`/`amount_pence`, see **Donation data model** below), adds none, and does
**not** re-derive eligibility: the caller (the REQ-052 claim pipeline) passes only rows that
already satisfy the claim invariant (individual donor, active declaration, not refunded —
`deriveClaimStatus`). `buildCharitiesOnlineRow` formats the **Donation date** as
`DD/MM/YYYY` (UTC components, so no clock and no timezone drift) and the **Amount** as a plain
decimal GBP string (`amount_pence / 100`, two places — never pence); Title passes through
(HMRC allows a blank title) while a missing first/last name, house name/number or postcode
**throws** `CharitiesOnlineExportError` rather than emitting a blank HMRC column.
`toCharitiesOnlineCsv` serializes a header row + **one row per donation** (RFC-4180 quoting,
CRLF-joined), so two gifts sharing one enduring monthly declaration (e.g. two `invoice.paid`
charges) each get their own independent row. Pure like `src/declarations/fields.ts` /
`src/declarations/render.ts` (no pool/config/clock), unit-tested DB-free
(`test/unit/charities-online-export.test.ts`). The *submission* of the file to HMRC (and the
admin/RBAC that triggers it) are REQ-052/REQ-062 follow-ups.

**Refund/dispute claim recalculation (REQ-037/REQ-063 · TASK-093).** `src/claims/refund.ts` is the
**pure**, DB-free calculator that recomputes a donation's claim state after a refund or dispute.
`recalculateClaimOnRefund({ donorType, giftAid, hasDeclaration, amountPence, refundedPence,
claimStatus })` returns `{ claimStatus, adjustmentPence, receiptAction }`, extending the shared
`deriveClaimStatus` invariant with refund awareness: a **not-yet-claimed** individual gift
re-derives eligibility from the **retained** (post-refund) amount (a full refund → `not_eligible`,
a partial one keeps `eligible`); an **already-batched/claimed** gift cannot un-claim what HMRC has,
so it returns `claimStatus: 'adjustment_due'` with `adjustmentPence` = the refunded portion of the
already-claimed amount; and a **company** gift never claims Gift Aid, so its `claim_status` is left
untouched and only the Corporation Tax receipt is actioned (`receiptAction` `'void'` on a full
refund, `'correct'` on a partial). A refund exceeding the donation throws a typed `RefundError`.
Pure like `src/benefits/caps.ts` / `src/subscriptions/dunning.ts` (no pool/config/clock),
unit-tested DB-free (`test/unit/refund-calculator.test.ts`). Wiring it into the
`charge.refunded` / `charge.dispute.*` webhook (which today re-derives only the not-yet-claimed
case) is a follow-up.

**Charities Online export query + CLI (REQ-052 · TASK-083).**
`listClaimableDonationsForExport(claimBatchId?)` in `src/db/donations.ts` is the read that
*selects* those eligible rows: every `claim_status = 'eligible'` donation INNER-joined to its
immutable `declarations` row and its `donor`, optionally scoped to one `claim_batch_id`,
ordered by donation id. Read-only (`pool.query`, no transaction/audit — mirrors
`listPublicSupporters`), and it does **not** re-derive eligibility: `claim_status` is set at
write time by `deriveClaimStatus` (individual donor + Gift Aid + an active declaration, not
refunded — REQ-037), so the filter alone excludes company and otherwise non-claimable gifts and
the inner join drops any eligible row without a declaration. Its results feed straight into the
pure `toCharitiesOnlineCsv` above. The thin CLI **`scripts/export-charities-online.mjs`**
(`npm run export:charities-online`, run via `tsx`, going through `src/db/pool.ts`) writes the
CSV to **stdout** or, with `-- --out claim.csv`, to a file, and accepts `-- --batch <id>` to
scope to one claim batch:

```bash
npm run export:charities-online                  # all eligible donations -> stdout
npm run export:charities-online -- --batch 7     # only claim_batch_id = 7
npm run export:charities-online -- --out claim.csv
```

The produced CSV is a header row of the seven Charities Online columns —
`Title,First name,Last name,House name/number,Postcode,Donation date,Amount` — then one row per
eligible donation (`DD/MM/YYYY` date, plain-decimal GBP amount). No admin auth/UI is in scope:
this only produces the correct file for **finance to run and upload manually** (needs the app
config env the service boots with, since the query goes through `pool.ts`); the authenticated
trigger surface is REQ-062/REQ-063. The DB-free query shape is proven by
`test/unit/charities-online-query.test.ts` (mocked pool).

**Declaration revision (REQ-059 · TASK-097 / TASK-128).** A Gift Aid declaration's **consent** is
immutable (REQ-046): changing the **scope** or **taxpayer confirmation** revokes the old row and
inserts a superseding one. An **identity / address** change (name, house name/number, address,
postcode, overseas-address flag) is only an HMRC matching detail, so it **amends the enduring
declaration in place** with a **`declaration.amended`** audit note — no revoke, no new row.
Revoke-and-supersede on a consent change is NBCC's design choice for a clean audit trail; HMRC does
**not** require a new declaration for an address change — it permits noting the change on the
enduring declaration. The **pure** `src/declarations/revision.ts` (`buildDeclarationRevision`, no
pool/config and no ambient clock — the timestamp is injected) builds the candidate row (carrying the
**current** verbatim wording, `selectDeclarationWording`) and classifies the diff, returning **null**
(no-op), `{ kind: "amend", declarationId, changes, changedFields }` (identity change), or
`{ kind: "revise", revokedDeclaration, newDeclaration }` (consent change). The transactional
`reviseDeclaration` (`src/db/declarations.ts`, mirroring `assignDonationToBatch`) does it in **one**
`BEGIN…COMMIT`: locks the row (`FOR UPDATE`), rejects an unknown id / already-revoked row with a typed
`DeclarationRevisionError`, then for an **amend** updates the matching columns + one
`declaration.amended` audit row, or for a **revise** inserts the new immutable row, sets the old row's
`revoked_at` + `superseded_by_declaration_id`, and appends a `declaration.revoked` + a
`declaration.created` audit row — any throw rolls back **all** of it, returning
`{ outcome: "unchanged" | "amended" | "revised", … }`. It **never** touches `donations` (an existing
`donation.declaration_id` is left as is). Proven DB-free (`test/unit/declaration-revision.test.ts`).
The **amend** path is donor-reachable via `PATCH /api/portal/:token/declaration` (TASK-129) — see the
portal API above.

**Declaration confirmation lifecycle (REQ-057 · TASK-074).** A Gift Aid declaration
captured without a wet/online signature (in-person, telephone) must be confirmed by the
donor before the gift is claimable. Two additive `donations` columns track this
(migration `1783010739790_declaration-status-and-token.js`, additive/expand-contract —
new NOT-NULL-defaulted + nullable columns, no existing column touched): **`declaration_status`**
(`text`, default `not_required`, CHECK in `not_required` / `pending` / `sent` /
`undelivered` / `completed`) and a unique nullable **`declaration_token`** (the unguessable
token in the confirmation link, addressing exactly one donation; many NULLs coexist under
the unique constraint). The **pure** state machine in `src/declarations/status.ts`
(`nextDeclarationStatus` / `canApplyDeclarationEvent` / `applyDeclarationEvent`, no
pool/config/clock) is the single source of truth for legal transitions: `require`
(`not_required→pending`), `send` (`pending→sent`), `confirm` (`sent→completed`),
`mark_undelivered` (`sent→undelivered`), `resend` (`undelivered→sent`). `completed` is
**terminal** and reachable **only** by an explicit `confirm` from `sent` — a page view /
bare GET of the confirmation link is not an event and can never mark a declaration
completed. An illegal transition throws a typed `DeclarationTransitionError`. Unit-tested
DB-free (`test/unit/declaration-status.test.ts`). This lays the column + rules only; the
letter/link sending and the token-driven persistence that *call* the helper are a later task.

**Donor portal magic-link tokens (REQ-061 · TASK-100).** The self-serve donor portal is entered
passwordlessly via a **one-time, expiring magic link**. The additive `portal_access_tokens` table
(migration `1783074071570_portal-access-tokens.js`: `donor_id` FK **`onDelete CASCADE`** — a token
is worthless once its donor is gone — a unique `token`, `expires_at`, a nullable `used_at`,
`created_at`) stores the grants. The **pure**, DB-free `src/portal/tokens.ts` owns the rules:
`issuePortalToken` builds the record (`expires_at = now + ttl`, ~30 min; clock injected),
`verifyPortalToken` throws a typed `PortalTokenError` for a missing / **expired** / **already-used**
token or returns the granted `donorId`, and `portalMagicLink(base, token)` builds the URL on
`PORTAL_BASE_URL`. The audited writes are `src/db/portal.ts` (mirroring `reviseDeclaration`): a
`BEGIN…COMMIT` `issuePortalAccessToken` (generate a random token, INSERT, `portal.token_issued`
audit) and `consumePortalToken` (lock `FOR UPDATE`, `verifyPortalToken`, stamp `used_at`,
`portal.token_used` audit) — `used_at` is the one-time-use enforcement, so a replay finds it set and
throws `already_used`. The send is `sendPortalMagicLink` (`src/clients/email.ts`, same best-effort
stub-seam). `PORTAL_BASE_URL` is a required config value (schema + `.env.example` + CI env + SSM
`String` + ECS task-def env — golden rule 3). Proven DB-free by `test/unit/portal-tokens.test.ts`
(pure verify + mocked-pool issue/consume). The portal **read/update API** that authenticates with
these tokens is wired in TASK-101 — see **`GET`/`PATCH /api/portal/:token`** under the API section.

**Subscription dunning lifecycle (REQ-065 · TASK-091).** A monthly (subscription) donor's card
renewal can fail; Stripe Smart Retries re-attempts it (~3 attempts over ~2 weeks) before giving
up. The additive `subscription_dunning` table (migration
`1783063189615_subscription-dunning.js` — one row per subscription: `donor_id` FK, unique
`stripe_subscription_id`, `status` CHECK `active`/`past_due`/`lapsed` default `active`,
`failed_attempts`, nullable `lapsed_at`, `created_at`/`updated_at`) records where a subscription
is in that lifecycle. The **pure** state machine in `src/subscriptions/dunning.ts`
(`nextDunningStatus` / `canApplyDunningEvent` / `applyDunningEvent`, no pool/config/clock) owns the
legal transitions across three events: `payment_failed` (`active→past_due`, and `past_due→past_due`
on a further failure), `payment_succeeded` (`past_due→active`, and a no-op on `active`), and
`retries_exhausted` (`past_due→lapsed`). `lapsed` is **terminal** and reachable **only** via an
explicit `retries_exhausted` (driven by Stripe's `invoice.payment_failed` with
`next_payment_attempt: null`, or the subscription reaching `unpaid`/`canceled` — never a bare
webhook replay); any event on a `lapsed` row throws a typed `DunningTransitionError`. The
`nextFailedAttempts` helper increments/resets the counter alongside the status. **The retry cadence
itself (~3 attempts / ~2 weeks) is a Stripe Dashboard "Smart Retries" setting, not an API/config
value this service sets** — the table only records the outcome Stripe reports. Unit-tested DB-free
(`test/unit/subscription-dunning.test.ts`). The webhook that reads Stripe's invoice/subscription
events and persists the status (plus the lapsed-subscription notifications) is wired in TASK-092 —
see **Lapsed-subscription notifications** under the webhook section below.

**Declaration wording (REQ-040).** `src/declarations/wording.ts` is the versioned,
verbatim source of truth for HMRC's Gift Aid liability statements — a
single-donation template (`hmrc-single-…`) and a multiple/all-donations template
(`hmrc-all-donations-…`), each an immutable version id + full statement string.
`selectDeclarationWording({ mode, scope })` picks the all-donations template for an
enduring gift (any monthly, or `all_donations` scope) and the single-donation
template for a one-off, returning `{ wording_version, wording_snapshot }` — the exact
`declarations` columns — so a saved declaration records the precise text the donor
saw. `assertFullLiabilityStatement` / `wordingSnapshotSchema` reject wording that
omits the taxpayer-responsibility clause (bare `"I am a UK taxpayer"`), requiring the
full Income / Capital Gains Tax liability sentence by **content**, not length. Pure
and DB-free (`test/unit/declaration-wording.test.ts`); the declaration-capture
form/endpoint (REQ-043) and persistence via `writeWithAudit` are separate.

**Declaration field capture (REQ-043 · TASK-061).** `src/declarations/fields.ts` is the
pure, DB-free validation + row builder for the fields a Gift Aid declaration captures:
`title` (optional), `firstName`, `lastName`, `houseNameNumber` (a separate HMRC matching
key), the rest of the **one** home address, and a UK `postcode`, with a `nonUk` flag
(Channel Islands / Isle of Man) that omits the postcode. `declarationFieldsSchema` is a
`.strict()` zod schema — so a stray work / c-o address field is **rejected**, there is
one home address only — that validates the postcode against `UK_POSTCODE_RE` (the GOV.UK
format) and requires the house name/number, both waived when `nonUk` is true.
`buildDeclarationRow(fields, { donorId, scope, wording, confirmedTaxpayer })` maps the
validated fields onto the snake_case `declarations` columns (nulling the postcode for a
non-UK declaration), pairing them with the REQ-044 `scope` and the REQ-040 wording
snapshot. Pure and DB-free (`test/unit/declaration-fields.test.ts`); threading these
through the checkout endpoint and persisting a `declarations` row via the webhook is
REQ-043's follow-up (TASK-062/063), not built here.

**Partnership shares (REQ-051 · TASK-079).** `src/declarations/partnership.ts` is the
pure, DB-free model for a business-**partnership** donation, which — unlike an individual or
company — is covered by **one Gift Aid declaration per partner** rather than the single
`donations.declaration_id` FK. `partnerShareSchema` extends the shared declaration fields
(same base + non-UK postcode/house rules as `src/declarations/fields.ts`, reused via the
exported `declarationFieldsBase` + `refineDeclarationFields`) with a positive-integer
`sharePence` — a partner's share of the gift. `validatePartnerShares(partners,
totalAmountPence)` accepts **only** when there is at least one partner, every partner is a
valid declaration+share, and the shares sum **exactly** to the donation total; any empty
list, invalid partner, or over-/under-sum throws a typed `PartnerShareError`. The validated
partners persist through the `donation_partner_shares` join table (migration
`1783015422184_partnership-shares.js`); the eligibility/claim logic that reads them is a
REQ-051 follow-up, not built here. Pure and DB-free (`test/unit/partnership-shares.test.ts`).

**Threading partnership shares through checkout + the webhook (REQ-051 · TASK-081).** The
`POST /api/checkout-session` body accepts `donorType: "partnership"` and a `partners` array
(each a full declaration + `sharePence`, validated by `partnerShareSchema`). A zod
`superRefine` runs `validatePartnerShares(partners, amount)` for the gift-aided partnership
path, so a payload whose shares do **not** sum exactly to `amount` (or that carries no
partners) is rejected **400** before Stripe is called; the individual/company paths are
untouched. On success the validated partners are stamped as a compact JSON array on the
session metadata (`metadata.partners`) alongside the shared scope + wording — *not* the
single `decl*` fields. The single Stripe webhook (`src/db/stripe-webhook.ts`) then reads them
via `partnerSharesFromCheckoutSession` and, in the **same** `writeWithAudit` transaction as
the donor + donation, inserts **one immutable `declarations` row + one
`donation_partner_shares` row per partner** (`insertPartnerShare`) — the shares FK the
donation id, so they are written *after* it, and `donations.declaration_id` stays null (the
shares carry the declarations). Any throw rolls **all** of it back together (declarations,
partner shares, donation, audit). A partnership donor is persisted with `donor_type =
'individual'` (partners are individuals in law). Verified DB-free against a mocked pool by
`test/unit/checkout-session.test.ts` (the 400 sum check) and
`test/unit/stripe-webhook-declaration.test.ts` (the per-partner inserts + shared rollback).
The aggregate **claim eligibility** of a partnership gift (deriving `claim_status` from the
partner declarations rather than a single `declaration_id`) is a REQ-051 follow-up.

**Declaration retention (REQ-046 · TASK-068).** `src/declarations/retention.ts` is the
pure, DB-free calculator for how long an immutable declaration must be kept.
`computeRetentionExpiry({ scope, subscriptionActive, lastClaimedDonationAt, cancelledAt })`
returns the retention-expiry `Date`, or `null` to retain indefinitely. HMRC's six-year
window (`RETENTION_YEARS`) runs from the **most recent claimed donation**: while an enduring
/ monthly declaration's subscription is active it is retained indefinitely (`null`); once
inactive or cancelled the six-year clock is anchored to the **final claimed charge**
(`lastClaimedDonationAt` as of cancellation), **not** the cancellation timestamp — a
cancellation long after the last charge cannot extend retention. A `this_donation`
declaration with a single claimed donation expires six years after that donation. **Edge
case:** a declaration with **no claimed donation at all** has no anchor for the clock —
nothing to retain against — so the calculator returns `null` deterministically (no throw),
which the caller reads as "no computable expiry", not "retain forever". Online declarations
require **no 30-day confirmation letter** (REQ-046 accept clause), so no confirmation-window
offset is modelled. It reads nothing from the DB (`donations.created_at`,
`claim_status`, `declaration_id` already exist per migration `1782923222001`); no migration
is needed, since no persisted column or admin surface consumes it yet — the REQ-063 admin
retention-expiry queue that will call it is out of scope. Pure and DB-free
(`test/unit/declaration-retention.test.ts`).

**The Stripe webhook (REQ-036 / TASK-046).** `POST /api/stripe/webhook`
(`src/routes/stripe-webhook.ts`) is the **single** set of Stripe webhooks — no
other route touches donor/donation events. It is mounted **before** `express.json`
in `src/app.ts` and parses its own body with `express.raw`, so the raw bytes are
available for signature verification: `constructEvent` (`src/clients/stripe.ts`,
using `STRIPE_WEBHOOK_SECRET`) rejects a bad/missing signature with **400**. Pure
event→record mapping lives in `src/db/stripe-webhook-model.ts` (DB-free,
`test/unit/stripe-webhook-model.test.ts`); the transactional processor
`src/db/stripe-webhook.ts` handles each event through the REQ-037 write helpers in
ONE transaction, **idempotent by event id** (a `stripe_webhook_events` ledger with
`ON CONFLICT DO NOTHING`; migration `1782924697956_stripe-webhook-events.js`):

- **`checkout.session.completed`** → persists the donation, recording Gift Aid as
  a flag when `metadata.giftAid === 'true'` (stamped by the REQ-029 checkout), and
  routing `metadata.donorType` / `metadata.businessName` onto the donor's
  `donor_type` / `business_name` (REQ-038). `donor_type` is the single field that
  governs claims: a `company` donation is stored `gift_aid=false` and derives
  `claim_status='not_eligible'` via `buildDonationRow` — never a second store
  (REQ-036/REQ-053). It also maps the REQ-039 contact capture onto the donor:
  `full_name` (falling back to the Stripe cardholder name), the `anonymous` flag, and
  `email` + `email_consent` **only** when consent was given — otherwise no email is
  stored, so the platform sends nothing. For a gift-aided individual it also **inserts
  an immutable `declarations` row** (REQ-043/TASK-063) from the `decl*` metadata — paired
  with the stamped wording snapshot (REQ-042) and scope (REQ-044 — the enduring monthly
  default maps to `all_donations`, and a donor's explicit override is carried through
  verbatim) — and links the donation's `declaration_id` to it,
  in the **same** transaction with its own `declaration.created` audit row, so the
  donation derives `claim_status='eligible'` (REQ-037).
  The whole donor journey — `POST /api/checkout-session` → the signed
  `checkout.session.completed` Stripe fires → the resulting donor/donation/declaration
  rows — is exercised end to end for every persona (individual UK / non-UK / anonymous,
  monthly enduring, company with/without consideration, partnership, BACS pending→settled)
  by the `@db` `features/donation-journey.feature`. It replays the **real** stamped
  metadata rather than re-authoring it: in stub mode only, the checkout endpoint echoes
  the built session on its 200 body, and the step feeds that verbatim into the webhook —
  so a drift between what the checkout stamps and what the webhook reads fails the test.
- **`invoice.paid` / `invoice.payment_succeeded`** → records each recurring
  monthly charge as a further donation against the SAME donor (found via the
  subscription id), carrying the Gift Aid flag + declaration from the original.
  The amount recorded is the invoice's **actually-charged amount** (`amount_paid`),
  never the plan's preset tier value — so a mid-subscription up/downgrade
  (`subscription_update`) claims the true prorated amount, needing no special Gift
  Aid handling beyond the actual amount charged (REQ-055). Only the first
  `subscription_create` invoice is skipped (already captured at checkout, so not
  double-counted); `subscription_update` / `subscription_cycle` invoices each
  become their own donation row. The pure `recurringDonationInput` mapping
  (`src/db/stripe-webhook-model.ts`) is unit-tested DB-free.
- **`charge.succeeded` (card-present only)** → records an **in-person** gift
  (Stripe Terminal / `payment_method_details.type === 'card_present'`, REQ-054/TASK-073).
  A card-present tap has no checkout session, so it is captured straight off the charge:
  the pure `cardPresentDonationInput` (`src/db/stripe-webhook-model.ts`) maps it to a
  one-off `payment_channel='in_person'` donation with **no Gift Aid / declaration**
  (→ `claim_status='not_eligible'`), and the processor books an **anonymous walk-in
  donor** + the donation + a `donation.created` audit row in one transaction. A
  **non**-card-present `charge.succeeded` (an online `'card'` charge) is **ignored** —
  that gift is already captured by `checkout.session.completed`, so `cardPresentDonationInput`
  returns null and no row is written (the double-count guard). Idempotent by event id like
  every branch, so a resent charge creates no duplicate. The in-person donation is stamped
  `declaration_status='pending'` + a unique `declaration_token` in the same transaction, and
  — when the charge carried a `receipt_email` — the walk-in donor is emailed a
  token-addressed Gift Aid declaration link + QR short link **post-commit** (TASK-075, see
  **In-person declaration email** below).
- **`charge.refunded` / `charge.dispute.*`** (REQ-063 · TASK-095) → updates the SAME donation
  record's `refunded_amount_pence` (absolute, so replay-safe) and recomputes the claim state via
  the pure `recalculateClaimOnRefund` (TASK-093), never a duplicate row. A **not-yet-claimed** gift
  re-derives `claim_status` from the retained amount; an **already-batched/claimed** gift is set
  `claim_status='adjustment_due'` and gets a **`claim_adjustments`** row (tied to its
  `claim_batch_id`, amount = the refunded portion of the claimed gift) + a `claim.adjustment_recorded`
  audit row **in the same transaction**; a **company** gift leaves `claim_status` untouched and
  sends a **void/correction Corporation Tax receipt notice** (`buildCompanyRefundNotice`) to its
  billing contact **post-commit** (best-effort, via the company-receipt channel). An **individual**
  donor is also emailed a **refund confirmation** (REQ-063 · TASK-099 — `buildRefundConfirmation` /
  `sendRefundConfirmation`) stating the refunded amount + date (full vs partial), **post-commit,
  best-effort**, and **only** when a consented donor email is on file (the same
  `email` + `email_consent` gate as the donation-confirmation send); a company never gets this email.
  Idempotent by event id. Covered DB-free in `test/unit/stripe-webhook-refund.test.ts`.
- **`checkout.session.async_payment_succeeded` / `checkout.session.async_payment_failed`**
  (REQ-065 · TASK-090) → settle a pending **BACS** gift. Found by its **session id** (never a new
  row), the SAME donation's `payment_status` flips to `paid`/`failed` and `claim_status` is
  re-derived through `deriveClaimStatus`: a succeeded gift becomes `eligible` only if it is an
  individual, gift-aided, declared and not refunded; a failed gift is permanently `not_eligible`.
  Each writes a `donation.payment_succeeded` / `donation.payment_failed` audit row in the same
  `writeWithAudit` transaction. Idempotent by event id like every branch, so a resent event applies
  no second time.
- **`invoice.payment_failed` / `customer.subscription.updated` / `customer.subscription.deleted`**,
  and the dunning side of **`invoice.paid` / `invoice.payment_succeeded`** (REQ-065 · TASK-092) →
  advance the **subscription dunning** lifecycle. The pure `dunningFromStripeEvent` maps the Stripe
  event to a dunning event — `invoice.payment_failed` is `payment_failed` while a retry is still
  scheduled (`next_payment_attempt` set) or `retries_exhausted` once Stripe gives up
  (`next_payment_attempt: null`); a successful invoice is `payment_succeeded` (recovers dunning);
  a subscription reaching `unpaid`/`canceled` (updated/deleted) is `retries_exhausted`. `handleDunning`
  finds the donor by subscription id, applies the transition via the pure `src/subscriptions/dunning.ts`
  state machine, and **UPSERTs the `subscription_dunning` row + a `subscription.payment_failed` /
  `subscription.payment_recovered` / `subscription.lapsed` audit row in the SAME transaction**. A
  legal-but-no-op event (a success with no open dunning, or a voluntary cancel while active) is
  ignored, never applied. Idempotent by event id.

**Lapsed-subscription notifications (REQ-065 · TASK-092).** When a subscription **lapses** (Smart
Retries exhausted → `subscription_dunning.status='lapsed'`, `lapsed_at` set), the processor sends —
**post-commit, best-effort** (mirroring the confirmation-email send) — two notices via
`src/clients/email.ts`: an **admin** notice to the fixed `ADMIN_NOTIFICATION_EMAIL` inbox (**always**),
and a **donor** notice **only** when the donor gave us an `email` + `email_consent` (the same consent
gate as the confirmation email). Because the sends are after the transaction commits and gated by the
event-id ledger, a resent lapse event applies the transition and sends the emails **at most once**.
`ADMIN_NOTIFICATION_EMAIL` is a required config value (schema + `.env.example` + CI env + SSM `String`
+ ECS task-def env — golden rule 3). Covered DB-free in `test/unit/stripe-webhook-dunning.test.ts`.

**BACS pending payments (REQ-065 · TASK-090).** BACS Direct Debit settles asynchronously, so a
`checkout.session.completed` for a BACS gift arrives with Stripe `payment_status='unpaid'` — the
pure `donationFromCheckoutSession` maps that onto `payment_status='pending'` (a card gift is
`paid`). Because `deriveClaimStatus` only returns `eligible` when `payment_status='paid'`, a
pending gift persists **non-claimable even with Gift Aid + a valid declaration** (the declaration
row is still inserted). When the mandate confirms, `async_payment_succeeded` flips it to `paid` and
re-derives `eligible`; `async_payment_failed` sets `failed` (permanently non-claimable). Covered
DB-free in `test/unit/stripe-webhook-bacs.test.ts` and end to end in the `@db`
`features/stripe-webhook.feature` BACS scenario.

**Donation-confirmation email (TASK-070).** After a `checkout.session.completed`
(and each recurring `invoice.paid`) donation row **commits**, the processor sends a
single confirmation email via `src/clients/email.ts`
(`sendDonationConfirmation`) — but **only** when the donor gave us their `email` and
`email_consent` is true (`confirmationEmailFor`, the pure consent gate in
`src/db/stripe-webhook-model.ts`); a withheld email / no-consent sends nothing. The
send happens **after COMMIT and outside the transaction**, and is **best-effort**: a
slow or failing provider is swallowed, never rolling back a recorded gift or forcing
a Stripe redelivery. The email **content** is built by the pure, DB-free
`buildDonationConfirmation` (`src/donors/confirmation.ts`, REQ-060 · TASK-098 —
mirroring `buildCorporationTaxReceipt`), which reflects **only what the donor actually
did**: a **Gift Aid confirmation line** is included **only** when Gift Aid was opted in
(with an enduring clause for a monthly gift), and **manage/cancel instructions** (reusing
the verbatim REQ-026 reassurance copy — cancel any time, contact Jaimie Wakefield, since no
self-serve portal REQ-061 exists yet) **only** for a monthly gift; a one-off / non-Gift-Aid
gift omits the parts that don't apply. It invents **no** new legal wording (the verbatim HMRC
statement is bound at declaration time in `src/declarations/wording.ts`). The **consent gate is
unchanged** — no email is sent without a consented address — and a **company** donation is
untouched (it uses the Corporation Tax receipt path, TASK-088, not this confirmation).
`test/unit/donation-confirmation-email.test.ts` (mocked client) proves exactly one send on
email+consent and none otherwise, plus the Gift Aid / manage-cancel content rules.

> **Stub seam (no live email provider needed).** `src/clients/email.ts` POSTs to a
> real `EMAIL_SEND_URL` when one is configured. **Outside production**, when the URL
> is a `.example` placeholder (local dev, CI, fresh SSM param), the send is stubbed
> (no network). `EMAIL_SEND_URL` is wired through config, `.env.example`, the CI env,
> SSM, the task-def `secrets` and the `exec_secrets` IAM policy (golden rule 3).

**In-person declaration email (TASK-075 / REQ-048).** A card-present (in-person) gift
captures no Gift Aid declaration at the till, so the walk-in donor is offered one
afterwards. When `charge.succeeded` books the in-person donation (above), it is stamped
`declaration_status='pending'` + a unique `declaration_token` in the same transaction; then
**post-commit** (like the confirmation email — best-effort, outside the transaction) the
processor emails the charge's `receipt_email` a **token-addressed declaration link** plus a
**QR-encodable short link** (both built by the pure `declarationLinks(base, token)` on
`DECLARATION_FORM_BASE_URL`, via `sendDeclarationEmail`). The send outcome flips the status
through the pure state machine (`applyDeclarationEvent('pending', …)`, TASK-074): a
successful send → **`sent`**, a throwing send → **`undelivered`** — set by a **separate**
`UPDATE`, so neither the send nor its status stamp can roll back the committed donation. A
charge with no `receipt_email` stays `pending` (a printed-QR follow-up). Proven DB-free by
`test/unit/declaration-email.test.ts` (mocked pool + email client): exactly one send to
`receipt_email` with a unique link/QR and `declaration_status='sent'`; `undelivered` on a
throw; the donation never rolled back. `DECLARATION_FORM_BASE_URL` (non-secret, but
SSM-injected like the price IDs) is wired through config, `.env.example`, the CI env, SSM,
the task-def `secrets` and the `exec_secrets` IAM policy (golden rule 3).

**Gift Aid declaration completion page (TASK-076 / REQ-048).** The token in that email
addresses the donor to the completion form. `GET /api/gift-aid/:token` (`src/routes/api.ts`)
looks the donation up by `declaration_token` and **server-renders** `gift-aid.html` — the
ported declaration fieldset + the **verbatim HMRC statement** (from
`src/declarations/wording.ts`) with the token injected into the form action — **without any
write**, so a mere view never advances `declaration_status` off `sent`/`undelivered`.
`POST /api/gift-aid/:token` validates the (url-encoded, no-JS) form with the existing
`declarationFieldsSchema` and calls `completeDeclaration` (`src/db/donations.ts`), which in
**one audited transaction** (`writeWithAudit`, mirroring `assignDonationToBatch`): locks the
donation by its token (`FOR UPDATE`), enforces the legal `confirm` transition
(`applyDeclarationEvent` — only a `sent`/bounced-`undelivered` link completes; an already
`completed`/`not_required`/`pending` token throws `GiftAidCompletionError` → 409, an unknown
token → 404), inserts the **immutable `declarations` row** (`buildDeclarationRow`), links it
onto `donations.declaration_id`, and — since the donor has now Gift-Aided the gift — sets
`gift_aid=true`, `declaration_status='completed'` and recomputes `claim_status` (an
individual with Gift Aid + a declaration is `eligible`), appending a `declaration.completed`
audit row. Any throw rolls back **both** the declaration and the audit row, so a token that
merely rendered the form is never read as completed until this POST succeeds. The TASK-075
email links (`/gift-aid/declare?token=…`, `/g/:token`) redirect here (`src/routes/site.ts`).
Proven DB-free by `test/unit/gift-aid-completion.test.ts` (mocked pool — GET issues only the
lookup SELECT; POST completes from `sent`/`undelivered`, refuses `completed`/`pending`/
unknown) and `test/unit/gift-aid-render.test.ts`; end to end by `features/gift-aid.feature`.

`constructEvent` uses a real Stripe instance (pure HMAC, no network), so the stub
seam still holds: unit tests and `features/stripe-webhook.feature` sign events
offline with `STRIPE_WEBHOOK_SECRET` via `generateTestHeaderString` — no live
account needed. The secret is wired through config, `.env.example`, SSM, the
task-def `secrets` and the `exec_secrets` IAM policy (golden rule 3).

**Reusable idempotency helper (REQ-036 / TASK-048).** `src/webhooks/idempotency.ts`
factors the de-dup out as a small, composable foundation: `claimWebhookEvent(client,
id, type)` runs `INSERT … ON CONFLICT (stripe_event_id) DO NOTHING` against a
`webhook_events` ledger (migration `1782926443623_webhook-events.js`) and reports
`alreadyProcessed`, and `markWebhookEventProcessed` stamps `processed_at`. Both take
the caller's `PoolClient`, so they compose **inside** one `writeWithAudit`
transaction rather than opening their own — unit-tested DB-free against a mock client
(`test/unit/idempotency.test.ts`). It is the designed drop-in for the handler above,
which currently performs the same claim inline against its own
`stripe_webhook_events` ledger; consolidating the handler onto this helper and
retiring the inline ledger (an expand-contract drop) is a small follow-up.

**Claim batches + users (REQ-037 / REQ-052 / REQ-062 · TASK-056).** The additive
migration `migrations/1782987698792_claim-batches-and-users.js` lays the two model
rows the claim pipeline and admin back-end will write through — the follow-up the
unified-model migration deliberately named but did not build:

- **`claim_batches`** — a Charities Online claim batch of eligible donations
  (REQ-052): `status` (`open`/`submitted`/`adjustment_due`, default `open`), a
  nullable `submitted_at`, and the export identity — `regulator` (default `OSCR`),
  `charity_number` (default `SC047995`) and a nullable `hmrc_reference`.
- **`users`** — minimal admin/staff accounts: a unique `email`, `full_name`, and a
  `role` check (`viewer`/`editor`/`admin`, default `viewer`). The table only records
  the role; **REQ-062 owns the actual RBAC enforcement and the admin back-end** — not
  built here.

It also adds the nullable `donations.claim_batch_id` FK (`onDelete RESTRICT`, indexed)
whose single-column-ness enforces one-batch-per-donation (REQ-037). Every operation is
additive (two new tables + a nullable FK column, no existing shape touched), so a
code-level rollback stays safe (golden rule 2). Still separate follow-ups: the REQ-052
export/submission pipeline and the REQ-062 admin RBAC that assemble and gate batches,
plus the admin-write audit invariant (every admin write appends an `audit_log` row).

**Claim adjustments (REQ-063 · TASK-094).** A refund/dispute on an ALREADY-CLAIMED donation
owes HMRC an adjustment (the pure recalculation is `src/claims/refund.ts`, TASK-093). The
additive migration `migrations/1783067859348_claim-adjustments-and-status.js` lays its
persistence: it **widens the `donations.claim_status` CHECK** (DROP + ADD to a superset —
`not_eligible`/`eligible`/`batched`/`claimed` **plus `adjustment_due`**, which can never reject
an existing row), and adds a **`claim_adjustments`** table — `donation_id` + `claim_batch_id`
FKs (both `onDelete RESTRICT`, indexed), `adjustment_pence` (`>= 0`, the refunded portion of the
already-claimed gift) and a `reason` text. Additive/expand-contract, safe on populated data
(golden rule 2). The webhook write that inserts the adjustment row and flips
`claim_status='adjustment_due'` on a refund/dispute is wired in TASK-095 (see the
`charge.refunded` / `charge.dispute.*` webhook branch above).

**Benefit tracking (REQ-045 · TASK-066).** The additive migration
`migrations/1783003547726_benefit-types-and-donation-benefits.js` lays the model for the
Gift Aid **benefit cap** — the catalogue of donor benefits and the benefits awarded per
donation — alongside the shape above:

- **`benefit_types`** — the catalogue: a unique `name`, an `is_recognition_perk` flag
  (default `false`), and a nullable `default_value_pence` (the typical monetary value used
  by the cap calc, `NULL` for a no-set-value perk). Seeded with the five recognition perks
  — `name-on-page`, `impact update`, `social thank-you`, `digital badge`, `certificate` —
  at `is_recognition_perk=true` and `default_value_pence` NULL.
- **`donation_benefits`** — a benefit awarded against one donation: FK `donation_id` →
  `donations` and `benefit_type_id` → `benefit_types` (both indexed, `onDelete RESTRICT`),
  a NOT NULL `value_pence` (the value attributed to this award; `0` for a no-value perk),
  and `created_at`.

It also adds the NOT-NULL-defaulted `donations.benefit_cap_breached` boolean (default
`false`, so every existing row back-fills without touching an existing column). Every
operation is additive (two new tables + a defaulted boolean column, no existing shape
touched), so a code-level rollback stays safe (golden rule 2).

**Benefit-cap calculation + write (REQ-045 · TASK-067).** The pure HMRC cap logic lives in
`src/benefits/caps.ts` — no pool/config/clock, so it is unit-tested DB-free
(`test/unit/benefit-caps.test.ts`), mirroring `src/db/donations-model.ts`. `benefitCapPence`
implements the three tiers on the **annualised donation**: ≤£100 → 25% of the donation,
£100–£1,000 → a flat £25, >£1,000 → 5% up to a £2,500 max. `deriveBenefitCapBreach({
annualisedDonationPence, benefitValuePence })` returns whether the (annualised) benefit
total exceeds that cap; `annualisePence` scales a monthly gift ×12 so the donation and the
benefit total are banded on the same yearly basis. The five seeded **recognition perks**
(`RECOGNITION_PERKS`) are always valued at **£0** via `recordedBenefitValuePence`, whatever
an admin enters. The transactional write is `recordDonationBenefits(donationId, donorId,
benefits[], actor?)` in `src/db/donations.ts` (mirroring `assignDonationToBatch`): in one
`BEGIN…COMMIT` it locks the donation (`FOR UPDATE`), inserts one `donation_benefits` row per
benefit (recognition perks zeroed), derives the cap breach from the annualised totals, sets
`donations.benefit_cap_breached`, and appends a `donation.benefits_recorded` `audit_log`
row — any throw rolls **both** back (verified DB-free against a mocked pool in
`test/unit/donation-benefits.test.ts`).

**GASDS ingestion + pool read (REQ-058/REQ-050 · TASK-078).** The card-present mapper
`cardPresentDonationInput` (`src/db/stripe-webhook-model.ts`) now sets `gasdsEligible` via
`isGasdsEligibleAmount` (a small in-person tap carries no declaration and no Gift Aid, so
eligibility rests on the amount); it rides through `donationInputSchema` → `buildDonationRow`
→ the `donations` INSERT (`insertDonation`), so the card-present processor (TASK-073) persists
`gasds_eligible` in the SAME transaction **without touching** the `gift_aid` / `claim_status`
derivation — a £25 tap lands `gasds_eligible=true`, `claim_status='not_eligible'`; a £50 tap
`gasds_eligible=false`. Every other channel (online checkout, recurring) leaves it `false`.
The annual pool read is `getGasdsPoolReport(year)` in `src/gasds/pool.ts` (the DB-read half of
the split, like `listPublicSupporters`): it sums this year's `gasds_eligible=true` amounts and
— by a **separate** query — this year's claimed Gift Aid amounts, then applies the pure
`gasdsPoolLimitPence` for the remaining headroom. The two sums are read independently so the
GASDS pool total is never conflated with the Gift Aid claim total it references (REQ-050).
Verified DB-free with a mocked pool (`test/unit/gasds-pool.test.ts`,
`test/unit/stripe-webhook-card-present.test.ts`) and end to end
(`features/stripe-webhook.feature`).

**GASDS eligibility (REQ-058 · TASK-077).** The additive migration
`migrations/1783014186353_gasds-eligible.js` adds the NOT-NULL-defaulted
`donations.gasds_eligible` boolean (default `false`, so every existing row back-fills without
touching an existing column — golden rule 2). The Gift Aid **Small Donations Scheme** lets a
charity claim a Gift-Aid-style top-up on small cash/contactless gifts it holds no declaration
for (e.g. an in-person card-present tap). The pure logic is `src/gasds/caps.ts` — no
pool/config/clock, unit-tested DB-free (`test/unit/gasds-caps.test.ts`) like
`src/benefits/caps.ts`. `isGasdsEligibleAmount(amountPence, { hasDeclaration, giftAid })` is
true only for a small gift (≤ **£30**) with **no** declaration and **no** Gift Aid (a gift is
never claimed under both schemes). `gasdsPoolLimitPence({ smallDonationsClaimedPenceThisYear,
giftAidClaimedPenceThisYear })` returns the remaining pool headroom as the binding (lowest) of
three caps — an **£8,000** annual ceiling, a **£2,000** top-up component, and **10×** the Gift
Aid claimed that year — minus what is already claimed, never negative. **Assumption flagged in
the code for NBCC finance sign-off:** the source wording was garbled, so the three figures are
treated as three *independent* ceilings and the minimum taken (the conservative reading that
can only under-claim). Setting `gasds_eligible` on ingestion and reading the pool are wired in
**TASK-078** (above); the downstream GASDS claim pipeline is a later task.

**`POST /api/contact` (REQ-030).** Validates a website enquiry
`{ firstName, lastName, email, message }` (the payload `initContactForm` posts,
REQ-027) zod-first — `firstName`/`email`/`message` required, `lastName` optional —
rejecting bad/missing fields with **400**. A valid enquiry is forwarded to the
configured form service via `src/clients/contact.ts` (`forwardEnquiry`, a thin
`fetch` wrapper reading `CONTACT_FORWARD_URL` through config) and returns
`{ status: "sent" }`. An upstream forwarding failure returns **502**, at which
point the front-end degrades to its `mailto:` fallback (REQ-027) — the documented
behaviour whenever the endpoint is missing or unavailable; this task does **not**
change `initContactForm`.

> **Stub seam (no live form-service account needed).** `src/clients/contact.ts`
> POSTs to a real URL when one is configured. **Outside production**, when
> `CONTACT_FORWARD_URL` is a `.example` placeholder (local dev, CI, fresh SSM
> param), the forward is stubbed (no network) so the request → success flow runs
> end to end (see `features/contact.feature`) without a form service. Production
> **never** stubs, so a missing/placeholder URL there returns 502 (→ mailto
> fallback). Verified by `test/unit/contact-endpoint.test.ts` (mocked client) +
> the BDD scenarios.

> **Hosting (REQ-033):** the marketing site and these endpoints are served by the
> **existing Express service on ECS/Fargate behind the ALB** — not a static host
> or serverless platform. This deliberately reuses the current AWS infra; the
> issue's "static deploy + serverless functions" (Vercel/Netlify) wording was
> adapted accordingly. The `_redirects` file + per-host notes above keep a
> static-host migration cheap if that ever changes.

### Performance budget

The four pages target a low-weight mobile budget:

| Metric | Budget |
|---|---|
| Lighthouse Performance (mobile) | ≥ 95 |
| Total transfer / page | ≤ 250 KB |
| Requests / page | ≤ 15 |
| Web-font files | ≤ 2 |
| LCP (mobile) | < 2.5 s |

How it's kept:

- **Fonts:** **two** self-hosted latin-subset `woff2` (Playfair Display + Poppins,
  one weight each, `font-display: swap`) — exactly at the ≤ 2 font-file cap,
  ~31 KB total. See **Typography (REQ-005)** above. Google Fonts is the documented
  alternative.
- **JS:** the one shared script loads with `defer` (never render-blocking); no
  framework bundles, no build step.
- **Images:** every `<img>` declares intrinsic `width`/`height` and uses
  `loading="lazy"`. Lazy images (the logos and the below-the-fold team headshots)
  are **deferred**, so they're **excluded from the initial-load budget** — see
  **Assets and images** below for that decision and the headshot pipeline.

`test/unit/perf-budget.test.ts` enforces the structural invariants (transfer
weight, ≤ 2 font files, no render-blocking JS, image attributes, request count)
in CI. A full **Lighthouse** pass needs headless Chrome, so run it manually
against the running app (mobile is Lighthouse's default form factor):

```bash
npm run build && node dist/index.js &     # serve on :3000
npx lighthouse http://localhost:3000/ --only-categories=performance --view
# repeat for /about-us, /donate, /contact
```

### Assets and images (REQ-016 / REQ-034)

All images live in **`assets/img/`** (the spec text says `images/`; we standardise
on `assets/img/`, where `nbcc-logo.png` already lives and which the pages and the
Dockerfile serve — one convention, documented here).

**Team headshots** are produced by `scripts/process-images.mjs` (run with
**`npm run images`**, which uses the `sharp` devDependency). Each source portrait in
`assets/img/source/<firstname>.{jpg,png,…}` is cropped to **4:5, 640×800, quality
82, progressive JPEG** with a slightly top-biased crop (keeps faces) and written to
**`assets/img/team-<firstname>.jpg`** (lowercase). The ten about-page headshots are
wired into `about.html`'s team grid as lazy `<img>`s framed by the `.photo-slot`
4:5 box. Until real photos exist the script generates **spec-correct placeholders**
at the exact size/quality, each flagged for swap-in — drop a consented photo into
`assets/img/source/` and re-run.

The same script also produces the **captioned scene photos** — `story-tygan.jpg`
(about "our story" founding headshot, 640×800, REQ-015) and `why-packing.jpg`
(home "why your donation matters" packing/delivery photo, 900×600, REQ-012),
wired into their `<figure class="photo-slot">` slots as lazy `<img>`s with the
`<figcaption>` kept — and the **social share card** `og-image.png` (1200×630 PNG,
REQ-034) referenced by every page's `og:image` / `twitter:image`. All three are
branded placeholders pending real assets (`CONTENT VERIFICATION`).

**Consent rule:** no beneficiary or volunteer photograph ships without recorded,
informed consent (beneficiary imagery — children, young people and vulnerable
adults — also needs guardian/safeguarding consent). Every image's source and
consent status is tracked in **`assets/img/CREDITS.md`**.

**Budget note:** because every image is `loading="lazy"`, the headshots (and real
consented photos later, ~644 KB total) are deferred and **don't count against the
250 KB first-paint budget**; `perf-budget.test.ts` still enforces the per-image
`width`/`height`/`lazy` invariant. That decision is recorded in the test. The
first-paint transfer cap is measured as summed **uncompressed** bytes (a conservative
proxy — real gzip/brotli transfer is roughly a quarter of it). It was re-baselined
from 150 KB to **250 KB** when the partnership Gift Aid capture (REQ-051 · TASK-080)
landed on `donate.html`, which added the repeatable per-partner declaration markup.

### Content and copy rules (REQ-031)

The 2025 NBCC donation leaflet is the **source of truth** for page content, and
the marketing copy follows a small house style:

- **No dashes in visible copy.** Reword rather than hyphenate — "one off",
  "year round", "volunteer run", "post Christmas", "South West Scotland" — and use
  commas, parentheses or restructured sentences instead of en/em dashes.
- **Write "NBCC"** in full (never a mistyped variant such as "NB4CC").
- **Beneficiaries** are always the full phrase **"children, young people and
  vulnerable adults"** — never a truncated form like "children and young people".
- Anything not yet confirmed against the leaflet is flagged inline with a
  `CONTENT VERIFICATION (REQ-NNN)` HTML comment.

`test/unit/copy-rules.test.ts` guards this across `index.html` / `about.html` /
`donate.html` / `contact.html` (and `supporters.html` once it exists). It scans
the **visible** copy only — the `<body>` text plus `alt` / `title` / `aria-label`
/ `placeholder` attributes, with `<script>` / `<style>` / `<svg>` stripped — so
hyphens inside URLs, `mailto:`/`tel:` hrefs, `data-*` attributes, SVG path data
and HTML comments don't trip it (and the `Page — Site` pattern in the SEO
`<title>`/`<meta>` is out of scope). The build fails if any page puts a dash in
visible copy, contains "NB4CC", or uses a truncated beneficiary phrase.

## Prerequisites

- Node 20, Docker, AWS CLI v2, Terraform >= 1.6
- An AWS account and a GitHub repo

## Local development

```bash
cp .env.example .env
docker compose up -d db          # Postgres only
npm ci
npm run migrate                  # apply migrations
npm run seed:demo                # optional: mock data across the model's cardinalities
npm run dev                      # http://localhost:3000/health
```

`scripts/seed-demo.mjs` (`npm run seed:demo`, reads `DATABASE_URL`) inserts a re-runnable demo
dataset covering the donation model's cardinalities — donors (individual/company, all supporter tiers,
anonymous), declarations (active/revoked/superseded/non-UK, retention expired + expiring), donations
across every `claim_status`/`mode`/`plan`/channel/`declaration_status`/refund/`payment_status`, claim
batches (open/submitted/adjustment_due), dunning (active/past_due/lapsed) and audit rows. It populates
the public supporters wall and every admin dashboard view/queue. Re-runnable: it clears its own
`@demo.nbcc`/`DEMO`-tagged rows first (the append-only audit rows insert once). Point `DATABASE_URL` at
staging RDS to seed there. Local-dev / demo only, never production donor data.

Or run the whole thing in containers: `docker compose up` (and
`docker compose run --rm migrate` once to migrate).

Tests:

```bash
npm run test:unit                # Vitest, no DB needed
node dist/index.js & npm run test:bdd   # Cucumber against localhost
```

## One-time AWS bootstrap

CI assumes an IAM role via OIDC and keeps Terraform state in S3 - both must
exist before any workflow runs. Run once, as an admin:

```bash
GITHUB_ORG=your-org GITHUB_REPO=charity-site ./scripts/bootstrap-aws.sh
```

Then in GitHub repo Settings:
- Create Environments `staging` and `production`; add **required reviewers** to
  `production` (this is the prod deploy approval gate).
- On each environment set a variable `AWS_ROLE_ARN` to the role ARN the script
  printed.
- Apply the `main` branch-protection ruleset: `./scripts/branch-protection.sh`
  (PRs only, green `test` check required, **0** required approving reviews; see
  the script header for the full policy). The green `test` check is the only
  required gate, so any passing PR self-merges — the dev who built it reviews
  locally, then merges. Code-owner reviews are **off**: GitHub ignores them when
  0 approvals are required, so the flag is left off rather than implying a gate
  that doesn't exist. `.github/CODEOWNERS` still auto-requests the owner as a
  reviewer, but that review is advisory. To actually gate sensitive paths, raise
  the approval count to ≥ 1 and re-enable code-owner reviews in the script.

Finally, set the real secret values (the bootstrap leaves placeholders):

```bash
aws ssm put-parameter --name /charity-site/staging/EXTERNAL_API_ONE_KEY \
  --type SecureString --value 'real-key' --overwrite
# ...repeat for EXTERNAL_API_TWO_KEY and for the production path.

# Stripe (REQ-028/REQ-029): the live secret key (SecureString) and the four
# recurring price IDs (String); all start as REPLACE_ME placeholders.
aws ssm put-parameter --name /charity-site/staging/STRIPE_SECRET_KEY \
  --type SecureString --value 'sk_live_...' --overwrite
aws ssm put-parameter --name /charity-site/staging/STRIPE_PRICE_BRONZE \
  --type String --value 'price_...' --overwrite
# ...repeat for STRIPE_PRICE_SILVER/GOLD/PLATINUM and the production path.

# Stripe webhook signing secret (REQ-036): a SecureString for verifying inbound
# webhook signatures. The whsec_... value comes from the Stripe Dashboard webhook
# endpoint (a separate endpoint + value per environment); starts as REPLACE_ME.
aws ssm put-parameter --name /charity-site/staging/STRIPE_WEBHOOK_SECRET \
  --type SecureString --value 'whsec_...' --overwrite

# Contact forwarding (REQ-030): the form-service endpoint (SecureString). Starts
# as a https://forward.example/replace-me placeholder, which keeps the forward
# stubbed until a real URL is set.
aws ssm put-parameter --name /charity-site/staging/CONTACT_FORWARD_URL \
  --type SecureString --value 'https://formspree.io/f/xxxx' --overwrite

# Transactional email (TASK-070): the provider send endpoint (SecureString). Starts
# as a https://email.example/replace-me placeholder, which keeps the confirmation
# email stubbed until a real URL is set.
aws ssm put-parameter --name /charity-site/staging/EMAIL_SEND_URL \
  --type SecureString --value 'https://api.provider.com/send' --overwrite

# Declaration form base URL (TASK-075): the public site base the in-person Gift Aid
# declaration link/QR is built on. A plain String (not a secret); starts as a
# https://nbcc.example placeholder. Set the real public site URL.
aws ssm put-parameter --name /charity-site/staging/DECLARATION_FORM_BASE_URL \
  --type String --value 'https://www.nbcc.org.uk' --overwrite
```

## Provisioning infrastructure

Infra is **not** applied automatically on push (that's how a stray PR replaces
your database). Apply it deliberately:

- GitHub: **Actions -> Infra -> Run workflow -> environment: staging ->
  action: apply**. Repeat for production.
- Or locally: `cd infra/envs/staging && terraform init && terraform apply`.

Apply staging first, then production. On the very first apply the ECS service
starts with a placeholder image and is unhealthy until the first real deploy -
so run the staging pipeline (below) right after.

## Deploy flow

1. **Open a PR** -> `pr.yml` runs lint, build, migrations, **unit + BDD**.
2. **Merge to main** -> `deploy-staging.yml`:
   builds + pushes the image (tagged by commit SHA, to the shared ECR repo),
   runs migrations as a one-off task, deploys to ECS, smoke-tests `/health`,
   runs **unit + BDD against the live staging URL**, then tags a release.
3. **Promote to production manually** -> run `deploy-prod.yml`
   (**Actions -> Deploy production -> Run workflow**) with the staging-validated
   commit SHA. It deploys the *same image* to production and smoke-tests it.
   Production does **not** auto-deploy on staging success; the `production`
   environment's **required-reviewer approval** gate still applies.

Rollback is automatic: the ECS deployment circuit breaker reverts to the last
healthy task set if a deploy fails its health checks, and a failed smoke/BDD
step fails the run so a bad image never reaches production.

## Configuration

Every config value lives in `src/config/schema.ts` and `.env.example`. Locally
they come from `.env`; in AWS the same keys are SSM parameters that ECS injects
as environment variables, so the app reads `process.env` identically in both.
Secrets are never in code or in the image.

The **Stripe checkout** keys (TASK-037, REQ-028/REQ-029) follow this pattern:
`STRIPE_SECRET_KEY` is a secret (SSM `SecureString`, required, never defaulted);
`STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` are plain redirect URLs (task-def
`environment`, backed by the `stripe_success_url` / `stripe_cancel_url` module
variables) — `STRIPE_SUCCESS_URL` now resolves to the live `/donate/thank-you`
confirmation page (see **Confirmation page**), `STRIPE_CANCEL_URL` back to `/donate`; and the four `STRIPE_PRICE_*` IDs (one per donate tier, REQ-022) are
SSM-held `String`s injected via `valueFrom` like a secret, so their ARNs are in
the `exec_secrets` IAM policy too. `src/clients/stripe.ts` wraps the SDK, reading
the key and price IDs **only** through `src/config`. The live checkout-session
endpoint that uses them is **REQ-029**, out of scope here. `STRIPE_DONATION_PRODUCT`
is an **optional**, non-secret Stripe Product id (`prod_…`) one-off donations are
grouped under — a `stripe_donation_product` module variable in the task-def
`environment` (default empty); left unset, the endpoint names an inline product, so
it never blocks boot. The secret key accepts both standard (`sk_…`) and restricted
(`rk_…`) keys. `STRIPE_WEBHOOK_SECRET` (REQ-036) is a second Stripe secret with the
same treatment as the secret key — an SSM `SecureString`, required and never
defaulted, injected via `valueFrom` with its ARN in `exec_secrets`. It is the
`whsec_…` signing secret the webhook endpoint (`POST /api/stripe/webhook`) uses to
verify inbound events; its `.env.example`/CI placeholder is any non-empty
`whsec_…` string, which keeps signature checks working offline.

`CONTACT_FORWARD_URL` (TASK-039, REQ-030) is the form-service endpoint
`/api/contact` forwards enquiries to (a Formspree-style form URL or an NBCC inbox
endpoint). It is a secret (it authorises submissions), so it is an SSM
`SecureString` injected via `valueFrom` with its ARN in `exec_secrets`, and is
validated as a URL. Its placeholder is a valid `.example` URL (not `REPLACE_ME`,
which would fail URL validation); `src/clients/contact.ts` treats a `.example`
host as unconfigured and stubs the forward outside production. Set the real value
with `put-parameter` (above) when the form service is chosen.

`EMAIL_SEND_URL` (TASK-070) is the transactional-email provider endpoint the
donation-confirmation email is POSTed to after a successful payment. Same treatment
as `CONTACT_FORWARD_URL`: an SSM `SecureString` injected via `valueFrom` with its
ARN in `exec_secrets`, validated as a URL, with a valid `.example` placeholder that
`src/clients/email.ts` treats as unconfigured and stubs outside production. Set the
real value with `put-parameter` (above) when a provider is chosen.

`DECLARATION_FORM_BASE_URL` (TASK-075) is the public site base the in-person Gift Aid
declaration link + QR short link are built on (`declarationLinks`). **Not** a secret (it
ships in the email/QR), but SSM-held and injected via `valueFrom` like the price IDs — a
plain SSM `String` with its ARN in `exec_secrets` — so it varies per environment; validated
as a URL, with a valid placeholder so a fresh apply passes.

`PORTAL_BASE_URL` (TASK-100) is the public site base the self-serve donor-portal magic link is
built on (`portalMagicLink`). Same treatment as `DECLARATION_FORM_BASE_URL`: **not** a secret (it
ships in the access email), an SSM `String` injected via `valueFrom` with its ARN in
`exec_secrets`, validated as a URL, with a valid placeholder so a fresh apply passes.

`ADMIN_SESSION_SECRET` (TASK-105) is the HMAC signing key for admin session tokens
(`signAdminSession`). It **is** a secret — a `SecureString` in SSM (`REPLACE_ME`, `ignore_changes`),
injected via `valueFrom` with its ARN in `exec_secrets`, required and **never defaulted** in the
schema (`z.string().min(1)`) so a missing key fails boot rather than letting anyone forge a session,
with a placeholder in `.env.example` and the CI env. Wired through all six touch-points (schema,
`.env.example`, `pr.yml` env, SSM param, task-def `secrets`, `exec_secrets` IAM).

- Tasks run in public subnets with no NAT gateway (saves ~£25-30/mo); the
  security groups only allow inbound from the ALB. Flip to private+NAT in
  `infra/modules/app/main.tf` if you must.
- RDS is `db.t4g.micro`, single-AZ in staging, multi-AZ in prod.
- The DB password is generated and stored in SSM, so it lands in Terraform
  state - keep the state bucket locked (the bootstrap script does). Or switch
  to `manage_master_user_password = true` (noted in `rds.tf`).
- The bootstrap IAM roles are broad (PowerUser + IAM). Tighten before prod.
- HTTPS isn't wired yet - add an ACM cert + 443 listener once you have a domain.

> Generated as a starting baseline. Run `terraform validate` / `plan` and
> `npm ci` before trusting it end to end.
