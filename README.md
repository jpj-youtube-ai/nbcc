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
| `/business/thank-you` | `business-thank-you.html` |
| `/privacy` | `privacy.html` |
| `/my-story` | `my-story.html` |

`/donate/thank-you` is the post-payment confirmation page Stripe returns the
donor to on a successful checkout (`STRIPE_SUCCESS_URL`, REQ-028/REQ-029); it is a
landing page, not a primary nav destination. `/donor-portal` is the self-serve
donor portal page (REQ-061), reached via the magic-link token in the URL query
string (`?token=…`); it is a private landing page (`noindex`), not a nav
destination. `/business/thank-you` is the private business-supporter thank-you
page (TASK-212), reached via the per-business token in the URL query string
(`?token=…`) from the thank-you email; it is a token-gated, submit-once landing
page (`noindex`), not a nav destination. `/privacy` is the data-protection privacy notice (REQ-064), linked
from the footer and from the consent controls on the contact and donate pages,
not a primary nav destination. `/my-story` is the public story submission page:
a guided 3 step form linked from the footer Explore list on every page, not a
primary nav destination; the form posts to `POST /api/my-story` (Task B1),
which persists submissions to a SEPARATE `stories` database (own name +
credentials, same server as the main app DB — never the main `charity` DB).

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
/business/thank-you /business-thank-you.html 200
/privacy          /privacy.html     200
/my-story         /my-story.html    200
/index.html       /                 301!   # canonicalise raw .html onto the clean URL
/about.html       /about-us         301!   # ! forces the redirect over the real file
/donate.html      /donate           301!
/contact.html     /contact          301!
/supporters.html  /supporters       301!
/thank-you.html   /donate/thank-you 301!
/portal.html      /donor-portal     301!
/business-thank-you.html /business/thank-you 301!
/privacy.html     /privacy          301!
/my-story.html    /my-story         301!
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

### Form validation (highlight all missing fields)

Every user-facing form validates through one shared, accessible helper in
`assets/js/main.js`, exported as `validateForm(scope, opts?)` / `clearValidation(scope)`
(and mirrored on `window.NBCCFormValidation` so the separate
`assets/js/business-thankyou.js` uses the same code). On submit it flags **every**
invalid control at once — `aria-invalid="true"`, an `is-invalid` class on the field
(or its `.give-field`/`.field` wrapper), and an inline plain-language message linked
via `aria-describedby` — refreshes one `role="alert"` summary at the top of the form,
moves focus to the first invalid field, and live-clears each control as it is fixed
(hiding the summary once all are valid). It skips disabled controls and controls
inside a `hidden` ancestor, bounded at the scope so a visible form still validates when
a container above it is hidden (the portal error card). The `required`/`type`/`pattern`
attributes stay the rule source; forms carry `novalidate` so the helper drives the UX.
`opts.summary` reuses an existing summary node (the wizard steps' `[data-err]`), and
`opts.extraChecks` adds cross-field rules (e.g. the business supporter credit-name and
certificate-address rules). Wired into: the donate wizard (per step), contact, Gift Aid,
My Story, the business thank-you page, and the donor portal. The red field treatment,
inline message, and summary styles live in the `FORM VALIDATION` block of
`assets/css/styles.css`. Both the helper and its styles count toward the donate first-paint
budget (see the performance section).

### SEO & social metadata

Every page's `<head>` carries a unique set of SEO + social-share tags following
one shared structure (same tags/order on each page; only the values differ):
`<title>`, `<meta name="description">`, a `<link rel="canonical">`, Open Graph
(`og:type`/`og:site_name`/`og:title`/`og:description`/`og:url`/`og:image`) and
Twitter card tags. `canonical` and `og:url` are absolute and match the clean URL
above; no title/description/canonical is duplicated across pages. Verified by
`test/unit/seo-metadata.test.ts`.

> **Canonical domain:** canonical/`og:url`/`og:image` use the production host
> `https://nbcc.scot` (apex, no `www` — matching the Stripe success/cancel URLs
> and the `/health` smoke check). Set across the static pages +
> `test/unit/seo-metadata.test.ts`. The share image (`/assets/img/og-image.png`)
> ships in `assets/img/` (REQ-034).

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
`.photo-slot` `<figure>` holding the real consented photo
(`assets/img/home-red-bags-handover.jpg`, NBCC volunteers at the Elves Workshop,
`loading="lazy"` with descriptive alt text; provenance in `assets/img/CREDITS.md`).
`.photo-slot` drops the placeholder chrome and cover-fits the image to the 4:5 slot.
Token-only colours, reusing `.btn`/`.rule`/`.reveal`/`.card` tokens. Verified by
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

### About "Meet the Volunteers" grid (REQ-016)

Below the story, the `section.meet-team` ("Meet the Volunteers", named by its
`<h2>`, REQ-032) holds **two** `.team` grids on the shared `.member` card surface
(`.team`: 5-across desktop → 3 ≤980px → 2 ≤680px):

- **`.team-leads`** — five leads/trustees in **role order** (not alphabetical):
  Jodie/Head Elf (Trustee), Isabel/Procurement (Trustee),
  Kenny/Finance (Trustee), Jaimie/Project Manager, Jon/Marketing. Each card adds a
  `.member .em` `mailto:` link (`name@nbcc.scot`). Isabel reuses the existing
  `team-isabella.jpg` headshot.
- **`.team-elves`** — the thirteen **Volunteer Elves** (under a `.team-subhead`
  subheading) in **alphabetical order**: Dawn, Jill, Lisa-Marie, Liz, Lucy,
  Margaret, Matt, Morag, Paul, Scott, Sue, Tygan, Vicky. Elves with a supplied
  headshot use a lazy 640×800 `team-<name>.jpg` `<img>` — now all thirteen (Dawn,
  Jill, Lisa-Marie, Liz, Lucy, Margaret, Matt, Morag, Paul, Scott, Sue, Tygan,
  Vicky). A future elf without one uses a `.member-photo.is-pending` placeholder
  tile (dashed 4:5 box + muted `aria-label`ed person icon); drop
  `/assets/img/team-<name>.jpg` in to fill it. A `CONTENT VERIFICATION` HTML
  comment documents the pattern.

Token-only colours; `.reveal` reused. Verified by `test/unit/about-team.test.ts`.

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
("Donate"), the base `<h1>` ("Your donation becomes someone's Christmas"), the
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

### Donate form redesign (TASK-204)

The donate page was restyled to an approved mockup and given a handful of
behaviour changes. This is the current shape of the give card; the REQ sections
below describe the underlying contract, which is **unchanged** (every id, name and
`data-*` the `startCheckout` payload and the unit tests rely on is preserved).

- **Frequency toggle is monthly first.** The segmented pill now reads **"Donate
  monthly"** (left, the default/active) then **"Donate once"** (right). `initGiveToggle`
  keys off ids/`aria-pressed`, so DOM order is free; monthly stays the default
  (`#giveMonthly aria-pressed="true"`, `#tiersMonthly` visible, `#tiersOnce` hidden).
- **Amount tiers in a row.** `.give-tiers` is a four-column grid (two columns
  ≤680px); each tile is compact and centred, and the selected tile is **filled
  Holly Green** (`--holly` background, `--cream` text). The per-tile head/description
  are hidden in favour of a shared live impact card (below). **"Most popular"** pills
  sit on **both** `£25` tiles (one off and monthly `Silver`).
- **Live impact card.** A `.give-impact` card (`#giveImpactText`) below the tiers
  updates on tier/frequency change from a non-definitive impact map in
  `initGiveSteps` — always "could help …", never "£X provides Y" (Code of Fundraising
  Practice). It reads a touch larger and bolder (TASK-210). No amount is pre-selected
  on load, so the card, summary and Gift Aid uplift start in a neutral "Your donation
  could help …" state until the donor actively chooses an amount.
- **Tiers select without advancing; one proceed button.** A tier tap SELECTS (updates
  the impact card) rather than jumping to step 2; a single prominent **"Donate now"**
  CTA (`[data-give-next]`) advances. Typing into the choose-your-own box selects that
  amount. The per-amount "Donate" button was removed (TASK-210): the one step CTA now
  drives checkout for a preset tier or a custom amount alike, and `validate()` blocks
  it until a tier is chosen or a custom amount is entered. A selected tile uses a
  softened holly tint (TASK-210), not a full green fill.
- **Page 2 opens with a summary.** A `.give-summary` band shows **"You are donating
  £X"** (`#giveSummaryAmount`) with a **"Change"** control (`[data-give-prev]`) back to
  step 1; `initGiveSteps` fills the amount from the selected tier or custom amount.
- **Prominent donor type, nothing preselected.** The "Who is this gift from" cards
  ship with **neither** radio `checked`; both carry `required`+`aria-required` and
  `initGiveSteps`' step-2 `validate()` (now handles radio/checkbox groups) blocks
  **Continue** until one is picked. The business card is colour-accented (`--tan`).
- **Gift Aid sells the uplift.** The callout leads with **"Make your £X worth £Y"**
  (`#giftAidHeadline`) and a `£X → £Y` `+£Z` badge (`initGiveSteps` computes the 25%),
  keeping the `#giftAid` checkbox, the verbatim declaration and the TASK-198 gating
  intact. Holly *text* uses `--holly-dark` (the `brand-colours` guard forbids `--holly`
  text on light surfaces); the block stays token-only.
- **Clear newsletter opt-in.** The `emailConsent` capture is presented as a distinct
  **"Add me to our donor newsletter … Unsubscribe anytime"** block (still the same
  `emailConsent` field, still inside `.give-contact`, never pre-ticked).
- **Wording.** Donor-facing copy prefers "Donate"; step 1 asks **"How much would you
  like to donate?"**; the primary CTA reads **"Donate now"**.

Verified by the give/gift-aid/donor-type unit tests (updated to the new intent) and
by driving the wizard in a browser (select/advance, frequency switch, donor-type
gating, Change, and the live impact/summary/Gift-Aid updates).

### Give once tiers (REQ-021)

The give-once amounts are mounted into the shell's `#tiersOnce` container
(`GIVE ONCE TIERS` CSS block): four selectable amount tiles plus a
choose-your-own-amount field, laid out on the shared `.give-tiers` grid (two
columns, collapsing to one ~360px). Each amount is a `.card.tier.give-tier`
`<button>` — reusing the `.card`/`.tier` surface (REQ-009) and the hover-lift
(REQ-008) — showing a Playfair crimson `.give-amount` and a `.give-tier-desc`:
**£10** (cosy essentials), **£25** (towards a Red Bag, marked **"Most popular"**
via a `.give-flag` pill on its own centred line so it never overlaps the label or the
amount (TASK-210), on the crimson-outlined `.is-featured` tile),
**£50** (one full Red Bag) and **£100** (a whole family). The custom option is a
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
Joy", marked **"Most popular"** on the `.is-featured` tile, TASK-204), **Gold £50
per month** ("One Christmas made brighter"), and **Platinum £100 per month** ("More
joy, every month"), each with its leaflet description. A `.give-other` line links to
`mailto:giving@nbcc.scot` for other monthly amounts. Token-only
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
block) asks **"Who is this gift from, an individual or a business?"** — two native
radios (`#donorIndividual` / `#donorBusiness`, each with a real `<label for>`,
REQ-032). **TASK-204:** neither is preselected; both carry `required`+`aria-required`
and the wizard's step-2 `validate()` blocks Continue until the donor picks (the
business card is colour-accented). Helper text explains a **sole trader** and **business partners** are
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
`{ mode, plan, amount, giftAid }` contract is unchanged without JS. **TASK-242:**
the on-screen radio is individual/**business**, but the API + donor record use
individual/**company**/**partnership**, so `startCheckout` sends the value from
`currentDonorPath` (mapping the chosen business sub-type), not the raw `business`
— posting the literal `business` was rejected by the `donorType` enum (400), so
every business donation failed before this fix. **TASK-243 (donor-flow audit)** fixed two more
money-path defects: (1) a monthly **"choose your own amount"** gift carries `plan:null`, which the
checkout schema accepts (TASK-231) but the webhook's `donationInputSchema` still rejected via a stale
"monthly requires a plan" refine — so the donor was charged yet the donation threw in the webhook and
was never recorded (that refine is dropped; `amountPence.positive()` still guarantees an amount); and
(2) the business name (the company's required `legalName`) is now `required` on the business path via
`initDonorType`, so a blank one is flagged inline instead of bounced 400 into a raw JSON alert.
Token-only
colours (slate body, maroon legend, crimson accents; the `brand-colours` guard
forbids holly/tan text here). Dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/give-donor-type.test.ts`.

### Contact capture (REQ-039)

Below the donor-type fieldset and above the tiers, a `.give-contact` `<fieldset>`
(`CONTACT CAPTURE` CSS block) captures consent-based contact details: a **required**
donor name captured as two fields, **First name** (`#donorFirstName`) and **Surname**
(`#donorSurname`), each `required` + `aria-required` (TASK-210; `startCheckout` combines
them into the single `fullName` the checkout contract still POSTs), an email
(`#donorEmail`) paired with an email-consent checkbox (`#emailConsent`) that is
**never ticked in advance** (NBCC only emails with clear permission), and a
monthly-only **18 or over** confirmation (`#ageConfirmed`). Every control has a real
`<label for>` (REQ-032). The old "keep my donation anonymous" checkbox was removed in
TASK-235: the supporters wall is now opt-in (you appear only if you actively choose to),
so a separate "off the page" control is redundant. The 18+ row (`#ageConfirmField`) shows
**only in give-monthly mode**: `initGiveToggle` toggles it alongside the tier swap and the
Gift Aid statement, and a `.give-age[hidden]` rule collapses the flex row (mirroring
`.giftaid[hidden]`); it ships visible because monthly is the default. `initContactCapture`
marks the fieldset `data-ready`, so `startCheckout` folds **`fullName`**, **`email`**,
**`emailConsent`** and (monthly) **`ageConfirmed`** into the REQ-028 payload only once the
enhancement is active — the base `{ mode, plan, amount, giftAid }` contract is unchanged
without JS (durable persistence is the REQ-039 webhook/back-end, out of scope here).
Token-only colours (slate body, maroon legend, crimson accents; the `brand-colours`
guard forbids holly/tan text here). Dash-free copy, "NBCC" (REQ-031). Verified by
`test/unit/give-contact-capture.test.ts`.

**Supporters wall opt-in (TASK-224, restructured TASK-235).** A `#supporterOptin` block is
its **own numbered question** in the details step (no longer nested in the contact
fieldset) and lets an **individual** choose to appear on the public supporters page
(`/supporters`, the opt-in wall from TASK-223). It is **revealed only once an individual
has chosen a monthly gift of at least £10** — `updateSupporterOptin` shows it when the
donor type is individual and `selectedMode()==="monthly" && selectedPence() >= 1000` (the
wall's floor, `bandForMonthlyAmount`), and it ships `hidden`. A **business never sees it**:
its listing is set later in the business thank-you flow, so a business types its name once
(the business-name field, which also serves as its supporters-page name). The choice is a
**required** radio with **nothing preselected** (`listOnSupporters` yes/no); choosing
"show" reveals a custom display-name input (`#supporterCreditName`, `name="creditName"`,
`maxlength=200`, "For example, Smith Family"). Because the
required controls sit under a `[hidden]` ancestor when not eligible, the shared TASK-225
validator **requires an answer only while the block is visible** and skips it otherwise.
`startCheckout` folds `listOnSupporters` (boolean) and `creditName` into the payload
**only for that eligible monthly gift**; a one-off, sub-£10 or opted-out gift omits them.
A **tiny client-side profanity pre-check** (`SUPPORTER_BLOCKED`, whole-word so
Scunthorpe-safe) flags an obvious display name through the same highlight-all UI before
submit; the **server** filter (`containsBlockedWord`, `POST /api/checkout-session`) is
load-bearing and rejects a profane or opted-in-without-a-name `creditName` with 400. The
checkout endpoint stamps `metadata.listOnSupporters` / `metadata.creditName`, and the
webhook (`donationFromCheckoutSession` → `insertDonorAndDonation`) writes
`donors.list_on_supporters` / `credit_name`. Verified by
`test/unit/give-supporter-optin.test.ts`, `checkout-session.test.ts` and
`stripe-webhook-model.test.ts`.

**Step-2 flow + validation (TASK-235, per-question numbering TASK-237).** Step 2's questions
are a numbered sequence: each `.give-question` carries a big left-gutter number (a CSS counter
over only VISIBLE questions, so a hidden business-only or supporters question leaves no gap)
above a full-width divider. **TASK-237** makes every question its own `.give-question` so the
number auto-renumbers as earlier choices show or hide later ones: an **individual monthly gift
of £10+** reads 1 who-from · 2 name · 3 email · 4 newsletter · 5 18+ · 6 Gift Aid · 7 supporters;
a **one-off** drops the monthly-only 18+ and supporters (Gift Aid becomes 5). A **business** reads
1 who-from · 2 company/partnership · 3 business name · 4 name · 5 email · 6 newsletter · 7 18+ · 8
Gift Aid, and **never** shows the supporters question (individuals-only). To keep the numbers
left-aligned, the **company/partnership** and **business-name** questions are promoted to their own
top-level `.give-question` siblings **outside** the `.give-donor` fieldset (so `initDonorType` now
reads the business-type radios document-wide), the company/partnership options list their examples
inline (Ltd/PLC/LLP; a general partnership) with the old explainer paragraph dropped, the **Gift Aid**
callout is wrapped in its own numbered question that **an incorporated company hides** (a company
cannot claim Gift Aid; a partnership keeps it as number 8), and the **supporters opt-in** is ordered
**after** the Gift Aid callout so it numbers immediately after it. Verified by
`test/unit/give-question-numbering.test.ts`. The shared TASK-225 validator shows a **bold red border
+ ring** on an empty/invalid field, and a red ring around an unanswered option group.

**Server-side (REQ-039, revised):** `POST /api/checkout-session` now requires a
valid `email` for the individual/partnership donor paths — a missing or
malformed email is rejected with 400. A company is exempt at that check, but since
TASK-236 the company's contact IS the step-2 donor, so a company now carries the same donor
`email` (which also becomes `company.contactEmail`) anyway. Email is always
stored (not gated on `emailConsent`, which now governs marketing consent only)
so every donor can be sent a thank-you and a donor-portal link; see
`test/unit/checkout-session.test.ts` and the `features/checkout.feature`
"without an email is rejected" scenario. That captured email is also pre-filled
and locked on the Stripe Checkout page via `customer_email` (TASK-203), so the
donor never retypes it. The confirmation email itself
(`src/donors/confirmation.ts`) now carries a receipt reference
(`NBCC-<zero-padded donation id>`, built by `donationReference`) and the payment
date, so it stands in for the Stripe receipt now that Stripe's own
successful-payment receipt email is switched off. Both are threaded from the
committed donation by the webhook (`src/db/stripe-webhook.ts`) for the one-off
gift and for each monthly charge, and the reference maps 1:1 to the donation id
so staff can paste it straight into the admin donation search.

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
field has a real `<label for>` (REQ-032). **The whole fieldset applies only when Gift Aid is
opted in** (TASK-198): `initDonorType` shows `.give-declaration` on the individual path **only
while `#giftAid` is checked**, re-applying whenever the box toggles, so a donor who does not add
Gift Aid is never shown — nor blocked at the confirm step by the `required` — declaration fields
(`validate()` skips inputs inside a `[hidden]` ancestor). That matches the fieldset's own
"we ask for these only if you add Gift Aid" copy. `initDeclarationCapture` marks the fieldset
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
`.give-partners` `<fieldset>` (one Gift Aid declaration per partner) — which, like the single
declaration, is shown only once `#giftAid` is opted in (TASK-198). `initPartnershipCapture`
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
(`#companyRegNumber`) plus a **required** billing address (`#companyBillingAddress`) and
billing postcode (`#companyBillingPostcode`) — each `required` + `aria-required` with a real
`<label for>` (REQ-032); the company's legal name is the existing `#businessName` field.
**TASK-236:** the company no longer captures its own contact name/email — the contact is the
step-2 donor (`#donorFirstName`/`#donorSurname`/`#donorEmail`, now required on the company path
too), folded into `company.contactName` / `company.contactEmail`.
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
PANEL` CSS block, next to `GIVE WIDGET`): a "Where your donation goes" eyebrow and
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

- **All monthly donors** — your name (or business name) on the **Supporters
  page** (`/supporters`, REQ-035) if you choose to be listed, plus our donor newsletter.
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
  (`mailto:giving@nbcc.scot`) or phone (`tel:+441292811015`,
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
  icon: general enquiries (`info@nbcc.scot`), the phone
  (`tel:+441292811015`, shown as **01292 811 015**), donations via **Jaimie
  Wakefield** (`giving@nbcc.scot`), and **Annbank Village Hall**
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

### Supporters page (REQ-035; opt-in monthly 4-band wall TASK-223; grandfathered pre-223 set TASK-228)

`supporters.html` opens with a centred intro (the `SUPPORTERS PAGE` CSS block,
mirroring the About/Donate/Contact intros) and then fills its `.page-sections`
slot with the tiered supporters list (`SUPPORTERS TIERS` block). **Four**
`.supporter-tier` tinted bands — **Bronze → Silver → Gold → Platinum**, in that
order — each hold a `.supporter-grid` of `.card` entries listed **alphabetically
within the tier**. Every entry carries a `data-type="person"`/`"organisation"`
marker, a decorative `aria-hidden` inline SVG icon (person vs building, no image
tags), and a visible **Individual** / **Organisation** label so the person-vs-brand
distinction is clear to sighted and assistive-tech users. Reuses `.card` / `.reveal`
/ the tinted-band pattern / tokens; the Platinum band adds one **additive**, scoped
CSS rule (a platinum-grey heading underline via `var(--slate)`, matching the donate
page's platinum ink) and leaves Bronze/Silver/Gold untouched. Dash-free copy, "NBCC"
(REQ-031). The static entries are **placeholder** fallbacks; it also serves as the
**Donors Page** referenced by REQ-024/REQ-025.

**Who appears (opt-in monthly TASK-223, OR grandfathered TASK-228):** a supporter
appears when they are **not** `anonymous` and **not** `hidden_from_supporters` **and**
they qualify via **either** path below. Banding precedence is **opt-in monthly first,
then grandfather**, so a donor who qualifies for both is banded by their monthly gift.

- **Opt-in monthly (TASK-223).** They have at least one **paid monthly** donation
  (`donations.mode='monthly'` filtered to `payment_status='paid'`, the same way settled
  gifts are detected elsewhere); the **greatest** such gift bands via the four-band
  `bandForMonthlyAmount` (`src/donors/fulfilment.ts` — bronze £10 / silver £25 / gold £50
  / platinum £100 per month, so **under £10/mo is excluded** from this path); and they
  **opted in** on the right channel — a **business** (donor is a company OR carries a
  `business_name`) via its `business_supporter_fulfilment` record
  (`list_on_supporters = true` **and** `captured_at IS NOT NULL`), an **individual** via
  `donors.list_on_supporters = true`. The individual opt-in + display-name **write path**
  is the donate form (TASK-224, see **Supporters wall opt-in** under the give widget
  above): an individual monthly donor of £10/month or more chooses on the donate form
  whether to appear and under what name, and the choice flows through checkout metadata
  onto `donors.list_on_supporters` / `credit_name`.
- **Grandfathered (TASK-228).** `donors.grandfathered_on_supporters = true` keeps a donor
  on the wall **without** opting in. This is a **one-time snapshot** of the OLD (pre-223)
  wall's set — taken by the migration backfill (`1784260000000_grandfather-supporters.js`):
  **not anonymous AND has ≥ 1 `payment_status='paid'` donation**, matching who the pre-223
  wall showed. A grandfathered donor is banded by their **greatest paid gift across ANY
  frequency** using the four metal thresholds with **no £10 floor**
  (`bandForGrandfatheredAmount` — ≥ £100 platinum, ≥ £50 gold, ≥ £25 silver, else bronze),
  so every previously-shown donor — including **small and one-off** gifts — keeps a place.
  **New** donors default `false`, so from launch onward everyone uses the opt-in flow.

A business is listed as an **Organisation** by its `credit_name` (falling back to
`business_name`), an individual as an **Individual** by `donors.credit_name` (falling
back to `full_name`).

**Rendering (TASK-071 / TASK-223):** the `/supporters` clean URL is **rendered
server-side**, not served as the static file. `GET /supporters` (`src/routes/site.ts`)
calls `listPublicSupporters` (`src/db/donations.ts`), which gathers each donor's
greatest paid **monthly** gift AND greatest paid gift across **any** frequency (a
`LEFT JOIN` to `donations` filtered to `payment_status='paid'`, so a grandfathered
**one-off** donor is still selected), the grandfather flag, and their opt-in state
(individual columns, and a `LEFT JOIN` to the business fulfilment record for business
consent), then the pure `groupPublicSupporters` / `resolvePublicSupporter`
(`src/db/donations-model.ts`) applies the opt-in / grandfather + banding + anonymity/hide
rules, picks the display name, and sorts each of the four bands alphabetically. The rendered HTML is injected into the **same**
`supporters.html` markup, which stays the **template and the fallback** (served as-is if
the DB read fails).

**Admin "hide from wall".** An Editor+ admin can remove any donor from the wall via
`PATCH /api/admin/donors/:id` (`hiddenFromSupporters` on `adminPatchSchema`, persisted
through `updateDonorPortal` as `donors.hidden_from_supporters` in one audited
transaction). The admin donor view (`assets/js/admin/app.js`) shows it read-only and
offers a **"Hide from supporters wall"** checkbox in the edit form. The wall query
excludes hidden donors. This admin-only field is **not** exposed on the self-serve
portal schema.

**Bad-word filter.** `src/donors/display-name-filter.ts` exports
`containsBlockedWord(name)` — an intentionally conservative, whole-word blocklist (with
a tiny substring list for no-benign-use slurs; it avoids the "Scunthorpe problem"). It
is applied where a **business** custom `creditName` is captured
(`src/routes/business.ts` rejects a profane name with a plain, dash-free 400) and again
as a **render-time safety net** in `groupPublicSupporters` (any entry whose final
display name trips the filter is omitted).

**Tests.** `test/unit/supporters.test.ts` guards the static fallback (four tiers in
order, alphabetical within each, person + organisation both render);
`copy-rules`/`accessibility`/`brand-colours` auto-cover the file. The server-render +
opt-in rules are covered DB-free by `test/unit/supporters-render.test.ts` +
`test/unit/supporters-read.test.ts` (pure grouping + HTML injection, mocked pool),
the filter by `test/unit/display-name-filter.test.ts`, the business-capture rejection by
`test/unit/business-fulfilment-api.test.ts`, and the flow end to end (DB-backed) by
`features/supporters.feature` (seed monthly gifts via the signed webhook, opt in the way
the app does, then assert opted-in monthly supporters appear while a one-off and an
anonymous donor never do). The rationale for server-rendering donation-sourced entries
is recorded in `docs/superpowers/specs/2026-07-01-supporters-list-design.md`.

### Confirmation page (REQ-035; type-aware TASK-221)

`thank-you.html` is the post-payment confirmation page Stripe redirects the donor to on a successful
checkout — the target of `STRIPE_SUCCESS_URL` at the clean URL `/donate/thank-you`. It shares the same
nav / footer / `assets/css/styles.css` / `assets/js/main.js` shell as the rest of the site, with its own
unique SEO + social metadata (`test/unit/seo-metadata.test.ts`).

**TASK-221 makes it TYPE-AWARE.** `buildSessionParams` (`src/routes/api.ts`, via `thankYouReturnUrl`)
appends `mode` (once|monthly) and `donor` (donorType) to BOTH the hosted `success_url` and the embedded
`return_url`, and adds Stripe's `session_id={CHECKOUT_SESSION_ID}` template to the hosted URL too (the
embedded one already carried it) — e.g. `/donate/thank-you?mode=monthly&donor=company&session_id=…`.
`assets/js/thank-you.js` reads those params and reveals exactly ONE of four variants, **defaulting to a
generic thanks when the params are absent so an OLD/paramless link still works**:

1. **individual one-off** (`mode=once`, `donor!=company`) — warm thanks + a receipt on its way, nothing to do;
2. **individual monthly** (`mode=monthly`, by-session `none`) — thanks + one reassurance line (you are in control, change or cancel anytime, and we always tell you the amount and date before each payment);
3. **business one-off** (`mode=once`, `donor=company`) — thanks to the business + a receipt on its way;
4. **business monthly** (`mode=monthly`, by-session `ready`/`captured`/`pending`) — the business recognition FORM inline.

Every variant keeps a shared, always-visible contact card (the TASK-219 phone + `giving@nbcc.scot` line)
and the Back to home / Supporters / Share your story actions.

**Business-monthly, inline (Part 2).** For a company/partnership monthly gift the page calls the NEW,
strictly **READ-ONLY** endpoint **`GET /api/business/fulfilment/by-session/:sessionId`**
(`src/routes/business.ts`): it retrieves the Stripe Checkout Session, links it session → donor →
`business_supporter_fulfilment` (via `donations.stripe_session_id`, read-only in
`getFulfilmentPageContextBySession`) and returns `ready` (record exists, not captured → render the
form), `captured` (already submitted → the read-only confirmation), `pending` (a qualifying
business-monthly session whose webhook record has not landed yet → show "setting up" and poll by-session
about every 3s for about 20s) or `none` (no recognition applies → show variant 2). The endpoint **never
creates a donor, donation or fulfilment record** — that stays the webhook's job alone; the session id is
the auth (a bad / unknown / foreign id → a generic 404, no enumeration) and it is rate limited like the
sibling token routes. The inline form **reuses** the token page's form: `assets/js/business-thankyou.js`
exposes a shared `mountBusinessForm` core (validate / submit-once / render) that both `/business/thank-you`
and this page drive against the same `bty-*` markup — no fork. Submit still hits `POST
/api/business/fulfilment/:token` (submit-once, unchanged). If the record never lands in time, the page
shows a fallback pointing at the TASK-213 emailed link.

**Capture confirmation email (Part 3).** After a SUCCESSFUL capture, `postFulfilment` sends a warm "here
is what you chose" confirmation (`src/business/capture-confirmation-email.ts`) that lists the chosen
recognition options and the download links they are entitled to (certificate + badge, gated as on the
page), reusing the branded NBCC email shell. It is **best-effort and post-response** — a send failure can
never fail the capture or change the 200/409 — sent via the relay `thankYou` passthrough
(`sendBusinessCaptureConfirmation`, no relay change), and it fires whether the supporter submitted from
the new inline form OR the emailed token link. Non-definitive impact copy, dash-free.

Online declarations need **no 30-day confirmation letter**, so this page and its emails are the whole of
the post-gift confirmation. Dash-free copy, "NBCC" in full (REQ-031); skip-link + landmarks + labelled
and `aria-required` form controls (REQ-032). `clean-urls` / `site` / `seo-metadata` / `copy-rules` /
`accessibility` / `thank-you-page` cover the page and stay green.

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
Aid status from the snapshot. The **"Your details" card** also carries a self-edit
form (`#portalDetailsForm`): `initPortal` prefills name, email, marketing consent and
the public-anonymity flag from the snapshot, and submitting **`PATCH /api/portal/:token`**
(the bare route) with the changed fields, reflecting the returned snapshot back into the
read-only display. Anonymity is a public-display setting only —
the HMRC claim still uses the donor's real name (REQ-064). Cancelling the monthly gift is **gated behind a
reduce-instead choice** (REQ-055): the cancel action lives inside `#reduceChoice`,
which stays hidden until the donor asks to cancel, so reducing is always offered
first; confirming posts to **`POST /api/portal/:token/subscription/cancel`** with
`accepted: 'cancel'` and the snapshot's `subscriptionId`. A Gift Aid cancel control
posts to **`POST /api/portal/:token/gift-aid/cancel`** (TASK-103). When the link is
**missing or expired**, `initPortal` reveals the `#portalError` card, which now carries
a **self-serve magic-link request form** (`#portalRequestForm`): the donor enters their
email and `initPortalRequest` (exported + unit-tested alongside `initPortal`, wired
independently so it runs on the no-token path) posts `{ email }` to **`POST
/api/portal/request`**. That endpoint always returns the same generic reply (no
enumeration), so the status line never reveals whether the email matched a supporter. To
drive the cancel flow, `getDonorPortalSnapshot` (`src/db/portal.ts`) now also returns
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

### Business thank-you page (TASK-212)

`business-thank-you.html` is the private, token-gated, **submit-once** page a business supporter uses
to choose how NBCC thanks them, served at the clean URL `/business/thank-you` and reached via the
per-business `token` in the URL query string (`?token=…`, minted on the `business_supporter_fulfilment`
record). It shares the same nav / footer / `assets/css/styles.css` shell as the rest of the site, with
its own SEO metadata and a `noindex` robots tag (private page). Page-specific styling and behaviour live
in **`assets/css/business-thankyou.css`** and **`assets/js/business-thankyou.js`** (the page also loads
`styles.css` for the tokens and `main.js` for the nav); `styles.css` / `main.js` / `donate.html` are not
touched. `initBusinessThankYou` (exported + unit-tested like the portal script) reads the token, calls
**`GET /api/business/fulfilment/:token`**, and then:

- **not yet submitted** → reveals the capture form. Each recognition question is a segmented toggle of
  real radios with **nothing pre-selected**, and the detail a Yes needs stays hidden until that answer
  is chosen. The band decides which sections show (from `perksForBand`): **Platinum** sees all four
  (Supporters page, social thank you, digital badge, certificate, with a Download it myself / Post it to
  me choice that splits into a UK address); **Bronze / Silver / Gold** see only the Supporters-page
  question plus a newsletter confirmation. Submit is blocked until every shown question is answered; it
  then **POSTs once** to **`POST /api/business/fulfilment/:token`** and replaces the form with a warm
  confirmation listing the choices and the download links the supporter is entitled to (the certificate
  `/business/certificate/:token` and the badge `/assets/img/nbcc-supporter-badge.svg`), noting these were
  emailed too.
- **already submitted** (`captured_at` set) → renders that read-only confirmation straight away (no edit
  form), because the capture is single-submit.
- **missing / invalid token** → the same friendly "ask us for a new link" fallback the portal uses
  (a contact link + `giving@nbcc.scot`; there is no self-request form, since the private link is the
  only way in).

**Submit-once is enforced in the DB and mirrored in the UI.** `updateFulfilmentPreferences`
(`src/db/fulfilment.ts`) writes the preference columns and stamps `captured_at = now()` in one audited
transaction (`writeWithAudit`, appending a `fulfilment.captured` audit row) with an `AND captured_at IS
NULL` guard, so a record that was already submitted matches zero rows and is never overwritten (even
under two concurrent submits). The API is the certificate route's security model: the **token is the
auth**, an unknown token returns the **same generic 404** as a known one (no enumeration), and both
routes are **rate limited** per token and per client IP (the `createRateLimiter` used by the donor
portal). A POST to an already-captured record returns **409** (the page then shows the confirmation).
`consent_featured` records that the business agreed to be publicly celebrated (true when they chose the
Supporters listing or the social thank you). All copy is dash-free and impact-neutral. Proven by
`test/unit/business-fulfilment-api.test.ts` (GET state + generic 404, POST saves once + flips
`captured_at`, 409 on a second submit, band-aware validation, rate limiting) and
`test/unit/business-thank-you.test.ts` (static markup + jsdom against the real `initBusinessThankYou`,
plus the no-dashes copy guard); the Dockerfile bakes the new page into the image.

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

**Fundraising governance (TASK-137).** Two governance references, so recurring-giving comms and any
future marketing sit inside the regulatory framework:
- **Fundraising self-regulation** — `/privacy` carries a **Fundraising standards** section: NBCC
  follows the **Code of Fundraising Practice**, overseen in Scotland by the **Scottish Fundraising
  Adjudication Panel**, and points donors at the **Fundraising Preference Service** to manage/stop
  fundraising contact.
- **BACS advance-notice duty** — NBCC is the Direct Debit scheme user, so it carries the duty to give
  **advance notice of the amount and date before the first collection and before any change** (e.g. a
  tier up/down). Stripe surfaces some of this, but the duty is NBCC's; the `/donate` "Cancel any time"
  reassurance states it to the donor. This is a standing **requirement**, not an assumption, for any
  monthly-gift or plan-change comms.
Both lines are guarded by `test/unit/fundraising-governance.test.ts`.

### Checkout contract (REQ-028)

Every amount control wires the one front-end → backend integration point. Each
tier button in `#tiersOnce`/`#tiersMonthly`, and the choose-your-own
`.give-tier-custom` container (TASK-210: the per-amount button was removed, so the
container itself now carries the contract and the single step CTA drives checkout),
carry:

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
above). It then POSTs the payload to **`/api/checkout-session`**. Two payment UIs
are supported, chosen by progressive enhancement (see **Embedded Checkout** below):
by default the donor pays **inline** via Stripe Embedded Checkout without leaving
nbcc.scot, and if that cannot run it **falls back to the hosted redirect** (the
returned Stripe `{ url }`). With no working backend at all (fetch unavailable) it
degrades to **showing the payload** (an `alert`, the preview). The buttons are native
`<button>`s (keyboard-activatable, global `:focus-visible` ring; REQ-032). Verified by
`test/unit/give-checkout.test.ts` (markup + jsdom payload behaviour, embedded +
fallback paths) and the per-tier checks in `give-once-tiers` / `give-monthly-tiers`.

### Embedded Checkout (inline payment, TASK-215)

The donate page pays **inline** so the donor never leaves nbcc.scot, while the
hosted-Checkout redirect stays the default fallback and no-JS safety net.

- **Request param.** `POST /api/checkout-session` accepts `uiMode: "embedded" |
  "hosted"`, **defaulting to `"hosted"`** when absent — so any un-updated caller and
  the fallback path are byte-for-byte unchanged. `"embedded"` engages **only when
  `STRIPE_PUBLISHABLE_KEY` is configured** (`embeddedRequested`); it then builds the
  session with Stripe's `ui_mode: "embedded_page"` + a `return_url` (reusing the
  `STRIPE_SUCCESS_URL` base, carrying `{CHECKOUT_SESSION_ID}`) and returns
  `{ clientSecret, publishableKey }`. With **no key set, `"embedded"` is served exactly
  like hosted** (`{ url }`, no `ui_mode`, no embedded session minted) so the feature stays
  dormant until the key lands; `"hosted"`/absent returns `{ url }` exactly as before.
  **Everything else about the session — line items, amount, mode, `customer_email`, and
  ALL metadata — is identical across both modes**, so the REQ-036 webhook and the
  confirmation email are unaffected.
- **Client (`assets/js/main.js`).** `startCheckout` tries embedded first, but only when
  `fetch`, **Stripe.js** and the on-page `#embeddedCheckout` mount are all present: it
  requests `uiMode:"embedded"`, constructs `Stripe(publishableKey)`, and mounts
  `initEmbeddedCheckout({ clientSecret })` into a modal (`#embeddedCheckoutModal` in
  `donate.html`). **Stripe.js is loaded by dynamic injection** from
  `https://js.stripe.com/v3/` (its only supported origin) so `donate.html` keeps its
  single shared static script. The `payload` object `startCheckout` returns stays the
  exact REQ-028 contract; `uiMode` rides only on the wire body.
- **Fallback chain (no dead button).** Stripe.js fails to load, or JS is unavailable,
  or embedded init/mount throws → the **hosted redirect** (`uiMode` omitted → server
  default hosted → `location = url`). fetch entirely unavailable → the preview `alert`.
- **CSP.** The app ships **no** Content-Security-Policy (no helmet, no CSP header/meta,
  and none at the infra/ALB layer), so nothing blocks `js.stripe.com` / `api.stripe.com`
  and **no CSP change was made** (adding one would risk the fonts/images/inline styles).
  If a CSP is ever introduced, allow `script-src`/`frame-src`/`connect-src` for
  `https://js.stripe.com` + `https://api.stripe.com` and `frame-src https://*.stripe.com`.
- **Publishable key.** `STRIPE_PUBLISHABLE_KEY` (below) is public, **optional**, and reaches
  the browser in the embedded response, not baked into the static HTML. Embedded Checkout is
  **dormant until it is set** (and its terraform wiring applied); until then donors use the
  hosted redirect with no change, so the code ships safely ahead of the gated infra apply.

### API endpoints

| Method + path | Status | Requirement |
|---|---|---|
| `POST /api/checkout-session` | **implemented** | REQ-029 (payment) |
| `POST /api/contact` | **implemented** | REQ-030 (contact form — stores to the separate `contact` DB, 2026-07-10 spec) |
| `POST /api/my-story` | **implemented** | Task B1 (My Story submission — persists to the separate `stories` DB) |
| `GET /api/portal/:token` | **implemented** | REQ-061 (donor portal read) |
| `PATCH /api/portal/:token` | **implemented** | REQ-061 (donor portal update) |
| `POST /api/portal/:token/subscription/cancel` | **implemented** | REQ-055 (reduce-instead-then-cancel) |
| `POST /api/portal/:token/gift-aid/cancel` | **implemented** | REQ-061 (cancel Gift Aid — revoke declaration) |
| `POST /api/portal/request` | **implemented** | REQ-061 (donor self-request portal magic link) |
| `GET /api/business/fulfilment/:token` | **implemented** | TASK-212 (business thank-you page state: band + eligible perks + already-captured + saved prefs; token is auth, generic 404 + rate limited) |
| `GET /api/business/fulfilment/by-session/:sessionId` | **implemented** | TASK-221 (**READ-ONLY** type-aware thank-you lookup: retrieves the Stripe session, links session → donor → fulfilment, returns `ready`/`captured`/`pending`/`none`; creates nothing; session id is auth → generic 404 + rate limited) |
| `POST /api/business/fulfilment/:token` | **implemented** | TASK-212 (capture the thank-you choices ONCE — DB-enforced submit-once, `fulfilment.captured` audit; 409 if already captured; TASK-221 also sends a best-effort "here is what you chose" confirmation email) |
| `POST /api/admin/login` | **implemented** | REQ-062 (role-based admin login; step 1 of mandatory email 2FA — admin-management Phase 3/TASK-188 — issues a session directly only for a valid 30-day trusted-device token, else `{step:"2fa"}`) |
| `POST /api/admin/login/2fa` | **implemented** | admin-management Phase 3 (TASK-188; step 2 — verifies the emailed one-time code, 10-min expiry/5-attempt cap, issues the session and optionally a device token when `remember` is set) |
| `GET /api/admin/donors/:id` | **implemented** | REQ-062 (admin donor read; incl. postal address — declaration for an individual, billing for a company) |
| `PATCH /api/admin/donors/:id` | **implemented** | REQ-062 (admin donor update) |
| `PATCH /api/admin/donors/:id/declaration` | **implemented** | REQ-059 (admin correct declaration address — amend; TASK-130) |
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
| `GET /api/admin/queues/gasds-pool` | **implemented** | REQ-050 (annual GASDS pool report) |
| `GET /api/admin/donations` | **implemented** | REQ-066 (browse all donations, paginated) |
| `GET /api/admin/claim-batches` | **implemented** | REQ-066 (list claim batches) |
| `GET /api/admin/claim-batches/:id/export` | **implemented** | REQ-052/REQ-066 (Charities Online CSV export) |
| `GET /api/admin/audit` | **implemented** | REQ-066 (append-only audit trail) |
| `GET /api/admin/subscriptions/dunning` | **implemented** | REQ-066 (at-risk / lapsed monthly gifts) |
| `GET /api/admin/thank-you/eligible?threshold=` | **implemented** | REQ-069 · TASK-162 (donors whose largest single paid gift ≥ threshold pence, default £1,000, tagged with send-state + already-thanked) |
| `POST /api/admin/thank-you/send` | **implemented** | REQ-069 · TASK-163 (Editor+; record + audit a thank-you letter and email the donor the branded letter; optional `ccEmail` copies someone, TASK-168) |
| `GET /api/admin/thank-you/sent?limit&offset` | **implemented** | REQ-069 · TASK-163 (sent-letter history, most recent first) |
| `DELETE /api/admin/thank-you/sent/:id` | **implemented** | REQ-069 · TASK-168 (Editor+; remove a sent-letter row, audited as `thank_you.deleted`) |
| `GET /api/supporters/ticker` | **implemented** | REQ-003 · TASK-178 (public; active supporter names for the site ticker) |
| `GET/POST /api/admin/ticker`, `PATCH/DELETE /api/admin/ticker/:id` | **implemented** | REQ-003 · TASK-178 (Viewer reads; Editor+ add/edit/hide/delete; audited) |
| `GET /api/admin/contact` | **implemented** | 2026-07-10 contact-inbox spec (Viewer+; list enquiries, optional `?status=new\|replied`) |
| `GET /api/admin/contact/:id` | **implemented** | 2026-07-10 contact-inbox spec (Viewer+; one enquiry in full) |
| `PATCH /api/admin/contact/:id` | **implemented** | 2026-07-10 contact-inbox spec (Editor+; `{status:'new'\|'replied'}`, records/clears `replied_by`+`replied_at`) |
| `DELETE /api/admin/contact/:id` | **implemented** | 2026-07-10 contact-inbox spec (Editor+; delete an enquiry permanently) |
| `GET /api/admin/users` | **implemented** | admin-management Phase 1 (Admin only; the Team list) |
| `POST /api/admin/users` | **implemented** | admin-management Phase 1 (Admin only; invite a staff user, emails an invite link, `409` on a duplicate email) |
| `PATCH /api/admin/users/:id` | **implemented** | admin-management Phase 1 (Admin only; change role and/or status, audited; `409 {error:"last_admin"}` if it would orphan admins) |
| `DELETE /api/admin/users/:id` | **implemented** | admin-management Phase 1 (Admin only; remove a user, audited; same last-admin guard) |
| `POST /api/admin/users/:id/reset` | **implemented** | admin-management Phase 1 (Admin only; admin-initiated password reset, emails a reset link) |
| `POST /api/admin/forgot` | **implemented** | admin-management Phase 1 (public, rate-limited; self-service "forgot password", always `200` — no account enumeration) |
| `POST /api/admin/set-password` | **implemented** | admin-management Phase 1 (public, rate-limited; accepts an invite or reset token + a new password) |
| `PATCH /api/admin/users/:id/permissions` | **implemented** | admin-management Phase 2 (TASK-186; `team:edit` only; sets a person's complete 13-section view/edit matrix, audited `admin_user.permissions_changed`; `409 {error:"last_admin"}` if it would leave zero users with effective `team:edit`) |
| `GET /api/admin/me` | **implemented** | admin-management Phase 2 (TASK-186; any valid, non-disabled session; returns the caller's own effective permissions for nav filtering + write-control gating client-side); extended in Phase 4 (TASK-197) to also return `fullName` |
| `PATCH /api/admin/me` | **implemented** | admin-management Phase 4 (TASK-197; any valid, non-disabled session; changes the CALLER's own `fullName` only, always via `claims.sub`; audited `admin_user.name_changed`) |
| `POST /api/admin/me/password` | **implemented** | admin-management Phase 4 (TASK-197; any valid, non-disabled session, rate-limited; changes the CALLER's own password, requires the correct current password, `400 {error:"wrong_password"}` on mismatch; audited `admin_user.password_changed`) |
| `GET /api/admin/fulfilments` | **implemented** | TASK-207 (Editor+ / `donations:edit`; list every business-supporter fulfilment record joined to its donor, most recent first) |
| `POST /api/admin/fulfilments/:id/mark` | **implemented** | TASK-207 (Editor+ / `donations:edit`; set one of the five status flags true, audited `fulfilment.<flag>` in one transaction; unknown flag → 400, unknown id → 404) |
| `POST /api/admin/business-supporters/backfill-invites` | **implemented** | TASK-214 (Editor+ / `donations:edit`; one-time, idempotent catch-up that emails the thank-you invite to un-invited business supporters — `invited_at IS NULL` + `captured_at IS NULL` + has email; stamps `invited_at` on each success so a repeat run sends 0; best-effort sends; `fulfilment.backfill_invites` audit; returns `{ pending, sent, failed }`) |

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
`subscriptions.cancel` wrapper, with an offline stub so it runs without a Stripe account) and returns
the cancelled subscription; `accepted: 'reduce'` is refused with **400** (reducing is done by
re-subscribing from the donate page, not here); an upstream Stripe failure is **502**. Proven by
`test/unit/subscription-cancel.test.ts` (mocked SDK + pool) and end to end by
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
the declaration amend and the name sync run in **one** transaction
(`reviseDeclaration`'s `syncDonorFullName`, TASK-131), so they commit or roll back together. No
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
**TASK-106**. As of admin-management Phase 3 (TASK-188, documented below), this success path is now the
**trusted-device** case only — absent a valid 30-day device token, valid credentials get a mandatory
email 2FA challenge (`{step:"2fa"}`) instead of a token; see "Mandatory email 2FA on admin login" below
for the full two-step flow. Proven by `test/unit/admin-auth.test.ts` (mocked pool — both paths, the pure
password/session helpers, and that the migration is additive-only) and end to end by the `@db`
`features/admin-auth.feature`.

**Admin seed (REQ-062 · TASK-107).** Kenny and Isabella are the two NBCC staff who hold the
Admin/Claims permission. The data-only migration `1783080586661_grant-kenny-isabella-admin.js` seeds
their `users` rows (`kenny@`/`isabella@nightbeforechristmas.co.uk`) with `role='admin'`, idempotent
via `ON CONFLICT (email) DO UPDATE SET role='admin'` (so a re-run, or a pre-existing row, is upgraded
rather than duplicated). No `password_hash` is set — the accounts cannot log in until a password is set
out of band (golden rule 4), the safe default. Additive/expand-contract (a data INSERT, no schema
change); guarded by `test/unit/admin-seed-migration.test.ts` and applied by CI's migrations job. A
later data-only migration `1783345566569_update-admin-emails-nbcc-scot.js` (TASK-147) repoints those
two identities onto the **nbcc.scot** domain (`kenny@`/`isabella@nbcc.scot`, matching the public
contact addresses) and adds a third admin, `paul.popa1995@yahoo.ro`; same idempotent
`ON CONFLICT (email) DO UPDATE`, guarded by `test/unit/admin-email-migration.test.ts`. Two further
data-only grants extend the roster the same way: `1783353707219_grant-paul-jaimie-admin-revoke-yahoo.js`
(adds `paul.popa@`/`jaimie.wakefield@nbcc.scot`, revokes the interim `paul.popa1995@yahoo.ro`), and
`1783591722822_grant-jon-admin.js` (TASK-164 — adds `jon@nbcc.scot`, Jon McFarlane, guarded by
`test/unit/grant-jon-admin-migration.test.ts`). Each is idempotent and sets no `password_hash`, so a
new admin still can't log in until its password is set out of band (see the ops utility below).

**`GET`/`PATCH /api/admin/donors/:id`, `POST …/subscription/cancel`, `POST …/gift-aid/cancel`
(REQ-062 · TASK-106).** The role-gated admin actions that let an Editor/Admin act on a donor's
behalf — the mirror of the self-serve donor-portal routes (`src/routes/portal.ts`), but authorised by
the **admin session token** (`Authorization: Bearer …`) instead of a magic-link token, and addressing
a donor by id. A shared `authorizeAdmin(req, res, minRole)` helper (the admin analogue of portal's
`authOrReject`) rejected a **missing/invalid/expired token with 401** and enforced the role rank
`viewer < editor < admin`: **GET** needed `viewer` (read-only, any role); the three writes needed
`editor`, so a **Viewer got 403** on any of them. As of admin-management Phase 2 (TASK-186, below)
`authorizeAdmin` is retired — these routes now call `authorizeSection(req, res, "donations", "view"
| "edit")`, which preserves the exact same effective access (a `viewer`-role user's default matrix
grants `donations:view`, `editor`+ grants `donations:edit`) while also honouring any per-user
override. Each endpoint **reuses the existing audited write
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

**`PATCH /api/admin/donors/:id/declaration` (REQ-059 · TASK-130).** Correct the **identity / address**
on a donor's active Gift Aid declaration on their behalf — the admin-authorised twin of the portal's
`PATCH /api/portal/:token/declaration` (TASK-129) and the staff surface for TASK-128's **amend** path.
Editor+ (Viewer → 403); body validated by `declarationFieldsSchema`; `scope` + `confirmed_taxpayer`
held at the declaration's current values so `reviseDeclaration` always **amends in place**
(`declaration.amended`, no new row), never revises. It syncs `donors.full_name` to `"First Last"` so
the account and declaration names cannot diverge, and both audit rows record `admin:<email>`. No active
declaration → 404; invalid body → 400; invalid token → 401. `GET /api/admin/donors/:id` now also carries
the active `declaration`, so the admin donor view renders a prefilled **"Gift Aid declaration details"**
edit form (`assets/js/admin/app.js`). Like the portal route, the amend and the name sync run in **one**
transaction (`reviseDeclaration`'s `syncDonorFullName`, TASK-131). Proven by
`test/unit/admin-declaration-edit.test.ts` and end to end by the `@db` `features/admin-api.feature`.

**`GET /api/admin/search/{donors,declarations,donations}?q=` (REQ-062 · TASK-108).** Read-only admin
search over the three core tables by a free `?q=` query — a name, email, id or postcode. Each is
authorised (post-Phase-2) by `authorizeSection(req, res, "search", "view")` — read-only, so any
role/matrix that grants `search:view` may call it — so a **missing/invalid token is 401**; a
**missing/blank `q` is 400**. The queries live in
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
so (post-Phase-2) `authorizeSection(req, res, "claims", "edit")` — a user without `claims:edit`
gets 403. `submitClaimBatch` (`src/db/admin.ts`) mirrors
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

**GASDS 2-year claim-deadline queue (TASK-135).** GASDS (the small-donations top-up) has a **shorter**
claim deadline than Gift Aid — **2 years** after the end of the tax year of collection, versus Gift
Aid's 4 — so small gifts can silently pass the cliff and lose their top-up. `gasdsClaimDeadline`
(`src/gasds/deadline.ts`, pure — 2 years after the collection tax-year-end, reusing
`endOfUkTaxYear`) feeds `listGasdsDeadlineDonations` (`src/db/admin.ts`), a read-only Viewer+ queue at
`GET /api/admin/queues/gasds-deadline` that flags `gasds_eligible`, paid donations whose deadline has
closed (**`expired`**) or closes within a six-month horizon (**`expiring`**), with the computed
`gasdsDeadline`. It surfaces as a **"GASDS deadline near"** overview stat and a dedicated **GASDS**
admin view (a table of unclaimed small gifts near the cliff). Per-donation GASDS-claim status is
tracked by the nullable `donations.gasds_claimed_at` column (TASK-138, additive migration): the queue
excludes already-claimed gifts (`gasds_claimed_at IS NULL`), and an Editor+ **"Mark claimed"** action
(`POST /api/admin/queues/gasds-deadline/mark-claimed` → `markGasdsClaimed`, stamping `gasds_claimed_at`
+ a `gasds.claimed` audit row in one transaction) clears them once counted toward a GASDS top-up
(top-ups are pooled per tax year, so this is NBCC's bookkeeping of which small gifts it has claimed on).
Proven by `test/unit/gasds-deadline.test.ts` + `test/unit/gasds-deadline-queue.test.ts` +
`test/unit/gasds-mark-claimed.test.ts` and the `@db` `features/admin-api.feature`.

The same GASDS admin view also shows this year's **pool report** (REQ-050): `getGasdsPoolReport`
(`src/gasds/pool.ts`) reads two independent sums — the `gasds_eligible` small-donations pool and,
**separately**, the claimed Gift Aid total (never conflated) — and reports the remaining headroom
against the caps (`gasdsPoolLimitPence`). It is exposed at read-only Viewer+ `GET
/api/admin/queues/gasds-pool?year=` (defaulting to the current calendar year) and rendered as three
stat cards above the deadline table. Proven by `test/unit/admin-api.test.ts`.

**Declaration-review-due queue (TASK-136).** HMRC recommends re-confirming **active donors roughly
every two years** (still paying enough tax, details current) — exactly the enduring/monthly declaration
population. `listDeclarationsDueReview` (`src/db/admin.ts`, `DECLARATION_REVIEW_YEARS = 2`) is a
read-only Viewer+ queue at `GET /api/admin/queues/declaration-review` listing **active** (`revoked_at
IS NULL`) enduring (`all_donations`) declarations made more than two years ago, with `reviewDueSince`
(`created_at + 2y`). There is no separate `reviewed_at` column yet, so the declaration's own
`created_at` is the anchor — re-confirming a donor issues a fresh declaration via `reviseDeclaration`,
resetting the clock. It surfaces as a **"Declaration review due"** overview stat. Proven by
`test/unit/declaration-review-queue.test.ts` and the `@db` `features/admin-api.feature`.

**Dashboard read lists (REQ-066 · TASK-114).** The reads that back the admin cockpit UI, all `viewer`
and up (missing/invalid token → **401**) except the CSV export. `GET /api/admin/donations` browses
every donation newest-first with optional `?status` (claim status), `?channel` and — TASK-241 —
`?paymentStatus` filters and a bounded `?limit`/`?offset` page (the pure `clampPage` clamps to ≤ 100),
returning `{ results, total }`. **TASK-241** adds a **Payment** column to the donations list: the pure
`helpers.paymentLabel` collapses `payment_status` (`pending`/`paid`/`failed`) and the separately-tracked
`refunded_amount_pence` into one pill — Pending / Paid / Failed, or (on a settled gift) **Refunded**
(refund ≥ amount) / **Partly refunded** — so refunds are visible at a glance; the `?paymentStatus` filter
(`paid`/`pending`/`failed`/`refunded`, where `refunded` = any `refunded_amount_pence > 0`) narrows the
list. Verified by `test/unit/admin-payment-label.test.ts` and the donations-browse flow in
`test/unit/admin-app.test.ts`. `GET /api/admin/claim-batches`
lists the batches with their donation count and summed pence. `GET /api/admin/audit` reads the
append-only trail newest-first, optionally scoped by `?entity`/`?entityId` and paged the same way.
`GET /api/admin/subscriptions/dunning` lists at-risk / lapsed / **cancelled** monthly gifts (optional
`?status`; **TASK-245** adds `?status=cancelled`, a derived filter on `cancelled_at IS NOT NULL` since a
voluntary cancel is stamped in `cancelled_at`, not the status enum). The subscriptions view renders a
state pill via the pure `helpers.subscriptionStateLabel` (Active / At risk / Lapsed / **Cancelled** —
cancelled takes precedence over a still-`active` status) with an **Ended** column showing whichever of
`cancelled_at`/`lapsed_at` applies, so a cancelled subscription is no longer mislabelled as active. The
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
`Authorization` header). `admin-shell.test.ts` covers the nav sections + the donor detail view.

**Nav grouping (TASK-171, extended by the Team tab below).** The sidebar nav links are clustered
under presentational group labels — **Monitor** (Overview, Search), **Giving** (Donations, Claims,
GASDS, Subscriptions, Business supporters), **Content** (Stories, Partners, Contact form, Newsletter, Thank you),
**Governance** (Audit) and **Admin** (Team) — so related tools sit together instead of one flat
list. Purely cosmetic: the labels are `aria-hidden` `<li>`s (`.admin-nav-group`) that leave the
`.admin-nav-link` buttons, their order and `data-view` targets untouched, so
`admin-shell.test.ts`'s nav-order assertion still holds.

**Newsletter tab (REQ-069 · TASK-161, block builder TASK-168).** A seventh admin nav section for
authoring and sending an HTML newsletter to consenting donors, over the `newsletters` table (one
row per newsletter, `status` `draft`|`sent`). The tab is a two-pane **block builder**: a left rail
palette to add typed content blocks — masthead, greeting, text, heading, image, story, spotlight,
impact stats, ways to help, events, donation CTA, button and divider — each block offering **4
named style variants** (a labelled segmented picker with a one-line description, e.g. masthead
_Centered · Logo + title · Hero banner · Slim strip_), reordering, duplication and deletion. The
field editor is **variant-aware**: it shows only the fields the chosen style actually renders
(progressive disclosure), so a value you enter always appears — the per-style field map in
`assets/js/admin/app.js` (`nlBlockDefs[type].variants[].fields`) is the single source of truth kept
in lock-step with the server renderer. The builder is **read-only in read mode** — for a Viewer (no
editor role) or an already-**sent** newsletter — where the palette, block controls (move / dup /
delete), item add/remove and all field inputs are withheld/disabled so nothing can be added, removed
or edited (the server also gates writes at Editor+). The right rail shows a **live preview** that is
the exact HTML the email will render, recomputed on every edit (debounced) via
`POST /api/admin/newsletters/preview`. Both the newsletter and thank-you email frames share the
maroon contact/legal footer bar in `src/newsletter/theme.ts` / `src/thank-you/letter.ts`, with
circular phone/envelope/social icon chips that degrade to plain contact text where a mail client
strips inline SVG; each footer contact is an **explicit cream-coloured `<a>`** (`tel:` / `mailto:` /
the site URL) so mail clients and the preview iframe don't auto-link the bare text into blue. A newsletter is stored as a JSON **block
document** (`{ blocks: [{ type, variant, data }, …] }`) in the `newsletters.body_json` column
(nullable — legacy raw-HTML drafts from before TASK-168 keep `body_json` `NULL` and hydrate into a
single `rawHtml` block in the builder). One pure renderer, `renderNewsletter` in
`src/newsletter/blocks.ts` (brand tokens/frame in `src/newsletter/theme.ts`), compiles a block
document to a brand-inlined HTML email — the **single source of truth** behind the live preview,
the `body_html` saved alongside every draft, and the send. Reads and drafting are **Editor+**:
`GET /api/admin/newsletters` lists summaries, `GET /api/admin/newsletters/:id` returns one
newsletter's full `body_html` (+ `body_json` for the builder to hydrate), `POST
/api/admin/newsletters` creates a draft (`{ subject, bodyJson }`, or legacy `{ subject, bodyHtml }`),
`PUT /api/admin/newsletters/:id` edits a draft — a `sent` newsletter is immutable (**409**), and
`POST /api/admin/newsletters/preview` (Editor+, stateless, no DB) renders a posted `bodyJson`
document to HTML for the live preview. Sending is **Admin only** and gated behind a **confirmation
dialog**: clicking _Send to subscribers_ opens a centered "Are you sure you want to send this
newsletter?" modal with an **info tooltip listing the exact recipient emails** — fetched from
`GET /api/admin/newsletters/recipients` (**Admin only**, since it exposes donor PII; returns
`{ count, emails }` from the same `listNewsletterRecipients` the send uses). Only pressing _Yes,
send_ fires the send; Cancel / Esc / backdrop dismiss it. `POST
/api/admin/newsletters/:id/send` reads every consenting donor (`listNewsletterRecipients`, deduped
on `email_consent=true`) and sends **one individual email per recipient** via `sendNewsletter`
(`src/clients/email.ts`). For a block-doc newsletter, each recipient's email is **re-rendered**
per-recipient so the greeting block can carry a **`{{firstName}}` merge** — the first
whitespace-delimited token of the donor's name, falling back to **"friend"** when there is no
usable name; a legacy raw-HTML row (no valid `body_json`) falls back to the one stored, already-
compiled `body_html`. Every send carries a **per-recipient unsubscribe button** in the branded
footer: `renderNewsletter`/`renderFrame` take a `ctx.unsubscribeUrl`
(`${PORTAL_BASE_URL}/unsubscribe/<token>`, an HMAC of the donor id signed with `ADMIN_SESSION_SECRET`
— reused, not a new secret) and render a cream pill **Unsubscribe** link + the PECR opt-in reason
line inside the maroon footer bar; the live preview passes a `#` placeholder so the button is
visible while composing. Clicking it hits the public `GET /unsubscribe/<token>` route, which flips
that donor's `email_consent` to `false` (idempotent) and shows a small confirmation page. Legacy
raw-HTML rows (unframed) still get the standalone footer from `buildNewsletterHtml`. From and
Reply-To are `NEWSLETTER_FROM_EMAIL` (see **Configuration**). A single failed send is logged and does
not abort the batch.

**Manually adding a subscriber (doorstep sign-ups).** `POST /api/admin/newsletters/subscribers`
(**Editor+**, `newsletter:edit`) takes `{ email, name? }` and either creates a consenting individual
donor (**201**, `status: "added"`) or, if the address is already on file, re-enables its consent
(**200**, `status: "resubscribed"`) — matched case-insensitively so it never duplicates a recipient.
A small **Add a subscriber** form on the Newsletter tab (hidden in read mode) posts to it, for emails
collected in person. Backed by `addNewsletterSubscriber` in `src/db/newsletters.ts`.

**Test send, subscriber management, delivery summary (TASK-190).** Three operator tools on the
Newsletter tab, all **Editor+** (`newsletter:edit`), hidden in read mode:
- **Send test to me** — `POST /api/admin/newsletters/test-send` (`{ subject, bodyJson }`, like preview)
  renders the *current builder doc* and sends one copy to the signed-in admin's own email (subject
  prefixed `[TEST]`), so real-inbox rendering can be checked before a blast. It never touches
  newsletter state.
- **Manage subscribers** — a panel to list (`GET /subscribers[?q=]`, deduped by address, searchable),
  **remove** (`POST /subscribers/remove` → turns `email_consent` off for every row with that address,
  **404** if not a current subscriber), and **export CSV** (`GET /subscribers.csv`). Donor PII, so
  Editor+.
- **Delivery summary** — the send loop records the outcome in three additive `newsletters` columns
  (`sent_count`, `failed_count`, `failed_emails` jsonb; migration
  `1783759279060_newsletter-delivery-summary`) and returns it, so the send message and the newsletter
  list show *delivered / total* and flag any failed addresses instead of losing them to logs
  (`setNewsletterDeliverySummary`).

**Attachments (TASK-193).** A draft newsletter can carry file attachments, sent to every recipient.
Bytes are stored in the `newsletter_attachments` table (migration `1783763395350`,
cascade-deleted with the newsletter), validated by the pure `validateAttachment`
(`src/newsletter/attachment-validation.ts`: a document/image allow-list, **10 MB** cap).
`POST/GET/DELETE /api/admin/newsletters/:id/attachments[/:attId]` (Editor+, draft-only) manage them
from the **Attachments** panel on the Newsletter tab (shown once the newsletter is saved, hidden in
read mode). At send time the loop base64-encodes each attachment once and passes them on every
`sendNewsletter` call as `attachments: [{ filename, content, contentType }]` — **the email relay
(`EMAIL_SEND_URL`) must forward that `attachments` array (Resend's shape)** for them to reach
recipients; the in-repo path (upload, storage, send payload) is complete either way.

The send is
**idempotent**: the draft is claimed atomically (`claimNewsletterForSend`, stamping the sender)
**before** any email goes out, so a double-click or two concurrent admins cannot both send — the
second claim finds no draft and is rejected with **409** rather than double-blasting donors (the
recipient count is stamped afterwards).

**Newsletter images (REQ-069 · TASK-168).** Image blocks (masthead hero, image, story, spotlight,
donation CTA) fill their picture from any of three sources in the same field: a manual URL, an
**"NBCC library"** quick-pick of existing nbcc.scot assets (logo, elf, red-bags handover, and
others — a fixed list in `assets/js/admin/app.js`), or a direct **upload**. `POST
/api/admin/newsletter-images` (Editor+, `{ mime, dataBase64 }` JSON — the client base64-encodes the
file) accepts `image/png`, `image/jpeg`, `image/webp` or `image/gif` up to **2 MB**, rejecting an
unsupported type with **400** and an oversized file with **413** (`validateUpload`,
`src/newsletter/image-validation.ts`); the bytes are stored in the new `newsletter_images` table
(`src/db/newsletter-images.ts`) and the response is the public serve URL. `GET
/media/newsletter/:id` (`src/routes/newsletter-images.ts`, mounted in `src/app.ts`) serves an
uploaded image **unauthenticated** (email clients fetch images with no session) by uuid lookup only
— no path input, so no traversal — with `X-Content-Type-Options: nosniff` and a long-lived
immutable `Cache-Control`, so a served upload can't be sniffed as script. No new config.

The admin UI (`admin.html` + `assets/js/admin/app.js`) drives all of the above and shows **Send**
only to `role === "admin"` on an unsent newsletter (the server enforces regardless of what the UI
hides). Proven by `test/unit/newsletter-blocks.test.ts` (block renderer, all block types/variants),
`test/unit/newsletter-theme.test.ts` (shared brand frame), `test/unit/newsletter-html.test.ts`,
`test/unit/newsletter-image-store.test.ts` (upload validation), `test/unit/newsletter-builder-ui.test.ts`
(admin UI), `test/unit/unsubscribe-token.test.ts` and the `@newsletter @db` `features/newsletter.feature`
(including block create/preview/upload/serve scenarios).

**Public unsubscribe route (REQ-069 · TASK-161).** `GET /unsubscribe/:token`
(`src/routes/unsubscribe.ts`, mounted in `src/app.ts`) is the link every newsletter email carries.
The token is a stateless HMAC of the donor id (`verifyUnsubscribeToken`, signed with
`ADMIN_SESSION_SECRET`); a valid token flips that donor's `email_consent` to `false`
(`unsubscribeDonor`, idempotent — unsubscribing twice is a no-op) and renders a small inline
confirmation page (no new static `.html` file, so there's no Dockerfile-COPY / page-list guard to
update). An invalid or tampered token renders the same page shape with **400** instead of writing
anything. Covered by the `@newsletter @db` `features/newsletter.feature` unsubscribe scenarios.

**Thank-you letters tab (REQ-069 · TASK-163).** An eighth admin nav section (between Newsletter and
Audit) for thanking significant givers. It has three panels: **(1) Donors to thank** reads
`GET /api/admin/thank-you/eligible` (TASK-162) and lists eligible donors with a send-state pill;
**(2) Compose & send** is a form with a **live A4 letter preview** (the exact branded letter the
donor is emailed, mirroring the pure `src/thank-you/letter.ts`) that updates as you type — a
`Write` on a listed donor prefills it; **(3) Sent history** reads `GET /api/admin/thank-you/sent`.
Sending posts `POST /api/admin/thank-you/send` (**Editor+**): the body is the `thankYouInputSchema`
letter fields, `sentBy` is taken from the authed admin (never the client), and the row + its
`thank_you.sent` audit entry are written atomically (`recordThankYouSent`) before the donor is
**best-effort** emailed the branded letter via `sendThankYou` (`src/clients/email.ts`) — a failed
send is logged, not fatal, so the letter is still recorded. `signedByRole` and `letterDate` are
`letterDate` is presentation-only (not stored — the print page below uses the row's `sent_at`);
`signedByRole` **is** stored (TASK-165, additive `signed_by_role` column) so a re-opened letter keeps
the signatory's title. The email is routed by the relay's dedicated `thankYou` branch
(`services/email-relay/src/index.js`), which honours the message's own subject + repliable
`from`/`replyTo`. The UI (`admin.html` view `view-thank-you` + the `ty-*` styles in
`assets/css/admin.css` + `assets/js/admin/app.js` `loadThankYou`) shows **Send** only to Editor/Admin
(the server enforces regardless). Proven by `test/unit/thank-you-letter.test.ts`,
`test/unit/email-relay-build.test.ts` and the `@thankyou @db` `features/thank-you.feature`
send/history/role scenarios.

**Thank-you from-address, deliverability + printable-letter page (REQ-069 · TASK-165).** Three
follow-ons to the tab above. **(a)** Thank-yous now send From **and** Reply-To
**`GIVING_FROM_EMAIL`** (`giving@nbcc.scot` — a repliable giving inbox, not a `noreply`; see
**Configuration**), authenticating on the verified `nbcc.scot` Resend domain. **(b)** The email now
carries a **plain-text alternative** (`buildThankYouEmailText`) alongside the HTML — HTML-only mail
scores as more spam-like — improving inbox placement. **(c)** Instead of a PDF attachment (which
raises spam scores and needs a PDF/headless subsystem the repo doesn't have), the email links to a
public **printable-letter page**: `GET /thank-you/letter/:token` (`src/routes/thank-you.ts`,
mounted before the site catch-all) renders the stored letter as a print-ready A4 page
(`buildThankYouLetterPage`, faithful to `assets/thankyou-letter-print.html`) that the donor prints or
saves as a PDF from the browser. The page prints on **one A4 sheet on mobile as well as desktop**
(TASK-197): text auto-inflation is pinned off (`text-size-adjust:100%`) so a phone doesn't enlarge the
body of the wide fixed-width letter, and the print layout clamps the sheet to exactly one page
(`height:297mm; overflow:hidden`) so a rounded sub-pixel can't push a blank second page — previously
phones had to scale to ~78% to avoid the overflow. The token is a stateless HMAC of the sent-letter id
(`src/thank-you/letter-token.ts`, signed with `ADMIN_SESSION_SECRET`) so letters can't be enumerated;
a bad token → 400, a missing row → 404. The admin sent-history also exposes each letter's print URL
("View letter"). Covered by `test/unit/thank-you-letter-token.test.ts`,
`test/unit/thank-you-letter-page.test.ts`, the extended `thank-you-letter` text/print-button tests,
and `@thankyou @db` print-page scenarios. **Ops:** the relay Worker must be **redeployed**
(`services/email-relay` — a manual `wrangler deploy`) for the `giving@` sender + `thankYou` branch to
take effect, and the new `GIVING_FROM_EMAIL` SSM param needs an infra apply.

**Thank-you CC + delete (REQ-069 · TASK-168).** Two additions to the tab above. **(a)** The compose
form has an optional **CC** field (`ccEmail`) so an admin can copy a colleague on the donor's email;
it is validated as an email when set, sent-time only (not stored), threaded through
`sendThankYou` → the relay's `thankYou` branch → the Resend `cc`. **(b)** Each **Sent history** row
(Editor+) has a **Delete** button: `DELETE /api/admin/thank-you/sent/:id` (`deleteThankYouSent`)
removes the row and appends a `thank_you.deleted` audit entry in the same transaction — written
**only** when a row is actually deleted (a missing id → 404, no audit). The append-only `audit_log`
keeps the original `thank_you.sent` entry, so the governance trail records both the send and the
deletion. Covered by the extended `email-relay-build` CC test and `@thankyou @db` delete/CC scenarios.
**Ops:** the relay Worker must be redeployed for the CC pass-through to take effect (delete works
without it — it's an app endpoint).

**Supporter ticker (REQ-003 · TASK-178).** An admin-curated list of ongoing supporters (businesses or
people) shown scrolling under the site nav — distinct from the donor-derived Supporters page. The
`supporter_ticker` table (additive migration; `name`, `active`, `sort_order`) is served two ways: the
public `GET /api/supporters/ticker` returns the **active** names in order, and the admin
**Supporters ticker** tab (`view-ticker` + `loadTicker` in `assets/js/admin/app.js`) does full CRUD
over `/api/admin/ticker` — reads are Viewer+, add/edit/hide/delete are **Editor+** and each write
appends a `supporter.*` audit row (`src/db/ticker.ts`). The public marquee is injected by
`assets/js/main.js` (`initSupporterTicker`) on every marketing page: it fetches the feed and, only if
there are supporters, renders a seamless CSS marquee fixed at `top:var(--nav-h)` and adds
`body.has-ticker` (which reserves `--ticker-h` so nothing else shifts otherwise). It pauses on hover
and respects `prefers-reduced-motion` (no animation, a scrollable strip instead). Proven by
`test/unit/ticker-model.test.ts` and the `@ticker @db` `features/ticker.feature` (add → public feed;
hide/delete → removed; Viewer → 403). The ticker + admin tab are labelled **"Partners"** (TASK-180);
the underlying table/route/`view-ticker` names are unchanged.

**Partners list on the Supporters page (REQ-003 · TASK-180/181).** The same active list is also shown
on `supporters.html` **below the donors**. The page is now two clearly-defined `.list-block` sections —
**Donors** and **Partners** — each introduced by a large `.list-heading`, and both rendered in the
**same** `.supporter-grid` cards (icon + name + kind), so they read as one design. `initPartners` in
`assets/js/main.js` fetches `GET /api/supporters/ticker`, sorts by `localeCompare`, renders a
`.card.supporter` per partner into `#partnersList`, and unhides the section — so an empty list shows
nothing (no bare heading). The real partner roster is seeded into `supporter_ticker` by the data-only,
idempotent `1783709948147_seed-partners.js` migration (TASK-181; `INSERT … WHERE NOT EXISTS`), so it
ships to staging + production; guarded by `test/unit/seed-partners-migration.test.ts`.
**Contact form tab (2026-07-10 contact-inbox spec).** A "Contact form" admin nav section (between
Stories and Newsletter) for the public enquiry form (`contact.html`), backed entirely by the
**isolated `contact` database** (`src/db/contact.ts`, `contactPool` — never `src/db/pool.ts` or the
stories DB; see **Configuration** and the migration walkthrough below). Reads are **Viewer+**:
`GET /api/admin/contact` lists enquiries newest-first (optional `?status=new|replied`),
`GET /api/admin/contact/:id` returns one enquiry in full. The list table shows Received
(`formatReceived`), Name, Email, a Status badge and an ~80-character message snippet; opening a row
shows the full message (line breaks preserved) and, once replied, a **"Replied by `<email>` ·
`<when>`"** line. Writes are **Editor+** (the server enforces regardless of what the UI hides, via
`H.roleCan`): **Reply in Gmail** opens a prefilled Gmail compose tab
(`buildGmailReplyUrl`/`formatReceived`, `assets/js/gmail-reply.js` — pure, unit-tested in
`test/unit/gmail-reply.test.js`) and `PATCH /api/admin/contact/:id` with `{ status: "replied" }`,
which records the signed-in admin's email as `replied_by` and stamps `replied_at`; **Mark as new**
(shown only once replied) `PATCH`es `{ status: "new" }`, clearing both; **Delete**
(`DELETE /api/admin/contact/:id`, after a confirm) removes the enquiry for good and returns to the
list. Since `assets/js/admin/app.js` is a classic script (not a module) but `gmail-reply.js` is an ES
module, `admin.html` bridges the two with a tiny `<script type="module">` that imports
`buildGmailReplyUrl`/`formatReceived` and assigns them onto `window`, which `app.js` then calls
directly. The tab mirrors the Stories tab's markup/classes exactly (`.admin-view`,
`.admin-table-wrap`, `.admin-segmented`/`.admin-seg`, the detail/back pattern) — no new CSS, no new
visual system. `loadContact`/`contactTable`/`openContact`/`renderContact` in `app.js` are DOM glue,
exercised by hand rather than the unit suite (mirroring the rest of `app.js`); the route logic is
proven by `test/unit/admin-contact-routes.test.ts` (mocked `src/db/contact`, no real DB).

**Admin user management: the Team tab (admin-management Phase 1).** An Admin manages who can sign
in to `/admin` — invite, remove, disable, and set each person's role — from the dashboard, with no
migration or manual DB write needed. It extends the existing `users` table and admin auth (role
stays `viewer`/`editor`/`admin`; the per-section view/edit matrix — Phase 2, documented below —
lets an admin fine-tune a person's access beyond their role's defaults) rather than replacing it.

- **Data model.** An additive migration (`migrations/1783724491770_admin-user-lifecycle.js`) adds
  `status` (`invited`\|`active`\|`disabled`, default `active` so every existing admin keeps signing
  in unchanged), `invited_at` and `last_login_at` to `users`. `POST /api/admin/login` now stamps
  `last_login_at` on a successful sign-in and rejects a `disabled` or still-`invited` account with
  the same generic `401` as a wrong password (no enumeration of which accounts exist).
- **Invite / reset tokens (`src/admin/tokens.ts`).** Stateless, purpose-scoped (`invite`\|`reset`),
  short-lived HMAC tokens signed with the existing `ADMIN_SESSION_SECRET` (no new config/secret) —
  same shape as the admin session token. `bind` is the user's `password_hash` at issue time
  (`""` for an invite, since an invited user has none); the accept endpoint re-checks `bind`
  against the *live* row, so a link stops working the moment the password is set — single-use, with
  no token storage needed. Invite links last 48h, reset links 1h.
- **Routes (`src/routes/admin-users.ts`, mounted in `src/app.ts`).** `GET/POST /api/admin/users` and
  `PATCH/DELETE /api/admin/users/:id` and `POST /api/admin/users/:id/reset` are **Admin role only**
  (viewer/editor get `403`) — tighter than the read-only Viewer/Editor lists elsewhere, since this
  surface controls who can sign in at all. `POST /api/admin/forgot` and `POST /api/admin/set-password`
  are **public** (rate-limited): `forgot` always returns `200 {ok:true}` whether or not the email is
  known and only emails a reset link to an **enabled** (`active`) account (no enumeration); `set-password`
  verifies the token, re-checks the `bind`/live-hash match, hashes the new password
  (`src/admin/password.ts`), and activates the account. Every mutating write is audited in the same
  transaction as the DB write (`src/db/admin-users.ts`, `writeWithAudit`) — `admin_user.invited`,
  `.role_changed`, `.status_changed`, `.removed`, `.activated`, `.password_reset`.
- **Anti-lockout guard.** `isLastEnabledAdmin` / the pure `wouldOrphanAdmins` (unit-tested in
  `test/unit/admin-users-guard.test.ts`) blocks a role change away from `admin`, a disable, or a
  delete that would drop the enabled-admin count to zero, returning `409 {error:"last_admin"}`
  **before** any write.
- **`set-password.html`.** A standalone page (mirrors `portal.html`'s style, outside the marketing
  nav/footer) that both `/invite` and `/reset` redirect to (`_redirects`; the token's `purpose`
  claim only changes which audit action is recorded — the accept flow is identical). It reads
  `?token=` from the URL and `POST`s `{token, password}` to `/api/admin/set-password`; success shows
  a link to `/admin`, an expired/already-used link shows "this link has expired or already been
  used — ask an admin to re-send."
- **Team tab UI (`admin.html` view `view-team`, `loadTeam` in `assets/js/admin/app.js`).** An
  eighth admin nav section, under a new **Admin** group, visible only to Admins (the nav entry
  itself is hidden for viewer/editor at sign-in, since the API is Admin-only and would otherwise
  always fail for them). An invite form (email, full name, a role select) posts to
  `POST /api/admin/users`; the table lists every user — Name, Email, an inline **Role** select
  (`PATCH {role}`), a **Status** pill (Invited/Active/Disabled), **Last login**, and actions
  **Reset password** (`POST /:id/reset`), **Disable**/**Enable** (`PATCH {status}`) and **Remove**
  (`DELETE`, after a `confirm`). Every interpolated value is HTML-escaped (`H.escapeHtml`); a
  `409 {error:"last_admin"}` from any write shows the inline message "That is the last admin.
  Promote someone else first." and reloads the table so an optimistic UI change (e.g. the role
  select) reverts to the real state. Like the rest of `app.js`, `loadTeam` is DOM glue exercised by
  hand rather than the unit suite; `admin-shell.test.ts` covers the nav entry + `#view-team` markup,
  and `features/admin-users.feature` (`@admin @db`) covers the API end to end: invite, accept via
  set-password then log in, forgot-password's no-enumeration `200`, a disabled user's login being
  blocked, a non-admin's `403`, and the last-admin `409` guard.

**Per-section view/edit permission matrix (admin-management Phase 2, TASK-186).** Replaces the flat
`viewer < editor < admin` role gate with a per-person, per-section `none`/`view`/`edit` matrix,
enforced fresh on every admin request — closing the stale-session gap Phase 1 left, where a
disabled user's still-valid token kept working until it expired (up to 8h).

- **The matrix (`src/admin/permissions.ts`, pure, no DB/Express).** 13 sections — `overview`,
  `search`, `donations`, `claims`, `gasds`, `subscriptions`, `stories`, `ticker`, `contact`,
  `newsletter`, `thank-you`, `audit`, `team` — each `none`\|`view`\|`edit` (`edit` implies `view`).
  `overview` has no gated route of its own (it aggregates other sections' widgets, which enforce
  their own gates) and is always visible in the nav. `roleToPermissions(role)` gives each role's
  **default** matrix (`admin` → edit everywhere incl. `team`; `editor` → edit on the operational
  sections, view on `audit`, none on `team`; `viewer` → view everywhere except `team`, no edit
  anywhere) — a person's **effective** permissions (`effectivePermissions`) are their stored
  `permissions` JSONB if non-empty, else their role's defaults, so every existing user kept exactly
  their pre-Phase-2 access with **zero data migration**. `can(perms, section, level)` is the single
  predicate both the gate and the anti-lockout guard use to check a level.
- **Storage.** An additive migration (`migrations/1783729848662_user-permissions.js`) adds
  `permissions jsonb NOT NULL DEFAULT '{}'` to `users` (an empty map = "use my role's defaults").
  `getUserAuthRow` (`src/db/admin-users.ts`) is a minimal, hot-path SELECT of `id, email, status,
  role, permissions` — never `password_hash` — reloaded fresh on every gated request.
- **`authorizeSection` (`src/routes/admin-authz.ts`), replacing `authorizeAdmin`.** `async
  authorizeSection(req, res, section, level)` verifies the bearer session token (same parsing/401
  messages as the old `authorizeAdmin`), loads the caller's **live** row, rejects a **missing or
  `disabled`** user with the same generic `401` (no enumeration), computes their effective
  permissions and checks `can(perms, section, level)` — insufficient access is `403 {error:
  "forbidden"}`. All ~48 `/api/admin/*` handlers (`src/routes/admin.ts`, `src/routes/admin-users.ts`)
  were refactored from `authorizeAdmin(req, res, minRole)` to `await authorizeSection(req, res,
  section, level)`, preserving each route's pre-Phase-2 access exactly (`level` was `view` where
  the old gate was `viewer`, else `edit`); `authorizeAdmin` no longer has any caller.
  `authorizeAny(req, res)` is a lighter variant — a valid, non-disabled session, no section check —
  used only by `/me` below. The three public auth routes (`login`, `forgot`, `set-password`) are
  untouched.
- **`PATCH /api/admin/users/:id/permissions`** (`team:edit` only, `src/routes/admin-users.ts`).
  Body is a **complete** 13-section matrix (`permissionsSchema`, `.strict()` on both the outer body
  and the inner map, so an unknown key is a `400`, not silently ignored) — matching what the Team
  matrix editor always submits. `setUserPermissions` (`src/db/admin-users.ts`) writes it and appends
  an audited `admin_user.permissions_changed` row in the same transaction (`writeWithAudit`).
- **Anti-lockout guard, re-expressed for the matrix.** "Last admin" is now "the last non-disabled
  user with **effective `team:edit`**" rather than "the last `role='admin'`" — `ADMIN_HOLDER_SQL`
  (`src/db/admin-users.ts`) and the pure `wouldOrphanAdmins` predicate both key off a stored
  `permissions.team === "edit"`, falling back to `role === 'admin'` only when a user has no stored
  matrix at all (an empty `{}`). The same fast pre-check + transactional `assertAdminsRemain`
  pattern as Phase 1's role/status/delete guards applies to a permissions `PATCH` that would move
  the target's `team` level away from `edit`: `409 {error:"last_admin"}`, no write.
- **`GET /api/admin/me`** — any valid, non-disabled session (via `authorizeAny`, no section check).
  Returns `{ email, permissions }` — the caller's own effective matrix — so the front-end can filter
  its nav and gate write controls without a second source of truth. **Not itself a security
  boundary**: every other route's `authorizeSection` call is what actually enforces access: hiding a
  nav link or a button is UX, not authorization.
- **Team matrix editor + permission-aware nav (`admin.html`, `assets/js/admin/app.js`).** Opening a
  Team row now offers a **Manage access** view: the 13 sections as rows, a none/view/edit control
  per row, pre-filled from the person's effective permissions, plus **Viewer / Editor / Admin**
  preset buttons that fill the matrix from `roleToPermissions` (a UX convenience only — the actual
  access is whatever gets saved). Save calls `PATCH .../permissions`; a `409 last_admin` shows the
  same inline "that is the last admin" message Phase 1 uses elsewhere. The editor itself is gated
  behind the caller having `team:edit` (`canEdit("team")`). On load, `GET /api/admin/me` populates a
  module-level `myPermissions`; the nav hides any `.admin-nav-link` whose `data-view` section the
  caller cannot `view` (`overview` always stays visible), and every `load*` view's write controls
  are gated by a `canEdit(section)` helper, replacing Phase 1's flat `roleCan(currentRole,
  "editor")` checks throughout.
- Proven end to end by `features/admin-permissions.feature` (`@admin @db`): a view-only user reads
  their permitted section but is `403`'d on a write and on a section they cannot even view; granting
  a new section unblocks a write there; a non-`team:edit` user is `403`'d from the permissions
  endpoint itself; removing the last effective `team:edit` holder is `409 last_admin`; and `GET
  /api/admin/me` reports the caller's own effective matrix.

**Mandatory email 2FA on admin login (admin-management Phase 3, TASK-188).** Every admin sign-in now
requires a one-time emailed code, unless the browser already holds a valid 30-day "remember this
device" token — no authenticator app, no enrolment. Password verification, roles, and the per-section
permission matrix (Phase 2, above) are all **unchanged**: 2FA is a second gate on top of the existing
login, not a replacement for it.

- **Two-step login.** `POST /api/admin/login` `{ email, password, deviceToken? }` still verifies the
  password + account status exactly as before (same generic `401` for a wrong password, unknown
  email, or a disabled/still-invited account). On success:
  - If `deviceToken` is present and verifies (`verifyDeviceToken`) for **this** user, the session is
    issued immediately, exactly as pre-Phase-3 — a trusted device skips the code step entirely. A
    device token for a *different* user (e.g. stolen from another admin's `localStorage`) is silently
    rejected and falls through to the code challenge, not accepted.
  - Otherwise a 6-digit code is generated (`generateLoginCode`, `src/admin/two-factor.ts`), its keyed
    HMAC hash stored (`admin_login_codes`, one row per user, upserted — additive migration
    `1783785596017_admin-login-codes.js`), best-effort emailed (`sendAdminLoginCode`,
    `src/clients/email.ts`), and the response is `200 { step: "2fa", email }` — **no session yet**.
  - `POST /api/admin/login/2fa` `{ email, code, remember? }` verifies the code: expired (10 minutes)
    or missing → `401`; wrong code → `401` and the attempt counter increments; a **6th** wrong attempt
    → `401` and the pending code is deleted outright (forcing a fresh step-1 code request, not just a
    reset counter). The correct code issues the session token and, if `remember` was set, also a
    signed 30-day device token (`issueDeviceToken`) returned as `deviceToken`.
- **Crypto (`src/admin/two-factor.ts`, pure, no DB/Express).** Both the login-code hash and the
  device token are HMAC'd with the **existing** `ADMIN_SESSION_SECRET` — no new config/secret — each
  under a distinct domain prefix (`"admincode.v1:"` / `"admindevice.v1:"`, mirroring
  `src/admin/tokens.ts`'s `ACTION_TOKEN_DOMAIN` pattern) so a device token can never be replayed as a
  session or action token, or vice versa, even under the same secret. The code is **never stored in
  the clear** — only its keyed hash — so a DB leak of `admin_login_codes` can't be brute-forced
  offline without also having the secret. Code and token comparisons are constant-time
  (`timingSafeEqual`).
- **Front end (`admin.html`, `assets/js/admin/app.js`).** The login form posts step 1 with
  `deviceToken: localStorage["nbcc_admin_device"] || undefined`. A `{ step: "2fa" }` response reveals
  a code-entry panel (6-digit input, a "Remember this device for 30 days" checkbox, Verify), which
  posts step 2; on success the returned `token` is stored as before and, if a `deviceToken` came back
  (remembered), it is written to `localStorage["nbcc_admin_device"]` for the 30-day skip on future
  logins. A wrong code shows an inline error and stays on the code panel (honest-save).
- **Non-production dev code (stub safety).** `src/clients/email.ts` stubs outbound email (no network)
  outside production whenever `EMAIL_SEND_URL` is a placeholder (`emailStubbed`) — which is the case
  in local dev and CI by default. Since a stubbed send never actually delivers the code, step 1's
  response includes it directly as `devCode` **only when `config.NODE_ENV !== "production"`** — so
  staging/local admins can always complete 2FA even without live email — and this is **never** true in
  production, where the code is always emailed and never echoed back. The BDD suite
  (`features/admin-2fa.feature`) relies on this to log in end to end without a real mail provider.
- **Rate limiting.** Both endpoints are limited per email and per client IP (`createRateLimiter`,
  `src/portal/request-limiter.ts` — in-memory, per-task, same documented follow-up as the donor
  portal's limiter), and neither the code, its hash, nor a device token is ever logged.
- Proven by `test/unit/admin-two-factor.test.ts` (the pure crypto: code shape, hash/verify
  round-trips, device-token round-trip/tamper/expiry/cross-domain rejection) and
  `test/unit/admin-auth.test.ts` (the two routes against a mocked pool: trusted-device session,
  step-1 challenge + devCode, a device token scoped to a different user falling through to 2FA, the
  correct/wrong/expired/6th-attempt code paths, and `remember` producing a verifying device token);
  end to end by the `@db` `features/admin-2fa.feature` (step 1 returns a devCode; a wrong code then
  the right code; a device token skips the code step; the 6th wrong attempt locks out) plus the
  updated `features/admin-auth.feature` / `features/admin-users.feature` scenarios that now complete
  the 2FA step to obtain a session.
- **Login-code subject (fixed in TASK-209).** The Cloudflare Worker email relay
  (`services/email-relay/src/index.js`) used to map each transactional payload to a Resend send by
  sniffing its fields (`buildEmail`), with no branch for the login-code payload, so it silently fell
  through to the generic donation-confirmation default and sent the **wrong subject** ("Thank you for
  your donation to NBCC" on a 2FA code). TASK-209 fixed the whole email family: every send now carries
  an explicit `kind`, the relay routes on it, and each kind gets its OWN branded body + correct subject
  (the login code now reads "Your NBCC admin sign-in code"). The old field heuristics remain only as a
  deploy-skew fallback for a no-`kind` payload. See **All transactional emails share one branded shell**
  below.

**All transactional emails share one branded shell (REQ, TASK-209).** Every transactional send from
`src/clients/email.ts` now tags its JSON with an explicit `kind`, and the Cloudflare Worker email relay
(`services/email-relay/src/index.js`, `buildEmail`) routes on that `kind` first, wrapping the body in
ONE branded shell and giving each email its OWN correct subject. The shell mirrors the admin thank-you
letter email (`src/thank-you/letter.ts`): a maroon page, a cream content panel, the NBCC logo
letterhead (hosted absolute URL, not base64), and a maroon footer bar carrying `01292 811 015` /
`giving@nbcc.scot` / `nbcc.scot`. It stays email-safe (layout tables + inline styles + web-safe
Georgia/Playfair and Arial/Poppins stacks) and carries a `color-scheme: light` meta so dark-mode
clients don't invert the palette. The `kind` -> subject map:

| `kind` | subject | body |
|---|---|---|
| `donation` | Thank you for your donation to NBCC | app |
| `receipt` | Your NBCC donation receipt | app |
| `refund` | Your NBCC refund confirmation | app |
| `loginCode` | Your NBCC admin sign-in code | relay |
| `adminInvite` | Your NBCC admin account invitation | relay |
| `adminReset` | Reset your NBCC admin password | relay |
| `portal` | Your NBCC donor portal link | relay |
| `declaration` | Add Gift Aid to your NBCC donation | relay |
| `lapsedDonor` | Your NBCC monthly donation has stopped | relay |
| `lapsedAdmin` | A monthly NBCC subscription has lapsed | relay |

This fixes a real bug: the 2FA sign-in code, admin invites and password resets used to fall through the
relay's field-sniffing to the donation default and get the wrong subject, and almost none were branded.
The `donation` / `receipt` / `refund` bodies are still built by the app (`src/donors/confirmation.ts`,
`src/donors/receipt.ts`) and already end with the charity-registration line, so the shell wraps them with
a contacts-only footer (no duplicate registration); the `relay`-built kinds get the registration in the
footer. `newsletter` and `thankYou` are unchanged (each already ships its own fully branded html +
subject). Covered by `test/unit/email-relay-build.test.ts` (each kind's subject, the branded shell,
the footer contacts on every kind, registration exactly once, the old collisions gone, and the no-`kind`
skew fallback). **Ops:** the relay Worker is deployed on its own (`cd services/email-relay && wrangler
deploy`), so it needs its own redeploy for the rebrand + fixed subjects to reach live email; the app
side ships with the normal ECS deploy. The two tolerate deploy skew in either order (the app keeps
sending, and the relay keeps its field heuristics, as a fallback).

**My account: self-service name + password (admin-management Phase 4, TASK-197).** Any signed-in
admin, of any role, can change their own display name and password from a **My account** panel —
no `team:edit` or any other section permission needed, since a person managing their own account
isn't managing the team.

- **Reaching it.** A **My account** button sits in the topbar next to the signed-in email/sign-out
  (`#accountBtn`, `admin.html`), opening `#view-account`. This view is deliberately **not** part of
  the permission-filtered section nav (it has no `data-view` entry and isn't one of the 13 sections
  in `src/admin/permissions.ts`) — every signed-in user reaches it the same way, regardless of their
  matrix.
- **Endpoints (`src/routes/admin-users.ts`), gated by `authorizeAny` (a valid, non-disabled session;
  no section/level check) and always acting on `claims.sub` — never an id from the request body or
  path, so a caller can only ever change their OWN name/password here:
  - `GET /api/admin/me` now also returns `fullName` (alongside the existing `email` + `permissions`
    from Phase 2), read via the same `getManagedUser` lookup the Team table uses.
  - `PATCH /api/admin/me` `{ fullName }` (1-120 chars, `meNameSchema`) updates the caller's
    `full_name`; audited `admin_user.name_changed`.
  - `POST /api/admin/me/password` `{ currentPassword, newPassword }` (`newPassword` 10-200 chars,
    `mePasswordSchema`, matching the invite/reset minimum) loads the caller's own `password_hash`
    server-side and verifies `currentPassword` against it (`verifyPassword`) — a mismatch is
    `400 {error:"wrong_password"}`, no write. On success the new password is hashed
    (`hashPassword`) and `status` is left untouched (unlike an invite/reset accept, a self-service
    change is never an activation event). Audited `admin_user.password_changed`. Rate-limited per
    caller and per IP (`createRateLimiter`, mirroring `postAdminForgot`'s dual-limiter shape) so
    repeated wrong guesses can't brute-force the current password.
- **Email is not self-editable here** — it's both the login identity and the audit actor label
  (`actorOf`), so only an Admin can change it, via the Team tab's existing user-management flow.
- **DB helpers (`src/db/admin-users.ts`).** `setOwnName` / `setOwnPassword` are audited single-column
  writes (`writeWithAudit`) that mirror `setUserRole`/`setUserStatus`'s shape but never touch
  role/status/permissions and never run the anti-lockout guard (a name or password change can't
  orphan the admin team).
- **UI (`admin.html` `#view-account`, `assets/js/admin/app.js`).** The email field is read-only; a
  name form (prefilled from `GET /api/admin/me`) saves via `PATCH /api/admin/me` and, on success,
  also updates the topbar's displayed name; a password form (current + new + confirm) checks the
  new/confirm fields match and are 10+ characters client-side before ever calling the API. Both are
  **honest-save**: a status message only shows on a genuine `200`; a `400 {error:"wrong_password"}`
  shows an inline "current password is incorrect" rather than a generic failure. Every interpolated
  value is HTML-escaped; no passwords are ever logged.
- Proven by `test/unit/admin-users-routes.test.ts` (`/me` returns `fullName`; `PATCH /me` changes
  only the caller's own name and ignores any `id` in the body; a password change with the right
  current password succeeds and the wrong one is rejected with no write; a disabled/invalid session
  is `401`) and end to end by `features/admin-account.feature` (`@admin @db`): changing your own
  name; changing your own password with the correct current password (then logging in with the new
  one); a wrong current password rejected `400`; a name and a password change each landing in the
  audit log as `admin_user.name_changed` / `admin_user.password_changed`.

**Audit visibility for admin-user events (admin-management Phase 4, TASK-197).** No new plumbing was
needed: every `admin_user.*` action from Phases 1-4 — `invited`, `role_changed`, `status_changed`,
`permissions_changed`, `removed`, `activated`, `password_reset`, `name_changed`,
`password_changed` — is already written to `audit_log` (`entity: "user"`) in the same transaction as
its DB write via `writeWithAudit`, and the existing **Audit** tab (`GET /api/admin/audit`,
`listAuditLog` in `src/db/admin.ts`, `loadAudit` in `assets/js/admin/app.js`) lists every
`audit_log` row newest-first with no entity filter applied by default — so admin-user events already
surface there, interleaved with donor/donation/declaration events, identifiable by their `Action`
column (`admin_user.*`) and `Entity` column (`user <id>`). `listAuditLog` already supports an
`entity`/`entityId` query-string filter (`GET /api/admin/audit?entity=user`) for narrowing the list
to just user-management events if needed; the UI doesn't expose a filter control for it today, left
as-is since the flat list was confirmed usable without one.

**`POST /api/contact` now stores, not forwards (2026-07-10 contact-inbox spec).** The public enquiry
endpoint (REQ-030) still validates `{ firstName, lastName, email, message }` zod-first
(`contactEnquirySchema`, `firstName`/`email`/`message` required, `lastName` optional, **400** on a
bad/missing field), but a valid enquiry is now **stored** directly via `insertEnquiry`
(`src/db/contact.ts`) into the isolated `contact` database, returning `{ status: "sent" }` on
success and **500** on a store failure. The previous external form-service forward
(`src/clients/contact.ts`'s `forwardEnquiry`, `CONTACT_FORWARD_URL`) is **retired from this path** —
the client module and its config value are left in place (unused) rather than removed, so no other
touch-point changes. A honeypot field (`company`) filled by a bot is silently accepted (**200**,
nothing stored) and a per-IP rate limiter (5/minute) guards the endpoint, matching the My Story
submission pattern. `initContactForm` (`assets/js/main.js`) is now **honest-save**: the success
message and form reset show **only** on a genuine `res.ok` from this endpoint; a non-2xx response or
network failure shows an inline error and **keeps the typed message** (nothing is discarded, no
silent mailto fallback), and the submit button is disabled only while the request is in flight.
Verified by `test/unit/contact.test.ts` (jsdom, mocked `fetch`) and `test/unit/contact-endpoint.test.ts`
(mocked `insertEnquiry`).

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

**Setting an admin password.** `POST /api/admin/login` (REQ-062) verifies email + scrypt password. A
user row can exist with `role='admin'` but `password_hash=NULL` (e.g. seeded by a migration), which
always 401s until a credential is set. `src/ops/set-admin-password.ts` sets the hash for an **existing**
user (it does not create users or grant roles — that stays in migrations). It lives under `src/` so
`tsc` compiles it into `dist/` and it ships in the runtime image, meaning it runs with plain `node`
(no `tsx`/devDeps). The plaintext is read from `ADMIN_PASSWORD` (never argv, never logged; golden
rule 4) and hashed with the same scheme `src/admin/password.ts` verifies. Pure input handling is
covered by `test/unit/set-admin-password.test.ts`.

Locally (against a dev DB), via the `tsx` npm script:

```
ADMIN_PASSWORD='…' npm run admin:set-password -- --email you@example.com
```

In production the DB is only reachable from inside the VPC, so run it as a one-off ECS task (the same
`ecs run-task` pattern as migrations), overriding the container command to
`node dist/ops/set-admin-password.js --email <addr>`. `ADMIN_PASSWORD` is injected as a task-def
secret sourced from the `ADMIN_BOOTSTRAP_PASSWORD` SSM SecureString (its ARN is in the `exec_secrets`
IAM policy). Set that parameter with `put-parameter` before the run and delete it afterwards; the
password never appears in argv, the task-def, or CloudTrail in plaintext.

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
For the hosted mode `success_url` / `cancel_url` come from config; for `uiMode:
"embedded"` **when `STRIPE_PUBLISHABLE_KEY` is configured** (TASK-215) they are replaced
by `ui_mode: "embedded_page"` + a `return_url` (built on the `STRIPE_SUCCESS_URL` base with
`{CHECKOUT_SESSION_ID}`), and the response is `{ clientSecret, publishableKey }` instead of
`{ url }` — every other session field, and all metadata below, is identical across the two
modes. With **no key set, `"embedded"` is served exactly as hosted** (`{ url }`), so the
feature stays dormant until the key lands. When
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
> `test/unit/checkout-session.test.ts` (mocked client) + the BDD scenarios, and the
> stub-vs-live switch itself is locked by `test/unit/stripe-config.test.ts`: the
> `(sk|rk)_(test|live)_` + 20-char-token regex across every key shape (incl. the
> 20-vs-19-char boundary and a rejected `pk_`/placeholder), plus the go-live
> invariant that **production selects the real SDK even with a placeholder key**
> (loud failure, not a silent fake checkout).
>
> **Pinned API version.** Both real SDK clients (the checkout/subscription client
> and the webhook verifier) are constructed with an explicit `apiVersion`
> (`STRIPE_API_VERSION`, `src/clients/stripe.ts`) instead of the SDK's implicit
> default, which shifts on every `stripe` package bump. The literal is type-checked
> against the SDK's `LatestApiVersion` at the `new Stripe(...)` call site, so an
> out-of-date pin fails the build — bump it in lockstep when upgrading `stripe`, and
> align the webhook endpoint's API version in the Stripe dashboard so delivered
> events match the pinned types. Verified by `test/unit/stripe-api-version.test.ts`.

**Reducing a monthly donation (TASK-238).** The former `POST /api/subscription/change-plan`
endpoint and its `changeSubscriptionPlan` wrapper were removed as dead code (no front-end caller,
no auth). Reducing a monthly donation is now done by re-subscribing at a lower tier from the donate
page; the portal's "reduce instead" link points there.

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
- **`thank_you_sent`** — one row per admin thank-you letter sent (additive migration
  `1783544630090_thank-you-sent.js`, REQ-069 · TASK-161). A **nullable** `donor_id` FK
  (`onDelete SET NULL`, so an in-kind giver that isn't a donor row — a company or church — is
  allowed and the history row survives a donor removal), the recipient names
  (`thank_you_name`/`addressed_to`/`recipient_email`), a gift snapshot (`gift_type` `money`|`in_kind`
  with `gift_amount_pence` **or** `gift_in_kind`, enforced by a table CHECK, plus a `gift_aided`
  flag), the optional `personal_message`, the `signed_by_name`, and `sent_by` (the logged-in admin,
  which may differ from the signatory). It powers the "already thanked" dedupe, an `audit_log` entry
  per send, and the **Sent history** — storing enough to re-render the PDF. Pure model
  `src/thank-you/model.ts` (`thankYouInputSchema`, `giftAidUpliftPence`, `formatGiftAmount`,
  `giftSummary`; unit-tested DB-free in `test/unit/thank-you-model.test.ts`); write/read layer
  `src/db/thank-you.ts` (`recordThankYouSent` via `writeWithAudit`, `hasBeenThanked`,
  `listThankYouSent`).
- **`business_supporter_fulfilment`** — one thank-you & fulfilment record per business supporter
  (additive migration `1783961442118_business-supporter-fulfilment.js`, TASK-205 — the **data-model
  foundation** the later business-supporter PRs build on: thank-you page capture, reminders, admin
  fulfilment UI, backfill). A **UNIQUE** `donor_id` FK (`onDelete RESTRICT`, so one row per donor and
  the record is protected like the other donor-referencing financial rows — the UNIQUE constraint
  supplies the `donor_id` index), the recognition `band` (`bronze`/`silver`/`gold`/`platinum`, CHECK),
  the **captured preferences** the business submits on the thank-you form (`credit_name`, `website`,
  `socials`, `list_on_supporters` opt-in, `want_social`/`want_badge`/`want_certificate`,
  `certificate_delivery` `download`/`post`, `certificate_address`, `consent_featured`, and
  `captured_at` — NULL until they submit), the **admin fulfilment flags** (booleans only —
  `certificate_sent`/`certificate_posted`/`badge_sent`/`social_done`/`added_to_supporters`; who/when
  each was done is recorded separately in the append-only `audit_log`), and the reminder-tracking
  `reminder_5_at`/`reminder_14_at`. Additive-only: every column is nullable or defaulted, no existing
  table touched (golden rule 2). The pure banding + perk model is `src/donors/fulfilment.ts`
  (`bandForMonthlyAmount` maps a monthly gift in pence to a band — below £10/mo is not banded;
  `bandHasPlatinumPerks`; `perksForBand` — every band gets the supporters listing (subject to opt-in)
  + our newsletter, platinum additionally the social thank-you, digital badge and certificate). All
  perks are **£0-value recognition perks**, so nothing here affects the HMRC Gift-Aid benefit cap.
  No pool/config/clock, so it is unit-tested DB-free (`test/unit/fulfilment-model.test.ts`).
  **TASK-206** adds the nullable-unique **`token`** column (additive migration
  `1783964039569_add-fulfilment-token.js`) for the per-business secure thank-you link, the pure
  `fulfilmentBandFor` gate (banded **only** for a business monthly gift ≥ £10/mo — `donor_type`
  `company` **OR** a partnership/sole trader with a non-empty `business_name`), and the DB layer
  `src/db/fulfilment.ts` (`ensureFulfilmentRecord` — idempotent `ON CONFLICT (donor_id) DO NOTHING`,
  returns `{ id, created }` so the caller knows whether it actually inserted vs hit the conflict;
  `getFulfilmentByToken`). The Stripe webhook **creates** this record (band + a `randomUUID()` token)
  on a business monthly gift, inside the donation's transaction, and audits `fulfilment.created`
  **only on the newly created row** (a redelivered/reprocessed conflict never re-audits).
  **TASK-213** closes the loop: right after commit the webhook **best-effort emails the new business
  supporter their thank-you invite** — the branded, app-built email (`src/business/invite-email.ts`,
  mirroring the `src/thank-you/letter.ts` shell) carrying the private link to
  `/business/thank-you?token=…` (without it that token-gated page is unreachable). Sent **once**, only
  on the newly created record and only when the business has an email, on the env-correct
  `PORTAL_BASE_URL` base, From/Reply-To `GIVING_FROM_EMAIL`, via the relay's existing `thankYou: true`
  passthrough (`sendBusinessSupporterInvite` — **no relay change / redeploy**). A failed/late send
  never fails the webhook (the record + token are already committed); copy is dash-free and
  impact-neutral ("could help"). Covered by `test/unit/business-invite-email.test.ts`,
  `test/unit/fulfilment-ensure-record.test.ts` and `test/unit/stripe-webhook-business-supporter.test.ts`.
  **TASK-207** adds the **admin API** (backend only — no UI yet): **Editor+** staff (`donations:edit`)
  can **list** every business supporter and their fulfilment state (`GET /api/admin/fulfilments` →
  `listBusinessFulfilments`, each fulfilment row joined to its donor, most recent first, bounded) and
  **mark a fulfilment status** done (`POST /api/admin/fulfilments/:id/mark` with `{ flag }` →
  `markFulfilmentFlag`). The mark is one **audited transaction** (`writeWithAudit`): it sets the single
  boolean true, bumps `updated_at`, and appends exactly one `fulfilment.<flag>` audit row (actor
  `admin:<email>`, entity `business_supporter_fulfilment`). `flag` **must** be one of the five
  allow-listed columns (`certificate_sent`/`certificate_posted`/`badge_sent`/`social_done`/
  `added_to_supporters`) — validated by the pure `isFulfilmentFlag` (and the route's `z.enum`) **before**
  any SQL is built, so no arbitrary column can ever be written (an unknown flag → **400**, an unknown id
  → **404**). Covered by `test/unit/admin-fulfilment-api.test.ts` (auth 401/403, list, mark-flips-and-
  audits, allowlist).
  **TASK-208** adds the **admin UI** on top of that API: a **Business supporters** nav tab (in the
  **Giving** group, `admin.html` view `view-fulfilments`, `loadFulfilments` in
  `assets/js/admin/app.js`) that lists each supporter's fulfilment record — business name (falling back
  to the donor name), recognition band, whether they have submitted their thank-you preferences and a
  compact view of those prefs (credit name, wanted listing/social/badge/certificate + delivery), and
  the five recognition status flags. Each not-yet-done flag is a **mark-done button**
  (`Certificate sent`/`Posted`/`Badge sent`/`Social done`/`Added to Supporters`) that POSTs the flag and
  refetches the list (mirroring the GASDS/Claims refetch-after-write actions); a done flag shows as a
  settled pill and drops its button. The tab is an **Editor+** area: it authenticates with the same
  bearer session as every other admin call (`authFetch`), and is hidden in the nav below edit level via
  a new `data-edit-gate="donations"` attribute on the nav link (honoured by `applyNavFiltering`),
  matching the server's `donations:edit` gate — so a Viewer never sees it. Driven by
  `test/unit/admin-app.test.ts` (jsdom: renders the rows, a mark button POSTs the right flag and the row
  updates) and guarded in `test/unit/admin-shell.test.ts` (nav order + the Editor+ gating wiring). No
  new backend, no new config.

  **TASK-214** backfills the thank-you invite to business supporters who signed up **before** the
  going-forward webhook auto-invite (TASK-213) shipped and so never got their link. The safety
  mechanism is an **invite-tracking** column, **`invited_at timestamptz`** (nullable, no default,
  additive migration `1783980218955_add-fulfilment-invited-at.js` — expand-contract, existing rows stay
  NULL). `invited_at` is stamped `now()` the moment a record's invite is sent: the **webhook auto-invite
  now calls `markFulfilmentInvited(fulfilmentId)` after a successful send** (still inside its best-effort
  try, so a stamp failure never fails the webhook; a *failed* send leaves `invited_at` NULL so the
  backfill catches it later), and the backfill does the same. `markFulfilmentInvited` is idempotent —
  `UPDATE … SET invited_at = now() WHERE id = $1 AND invited_at IS NULL` — so re-running or a webhook
  redelivery never re-stamps. `listUninvitedBusinessSupporters` (`src/db/fulfilment.ts`) returns exactly
  the records that still need one: `invited_at IS NULL` **and** `captured_at IS NULL` (anyone who already
  completed the thank-you page plainly already had the link) **and** a non-empty donor email **and** a
  non-NULL `token`. The orchestrator `runBusinessInviteBackfill` (`src/business/backfill.ts`) is **pure
  over injected seams** (list/send/mark/audit + the env-correct base + from + actor), so it is fully
  DB-free and config-free and reuses the **same** `buildBusinessSupporterInviteEmail` builder as the
  webhook: it walks the un-invited list **sequentially** (dozens of supporters at most; respects the
  relay's rate limits), and for each **best-effort** builds + sends the invite (on `PORTAL_BASE_URL`,
  From/Reply-To `GIVING_FROM_EMAIL`) and **only on a successful send** stamps it invited — one failure is
  counted and never aborts the rest — then appends one `fulfilment.backfill_invites` audit row and
  returns `{ pending, sent, failed }`. The admin trigger is **`POST /api/admin/business-supporters/backfill-invites`**
  (Editor+ / `donations:edit`, same gate as the rest of the tab), surfaced in the **Business supporters**
  tab as a **"Send catch up invites"** button (`backfillInvites` in `assets/js/admin/app.js`) that shows
  the result (e.g. "Sent 12, failed 0"). **It is idempotent — safe to click more than once:** because
  every send is gated on `invited_at IS NULL` and stamps on success, a second run (or a double-click)
  emails no one and reports "Sent 0". No new dependency, no new config key (reuses `PORTAL_BASE_URL` +
  `GIVING_FROM_EMAIL`), and the email relay + money path are untouched. Covered by
  `test/unit/fulfilment-backfill.test.ts` (the idempotent stamp, the un-invited gate, and the
  orchestrator: env-correct tokenised link, mark-on-success, skip/second-run-sends-0, a failed send is
  counted without aborting), the extended `test/unit/stripe-webhook-business-supporter.test.ts`
  (mark-on-success, a failed send left un-stamped, and marking never affecting the webhook), and
  `test/unit/admin-business-invite-backfill.test.ts` (auth 401/403, the counts, and the summary audit).

  **TASK-211** delivers the two platinum recognition artifacts — the **supporter badge** and the
  per-business **certificate** (backend + assets only, no new dependency, no server-side PDF library).
  The **badge is the same for every supporter**, so it ships as one committed static asset,
  `assets/img/nbcc-supporter-badge.svg`: the approved "Option B" emblem (a framed cream card with a
  double maroon border, "We proudly support" in Playfair italic maroon, the real NBCC logo mark, and
  "Night Before Christmas Campaign" in Poppins maroon). It is generated by
  `scripts/build-supporter-badge.mjs` (`node scripts/build-supporter-badge.mjs`), which base64-inlines
  the two brand fonts and nests the NBCC logo's vector paths from `assets/img/nbcc-logo-white.svg`, so
  the result is a fully standalone, razor-sharp SVG a business can drop onto any site. Guarded by
  `test/unit/supporter-badge.test.ts` (the file exists, parses as well-formed SVG via jsdom, carries
  the approved copy, and has no dashes in any text). The **certificate is per business**:
  `GET /business/certificate/:token` (`src/routes/business.ts`, mounted in `src/app.ts` before the site
  catch-all) reads the fulfilment by token (`getCertificateContextByToken` in `src/db/fulfilment.ts` —
  the fulfilment row joined to its donor and that donor's **earliest** `donations.created_at`) and
  renders a self-contained, **print-ready** HTML certificate (the browser prints it to PDF). It gates
  hard: a **404** — indistinguishable from an unknown token — unless the token resolves, the band is
  **platinum**, and **`want_certificate`** is true. The page reproduces the approved `cert.html` design
  (maroon frame, engraved "Platinum Donor" mark, the **business name** — `business_name` falling back to
  `full_name` — as the hero, "Supporting since &lt;Month Year&gt;" from the earliest donation, the body
  copy, Jodie McFarlane's signature block, "Scottish Charity No. SC047995"), with the two brand fonts
  and `assets/img/nbcc-logo.png` base64-inlined so it prints with no network. The render + the pure,
  DB-free helpers (`formatMonthYear`, `certificateHeroName`) live in `src/business/certificate.ts`;
  covered by `test/unit/business-certificate.test.ts` (renders for a platinum opt-in token; 404 for
  unknown / non-platinum / certificate-not-wanted; the Month-Year formatter; name fallback; HTML
  escaping; and a no-dashes-in-copy guard). No dashes appear in any certificate or badge copy.

  **TASK-222** nudges business supporters who have **not yet chosen** how they would like to be
  thanked, with two warm, low-pressure reminders: a **5-day** reminder, then a **14-day** last note.
  The safety mechanism is a new **`reminder_count integer NOT NULL DEFAULT 0`** column (additive
  migration `1784050000000_add-fulfilment-reminder-count.js` — expand-contract, existing rows backfill
  to 0; distinct from the unused TASK-205 `reminder_5_at`/`reminder_14_at` scaffolding): `0` = none
  sent, `1` = the 5-day reminder sent, `2` = the 14-day reminder sent. The DB layer
  (`src/db/fulfilment.ts`) adds **`listSupportersDueForReminder(now)`** — the records due the next
  nudge: `captured_at IS NULL` **and** `invited_at IS NOT NULL` **and** a non-empty email **and** a
  `token`, **and** either (`reminder_count = 0` **and** invited ≥ 5 days ago) → **stage 1** or
  (`reminder_count = 1` **and** invited ≥ 14 days ago) → **stage 2** (the clock is passed in, so it is
  deterministic + unit-testable) — and **`markReminderSent(id, stage)`**, an idempotent advance
  (`UPDATE … SET reminder_count = $2 WHERE id = $1 AND reminder_count = $2 - 1`) so a re-run never
  double-sends a stage. The reminder email is the pure, branded `src/business/reminder-email.ts`
  (`buildBusinessSupporterReminderEmail`, mirroring the `src/thank-you/letter.ts` shell so it carries
  the phone + `giving@` footer): warm + grateful for **all bands** (not just platinum), one crimson CTA
  to the tokenised `/business/thank-you?token=…` page, non-definitive impact ("could help"), **no
  dashes**; the 14-day note is a touch more "last, no pressure" than the 5-day one. It sends via the
  relay's existing `thankYou: true` passthrough (`sendBusinessSupporterReminder` — **no relay change /
  redeploy**). The orchestration `runReminderPass` (`src/business/reminders.ts`) is **pure over injected
  seams** (list/send/mark + the env-correct base + from) like `runBusinessInviteBackfill`: it walks the
  due-list **sequentially** and **best-effort** builds + sends each supporter's stage-appropriate
  reminder and **only on a successful send** advances `reminder_count` — one failure is counted and
  never aborts the rest, and a failed send leaves the count un-advanced so the next run retries it. The
  runner is **`npm run reminders`** (`node dist/scripts/send-reminders.js` — compiled into `dist/`, so
  it runs in the runtime image with no `tsx`/devDeps; `src/scripts/send-reminders.ts` wires the real
  pool + config + senders). A **daily EventBridge schedule** (`infra/modules/app/scheduler.tf`) runs it
  as a one-off Fargate task (`["sh","-c","npm run reminders"]` command override, reusing the app
  cluster / task-def / subnets / task SG / execution role — the same one-off-task shape as the deploy's
  migrations, referencing the task-def by **family** so it runs the latest CI-deployed image). **The
  schedule needs an Infra apply to take effect** (plan on PR, then a manual `apply` via the Infra
  workflow — it does not self-activate on merge). No new dependency, no new config key (reuses
  `PORTAL_BASE_URL` + `GIVING_FROM_EMAIL`), and the email relay + money path are untouched. Covered by
  `test/unit/business-reminder-email.test.ts` (both stages: warm subject, tokenised CTA, single button,
  `could help`, branded shell + footer, name escaping, and no-dashes guards), `test/unit/business-reminders-pass.test.ts`
  (stage-appropriate send, advance-on-success, one failure never aborts, empty-list no-op) and
  `test/unit/fulfilment-reminders-query.test.ts` (the due-gate SQL + clock, row mapping, and the
  idempotent `markReminderSent` guard).

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
the inner join drops any eligible row without a declaration. **TASK-244 (donor-flow audit):** it now
claims the **net** amount — `d.amount_pence - d.refunded_amount_pence` — and drops any gift whose net is
`<= 0` (fully refunded), on both the eligible and the batch path. Gift Aid is claimed on the amount the
charity RETAINED, so a partially-refunded gift that stays `eligible` was over-reclaiming 25% of the
refunded portion from HMRC. **TASK-246** also excludes **overseas (non-UK) declarations** (`dec.non_uk`)
from the export: they store a blank postcode + house name/number, which the CSV builder requires and
THROWS on, so a single overseas donation aborted the ENTIRE batch export — one bad row blocked every UK
claim. They are left out (a scoped follow-up covers claiming overseas donors via HMRC's dedicated
handling) rather than breaking the export. Its results feed straight into the pure `toCharitiesOnlineCsv` above. The thin CLI **`scripts/export-charities-online.mjs`**
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
see **Lapsed-subscription notifications** under the webhook section below. The full renewal-failure
lifecycle is exercised end-to-end through `processWebhookEvent` in `test/unit/stripe-webhook-dunning.test.ts`:
`invoice.payment_failed` with a retry still due (`active → past_due`), with retries exhausted
(`next_payment_attempt: null → lapsed`), `customer.subscription.updated` to `unpaid`/`canceled`, the
recovery of a `past_due` row on `invoice.paid`, and the `dunningFromStripeEvent` mapper across both the
flat and nested (`parent.subscription_details`) invoice shapes.

**Supporters-wall accuracy: cancellations + a grace window (TASK-240).** The opt-in wall (see
**Supporters wall opt-in** under the give widget) kept showing a supporter as long as
`donors.list_on_supporters` was set — even after they had cancelled their monthly gift, because a
voluntary cancel wrote nothing queryable (`customer.subscription.deleted` on a still-**active**
subscription maps to `retries_exhausted`, which is illegal from `active`, so the dunning handler
ignored it). TASK-240 adds a nullable `subscription_dunning.cancelled_at` (migration
`1784300000000_supporter-subscription-cancelled-at.js`, additive/expand-contract); `handleDunning` now
records it — plus a `subscription.cancelled` audit row — in exactly that previously-ignored case, leaving
the lapse path and its emails untouched. **TASK-244** widens this: a subscription can END via
`customer.subscription.updated` → a terminal status (unpaid/canceled/incomplete_expired), not only
`customer.subscription.deleted`, so both now record the cancellation (else a stopped supporter lingered on
the wall). `listPublicSupporters` then computes `monthly_support_ended` per
donor (no still-active monthly subscription **and** the most-recent end — cancel or lapse — older than
`SUPPORTER_GRACE_DAYS`, **30 days**), and the pure `resolvePublicSupporter` drops such a donor from the
opt-in path. **TASK-246** makes the "still-active" check RECOVERY-AWARE: `lapsed_at` is never cleared when
a lapsed subscription recovers (the dunning state machine treats `lapsed` as terminal), so a donor who
lapsed then resumed paying was wrongly dropped. The active-sub sub-query now treats a paid monthly gift
dated AFTER a subscription's end (`GREATEST(sa.lapsed_at, sa.cancelled_at) >= dm.created_at`) as a
recovery, keeping the still-paying donor (`features/supporters.feature` recovery scenario). **Grandfathered
donors (TASK-228) are exempt** — the grace gate is on the opt-in path only, so everyone the old wall
preserved stays. Unit-tested DB-free (`test/unit/supporters-wall-grace.test.ts`
for the drop decision, `test/unit/stripe-webhook-dunning.test.ts` for the cancellation recording), with
the end-to-end grace behaviour in the `features/supporters.feature` grace-window scenario.

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
returns the retention-expiry `Date`, or `null` to retain indefinitely. HMRC's basis is six
years after the **end of the accounting period** the donation relates to (TASK-134); NBCC has
no stored financial year-end, so the accounting period is proxied by the **UK tax year** (ends
5 April) — the six-year window (`RETENTION_YEARS`) runs from the 5 April that ends the tax year
of the most recent claimed donation (slightly conservative, so records are never binned early).
While an enduring / monthly declaration's subscription is active it is retained indefinitely
(`null`); once inactive or cancelled the clock is anchored to the **final claimed charge's
tax-year-end** (`lastClaimedDonationAt` as of cancellation), **not** the cancellation timestamp
— a cancellation long after the last charge cannot extend retention. **Edge
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
  A **business monthly gift** (an incorporated company, or a partnership/sole trader donating under a
  business name) additionally **creates a `business_supporter_fulfilment` record** (recognition band +
  a fresh secure-thank-you `token`) in the **same** transaction, with a `fulfilment.created` audit row
  — the pure `fulfilmentBandFor` gates it and `ensureFulfilmentRecord` keeps it idempotent (TASK-206).
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
  Idempotent by event id. Covered DB-free in `test/unit/stripe-webhook-refund.test.ts`, which drives
  both event shapes end-to-end: a `charge.refunded` (charge id on the object) and a `charge.dispute.*`
  (charge id read from `dispute.charge`, or the dispute's `payment_intent` when Stripe expands
  `charge` to an object), across not-yet-claimed, already-batched, no-matching-donation, and resent
  (idempotent) cases.
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
implements HMRC's post-2019 **relevant value test** on the **annualised donation**: **25% of the
first £100 + 5% of everything above £100, capped at £2,500** (so £120/yr → £26, £1,200/yr → £80).
`deriveBenefitCapBreach({
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

**`POST /api/contact` (REQ-030, storage revised by the 2026-07-10 contact-inbox spec).** Validates a
website enquiry `{ firstName, lastName, email, message }` (the payload `initContactForm` posts,
REQ-027) zod-first — `firstName`/`email`/`message` required, `lastName` optional — rejecting
bad/missing fields with **400**. A valid enquiry is **stored** (`insertEnquiry`, `src/db/contact.ts`)
in the isolated `contact` database and returns `{ status: "sent" }`; a store failure returns **500**.
See **Contact form tab** above for the honest-save front-end behaviour this enables (success shows
only on a real 200) and the admin side (`/api/admin/contact*`) that reads these rows. The former
external form-service forward (`src/clients/contact.ts`, `CONTACT_FORWARD_URL`) is retired from this
path — see the note under **Configuration**.

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

My Story submissions persist to a SEPARATE `stories` database (own name +
credentials, same Postgres server as `charity`, never the main DB — see
`src/db/stories-pool.ts`). Its migration lives in its own `migrations-stories/`
directory, with its own `pgmigrations` tracking table, applied via:

```bash
npm run migrate:stories          # node-pg-migrate -m migrations-stories -d STORIES_DATABASE_URL up
```

Locally this requires a `stories` database + `stories_app` role to exist alongside
`charity` on the same Postgres instance. `docker compose up` gets this for free — a
`docker-entrypoint-initdb.d` script (`docker/initdb/10-stories-db.sql`) creates both
on first container init (only on a **fresh** `pgdata` volume; if you already have one
from before this existed, either run the two statements in that file manually or
`docker compose down -v` to pick it up). Running Postgres another way, create them
by hand: `createdb stories && psql -c "CREATE ROLE stories_app LOGIN PASSWORD
'stories'" -c 'ALTER DATABASE stories OWNER TO stories_app'`. CI creates the database
explicitly in `pr.yml` (reusing the `app` role there — credential isolation is a
staging/production concern, not CI's).

**Staging/production provisioning** (Task B2): Terraform generates the
`stories_app` credential and publishes it as the `STORIES_DATABASE_URL` SSM
parameter (`infra/modules/app/main.tf`), wired through the task definition like
any other secret (`infra/modules/app/ecs.tf`). It can't create the database or
role itself (no `postgresql` Terraform provider, private RDS), so
`scripts/bootstrap-stories-db.mjs` does that imperatively — idempotent
`CREATE ROLE`/`ALTER ROLE`, `CREATE DATABASE`, `GRANT` statements run outside a
transaction (Postgres can't `CREATE DATABASE` inside one), connecting with the
**master** `DATABASE_URL`. Both deploy workflows run it as a one-off
`ecs run-task` (`npm run bootstrap:stories`) right after the `charity` migration
step and before `migrate:stories`, every deploy — safe because it's idempotent.
See `infra/README.md` → "My Story: the separate `stories` database" for the full
walkthrough.

Contact form enquiries (2026-07-10 contact-inbox spec) persist to a THIRD, equally isolated
`contact` database (own name + credentials, same Postgres server, never `charity` or `stories` —
see `src/db/contact-pool.ts`). Its migration lives in its own `migrations-contact/` directory, with
its own `pgmigrations` tracking table, applied via:

```bash
npm run migrate:contact          # node-pg-migrate -m migrations-contact -d CONTACT_DATABASE_URL up
```

Locally this requires a `contact` database + `contact_app` role alongside `charity` and `stories`
on the same Postgres instance. `docker compose up` gets this for free — `docker/initdb/20-contact-db.sql`
creates both on first container init (fresh `pgdata` volume only; `docker compose down -v` to pick it
up on an existing one), and `docker compose run --rm migrate-contact` applies the migration.
Running Postgres another way, create them by hand: `createdb contact && psql -c "CREATE ROLE
contact_app LOGIN PASSWORD 'contact'" -c 'ALTER DATABASE contact OWNER TO contact_app'`. CI creates
the database explicitly in `pr.yml`, mirroring the `stories` setup.

**Staging/production provisioning** mirrors the `stories` database exactly: Terraform generates the
`contact_app` credential and publishes it as the `CONTACT_DATABASE_URL` SSM parameter
(`infra/modules/app/main.tf`), wired through the task definition (`infra/modules/app/ecs.tf`);
`scripts/bootstrap-contact-db.mjs` (`npm run bootstrap:contact`) idempotently creates the role/database
outside a transaction using the **master** `DATABASE_URL`, run as a one-off `ecs run-task` before
`migrate:contact`, every deploy.

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
   builds + pushes the image (tagged by commit SHA, to the shared ECR repo, with
   Docker layer caching via `buildx` + the GitHub Actions cache so unchanged
   base/dependency layers are reused across deploys),
   provisions + migrates all three databases (main, `stories`, `contact`) in a
   **single** one-off `ecs run-task` — one Fargate cold-start instead of five —
   deploys to ECS, smoke-tests `/health`,
   runs **unit + BDD against the live staging URL**, then tags a release.
   Terraform providers are cached (`TF_PLUGIN_CACHE_DIR` + `actions/cache`) so
   `terraform init` doesn't re-download them each run — both deploy workflows.
   On success it also writes a **promotion hint** to the run's job summary — the
   validated image SHA plus the ready-to-run `deploy-prod.yml` command — so you can
   copy the exact SHA straight into the prod promote (below).
   The staging BDD runs `--tags "not @db and not @stub-only"`: `@db` scenarios
   need a direct Postgres connection (staging's RDS is private), and `@stub-only`
   scenarios are happy-path Stripe flows that only pass against the offline stub
   in `src/clients/stripe` (they use fixture data — a preset plan's placeholder
   `STRIPE_PRICE_*`, or the fake `sub_demo_123` — that a live Stripe test account
   has no counterpart for). Both sets are fully covered by `pr.yml`'s BDD.
3. **Promote to production manually** -> run `deploy-prod.yml`
   (**Actions -> Deploy production -> Run workflow**) with the staging-validated
   commit SHA (copy it from the staging run's job-summary promotion hint). It
   deploys the *same image* to production and smoke-tests it.
   Production does **not** auto-deploy on staging success; the `production`
   environment's **required-reviewer approval** gate still applies.

Rollback is automatic: the ECS deployment circuit breaker reverts to the last
healthy task set if a deploy fails its health checks, and a failed smoke/BDD
step fails the run so a bad image never reaches production.

Deploys are tuned to finish quickly: the target group sets
`deregistration_delay = 5` (the default 300s otherwise blocks
`ecs wait services-stable` on the old task draining) and a 10s health-check
interval, both in `infra/modules/app/alb.tf`. These are Terraform changes, so
they take effect only once the **Infra** workflow applies them per environment.

## Configuration

Every config value lives in `src/config/schema.ts` and `.env.example`. Locally
they come from `.env`; in AWS the same keys are SSM parameters that ECS injects
as environment variables, so the app reads `process.env` identically in both.
Secrets are never in code or in the image.

The **Stripe checkout** keys (TASK-037, REQ-028/REQ-029) follow this pattern:
`STRIPE_SECRET_KEY` is a secret (SSM `SecureString`, required, never defaulted);
`STRIPE_PUBLISHABLE_KEY` (TASK-215) is the **public** `pk_…` key the browser needs for
Embedded Checkout — **not a secret**: a plain task-def `environment` value (backed by the
`stripe_publishable_key` module variable, set per env in `infra/envs/*/main.tf`), **not** an
SSM `SecureString` and **not** in the `exec_secrets` IAM policy (it ships to every donor's
browser). It is **OPTIONAL** (may be absent or empty): the app boots fine without it and
**Embedded Checkout stays dormant** — `uiMode:"embedded"` is served as the hosted redirect —
until the key is set (its terraform wiring **applied** and a real `pk_…` value in place),
at which point inline checkout engages automatically with **no code change**. This lets the
code ship ahead of the gated infra apply instead of crash-looping boot. When set, it reaches
the client in the `/api/checkout-session` embedded response, not baked into the static HTML;
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
host as unconfigured and stubs the forward outside production. **Retired from the
live path** by the 2026-07-10 contact-inbox spec — `POST /api/contact` now stores
enquiries instead of forwarding them (see **Contact form tab** above) — the config
value and `src/clients/contact.ts` are left in place, unused, rather than removed.

`CONTACT_DATABASE_URL` (2026-07-10 contact-inbox spec) is the connection string for
the **isolated `contact` database** the public enquiry form and its admin tab read
and write (`src/db/contact-pool.ts`, `contactPool` — never the main `charity` DB or
the `stories` DB). Same treatment as `STORIES_DATABASE_URL`: a required, never-defaulted
`z.string().url()` in the schema (a missing value fails boot), an SSM `SecureString`
assembled with `sslmode=no-verify` and injected via `valueFrom` with its ARN in
`exec_secrets`. See **Local development** below for the local DB/role setup and
`migrate:contact` / `bootstrap:contact` scripts.

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

`NEWSLETTER_FROM_EMAIL` (TASK-161 · REQ-069) is the From **and** Reply-To address stamped on every
admin-newsletter email, so a donor can reply to a real inbox rather than a noreply. **Not** a
secret (it ships in the email headers) — a plain SSM `String` injected via `valueFrom` like
`DECLARATION_FORM_BASE_URL`/`PORTAL_BASE_URL` (its ARN still lives in the `exec_secrets` policy,
matching that pattern), validated as an email address and **defaulted** to
`newsletter@nbcc.scot`, so local dev / CI boot without extra setup. `sendNewsletter`
(`src/clients/email.ts`) POSTs the recipient in `email`, its own `subject`/`from`/`replyTo`, and a
`newsletter: true` discriminator; the relay Worker (`services/email-relay/src/index.js`) has a
dedicated newsletter branch that maps those to a Resend send honouring the per-message `from`/`reply_to`
(other payloads fall through to the fixed `MAIL_FROM`). **Ops prerequisites:** (1) the relay Worker
must be redeployed (`cd services/email-relay && wrangler deploy`) for the newsletter branch to take
effect — one Worker serves both staging and production; (2) `newsletter@nbcc.scot` must be a real
**receiving mailbox** (Resend is send-only) for replies to land, and its domain `nbcc.scot` must stay
verified in Resend.

`GIVING_FROM_EMAIL` (TASK-165 · REQ-069) is the equivalent From **and** Reply-To address for donor
**thank-you letters**, so a donor's reply reaches the giving inbox rather than a noreply. Same shape
as `NEWSLETTER_FROM_EMAIL`: **not** a secret, a plain SSM `String` injected via `valueFrom` (its ARN
in `exec_secrets`), validated as an email and **defaulted** to `giving@nbcc.scot`. `sendThankYou`
(`src/clients/email.ts`) POSTs its own `subject`/`from`/`replyTo` plus a `thankYou: true`
discriminator; the relay Worker's dedicated thank-you branch honours the per-message `from`/`reply_to`.
**Ops prerequisites** mirror the newsletter's: (1) redeploy the relay Worker (`cd services/email-relay
&& wrangler deploy`) so the thank-you branch takes effect (one Worker serves both envs); (2)
`giving@nbcc.scot` must be a real **receiving mailbox** (Resend is send-only) for replies to land, and
`nbcc.scot` must stay verified in Resend. A `DMARC` record on `nbcc.scot` (with SPF/DKIM) is
recommended for inbox placement. The **business-supporter thank-you invite** (TASK-213,
`sendBusinessSupporterInvite`) reuses this **same** `thankYou: true` passthrough with the same
`GIVING_FROM_EMAIL` From/Reply-To, so it needs **no** relay `kind` and **no** extra Worker redeploy —
the relay already forwards its app-built `subject`/`html`/`text` verbatim.

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
