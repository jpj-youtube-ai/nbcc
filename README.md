# charity-site

Containerised TypeScript service on AWS Fargate, fronted by an ALB, with a
Postgres (RDS) database and a couple of external API integrations. A single
production environment, deployed automatically on every merge to `main`
(staging was removed in TASK-312; `pr.yml` is the functional gate).

## What's here

```
src/                 Express + TypeScript app (health, static site, /api stubs, config, db)
migrations/          node-pg-migrate migrations (expand-contract)
test/unit/           Vitest unit tests (DB-free)
features/            Cucumber BDD (.feature + JS step defs)
scripts/             bootstrap-aws.sh, branch-protection.sh (one-time) + smoke.sh
infra/modules/app/   Reusable Terraform module (VPC, ALB, ECS, RDS, secrets)
infra/envs/          Thin env root: production/
.github/workflows/   pr.yml, deploy-prod.yml, infra.yml
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
Donate button, and a mobile burger. Two items are added by the server rather than written into
the files: "Festive Ball" while the ball is published (TASK-326) and "Get involved" (called Events
until TASK-494), after About, while the Events page is switched on (TASK-453).
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
(`assets/img/home-red-bags-handover.jpg`, NBCC volunteers at the Elves' Workshop,
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
| `POST /api/contact` | **implemented** | REQ-030 (contact form — stores to the separate `contact` DB, 2026-07-10 spec; checks a Cloudflare Turnstile pass first whenever the spam check is on, TASK-490) |
| `GET /api/contact/captcha` | **implemented** | TASK-490 (the contact form's spam check: `{ siteKey }`, the public Turnstile site key, or `null` while the check is off; see **A spam check on the contact form (TASK-490)**) |
| `POST /api/fundraise` | **implemented** | TASK-493 (community fundraising sign up; honeypot, per IP limit and Turnstile like the contact form; refused while fundraising is switched off. Shapes: **Community fundraising (TASK-493)**) |
| `GET /api/fundraise/captcha` | **implemented** | TASK-493 (the sign up form's Turnstile site key, or `null`) |
| `GET /api/fundraisers` | **implemented** | TASK-493 (Get involved: approved public fundraisers with their meters; empty while switched off) |
| `GET /api/fundraisers/:slug` | **implemented** | TASK-493 (one fundraiser's page: meter, supporter wall, what giving needs; 404 unless public, raising money, approved or (TASK-502) finished, and switched on) |
| `POST /api/fundraisers/:slug/wall-message` | **implemented** | TASK-502 (the giver's message and wall choices, added from the thank you after paying, tied to the paid Stripe checkout session, once. Shapes: **Community fundraising, giving (TASK-502)**) |
| `POST /api/fundraise/invite` | **implemented** | TASK-503 (the sign up form's invite lookup: `{ token }` from the invite link gives `{ name, firstName, lastName, email }` to fill in (and, for an invite with a type, `path` and `team`: where the form opens), and nothing else; any token that does not work is the same `404`. See **Community fundraising, the team's tools**) |
| `POST /api/fundraise/manage/request` | **implemented** | TASK-501 (emails an organiser a 6 digit sign in code for their private area; always the same answer, sent before looking; was TASK-493's 24 hour link) |
| `POST /api/fundraise/manage/sign-in` | **implemented** | TASK-501 (a right code starts a 2 hour http only session cookie; every refusal the same `401`) |
| `GET /api/fundraise/manage/me` | **implemented** | TASK-501 (the signed in organiser's fundraisers: status, page, QR code, meter, gifts and messages, editable details; since TASK-505 also `requests`, where each thing they asked for is up to, in words) |
| `POST /api/fundraise/manage/fundraisers/:id/edit`, `/finished`, `/pay-in` | **implemented** | TASK-501 (a change that waits for staff; "I've finished"; a Stripe checkout to pay in what they collected. Only their own: anyone else's is a 404) |
| `GET /api/fundraise/manage/thanks` | **implemented** | TASK-507 (the gifts an organiser can thank, as the gifts list shows them, and their thank yous with where each is up to; never an address. See **Thank your supporters (TASK-507)**) |
| `POST /api/fundraise/manage/fundraisers/:id/thanks` | **implemented** | TASK-507 (a thank you for gifts on their own fundraiser; waits for staff, who approve it before NBCC emails each giver) |
| `POST /api/fundraise/manage/sign-out` | **implemented** | TASK-501 (ends the session) |
| `GET /api/fundraise/manage/news`, `POST /api/fundraise/manage/fundraisers/:id/news`, `GET /api/fundraise/manage/news/:updateId/photo` | **implemented** | TASK-506 (the organiser's news updates: theirs listed with where each is up to; a new one, with an optional photo, waits for staff, five a day; their own photo. See **Fundraiser pages: countdown, on the day, and news updates (TASK-506)**) |
| `GET /api/admin/fundraising/news-waiting`, `GET /api/admin/fundraisers/:id/news`, `.../news/:updateId/photo`, `POST .../news/:updateId/approve` \| `reject` \| `hide` \| `show` | **implemented** | TASK-506 (staff check news updates: fundraising view to look, edit to decide; audited) |
| `GET /api/fundraise/manage/pictures`, `POST /api/fundraise/manage/fundraisers/:id/pictures`, `GET /api/fundraise/manage/pictures/:pictureId/photo` | **implemented** | Profile pictures (the organiser's main photo and round photo of themselves: theirs with where each is up to; a new one is made again on the server, nothing from the camera kept, and waits for staff, ten a day; their own picture. See **Community fundraising, profile pictures**) |
| `GET /media/fundraiser-profile/:photoId` | **implemented** | Profile pictures (public; an approved round photo on a page that is up, otherwise 404) |
| `GET /api/admin/fundraising/pictures-waiting`, `GET /api/admin/fundraisers/:id/pictures`, `.../pictures/:pictureId/photo`, `POST .../pictures/:pictureId/approve` \| `decline` \| `remove` | **implemented** | Profile pictures (staff check the photos organisers send: fundraising view to look, edit to decide; audited) |
| `POST /api/fundraisers/:slug/pledges` | **implemented** | Sponsor pledges (public; "Sponsor now, pay after" on a sponsorship fundraiser's page: a promise, never money, and unconfirmed until the sponsor confirms by email. See **Sponsor pledges**) |
| `GET` \| `POST /pledge/confirm`, `/pledge/pay`, `/pledge/cancel` | **implemented** | Sponsor pledges (the sponsor, by the signed link in an email: confirm the pledge, pay it through Stripe Checkout, or cancel it quietly. Each link only asks; a button does the thing) |
| `GET /api/fundraise/manage/pledges`, `POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/cash` \| `hide` | **implemented** | Sponsor pledges (the signed in organiser: confirmed pledges by name, never emails; "Paid me in cash"; hide one from their page) |
| `GET /api/admin/fundraising/emails/summary`, `GET /api/admin/fundraising/emails`, `GET /api/admin/fundraising/emails/:id/:version` | **implemented** | All emails (staff with fundraising view: every fundraising, pledge, ticket and Festive Ball email, listed from one catalogue and rendered with the real builders and invented sample data. Read only: approving stays with the three endpoints that already did it. See **All emails, in Admin > Fundraising**) |
| `GET /api/admin/fundraising/pledges`, `POST` \| `DELETE .../pledges/approvals/:key`, `POST .../pledges/send-pay-links`, `POST /api/admin/pledges/:id/send-pay-link` \| `cancel` \| `message` \| `checked` | **implemented** | Sponsor pledges (staff with fundraising: view to look, edit to act, admin to approve the two emails' wording and to send new pay links to everyone unpaid) |
| `GET /api/fundraise/manage/fundraisers/:id/materials/:piece` | **implemented** | TASK-504 (the signed in organiser's poster, pictures to share, sponsor form or certificate, as a whole print page; only their own, approved or finished, and the certificate once finished; anyone else's is a 404, no session a `401` page, and a 404 while fundraising is off. See **Community fundraising, materials**) |
| `GET /api/admin/fundraisers/:id/materials/:piece` | **implemented** | TASK-504 (the same pages for staff with fundraising: view, for any approved or finished fundraiser whether or not fundraising is on; the certificate as a marked preview before it is finished) |
| `GET /api/fundraise/manage/fundraisers/:id/materials/qr-code` and `GET /api/admin/fundraisers/:id/materials/qr-code` | **implemented** | "Print the QR code": the page's own QR code on one clean A4 page, with the name (or "In memory of ..."), the code 120mm across, the web address in words under it and the charity statement (and the sharing statement, when shared). For a fundraiser or an event that has a page, approved or finished; a 404 for one with no page. From "Print your QR code" in the private area and "Print the QR code" beside the code in Admin > Fundraising (`renderQrSheet`, `src/fundraising/materials.ts`) |
| `GET /api/admin/fundraisers/:id/materials/everything` | **implemented** | TASK-512 (Download everything: every printed piece on one print page, each on its own paper size, plus every picture to share as a zip made in the browser; staff with fundraising: view; approved or finished; the certificate only once finished. See **Community fundraising, materials round two**) |
| `GET /api/admin/fundraisers/:id/scans` | **implemented** | TASK-512 (each printed piece's QR code scans, `{ scans: [{ piece, code, label, scans, link }], total }`, counted once per person per day from the visit counter; staff with fundraising: view; `no-store`) |
| `POST /api/fundraise/manage/fundraisers/:id/print-request` | **implemented** | TASK-512 (Ask us to print these: `{ kind: "posters", a4, a3 }` or `{ kind: "leaflets", a5 }`; the signed in organiser's own, from our own page, 10 an hour; makes the posters or leaflets request To send; `400` with `fields`, `401`, `403`, `404`, `409` too late, `429`) |
| `GET /q/:code` | **implemented** | TASK-512 (a printed piece's own QR code, `/q/<id>-<a4|a3|a5>`: `302` to the fundraiser's page as it is now, found by id, tagged `utm_medium=qr&utm_campaign=f<id>-<size>`; `no-store`, `noindex`; anything else is the site's 404) |
| `GET` and `POST /api/fundraise/manage/:token` | **retired** | TASK-501 (`410`: the 24 hour links no longer open anything; ask for a sign in code) |
| `POST /api/my-story` | **implemented** | Task B1 (My Story submission — persists to the separate `stories` DB) |
| `POST /api/pulse` | **implemented** | TASK-479 (site analytics: a page view, leave or click from `assets/js/pulse.js`, JSON in a `text/plain` body, 2 KB at most; always `204` with an empty body; kept only while collecting is switched on; see **Site analytics (TASK-479)**) |
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
| `GET /api/ball/availability` | **implemented** | TASK-313 (public; Festive Ball seats/tables remaining + whether sales are open. Counts only — never buyer details) |
| `POST /api/ball/checkout-session` | **implemented** | TASK-313 (public; validates the order, holds the seats under a lock, mints a Stripe Checkout session, records a pending booking). TASK-484: takes an optional `replaces`, the inline checkout a fallback to Stripe's own page replaces |
| `POST /api/ball/bank-transfer` | **implemented** | TASK-484 (public; books to pay by bank transfer and answers with the bank details; refused until an admin switches it on) |
| `PUT /api/admin/ball/bookings/:reference/phone` | **implemented** | Booker's phone number (Festive Ball edit; `{ phone }`, empty takes it away. Audited as `ball.booking_phone`, keeping the number it replaced) |
| `GET`/`PUT /api/admin/ball/transfer-settings` | **implemented** | TASK-484 (the bank details and the switch; changing them is admin only) |
| `GET /api/admin/ball/transfers` | **implemented** | TASK-484 (bookings awaiting a bank transfer) |
| `POST /api/admin/ball/bookings/:reference/mark-paid` | **implemented** | TASK-484 (admin only; `{ confirmTotalPence }`) |
| `POST /api/admin/ball/bookings/:reference/pay-by` | **implemented** | TASK-484 (Festive Ball edit; `{ payBy }`) |
| `POST /api/admin/outreach/check` | **implemented** | TASK-354 (Viewer+; what the matcher says about a business, BEFORE anything is committed) |
| `POST /api/admin/outreach` | **implemented** | TASK-354 (Editor+; add a business as a draft. 409 on a business that declined, unless `acknowledgedMatches`) |
| `GET /api/admin/outreach` | **implemented** | TASK-354 (Viewer+; every business on the list, newest first) |
| `POST /api/admin/outreach/preview` | **implemented** | TASK-401 (Viewer+; the invitation rendered through the same builder the send uses) |
| `GET /api/admin/outreach/:id` | **implemented** | TASK-404 (Viewer+; one business and every note written about it) |
| `POST /api/admin/outreach/:id/outcome` | **implemented** | TASK-404 (Editor+; record what happened. An ask-again date is kept only for "not this year", ignored elsewhere. Audited) |
| `POST /api/admin/outreach/:id/notes` | **implemented** | TASK-404 (Editor+; append a note. No edit, no delete, by intention. Audited) |
| `POST /api/admin/outreach/:id/send` | **implemented** | TASK-401 (Editor+; send one invitation. 400 without an email address, 409 if already sent; `sent_at` is stamped only after the send succeeds) |
| `GET /api/admin/ball` | **implemented** | TASK-313 (Viewer+; settings, live availability and money raised) |
| `PATCH /api/admin/ball` | **implemented** | TASK-313 (Editor+ **with the ball section granted**; capacity, held seats, gate, sales window, late-confirmed details. Audited as `ball.settings_updated`) |
| `GET /api/admin/ball/bookings` | **implemented** | TASK-313 (Viewer+; bookings newest first). Also `noPhone`: how many bookings still going ahead (paid, or awaiting a transfer) have no phone number. Clears phone numbers past their date first |
| `GET /ball` | **implemented** | TASK-313 (the ticket page; password-gated until staff open the gate, then public and indexable) |
| `POST /ball/unlock` | **implemented** | TASK-313 (checks the preview password, sets a signed 14-day cookie) |
| `GET /ball/terms` | **implemented** | TASK-313 (ticket terms; gated alongside the page) |
| `GET /get-involved` | **implemented** | TASK-453, renamed in TASK-494 (Get involved: the events from the `events` table, and while fundraising is switched on every approved public fundraiser too. Served only while an admin has the Events page switched on; otherwise falls through to the 404 / spare-address catch-all) |
| `GET /events` | **implemented** | TASK-494 (301 to `/get-involved`, query string kept, whether or not the page is on) |
| `GET /getinvolved`, `GET /involved` | **implemented** | TASK-496 (301 to `/get-involved` too, query string kept: the ways people type it from a poster) |
| `GET /fundraise` | **implemented** | TASK-494 (the fundraising sign up form; a gentle "not open yet" while fundraising is switched off) |
| `GET /fundraise/manage` | **implemented** | TASK-501 (the organiser's private area, signed in with an emailed code; was TASK-494's `?token=` link page; `noindex`, `no-store`, `Referrer-Policy: no-referrer`; 404 while fundraising is switched off) |
| `GET /fundraise/help` | **implemented** | TASK-498 (Fundraising help, a draft for sign off: ideas from A to Z, paying in, Gift Aid, staying safe and legal in Scotland, using our logo; indexed and in the site maps like `/fundraise`; 404 while fundraising is switched off; registered before `/fundraise/:slug`, and `help` is a reserved slug) |
| `GET /fundraise/:slug` | **implemented** | TASK-494 (a fundraiser's own page, drawn on the server; the site's 404 unless public, raising money, approved or (TASK-502) finished, and switched on. `?thanks=1` shows the thank you a giver comes back to after paying; TASK-502: with `&session_id=` it offers the optional step to add to the wall, served `no-store`, `noindex` and `Referrer-Policy: same-origin`; `&added=1` thanks them for it) |
| `GET /fundraise/logos` | **implemented** | TASK-504 (the logo pack: the three official logos to download, simple rules and an example; in the site maps under `/fundraise`; 404 while fundraising is switched off; `logos` is a reserved slug) |
| `GET /fundraise/sponsor-form` | **implemented** | TASK-504 (a blank sponsor form to print, with HMRC's sponsorship and Gift Aid columns and declaration; `noindex`; 404 while fundraising is switched off; `sponsor-form` is a reserved slug) |
| `GET /fundraise/:slug/qr.svg` | **implemented** | TASK-494 (the page's QR code as an SVG to download; 404 wherever the page is) |
| `GET /fundraise/:slug/qr.png` | **implemented** | TASK-504 (the same code as a print size PNG, about 2000px square, as a download; answers wherever the SVG does. Both are drawn once per address and kept in memory, at most 500 of each, oldest out first (`src/fundraising/qr-cache.ts`), and sent with `Cache-Control: public, max-age=86400`) |
| `GET /event/:slug`, `/event/:slug/qr.svg`, `/event/:slug/qr.png` | **implemented** | Event pages (an approved public event's own page, drawn by the fundraiser page's code, and its QR codes; the site's 404 unless public, approved or finished, and switched on. Each prefix answers only for its own kind: `/fundraise/<x>` for an event, or `/event/<x>` for a fundraiser, is a 302 on to its own address, `no-store`. See "Event pages") |
| `GET /media/events/:id` | **implemented** | TASK-453 (public; an uploaded event picture or organiser logo by uuid, `nosniff`) |
| `GET /media/fundraiser-news/:photoId` | **implemented** | TASK-506 (public; a news update's photo by uuid, only once its update is approved on a page that is up, `nosniff`, `max-age=300`; a waiting or hidden one is a 404) |
| `GET /api/admin/events` | **implemented** | TASK-453 (events: view; the page switch and every event) |
| `POST /api/admin/events`, `PUT/DELETE /api/admin/events/:id` | **implemented** | TASK-453 (events: edit; drafts may be half finished, live or scheduled events must pass `publishProblems`. Audited as `events.created` / `events.updated` / `events.deleted`) |
| `PATCH /api/admin/events/settings` | **implemented** | TASK-453 (events: edit **and** the admin role; `{pageOn}` switches the whole page. Audited as `events.page_switched`) |
| `POST /api/admin/events/preview` | **implemented** | TASK-453 (events: view; the card and the whole page as HTML documents, from the same renderer as `/events`) |
| `POST /api/admin/event-images` | **implemented** | TASK-453 (events: edit; base64 upload, raster only, 2 MB, returns `/media/events/<uuid>`) |
| `GET /api/admin/analytics?days=7\|30\|90` | **implemented** | TASK-482 (analytics: view; every panel of Admin > Analytics for the period and the one before, in one payload) |
| `GET/PUT /api/admin/analytics/settings` | **implemented** | TASK-482 (analytics: view / edit; `{collecting}` switches counting on or off. Audited as `analytics.collecting_switched`) |
| `GET /api/admin/analytics/now` | **implemented** | TASK-482 (analytics: view; `{collecting, people}`, the light read behind "Check again") |
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
| `POST /api/admin/business-supporters/:id/send-invite` | **implemented** | TASK-431 (`business-supporters:edit`; sends the catch-up invite to **one** supporter — the same `runBusinessInviteBackfill` given a list of one, so same builder/send/stamp/idempotency; the read applies the bulk gate plus `f.id = $1`; already-invited returns `alreadyInvited: true` rather than an error; `fulfilment.send_invite` audit against that supporter) |
| `GET /api/admin/fulfilments/:id/history` | **implemented** | TASK-436 (`business-supporters:edit`; the audit rows for one supporter, newest first, for the detail panel's History section — reads `listAuditLog({entity, entityId})`, so the audit log stays the single record and nothing is denormalised onto the row) |
| `POST /api/admin/fulfilments/:id/calls` | **implemented** | TASK-491 (`business-supporters:edit`; strict body `{ note? }`, up to 500 characters, blank counts as none; records a thank you call at the server's time with the caller as `called_by`, audited `fulfilment.called` in one transaction; unknown id → 404). The list route now also returns `phone`, the last call, `supporting`, `supporting_since`, `callDue` and `callDueOn` per row |
| `PUT /api/admin/fulfilments/:id/phone` | **implemented** | TASK-491 (`business-supporters:edit`; strict body `{ phone }`; digits, spaces, `+ ( ) -`, up to 40 characters and at least 7 digits, or empty to remove; audited `fulfilment.phone` with the number it replaced; bad number → 400, unknown id → 404) |

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
_Centered · Logo + title · Hero banner · Slim strip_), reordering, duplication and deletion. Each
text-bearing block also carries a **text size step** (TASK-248) — an `A− / A+` pair that shifts that
block's text along the newsletter's own size ladder (`10 · 12 · 13 · 14 · 15 · 16 · 18 · 20 · 22 · 24
· 26 · 28`, the sizes the variants already use), stored as `block.size` (`-2..+2`, default `0`) and
applied server-side by `applySizeStep` at the single `renderBlock` dispatch — so the preview, the
saved `body_html` and the per-recipient send can never disagree. It is a **step, not a pixel value**:
it stays on the designed scale, clamps at both ends rather than inventing sizes off it, moves every
element in a block together (a story's heading stays above its body), and — being relative — still
means something when a block is reused via a saved template. `size` is absent/`0` on everything
written before TASK-248, which renders byte-identical. **rawHtml** (the author's own HTML is never
rewritten), **masthead** (the brand signature; its variants already span 16→26px) and
**divider/image** (no text) take no step — `NO_SIZE_STEP` in `src/newsletter/blocks.ts` is the
authority, mirrored by `NL_NO_SIZE` in the builder.

**Bold, italic and line breaks in prose, and what a paste keeps (TASK-253, TASK-469).** The four prose
boxes (Text, Greeting intro, Story body, Spotlight quote) are plain text carrying two markers the server
turns into emphasis, `**bold**` and `*italic*`, which the **B** / **I** buttons above each box write
(TASK-253). Their line breaks reach the email as well (TASK-469). `proseHtml` turns a newline into `<br>`
and a blank line into a paragraph gap (`<br><br>`), after escaping, so `<strong>`, `<em>` and `<br>`
remain the only tags an author's text can produce. Until then, a second paragraph ran straight on from
the first, because mail clients collapse a raw newline to a space. A **paste** into one of those boxes
keeps the basics. `assets/js/admin/paste-prose.js` turns a highlighted selection (clipboard HTML: a
Claude reply, a social post) or Markdown (Claude's Copy button) into the same markup. Paragraphs, line
breaks, bold and italic come across; a heading becomes a bold paragraph, and a list item a line starting
`• ` or its number. A link keeps only its words: the address behind it is dropped, while an address
written out in the text stays. Fonts, colours, sizes and pictures are dropped, and emoji kept. The
result goes in with `execCommand("insertText")`, so Ctrl+Z undoes a paste, and the selection is set
afresh first so that the paste is its own undo step. Otherwise Chrome folds it into the words typed just
before it, and one Ctrl+Z takes both. Every other box pastes plain text, as before.

**The text boxes grow to fit, with no scrolling inside them (TASK-477).** Every multiline box in the
builder (the four prose boxes, and the legacy raw HTML box) is as tall as its words, so it never shows
a scrollbar of its own: the page grows instead. `nlFitBox` in `assets/js/admin/app.js` sets the height
from `scrollHeight` after resetting it to `auto`, so a box shrinks as well as grows, and its three rows
are the minimum. It runs on every edit (typing, a paste, the B and I buttons, Ctrl+Z), whenever the
canvas is drawn (so a saved draft opens at full height), when the Write panel is shown, and when the
canvas changes width (the window resizing, or a `ResizeObserver` on the canvas), because narrower
boxes wrap onto more lines. A box that is not on screen, such as one in a folded block, measures
nothing and is fitted when it shows. `admin.css` hides the inner scrollbar and the drag handle.

**Deleting a newsletter (TASK-252, hardened by TASK-258).** `DELETE /api/admin/newsletters/:id`,
**Admin only**. A **draft** (never went anywhere) is really deleted, through `writeWithAudit` so the
deletion and its `audit_log` row commit atomically. A **sent** newsletter is **immutable — a permanent
record**: the server answers `409`, the UI renders no delete control on it at all, and the db function
that could redact one (TASK-252's) was **removed, not disabled** — immutability by absence. Rationale:
a sent campaign is what the charity produces when trustees, complainants or the Fundraising Regulator
ask *"what exactly did you send?"*, and the stored content carries no donor data (names merge per
recipient at send time), so privacy never required deleting it. Rows redacted before the reversal keep
their `redacted_at` label and honest "Content deleted" display.

**Sign-off block (TASK-251).** The letter-style close a newsletter ends on — a closing line, the
signer's name, a line under it, and a contact email:

```
With love and gratitude,
Jodie McFarlane                 <- signed in NBCC's hand
On behalf of everyone at NBCC
info@nbcc.scot
```

The name is set in **the same script hand the thank-you email signs with** — `SCRIPT` is exported from
`src/thank-you/letter.ts` and **imported** by the block renderer, never copied, so the two can't drift
(change it there and the newsletter follows). It is a stack of *system* script faces ending in
`cursive` (Snell Roundhand → Palace Script MT → …) with **no webfont**, which is precisely why it
survives a mail client. Two variants (left / centred); every line except the name is optional and is
simply omitted when blank. It takes a size step like any other text block.

The signer is picked from **`AdminHelpers.SIGNERS`** — the single list of who can sign for NBCC. The
thank-you letter's `#tySigner` picker is built from the same list (it used to be hardcoded `<option>`
tags), so adding or removing a signer updates both; a name saved before someone left the list is kept
as an option rather than silently re-signed, because an old newsletter must keep saying who signed it.

**Saved templates (TASK-249).** A **shared library**: any Editor can save the newsletter they are
building as a reusable template (`Save as template` → name it), and any Editor can start a new
newsletter from one (`Saved templates` → _Start from this_). A template is just a stored block
document, so it inherits every block feature — including the size step, which is *relative* and so
still correct on next month's copy. Over `newsletter_templates` (`id`, unique `name`, `body_json`,
`created_by` → users `ON DELETE SET NULL` so a template outlives its author, `created_at`), one
brand-new additive table. Editor+ throughout, matching the rest of the tab:
`GET/POST /api/admin/newsletter-templates`, `GET/DELETE /api/admin/newsletter-templates/:id` — its
**own** path, not `/newsletters/templates`, which `/newsletters/:id` would capture as an id. Saves are
parsed with the same `newsletterDocSchema` the newsletter itself uses, so a template can never be a
document the renderer would reject. The name is **unique** (a shared library needs one "Christmas
Appeal"); a clash is a **409** the UI explains rather than an error dump. Starting from a template
seeds a **new** newsletter (no id) and is `confirm()`-guarded because it replaces the canvas; deleting
is guarded too, because it removes it for the whole team. The picker stays hidden until the library
has something in it. Note the neighbouring **`Start from example`** button is a different thing: it
loads the built-in showcase covering every block type (it was called _Start from template_ until
TASK-249, when one word started meaning two things). The
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
circular phone/envelope/social icon chips. The newsletter's chips hold **hosted PNG `<img>`s**
(`assets/img/email-icon-*.png`, cream-on-transparent at 3x, the `LOGO_URL` absolute-URL pattern —
TASK-266): they were inline SVG, but Gmail strips `<svg>` while keeping the styled chip span, so
recipients saw empty rings. Each footer contact is an **explicit cream-coloured `<a>`** (`tel:` / `mailto:` /
the site URL) so mail clients and the preview iframe don't auto-link the bare text into blue. A newsletter is stored as a JSON **block
document** (`{ blocks: [{ type, variant, data }, …] }`) in the `newsletters.body_json` column
(nullable — legacy raw-HTML drafts from before TASK-168 keep `body_json` `NULL` and hydrate into a
single `rawHtml` block in the builder). One pure renderer, `renderNewsletter` in
`src/newsletter/blocks.ts` (brand tokens/frame in `src/newsletter/theme.ts`), compiles a block
document to a brand-inlined HTML email — the **single source of truth** behind the live preview,
the `body_html` saved alongside every draft, and the send. The frame (TASK-264) wraps the cream
card in a **maroon border on every edge as part of the 660px card itself** (outer maroon cell,
12px padding — the thank-you letter's cream-card-on-maroon look): body background alone shows no
frame in Outlook (which ignores it) or in the composer preview iframe (exactly card-width). The
composer's preview wrapper ground is maroon to match, so the scrollbar gutter reads as frame, not
as an uneven white strip. Reads and drafting are **Editor+**:
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
visible while composing. Clicking it hits the public `GET /unsubscribe/<token>` route, which since
TASK-297 **asks before it acts** — it renders a confirmation page whose button `POST`s back, and the
`POST` is what flips that donor's `email_consent` to `false` (idempotent). Legacy
raw-HTML rows (unframed) still get the standalone footer from `buildNewsletterHtml`. From and
From is `NEWSLETTER_FROM_EMAIL` and Reply-To is `NEWSLETTER_REPLY_TO_EMAIL` — two different
settings since TASK-298 (see **Configuration**). The From is sent as
`NBCC Newsletter <address>` (`newsletterSender`, TASK-268) so the inbox shows the charity's name,
not a bare address. Text links in the email are underlined (footer contacts and link-style
buttons; pill/solid buttons stay clean — TASK-268). A single failed send is logged and does
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

**Hosted documents (TASK-263; formerly "attachments", TASK-193).** A draft newsletter can carry
uploaded documents — a certificate, an order of service — which are **hosted and linked, never
attached to the email** (the relay never forwarded attachments; a link also keeps deliverability
clean, mirroring the thank-you letter). Bytes stay in the `newsletter_attachments` table (migration
`1783763395350`, cascade-deleted with a deleted draft; a sent newsletter is immutable, so its links
live forever), validated by the pure `validateAttachment`
(`src/newsletter/attachment-validation.ts`: a document/image allow-list, **10 MB** cap).
`POST/GET/DELETE /api/admin/newsletters/:id/attachments[/:attId]` (Editor+, draft-only) manage them
from the **Documents** panel on the Newsletter tab (shown once the newsletter is saved, hidden in
read mode); each row's **Insert button** appends a standard `button` block linking the document's
public viewer page (`AdminHelpers.documentButtonBlock` pins the href/label shape). The upload path
has its own `express.json({ limit: "15mb" })` in `src/app.ts` (TASK-265, mirroring the
newsletter-images 3mb parser): the 10 MB document cap is ~13.7 MB base64-encoded, and under the
global 100kb default the parser 413'd any real file before auth ran — the composer's bare
"Upload failed". Two
unauthenticated routes serve recipients (`src/routes/newsletter-documents.ts`; the random uuid is
the capability, the newsletter-images trust model): `GET /newsletter/document/:id` — the branded
viewer page (`src/newsletter/document-page.ts`, pure) with an inline preview (PDF/images) and
open-print/download actions — and `GET /newsletter/document/:id/file` — the bytes, `inline` by
default, `attachment` with the original filename under `?download=1`, served with `nosniff` (+ a
sandboxing CSP for non-PDF types) and immutable caching. `sendNewsletter` no longer has an
`attachments` field.

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
`src/newsletter/image-validation.ts`).

**The composer shrinks a picture before it uploads it (TASK-300).** A newsletter image is displayed
at most 580px wide, so `nlShrinkImage` redraws anything larger through a canvas at **1200px** on its
longest side (`nlFitWithin`, pure and unit-tested) and re-encodes at quality 0.82 — keeping PNG as
PNG so transparency is not filled black, and never touching a GIF, which a canvas would flatten to
one frame. A 6 MB phone photo becomes a few hundred KB, so the 2 MB cap stops being a wall and
becomes a backstop. If the browser cannot decode the file, the original bytes are sent unchanged.

Why it was built: uploading an ordinary phone photo used to do **nothing at all**. Photos are
3–12 MB; base64 costs four bytes for every three; the parser cap on that route was 3 MB, so anything
over roughly 2.2 MB was refused by express *before* the handler ran. Express answers its own 413 with
an HTML page, the composer called `r.json()` on it, that threw, and the promise chain had no
`.catch` — so the rejection was swallowed and the picture simply never appeared. Even the cases that
*did* reach the handler wrote their error into `#newsletterMsg`, which lives inside the Send panel
and is hidden while you are writing. Two layers of silence on top of a cap real photographs exceed.

Three things changed, and each is pinned by `test/unit/newsletter-image-upload.test.ts`: the parser
limit is now `IMAGE_JSON_BODY_LIMIT`, exported from `image-validation.ts` **beside** the image cap it
has to clear (so the two cannot drift apart again, and an oversized upload reaches our validator and
comes back as JSON we can display); the image field reports inline, next to the button that started
it; and every failure path — including a non-JSON body and a dropped connection — is caught.
`nlRenderItems` also honours `kind` now, so the two-up story style offers the same upload control as
every other style instead of a bare text box.

The bytes are stored in the `newsletter_images` table
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

**Archive, not delete, on the public-form pages (TASK-311).** Three stories were permanently
deleted from production and nothing in the system could say what had gone, when, or why - only that
the table was empty. There is no automatic purge in the code, so a person pressed a button and the
rows ceased to exist. That is too sharp an edge for the everyday action on a page of supporters
stories and messages.

**Archive** is now that everyday action, on both Stories and Contact. It sets `archived_at`, hides
the record behind an Archived filter, and is undone in one click. Nothing is destroyed. Archived
records persist indefinitely - which makes this a stronger protection for form submissions than any
backup window, since it survives without needing a restore.

**Erasure is still possible, and deliberately harder.** A charity must be able to honour a GDPR
erasure request, and the Stories page exists partly to withdraw a story if consent is revoked. So
`DELETE` remains - behind two gates:

- the record must **already be archived** (409 otherwise), so the routine tidy-up cannot reach it;
- a **reason is required** (400 otherwise).

A tombstone is written to `erasure_log` **before** the row is destroyed. If the process dies between
the two, a record of an erasure that did not happen is noticed and corrected - whereas an erasure
with no record is precisely the silence this exists to prevent.

**`erasure_log` must never hold the erased content**, or the person’s name, email, phone or town.
Kind, id, when, who, and a typed reason - nothing else. An erasure that quietly kept a copy of the
personal data in another table would not be an erasure; it would be a compliance failure wearing an
audit trail’s clothes. It lives in the MAIN database on purpose: stories and contact each have their
own, and a log kept beside them would be destroyed by the very thing it exists to outlive. Since
TASK-475 an erased story also leaves a one way fingerprint in the stories database's
`erased_stories`, so the old website's export can never bring it back (see **Erased stories stay
erased** below).

Which rows a view shows is decided by `src/admin/archive-filter.ts` (pure, unit-tested) rather than
a WHERE clause typed into each query - an archived record leaking into the working list makes the
feature pointless, and a live one hidden from it looks exactly like the data loss being fixed.
Anything unrecognised means the **live** view, because that is the one somebody is looking at when
they are trying to get something done.

Production backup retention also rose from **5 to 35 days** (the AWS maximum for automated backups)
in the same task: the 5-day window had already closed by the time this was noticed, which is the
argument. Longer than 35 days needs AWS Backup with its own retention plan - not yet built.

**Stories diagnostics (TASK-308).** `GET /api/admin/diagnostics/stories` (Editor+, read-only)
answers one question: where the My Story submissions actually are.

It exists because the Stories tab showed **No stories yet** - the EMPTY state, not the error state.
That distinction is the whole diagnosis: the query reached a database and found a `stories` table
with no rows in it. An absent table would have errored. Schema present, data absent, which is what a
freshly-created database looks like rather than a broken one.

Every deploy runs `bootstrap:stories`, which creates that database **if missing** and builds its
schema - normally a no-op. But if the database name or credentials ever changed, the bootstrap would
have made a new empty one and pointed the app at it, while the original sat alongside it untouched.
So the endpoint reports `current_database()`, the row count, the applied migrations, and **every
database on the same server with its size**, largest first. An orphaned copy shows up as a database
nothing is connected to that is markedly larger than empty.

It is strictly SELECT-only and returns names, counts and sizes - **never story content**. The
separate stories database exists so submissions stay behind the consent model, and a diagnostic must
not become a way around it; a BDD scenario asserts the response carries no story text, and another
that a Viewer gets 403.

**Stories from the old website (TASK-461).** The old website's My Story form has its own CSV export.
On Admin → Stories, editors and admins open **Add stories from the old website**, choose that file,
and see what it would add (who, when, the start of each story and its consents) and what it would
leave out, each with the reason; nothing is saved until **Add**. `POST /api/admin/stories/import`
(`stories:edit`, its own 3 MB body limit) takes `{ csv, commit }`: without `commit` it only plans,
and with it the server plans again (never trusting the browser's copy) and saves in one transaction
under an advisory lock that looks again inside it. Each story keeps the date it was sent as both
`created_at` and `consent_captured_at`, arrives as New with a note saying where it came from, and is
recognised by that date and its exact words, archived or not, so the same file never adds a story
twice. An email or phone number given counts as happy to be contacted, because the old form asked
for them "just in case you're happy for us to contact you about your story", and the notes say so.
The notes always fit the admin's own limit on notes (`MAX_ADMIN_NOTES_LENGTH` in
`src/stories/schema.ts`, shared with the PATCH route), or staff could never save the story again.
Rows are left out, with a sentence saying why, when the same email (as typed) sent the form again
within the hour (the earlier go is left out even if the later one withdraws consent, and a kept
story's note says an earlier one existed), the story is already here, they agreed to no use of it,
they did not confirm they are over 16, the row has no story or is over 20,000 characters, its date is
not a full date and time with a time zone (or is before 2000, or after the import), or it has more or
fewer answers than the form has questions. A file with a quotation mark that is never closed is
refused whole. Nobody's words are corrected. The mapping is `src/stories/old-site-import.ts` (pure,
`test/unit/stories-old-site-import.test.ts`), and `features/stories-import.feature` runs it against
the stories database. The export holds names, emails and phone numbers, so it only ever travels
through the admin: never the repository, a migration or a workflow. There is no `audit_log` row, as
for every other stories action; the server logs who ran an import and how many it added. The panel
still says to delete the file once the stories are in, because it holds people's contact details.

**Erased stories stay erased (TASK-475).** Erasing a story (`DELETE /api/admin/stories/:id`,
`deleteStory` in `src/db/stories.ts`) now also remembers a one way fingerprint of it, in the same
transaction as the delete: the sha256, in hex, of the moment it was sent and its exact words
(`erasedFingerprint` in `src/stories/old-site-import.ts`), which is the same identity the import
recognises a story by. It goes in `erased_stories` in the **stories** database
(`migrations-stories/1790803772256_erased-stories.js`), which holds only that fingerprint and when it
was taken; a CHECK refuses anything that is not 64 hex characters, so nothing readable can be put
there, and there is no story id. A fingerprint cannot be turned back into the words; it can only
confirm a story somebody already holds. If the fingerprint cannot be written, nothing is deleted.
The import looks the file's stories up by fingerprint (`erasedStoriesAmong`), and again inside its
lock when adding, and leaves each erased one out with the reason "It was erased earlier, so it isn't
added again." A story that is somehow both here and remembered shows as already here. **Stories
erased before this change cannot be remembered** (their words are gone, and `erasure_log` holds only
an id, a date, who and why), so there is no backfill: if one of those came from the old website, the
same file would still bring it back, and it would need erasing again. A later submission from the
same person, sent at a different moment, is a different story and is not blocked. Tested in
`test/unit/stories-erased.test.ts`, `test/unit/admin-stories-import-erased.test.ts`,
`test/unit/erased-stories-migration.test.ts` and `test/unit/stories-old-site-import.test.ts`, and end
to end in `features/stories-import.feature`.

**Public unsubscribe route (REQ-069 · TASK-161 · TASK-297).** `/unsubscribe/:token`
(`src/routes/unsubscribe.ts`, mounted in `src/app.ts`) is the link every newsletter email carries.
The token is a stateless HMAC of the donor id (`verifyUnsubscribeToken`, signed with
`ADMIN_SESSION_SECRET`). **The `GET` asks and the `POST` acts** — they are not the same handler:

- `GET` verifies the signature and renders a confirmation page with a single `Yes, unsubscribe me`
  button that `POST`s back to the same URL. It does **no database work at all**, deliberately.
- `POST` performs the write — a donor token flips `email_consent` to `false` (`unsubscribeDonor`,
  idempotent) and tombstones every list membership for that address; a subscriber token leaves one
  audience only. This is also the RFC 8058 one-click path, so Gmail's and Yahoo's own unsubscribe
  buttons are unaffected and still take effect with no interaction.

Why the split: corporate mail security — Microsoft Defender **Safe Links**, Proofpoint URL Defense,
Mimecast, Barracuda — fetches every link in an incoming email to sandbox it *before* the recipient
sees the message, and click tracking (TASK-295) means that fetch follows a `links.nbcc.scot`
redirect straight to this route. While the `GET` unsubscribed on sight, those scanners silently
removed people who never clicked anything, and nothing in the data distinguished that from a real
unsubscribe. The extra click costs a real reader almost nothing, and costs Gmail's one-click nothing
at all. The wording either side lives in `src/newsletter/unsubscribe-copy.ts` (pure, DB-free), which
pins the tense: the ask is future ("this will stop…"), the confirmation is past ("you've been…").

An invalid or tampered token renders the same page shape with **400** instead of writing anything.
Covered by `test/unit/unsubscribe-copy.test.ts` and the `@newsletter @db`
`features/newsletter.feature` unsubscribe scenarios — including one that asserts a scanner's `GET`
leaves consent untouched.

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
the signatory's title. The email is sent verbatim via Amazon SES
(`src/clients/ses.ts` — the Resend→SES migration retired the relay Worker), honouring the message's
own subject + repliable `from`/`replyTo`. The UI (`admin.html` view `view-thank-you` + the `ty-*`
styles in `assets/css/admin.css` + `assets/js/admin/app.js` `loadThankYou`) shows **Send** only to
Editor/Admin (the server enforces regardless). Proven by `test/unit/thank-you-letter.test.ts` and
the `@thankyou @db` `features/thank-you.feature` send/history/role scenarios.

**Thank-you from-address, deliverability + printable-letter page (REQ-069 · TASK-165).** Three
follow-ons to the tab above. **(a)** Thank-yous now send From **and** Reply-To
**`GIVING_FROM_EMAIL`** (`giving@nbcc.scot` — a repliable giving inbox, not a `noreply`; see
**Configuration**), authenticating on the verified `nbcc.scot` sending identity. **(b)** The email now
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
and `@thankyou @db` print-page scenarios. **Ops (historical):** at the time this shipped, the relay
Worker needed a manual `wrangler deploy` — the relay has since been retired (Resend→SES migration);
the `GIVING_FROM_EMAIL` SSM param still needs an infra apply.

**Thank-you CC + delete (REQ-069 · TASK-168).** Two additions to the tab above. **(a)** The compose
form has an optional **CC** field (`ccEmail`) so an admin can copy a colleague on the donor's email;
it is validated as an email when set, sent-time only (not stored), threaded through
`sendThankYou` → the SES `CcAddresses`. **(b)** Each **Sent history** row
(Editor+) has a **Delete** button: `DELETE /api/admin/thank-you/sent/:id` (`deleteThankYouSent`)
removes the row and appends a `thank_you.deleted` audit entry in the same transaction — written
**only** when a row is actually deleted (a missing id → 404, no audit). The append-only `audit_log`
keeps the original `thank_you.sent` entry, so the governance trail records both the send and the
deletion. Covered by `@thankyou @db` delete/CC scenarios (the CC mapping now lives in
`src/clients/ses-request.ts`, pinned by `test/unit/email-templates.test.ts`).

**Supporter ticker (REQ-003 · TASK-178).** An admin-curated list of ongoing supporters (businesses or
people) shown scrolling under the site nav — distinct from the donor-derived Supporters page. The
**TASK-420: it looked broken on some devices and fine on others**, which is the signature of a
platform difference rather than a logic bug. The cause was the reduced-motion fallback, and the
fallback itself is correct: somebody who has asked their device to stop animating things must not
be handed a marquee, so `prefers-reduced-motion: reduce` turns the band into a manually scrollable
strip. What was wrong was how that strip *looked*. macOS and iOS draw overlay scrollbars that stay
invisible until you scroll, so it looked normal there; Windows and Android draw a permanent one
about 15px tall, which inside a 40px band sits under the names like broken furniture.

The viewport now asks for `scrollbar-width: thin` with a `scrollbar-color` from the brand, plus
`::-webkit-scrollbar` at 4px for Safari and Chromium below 121. Measured result: **10px instead of
~15px, cream on maroon instead of grey**. Note that setting `scrollbar-width` makes Chromium
*ignore* the `::-webkit-scrollbar` height, so 10px is Chromium's own "thin" — the 4px rule is
carrying Safari, not Chrome. The scrollbar is deliberately **not** hidden: the viewport has no
`tabindex`, so hiding it would leave keyboard-only users unable to reach the names that do not
fit. `test/unit/ticker-reduced-motion.test.ts` pins both the appearance and the two things that
must not be traded away for it (the animation stays off, the strip stays scrollable).

The comment explaining all this lives in that test rather than in the stylesheet, because
`styles.css` counts against `donate.html`'s enforced first-paint budget, which had only ~1KB of
headroom. Worth knowing: after this change it has **~553 bytes**. The next person to add to
`styles.css`, `donate.html` or `main.js` will need to find room first.

The `supporter_ticker` table (additive migration; `name`, `active`, `sort_order`) is served two ways: the
### Covering the card fee on a donation (TASK-321)

Donors may offer to cover Stripe's fee, the way ticket buyers already can. Two things about it
are load-bearing:

**The fee cover is not a gift, and the code never lets it become one.** It is its own column
(`donations.fee_cover_pence`) and its own Stripe line item, and it is excluded from
`amount_pence`. That matters because:

- **Gift Aid** is claimed on `amount_pence`. Sweeping a fee cover into it would claim tax relief
  on money we are not treating as a gift.
- **GASDS** is judged per donation against a £30 ceiling. A £30 gift with 56p on top must stay a
  £30 gift, or it silently drops out of the small-donations scheme.

The trap is that the webhook records the amount from Stripe's **`amount_total`, which is the sum
of every line item** — so a fee-cover line inflates the recorded donation *by default*. The
checkout stamps `feeCoverPence` on the session metadata and the webhook subtracts it back out.
`donate-fee-cover.test.ts` pins that, and the assertion was confirmed to fail without the
subtraction (£50 recorded as £50.80; a £30 gift as £30.56).

**One-off gifts only.** A monthly gift is charged again every month, so a recurring fee cover
would have to be split back out of every renewal invoice and every later Gift Aid claim. It is
refused server-side for `mode: "monthly"` regardless of what the browser sends, and the control
hides and unticks itself when the donor switches to monthly. Adding it for monthly is a separate
piece of work.

The rate comes from `getCardFeeRate()` — the same `ball_settings` row the ball uses. That row is
named for the ball because that is where it was first needed, but the rate is a fact about the
**Stripe account**, and the donate page is charged the same; one source beats two that drift. A
failure to read it falls back to `DEFAULT_CARD_FEE` rather than taking the donate page down.
`main.js` also hard-codes the rate so the amount can update live as the donor changes their gift;
that is display only (the server prices the charge, and Stripe itemises it before the donor
confirms), and a test asserts it still matches the server default.

### Festive Ball 2026 ticketing (TASK-313)

NBCC sells tickets for **A Night to Remember — Festive Ball 2026** (Sat 7 Nov 2026, The Park
Hotel, Kilmarnock). The Designer Rooms organises and funds the evening; NBCC handles ticketing
and receives every penny of ticket income.

**Capacity.** 40 tables of 10 = 400 seats, all editable. A *table* purchase takes one whole,
unbroken table; individual *seats* pool onto shared tables; held-back seats (comps, sponsor
guests) never go on sale. Sales run down to the last individual seat, so **seats and tables run
out at different times** — 9 free seats spread across a broken table is not a sellable table,
and a caller asking for a table is refused while the page still sells seats. That arithmetic is
pure and DB-free in `src/ball/capacity.ts`.

**Money.** £100 a seat, £1,000 a table, no discount, integer pence throughout
(`src/ball/pricing.ts`). Buyers may optionally cover the card fee and add a voluntary donation.
**Gift Aid applies to the donation only** — HMRC does not allow it on ticket sales, because the
buyer receives a dinner and a show in return.

**The card fee (TASK-317).** Three things about it are deliberate:

- **The rate is 1.2% + 20p**, NBCC's Stripe UK charity rate, confirmed against the account.
  It was hardcoded at Stripe's 1.5% standard rate, so everyone who ticked "cover the fee" was
  handing over about 30p a ticket for a fee that was never charged.
- **It is charged once per ORDER, not per ticket**, because that is how Stripe bills. A table
  of ten is a single £1,000 payment carrying one 20p, so ten single-seat fees would
  over-collect £1.80 and make the checkbox's promise untrue. The page shows the per-ticket
  figure alongside the total (`#ballFeeEach`), which also makes visible that the fee per
  ticket *falls* as the order grows.
- **It is calculated on the tickets only, never on the donation.** Stripe does take its
  percentage on the whole payment, so NBCC absorbs ~1.2% of any donation added here — about
  30p on £25. That matches the rest of the site, which has never asked a donor to pay a
  surcharge on a gift.

The live rate lives on `ball_settings` (`card_fee_percent_bp`, `card_fee_fixed_pence` — basis
points, so no float reaches the database) and is editable in **Admin → Festive Ball → Card
fee**, which takes a percentage and converts. `DEFAULT_CARD_FEE` in `src/ball/pricing.ts` is
only the fallback; `ball.html` also hard-codes the single-seat figure so the form is not blank
on first paint, and `ball-page-copy.test.ts` asserts that figure still matches the default.

The rate reaches the charge through `getAvailability()`, which already reads the settings row
the checkout needs anyway. **It must be passed to `ballMetadata` as well as to the line items:**
the webhook writes the booking row from that metadata, so pricing the line items at the live
rate while stamping the compiled-in default would mean Stripe charging one figure and the
database recording another, invisibly. `ball-checkout.test.ts` pins the two together.

**Overselling.** `claimReservation` (`src/db/ball.ts`) locks the single `ball_settings` row, so
two people going for the last table are serialised and the loser is refused. The reservation
only covers the gap until a `pending` booking exists; from then on the booking holds the seats,
and Stripe's 30-minute session expiry (`checkout.session.expired` → `cancelled`) returns them if
the buyer walks away. No sweeper to fail unattended. Since TASK-484 a pending card booking stops
counting after an hour even if that event never arrives, and a bank transfer booking counts until it
is paid or cancelled (see [Paying by bank transfer](#paying-by-bank-transfer-task-484)).

**One webhook, two products.** Stripe delivers every event to a single endpoint, shared with
donations. `checkout.session.completed` is routed on `metadata.product === "ball"` *before* the
donation handler sees it, so a ticket can never enter the Gift Aid claim pipeline. A BDD
scenario asserts a donation checkout creates no ball booking.

**Tables.** `ball_settings` (singleton: capacity, held seats, the password gate, sales window),
`ball_bookings`, `ball_reservations`.

**The hero lockup (TASK-315).** The `<h1>` on `/ball` is the designer's own "A Night to
Remember / Festive Ball 2026" artwork at `assets/img/ball-lockup.svg` — vector, so it stays
sharp on any screen and matches the printed advert exactly. It replaced a JPEG/WebP crop of the
poster (`ball-lockup.{jpg,webp}` and the `-sm` variants, all deleted). Two things about the
file are deliberate:

- **The gold foil is defined once.** The supplied SVG embedded the same 13 KB PNG texture eight
  times, once per letter of REMEMBER, each clipped to its letter — 105 KB of a 146 KB file. It
  now sits in `<defs>` as `#antr-foil` with eight `<use>` references, taking the asset to 54 KB.
  The rendered pixels are unchanged (verified by rasterising before and after and diffing:
  0 of 2,205,000 subpixels differ).
- **The `viewBox` is retargeted, not the artwork.** The original box was ~30% transparent
  padding, so it is cropped to the content plus a small margin (`235 214 1306 491`). Nothing in
  the drawing was edited.

It is the one `<img>` on the site that is **not** `loading="lazy"`: it is the largest element
above the fold and the LCP candidate, so it carries `fetchpriority="high"` instead. The
perf-budget test only enforces lazy loading on `index/about/donate/contact`, so this does not
weaken that guard. The same file is reused (lazily) in the home-page promo band injected by
`src/ball/home-promo.ts`, where the surrounding band is already the same navy the artwork was
cut out of.

### The sponsor's wordmark (TASK-327)

The Designer Rooms are credited with their own mark in two places: the sponsor band on `/ball`
and the foot of the thank-you page, after someone has paid.

**How the asset was made, and why there are two.** The supplied file is black line art on solid
white with **no transparency**, so dropping it on the navy band would have shown a white slab.
The luminance of that file *is* the artwork, so it is inverted into a coverage mask (black
strokes opaque, white paper clear) and then painted:

- `the-designer-rooms.png` — near-black, for cream backgrounds
- `the-designer-rooms-cream.png` — cream, for the night-sky bands

Both are the same 486x63 trimmed artwork at ~3.5KB. If Ryan ever supplies a vector, replace both
and delete this note; 600px was the largest source available and it is adequate at the sizes
used, not at larger ones.

**Where it is deliberately NOT.** The confirmation email has no images at all, by design — it
never breaks when a client blocks them. Adding the first one for a sponsor logo, which most
clients would hide by default, would weaken a robust email for very little. The sponsor is
credited there in words instead.

In the sponsor band the mark **replaces** the typed name rather than sitting beside it: a
wordmark next to the same words set in our own face reads as a mistake. It sits at 92% opacity,
lifting on hover — present and legible, never louder than the ball's own lockup a few sections
above. It is a guest's mark on NBCC's page.

### A deploy proves what it shipped (TASK-332)

`/health` reports `version`: the commit the running image was built from, stamped in by the
Dockerfile and read through the config schema. The deploy's smoke test asserts that value
matches the commit it just built.

**Why this exists.** On 31 August three consecutive production deploys reported success while
shipping nothing. A partly-applied infra change had removed two required settings from the task
definition, so every new container failed its config check and died; ECS's circuit breaker
rolled back to the previous containers; `aws ecs wait services-stable` then succeeded, because
the service genuinely *was* stable — on the old revision; and the smoke test confirmed
something was answering `/health`, which the old build did perfectly well. Two days of merged
work sat undeployed with every signal green.

The old smoke test asked "is anything alive at this URL?". That is not the question a deploy
needs answered. **A gate that cannot tell "shipped" from "silently reverted" is not a gate.**

Notes on the shape:

- The `ARG`/`ENV` sit at the very END of the Dockerfile. A build arg that changes every commit
  invalidates every layer beneath it, so putting it after the COPYs leaves the cache intact.
- `GIT_SHA` is **defaulted**, not required. Local dev and tests have no build stamp, and this
  value exists to make a deploy honest, not to become a new way for the app to fail to boot.
- `smoke.sh` keeps its liveness-only mode when called with one argument, which is how `pr.yml`
  uses it against localhost.
- The failure message says what a failure most likely means — alive but reporting the wrong
  commit is a rollback — and points at the ECS service events.

**Expect red deploys until an underlying rollout problem is fixed.** That is the intent: a red
deploy that tells the truth is worth more than a green one that does not.

### What the ticket covers, and when it starts (TASK-333)

Arrival reads **"From 7pm, to be confirmed"** and the inclusions read **"Entry to the ball, a
three-course meal, a drink on arrival, and entertainment through the evening. Further drinks
are not included."**

That last sentence is doing real work. "A drink on arrival" reads to plenty of people as
"drinks are provided", and the difference otherwise gets discovered at the bar on the night —
which is both an unhappy guest and, in an advert for a £100 ticket, a claim NBCC could not
stand behind.

**One copy of the sentence, in `TICKET_INCLUDES` (`src/ball/page.ts`).** It necessarily appears
twice at runtime: `ball.html` shows it before the venue confirms a menu, and `page.ts` appends
the menu note to it afterwards. Two hand-written copies of one sentence is exactly the shape
that drifts, and the symptom would be the page saying different things depending on whether a
note happened to be set — which nobody would think to check. `ball-inclusions.test.ts` pins
them together and asserts the menu note is **appended**, so a note about food can never delete
the statement about drinks.

**These are still admin-editable and admin wins.** Once the venue confirms, setting Arrival in
**Admin → Festive Ball → Details the venue confirms later** replaces the estimate in both
places it appears, with no deploy.

### Agreeing to the ticket terms (TASK-331)

Tickets are **non-refundable**, on purchases up to £1,000 a table. Under the Consumer Rights
Act an onerous term has to be brought to the consumer's attention, not merely made findable —
so a link in the smallprint is not enough on its own.

The booking form now carries a **required, never pre-ticked** box immediately above the pay
button, and the label names the non-refundable term itself rather than hiding it behind the
link. The server enforces it with `z.literal(true)`, not a boolean: an absent or false value is
a validation *failure*, because there is no such thing as a ticket bought without agreeing to
the terms.

`ball_bookings.terms_accepted_at` records **when**. The point of that column is the moment it
becomes useful: a dispute months later, where the question is not "were the terms on the site"
but "did this buyer agree to them". It is nullable, because bookings taken before this have no
such record and must not be given a fabricated one.

Photography needed no change — the terms already covered filming, use in NBCC and Designer
Rooms publicity, signage on the night, and telling a volunteer at the welcome desk.

**The age rule is now in that same tick box**, for the same reason the non-refundable term is.
"Over 18s only" sat in the facts list several screens above the card fields, which is not where
somebody entering a card is looking, and being turned away at the door with no refund is exactly
the kind of term the Act expects to be put in front of a buyer rather than left to be found. The
label and `/ball/terms` both now say that anyone who cannot show they are 18 or over will not be
admitted and no refund is given — **paired in the same breath with the way out**, which is that
tickets are transferable and NBCC will move the place to another guest at no charge if told
before the night. A refusal with no remedy is what makes a term unfair; a refusal with a free
transfer beside it is not.

**The fee box asks buyers to "help cover" the card fee**, not to cover it. The figure is grossed
up against Stripe's 1.2% + 20p charity rate, and Amex is 2.9%, so on an Amex the charity is
still fractionally short. The fee has to be quoted before anyone knows which card is coming, so
"cover" is a promise the page cannot keep on every payment and "help cover" is one it can.

**The footer signup now asks for a first name and a surname**, the last single-name field on
the site. `name` is derived from the two, so the stored row, the welcome email and the admin
list all keep reading one field. (Storing the halves, for "Hi Jo" personalisation, is a natural
follow-up and would need a migration on `list_subscribers`.)

### Third staff review: legibility on the dark ground (TASK-330)

Most of this round was one root cause wearing several hats: **things on the night-sky ground
were too faint to see.** `--night-line` was a 22% gold hairline over near-black, which on a
bright screen is not there at all. It is now 42%, and because every dark-ground border on the
page uses that token, one change fixed the hero's fact rules, the panel edges and the rest.

The same problem had made `.btn-ghost-gold` unreadable as a *button* — an outline at 22% next
to a solid gold primary reads as plain text. It now has a full-strength gold edge and a
barely-there fill, so it is obviously pressable without competing.

Other fixes:

- **The booking section now looks like a section.** The shared `.tint` is a gradient from
  `#F8F5EE` to `#F3EEE3` — five units, invisible in practice. `/ball` uses a flat, deeper
  ground with defined top and bottom edges.
- **"Continue to payment" had two arrows.** `.btn::after` in the shared stylesheet already
  draws one; the markup added a second by hand. Worth knowing before adding any button here.
- **The sponsor's wordmark is optically centred, not geometrically.** Its swoosh trails right
  carrying almost no ink, so centring the box leaves the lettering visibly left — measured at
  15px of 486, or 3.1%. A percentage `translateX` holds that at any size.
- **Nav items have a hairline between them**, above the burger breakpoint only. `li + li` is a
  DOM relationship, so the hidden Donate item leaves no stray divider.
- **The sponsor's mark now appears in the hero and on the home band**, not only at the foot.
  Both put the width on a **block-level** `<a>`: on an inline one, `width: min(100%, …)` on the
  image has no definite containing block and the mark silently collapsed (to 82px of 210).

**The preview now shows the nav item.** `ballIsPublished` checked only the gate, so a cookie
holder saw the promotion band on the home page while every nav pretended the ball did not
exist — the thing staff were checking could not be reached from the page they were checking it
on.

### Ball copy house rules (TASK-325)

Two rules the rest of the site already followed and the ball surfaces did not. Both are
enforced by `test/unit/ball-copy-standards.test.ts`, which asserts on **rendered output** and
on HTML with its comments stripped: a comment explaining a rule is not a breach of it, and
testing raw source would fail on its own documentation.

- **Impact is never stated as a fact.** Code of Fundraising Practice: "could help provide...",
  never "£X provides Y". Every amount-to-outcome line on the site already read this way
  (`donate.html`, the live impact map in `main.js`, the business emails). The ball page said
  *"A £100 ticket **helps** NBCC support around two more people"* — the only violation on the
  site, and on a **ticket**, where the buyer also receives a dinner, which makes a stated
  impact harder still to stand behind. Now "could help".
- **No long dashes in anything a reader sees.** NBCC house style, already applied to the
  business emails. 22 of them across the page, terms, thank-you page, both emails, the guest
  page and the home banner were rewritten rather than substituted — most became a full stop and
  a new sentence. Hyphens inside words ("line-up", "step-free") are untouched and deliberately
  not caught.

Also in TASK-325: the date carries a raised ordinal (`7<sup class="ord">th</sup> November`) on
web pages, and a flat "7th November" in emails, meta tags and the Stripe line item, none of
which can carry markup. `.ord` is sized and lifted by hand because the browser default `<sup>`
pushes the line box open, which shows as an uneven gap above any line containing a date.

Michelle McManus has a card of her own (`.ball-host`) rather than a clause inside a paragraph
about the line-up: a named host is a reason to buy a ticket, and set as running text she read
as a detail. It borrows the SHAPE of the practical-bits panel opposite (same radius and padding
rhythm) so the two read as a pair, but takes the page's night palette instead of the cream
card (TASK-328). A dark block in a column of cream prose is the strongest pull available on
that section, which is what a headline booking should have, and it echoes the hero and the
sponsor band rather than introducing a new colour. The venue's short form drops "Rugby Park" — it stays in the full address in the
emails, terms and getting-there copy, where somebody actually needs it to find the place.

**Motion.** The hero entrance runs at 1.7s (lockup 2.2s) and this page's scroll reveals fade
over 1.45s. A quick fade reads as an interface responding; a long one reads as a curtain going
up.

Two things about how that slowness is spent (TASK-329):

- **Long durations, short delays.** These are not the same lever and only one is free. `both`
  fill holds an element invisible until its delay elapses, so a wide stagger was keeping "Book
  tickets" off the screen for over a second while somebody arriving from the printed advert's
  QR code waited on a decoration. The delays were therefore *shortened* (nothing waits more
  than 0.62s) while the fades got longer. Slow to watch, never slow to use.
- **The reveals have a lower ceiling than the hero, and it is a usability one.** The hero plays
  once while somebody is still arriving; a reveal fires every time they scroll to something
  they have decided to read. Their opacity runs 1.45s but the transform finishes in 1.05s, so
  the text stops moving well before it stops brightening, which is much easier to read during. The snow is 180 flakes on a desktop (95 on a phone) and each
flake's size, speed and brightness are derived from **one** depth value, so near flakes are
big, fast and bright and far ones small, slow and faint. That separation as they fall is the
parallax the eye reads as three dimensions, and it is what makes it look like snow rather than
dots moving.

### What the ball page may and may not say (TASK-316)

Three claims on `/ball` are not ours to reword freely, and each is pinned by
`test/unit/ball-page-copy.test.ts`:

- **The line-up is not announced.** The acts are contracted by The Designer Rooms and
  announced on *their* schedule. **Michelle McManus is the only performer who may be
  named** — she is confirmed and cleared. The test asserts the previously-listed acts
  appear nowhere in `ball.html`, comments included: a name parked in a comment is one
  uncomment away from being published.
- **The Designer Rooms is "organised and sponsored by", and linked.** Ryan organises the
  evening *and* pays for all of it; "organised by" alone drops the half that is the reason
  NBCC keeps the ticket income. Every credit links to <https://thedesignerrooms.com/> with
  `rel="noopener"`. The credit is linked once per section, not per mention — the sponsor
  band's large name is the link, and the paragraph under it says "they".
- **The newsletter is called the newsletter.** "Keep me posted about NBCC's work" describes
  a feeling, not a thing you can picture arriving. Both opt-ins (booking form and waiting
  list) name it.

Also settled in TASK-316, from the first round of staff review:

- **The header CTA is Donate, like every other page.** It was a red "Tickets" pill — a
  second call to action for the page you are already reading. The shared
  `@media(min-width:681px)` rule in `styles.css` then hides the `/donate` item in the nav
  list, so there is exactly one Donate above 681px and exactly one in the burger below it.
- **The booking form is centred.** `.section-head` was always centred; the *form* under it
  was flush left in the 1180px wrap, which read as a misaligned heading.
- **The opening line is sentence case.** Set in small letterspaced capitals it read as a
  system label above the artwork rather than a sentence about the evening. `max-width` is
  `60ch` with `text-wrap: balance` so it holds one line on a desktop instead of orphaning
  "lives.".
- **Links on the night-sky bands are gold.** The shared crimson link colour is ~2:1 against
  `#0B1020` — the first thing put on that ground was the sponsor credit we had just
  promised to link properly.
- **Invoicing and large bookings have their own card** (`.ball-invoice`), not the last
  clause of the closing smallprint. The form takes at most `MAX_TABLES_PER_ORDER` tables or
  `MAX_SEATS_PER_ORDER` seats; that limit is now stated next to the quantity dropdown by
  `fillQuantities()` rather than discovered by running out of options.
- **More snow, moving faster** — 115 flakes on a desktop (62 on a phone), roughly double the
  fall speed. Still one canvas, still paused off-screen, still off under
  `prefers-reduced-motion`.

### Names are stored in two halves (TASK-318)

Both ball forms asked for "Your name" in one box, matching nothing else on the site — donate
and contact have taken a first name and surname separately since TASK-226. One box costs two
things: there is no reliable way back out (splitting on the last space makes "Jo van der Berg"
a *Berg* and "Dr Jo Smith" a *Dr*, so any surname-sorted list is wrong for exactly the people
it is most awkward to get wrong), and emails cannot greet anyone properly.

`buyerFirstName` / `buyerSurname` on the booking, `firstName` / `surname` on the waiting list.
**`buyerName` and `name` still exist and are still written** — derived in the Zod schema as
`"First Surname"`, never accepted from the client. That keeps every existing reader (metadata,
confirmation email, guest page, door list, thank-you page) on one field, and means nothing
downstream has to guess where a name divides.

Expand-only: `buyer_first_name` / `buyer_surname` and `first_name` / `surname` are **nullable**
and the old columns are untouched, so bookings taken before this keep their single name with
NULLs beside it. Both fallbacks are deliberate and tested — the bookings CSV puts the whole old
name in the first-name column rather than leaving the row blank (staff still have to find that
person on the night), and the reminder email greets with the whole name rather than splitting
it, which would reintroduce the guess the columns removed.

The guest list is **not** split. A table of ten would become twenty inputs, and those names go
only to a door list and the kitchen — neither needs a reliable surname the way a payer's record
does.

The forms use `autocomplete="given-name"` / `"family-name"`. `autocomplete="name"` on a
half-name box makes a browser offer the whole name for the first field, which is worse than no
autofill at all.

### The booker's phone number (Jaimie 2026-10-03)

The Festive Ball booking form asks **Your phone number**, required, "So we can contact you about
menu choices for your table." It is checked on the page and again on the server (`buyerPhone` in
`purchaseSchema`, `src/ball/booking.ts`) by the same rule as the phone box in Admin > Business
supporters: digits, spaces, `+ ( ) -`, at least 7 digits, up to 40 characters. A card checkout or bank
transfer booking that sends it empty or wrong gets a 400 whose `error` names the phone number and
whose `details` name `buyerPhone`. A request with no `buyerPhone` key at all (a page loaded before
the box existed) is still taken, with no number, so a live booking is never lost. For staff adding a
booking by hand it is optional: they may not have it.

It is stored in `ball_bookings.buyer_phone` (migration `1791200000198_ball-booker-phone.js`: one
nullable column, so bookings made before have none and the old code keeps inserting during a
deploy). It is NBCC's only: never stamped on the Stripe session, never in the door or catering lists.
It appears in Admin > Festive Ball (as a tap-to-ring link), in the bookings CSV (a **Phone** column
after Email) and in the events@ email about a new bank transfer booking. The buyer's own emails are
unchanged.

Bookings with no number are chased by hand; nothing is sent automatically. The admin flags each one
("No phone number yet") and counts the bookings without one, paid or awaiting a transfer, the same
bookings the flag marks. It can show only those, in both lists, and lets
Festive Ball editors add or change the number (`PUT /api/admin/ball/bookings/:reference/phone`,
audited). The ticket terms and the privacy notice say what it is for.

Phone numbers are deleted 90 days after the event, on the same date as guests' dietary details
(`retentionDate` in `src/ball/guests.ts`), by the same purge (`purgeExpiredGuests`), which now also
runs before the bookings list and the bookings CSV are read. The ticket terms say so. On a phone, the bookings table
is now a labelled card per booking, as the bank transfer list already was.

### Paying without leaving the site (TASK-319)

Buyers pay in a modal on nbcc.scot, the same way donors have since TASK-215. The page a
stranger reaches from a printed advert is not the place to bounce them to a different domain
at the moment they are deciding whether to trust it.

The server side already supported this — `ui_mode: "embedded_page"` returns a `client_secret`
instead of a URL, and `/api/ball/checkout-session` returns it alongside the public
`STRIPE_PUBLISHABLE_KEY` when the request asks for `uiMode: "embedded"`. Only the page still
redirected.

**It is deliberately NOT wired into `main.js`'s donate controller.** That controller keeps its
mounted instance in a closure variable `ball.js` cannot reach, so sharing its element ids would
mean the Close button hid the modal without destroying the Stripe iframe, and the next attempt
mounted a second one into the same node. `/ball` therefore has its own ids
(`ballCheckoutModal`, `ballCheckout`, `ballCheckoutClose`) and its own controller, while
**reusing the shared `.give-embedded-*` styles and the same `stripe-js-sdk` script id**, so it
adds no CSS and Stripe.js is fetched at most once. `initEmbeddedCheckout` in `main.js` keys off
`#embeddedCheckout` and so no-ops on this page.

Stripe.js is injected when the page becomes interactive, not on submit — waiting until the
button is pressed adds a network round trip at the most impatient moment.

Three paths, all verified in a browser against stubbed network and Stripe:

| Situation | What happens |
|---|---|
| Normal | `uiMode: "embedded"`, modal opens, Stripe mounts; Close destroys the instance and clears the mount |
| Stripe.js blocked or the mount is missing | Straight to the hosted redirect, never tries embedded, modal stays shut |
| A real refusal (sold out, validation, sales closed) | Shows the actual reason and **does not** retry as a hosted redirect, which would fail again and read as a broken button |

### The home-page banner clears the header with a MARGIN (TASK-322)

`.ball-banner` clears the fixed nav with `margin-top: var(--nav-h)`, not padding. Padding is
inside the box, so the banner's navy background painted **upward behind the header** — and the
home page nav is transparent until you scroll, so the result was grey nav links and the red
NBCC logo sitting on a dark band. Staff spotted it the first time they previewed.

It clears the **nav only**. The partner ticker is also fixed (`top: var(--nav-h)`), but its
height is already reserved page-wide by `body.has-ticker`, so adding it here too would
double-count and leave a cream seam between the ticker and the banner.

Both states are verified: with the ticker the banner starts at 118px, flush under it; without
it, at 78px, flush under the nav. `ball-home-promo.test.ts` asserts the clearance is a margin
and that the `.ball-banner` padding never mentions `--nav-h`.

Worth knowing for any future full-width band added near the top of a page: the home nav is
transparent at scroll 0, so a coloured background that starts above `--nav-h` will show through
it.

### One nav and one footer, everywhere (TASK-326)

**The nav item.** At launch, "Festive Ball" is added to the main nav on **every** page, not
just the home page, and to none of them before. Every clean-URL page is served through a single
`sendFile` loop in `src/routes/site.ts`, so that loop is the one place it needs doing;
`/supporters` is rendered by hand and so needs it separately.

`addBallNavLink` (`src/ball/nav-link.ts`) anchors on the nav **list**, not on a link inside it.
The obvious approach — find the Supporters item and insert after it — quietly puts the item in
the **footer** on `supporters.html`, whose own nav copy carries `class="active"
aria-current="page"` and so does not match, leaving the footer's Explore list as the first hit.
A test asserts the link never lands in a footer on any page.

**Not cached, deliberately.** A TTL cache was the obvious move and it was wrong. It bought very
little (one indexed read of a single-row table, and `/` and `/supporters` already query per
request), and it cost two real things: staff flipping the gate would wait out the TTL before
other pages agreed, and the BDD scenarios set the gate by SQL rather than through the app, so a
stale entry from the previous scenario would fail them at random. The robustness worry a cache
appears to answer is answered better by the fallback: every caller sends the file untouched if
anything throws, so a database outage costs the ball **link**, never the page.

**The footer.** `ball.html` and `ball-terms.html` carried a "Festive Ball" column in place of
"Ways to give". They now use the same footer as every other main page and have joined the
byte-identity group in `footer.test.ts`. Nothing was lost: booking, terms and the events address
all appear in the page body already. The four short-footer pages (portal, privacy, gift-aid,
thank-you) are unchanged, per NBCC.

### Previewing the launch-morning home page (TASK-320)

Staff asked how to see what the front page will look like on launch morning without launching
it. **Unlock `/ball` with the password, then visit `/` — the promotion band appears for you and
nobody else.** The cookie lasts a fortnight and changing the password invalidates it.

For everyone without that cookie the home page is served as the file, byte for byte, so the
ball is absent from the page **source** rather than hidden inside it.

The preview response carries `Cache-Control: private, no-store` and `Vary: Cookie`. There is no
CDN in front of the ALB today, but the entire point of the gate is that this page must not
reach anyone who has not typed the password, and a shared cache is exactly how that would
happen by accident.

"May this request see the ball?" now lives in **one** place, `src/ball/preview-access.ts`
(`holdsPreviewCookie`), used by both `/ball` and `/`. It was previously a private helper inside
the ball router; two copies of a question like this drift, and the copy that drifts leniently
announces an event The Designer Rooms has not announced yet. It **fails closed** — a missing,
forged, expired or unverifiable cookie all mean no, including when the database read for the
password hash throws.

### Holding seats for someone, by name (TASK-324)

**Admin → Festive Ball → Seats held back.** Give a name, how many seats or tables, and
optionally a date to hold until. Editor+ **with the ball section granted** — this consumes
capacity exactly as a purchase does.

It replaces trusting a bare "held back" number. That number recorded nothing about who the
seats were for or until when, so in practice it only ever went up: nobody reduces what nobody
can account for, and by November the room is short of seats no one can explain. The commonest
real case is a company waiting on an invoice — their tables have to be off sale while it is
settled, and back on sale if it never is.

**Expiry is a WHERE clause, not a job.** Nothing has to run for the seats to come back, so a
hold cannot outlive its deadline because a sweeper failed at 3am in November. Leave the date
empty and it holds until someone releases it.

**Placing a hold takes the same lock the checkout takes** (`SELECT … FOR UPDATE` on the
settings row) and re-checks availability having taken it, so a hold and a purchase can never
both be granted the last table. It is judged on **seats** whichever kind is asked for, so
holding four tables when 30 seats remain is refused.

`held_seats` on `ball_settings` still works and is still counted. Total held = that number plus
every active row in `ball_holds`, which is what makes this purely additive: nothing in the pure
capacity model changed, so seats-left, whether a table is still unbroken, and whether an order
can be met all needed no edit. The old number can be retired once the holds it stood for have
been written down properly.

Releasing sets `released_at` rather than deleting: what was held, for whom, and who let it go is
the point of writing it down. Both actions are audited (`ball.hold_created`,
`ball.hold_released`).

### Cancelling a booking (TASK-323)

**Admin → Festive Ball → bookings → Cancel.** Editor+ **with the ball section granted** — the
same bar as changing capacity, because near a sell-out this decides who gets the last table.

The seats come back on their own: availability counts only `pending` and `paid`
(`SOLD_SQL`; since TASK-484 a pending card checkout counts for an hour at most), so the status
change *is* the mechanism. There is no separate "give the seats
back" step to forget.

**It does not refund.** Money moves in Stripe, by a person, deliberately — a button in our
admin that quietly issued refunds would be far worse to get wrong than one that does not. The
confirmation dialog says so explicitly, because "cancel" reads like "undo the whole thing" and
a buyer who is still out of pocket will not agree.

Only a live booking can be cancelled; a second attempt returns 409 rather than pretending, and
an unknown reference returns 404. Every cancellation writes a `ball.booking_cancelled` audit row
with the reference, the seats returned, the previous status and the optional note — the booking
row itself is kept, marked `cancelled`, so nothing is erased.

This is also how you clear test bookings before launch: cancel them and the count returns to
the full room.

### Paying by bank transfer (TASK-484)

A buyer can book Festive Ball seats or tables to pay by bank transfer instead of by card. It was
built in five stages (TASK-484 to TASK-488) from
`docs/superpowers/specs/2026-10-01-ball-bank-transfer-design.md`. **It ships switched off.** The
ticket page offers it only when an admin has entered the bank details and ticked "Offer bank
transfer on the ticket page". Staff can add a booking by hand once the bank details are in.

**For the buyer**
- **The choice:** "How would you like to pay?" (Card, or Bank transfer) appears above the button.
  Choosing bank transfer drops the card-fee offer and changes the button to "Book and get bank
  details". Everything else on the form, including the terms, is the same as paying by card.
- **After booking,** the page and an email (`src/ball/transfer-email.ts`) give:
  - the account name, sort code and account number;
  - the exact amount;
  - the booking reference to use as the payment reference;
  - the date their seats are held until, 7 days on (`TRANSFER_DAYS`).

  The bank details are never in the open availability feed, which only says `transferOpen`.
- **Once an admin marks it paid,** they get the ordinary "You're coming to the ball!" email with
  the line "Your bank transfer has arrived. Thank you." and the link to add their guests. The guest
  link only ever works on a paid booking.
- **Booking again:** a buyer can make more than one transfer booking before paying, at the
  client's request.

**For the team (Admin → Festive Ball)**
- **The bank details** go under Set up → Bank transfer. They live on `ball_settings`, never in the
  code, because the repository is public. Only an admin can change them, and the switch cannot be
  turned on while a detail is missing.
- **Awaiting transfer,** under Where things stand, lists each booking with its amount and pay-by
  date. It can be searched by reference, name or amount, for a payment whose reference was typed
  wrong.
- **Mark as paid** is for **admins only** (the admin role, read fresh on each request:
  `authorizeSectionAsAdmin`). It asks "Has £1,020.00 arrived for BALL-XXXXXX (name)?" and sends the
  amount it showed. The server refuses if that is not the booking's total.
- **Give more time and Cancel** need Festive Ball edit. Cancelling an unpaid transfer booking
  emails the buyer that it was cancelled.
- **Late money:** a transfer cancelled while still unpaid can be marked paid when its money arrives
  after all, but only while its seats are free. Otherwise the admin is told to refund the transfer
  by hand. One that had been paid and was then cancelled (and refunded) cannot be brought back:
  `ball_bookings.cancelled_from` records what each booking was when it was cancelled. Cancelling a
  paid transfer says to refund it from the bank, not through Stripe.
- **The audit log** records each step (`ball.transfer_settings_changed` without the numbers,
  `ball.transfer_marked_paid`, `ball.transfer_reinstated`, `ball.transfer_pay_by_changed`), and
  `ball_bookings.marked_paid_by` says who.

**Seats and money**
- **Seats:** a transfer booking holds its seats until it is paid or cancelled.
- **Money:** it counts towards takings, Gift Aid figures and the ticket report only once it is
  paid, like a card booking.
- **Abuse:** at most 5 transfer bookings an hour from one connection, because a booking holds seats
  for a week and a script could otherwise hold the room. Same-host requests (CI, local development)
  are exempt, as for the admin login. There is deliberately no limit per email address.

**Fixed alongside**
- **Card checkouts hold seats for an hour at most.** If Stripe's "checkout expired" message were
  ever lost, a pending card booking used to hold its seats for good. Its status is left alone, so
  a late "completed" still finds it pending and marks it paid.
- **A payment confirmed after its seats were released is flagged.** If Stripe's "completed" is
  delayed past that hour (an outage, say), the seats may have gone to someone else. The payment is
  real, so it is still recorded. It also writes a `ball.paid_after_seats_released` audit row saying
  whether the room is now over capacity (`overbooked` in `src/ball/capacity.ts`), and logs an error
  when it is, so staff can sort it out with the buyer.
- **The fallback no longer leaves a second booking.** When the inline card payment could not be
  shown, the fallback to Stripe's own page created a second pending booking, and both held seats.
  The page now names the checkout it replaces. The server checks the client secret belongs to that
  session, expires it at Stripe first, which Stripe refuses for one that was paid, and only then
  cancels it.
- **Click handlers attach once.** The Festive Ball screen's tables used to gain another click
  handler on every reload, so one press of Cancel asked once per reload.

**Deadlines (TASK-485, stage 2)**
- **Last day for transfers to arrive.** This is set under Set up → Bank transfer, by admins only
  (`ball_settings.transfer_last_day`). Every new booking's pay-by date is 7 days on, or this day if
  it comes first (`transferPayBy`). After it, the ticket page offers card only, and a booking is
  refused with "Bank transfer has closed. Please pay by card."
- **The reminder.** Two days before a booking's pay-by date, if it is still unpaid, the buyer gets a
  reminder with the same bank details, amount and reference ("Reminder: please pay for your Festive
  Ball booking … by …").
  - It is sent by the daily 8am job (`src/scripts/send-reminders.ts`, via
    `src/ball/transfer-reminder-runner.ts`), once (`ball_bookings.transfer_reminder_sent_at`).
  - It is never sent on the day the booking was made, nor once the date has passed (`reminderDue`).
  - Each booking is claimed before it is sent (`claimTransferReminder` marks it only if nothing has
    yet), so two runs at once cannot both email the same person. A failed send gives its claim back,
    so the next morning's run tries again. One failure never stops the rest.
  - Giving more time clears the reminder, so the new date gets its own reminder two days before it.
  - It still goes when bank transfer has been switched off, because those buyers still owe the
    money. It needs the bank details to be set.
- **Overdue.** Once a booking's pay-by date has passed, the Awaiting transfer list shows it as
  **Overdue**. It also shows **Reminder sent** where the reminder has gone. Nothing is cancelled
  automatically, at the client's choice: staff mark it paid, give more time, or cancel.

**Invoices (TASK-486, stage 3)**
- **On the form.** Once bank transfer is chosen, the buyer can tick "My company needs an invoice".
  - It asks for the company's name and address (both required). The purchase order number, the
    accounts team's email and a phone number are optional.
  - While it is ticked, Gift Aid is taken away and sent as false, because a company cannot make a
    Gift Aid declaration. The server forces this too.
  - The "Booking bigger, or paying by invoice?" card points companies at it once transfer is on.
- **14 days to pay** (`TRANSFER_DAYS_INVOICE`), still capped by the last day for transfers.
- **The invoice** is a private printable page at `/ball/invoice/<token>`
  (`src/ball/invoice-page.ts`, served by `getInvoicePage` in `src/routes/ball-transfer.ts`).
  - Its number is the booking reference.
  - It shows the charity's name, number and address, the company and its PO, the order and the
    total, the bank details and the pay-by date. It says "Not registered for VAT, so no VAT is
    charged." It has a "Print or save as PDF" button.
  - It always shows the booking as it stands: **Paid** once marked paid, and **Cancelled**, with no
    bank details, once cancelled.
  - The link is signed (`src/ball/invoice-token.ts`, with `ADMIN_SESSION_SECRET`), so a booking
    number alone opens nothing. A bad link is "Not found". The page is `private, no-store` and
    `noindex`. Changing `ADMIN_SESSION_SECRET` breaks every invoice link already emailed, as it
    does the thank-you letter links. The Awaiting transfer list always shows a working link, for staff
    to send on.
  - Anything neither unpaid nor paid (cancelled, or refunded) shows as cancelled.
- **Its details** are stored on the booking (`ball_bookings.invoice_company`, `invoice_address`,
  `invoice_po`, `invoice_accounts_email`, `invoice_phone`). They are all nullable; a booking without
  an invoice has none.
- **The emails** link the invoice: the bank details, the reminder, the cancellation and the
  confirmation once paid. The bank details, reminder and cancellation **copy the accounts team**
  when an email was given for them (`invoiceCc`), unless it is the buyer's own.
- **Once paid, two separate emails** (TASK-489, Jaimie's choice). The buyer's confirmation carries
  the private link to add the guests, so it goes to the buyer alone. The accounts team gets its own
  "Payment received: Festive Ball invoice …" email (`buildInvoicePaidEmail`) with the amount and the
  invoice, now marked paid. Each is sent on its own, so one failing never stops the other.
- **Admin:** the Awaiting transfer list shows the company and an **Invoice** link under the buyer.

**Telling the team (TASK-487, stage 4)**
- **An email to events@nbcc.scot** for each new booking (`src/ball/transfer-staff-email.ts`, sent by
  `sendTransferStaffNotice` after the booking is made, best effort). It gives the reference, the
  amount to look out for, the pay-by date, the buyer, the company and its invoice when there is one,
  and a link to the admin. Reply-To is the buyer. Its log kind, `ballTransferStaff`, is staff only,
  so its links are never counted as Email visits.
- **The New pill:** a new transfer booking still waiting for its money lights Festive Ball for
  everyone who can see it, from when it was made (as well as a paid booking, from when it was paid;
  `src/db/whats-new.ts`). Its row in Awaiting transfer carries the pill too.
- **Email audit** names both bank transfer kinds; `test/unit/admin-email-kinds.test.ts` fails if a
  kind the server sends has no name there.
- **The ticket report** says, under Sold, "12 more seats are booked and waiting for a bank transfer
  (2 bookings)" when there are any (`countAwaitingTransfers`). Seats and bookings only: the report
  carries no money. They are counted as sold once marked paid.

**Staff add a booking (TASK-488, stage 5)**
- **Add a bank transfer booking,** under Awaiting transfer, is for phone and email orders. It is
  offered to anyone with Festive Ball edit, and the server requires the same
  (`POST /api/admin/ball/transfer-bookings`).
- **What it asks for:** the order, the buyer's name and email, any donation, and an optional
  invoice. A required tick confirms that the buyer agreed to the ticket terms.
- **The same booking as the ticket page:** one function makes both (`placeTransferBooking` in
  `src/ball/place-transfer-booking.ts`). It has the same prices, pay-by date and invoice, and sends
  the same emails: the bank details to the buyer, and the events@ email, which says who added it.
- **What differs from the ticket page:**
  - **It works before the ticket page offers bank transfer,** once the bank details are entered. So
    staff can take an order, or make a test booking, while the switch is off.
  - **It ignores "Close sales now",** as holds do. It still needs room, and it stops at the last day
    for transfers and once ticket sales close by date (`closedByDate` from `getAvailability`).
  - **No Gift Aid and no newsletter sign-up.** A declaration made over the phone needs its own
    written record, and a sign-up records consent the buyer gave themselves. Both are stored as no.
- **The audit log** records `ball.transfer_booking_added` with who added it.

### Changing the preview password

Staff set it in **Admin → Festive Ball**, not in AWS. `ball_settings.preview_password_hash`
holds a scrypt hash (same `scrypt$salt$key` format as `users.password_hash`); the plaintext never
reaches SQL, the audit log (which records `previewPassword: "(changed)"`) or the API response.
NULL falls back to the `BALL_PREVIEW_PASSWORD` parameter, so nothing breaks before staff set one.

The stored hash is **also the signing key for the preview cookie**, so changing the password
invalidates every cookie issued under the old one — which is what someone changing a shared
password expects it to do. The schema accepts `previewPassword` and deliberately has no
`previewPasswordHash` field: a caller who could set the hash directly would be choosing the
signing key for everybody's cookie.

### The waiting list

`POST /api/ball/waiting-list` (public) and `GET /api/admin/ball/waiting-list` (Viewer+). When the
room fills, the booking form is swapped for a waiting-list form rather than a dead end — there
will be drop-outs before November, and a place released in October is only worth something if
somebody is waiting for it.

Upserts on email, so pressing join twice updates the entry instead of creating a duplicate staff
have to reconcile, and the response says "you're already on the list" rather than implying a
second place was added. Ordered oldest first, because a waiting list that does not run in order
is not a waiting list.

Deliberately **not** gated on availability: if the last seat sells between the page loading and
the form submitting, that person should still be captured rather than thrown away.

The newsletter opt-in is separate, unticked, and normalised through `checkboxValue` before
parsing — `z.coerce.boolean()` reads ANY non-empty string as true, so a stray "off" would
silently opt someone into marketing. Entries carry the same 90-day retention as guest details:
nobody should still be on a waiting list for a party that has happened.

### Which send a delivery event belongs to (TASK-346)

`email_log` originally matched SES delivery/bounce/complaint events to a send by **recipient and
recency** — the newest unmatched row for that address inside a 14-day window. That is wrong the
moment one person has two recent emails, and it picks the *newer* one, so an event for an older
send lands on a newer one and the page shows both outcomes inverted.

That became a live case when TASK-338 started sending a guest-details read-back minutes after a
ticket confirmation: the audit page exists to answer "did their confirmation arrive?", and it
would have answered backwards.

`sendSesEmail` now returns the id SES assigns the message (it was always in the response and was
being discarded), `email_log.ses_message_id` stores it, and the webhook matches on it. The old
recipient-and-recency correlation is **kept as a fallback**, not deleted: rows written before this
shipped have no id, and neither do stubbed sends outside production — a best guess beats no
outcome at all for those.

### The run-up (TASK-338)

Guest names, dietary requirements and access needs come back from **buyers**, and most of a table
of ten is filled in because one person chased nine others. The run-up drives that on a schedule
instead of leaving it to somebody remembering.

**Set the lock date first.** Admin → Festive Ball → *When guest details close*. Until it is set
**nothing is chased at all** — an email asking for names with no date in it is nagging, and it
spends the one message people actually read before there is anything useful to say.

Then, per paid booking:

| When | What | To whom |
|---|---|---|
| On every guest-form save | A read-back of exactly what we now hold | That buyer |
| 14 days before the lock date | "We still need your guest list", with the date | Anyone outstanding |
| On the lock date | Last call | Anyone still outstanding |
| 3 days before the ball | The practical email, with their guests read back | Everyone |

The schedule is pure (`src/ball/run-up.ts`) and unit-tested without a clock or a database; the
wiring is `src/ball/run-up-runner.ts`. It rides the **existing** daily EventBridge task
(`npm run reminders`) rather than getting infrastructure of its own — one more read on a schedule
that already exists, where a second rule would be a second thing to notice had stopped. A failure
in either pass cannot stop the other.

Each stage stamps its own column **only after a successful send**, so a re-run never double-sends
and a failed send is retried tomorrow rather than silently recorded as done. `POST
/api/admin/ball/chase` (Editor+) runs the same pass on demand — anyone already emailed at that
stage is skipped, so pressing the button twice is safe.

Past the lock date the chase stops entirely rather than running to the event: staff work the
remaining stragglers by hand from the outstanding list.

### The ticket report (TASK-464)

Twice a week, on Monday and Thursday mornings (Tuesday until TASK-467), the people running the Ball with us (the organiser,
the sponsor and our own staff) get one email with its ticket numbers: seats sold of 400 and how
full, whole tables and single seats, what sold since the last update and in the last 7 days against
the 7 before, what is still available and kept back for guests, the people still waiting (anyone
already offered a place is not counted) and the seats they want, and the days to go. Counts only:
no names, no booking details, no money. Sold means paid; seats booked to pay by bank transfer and
still waiting for the money get a line of their own (TASK-487). It opens with when the next
update comes and how to reach us (01292 811 015, events@nbcc.scot), comes From and Reply-To
`BALL_FROM_EMAIL` in the Ball's own frame (`ballEmailShell`), and goes as ONE email with everyone
on the To line so they can reply to all: they all work together (Jaimie's call; if the list ever
reaches beyond that group, send separately instead).

It is set up on Admin → Events, in the **Festive Ball ticket report** card under the page switch:
the list (a name and an address each, kept in alphabetical order, up to 10), the switch, **Send a
test to me** (the real email marked "[Test]", to the signed-in person only) and a preview with
today's numbers. Anyone who can edit Events can change it; viewers can look. Both also need at
least view on the Festive Ball, since the numbers are the Ball's (every role has that by default).
It ships switched off, and saving it on with nobody to send to is refused. The routes:
`GET /api/admin/ball-report` (`events:view`), `PUT /api/admin/ball-report` and
`POST /api/admin/ball-report/test` (`events:edit`), each with `ball:view`.
Every save and test writes an `audit_log` row (who was added or removed, and by whom), and the email
log lists each person a report went to.

It rides the daily 8am task (`npm run reminders`) like the run-up, with no schedule of its own:
`runBallSalesReport` (`src/ball/sales-report-runner.ts`) sends only on a Monday or Thursday, UK
time, when switched on, with recipients, up to the day of the Ball. It claims the day first in
`ball_report_sends` (a unique index allows one scheduled report a day), so a second run sends
nothing; a failed send gives the day back, and a send that went keeps it even if recording it then
fails. A failed send is also recorded (`ball_report.send_failed` in `audit_log`, the day only, since
the error can quote an address), and the card says that day's report could not be sent until the
next one goes (TASK-471). Each report records `counted_to`, the moment its numbers were counted to, and the next one's
"since the last update" counts on from exactly there. The numbers (`countSales`) and words are the
pure `src/ball/sales-report.ts` (`test/unit/ball-sales-report.test.ts`), the wiring is tested in
`test/unit/ball-sales-report-runner.test.ts`, and `features/ball-report.feature` covers the admin
API and the numbers against Postgres.

`SesMessage` gained an optional `alsoTo` list for this one email; every other email is unchanged.
Because one email now reaches several people, one SES event can name several: `parseSesEvent`
gives each event's own `recipients` (the bounced, the complainants, the delivered), and the webhook
stamps the email log, records newsletter events and suppresses once per person, so a bounce from
one never lands on, or suppresses, another (`features/email-audit.feature`).

The list is business contacts, kept until someone removes them: once the Ball is over, switch the
report off and remove everyone from it.

### The week-before reminder

`POST /api/admin/ball/reminders` (Editor+ with the ball section). The original staff-triggered
button, kept because it is still the way to send this early or re-send it. Since TASK-338 the same
email also goes out automatically three days before the ball, to anyone who has not had it.

It carries the practical details **and reads back what the booker told us** — guest names,
allergies, access needs. That is the point of it: a coeliac note that never saved is caught a week
out, while there is still time, rather than at the table.

Idempotent by `reminder_sent_at IS NULL`, and each booking is stamped **as it sends**, not in one
batch at the end — so a provider failure halfway through four hundred never re-emails the ones
already done. A single bad address is recorded and skipped rather than thrown, so it cannot stop
the other 399 reminders.

### The three lists

`GET /api/admin/ball/{door-list,catering,bookings}.csv` (Viewer+). Three rather than one, because
they go to different people and that changes what may be in them:

- **Door list** — alphabetical by surname for the welcome desk. Names and tables. No contact
  details: it is printed and left on a desk all evening.
- **Catering list** — for **The Park Hotel**. Food and access notes only. This is the one export
  that leaves NBCC and it carries special category data, so it contains no emails, no booking
  references and no money. The ticket page promises the venue is told nothing else; `cateringCsv`
  keeps that promise in code, with a unit test and a BDD scenario asserting it.
- **Bookings list** — for NBCC's own records and the accountant. Keeps the buyer email, because
  this one stays inside the charity.

`csvCell` prefixes a leading `=`, `+`, `-` or `@` with an apostrophe. Guests type these fields
themselves, so a dietary note beginning `=` would otherwise be executed as a formula by whoever
opens the file.

The door-list and catering downloads purge expired guest rows first, so the ninety-day promise is
kept on the exact path where stale data would otherwise escape into a file, with no scheduler to
forget.

### After payment

`GET /ball/thank-you` — where Stripe returns the buyer the instant payment succeeds.

It shipped in TASK-313 with the checkout pointing at it and **nothing serving it**: a real
payment took the money, recorded the booking and sent the receipt, then landed the buyer on a
404. Every test asserted the success URL was BUILT correctly; none asserted it RESOLVED. There is
now a BDD scenario that requests the path and expects 200.

Two rules follow from when the page is seen. It is **not behind the launch gate** — someone who
has just paid must see confirmation whatever the public page is doing. And it **never reads as a
failure**: Stripe only redirects here on success, so an unknown session id (the webhook can lag
the redirect by a second) still renders "your payment went through", not an error.

A third follows from the same rule and was missed. Both branches used to end on the idea of
paying twice: "check your junk folder **before booking again**", and "email us **before trying
again**". That is the last suggestion to put in front of somebody who has just been charged and
cannot find the receipt, and it invites exactly the double booking the sentence was trying to
prevent. Both now give the two steps in order and name the inbox that will fix it: check junk,
then email `events@nbcc.scot` and we'll sort it out. The no-booking branch also states plainly
that the payment went through and the place is held, since that is the reassurance actually
being asked for.

### Guest details

`GET/POST /ball/guests/:token` — the "tell us about your table" form, linked from the booking
confirmation. **No login:** an unguessable 24-byte token on a *paid* booking is the whole
authorisation, the same idiom as the business certificate. That is a deliberate trade — requiring
an account to report a nut allergy means nobody reports the nut allergy — and a leaked link
exposes one table's names, not money or an account.

**A plain form POST with no JavaScript.** It arrives by email and is opened on a phone, often on
poor signal; there is nothing to fail to load. Saving redirects (303) so a refresh cannot
resubmit, and a partial table is the expected case, not an error — the copy says so, because
otherwise people wait until they know all ten names and we get nothing.

Dietary and access notes are **special category** data. The retention rule lives in the schema:
`ball_guests.expires_at` defaults to 90 days after the event, matching the published ticket
terms, and `purgeExpiredGuests()` deletes on it. `isExpired` fails CLOSED on an unreadable date —
keeping a row too long is untidy, deleting someone's access needs early could mean they arrive
somewhere that cannot accommodate them.

**TASK-409 rebuilt the form around the person filling it in.** Five changes:

- **A first name and a surname**, in two boxes. This was the last single-name field on the site;
  TASK-318 split the buyer's for reasons that apply just as much to their guests. `full_name` is
  still written and still holds "First Surname", so the door list, the CSV exports, the admin
  table and the reminder email's read-back are untouched (expand-only, migration
  `1788200000000`). `surnameOf()` now prefers the stored surname and keeps the last-word guess
  only as the fallback for rows saved before the split, so **"Ali van der Berg" files under V**
  on the door list instead of under B.
- **The hints are labels, not placeholders.** Placeholder text is low contrast by design, is
  thrown away the moment somebody types, and is announced inconsistently by screen readers. On a
  field asking about a disability that is the wrong control. Each hint is visible text tied to
  its input with `aria-describedby`, in the **ordinary body colour** rather than the muted
  small-print grey (`.ball-field .ball-hint`, two classes, because `.ball-field small` is (0,1,1)
  and would otherwise win).
- **The booker is filled in as guest 1**, with a "Not you? Clear this guest" button for a PA who
  booked on somebody else's behalf. The seed only happens when nothing is stored **and** the page
  is not rendering after a save: without that second condition, clearing yourself and saving
  would put the name straight back, which reads as the page refusing to do as it is told.
- **"Table name" became a group name**, with the instruction that makes it work: agree one name
  and have everyone type it identically. That is the whole mechanism. The alternative considered
  was an open "who would you like to sit with?" box, which produces four contradictory partial
  lists somebody has to reverse-engineer into groupings; one agreed name is a column you sort.
  Both kinds of booking get the instruction, because a table booker whose friends bought separate
  tickets needs the coordination most.
- **The closing date is honest.** The page used to say guests could come back "any time before the
  night", which is how a table plan arrives on the morning of the event. It now names
  `guest_details_lock_at` when it is set and says the date is still to be confirmed when it is
  not, which is the state this ships in.

The page keeps its no-JavaScript guarantee. It gained one small **inline** script that reveals the
clear button and empties the two name boxes; it fetches nothing, the button ships `hidden` so a
reader without JavaScript is never shown a control that does nothing, and saving is a plain
submit. `test/unit/ball-guest-page.test.ts` asserts those three things rather than the old proxy
of "no `<script>` anywhere".

`getBookingByGuestToken` also picked up a **fix**: its mapper read `g.menu_choice` but the query
never selected it, so a saved menu choice never rendered back into the form and re-saving without
re-picking would have wiped it. Latent rather than live, since the picker stays hidden until
`ball_settings.menu_options` is set.

**TASK-417: the venue confirmed a menu, and it broke three assumptions.** The menu code was
written in TASK-345 before anybody had seen one.

- **A course with one dish is not a question.** The Park Hotel's starter is fixed: everyone gets
  the soup. Pasted the natural way (`To start: Soup`) that parsed as a course with ONE option, so
  the form asked guests to choose soup from a list containing soup, and counted them as
  outstanding until they did. `choosableCourses` now means "more than one option", and
  `fixedCourses` is its other half.
- **The menu is printed once, above the guests, not inside each fieldset.** A table of ten would
  otherwise repeat the starter ten times. This panel is also the only place a fixed course can
  appear at all: no dropdown mentions the soup, so without it a guest never learns what they are
  eating first. Dish text is rendered exactly as the venue wrote it, dietary codes and all.
- **`ball_settings.menu_note` holds the venue's dietary key** verbatim ("V = Vegetarian, VV =
  Vegan, …"). Its own column rather than a line inside `menu_options`, which is parsed line by
  line as courses: a key pasted in there would render to guests as a course called "Dietaries
  key". Admin saves the menu and the key together, because a menu carrying codes nobody can
  decode is worse than no codes.

**`ball_guests.is_vegetarian` records WHY a guest picked the vegetarian dish.** Both alternative
dishes on the confirmed menu are vegetarian, and the plate reaching a vegetarian looks identical
to the plate reaching someone who simply fancied the wellington. The difference only matters when
it matters: a requirement has to be exactly right and cannot be swapped if the numbers move, a
preference can. The column is **nullable and null is meaningful** — rows saved before this were
never asked, which is a different fact from a guest who was asked and said no. The catering CSV
gains a `Vegetarian` column, and a declared vegetarian now appears on that list even with no
allergy and no choice yet, because they are the guest most likely to be handed the wrong plate.

`test/unit/ball-preview-access.test.ts` was **time-bombed and went off on 15 September 2026**: it
signs a gate token at a hardcoded date and verifies it against the real clock, so every assertion
quietly depended on the suite running within the fortnight TTL of 1 September. Nothing was wrong
in production, where a cookie is signed at the moment it is issued. The clock is now frozen at the
fixture's own date.

**TASK-418: knowing who has chosen, and telling people there is anything to choose.**

`menuProgress()` had existed since TASK-345 **wired to nothing** — no admin view, no chase — so
the day the venue finally confirmed a menu there was no way to answer the only question staff had.
`src/ball/menu-progress.ts` is the per-booking half, modelled on `guest-progress.ts` and kept
separate from it because the two are chased at different times by different emails, and a booking
can be complete on one and not the other. `GET /api/admin/ball/menu-progress` (viewer+) returns
the summary plus the outstanding bookings, each with the buyer's own guest link so staff can chase
directly.

Progress is measured against the guests **named**, not the seats bought: you cannot choose a
dinner for somebody whose name nobody has given you yet, and counting those would blame this list
for a gap the guest-name chase already owns. A booking with no names is therefore complete here
and outstanding there, which is the truthful split. The SQL returns the **raw** `menu_choice`
strings rather than a count, because "has this guest chosen?" means "have they answered every
course that asks" and only the menu knows which those are — counting in SQL would hard-code an
assumption the venue can change by editing a textarea.

**The menu-is-ready email** (`src/ball/menu-email.ts`) prints the menu *in the email*, because
"the menu is ready, click here" is a worse email than one containing it. It carries the fixed
course no dropdown mentions, the dietary key, the buyer's guest link, and **the Park Hotel's
£110-per-room-per-night rate for ball guests**. `ball_bookings.menu_email_sent_at` is the
idempotency, exactly as `reminder_sent_at` is for the week-to-go email: the send query is
`paid AND menu_email_sent_at IS NULL`, and each booking is stamped **as its send succeeds**, so a
provider failing halfway through four hundred never re-emails the ones already done. Its own
column rather than reusing `reminder_sent_at`, because sharing a stamp would mean sending one
email silently disabled the other.

`POST /api/admin/ball/menu-email` is **editor+ with the ball section**, staff-triggered and never
scheduled, and **refuses with a 409 while there is no menu**: an email headed "the menu is here"
carrying no menu would burn the single send each booking gets. `guestLinkFor` now takes
`Pick<GuestProgressRow, "guestToken">` rather than the whole row, since that is the only field it
reads and the menu chase needed the same link off a different shape.

### The admin Festive Ball screen

Under **Content → Festive Ball**. Stats (seats and tables sold, remaining, money taken,
donations, Gift Aid eligible, newsletter opt-ins), the gate control, capacity and the sales
window, the late-confirmed details, and the bookings list.

The gate button says what it will DO rather than what state it is in, and confirms first, naming
the consequence: publishing shows the ticket page to the whole internet **and** puts the ball on
the home page. Write controls are hidden unless `canEdit("ball")`, mirroring the server rule
(editors get view-only on this section by default).

Markup lives in `admin.html`, behaviour in `assets/js/admin/app.js`, joined only by element ids —
nothing type-checks that join, so `test/unit/ball-admin-view.test.ts` walks every id the code
reaches for and proves the markup provides it. It also asserts the block sits INSIDE the module
IIFE: appended after the closing `})();` it parses fine but every helper is undefined at runtime.

#### Finding things in it (TASK-422)

The view had grown to thirteen sections and eight forms in one 7,600px scroll, with settings,
reports and send-buttons interleaved, so there was no way to predict where anything lived. Two
of those buttons email everyone who has paid and cannot be taken back, and they sat mid-page
between harmless settings.

It is now three bands, in the order the job is actually done:

| Band | `id` | What it holds |
|---|---|---|
| **Set up** | `ball-setup` | The gate, preview password, capacity, held seats, card fee, venue details, the menu, the lock date. Everything the ticket page and the emails read from. |
| **Where things stand** | `ball-state` | Bookings, who has chosen a menu, whose guest details are still missing. |
| **Send something** | `ball-send` | The week-before reminder and the menu-is-here email. Last, so you read the numbers before pressing the thing you cannot undo. |

A sticky `.admin-jump` bar of anchor links crosses the view without scrolling it. **Nothing inside
a section changed** — the reorder moves whole blocks, so the risk was silently dropping one.
`test/unit/admin-ball-layout.test.ts` is the safety net: it lists all 65 ids the view had
beforehand *by name*, asserts no duplicates and all eight `<form>`s, and fails by name rather than
surfacing weeks later as a button that does nothing.

**Narrow screens.** `.admin-nav` used to go `position:static` below 760px, so changing view meant
scrolling back up the whole page to reach it. It became sticky at the top as one swipeable line,
with the jump bar riding at `top:52px` beneath it (**replaced in TASK-454**: a line that scrolls
sideways breaks the client's standing rule, so below 860px it is now one pinned Menu button, with
the jump bar at `top:61px` — see [The admin fits a phone](#the-admin-fits-a-phone-task-454)). Three
things had to be true for that to work, each of which failed first:

- `.admin-body-grid` uses `display:block`, not a one-column grid. As a grid the nav gets its **own
  row**, and a sticky element can only travel inside its containing block, so a row exactly as
  tall as the nav leaves it nowhere to go and `position:sticky` silently does nothing.
- `min-width:0` on the nav and its `ul`, or the flex item takes its content width: 18 nowrap
  buttons made the nav 2,071px wide and took the whole page sideways. (History since TASK-454:
  nothing in the menu is nowrap any more, so the rule went with the strip.)
- `.admin-band`'s `scroll-margin-top` must clear **both** sticky bars, not just the nav. At 110px
  the heading you jumped to landed 41px behind the jump bar, so the click read as an overshoot.

That last one is an invariant with no natural guard, so the test asserts it from the CSS at both
widths, and separately checks the comment and brace counts balance — one stray `*/` silently
kills every rule after it, which is how that bug got in.

Two pre-existing overflows were fixed in the same breakpoint, since they made every view scroll
sideways on a phone: the `style="width:420px"` fields are capped (on the label as well as the
field, or `max-width:100%` resolves against a label already sized to its 420px content), and
`.admin-segmented` may wrap. Measured across all 24 views at 375px: no sideways scroll anywhere.

### Every page wears the same shell (TASK-402)

There are exactly **two** page shells, and a new page must use one of them:

- **Boxed** — `<main class="site-main site-main--boxed">`. The `<main>` IS the container: it sets
  the max width, the side padding, and the top padding that clears the fixed header. Its sections
  need no `.wrap`. Used by supporters, thank-you, portal and gift-aid.
- **Wrapped** — `<main class="site-main">` holding full-bleed `<section>`s, each putting its
  content inside a `.wrap`. The first section carries `page-top` (or a `*-hero`) to clear the
  header. Used by everything else.

There is no third option. `test/unit/page-shell.test.ts` enforces both, for every `.html` in the
repo, with a named exemption list for the three pages that legitimately carry their own shell.

**Why the test exists.** `privacy.html`, `sitemap.html` and `404.html` were each built from class
names that no stylesheet had ever heard of — `.privacy-intro`, `.privacy-body`,
`.privacy-actions`, `.page-sections`, `.sitemap-tree`. Nothing was broken in a way a build could
see: valid HTML, valid CSS, a 200 response. They simply had no container, so the copy ran edge to
edge, and no nav-clearing section, so the heading sat underneath the fixed header. The privacy
notice — a legal page — was live in that state. It happened three times because the second and
third pages were copied from the first, and nothing in the repo could tell that a page had been
assembled from parts that do not exist. The rules those pages needed now exist as `.page-prose`,
`.page-actions` and `.sitemap-tree`, named so the next text page can reuse them.

They live in **`assets/css/pages.css`**, linked only by those three pages, not in the shared
`styles.css`. Every byte in the shared bundle is a byte a donor downloads on the way to giving us
money, and donate.html sits about a kilobyte from its enforced ceiling
(`test/unit/perf-budget.test.ts`). The honest answer to that is to stop putting page-specific CSS
in the shared file rather than raise the ceiling a fourth time; `ball.css` and
`business-thankyou.css` already work this way. `privacy.html` also had a **relative** stylesheet
href, which resolved correctly only because `/privacy` has no trailing slash; it is absolute now,
like every other page.

### The admin knows about every page, not just the public ones (TASK-402)

`src/site/pages.ts` holds two registries, deliberately apart:

- `SITE_PAGES` — the **public** tree. Feeds `/sitemap`, `sitemap.xml`, the spare-address
  destinations and the search-engine ticks.
- `PRIVATE_PAGES` — pages that exist but belong on **neither** public list: the admin itself, the
  token-gated business thank-you and Gift Aid forms, the portal-link request, the invitation and
  password-reset pages, and `/sitemap` itself.

`GET /api/admin/site-pages` returns both, and the **Site pages** tab opens with **Every page**: the
whole website in one table, each address a working link, each row saying who can reach it and what
it is for. Its value is being complete — a page nobody has opened in a year is still somebody's to
keep current, and you cannot keep current what you cannot see.

It is part of the existing Site pages tab rather than a tab of its own, because the spare addresses
and the search-engine ticks below it act on the same pages; splitting one subject across two tabs
would mean checking both. `test/unit/private-pages.test.ts` holds the registries apart (a page in
both would leak a private page onto the public map) and keeps every private path inside
`RESERVED_PREFIXES`, so a spare address can never shadow one.

### Contacting local businesses (TASK-351 · TASK-354 · TASK-401)

The **Contact businesses** screen in the admin (`#view-outreach`) is how a volunteer asks a local
firm to become a monthly supporter. It is the front of a funnel whose later stages already exist,
and it ends at "they signed up" — which is the same row the donor list already knows about.

Three layers, deliberately separated:

- `src/outreach/matching.ts` — pure, DB-free. Reduces a business name to what identifies it
  (`The Designer Rooms Ltd.` and `designer rooms limited` are the same firm), reads email domains,
  and scores how alike two names are with a bigram Dice coefficient. Free mailboxes are in a
  `PUBLIC_DOMAINS` set, because two businesses sharing `gmail.com` tells you nothing while two
  sharing `ayrjoinery.co.uk` are almost certainly one firm.
- `src/db/outreach.ts` — what the matcher compares against, from three sources: businesses already
  on the outreach list, businesses that **already give us money**, and businesses that have
  **declined**. A volunteer needs warning about three different mistakes, not one.
- `src/outreach/invitation-email.ts` — the email itself, in the approved NBCC family. Carries the
  charity registration statement, an opt-out in plain words (PECR applies to companies too), and
  "could help" rather than "£25 buys" (Code of Fundraising Practice). It also gives the phone
  number and email address beside the signature (TASK-402): a cold approach is the one email whose
  recipient has most reason to want a person on the end of a phone rather than a reply box.

The screen follows the Thank you page's shape: a form on the left, the real email on the right.
The preview is fetched from `POST /api/admin/outreach/preview`, which runs the **same**
`buildOutreachEmail` the send uses — re-implementing the template in browser JavaScript would have
been faster and would have started lying within a week.

Two rules are enforced on the server, not in the browser:

- **A decline is an instruction.** Adding a business the matcher matches to a declined one returns
  409 until the volunteer sends `acknowledgedMatches` — which the screen only offers after showing
  them what it found, and which is worded as an assertion ("this is a different business"), not an
  override.
- **`sent_at` is stamped only after the send succeeds.** A provider failure leaves the draft
  sendable rather than marking a business as contacted when nothing left the building. A second
  send returns 409, because two volunteers can open the same business at once.

Reading is Viewer+; adding and sending are Editor+. Sending is one business at a time by design —
there is no bulk send here and there is not meant to be.

**Two rules the law adds, both enforced on the server (TASK-403).**

*A sole trader is a person, not a company.* PECR splits recipients into corporate subscribers —
limited companies, LLPs, and (because Scots law gives partnerships their own legal personality)
Scottish partnerships — who may be sent unsolicited marketing, and individual subscribers, who may
not; the ICO treats a charity promoting its aims as direct marketing. The form had always asked
which kind of business it was and nothing acted on the answer. `src/outreach/lawful-basis.ts` is
that rule, pure and DB-free: emailing a sole trader is refused (422) until a volunteer has recorded
**how they already agreed**, and the refusal names the two routes PECR does not restrict this way —
a call or a letter.

*They must be told where we got their details.* UK GDPR Article 14 applies whenever personal data
comes from somewhere other than the person, and the first communication is the deadline — so the
answer belongs in the email, not only on a page they would have to think to visit. The volunteer
picks the source from a short list (their website or a listing, they gave them to us, someone
passed them on, their social media), and `detailsSourceSentence` turns it into the line the
business reads. A drop-down rather than one fixed sentence for a reason: a sentence that is
**wrong** — "we found you on your website", to someone who handed over a business card — is worse
than one that is vague. Every variant ends "and nowhere else", because "you bought a list" is the
thing a business actually fears.

### The thank-you letter sends itself (TASK-407 — shipped as TASK-408)

A business that becomes a monthly supporter is thanked without anybody having to remember. The
sequence, and why it is that way round:

1. They sign up.
2. The invite email goes — already automatic (TASK-212/214).
3. They say **how** they would like to be thanked.
4. The letter goes.

Waiting for step 3 is not caution. A Platinum letter cannot be written properly until you know
whether they want a certificate and where it should be posted, so sending first would mean thanking
somebody with the wrong letter. But silence is not a reason to say nothing either, so after a
**fortnight** the standard letter goes anyway.

`src/business/auto-thank-you.ts` is pure and holds every decision; `auto-thank-you-runner.ts` wires
the pool, the mail client and the clock. It rides the **existing daily EventBridge task**
(`npm run reminders`) beside the supporter reminders, the ball run-up and the email-log prune — one
more read on a schedule that already exists, in its own try/catch, and **no new infrastructure**.

Three things worth knowing:

- **Gift Aid comes from the donation, never from the kind of supporter.** A company cannot Gift Aid
  at all (it claims Corporation Tax relief instead), but a sole trader giving personally can, and
  the 25% line on the wrong letter tells somebody something untrue about their own tax.
- **The letter is signed by the charity, not by a volunteer.** Nobody read this one before it went,
  and putting a person's name on a letter they never saw would be the one thing in it that was not
  true.
- **One letter per donor, ever.** The due-list `LEFT JOIN`s `thank_you_sent`, so a supporter thanked
  by hand from the Thank you screen is never then thanked again by a machine. The row is written
  only *after* the send succeeds, and `sent_by` records `automatic` rather than attributing it to
  whoever happened to be signed in.

**Only from the day it was switched on (TASK-411).** `AUTO_THANK_YOU_FROM` is the cut-off: a
supporter whose record predates it is never written to automatically. This went live with a backlog
behind it, some of whom signed up months ago, and a letter dated today for a decision somebody made
in March reads less like gratitude than like a system catching up with itself. The backlog is
thanked by hand from the Thank you screen, or not, and that is a person's call. It is a constant
rather than a config value on purpose — a historical fact that never changes, and a knob there would
invite somebody to move it and post the whole backlog by accident.

That cut-off is applied by the **rule**, not the query, which makes the due-list's `ORDER BY f.id
DESC` load-bearing: the backlog still comes back in those rows, and oldest-first would let a backlog
larger than the row limit fill the window and starve every new supporter behind it, for ever.

The **Business supporters** tab shows a "Thank you letter" column: when it went, and whether a
person or the system sent it (`sent_by` is `automatic` for the daily pass). "Not yet" is styled
quietly — on a fresh supporter it is a normal state, not a problem.

### The list at scale (TASK-416)

**Adding several at once.** Behind a fold, below the single-add form, because one at a time stays
the front door. Paste a list from a spreadsheet or an email; `src/outreach/paste.ts` splits on tabs
*or* commas (a volunteer should not have to know which they have) and works out which field is
which by looking at it, rather than insisting on an order. It shows what it made of the list —
including the lines it cannot use, **by line number** — before anything is written.

Two things make it safe. It **only adds**: nothing is emailed, and each business still has to be
opened and sent with its own personal message, so there is no moment where somebody could wonder
which message went to whom. And each one goes through the **ordinary** add endpoint, so it gets the
same duplicate check and the same do-not-contact refusal as one typed by hand — a bulk route that
skipped those would be a way round the rules rather than a shortcut through the typing.

**Tags.** Lower-cased and de-duplicated (`Chamber` and `chamber` are one tag, not two that look
identical in a filter), capped at ten. The filter offers only tags actually in use, so it can never
suggest one that would find nothing, and it narrows *together* with the search box.

**Download as a spreadsheet.** Useful as a backup and as something to hand trustees who would
rather have a file than a login. Fetched with the session rather than followed as a link — an
`<a download>` sends no `Authorization` header, so a plain link would land on the login page. The
volunteers' **private notes are deliberately not in it**: a file gets emailed around and left in
folders, and those notes are disclosable to the business. One click on the business page produces
them properly when somebody actually asks.

### The Monday note (TASK-415)

"Needs you today" only works for somebody who opens it, and these volunteers have jobs and lives.
So once a week the list goes to them: one short email per volunteer with something waiting, counts
and a link, no business named. `src/outreach/digest.ts` is pure; `digest-runner.ts` wires it, and it
rides the daily task, checking the weekday itself — a second EventBridge rule would be a second
thing to notice had stopped, and this one is quiet enough that nobody would.

Two things it deliberately does **not** do:

- **Nothing goes to a volunteer with an empty list.** An email that arrives every Monday saying
  "nothing to do" teaches people to delete it unread, and then the one that matters goes with it.
- **Unassigned work is not mailed to everybody.** Five volunteers each receiving the same list of
  nobody's businesses is how five people each assume one of the others has it. It stays on the
  screen, visible without being pushed at anyone.

The count is in the subject (`3 businesses waiting on you`) because for most people the subject is
the whole email, and it has to be judgeable without opening it.

### One follow-up, ever (TASK-414)

A business that has not replied after a fortnight appears on **Needs you today**, and its page
offers one short second email. `src/outreach/nudge-email.ts` is built entirely around making it
easy to say no: it states outright that it is **the last they will hear**, the way out ("there is
nothing you need to do") comes *before* the button rather than after it, and it is under two
hundred words. A second unanswered email is a nuisance unless it costs the reader nothing.

The subject is **"One last note from us"** — not "Following up" or "Just checking in", which is
what every unwanted second email says. The list view is where the decision actually gets made.

**Prepared, never automatic.** Everything else on this screen is "always by a person", and a
follow-up that arrived on a timer would be the one thing that was not — which is also the thing a
business would notice.

**The cap is enforced three times, deliberately.** The chase rule drops a nudged business off the
list for good; the endpoint refuses a second, a nudge before the first email, and a nudge to
somebody who has already answered; and the `UPDATE` only matches while `nudge_sent_at IS NULL`, so
two volunteers pressing within the same second cannot both win. Without that last one the business
would receive two emails each promising to be the last, which would make the charity a liar as well
as a nuisance. On a send that throws, the claim is deliberately **not** released: the email may
have gone, and one business receiving none is better than one receiving two.

### Is it working? (TASK-413)

At the foot of the Contact businesses screen — interesting once a month, noise every day. Four
things: the funnel (added → emailed → replied → signed up), what it has raised, how each volunteer
has got on, and whether a personal message helps. Every figure is worked out in
`src/outreach/reports.ts`, pure and unit-tested, because these numbers may end up in front of
trustees.

Three decisions that keep them honest:

- **Both rates are out of those EMAILED, not those added.** A business sitting on the list with no
  address has not declined to reply, and putting it in the denominator punishes the charity for
  having a to-do item. The caveat is printed on the line rather than hidden in a tooltip.
- **A rate that cannot be worked out shows a dash, never `0%`.** Nought per cent means "we tried
  and nobody said yes"; a dash means "we have not tried yet". On day one that is the difference
  between a report reading as failure and reading as early.
- **The comparison refuses to draw a conclusion from too few sends.** With four on one side, one
  sign-up swings the rate twenty points, and a charity could reasonably change how it works on the
  strength of nothing. `worthReading` is false until there are ten each way, and the screen says so
  in words.

**How the money figure is attributed.** When a volunteer records a sign-up they pick the donor —
ranked by the *same* matcher the duplicate check uses, so the likely one is at the top — and only
linked businesses count. "Not sure yet" is a real option, because a volunteer forced to guess to get
past a form turns the figure into fiction.

The alternative was a referral code on the donate link, carried through Stripe checkout into the
donation. That buys automation rather than accuracy, and it costs a change to the **payment path**
— the highest-risk change available here — for a reporting figure. Linking at sign-up is exact
without touching the money. `sent_with_personal_message` records *whether* a line was written, never
the line itself: we have no reason to keep one business's sentence, but "does the extra minute
help?" is unanswerable without the flag.

### Two things that protect the charity rather than the workflow (TASK-412)

**"What do you hold about me?"** One button on the business page produces it: every field, plus the
volunteers' private notes, in plain English and in the second person, ready to paste into a reply.
`src/outreach/disclosure.ts` is pure and unit-tested, and the test that matters most is the one
proving nothing is quietly held back — a response that omits the internal jottings is a half-truth,
and that is the half somebody asking would most want to see. A sole trader is an individual under
UK GDPR and can ask by right; where a business cannot, answering plainly is still cheaper than
arguing about entitlement.

**The phone number is hidden until somebody has checked the TPS register.** Ringing a business on
the Corporate TPS register is an offence, and screening in bulk needs a paid licence not worth
buying at this volume. So the control is the honest one: the number is not shown, the screen says
why and links the free lookup, and confirming it keeps the volunteer's name and the date
(`outreach.tps_checked` in the audit trail). It is a **record, not a permission** — nothing stops a
determined person ringing a number found elsewhere; what it does is make the check a deliberate act
that left evidence, which is what we would be asked for.

Both are promised in `docs/legitimate-interests-assessment-business-outreach.md`, section 5.

### Lapsed monthly gifts already had a home (TASK-412)

Item 20 on the wish list — "a supporter whose payments stop should not vanish" — turned out to be
built already: `subscription_dunning` has tracked `active → past_due → lapsed` from Stripe webhooks
since TASK-091, with `GET /api/admin/subscriptions/dunning` behind the **Subscriptions** tab. What
was missing was any way to know that, so the tab is now called **"Monthly gifts that need
attention"** and says what it is, what Stripe is doing in the background, and that nearly all of
these are an expired card rather than somebody changing their mind.

### Business supporters is its own permission (TASK-406)

The **Business supporters** tab — what each supporter asked to be thanked with, and ticking each
step done — used to ride on `donations:edit`. That meant anyone who could correct a donation could
also work through somebody's perks and read the postal address their certificate goes to. It is now
its own section, `business-supporters`, locked down like `email-audit`: **admins hold it by role,
everyone else is granted it per person from the Team matrix.** The three endpoints
(`GET /api/admin/fulfilments`, `POST /api/admin/fulfilments/:id/mark`, and the catch-up invites)
and the nav link's `data-edit-gate` all move together.

**Adding a section needs a migration, and here is why.** `effectivePermissions` treats a stored
matrix as a *complete* statement: a section it does not name is denied. That is deliberate and it
stays — an authorisation rule that fails closed loses somebody a tab, which is visible and
recoverable, where one that fails open grants access nobody chose and nobody sees. The cost is
that the permissions editor submits every section that existed when it was used, so a matrix saved
before today has no key for a section added today and would read as "none" for everyone who has
ever had their permissions edited, **the admins included**. So the data is brought up to date once,
in `migrations/1788100000000_permissions-business-supporters.js`, matching what the role would have
given. Every future section ships with the same one-line migration; forgetting it fails closed,
which is what makes the rule safe to keep.

### Access saved before three sections existed (TASK-463)

That rule arrived with TASK-406 on 3 September. Four sections came just before it, and none shipped
with its migration: **Festive Ball** (`ball`, TASK-313, 31 August 2026), then **Email audit**
(`email-audit`, TASK-344), **Site pages** (`site`, TASK-352) and **Contact businesses** (`outreach`,
TASK-354), all on 1 September. Anyone whose access was saved before one of them arrived, and not
changed since, had no entry for it, which reads as None: that screen was missing from their menu,
admins included.

`migrations/1790788129056_permissions-backfill-missed-sections.js` gives those matrices Festive Ball,
Site pages and Contact businesses at the level the person's role gives today: admins edit all three;
editors see Festive Ball and Site pages and edit Contact businesses; viewers see all three.

**The Email audit is deliberately left out.** It was asked for so that exactly two named admins hold it
and grant it to anyone else, and it lists who was sent which email. Filling it in would hand it to
every admin account whose access predates it, so a missing entry stays None. That fails closed, and
editors and viewers get None for it anyway; give it to somebody on Team → Manage access.

It only adds a section a saved matrix does not mention. One that already says None is left alone,
because that may be a deliberate choice, the TASK-459 fault, or Manage access filling a gap with None
when an older matrix was saved again, and only a person can tell which. Every entry it adds is written
to `audit_log` as `admin_user.permissions_backfilled` by `migration:TASK-463`, with the section and
level, so whose access it changed is on the record like any change made on Manage access. Its undo
deliberately does nothing: most matrices naming these sections were saved by a person after the
sections arrived, and stripping the keys, as the earlier backfills' undo does, would take those
choices away. To take something back from one person, use Team → Manage access.

It is numbered from the clock, `1790788129056`, which is above the hand-rounded `17891…` numbers, so
the next migration must be numbered above it too (see **How to add things** in `CLAUDE.md`).

`test/unit/permissions-backfill.test.ts` fails if any section added since saved access existed
(TASK-186) has no migration adding it to the access already saved, unless it is named as deliberately
left out, so the next one cannot be missed. It also holds this migration's values to
`roleToPermissions` and checks it never touches the Email audit, with comments stripped so text in a
comment cannot pass for SQL. `features/admin-permissions.feature` runs the migration's own SQL against
the real database in CI, inside a transaction it rolls back. It covers an admin, an editor and a viewer
whose access predates the late sections, an editor whose access already says None for them, and
somebody with no saved access, who must stay on their role's defaults.

### Needs you today (TASK-405)

The screen opens with one list, above the forms, because it is the reason to open the screen at
all. **One list, not three** — a separate nudge list, call list and ask-again list would be three
places for a busy volunteer to forget instead of one.

What goes on it is a pure rule in `src/outreach/todo.ts`, not a SQL `WHERE`. Putting it in the
query would mean two places to change it and one of them untestable without a database. Five
kinds, ranked, because a promise we made outranks a chase and a warm business outranks a cold one:

| | When | Why it ranks there |
|---|---|---|
| **Ask again** | The date somebody set has come round | The only thing here we actually committed to |
| **Worth a call** | Interested, and a week of silence since | The most expensive row to lose: the work is already spent |
| **No reply** | Emailed 14 days ago, nothing recorded | |
| **Ready to send** | Has an address, never emailed | The easiest win on the page |
| **No address** | On the list 7 days with no email | |

Three states take a business **off** the list for good: `declined` (an instruction, and putting one
on a to-do list is how it gets ignored), `signed_up` (not a task), and `no_reply` (recording
silence is a decision — it stops the nagging rather than moving the business to another pile).
Every row carries the reason it is there and what to do about it, because a list of names with no
explanation gets skimmed once and then ignored.

**Whose list?** `GET /api/admin/outreach/todo` defaults to `scope=mine`, which means **mine plus
anything unassigned**. Showing everyone's work by default means two volunteers chase the same
business; showing only what is assigned means an unassigned business belongs to nobody and rots.
The response also carries the count for the other scope, so the toggle says what is behind it.

That needed a fix first: `owner` had always been a display name chosen from the **letter-signers**
list. Signing a thank-you letter and chasing a local business are different jobs done by different
people, and a name cannot be compared to the address a session is identified by — so "my
businesses" was not answerable at all. `owner_email` is now stored alongside, the picker offers the
admin users (`GET /api/admin/outreach/volunteers`), and `owner` stays as the label on screen.

The full list below it has a search box, filtered in the browser across name, contact, email, phone
and owner.

### One business, one page (TASK-404)

Clicking a name in the list opens that business: everything known about the firm in one place,
because piecing a history together from a list row is how a volunteer ends up asking the same
business twice. It is reached from a row rather than the nav, so it follows `view-donor`'s shape
— a Back control and a region the JS fills.

Three things live there.

**What happened.** The seven outcomes have existed in the database since TASK-354 with no way to
set one, so every business sat at "Emailed" for ever. `src/outreach/outcomes.ts` is now the single
place that says what each one *means*: its label, the one-line explanation shown under it (a
volunteer choosing between "Interested" and "Asked for information" should not have to guess),
whether it counts as the business having **engaged** (everything except "No reply" — recording
silence is not contact, and treating it as engagement would keep a dead record alive for ever),
and whether it leaves us owing them a date. "Said no" gets a confirm, because it is the one
outcome that takes something away: it puts the business permanently beyond the matcher.

**Notes**, append-only, stamped with who wrote them. There is no edit and no delete: a record that
can be tidied afterwards is not a record. They are also disclosable if the business ever asks what
we hold, which is why that sentence sits next to the box rather than in a policy.

**Who knows them** — a field of its own on the add form, not a line in the private note. In
small-charity fundraising an introduction from someone they know beats any email we can write, and
it has to be findable on its own so a chase list can say "ask Sarah first". It is also the thing
most likely to walk out of the door in one volunteer's head.

`POST /api/admin/outreach/:id/outcome` and `/notes` are Editor+ and both write to the audit trail,
which is what the legitimate-interests assessment promises.

The privacy notice carries a matching **"If you run a local business"** section, and
`docs/legitimate-interests-assessment-business-outreach.md` is the written Article 6(1)(f)
assessment a trustee signs.

The promo booklet the email links to is `assets/nbcc-business-booklet-2026.pdf`, served by the
static `/assets` mount. The supplied artwork was 15.25 MB of 300 DPI page scans; it is re-encoded
at 150 DPI to 1.28 MB, because a 15 MB download is a reason not to open it. **It has no text
layer** — the source is four full-page images — so a screen reader gets nothing from it. That is
worth fixing at the design end; it cannot be fixed here.

Covered by `test/unit/outreach-matching.test.ts`, `outreach-model.test.ts`,
`outreach-invitation-email.test.ts` and `admin-outreach-screen.test.ts` (DB-free), plus
`features/admin-outreach.feature` for who is allowed to do what and for the do-not-contact rule.

### Nav: one Donate, not two

The header lists all five pages **and** carries a persistent Donate CTA (REQ-002), so above the
mobile breakpoint "Donate" appeared twice in one bar pointing at one place. The list item is now
hidden at `min-width:681px` and the button carries it.

It is hidden by media query rather than removed from the markup for a reason: **below 681px both
`.nav-links` and `.nav-cta` are hidden, and the burger menu reveals only `.nav-links`** — so on a
phone that list item is the ONLY header route to `/donate`. Deleting it would remove the donate
link on mobile entirely. Browsers without `:has()` keep both, which is the previous behaviour, so
it degrades safely.

Known trade-off: on `/donate` itself at desktop the "you are here" marker lives on the hidden list
item, so the current-page indicator is not shown there. Adding it to the CTA was not worth the
bytes — see below.

### The donate.html performance budget is nearly spent

`test/unit/perf-budget.test.ts` caps donate.html's first paint at 255KB. After the nav rule the
real (LF) total is **260,988 of 261,120 bytes — 132 bytes of headroom.** Anything added to
`assets/css/styles.css` or `assets/js/main.js` from here will break it. That is why `/ball` ships
its own CSS and JS. The budget has been raised five times already; the next change that needs room
should either buy it back (the 105KB unminified `main.js` is the obvious candidate) or raise the
cap as a deliberate, discussed decision rather than a reflex.

TASK-479 raised it again, 260 to 262KB, for `assets/js/pulse.js` (the visit counter, 2,021
bytes plus a 50 byte script tag), which donate.html could not fit in the ~550 bytes it had left.
It is deferred, so it never delays first paint; the weight review is still the real fix.

**Adding an admin section is a three-file change.** The list lives in
`src/admin/permissions.ts`, `assets/js/admin/app.js` and `features/steps/admin-permissions.steps.js`.
They are not cosmetic duplicates: `PATCH /api/admin/users/:id/permissions` validates a COMPLETE,
`.strict()` matrix built from the server list, so a section present on the server but missing in
the browser bundle makes **every permissions save fail with a 400 in production**. Adding `ball`
hit exactly that. `test/unit/admin-sections-in-sync.test.ts` now fails fast if they drift.

So are the **role defaults**: giving a role a section by default means changing `roleToPermissions`
on the server and `rolePresetPermissions` (with its `OPERATIONAL_EDITOR_SECTIONS`) in `app.js`. Drift
there raises no error at all. Team → Manage access pre-fills from the browser's copy and saves what
it shows, so a section missing there is quietly taken away from people (TASK-459). The same test
checks every role's defaults as well.

**Admin.** A `ball` permission section. Unusually it is **view-only for the editor role by
default** rather than joining `OPERATIONAL_EDITOR_SECTIONS`: the gate toggle publishes the
ticket page and puts the ball on the home page, which is a launch decision rather than routine
operational work, so edit is granted per user. There is deliberately **no ticket price field** —
£100 is printed in a magazine that cannot be recalled, so it lives as a constant in
`src/ball/pricing.ts` and the settings schema has no column for it.

**The gate.** `/ball` and `/ball/terms` are served by `src/routes/ball.ts`, never by the static
site router, and `_redirects` deliberately has **no** `200` rewrite onto `ball.html` — one would
make the file directly reachable and the gate decorative. Closed, the route answers `401` with a
standalone lock screen that shares no markup with the real page, so nothing leaks. It opens two
ways: staff flip `gate_open`, or `gate_opens_at` passes (the safety net, so launch morning does
not depend on someone being at a keyboard). The same switch flips the page from `noindex` to
`index`. A correct password sets a signed, HTTP-only cookie for a fortnight.

**Not-yet-confirmed details.** `arrival_time`, `included_note` and `line_up_note` are NULL until
staff set them; `renderBallPage` then fills them server-side. Until then the page says "to be
confirmed" rather than inventing detail about a £100 ticket. Staff text is HTML-escaped.

**Confirmation email.** Sent post-commit and best-effort from the shared Stripe webhook, from
`BALL_FROM_EMAIL` (`events@nbcc.scot`) on the **apex** domain — deliberately not
`news.nbcc.scot`, which is the newsletter's send-only sender and must not carry transactional
receipts. Content is built by the pure `src/ball/confirmation-email.ts`; only a booking this
event actually moved to `paid` is confirmed, so a Stripe redelivery cannot send a second
receipt. A failed send is logged, never thrown: the booking is already paid and a 5xx would make
Stripe redeliver.

**The five ball emails share the NBCC shell and the sponsor band.** The confirmation, the
week-to-go reminder and the three run-up emails (guest-list read-back, chase, last call) all
render through `ballEmailShell` (`src/ball/email-shell.ts`), which wraps `emailShell` from
`src/email/brand.ts` with the ball's own settings: `events@nbcc.scot` in the footer bar rather
than the giving inbox, the registered postal address (its absence is a small but real spam
signal at Microsoft, and these were the emails landing in junk), and a maroon **sponsor band**
carrying The Designer Rooms cream wordmark above the Appendix A2 statement, which clause 11.1
requires wherever the event is promoted. `contactPanel()` puts the phone number and the events
address in the body as well, at reading size, rather than leaving them as grey small print.

Three copy rules the emails now hold, each pinned by `test/unit/ball-email-brand.test.ts`:

- The confirmation subject is **"You're coming to the ball!"** followed by the reference, not a
  filing label.
- What the ticket includes is imported from `TICKET_INCLUDES` (`src/ball/page.ts`), the same
  sentence the website sells on, so the email cannot promise less than the page did. It used to
  say "a meal" while the page said a three-course meal and a welcome drink.
- Gift Aid is mentioned **only when Gift Aid was actually added**. A paragraph about a relief the
  buyer did not claim and cannot claim on a ticket is the form-letter note that made the old
  email read like a bank statement.

**Home page.** `renderHomePromo` adds a banner above the hero, a feature section below it, and a
nav link — but ONLY once the gate is open. While it is shut it returns index.html byte for byte,
so the promotion is absent from the page source rather than hidden. This matters because the
printed advert's QR code points at `nbcc.scot`, not `/ball`.

**Config.** `BALL_BASE_URL` — the public site base the Stripe return/cancel URLs are built on.
Required with no default: a silent localhost fallback would strand a buyer who has just paid.
It is a **plain task-def environment value** (a module variable set in
`infra/envs/production/main.tf`), exactly like `STRIPE_SUCCESS_URL` — deliberately NOT an SSM
parameter. It was one first, and that was wrong: the SSM pattern (`PORTAL_BASE_URL`) ships a
`nbcc.example` placeholder plus `ignore_changes`, so the real value depends on someone
remembering a `put-parameter`. For a URL Stripe redirects a paying customer to, "someone
remembers" is not a good enough guarantee. If a value is non-secret and known at commit time,
prefer the variable: it is version-controlled, reviewed in the PR, and cannot be forgotten.
`BALL_PREVIEW_PASSWORD` stays a SecureString — it is a secret, and staff override it from the
admin area anyway.

public `GET /api/supporters/ticker` returns the **active** names in order, and the admin
**Supporters ticker** tab (`view-ticker` + `loadTicker` in `assets/js/admin/app.js`) does full CRUD
over `/api/admin/ticker` — reads are Viewer+, add/edit/hide/delete are **Editor+** and each write
appends a `supporter.*` audit row (`src/db/ticker.ts`). Each row offers **Edit · Hide/Show · Delete**;
Edit renames in place via `PATCH` (TASK-262), which keeps the row's `sort_order` and audit trail
rather than losing them to a delete-and-re-add.

**Display order (TASK-262).** Both the public feed and the admin list share one `DISPLAY_ORDER` in
`src/db/ticker.ts` — `sort_order ASC, lower(name) ASC, id ASC` — so they can never disagree. Ordering
by **name** (not `id`) is what keeps the list alphabetical permanently: a partner added or renamed
today sorts into place instead of landing at the bottom. `sort_order` remains the manual-pin override
(every row is `0`, so it is inert until a staffer sets one); `id` is the final tiebreak.

**Seeded partners.** `1783709948147_seed-partners` (TASK-181) loaded the original ~124 names, then
`1783715098494_partners-hidden-by-default` (TASK-182) hid them so staff reveal partners one at a time.
`1784900000000_seed-partners-july-2026` (TASK-262) adds 266 more from the July 2026 Master Supporter
List — **names only** (no contact details; this table feeds public surfaces) and inserted
`active = false`, because that one-shot hide migration does **not** cover later rows and the column
defaults to `true`. Its `NOT EXISTS` guard dedupes on a normalised (case/punctuation-insensitive) key,
so re-running it inserts nothing. The public marquee is injected by
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
ships to production; guarded by `test/unit/seed-partners-migration.test.ts`.
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
  outside production whenever `EMAIL_PROVIDER` is `stub` (`emailStubbed`) — which is the case
  in local dev and CI by default. Since a stubbed send never actually delivers the code, step 1's
  response includes it directly as `devCode` **only when `config.NODE_ENV !== "production"`** — so
  local admins can always complete 2FA even without live email — and this is **never** true in
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
  an explicit `kind`, routed by it, and each kind gets its OWN branded body + correct subject
  (the login code now reads "Your NBCC admin sign-in code"). Since the Resend→SES migration the
  templates live IN the app (`src/email/templates.ts`) and ship with it, so template/app skew is no
  longer possible and the old field heuristics are gone. See **All transactional emails share one
  branded shell** below.

**All transactional emails share one branded shell (REQ, TASK-209; templates moved in-app by the
Resend→SES migration).** Every transactional send from `src/clients/email.ts` routes through
`buildKindEmail` (`src/email/templates.ts`) by an explicit `kind`, wrapping the body in
ONE branded shell and giving each email its OWN correct subject. The shell mirrors the admin thank-you
letter email (`src/thank-you/letter.ts`): a maroon page, a cream content panel, the NBCC logo
letterhead (hosted absolute URL, not base64), and a maroon footer bar carrying `01292 811 015` /
`giving@nbcc.scot` / `nbcc.scot`. It stays email-safe (layout tables + inline styles + web-safe
Georgia/Playfair and Arial/Poppins stacks) and carries a `color-scheme: light` meta so dark-mode
clients don't invert the palette.

The shell itself now lives in **`src/email/brand.ts`** — the palette, the type stacks, the
letterhead, the footer bar and the body fragments (`heading`, `bodyP`, `note`, `button`,
`codeBox`), all pure. `src/email/templates.ts` renders through it byte for byte. It was extracted
because there were two copies: the Festive Ball emails had been written before the shell existed
and carried their own, which had drifted to system-ui type, a bare cream box, no letterhead and
no footer bar, so a supporter who donated and then bought a ball ticket got two emails that did
not look related. `emailShell(body, options)` takes a `contactEmail` (the ball uses
`events@nbcc.scot`, not the giving inbox), an optional `postalAddress`, and an optional `sponsor`
band for an event somebody else is paying for. The `kind` -> subject map:

| `kind` | subject | body |
|---|---|---|
| `donation` | Thank you for your donation to NBCC | app |
| `receipt` | Your NBCC donation receipt | app |
| `refund` | Your NBCC refund confirmation | app |
| `loginCode` | Your NBCC admin sign-in code | template |
| `adminInvite` | Your NBCC admin account invitation | template |
| `adminReset` | Reset your NBCC admin password | template |
| `portal` | Your NBCC donor portal link | template |
| `declaration` | Add Gift Aid to your NBCC donation | template |
| `lapsedDonor` | Your NBCC monthly donation has stopped | template |
| `lapsedAdmin` | A monthly NBCC subscription has lapsed | template |

This fixed a real bug: the 2FA sign-in code, admin invites and password resets used to fall through
old field-sniffing to the donation default and get the wrong subject, and almost none were branded.
The `donation` / `receipt` / `refund` bodies are still built by the app (`src/donors/confirmation.ts`,
`src/donors/receipt.ts`) and already end with the charity-registration line, so the shell wraps them with
a contacts-only footer (no duplicate registration); the `template`-built kinds get the registration in
the footer. `newsletter` and `thankYou` are unchanged (each already ships its own fully branded html +
subject). Covered by `test/unit/email-templates.test.ts` (each kind's subject, the branded shell,
escaping, and registration exactly once). Since the Resend→SES migration the templates ship inside the
app image (`src/email/templates.ts`), so a normal ECS deploy carries both the sends and their bodies —
there is no second service to redeploy and no deploy-skew window.

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
(`forwardEnquiry`, `CONTACT_FORWARD_URL`) was **retired from this path** by that spec and has since
been **removed entirely** (Resend→SES migration): the dead client module, the config key, its SSM
parameter and task-def wiring are all gone. A honeypot field (`company`) filled by a bot is silently accepted (**200**,
nothing stored) and a per-IP rate limiter (5/minute) guards the endpoint, matching the My Story
submission pattern. `initContactForm` (`assets/js/main.js`) is now **honest-save**: the success
message and form reset show **only** on a genuine `res.ok` from this endpoint; a non-2xx response or
network failure shows an inline error and **keeps the typed message** (nothing is discarded, no
silent mailto fallback), and the submit button is disabled only while the request is in flight.
Verified by `test/unit/contact.test.ts` (jsdom, mocked `fetch`) and `test/unit/contact-endpoint.test.ts`
(mocked `insertEnquiry`).

**A spam check on the contact form (TASK-490).** Bot spam was reaching Admin → Contact form past the
honeypot and the rate limit, so `POST /api/contact` now checks a Cloudflare Turnstile pass between
the rate limit and validation whenever the check is on: both `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` set. The production web server refuses to start without them
(`productionConfigProblems` in `src/config/schema.ts`, applied in `src/index.ts`, so the scheduled
jobs that load the same config never depend on them); local development and CI run with the check
off. `src/clients/turnstile.ts` asks Cloudflare's siteverify (5 second timeout) and answers
`passed`, `refused` (the visitor's pass is missing, invalid, expired or reused: **400**
`{ error: "captcha" }`, nothing stored) or `unavailable` (network, timeout, Cloudflare's own error,
or our secret rejected: the message is **kept** and a warning logged, so a genuine enquiry is never
lost to the checker). Cloudflare's error codes decide whatever the HTTP status, because it sends a
rejected secret as a 400 naming `invalid-input-secret`. The page learns the site key from
`GET /api/contact/captcha`. `assets/js/contact-captcha.js`, loaded by `contact.html` only, fetches
Cloudflare's script once the visitor starts on the form (a tap or a key in a field) or presses
Send, so someone who only reads the page never contacts Cloudflare. It draws the box (Flexible when
the form is 300px wide or more, Compact below that, and again at the size that fits if the form gets
narrower, so a 320px phone never scrolls sideways), holds Send with a message until there is a pass
(using `main.js`'s own form check, so the two agree), and resets the box after each send. It is a
separate file because `main.js` counts towards
`donate.html`'s page-weight budget, which had about 530 bytes left; `main.js` only sends the hidden
`captchaToken` field. The secret is an SSM SecureString created holding `REPLACE_ME`: until the real
value is pasted in, every check reports our secret as invalid and messages are kept, with a warning
in the logs. The app sends no Content-Security-Policy, so nothing blocks Cloudflare; if one is ever
added, allow `https://challenges.cloudflare.com` in `script-src` and `frame-src`. Spec:
`docs/superpowers/specs/2026-09-30-contact-form-captcha-design.md`.

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

  **TASK-431** sends that invite to **one** supporter. The backfill above is all-or-nothing by
  design, and that turned out to be the whole problem: RMC Double Glazing had been paying £100 a
  month since 26 May, nobody had ever written to them, and the only button available would have
  emailed every other un-invited supporter at the same time. Nothing on the page even said who was
  still waiting.

  It is **not a second send path.** `POST /api/admin/business-supporters/:id/send-invite`
  (`postAdminSendBusinessInvite`, `business-supporters:edit`) calls the *same*
  `runBusinessInviteBackfill`, handed a list of one — same builder, same send, same
  send-then-stamp ordering, same idempotency. A parallel implementation would be a second place for
  the double-send bug to live. The list of one comes from `getUninvitedBusinessSupporter(id)`, whose
  WHERE clause is the bulk gate character-for-character plus `f.id = $1`: that gate is what makes a
  second click a no-op, so sending to one supporter must not become the way round the protection
  that stops the bulk run emailing somebody twice. A supporter who is already invited (or who has
  already used their link) is simply not returned, so the run sends nothing and the response says
  `alreadyInvited: true` — a no-op that protected you is not a failure, and is not shown as one.

  The audit row is **`fulfilment.send_invite` against that supporter's id**, not
  `backfill_invites` against `null` (`auditAction` / `auditEntityId`, both optional and defaulted so
  the TASK-214 caller is byte-for-byte unchanged). Otherwise the log reads as though somebody
  clicked the bulk button and "who did we write to, and why" stops being answerable.

  The **Business supporters** table gains an **Invite** column — *Link used*, *Sent \<date\>*, or a
  **Send invite** button for anyone still waiting (`fulfilmentInviteCell` / `sendSingleInvite` in
  `assets/js/admin/app.js`); `listBusinessFulfilments` now also selects `invited_at` to feed it.
  No new dependency, no new config key, no migration. Covered by
  `test/unit/individual-business-invite.test.ts` (the narrowed gate is identical to the bulk one,
  the name fallback, send-and-stamp, no-stamp-on-failure, and the audit labelling) and
  `test/unit/admin-individual-business-invite.test.ts` (401/403/400, that the read is addressed
  **by id rather than listing everyone**, the counts, the `fulfilment.send_invite` audit against
  that supporter, and the already-invited no-op).

  **TASK-436** rebuilt the page around the question it is actually opened to answer. It used to put
  every supporter's preferences *and* all five fulfilment buttons in the row, which made "who still
  needs something from us?" the hardest thing to work out — and it showed none of what you need to
  actually do the work.

  Four things were wrong, and all four were reported by the person using it:

  - **The buttons did not say what they did, or that they were permanent.** `markFulfilmentFlag`
    only ever sets its column `true`; there is no untick anywhere. A stray click on a row you were
    only reading set a flag for good, with no warning. Each job now carries a line saying what it
    means, and marking one asks first, naming the job and the business.
  - **Every button showed for every supporter**, so you could mark "Badge sent" for a business that
    never asked for a badge. Only the jobs they actually requested are offered now
    (`fulfilTasksFor`), and "Certificate posted" appears only when they chose post over download.
  - **Nothing showed what they submitted.** `website`, `socials`, `consent_featured` and —
    worst — `certificate_address` were all being fetched and none were rendered. The page asked you
    to tick "Certificate posted" while withholding the address to post it to.
  - **"Thank you letter: Not yet" was a dead end.** The letter is composed on the **Thank you** tab,
    which this page never said. It now says so, and links there.

  The layout is list-then-detail: business, band, and one plain line of where they are up to
  (*Invite not sent yet* · *Waiting for them to fill in the form* · *3 things to do* · *All done*).
  Selecting a supporter opens their invite, their letter, everything they asked for, the jobs
  outstanding, and **who did what and when** — `GET /api/admin/fulfilments/:id/history`, which reads
  the audit rows every fulfilment write has always appended and nothing ever showed. No new storage:
  the audit log is the record, so nothing is denormalised onto the row to drift out of step with it.
  Rows are keyboard-operable (`role="button"`, Enter/Space) because the detail is now the only route
  to the controls.

  "Link used" also became **"Form submitted"** — the thank-you page is submit-once and token-gated,
  so a capture means they filled it in, not merely that a link was opened. One genuine behaviour
  change: the buttons are gated on `business-supporters:edit`, matching what the server enforces and
  the tab's own `data-edit-gate`. They were gated on `donations:edit`, which offered an editor
  controls the server would have refused.

  **TASK-437** fixed two things TASK-436 got wrong. `.admin-table` sets `white-space: nowrap` on
  **every** cell, and the detail panel is rendered inside a cell — so every sentence in it inherited
  "never wrap": text ran under the next column, the table grew past its container, and
  `.admin-table-wrap`'s `overflow-x` turned that into **a scrollbar inside a box**. `.fx-table` now
  sets `white-space: normal` and `table-layout: fixed` with explicit column widths, so the table
  cannot outgrow its container however long the content is. Content wraps and the page grows; it
  never scrolls sideways inside a panel.

  It also stopped showing **"Happy to be featured"**. That is not a question anybody is asked —
  `resolvePreferences` sets `consentFeatured = listOnSupporters || wantSocial`. Displaying a derived
  value beside the two answers it is derived *from* reads as a third, separate consent, and was read
  that way.

  **TASK-440** stopped the page claiming work that had already happened. Three of the five
  "fulfilment jobs" were never jobs at all:

  - **Listed on the supporters page** — the public wall reads `list_on_supporters` + `captured_at`
    LIVE (`resolvePublicSupporter`). A business appears the moment they submit the form. Nobody adds
    them, and nobody ever did.
  - **Badge** and **certificate link** — both are carried by the confirmation email the capture
    sends (`buildCaptureConfirmationEmail`, TASK-221), gated on the same perks as the on-page
    version. They go out minutes after the business replies.

  So the page was offering a **Mark done** button for three things a machine had already finished,
  which is how somebody ends up "sending" a badge that was sent a fortnight ago. They are now stated
  under **Already done for you**, each with the date it happened, and there is no button — a button
  there invites you to redo finished work.

  What is left is what a machine genuinely cannot do: **write a social post**, and **put a printed
  certificate in an envelope** (only when they chose post over download). Acme's row went from five
  jobs to two.

  The thank-you letter panel now says **"Goes out automatically"** rather than "Not sent yet". It is
  sent by the 8am pass once they have filled in the form, or a fortnight after the invite if they
  never do. "Not sent yet" read as something somebody had forgotten, which is how you get two
  letters to the same person — and only one is ever sent, so the hand-written one would win.

  Also: `#fulfilmentsTable` IS `.admin-table-wrap`, which pairs `border-radius: 16px` with
  `overflow-x: auto` — a clipping box. A bare paragraph sitting flush at the top had its first line
  sliced off by the curve (table cells never showed it, because they carry their own padding).
  `.fx-hint` now has padding that clears the radius, verified by measurement: text starts 21px in
  against a 16px curve.

  **TASK-441** moved the badge and certificate out of the confirmation email and into their own,
  sent the **next weekday morning**.

  They used to arrive seconds after a business submitted the form, which reads as a machine because
  it was one. A business giving £100 a month deserves their recognition to look like somebody put it
  together. The confirmation still goes **instantly**, because it is a receipt: somebody who fills in
  a form and hears nothing reasonably assumes it broke. What is delayed is the delivery, not the
  acknowledgement.

  `shouldSendPerksNow` (pure, `src/business/perks-delivery.ts`) requires all of: they asked for a
  badge or certificate, they have filled in the form, it has not already gone (`perks_sent_at`), it
  is **not a weekend**, and it is a **strictly later calendar day** than the capture. So a Friday
  afternoon signup becomes Monday, a Saturday night one becomes Monday, and a Tuesday morning one is
  never answered the same morning. "A few hours later" would have produced a 3am Sunday email, which
  is unmistakably automatic.

  It rides the existing 8am pass and checks the weekday itself rather than adding a second
  EventBridge rule nobody would notice had stopped — the same trick as the Monday note (TASK-415).
  `perks_sent_at` is stamped **only after a send succeeds**, so a relay failure is retried tomorrow
  rather than losing that supporter for good.

  **On sounding human:** the email speaks in the first person, refers to what they chose, and never
  announces itself as automatic. What it does not do is sign a named person to something nobody read
  — the line `auto-thank-you.ts` draws, and the right one. Warmth is a matter of how you write; a
  fake signature is just untrue. It also offers a reply if the certificate is in the wrong name.

  The admin panel now reports when the email **actually** went (`perks_sent_at`), showing an open
  circle and "Goes out automatically on the next weekday morning" while it is still pending — a tick
  would claim it was done, which is the mistake that section exists to fix.

  **TASK-491** adds a reminder to **phone** each business that gives monthly, every three months
  while they are still giving, to thank them and ask if there is anything we can do
  (`docs/superpowers/specs/2026-10-02-business-call-reminders-design.md`). What staff see:

  - a **Time to call** pill under the business's name when a call is due (the admin's own pill in
    the needs attention colours, not the green New pill), and a line above the list: *3 businesses
    are due a call*, *1 business is due a call* or *No calls due*. The line is hidden while the list
    is loading or could not load, so it never claims nobody is due when it does not know;
  - a **Thank you call** panel at the top of a business's details: their number as a tap to call
    `tel:` link (or *No phone number yet*), when they were last called, by whom and the note, a box
    to add or change the number, and **Mark as called** with an optional note of up to 500
    characters. The note box grows with what is typed; nothing scrolls inside a box;
  - each call (`fulfilment.called`, with its note) and each change of number (`fulfilment.phone`,
    with the number it replaced) in the business's **History**, written in the same transaction.

  **Who is due** is the pure `callDue` in `src/business/call-due.ts`, worked out per row by
  `GET /api/admin/fulfilments` (as `callDue` and `callDueOn`) against today in the UK:

  - **still supporting** means at least one paid monthly gift, and the `subscription_dunning` row
    for the subscription of their latest one neither cancelled (`cancelled_at`) nor `lapsed`. That is
    how Monthly givers reads an individual. `past_due` (Stripe still retrying) and no dunning row (no
    trouble yet) both count as supporting. An old subscription's cancellation never counts against a
    newer one, so a business that cancelled and later gave again is supporting. Not supporting
    means no pill, whatever the dates;
  - **after a call**, the next is due 3 calendar months after the last one;
  - **before the first call**, 3 calendar months after their first paid monthly gift, but never
    before **1 September 2026**, so everyone giving since June 2026 or earlier was due at once;
  - **3 calendar months** keeps the day of the month where it can and otherwise takes the month's
    last day: 31 May gives 31 August, 30 November gives 28 or 29 February. Dates are UK days, so a
    call at 00:30 on 1 July counts as 1 July. Due *on* the due date, not the day after.

  Data (migration `1791100000000`, additive): `business_supporter_fulfilment.phone` (nullable) and
  a new `business_supporter_calls` table (`fulfilment_id` cascading, `called_at`, `called_by`,
  `note` up to 500). The migration also copied each business's number from **Contact businesses**
  (`business_outreach.contact_phone`, linked by `business_outreach.donor_id`) into an **empty**
  phone only, and only where it passes the same check the admin applies, logging each copy so
  History says where the number came from. A number is digits, spaces, `+`, `(`, `)` and `-`, up to
  40 characters with at least 7 digits (`normalisePhone`); an empty box removes it. Guarded by
  `test/unit/business-call-due.test.ts`, `business-calls-migration.test.ts`,
  `admin-business-calls-api.test.ts`, `admin-business-calls-page.test.ts`, and
  `features/business-calls.feature` against Postgres.

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

> **Stub seam (no live email provider needed).** `src/clients/email.ts` sends via Amazon SES
> when `EMAIL_PROVIDER=ses` (production's task definition sets it). **Outside production**,
> on the schema's `stub` default (local dev, CI), the send is stubbed (no network).
> Production never stubs, whatever the flag says. `EMAIL_PROVIDER` and the other SES keys are
> wired through config, `.env.example` and the task-def `environment` (golden rule 3; none are
> secrets, so no SSM/`exec_secrets` entries — the one exception is `SES_WEBHOOK_TOKEN`).

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
external form-service forward (`CONTACT_FORWARD_URL`) is retired and removed — see the note under
**Configuration**.

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
`@demo.nbcc`/`DEMO`-tagged rows first (the append-only audit rows insert once).
Local-dev / demo only, never production donor data.

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
production concern, not CI's).

**Production provisioning** (Task B2): Terraform generates the
`stories_app` credential and publishes it as the `STORIES_DATABASE_URL` SSM
parameter (`infra/modules/app/main.tf`), wired through the task definition like
any other secret (`infra/modules/app/ecs.tf`). It can't create the database or
role itself (no `postgresql` Terraform provider, private RDS), so
`scripts/bootstrap-stories-db.mjs` does that imperatively — idempotent
`CREATE ROLE`/`ALTER ROLE`, `CREATE DATABASE`, `GRANT` statements run outside a
transaction (Postgres can't `CREATE DATABASE` inside one), connecting with the
**master** `DATABASE_URL`. The deploy workflow runs it as a one-off
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

**Production provisioning** mirrors the `stories` database exactly: Terraform generates the
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
- Create an Environment `production` with **no required reviewers** (merging a
  green PR is the deploy gate — TASK-312 removed the approval click along with
  staging).
- On the environment set a variable `AWS_ROLE_ARN` to the role ARN the script
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
aws ssm put-parameter --name /charity-site/production/EXTERNAL_API_ONE_KEY \
  --type SecureString --value 'real-key' --overwrite
# ...repeat for EXTERNAL_API_TWO_KEY.

# Stripe (REQ-028/REQ-029): the live secret key (SecureString) and the four
# recurring price IDs (String); all start as REPLACE_ME placeholders.
aws ssm put-parameter --name /charity-site/production/STRIPE_SECRET_KEY \
  --type SecureString --value 'sk_live_...' --overwrite
aws ssm put-parameter --name /charity-site/production/STRIPE_PRICE_BRONZE \
  --type String --value 'price_...' --overwrite
# ...repeat for STRIPE_PRICE_SILVER/GOLD/PLATINUM.

# Stripe webhook signing secret (REQ-036): a SecureString for verifying inbound
# webhook signatures. The whsec_... value comes from the Stripe Dashboard webhook
# endpoint; starts as REPLACE_ME.
aws ssm put-parameter --name /charity-site/production/STRIPE_WEBHOOK_SECRET \
  --type SecureString --value 'whsec_...' --overwrite

# Contact form spam check (TASK-490): the Cloudflare Turnstile secret key (SecureString), from the
# Turnstile widget's settings in the Cloudflare dashboard. Starts as REPLACE_ME; until it is set,
# every message is kept with a warning in the logs. `read -s` keeps the key off the screen and out
# of the shell history. Then restart the service, because ECS reads secrets only when a task starts.
read -rsp 'Turnstile secret key: ' TS; echo
aws ssm put-parameter --name /charity-site/production/TURNSTILE_SECRET_KEY \
  --type SecureString --value "$TS" --overwrite; unset TS
aws ecs update-service --cluster charity-site-production --service charity-site-production \
  --force-new-deployment

# Email needs no put-parameter (Resend→SES migration): the app sends straight to
# Amazon SES with the ECS task role, and the one email secret (SES_WEBHOOK_TOKEN)
# is minted by Terraform itself (infra/modules/app/ses.tf).

# Declaration form base URL (TASK-075): the public site base the in-person Gift Aid
# declaration link/QR is built on. A plain String (not a secret); starts as a
# https://nbcc.example placeholder. Set the real public site URL.
aws ssm put-parameter --name /charity-site/production/DECLARATION_FORM_BASE_URL \
  --type String --value 'https://www.nbcc.org.uk' --overwrite
```

## Provisioning infrastructure

Infra is **not** applied automatically on push (that's how a stray PR replaces
your database). Apply it deliberately:

- GitHub: **Actions -> Infra -> Run workflow -> environment: production ->
  action: apply**.
- Or locally: `cd infra/envs/production && terraform init && terraform apply`.

On the very first apply the ECS service starts with a placeholder image and is
unhealthy until the first real deploy - so run the deploy pipeline (below)
right after.

After that, any apply that changes the task definition registers a new revision on the same
placeholder image, and it becomes the family's latest. The scheduled jobs (the 8am reminders, which
send the Ball ticket report, and the 2am backup) run the family's latest, so they would start nginx
until the next deploy. Since TASK-474 the Infra workflow's apply ends by re-registering Terraform's
revision on the image the service is running, exactly as a deploy does, so the latest revision always
runs the app. It never touches the service; on a first apply it does nothing
(`test/unit/infra-workflow.test.ts`).

## Deploy flow

1. **Open a PR** -> `pr.yml` runs lint, build, migrations, **unit + BDD**.
   This is the functional gate — there is no staging environment to catch
   anything after merge (removed in TASK-312).
2. **Merge to main** -> `deploy-prod.yml`:
   builds + pushes the image (tagged by commit SHA, to the shared ECR repo, with
   Docker layer caching via `buildx` + the GitHub Actions cache so unchanged
   base/dependency layers are reused across deploys; if the SHA's image already
   exists in ECR — a re-run — it's reused, build-once-by-SHA),
   provisions + migrates all three databases (main, `stories`, `contact`) in a
   **single** one-off `ecs run-task` — one Fargate cold-start instead of five —
   deploys to ECS, smoke-tests `/health`, then tags a `release-YYYYMMDD-<sha7>`.
   Terraform providers are cached (`TF_PLUGIN_CACHE_DIR` + `actions/cache`) so
   `terraform init` doesn't re-download them each run.
   No BDD runs against production — the suite POSTs real data (signups,
   donations); `pr.yml` already runs it in full against a local app + DB +
   Stripe stub.
3. **Rollback / redeploy** -> run `deploy-prod.yml` manually
   (**Actions -> Deploy production -> Run workflow**) with an earlier commit
   SHA; the image is reused from ECR (or rebuilt from that commit if pruned).

Rollback is also automatic: the ECS deployment circuit breaker reverts to the
last healthy task set if a deploy fails its health checks, and a failed smoke
step fails the run loudly.

Deploys are tuned to finish quickly: the target group sets
`deregistration_delay = 5` (the default 300s otherwise blocks
`ecs wait services-stable` on the old task draining) and a 10s health-check
interval, both in `infra/modules/app/alb.tf`. These are Terraform changes, so
they take effect only once the **Infra** workflow applies them.

## The admin remembers where you were (TASK-443)

A refresh used to drop you back on the overview, whatever you were doing. That is maddening halfway
through working a list: you lose your place and have to navigate back every time.

`selectView` now records the section, and sign-in resumes it. Written inside `selectView` so it
cannot drift from what is on screen, since every route into a section goes through there including
the programmatic jumps.

**sessionStorage, not localStorage** — matching where the session token lives. It survives a
refresh, which is the complaint, and dies with the tab, so a shared machine never reopens on
somebody else's last screen.

It only restores a section the user can **still** see: permissions change, and a viewer restored
onto a section their role no longer reaches would land on a blank panel with nothing explaining why.
The nav link is the authority, because it is already gated by permission. Both storage calls are
wrapped, because storage throws in private mode and losing your place is an annoyance while an
exception there would break navigation outright.

## The sent-letter history, readable (TASK-445)

TASK-444 guessed the column shares and got several wrong. The screenshot said it plainly: the
actions column had **5%** and broke "View letter" into "Vie w lett er", while "The Night Before
Christmas Campaign" wrapped over five lines in 10% and "29/09/2026" split across two.

The shares are corrected against what the columns actually hold, and three rules stop the shared
`overflow-wrap: anywhere` doing more harm than good in narrow cells:

- A **date and an amount** are single tokens, so they never wrap. Both are narrow enough that
  holding them together cannot widen the table.
- The **actions stack** rather than sitting side by side. "View letter · Delete" needs about 160px
  in a row; one per line reads at half that.
- Those links **break between words, never inside one**. `anywhere` exists so a long address cannot
  widen a table; a two word link never could.

The stacking breakpoint moved from 820px to **1000px**: nine columns at 900px were still unreadable
even without a scrollbar, which is the wrong thing to have been optimising for.

Verified at 1600, 1200, 900 and 375: nothing scrolls, the date and the sender sit on one line each,
and below 1000px it is stacked records rather than nine cramped columns.

## The sent-letter history, one fact per column (TASK-444)

The recipient's name and email address were crammed into a single cell, and **addressed to** — the
name at the top of the letter, which is often a person where the thank-you name is their company —
was not shown at all despite being stored since the feature shipped. Now: *Sent*, *Thank you to*,
*Addressed to*, *Email*, *Copied to*, *Gift*, *Signed by*, *Sent by*.

**`cc_email` is stored now.** It used to be accepted by the send route, used to address the email,
and thrown away — so "was anybody copied on that?" had no answer for a letter about a donor's own
money. Additive nullable column; existing rows stay NULL, which reads correctly as *we do not know*
rather than *nobody was copied*, because for letters sent before the column existed we genuinely do
not. Nothing is backfilled for that reason.

Nine columns need help from `table-layout: fixed`, so the table sets its own proportions rather than
taking nine equal shares. They sum to **99, not 100**: at exactly 100 the rounding of nine
percentage widths landed a single pixel over the container and produced a scrollbar for it.

Below 820px nine columns cannot be read at any width, so the history becomes **stacked records** —
each row a card, each value labelled by its own header via `data-label`. Reading down beats
scrolling across, and scrolling across is the thing we are not doing.

## Cells that overlap their neighbours (TASK-449)

Reported as "still broken", with a screenshot of "Gift in kind: An Afternoon Tea" printed across two
columns and a date printed over the name beside it.

**With `table-layout: fixed`, a cell that cannot wrap does not widen its column — it paints OVER the
next one.** TASK-445 put `white-space: nowrap` on the Gift and Sent columns reasoning that an amount
and a date are single tokens that should never break. An amount is; that column also holds
*"Gift in kind: An Afternoon Tea"*. And 8% of the card was narrower than `29/09/2026` once padding
came off.

So: **no cell in a fixed-layout table carries `nowrap` unless its content is genuinely bounded, and
almost none is.** Wrapping is the safe failure — a value too big for its column looks cramped, which
is legible; an overlapping one is not. Guarded by a test that rejects `nowrap` on any table cell
selector, excepting the visually-hidden header pattern, which is clipped to a pixel and never
painted.

Measuring that fix found a second, unreported bug: the **stacked layout below 1000px was collapsed**.
The per-column percentages are `:nth-child` selectors, which outrank the plain `width: auto` in the
media query, so stacked cells stayed at 9% of the row and the label/value grid resolved to
`0px 0px`. Both tables now reset the widths at the same specificity, declared later.

Verified with the exact rows from the report at 1500, 1100, 1024 and 375: no cell paints outside its
own box, nothing scrolls, and the stacked grid measures `120px 175.6px` rather than nothing.

## Table cells line up (TASK-448)

A table cell defaults to `vertical-align: middle`. That was barely visible while nothing wrapped,
and became obvious the moment TASK-442 made everything wrap: a date floating halfway down beside a
two line name, reading as though the columns had come apart. Making the tables wrap is what exposed
it, so this is the second half of that change rather than a separate fault.

`.admin-table` cells now align to the **top**, so a one line value sits level with a wrapped one.
The newsletter and email-audit panels had already set it locally — the same tell the `nowrap`
default gave, and the same lesson: a rule patched in three places separately is a wrong default.

`.fx-table` still centres, deliberately and now with a comment saying why: its rows hold one short
value per cell, and a band pill pinned to the top beside a two line name reads worse than a centred
one. The long text on that screen lives in the detail panel below.

Verified by measuring where the first line of text starts in every cell of a row: all at 14px from
the row top, against a name that wraps to two lines and a gift description that does not.

## Monthly givers (TASK-447)

Businesses have had a screen of their own since TASK-208. The people quietly paying £10 a month had
nothing, and were findable only by paging the whole donations list — which is how three of them went
four months without a thank-you and nobody noticed (TASK-430).

`GET /api/admin/monthly-supporters`, gated on `donations:view` — the donations list already shows
every one of these names and addresses, so a separate permission would gate data the same people can
already read one screen across.

**The menu link was hidden from everyone until TASK-457**, admins included, from the day the screen
shipped. It was gated on its own `data-view`, "monthly", and there is no "monthly" permission: no
role default or saved matrix has ever held one, so `canView("monthly")` was false for every user,
and a refresh on the screen fell back to the Overview (TASK-443 only restores a section whose link
you can see). The link now carries `data-view-gate="donations"`, honoured by `applyNavFiltering`
beside `data-edit-gate`, so it shows to exactly the people its route serves.
`test/unit/admin-sections-in-sync.test.ts` now fails, naming the link, if any menu link is gated on
a section the server does not know.

Each row: what they give **now**, when they started, what they have given in total, whether it is
Gift Aided, whether they have been thanked, and whether their payments are healthy. The monthly
figure is their **latest** paid gift rather than an average: somebody who moved from £5 to £20 gives
£20, and £12.50 would be true of nothing.

**A cancellation outranks the status column.** Stripe keeps a cancelled subscription `active` until
its paid period ends, so reading the status alone would call somebody who has left a current
supporter — on the one screen that exists to say how much income is dependable. A supporter with no
dunning row at all (older, or hand-imported) is reported as giving rather than as unknown, because
reporting it as a fault sends somebody looking for a problem that is not there.

Anonymous donors are **included**: the charity's own record of its regular income is not a public
listing, and leaving them out would understate it. That is the difference between this screen and
the supporters wall, which answers a different question.

The summary line totals what is coming in monthly from the people **still giving**, and is computed
from those rows rather than the filtered view — a total that changed when you changed a filter would
be a number nobody could trust. It also counts how many are giving without Gift Aid, because on a
regular gift that is 25% a month, for ever.

**When the list cannot be fetched, the screen says so (TASK-458).** The server answers a failure in
JSON too — `500 {"error":"Admin is temporarily unavailable"}`, or `403 {"error":"forbidden"}` for
access removed mid-session — and `authFetch` only stops on a 401. The screen read that body as a
list, found no results in it, and showed an empty table under "0 giving, £0 a month". A false £0 is
worse than an error. `loadMonthly` now throws on any answer that is not OK, as `loadEvents` already
did, so the screen reads "Monthly givers are unavailable." The rows start as `null` rather than an
empty list, because no list is not the same as nobody giving: changing **Show** after a failure
leaves the message in place instead of counting nothing back into a £0 total. A failure also
forgets any list that loaded earlier and clears its total, so figures from a previous visit are
never taken as current, and **Show** cannot bring them back (after a 403, that would redraw names
for someone who has just lost access). A list that did come back empty still reads "0 giving, £0 a
month", because then it is true.

## Admin panels say when they could not load (TASK-476)

TASK-458 fixed Monthly givers; the same fault was in most of the admin. Loaders read the JSON of any
answer, and a failure's `{ error }` has no results in it, so it drew as zeros, an empty list or an
all clear: the Overview said "0 Adjustments due", the GASDS screen said nothing was near its claim
deadline, the pre-send checks said "Everything checks out", and on the ball screen a hold the server
refused for lack of seats said "Held.".

One helper in `assets/js/admin/app.js`, `okJson(res)`, now reads a response only when it is OK and
otherwise throws, so the failure reaches the loader's `catch`. Each `catch` says, in that panel, that
it could not load (built with `unavailableHtml(message)`), and clears any count that sits beside the
list, so nothing from an earlier load is left looking current. A pager is left as it was, because
pressing Next or Older again is how you retry that page. `authFetch` is unchanged:
a 401 still signs you out. A list that did come back empty still says so, because then it is true.

| Panel | On a failure it used to show | Now |
|---|---|---|
| Overview figures (each one on its own) | 0 | Could not load (the other figures still show). A figure from a section your access leaves out (a 403) is left out rather than reported every sign in. Since TASK-508 these are lines in Needs you, which names a part it could not check ("Could not check: Claims"). |
| Overview recent donations | nothing | Recent donations are unavailable. (On a 403: Recent donations are not part of your access.) |
| Donations | No donations yet. | Donations are unavailable. |
| GASDS deadline | No GASDS donations are approaching the claim deadline. | GASDS donations are unavailable. |
| GASDS pool | nothing | The small donations pool is unavailable. |
| Claims: waiting, batches, adjustments | No donations are waiting / No claim batches / No adjustments due | Donations waiting to be claimed / Claim batches / Adjustments are unavailable. |
| Flagged subscriptions | No flagged subscriptions. | Flagged subscriptions are unavailable. |
| Business supporters, Stories, Enquiries, Audit, Email log, Site pages, Team | the empty list | that list is unavailable (or could not load) |
| A donor, story or enquiry opened | a blank record | Could not load this donor (story, enquiry). Please try again. |
| Search | No results. | Search is unavailable. |
| Newsletters: list, blocked addresses, audiences, who is on one | no newsletters, nothing blocked, no audiences, nobody | Newsletters / Blocked addresses / Audiences are unavailable, Could not load who is on this audience. |
| Newsletter pre-send checks (Send panel and the confirmation) | Everything checks out / nothing | Could not run the checks. The checks could not run. Look over it yourself before sending. (The send does not run them itself, so nothing says it does.) |
| Opening a newsletter | "undefined" in the editor | Could not open that newsletter. Please try again. |
| A send's figures, and who it reached | No figures / No per-person record | Could not load the figures / the recipient list. A send from before the send queue (the server answers 404) still says it has no per-person record, because that is true. |
| Thank you, Outreach (list, today, reports, a business, its disclosure, a pasted list), Ticker, My account | empty lists, 0 totals, a blank disclosure | the message each already had for a lost connection |
| Ball: settings, bookings, guest details, menu choices | 0 seats and £0, No menu set yet | Could not load..., and no figures |
| Ball: save settings, hold, chase, week before reminders | Saved. / Held. / Sent undefined emails. | the message each already had for a failure |
| Ball: release a hold, cancel a booking | reloaded as if done | the server's own reason when it refuses (a 4xx, read by `okJsonOrSaid`), such as "Those seats have already been released.", else the general message; then the list reloads so it shows what is really there |

Deliberately left as they were, because empty is harmless there or they already handle a failure:
the permissions read at sign-in (falls back to showing nothing), the enquiries notice (stays hidden
unless something is known to be waiting), the outreach volunteer and donor pickers, the newsletter
preview, the in-flight send strip and send progress, archived audiences and the template library
(both hidden when empty), the menu email button (it reads the server's refusal on purpose), and
Monthly givers and Events, which already check. `test/unit/admin-could-not-load.test.ts` proves each
changed panel both ways: its could not load state on a 500 (and a 403), its real answer on a 200,
and that a 401 still signs you out.

## The location database (TASK-481)

**IP geolocation by DB-IP** ([db-ip.com](https://db-ip.com)). The site analytics uses DB-IP's free
"IP to City Lite" database, licensed under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/);
that licence asks for the credit above, which the analytics page and privacy notice should also show.

It turns a visitor's IP address into a country, region and town at the moment a visit is counted;
the IP itself is then forgotten (see the analytics design,
`docs/superpowers/specs/2026-09-30-site-analytics-design.md`).

- **The reader** is `src/analytics/geo-db.ts`, written here from the published MaxMind DB format
  (<https://maxmind.github.io/MaxMind-DB/>), because the npm registry cannot be reached from where
  this is built. It answers `{ country, region, city }` from `country.iso_code`,
  `subdivisions[0].names.en` and `city.names.en`. It takes IPv4, IPv6, and IPv4 written the way
  Express gives it (`::ffff:203.0.113.9`). A lookup never throws: a malformed address, a private
  one, or one the database does not know answers `null`.
  - **It does not load the file into memory.** The web task has 512 MB and the file is about
    130 MB, so the reader keeps the file open and reads only the few bytes each lookup needs (about
    40 small reads). The operating system caches the busy parts of the file, and that cache gives
    memory back when the app needs it, so the database cannot run the site out of memory. The cost
    is speed: a lookup from disk took about 150 microseconds on a Windows laptop (from memory it
    would be about 2), which is nothing for one lookup per visit.
  - `openGeoDb(pathOrBuffer)` opens a file, read on demand, or bytes already in memory (the
    tests; the same code reads both). It throws if it is not a MaxMind DB. `close()` shuts the file;
  - `loadGeoDbIfPresent(path)` answers `null`, with one warning in the log, when the file is
    missing or unreadable, so the app still starts and simply records no places;
  - `connectGeoDb()` is the start-up wiring: the lookup for `/app/geo/dbip-city-lite.mmdb`, or `null`.
    `src/analytics/start.ts` (`startPlaceLookups`, called from `src/index.ts` once the server is
    listening) hands it to the counting's `setPlaceResolver`, so visits record a town (TASK-482).
- **Fetching it.** The file is not in the repo. The Docker build downloads it in a `geo` stage of
  its own, with `scripts/fetch-geo-db.mjs` (Node's own fetch and gzip, so no curl): this month's
  `https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz`, else last month's (DB-IP
  publishes early each month, so on the 1st this month's may not be there yet). It unpacks it to
  `/app/geo/dbip-city-lite.mmdb` and checks it really is a MaxMind DB. Each attempt has two
  minutes, from asking to the last byte, so a stalled server cannot hang a build. If both months
  fail it prints `geo: WARNING: ...` in the build log and the build carries on without it.
- **Knowing it is there.** After building, the production deploy checks the image has the file. If
  not, the deploy shows a yellow warning ("No location database in the image") but still goes
  ahead: the site works without it, and visits are just counted without places until the next day.
- **Refreshing it.** Every production deploy passes today's date as the `GEO_DAY` build arg
  (`deploy-prod.yml`). The download is cached for the rest of that day, so there is at most one
  download a day however many deploys there are. The first deploy of a new day fetches again, which
  is how a new month's file arrives, and how a failed download or a fallback to last month's file
  (the 1st of a month, before DB-IP publishes) puts itself right. Nothing else refreshes it: weeks
  with no deploys keep the file they have, which is fine for this purpose.
- **PR builds skip it.** `pr.yml`'s image check builds with `GEO_SKIP=1`, which leaves `/geo`
  empty instead of downloading 60 MB on every pull request. Production never passes it.
- **Trying it locally.** Put a copy at `geo/dbip-city-lite.mmdb` in the repo folder (`/geo/` is
  gitignored; never commit it) or leave it out and the app runs without places.
- **Tests** build small `.mmdb` files from invented data with `test/unit/helpers/mmdb-writer.ts`:
  `test/unit/geo-db.test.ts` (IPv4 and IPv6 trees, IPv4 inside IPv6, 24-, 28- and 32-bit
  records, every pointer size, every data type, missing city or region, addresses in no network,
  bad addresses, corrupt files), `test/unit/fetch-geo-db.test.ts` (the month fallback, a bad
  download, and a server that stalls) and `test/unit/dockerfile-geo-db.test.ts` (the Dockerfile stage, the daily build arg, the
  image check in the deploy, and the PR skip).

## New pills in the admin, per person (TASK-478)

A green **New** pill shows on a menu section when it holds something you have not seen yet. On a
phone, the Menu button carries one too whenever any section does. Opening the section clears its
pill for **you only**: the server remembers when each person last opened each section, so a
colleague who has not looked yet still sees theirs. Inside the section, the rows that arrived since
your previous visit carry the same pill for as long as you stay.

| Section | New when, since you last opened it | Row pills |
|---|---|---|
| Contact form | an enquiry arrived | none: the Status column already says New |
| Stories | a story was submitted | none: the Status column already says New |
| Donations | a paid donation arrived | on paid donations, by date |
| Monthly givers | somebody's first monthly gift was paid | by "Since" |
| Business supporters | a business supporter record was created | by name |
| Festive Ball | a booking was paid | by reference |
| Newsletter | somebody signed up on the website (not imports or staff additions) | on "Added", for website sign-ups |
| Events | only when there is a new feature (below) | none |
| Analytics (TASK-482) | only when there is a new feature (below): page views are not news | none |

**The rules** are in `src/admin/whats-new.ts`, tested in `test/unit/whats-new.test.ts`:
- **You only see pills on sections you can open.** Each section uses the same permission as its
  menu link (Business supporters needs business-supporters edit).
- **The first time.** If you have never opened a section, only things that arrived after the pills
  launched (`LAUNCH_AT`), or after your account was made if that is later, count. Launch day does
  not light up years of old records.
- **If a check fails,** that section just shows no pill and the error is logged. The others still
  answer, and a pill only ever appears when something is known to be new.
- **A bank transfer (BACS) gift counts from when it was made, not when it was paid.** It is made
  as pending and turns paid days later, and the donations table does not record when it was paid.
  So if you open Donations in between, that gift will not light the pill. Card gifts are paid when
  they are made.
- **"Since" means at or after, to the millisecond.** Postgres keeps microseconds, but times reach
  the app cut to milliseconds. The database has already found an arrival strictly later, so
  something that came within the same millisecond as your last visit still counts. The first CI
  run failed on exactly that: an account and a sign-up made within one millisecond.

**New parts of the admin get a pill too.** `FEATURES` in `src/admin/whats-new.ts` lists them as
`{ area, added, what }`. **When you ship a new screen, or a change staff should notice, add a line
there.** Everyone whose account is older than it sees a pill on that section until they open it.

**Where it lives:**
- **Table:** `admin_seen (user_id, area, seen_at)` (migration `1790900000001_admin-seen.js`). A
  person's rows go when their account does.
- **Routes:** `GET /api/admin/whats-new` returns `{ areas: [{ area, new, since }] }`.
  `POST /api/admin/whats-new/seen { area }` answers 400 for an unknown section and 403 for one you
  cannot open.
- **Queries:** one "latest arrival since" query per section, in `src/db/whats-new.ts`. The contact
  and stories queries run on their own databases.
- **Browser:** `assets/js/admin/app.js` asks again each time you change section. It records a visit
  only after it has kept that visit's "since" for the row pills, and an answer that was already on
  its way cannot bring back a pill you have just cleared.

**Tests:**
- `test/unit/admin-whats-new-routes.test.ts` covers the routes;
- the "New pills" block in `test/unit/admin-app.test.ts` covers the screen;
- `features/whats-new.feature` covers two admins against a real database: one opens the
  Newsletter, and only theirs clears.

## The admin Overview: Needs you (TASK-508), How we are doing (TASK-509) and Coming up (TASK-510)

The Overview opens with **Needs you**: everything waiting on a person that they may see, most urgent
first, each with a button to the screen that deals with it. Under it, **How we are doing** gives the
numbers, one line each, and **Coming up** the next 14 days. The design is in
`docs/superpowers/specs/2026-10-03-admin-overview-design.md`.

- **Three levels**, marked by a dot (and said in words to a screen reader), in this order:
  1. **Money or overdue** (crimson):
     - bank transfers overdue;
     - monthly gifts failing to take;
     - Gift Aid ready to claim, with the amount;
     - emails that failed or bounced in 2 weeks;
     - fundraisers with buckets or tins due back.
  2. **Waiting on a reply** (gold):
     - contact messages;
     - fundraising sign ups, changes to check, fundraisers who say they've finished, requests to do,
       and fundraisers due a call;
     - new stories;
     - businesses due a thank you call;
     - your own business outreach to-dos;
     - generous donors not yet thanked who can be emailed (as the Thank you screen counts them);
     - bank transfers still waiting.
  3. **Slower deadlines** (grey):
     - Gift Aid adjustments, declarations not back, declarations due a review, and records near the
       end of their keep date;
     - GASDS deadlines;
     - Festive Ball guest details still missing, in the 3 weeks before they close.

  Anything at zero is left out. A quiet day says "Nothing needs you right now."
- **One request**, `GET /api/admin/overview` (any session), answers
  `{ updatedAt, needs: [{ key, level, text, view, button }], numbers: [{ key, title, headline, detail, view, button }], failed: [screen names] }`
  (`src/routes/admin-overview.ts`). Each item has the same gate as its own screen. A section the
  person cannot open is never asked for (`gather`, `src/admin/overview-sources.ts`). Each count
  uses the same database function and rule as that screen, so the two cannot disagree.
- **One that fails is named**: "Could not check: Festive Ball". The rest still show, and the list
  never says "Nothing needs you" when it could not tell.
- **The words and order** are one pure list, `NEEDS` in `src/admin/overview.ts`. A new kind of
  waiting item is a line there, plus a reader in the route.
- **Light on the database.** Its sources run at most 3 at a time (`MAX_AT_ONCE`), because the main
  database pool takes 5 and a donor's checkout must not wait behind an Overview. It is read once on
  sign in, and only when the Overview is the screen being shown.
- It is read afresh each time the Overview is opened, and says when ("Updated 9:41"). The five Gift
  Aid figures that used to stand here are lines in level 3. Recent donations, underneath, shows the
  latest 5.

**How we are doing** (TASK-509), each line only for people who may see the screen behind it, worded
by `numbersLines` in `src/admin/overview-numbers.ts`:

- **Money in** (in whole pounds): this month so far against the same days last month, up to the same
  UK time of day (`monthSoFar`; the whole of a shorter last month on the 31st). Split into donations
  (Donations: view), the Festive Ball (Ball: view) and fundraising pages, online and cash paid in
  (Fundraising: view). Each part is read on its own (`src/db/overview-numbers.ts`) and counted as
  its screen counts it: paid gifts less refunds; paid Ball bookings by when they were paid; cash by
  the day it was paid in. Someone who sees only some parts gets only those, and the button opens the
  first of their screens. The parts are rounded and the headline is their sum, so they add up. If a
  part they may see cannot be read, Money in is left out (a short total would read as all of it) and
  "Could not check" names that part.
- **Monthly givers** (Donations: view): how many give and what they give a month, as the Monthly
  givers screen counts them, and who joined and stopped this month. One read serves this and the
  Needs you line for failing gifts.
- **Festive Ball** (Ball: view): seats sold of the room (the ticket report's own count), money taken
  (the Festive Ball dashboard's), seats held for bank transfers, and days to go. Gone once the night
  has passed.
- **Website** (Analytics: view): visitors in the last 7 days against the 7 before, people on the site
  now, and which channel brought the most visits (`readWebsiteGlance`: four of the Analytics
  screen's own queries).
  Left out while counting is switched off.

The numbers share the Needs you pass (`gather`), so the 3 at a time limit covers both, and a number
that cannot be read is named in the same "Could not check". The card is hidden for someone who may
see none of them. Money in's gates are one list (`MONEY_GATES` in the route), used both for the reads
and for knowing whether every part was read.

**Coming up** (TASK-510): today and the 13 days after it, by day ("Today", "Tomorrow", "Wednesday 7
October"), timed things first and earliest first, each with its UK time ("7:30pm") and a button to
its screen (`comingUp` in `src/admin/overview-coming-up.ts`). Each source carries its screen's gate:

- **Events** (Events: view): every event on the Events screen, a draft said to be one ("still a
  draft"), and no time when it is still to be confirmed.
- **Fundraisers' event days** (Fundraising: view): approved fundraisers still on the list. One read
  of the sign ups serves this and Needs you.
- **Newsletters going out at a set time** (Newsletter: view): queued sends with a time, in UK time.
- **The next Festive Ball ticket report** (Events and Festive Ball: view, as its own screen needs;
  a source's `also` gate): worked out with the screen's own `nextSendDay`, and only while the report
  is switched on with someone to send to. Its button opens Events, where the report's panel is.
- **The Festive Ball's dates** (Festive Ball: view): ticket sales open and close, guest details and
  menu choices close, and the night itself, when they are set. A date already done by hand (sales
  opened or closed early) or already past is left out, and the night is shown once when the Events
  screen already lists the Festive Ball that day (`withoutListedNight`).

The card is hidden when nothing this person may see is coming up, and a source that fails is named
in "Could not check" like the rest.

## QR codes for every page (TASK-492)

**Admin → QR codes** makes a QR code for any page of nbcc.scot, for posters, leaflets, table cards,
slides and social posts. The design is in `docs/superpowers/specs/2026-10-02-admin-qr-codes-design.md`.

- **Every page, automatically.** The list comes from the site's one page list (`SITE_PAGES` in
  `src/site/pages.ts`), which also feeds /sitemap, sitemap.xml and Admin → Site pages. A page
  added there gets its QR code with no more work. The Festive Ball, Get involved and Fundraising
  pages are listed even while switched off, marked "Not live yet", so posters can be made before
  launch.
- **Two downloads per code**, named after the page (`nbcc-qr-donate.svg`):
  - **SVG** for printers and designers: it stays sharp at any size;
  - **PNG**, 1200 pixels square, for slides, social posts and documents.

  Codes are black on white with the standard margin and error correction M, the most reliable to
  scan in print. They are drawn by the server with the `qrcode` package (`drawQr` in
  `src/site/qr.ts`).
- **Any other nbcc.scot address** (a spare address from Site pages, say) gets a code from the box
  under the list. A whole address pasted from the browser is taken too. Only paths on nbcc.scot are
  allowed (`qrPath`): a code for somebody else's website is refused.
- **Spare and old addresses keep the tags.** A spare address, and an old address in `_redirects`,
  now send the visitor on with the query string they arrived with (`keepQuery`,
  `src/site/redirect.ts`). So a QR code made for /give still counts its scans as QR code, and a
  newsletter link to an old address still counts as the newsletter. The target is always one of
  our own paths, so the query cannot change where anyone goes.
- **Who:** anyone who can view Site pages (`GET /api/admin/qr-codes` and
  `GET /api/admin/qr-codes/image?path=/donate&format=svg|png`, `src/routes/admin-qr.ts`). Codes
  only point at public pages, so there is nothing private here. The menu item has a New pill the
  first time.
- **Scans are counted.** Each code's link is tagged:
  `https://nbcc.scot/donate?utm_medium=qr&utm_campaign=donate` (`qrLink`).
  - Admin → Analytics files these under a **QR code** channel (`src/analytics/channel.ts`).
  - Its "QR codes scanned" list names the page whose code was scanned (`labelQrScans`).
  - Migration `1791200000030_analytics-qr-channel.js` only widens the `analytics_views` channel
    check to allow `qr`.

## Monthly or one off, on the donations list (TASK-446)

The list could already be narrowed by payment status, which answers *what failed*. It could not
answer *who gives monthly* — the question behind almost everything else: who to thank, who to chase
when a card expires, and how much of the income is dependable.

`GET /api/admin/donations?mode=monthly|once`, and a **Type** control beside the payment-status one.
The two combine, so "monthly and failed" is a question you can ask — which is how you find a
standing order that has stopped without anybody noticing.

An **unrecognised mode returns everything**, checked against the column's own CHECK values rather
than passed through. Passing it on would quietly return an empty list, which reads as "there are no
donations" — a much worse answer to give somebody looking at their own charity's income. Changing
either filter returns to page one, because staying on page 4 of a different list shows an empty
table and looks like the filter found nothing.

## Nothing in the admin scrolls sideways (TASK-442)

Reported twice, and it was one line causing all of it: `.admin-table th, .admin-table td` carried
`white-space: nowrap`. A cell that cannot wrap makes its table wider than its container, and
`.admin-table-wrap`'s `overflow-x` turns that into a scrollbar inside a panel. Content hidden inside
a box is content nobody finds, and on an admin screen that is a job nobody does.

**Four panels had already patched it individually** — `.nl-panel`, `.email-audit-table`, `.fx-table`
and two fulfilment cells. Each looked local and reasonable; together they were the sign that the
default was wrong rather than the panels.

Two changes, because wrapping alone was not enough:

- **`white-space: normal` + `overflow-wrap: anywhere`** stops a long VALUE widening a table.
  `anywhere` rather than `break-word`, and the difference is the whole fix (**corrected in
  TASK-444**): both break a long word that will not fit a line, but only `anywhere` counts that
  break when the browser works out the table's MINIMUM width. With `break-word` an address like
  `isabella.mcfarlane-wetherby@averylongdomainname.example.co.uk` still sized its column as though
  unbreakable, and the table kept demanding more room than its card had. TASK-442 shipped with
  `break-word` and was therefore an incomplete fix; only measuring it showed that up.
- **`table-layout: fixed`** stops a table with too many COLUMNS doing it. Ten columns of padding and
  minimum content measured **1243px inside a 1058px card**; fixed layout makes them share the width
  available rather than demand what they would like. The cost is equal columns unless a table says
  otherwise, so a narrow Id column gets the same share as a long email. A cramped column is
  readable; a column you have to scroll to reach is one nobody looks at. Individual tables can still
  set their own widths, as `.fx-table` does.

Verified by measurement at 1280px and 375px: the sent-letter history and a ten column table both
report `scrollWidth === clientWidth`, and the page itself has no horizontal scroll at either width.
`test/unit/admin-no-sideways-scroll.test.ts` guards it, because the next person to add a table will
copy whatever the base rule says.

## The admin fits a phone (TASK-454)

At 390px every screen of the admin was wider than the phone (535px as reported, 556px when measured
here with a 26-character email address), so a phone zoomed the whole admin out to fit it and every
word on it shrank. Two things did it, and a third broke the rule TASK-442 set, that nothing in the
admin scrolls sideways, inside a box or otherwise:

- **The top bar could not wrap.** The email, the role badge and both buttons came to 459px on their
  own. The bar now wraps, in two groups (who is signed in, and what they can do), so a narrow screen
  breaks between them rather than leaving "Sign out" on a line of its own. A long email breaks with
  `overflow-wrap: anywhere` instead of setting the width.
- **The menu was a line of twenty buttons that scrolled sideways** below 760px: 2,247px of buttons
  in a 366px strip.
- **So was the Festive Ball's jump bar**: 381px in 358px, with "Send something" off the edge.

Below **860px** (it was 760px) the menu leaves its 210px column and becomes one pinned **Menu**
button that opens the whole list, wrapped into its five groups, every button at least 44px tall.
Pinned, because the complaint that pinned it in TASK-422 still stands: changing section should
never mean scrolling back up a long page. Where closing leaves you depends on why it closed:

| Closed by | Leaves you |
|---|---|
| **Menu** again, or **Escape** | Back where you were when you opened it. Escape also puts you back on the button. |
| **Choosing a section** | At the top of that section, just under the pinned bar, even if you had to scroll down a list taller than the screen to reach it. |
| **Scrolling on past it** without choosing | Exactly where you are, with the pinned button back. Not while it is taking you up to the list, which starts off above the screen. |
| **Turning the screen past 860px** | Where you are; open means nothing at that width. |

Two details are deliberate, and each was found by measuring:

- **Open, the list sits in the page, not pinned over it.** A pinned list taller than the screen
  cannot be scrolled to its end, and a scrollbar of its own would be the box the client has ruled
  out. Opened from further down a long page it takes you up to it. The position is read *before*
  the list opens: opening adds 614px above you and Chrome shifts the scroll position to keep your
  place, so read afterwards it was 614px out. When it closes itself, anything the collapse moved is
  put back, for browsers (Safari) that do not keep your place on their own.
- **Closed with `visibility`, never `display:none`.** TASK-443's `restorableView` treats a menu link
  with no `offsetParent` as a section your permissions hide, and `display:none` leaves every link
  without one, so a refresh on a phone would always land on the Overview.

The jump bar wraps (two rows, 101px, at 390px) and sits at `top:61px` under the menu, and
`.admin-band`'s `scroll-margin-top` is 177px there, so a jumped-to heading clears both bars.

Verified in a real browser on all 21 screens at 320, 360, 375, 390, 768, 860, 861 and 1280px, and
again in headless Chrome emulating a 390px phone (the ticket's own method): `scrollWidth` equals the
viewport width and nothing scrolls sideways, with one exception outside this change: at 320px the
Events page switch button was `flex: none`, 302px wide in a 288px card, so that one screen was 19px
too wide on the smallest phones (**fixed in TASK-455**, which also found the list of events on that
screen scrolling sideways inside its box on a phone: see
[The Events switch fits the smallest phones](#the-events-switch-fits-the-smallest-phones-task-455)).
Every row of the table above was replayed in headless Chrome with smooth scrolling on. Above 860px the
admin is unchanged. `test/unit/admin-fits-a-phone.test.ts` pins the rules and `admin-app.test.ts`
drives the menu's behaviour through the real `app.js`.

## The donations table on a phone (TASK-483)

At 375px the donations table squeezed its nine columns to about 38px each, so every word wrapped
one letter per line. Nothing scrolled sideways, but nothing could be read either. Where the list is
narrower than 760px (about 84px a column), each donation is now a card:
- **the donor's name** is the card's heading;
- **every other fact** is on its own labelled line: ID, Donation, Amount, Gift Aid, Claim, Payment
  and Date (with any New pill);
- **the View button** comes last, at least 44px each way;
- **a gift with no Gift Aid** has no Gift Aid line, matching its empty cell on the desktop table.

This was the client's choice, "A: labelled cards", like Monthly givers. Wide, the table is
unchanged. Because the change measures the list, not the screen, a screen up to about 1030px wide
with the side menu showing also gets cards. That covers a landscape iPad or a narrow laptop window.

**One table, three places.** `donationsTable` in `assets/js/admin/app.js` draws the Donations
screen, the Overview's recent donations and donation search results, so all three change together.

**How it works:**
- **It measures the list itself,** like the Events list: `donationsTable` wraps its table in
  `.dn-list`, a container (`dnlist`). Those three lists sit in different places, so the screen's
  width would be right for one at most.
- **Every cell carries a `data-label`.** The cards show it with `::before`, and the headings are
  hidden in a way screen readers still read.
- **Two differences from the house stack** (`.monthly-table`):
  - The donor is moved to the top with `order:-1`, so the cards depend on the column order.
    `admin-fits-a-phone.test.ts` checks the headings app.js draws.
  - Each line is a row with a fixed-width label, not a grid. In a grid every piece of a cell is
    its own grid item, so the Payment and Gift Aid pills stretched across the column, and a
    date's New pill fell onto a line of its own.
- **The label is 6rem wide,** not 7.5rem: at 320px that leaves room for a date and its New pill on
  one line.

**Checked:**
- **Browser:** 320, 375, 768 (list 720px, so cards) and 1280px (the table, unchanged). `scrollWidth`
  equalled the viewport at every phone and tablet width, and no box scrolled.
- **Tests:** `admin-fits-a-phone.test.ts` pins the CSS. `admin-app.test.ts` checks every cell's label
  on all three lists.

## The Events switch fits the smallest phones (TASK-455)

The one screen TASK-454 left too wide. The switch at the top of **Events** (**Put the page on the
website**, or **Take the page off the website** once it is on) was `flex: none`, so it kept its whole
label on one line however narrow the screen: 302px of button where its card had 246px to give it at
320px, and 317px once the page is on. The Events screen scrolled sideways on the smallest phones, by
19px with the page off and 34px with it on, and up to 360px the button could run out of its card even
where the page itself fitted.

It now shrinks to its card and its label wraps inside it (`flex: 0 1 auto; max-width: 100%`). It only
shrinks when it is alone on its line and wider than the room inside the card's padding, so wherever
it has that room nothing moves: with the page off from 376px, with it on from 391px, and on every
tablet and desktop. The before and after screenshots at 390px with the page off, and at 768 and
1280px either way, are identical, pixel for pixel. Below those widths the label now takes two lines,
including where the old button had squeezed onto one line by running into the card's padding: on a
375px phone (an iPhone SE or mini) either way, and on a 390px phone with the page on.

| Screen | Before, page off | Before, page on | Now |
|---|---|---|---|
| 320px | page 19px too wide | page 34px too wide | fits, the label on two lines |
| 340px | button 15px out of its card | page 14px too wide | fits, the label on two lines |
| 360px | button 16px into the card's padding | button 10px out of its card | fits, the label on two lines |
| 375px | button 1px into the card's padding | button 16px into the card's padding | fits, the label on two lines |
| 390px | fitted | button 0.6px into the card's padding | page off: unchanged. Page on: the label on two lines |
| 391px and wider | fitted | fitted | unchanged |

Two lines there is the rule doing what it says: the button keeps inside the card's padding, like the
words above it. Keeping one line at 375 and 390px would take a slimmer button on phones, and even
then the longer label would only just fit.

Measured in headless Chrome emulating each phone (the ticket's own method), against the real
`admin.html` and stylesheets, with the page off and on: `scrollWidth` equals the viewport width at
every width in the table, and at 393, 412 and 430px. `test/unit/admin-fits-a-phone.test.ts` pins the
rule, the wrapping row it relies on, and that no rule at any width holds the label to one line again.

**Not fixed here: the list of events on the same screen broke on a phone** (**since fixed in
TASK-460**, which found it breaking on tablets and small laptops as well: see
[The Events list where the table does not fit](#the-events-list-where-the-table-does-not-fit-task-460)).
Its five columns are fixed shares of the table's width, and a phone left each share too narrow for
what is in it. At 320px the Date and Website headings broke a letter at a time, the day and time
beside the date badge ran over the event's name, the "On the page" pill stood one letter per line,
and the **Edit** button was 41px wide in a 32px column, so the list scrolled sideways inside its box
by 23px (15px at 390px, none at 768px). The page itself did not widen, which is why measuring the
page's width did not show it.

## The Events list where the table does not fit (TASK-460)

The list of events is a five-column table (Date, Event, Run by, Website, and the button), each
column a fixed share of its width, and it needs the list to be about **850px** wide. TASK-455 found it
breaking on a phone. Measuring every width showed it breaking much wider than that, because from 861px
the side menu takes 210px of the screen:

- **below about 850px** the button breaks its own label: "Ed / it", "O / pe / n";
- **below about 700px** the times break too ("6.30 / pm");
- **below about 520px** the day and time run into the event's name and the list scrolls sideways
  inside its box; on a phone the Website heading and the "On the page" pill stand one letter per line.

So it broke on phones, on most tablets, and on laptops up to about 1150px wide.

**Now, wherever the list is narrower than 900px, each event is a compact row** that reads top to
bottom: the date badge with the day and time, the event's name with its venue and town, "Run by" and
who runs it, then its status and the **Open**, **Edit** or **View** button on one line. The button is
44px tall there, the size the admin holds its other phone controls to. From 900px up the table is
exactly as it was; the before and after screenshots of the list at 1200 and 1280px are identical,
pixel for pixel. In practice that is compact rows on phones, on most tablets and on laptops narrower
than about 1,190px, and the table on anything wider (a large tablet on its side gets the table, and
it fits there).

**Chosen from two prototypes**, both drawn in the real admin with the live events: these compact
rows, or the stack the monthly givers and sent-letter lists use, with each value on its own labelled
line. The stack did not suit this list. Its label column took a third of a phone's width, the venue
fell into the label column (the Event cell holds two lines, which that pattern cannot place), the
button stretched to the full width, and four events took 1,177px of scrolling against 831px.

**Measured on the list, not the screen.** The rules sit in a container query,
`@container evlist (max-width: 899px)`, with `#evList` as the container, because what runs out is the
list's own width, and that depends on the side menu (210px from 861px), the page's padding, its 1280px
cap and the scrollbar. A screen width standing in for it would be about 1,190px today, would drift
whenever any of those changed, and would already be 15px out wherever scrollbars sit over the page
(Macs, iPads, phones). It is the first container query in the admin; a browser without them (iOS
before 16) keeps the table, which is no worse than before. The headings stay in the page for screen
readers, hidden the way the stacked lists hide theirs, and the stylesheet writes in "Run by" because
"NBCC" on its own could mean anything.

The compact rows place each cell by its position, so they follow the columns `evRenderList` draws
(Date, Event, Run by, Website, the button). **A new or moved column must move the compact-row rules
too**; a test fails if the headings change order, so it cannot happen silently.

Verified in headless Chrome with the two events production holds (EmpowHer ’26 and Festive Ball 2026)
plus one of NBCC's own, a scheduled one, a draft and a past one. In the Coming up list at 320, 375,
390, 430, 768, 861, 960, 1024, 1100, 1180, 1200 and 1280px, and in Drafts and Past at 320px: the page
is as wide as the screen, the list never scrolls sideways, nothing sticks out of its cell and no word
breaks mid-word. `test/unit/admin-fits-a-phone.test.ts` pins the rules (its CSS reader now reads
container queries), including that no rule in the list stops its words wrapping and that no other
rule, at any width, changes how its rows and cells lay out. The design, with both prototypes' numbers,
is in `docs/superpowers/specs/2026-09-30-events-list-narrow-layout-design.md`.

## Each Events list row clear on its own (TASK-465)

TASK-460's compact rows hide the list's column headings, and its review found what that left
unclear. The wording is the client's choice.

- **The status says it plainly.** A live event's label said **On the page** where the editor, and
  the switch's own sentence ("Visitors see every event marked 'On the website'"), say **On the
  website**. A scheduled event's **From 14 Oct**, under an event dated 9 Dec with no heading in
  sight, read like the event's own date. They now say **On the website** and **Goes up 14 Oct**,
  the editor's words ("Goes up by itself") and the save message's ("Saved. It goes up on 14 Oct.").
  Draft and Past are unchanged.
- **Each button is named after its event.** The visible text is still **Edit**, **Open** or
  **View**, but a screen reader hears "Edit EmpowHer ’26", with the visible word first so "click Edit"
  still works for speech input. The event open in the editor is marked as the current one.
- **Opening an event no longer reads the list out, or loses your place.** The list redraws itself
  whenever an event opens, so as a live region it was read out again each time, and the redraw took
  away the button just pressed, dropping keyboard focus back to the page. Unlike the admin's other
  table lists it no longer carries `aria-live`. Saving and deleting announce through their own
  status lines, and the message a failed load leaves in the list is now an alert of its own, so
  nothing that needs hearing went quiet. Pressing a row's button now puts focus on the editor's
  heading ("Editing: EmpowHer ’26"), where the page scrolls anyway. Saying no to "leave your unsaved
  changes?" leaves focus on the button you pressed. Arriving on the screen, which opens the soonest
  event by itself, leaves focus where it is.
- **The scroll to the editor respects reduced motion.** It and the **Add an event** button used to
  force a smooth scroll. The page already scrolls smoothly, and turns that off for anyone whose
  device asks for reduced motion, so they now leave it to the page.

`test/unit/admin-app.test.ts` now drives the Events screen through the real `app.js`, and pins:

- the four labels;
- the button names for an editor and for a viewer, which button is marked current, and that an
  event's name stays inside its label however many quotes, ampersands and angle brackets it holds;
- that the list is not a live region, and that a failed load's message is an alert;
- where focus goes when a row's button is pressed, that it stays put when you keep unsaved changes,
  and that arriving on the screen moves nothing;
- that both scrolls to the editor leave smoothness to the page.

Checked in headless Chrome as well: the labels in the table at 1280px and in the compact rows at
320px, and focus on the heading after pressing Edit. The TASK-460 layout checks still pass at every
width. Design: `docs/superpowers/specs/2026-09-30-events-list-row-clarity-design.md`.

## Keyboard focus on the Events screen, finished (TASK-468)

These are the three gaps TASK-465's review found.

- **Deleting leaves you on "Add an event".** Delete hides the editor, and the button that had focus
  goes with it, so keyboard focus used to fall back to the page. It now lands on **Add an event**,
  just above the list. Anyone who may delete may add, so it is always there, and it is the likeliest
  next step. "Deleted." is still announced, and is written just after focus moves, since some screen
  readers (VoiceOver) drop a message that arrives in the same moment as a focus move. A delete that
  fails leaves focus on Delete, which is still there.
- **Arriving never moves focus, even on an empty list.** With no events, the screen opens a blank
  event by itself, and that used to put focus in the name field. Now only pressing **Add an event**
  does that.
- **Each button's name carries the event's date**, visible word first, for example "Edit Red Bag
  packing morning, 18 Sep". Events that share a name, such as a recurring one, no longer sound alike
  to a screen reader. The visible text is unchanged.

`test/unit/admin-app.test.ts` pins all three, and they were checked in headless Chrome: focus in the
name field after "Add an event", focus on "Add an event" after deleting, and the dated names.
Design: `docs/superpowers/specs/2026-09-30-events-screen-focus-design.md`.

## A newsletter test that failed on a busy machine (TASK-470)

The newsletter preview waits until you pause typing for 300ms before redrawing, and
`test/unit/newsletter-builder-ui.test.ts` checks that: no redraw at 200ms, exactly one by 350ms. It
failed now and then, but only when the machine was busy, and it passed on a re-run, which made it
easy to wave through.

The fault was in the tests, not the newsletter.

- **What leaked.** Each test boots its own copy of the admin, and an old copy keeps any timer it had
  started. "Send test to me" adds a block, which starts a 300ms preview timer, and then finishes
  within milliseconds. When that timer fired in the next test, the old copy sent its preview through
  the new test's stub, so the debounce test counted a request it never made.
- **How it was proved.** Each preview request's origin was recorded while the file ran eight copies
  at a time. It failed 3 times in 24 runs, and each time the stray request came from a real timer
  started by an earlier test's copy.
- **The fix.** The file now ends every timer a test started when that test ends. It then passed 48
  runs out of 48 under the same load. The review's instrumented run found 24 of the file's 58 tests
  leaving a timer pending, and this clears them all.
- **Still exposed.** `test/unit/admin-app.test.ts` boots app.js per test the same way, with no such
  cleanup. Its assertions filter for specific URLs, so the risk there is low today.

No code the admin runs changed.

## Saving an editor's access took Contact businesses away (TASK-459)

Editors have been able to use **Contact businesses** since it shipped: TASK-354 put `outreach` in the
server's `OPERATIONAL_EDITOR_SECTIONS`, the sections the editor role edits by default. The browser
keeps its own copy of each role's defaults in `assets/js/admin/app.js`, and that copy never got it.

That copy is what **Team → Manage access** shows for anyone who has never had access of their own,
and what its **Editor** button fills in. So for such an editor the screen said Contact businesses was
**None** while they were using it, and pressing **Save access**, to change something else or nothing
at all, stored that None as their complete access. Contact businesses vanished from their menu, with no
error and nothing on the page to say anything had changed.

The copy now matches. `test/unit/admin-sections-in-sync.test.ts` runs the browser's own
`rolePresetPermissions` for admin, editor and viewer and fails if any differs from the server's
`roleToPermissions`. `test/unit/admin-app.test.ts` opens an editor's access on the real screen,
presses Save, and checks that what is sent is exactly the access they already had.

**Not fixed here: anyone it already happened to.** A saved None cannot say whether it was chosen or
inherited from this fault, so nothing changes anybody's access automatically. Festive Ball had the
same fault for a day: the browser's editor defaults lacked `ball` from TASK-313 (31 August 2026)
until TASK-352 (1 September). The simplest check is the screen itself, now that it tells the truth:
open **Team → Manage access** for each person, and anyone showing Contact businesses, Festive Ball or
Site pages as None who should have it can be set back to what their role gives and saved (and the
Email audit, for the admins who should hold it). Every save is in
`audit_log` as `admin_user.permissions_changed`, with the whole matrix in `data`.

**Not fixed here either: four sections never got their migration (three fixed in TASK-463).**
TASK-406 (3 September) set the rule that each new section ships with a migration giving it to the
matrices already saved (`1788100000000_permissions-business-supporters.js`, and
`1789100000001_permissions-events.js` since). Four sections arrived just before that rule and none had
one: `ball` (Festive Ball, TASK-313, 31 August), then `email-audit` (Email audit, TASK-344), `site`
(Site pages, TASK-352) and `outreach` (Contact businesses, TASK-354), all on 1 September. A matrix saved
before a section arrived, and not changed since, has no entry for it, which reads as None, for admins
as much as anyone. TASK-463 backfills the first, third and fourth; the Email audit is deliberately left
to be granted by hand, because it was asked for so that exactly two named admins hold it.

**And the Editor button could not be saved (fixed in TASK-462).** It filled in only the sections the
editor role names, but a save must name every section, and it left out Business supporters and the
Email audit, which editors do not get. Pressing **Save access** after it said "Could not save that
access.", and had done since the Festive Ball section arrived (TASK-313, 31 August 2026): the
browser's copy had been short of at least one section ever since.

## The Editor button saves (TASK-462)

The **Viewer**, **Editor** and **Admin** buttons on **Team → Manage access** fill the matrix with that
role's defaults, and the save (`PATCH /api/admin/users/:id/permissions`) refuses anything short of
every section. The Viewer and Admin defaults are built from the whole list of sections, which is the
only reason those two buttons worked. The Editor defaults leave out two sections editors get nothing
in, Business supporters and the Email audit, so the Editor button's matrix could never be saved.

Opening somebody's access already filled every gap with **None**. The buttons now go through the same
step (`completePermissions` in `assets/js/admin/app.js`), so whatever the matrix shows is what gets
saved, and the three buttons save exactly the server's `roleToPermissions` for their role, with None
for everything else. `test/unit/admin-app.test.ts` presses each button and saves, and holds the save to
the server's own schema.

## Newsletter links opened a security warning (TASK-466)

Every link in a newsletter is rewritten so a click can be counted, and until this change that was to
`https://links.news.nbcc.scot/…` (the newsletter configuration set in `infra/modules/app/ses.tf`, HTTPS
required). Since the move to Amazon SES on 31 August that name was a bare CNAME to SES's regional tracker,
`r.eu-west-2.awstrack.me`, which answers with its **own** certificate. That certificate does not cover
`links.news.nbcc.scot`, so a reader who clicked any link in a newsletter, Donate included, got the
browser's full-page "Your connection is not private" warning, and the click was never counted. Nothing
in the send path could notice: the mail itself was delivered normally.

An https tracking domain needs a CDN holding the domain's own certificate. That is AWS's documented
setup, and it is what is there now, on a new address, **`click.news.nbcc.scot`**:

- a certificate for `click.news.nbcc.scot` in **us-east-1**, the only region CloudFront reads
  certificates from (so the production root gains an `aws.us_east_1` provider), validated through the
  zone like the site's own;
- a **CloudFront distribution** for that name with SES's tracker as its origin, over https, passing the
  reader's `Host` header through (AWS: "The CDN must pass the Host header supplied by the requester to
  the origin") and caching nothing, because a cached redirect is a click SES never sees;
- `click.news` as an A + AAAA alias to it;
- the newsletter configuration set's tracking domain changed to `click.news`, and only once the new
  address answers (it depends on those records), so nothing sent mid-apply carries a dead link.

**Why a new address rather than fixing `links.news`:** the retired Resend account's CloudFront
distribution still holds the name `links.news.nbcc.scot` (a CloudFront edge asked for it still
presents Resend's certificate for it, issued 26 August), and CloudFront gives a name to one
distribution only, so ours would have been refused (`CNAMEAlreadyExists`). `click.news` was free.

AWS's own check: `curl --head https://click.news.nbcc.scot/favicon.ico` answers **200** with
`x-amz-ses-region: eu-west-2` and `x-amz-ses-request-protocol: https`.
`test/unit/newsletter-click-tracking-https.test.ts` pins the shape for whatever domain the configuration
set names, so it cannot quietly go back to a bare CNAME.

**Not fixed here: the links in newsletters already sent.** The ones sent between 31 August and this
fix carry `links.news` links and still open the warning; their click counts are near zero because the
clicks never arrived, not because nobody clicked. `links.news` is left exactly as it was, since removing
it would only turn those links from a warning into "not found". It could be made to work by having
Resend release the name (or moving it with CloudFront's alias-transfer, which needs a TXT record
proving the domain is ours) and adding it to the same distribution.

## Links in our emails say which email they came from (TASK-480)

So the site analytics can tell a visit from a newsletter or an email apart from someone typing the
address, links to **our own site** in emails gain three words just before the email leaves:

- in a newsletter: `utm_source=newsletter&utm_medium=email&utm_campaign=<the newsletter's id>`;
- in any other email (receipts, Ball confirmations, reminders and so on):
  `utm_source=email&utm_medium=email&utm_campaign=<the email's kind>`, the same kind the email log
  shows, for example `ballConfirmation`. The footer signup welcome names itself `welcome`.
- emails that only ever go to staff (the Ball ticket report, admin invitations, password resets,
  sign in codes, the lapsed subscription notice and backup alerts) are not tagged, so staff clicks
  never count as Email visits. The list is `STAFF_ONLY_KINDS` in `src/email/tracked-links.ts`.

It happens in one place, `sendAndLog` in `src/clients/email.ts`, to the html and the plain text
alike, using the rules in `src/email/tracked-links.ts`. The stored newsletter draft and the admin
preview never carry the words. The admin **test send** is tagged exactly like the real send (by the
newsletter's id, or `draft` before it is first saved), because a test must match the real thing. If
the rewrite ever fails, the email goes out exactly as it was built and the failure is logged.

Left exactly as they are:

- links to any other website, and to `news.nbcc.scot` or its click tracker `click.news.nbcc.scot`;
  "our own site" means `nbcc.scot`, `www.nbcc.scot` and the configured site addresses
  (`PORTAL_BASE_URL`, `BALL_BASE_URL`);
- a link that already has any `utm_` word, which keeps its own;
- unsubscribe and preferences links (and the List-Unsubscribe header), portal links, set password
  and admin links, thank you letters, Ball guest details, business certificates and thank you
  choices, Gift Aid declarations, short links under `/g/`, and hosted files and images;
- any link with a query parameter such as `token`, `t`, `key` or `code`, or with any part that looks
  like a long random string (a UUID, for example the hosted newsletter documents);
- mail, phone and `#` links.

Existing query strings and `#` fragments are kept, spaces or line breaks around a tagged link are
dropped, `&` is written as `&amp;` inside html, and running it twice changes nothing more. Adding query words to links to our own site is the only change: no
sender, host, Reply-To or tracking setting moves, so the deliverability rules are untouched. Tests:
`test/unit/email-tracked-links.test.ts` (the rules) and `test/unit/email-link-tracking-send.test.ts`
(the wiring).

## Enquiries waiting for a reply (TASK-425)

A contact enquiry used to be invisible unless you deliberately opened **Content → Contact form**.
Nothing on the dashboard, no email. Somebody could write to the charity and simply wait.

There is now a notice at the top of **every** admin view when enquiries are outstanding, with a
button straight to them. It is **hidden whenever nothing is waiting**, and that is deliberate: a
strip that is always there reading "0 waiting" becomes furniture, and people stop seeing furniture.

The enquiry table also shows **who replied and when**, under the status pill. `replied_at` and
`replied_by` have been recorded since the feature was built and were never displayed, so that
information was being collected and thrown away. It only matters on the day two people both answer
the same person.

### Three things here are less obvious than they look

**The formatting happens on the server.** `assets/js/admin/app.js` is plain browser JavaScript and
cannot import from `src/`. Formatting the label or the reply summary there would mean two
implementations of one rule, only one of them tested. So `GET /api/admin/contact/unanswered`
returns `{count, label}` already worded, and the list rows carry a ready-made `replied_summary`.
`src/contact/enquiry-summary.ts` is the only implementation, and it is the one under test.

**The month names are ours, not `Intl`'s.** `Intl` is used only to move the instant into UK local
time, which genuinely needs a timezone database. But `en-GB` abbreviates September as "Sept", so
the exact string depends on the ICU data of whichever Node runs it, and a test pinning it would
pass locally and fail in CI. There is a test asserting every month abbreviates to three letters.

**A failed count 500s rather than returning zero.** The bar appears only when we *know* something
is waiting. A broken query reporting an all-clear while enquiries sat unanswered would be worse
than the bar never existing.

### Route ordering

`/api/admin/contact/unanswered` is registered **before** `/api/admin/contact/:id`. Express matches
in registration order, so the other way round captures `unanswered` as an id and 400s it. The same
trap is flagged on the newsletter-template and archived-audience routes. The handler tests call
functions directly and cannot catch it, so `admin-contact-routes.test.ts` inspects the real router
stack instead.

## Resilience and what it costs (TASK-424)

Production runs **one** container and a **single-AZ** database. That is a deliberate trade, made
once, with the numbers in front of us:

| | Per year | What it buys |
|---|---|---|
| Second container | ~$195 | Survives one container dying without a ~1 minute gap |
| Standby database | ~$230 | Automatic failover instead of a ~30 minute restore |

Both were dropped. Neither protects *data* — automated RDS backups, 35-day point-in-time
recovery and the nightly off-site backup all run regardless. What they bought was **uptime**, and
for a charity events site half an hour offline is an inconvenience rather than a crisis.

The residual risk, stated plainly: in a sudden total database failure, up to about **five minutes**
of recent writes could be lost. For donations that is recoverable anyway — Stripe is the source of
truth and redelivers its webhooks, and `stripe_webhook_events` makes the replay idempotent.

### `desired_count` in Terraform is documentation, not control

The ECS service sets `lifecycle.ignore_changes = [task_definition, desired_count]`: CI owns the
running image and scale, Terraform owns everything else. Terraform set `desired_count` once when
it created the service and has ignored it since, and `deploy-prod.yml` passes only
`--task-definition`.

**So editing `desired_count` in `infra/envs/production/main.tf` changes nothing.** It takes effect
only if the service is ever recreated. To change the live count:

```bash
aws ecs update-service --cluster charity-site-production \
  --service charity-site-production --desired-count 1 --region eu-west-2
```

Keep the Terraform value in step with reality anyway, or the next person reads a number that was
never true.

## Running a one-off command in production (TASK-432)

```bash
# in AWS CloudShell, from a checkout of this repo
./scripts/run-oneoff.sh "npm run import:unrecorded"
```

Several of the scripts here are meant to be run by hand against production, occasionally: the Stripe
reconciliation, the historical import, a backup. There was no good way to do that.

The ECS console's **Run task** form is the documented route and it is unusable for this — it wants a
VPC, subnets, a security group and a command override typed in by hand, and the form does not
reliably accept programmatic input. The GitHub Actions route means committing a workflow for every
one-off. Neither is something you would want to do at speed while something is wrong.

`scripts/run-oneoff.sh` runs the command inside the production app container from **CloudShell**,
which already has credentials, and derives *everything* from the service that is already running:
the task definition, the subnets, the security group, the container name, and the log group. There
are no ids to copy out and no Terraform state to read, so it cannot drift out of date with the
stack, and the one-off lands in the same subnets with the same security group as the live app — so
it reaches the database on exactly the same terms the app does.

It waits for the task to stop, prints the container's log output, and **exits with the container's
own exit code**. A task that is killed before the container runs reports no exit code at all; that
is treated as a failure rather than letting an empty value read as success, which is the way this
kind of script usually lies to you.

It does not deploy, does not change the service, and does not touch the running tasks — it starts
one extra task, runs the command, and stops. The image it runs is whatever the service is currently
on, so the command must already have shipped.

## Running a one-off job from Actions (TASK-434)

**Actions → Run a one-off job → Run workflow**, pick the job, read the output in the run log.

The CloudShell route above works right up until the browser session quietly disconnects mid-run —
which is precisely when you are least able to tell whether the job did anything. That happened
while importing the unrecorded supporters: the terminal silently stopped accepting input, and two
runs' output was unreadable, so the state of the charity's financial records was briefly unknown.
It was fine, because the import is transactional and idempotent. It should not have been a question.

This route has no browser in it, leaves an audit trail in Actions, and prints the container's own
output and exit code into the run log.

**`command` is a fixed choice list, never free text.** A `workflow_dispatch` that accepted an
arbitrary string would let anyone with repo write access run any command inside production — a much
bigger hole than the inconvenience it fixes. Adding a job to the list is a reviewed code change, as
it should be.

Like `run-oneoff.sh`, it derives the task definition, subnets, security group, container name and
log-stream prefix from the **running service**, so it cannot drift out of date with the stack. It is
serialised with a `concurrency` group: the import is idempotent but a backup is not something to run
twice at once, and concurrent writers make the log impossible to read afterwards.

## Reconciling Stripe against the records (TASK-429)

```bash
npm run reconcile:stripe    # READ ONLY: writes nothing, to either system
```

RMC Double Glazing (Ayr) Ltd paid £100 a month from 26 May 2026. Five payments, £500, and the
charity had **no donor, no donations, no supporter listing and no contact with them at all.**

Not a bug. They signed up a month before this software existed: the first commit in this repository
is dated 23 June. Stripe took the money and there was nothing on this side to hear about it. It
surfaced only because someone noticed they were missing from the supporters list.

Anyone else who signed up in that window is equally invisible, and nothing in the system would ever
say so. This compares every paying Stripe customer against the donors and subscriptions on record
and reports the difference in pounds.

**Matching** is by subscription id first, then email. Email comparison is case-insensitive and
trimmed, because the live data holds at least one donor in capitals
(`RYAN@THEDESIGNERROOMS.COM`) and a raw string comparison would report a supporter who is already
recorded. Customers who have never paid are omitted: they are not missing income, and a report
padded with non-problems is one people stop reading. A paying customer with no email is reported
and flagged unmatchable rather than dropped.

Importing what it finds is a **separate, deliberate step**, not something this script does.

## Importing what the reconciliation found (TASK-430)

```bash
npm run import:unrecorded              # DRY RUN: prints everything, writes nothing
npm run import:unrecorded -- --commit  # actually writes
```

The reconciliation above found **five** paying customers with no record at all — £660 since late
May. RMC Double Glazing at £100/month, three individuals at £10/month who had received no
thank-you, no receipt and no Gift Aid request in four months, and one £10 test payment made by the
charity itself.

**Dry run by default.** It reads Stripe, works out every donor, donation and supporter record it
would create, checks each against the database, and prints the lot. Nothing is written until
`--commit`. Money entering a charity's financial records does not get to be a one-pass operation.

**The customer list is hardcoded in the script, on purpose.** These five were found by the
reconciliation and classified by a human looking at the names — RMC is a company, three are
individuals, one is the charity's own test. Hardcoding means the script cannot be pointed at an
arbitrary customer by accident, and that "is this a business?" was answered by a person rather than
guessed from the spelling of a name.

### Why it has its own write path

`src/db/historical-import.ts` is deliberately separate from `src/db/donations.ts`. Everything in
`donations.ts` records money as it arrives, stamped `now()`. This is the only place that can write a
donation dated in the past, and it lives apart so backdating is something you go looking for rather
than something the ordinary path can do by accident. A donation recorded on the wrong day is a wrong
number in the accounts — these are dated from the Stripe charge, so the May payment reads May.

### What it will not do

- **It never creates a Gift Aid declaration.** A declaration is the donor's own statement to HMRC;
  creating one on their behalf would be fabricating a legal document. Individuals are *invited* to
  declare, and their declaration can cover past gifts if they choose that scope.
- **It never sets `email_consent` or `thankyou_consent` true.** These five signed up through Stripe
  before any of this existed, so none of them passed through the consent flow. Both columns are
  written `false` explicitly rather than left to default.
- **It sends no email.** `--commit` creates records only. Correspondence is a separate, deliberate
  step — see the individual invite below.
- **It refuses rather than guesses**, and says why: a customer with no email cannot be contacted or
  matched, one with no successful payment is not missing income, a company with no name has nothing
  to be recorded under. Each is skipped *with a reason*, because a silent omission in a financial
  import is the failure mode that matters.

### The supporter record reuses the live writer (TASK-435)

A company's supporter record is written with the same `ensureFulfilmentRecord` the Stripe webhook
uses, and its secure-thank-you-link token is minted with `randomUUID()` in JS, exactly as the
webhook does. The first version generated the token in SQL with `gen_random_bytes()`, which needs
the `pgcrypto` extension — not installed — so it failed against production. Reusing the live writer
also means `ON CONFLICT (donor_id) DO NOTHING` protects a token somebody may already have been sent
a link for, and an imported supporter record is indistinguishable from one the webhook created.

### Running it twice is safe

Idempotent on Stripe's charge id, which is the natural key for "this exact payment". A second run
finds every charge already recorded and creates nothing. An existing donor with the same email is
reused rather than duplicated. Each supporter is written in **one transaction**: either all of their
donations land or none do, because a donor with half their donations is worse than a donor with
none — it looks complete.

Every import appends a `donor.historical_import` audit row, so anyone auditing these donations later
can see why they are dated before the system existed.

## Thanking the three individuals (TASK-438)

```bash
npm run catchup:individuals              # DRY RUN: prints everything, sends nothing
npm run catchup:individuals -- --commit  # actually sends
```

Fiona McIlloney, Mrs I J McFarlane and Jodie McFarlane have each given £10 a month since May. Until
TASK-430 imported them there was no record of any of it, so in four months they had no thank-you, no
receipt and no Gift Aid request. Each gets both, once.

**The recipient list is hardcoded**, like the import that created them, so it can never be pointed
at the whole donor table by accident — which for a script that emails people and opens Gift Aid
declarations is the failure worth designing out.

### Consent, and why nothing is flipped

All three are recorded as **not** having consented to email. That is because they signed up through
Stripe before there was a form to ask them on: **they were never asked, they did not decline**, and
nothing in the database distinguishes those. The charity's decision was that a thank-you for a gift
somebody made, and a question about that same gift, are administrative rather than marketing.

So both go — and the script **never touches their consent flags**. Recording an agreement nobody was
ever asked for would be worse than the silence it is fixing. The letter asks them instead, so any
consent that follows is real. (`deriveSendState` is what marks them "Opted out" in the Thank you
tab; it is advisory, and the send route itself has never gated on it.)

### What the letter says

The amount is the **total given**, not the monthly figure. The automatic business letter uses the
monthly amount because it goes out days after signup with one payment taken; this is a catch-up
covering five months, so the same choice would thank Fiona for a fifth of what she has given.
`giftAided` is always false — nobody has declared, and a letter saying HMRC adds 25% tells somebody
something untrue about their own tax.

### The Gift Aid request

The declaration lifecycle is `not_required → pending → sent → completed`, and **only a donation at
`sent` can be confirmed by the donor**. So `mintDeclarationInvite` stamps a unique token and
`pending`, and the existing `sendDeclarationConfirmation` emails the link and stamps `sent` — or
`undelivered` when the send throws, so a link that never arrived is never mistaken for one that did.
Minting a token and jumping straight to `sent` would have given all three a form that failed on
submit: three people trying to give the charity Gift Aid and getting an error.

A monthly donation's declaration scope is `enduring` (`declarationScopeForMode`), so a declaration
covers what they have already given as well as what follows.

Re-running is safe: `recordThankYouSent` is what stops anybody — a person or the daily pass —
thanking them twice, and a donation already past `not_required` is left alone.

## The off-site copy pointed at a project that did not exist (TASK-450)

Every nightly backup since this was built reported PARTIAL: safe in AWS, never reaching Google
Drive, with `invalid_target` from Google's token exchange.

The cause was not a misconfiguration. **The Google side had never been created.** Opening the console
showed no project called `nbcc-backups` on the account at all, a configured project number of
`84513277257` that matched nothing (eleven digits; Google's are twelve), and the one NBCC project
holding **no workload identity pools and no service accounts whatsoever**.

The values had been taken from a chat message and wired in without ever being checked against the
account. The eleven-digit number should have been the tell.

Now created and verified in project **NBCC / `gen-lang-client-0913308980` / number `278676851676`**:
a pool `aws-nbcc`, an AWS provider `aws-provider` trusting account `049164057909` (ACTIVE), and a
service account `nbcc-backup-writer` that exactly one principal may impersonate:

```
principalSet://iam.googleapis.com/projects/278676851676/locations/global/workloadIdentityPools/
  aws-nbcc/attribute.aws_role/arn:aws:sts::049164057909:assumed-role/charity-site-production-task
```

One assumed role, in one AWS account. A different role, a different account or a laptop cannot
present it. The audience the code builds and the provider Google holds were compared string for
string rather than assumed to match.

**This is an infra change**, so it needs the Infra workflow applied before the task definition
carries the new values. The Drive folder must also be shared with the service account, which is the
one step Google requires a human to do.

## drive.file cannot see a folder you shared with it (TASK-451)

With the federation finally working, every upload still failed with *"Drive folder was not found"* —
while the service account was, verifiably, a **Content manager** on that shared drive.

The message was misleading and the cause was the scope. The token was requested with
`https://www.googleapis.com/auth/drive.file`, on the reasoning that a token which can only touch
files the service account itself created cannot read the rest of the charity's Drive even if stolen.

**The instinct was right and the scope was wrong.** `drive.file` grants access only to files the app
*created*. A folder a human shares with the service account is not one of them, so it is invisible
no matter how correctly it is shared — which reads as a permissions problem and is not one.

Now `https://www.googleapis.com/auth/drive`, and the blast radius is not what that name suggests: a
token is bounded by what the **identity** can reach, and this service account is a member of exactly
one shared drive — the backup one. It has no access to the charity's other files to lose. What keeps
this small is the membership, not the scope string, and the original comment had that the wrong way
round.

Pinned by a test, so nobody tightens it back on the reasoning that a narrower scope must be safer.
It is narrower, and it does not work.

## Proving the backup can be restored (TASK-452)

```bash
npm run verify:restore    # or Actions -> Run a one-off job
```

Everything else proves a FILE is produced and stored in two places. It does not prove the file is
worth anything. **A backup nobody has restored is a hope**, and the way you find out otherwise is the
morning you need it.

This pulls the archive back out of S3, unpacks it with the real passphrase, rebuilds every database
into a **throwaway** copy, counts the rows, compares them to the manifest, and drops the copies.

It restores the archive the **manifest describes**, not today's: verifying a different file from the
one whose row counts you are comparing against would pass or fail for the wrong reasons.

### It cannot write to a live database

That is the whole safety of the exercise, because a restore overwrites its target — so the one
unrecoverable mistake available is pointing it at a real database, destroying the data the backup
exists to protect, using the backup, while checking the backup.

`assertSafeRestoreTarget` refuses anything without the `restorecheck_` prefix, refuses every name in
`BACKUP_DATABASES` (derived from the plan, so a fourth database is protected the day it is added),
and refuses a name that is not a plain identifier. It is called immediately before **every** create,
restore and drop rather than once at the top — a guard you can walk past is not a guard. The
throwaways are dropped in a `finally`, so a failure does not leave a copy of every donor record
sitting beside the real one.

### A missing table is not zero

Counts come from asking the restored database what tables it **has**, not from looking up the
manifest's names. A table that failed to restore is then absent rather than counted as zero against
a name we supplied ourselves — and "no such table" is reported as exactly that. Counts are exact
(`count(*)`), never `n_live_tup`: an estimate that happened to match would prove nothing.

## The Events page (TASK-453)

**Renamed Get involved in TASK-494**, at `/get-involved`, with community fundraisers alongside the
events: see **Community fundraising, the public pages (TASK-494)**. `/events` is now a permanent
redirect there. What follows describes the events part, which is unchanged.

A public page at **`/events`**: every upcoming event as a card in a deck, soonest first, with a face
down "more on the way" card last. The front of a card is the picture and the gist, with the date in
the corner where a playing card keeps its index; the back holds everything else and the booking
button. A card wobbles when a mouse passes over it and turns over when clicked or tapped (keyboard:
the buttons, and Escape to turn back). Nothing scrolls inside a card: both faces share one grid
cell, so a card is as tall as its longer face. Motion is off for anyone who asks their device for
less of it, and without JavaScript the two faces simply stack.

**It ships switched off.** The admin's **Events** section (under Content) has a switch, admins
only, that decides whether the page exists at all. Off: `/events` is a real 404, no menu offers it,
and neither site map lists it. On: the page is served, every page's menu gets "Events" after About
(`src/events/nav-link.ts`, added the way the Festive Ball item is), and both site maps list it.
`/events` is a reserved path, so no spare address can shadow it.

**Building events.** Editors and admins (the new `events` permission section; viewers may look)
fill in an eight-step form: the basics, when, where, a picture (shrunk in the browser like a
newsletter picture, or none, and the card sets its own cover from the name), tickets and booking,
the back of the card, who is running it, and whether it is on the website (now, from a date, or a
draft). A live preview beside the form, and a miniature of the whole page under it, are the real
renderer's output in frames sized to their content.

**The rules** live in one pure file, `src/events/model.ts`, shared by the admin API, the database
layer and the page:

- a picture is an upload (`/media/events/<uuid>`) or one of the site's own images, never a link
  to another website;
- a booking link is a real `https://` address, or a path on nbcc.scot, never anything that could
  run script;
- the corner note is one of a fixed list of true statements (the Code of Fundraising Practice
  rules out invented urgency);
- a draft may be saved half finished, but nothing goes live without a gist, a venue, a booking
  link (unless there is nothing to book) and, for someone else's event, their name;
- an event is on the page up to and including its own day (UK time), then moves to Past.

**One renderer**, `src/events/render.ts`, fills `events.html` (the template's deck holds a
`<!-- events:deck -->` marker) and produces the admin's previews, so staff see exactly what the
public will. Everything typed is escaped; `*stars*` become bold only after escaping.

**Data.** Three new tables (additive): `events_settings` (one row, the switch, off by default),
`events` (a column per form field, with CHECK constraints matching the validation) and
`event_images`. Every change writes its `audit_log` row in the same transaction. The seed migration
adds EmpowHer '26 and the Festive Ball as live events, with the switch still off. `events.html` is
in the Dockerfile's explicit page list.

**EmpowHer's leaflet (TASK-456, taken off in TASK-472).** `1789100000003_events-empowher-leaflet.js` puts the organiser's
leaflet (`assets/img/empowher-2026-leaflet.webp`, since deleted, 1200px wide, cropped out of the screenshot frame
it arrived in) on EmpowHer's card, whole on cream, and brings three details into line with it: Ali
Wright as the evening's host, from Now Radio's Ali and Michael in the Morning; the Wallacetown Drive
address; and "Organised by" on the front, so the card never names two hosts. It is compare and
swap, field by field: a word changes only while it is still the seed's, and the picture goes on
only if the event has none, so nothing staff have changed in the admin is overwritten. `updated_by`
is left alone, so the seed's `down` still removes only rows no person has touched. The tests' seed
helper applies the same rule, so every test renders what production holds;
`test/unit/events-leaflet.test.ts` pins the swap and the picture, and a scenario in
`features/events.feature` proves it lands on the seeded row in Postgres.

Jaimie took the picture off in the admin the same day, keeping the words, and TASK-472 deleted the
file. `1790900000000_events-empowher-leaflet-off.js` takes the leaflet off any database where it is
still exactly the leaflet (a fresh one, since 1789100000003 still puts it on), so no card points at a
missing file; on production it matches nothing. Its `down` does nothing, as there is no file to put back.

Covered by `test/unit/events-model.test.ts`, `events-render.test.ts`, `events-nav-link.test.ts`,
`events-page.test.ts`, the site map and permission tests, and `features/events.feature` (the switch
off and on, date order, drafts and past and not-yet-scheduled events kept off, the admin API's
permissions, validation, audit rows, previews and picture uploads).

## Site analytics (TASK-479)

Counting visits the way Plausible or Fathom do: **no cookies, no banner, nothing stored on the
visitor's device, no IP address stored.** The design is
`docs/superpowers/specs/2026-09-30-site-analytics-design.md`; this is part 1 of 4 (counting). The
email link words (TASK-480), the town and city database (TASK-481) and Admin > Analytics (TASK-482)
follow.

**It ships switched off.** Nothing is kept until an admin turns collecting on
(`analytics_settings.collecting`, default `false`), from the switch at the top of Admin > Analytics
(TASK-482, below). `setCollecting(on, actor)` in `src/db/analytics.ts` writes an
`analytics.collecting_switched` audit row for every change.

**The script.** `assets/js/pulse.js` (under 2 KB, no libraries) is loaded with `defer` on every
public page (index, about, donate, events, ball, ball terms, Gift Aid, contact, My Story,
supporters, hub, privacy, site map, both thank-you pages and the 404), and deliberately not on
admin, the donor portal or set password. It does nothing at all under Do Not Track or Global
Privacy Control. It never touches cookies, localStorage or sessionStorage: the page view's random
id lives in memory only. It sends, by `navigator.sendBeacon` with a `fetch` `keepalive` fallback,
as JSON in a `text/plain` body (so no CORS preflight):

| Event | When | Fields |
|---|---|---|
| `view` | on load | `v` the view's random id (16 hex), `p` the path, `r` the referrer, `u` `{s, m, c}` from `utm_source`, `utm_medium`, `utm_campaign`, `w` the screen width |
| `leave` | when the page is hidden or left | `a` seconds actually visible (capped at 1,800), `s` furthest scroll in percent; sent again only if either grew |
| `click` | a link or button that matters | `k` one of `donate`, `tickets`, `phone`, `email`, `download`, `outbound`; `l` a label (the host for outbound, the file name for a download, the words otherwise), 80 characters at most |

**The endpoint.** `POST /api/pulse` (`src/routes/pulse.ts`, mounted before `express.json` so
its own 2 KB text parser reads every body) **always answers 204 with nothing in it**: kept,
switched off, rate limited, a bot, malformed, too big or a database failure all look the same to
the page. The work is `src/analytics/pulse-handler.ts`, with every rule in its own pure module:

| Module | Rule |
|---|---|
| `src/analytics/pulse-handler.ts` | `sentByOurOwnPage`: an event is dropped unless `Sec-Fetch-Site` is `same-origin` or, when a browser sends no such header, its `Origin` (else `Referer`) is one of our own hosts, so no other website can make its visitors send us made up events. A `DNT: 1` or `Sec-GPC: 1` header is honoured here too, not only by the script |
| `src/analytics/limiter.ts` | 120 events a minute per IP, in memory (the house `createRateLimiter`) |
| `src/analytics/gate.ts` | at most 2 events at the database at once in each task; any more are dropped, never queued, because analytics shares the 5 connection pool with donations |
| `src/analytics/switch-cache.ts` | the switch is remembered 30 seconds in production (read every time elsewhere, so BDD can flip it); a failed read counts as off, and is remembered for 5 seconds so a struggling database is not asked by every event |
| `src/analytics/user-agent.ts` | bots, crawlers, spiders, headless browsers and preview fetchers dropped; device `phone`/`tablet`/`computer`, browser (Chrome, Safari, Edge, Firefox, Samsung Internet, Other), operating system |
| `src/analytics/payload.ts` | the zod shape of the three events; anything else, or over 2 KB, is dropped. A long referrer (1,024) or tracking word (200) is cut to length rather than losing the view |
| `src/analytics/paths.ts` | the path kept is the page's canonical path from the site map (`src/site/pages.ts`), plus `/sitemap`, `/business/thank-you` and `/gift-aid/declare` (every Gift Aid form, never its token), or `other`. The query string is thrown away first |
| `src/analytics/visitor.ts` | the visitor id is `sha256(daily salt + IP + user agent)`, 16 hex characters. The salt is random, made by the first event of each UK day (`analytics_salts`), and deleted the next morning |
| `src/analytics/channel.ts` | the channel, first match wins: newsletter (`utm_source=newsletter` or a referrer on `news.nbcc.scot`), email (`utm_medium=email`), any other `utm_source` (a search engine, a social site, or other websites named after it), search engines (only their real search hosts, so `docs.google.com` is another website), social sites, our own site or a return from paying (a `stripe.com` referrer, or any referrer on `/donate/thank-you`, `/business/thank-you` or `/ball/thank-you`, where a bank's card check page can send people): these keep the channel of the visitor's latest view that day, or direct, any other website (by host), direct. Only the referrer's host is kept |
| `src/analytics/place.ts` | `setPlaceResolver(fn)` and `resolvePlace(ip)`. Records no place until TASK-481 connects the DB-IP database at start-up; a failing lookup records no place rather than losing the view |

The IP address and user agent are used for the limit, the id, the place and the device, and then
forgotten with the request. Neither is stored anywhere.

**The tables** (`migrations/1791000000000_site-analytics.js`, additive):

| Table | Columns |
|---|---|
| `analytics_settings` | one row, `id = 1`: `collecting` (default false), `updated_at`, `updated_by` |
| `analytics_salts` | `day` (date, key), `salt` |
| `analytics_views` | `id`, `view_id` (unique), `at`, `day` (UK date), `path`, `visitor`, `channel` (`newsletter`, `email`, `search`, `social`, `other_websites`, `direct`), `source`, `campaign`, `country`, `region`, `city`, `device`, `browser`, `os`, `active_seconds` (null until a leave), `max_scroll` (null until a leave). Indexed on `day` and `(day, visitor)` |
| `analytics_clicks` | `id`, `view_id`, `at`, `day`, `kind`, `label`. Indexed on `day`. A click is kept only for a view that was |

A repeated view id is ignored; a leave only ever raises `active_seconds` and `max_scroll`.

**Retention.** The daily 8am job (`src/scripts/send-reminders.ts`, its own try/catch) deletes
views and clicks older than 13 months and every salt older than today (`pruneAnalytics`).

**Access.** A new permission section, `analytics`: admins `edit` by role, editors and viewers
`none`, given to anyone else from Team > Manage access. `migrations/1791000000001_permissions-analytics.js`
adds it to every saved matrix that lacks it (admin edit, anyone else none) with an
`admin_user.permissions_backfilled` audit row each, by `migration:TASK-479`, the TASK-463 way.

**The privacy notice** has a new section, "Counting visits", saying all of this in plain words: a record of each page view with no name, email address, IP address or cookie, and a visitor code whose key is deleted after the day, so visits cannot be linked across days or traced back to an IP address once the day is over. (Within the day the salt is in the database, so someone with that day's copy could in principle test likely addresses against it; the notice does not claim otherwise.)

**Tests.** Unit: `test/unit/analytics-*.test.ts` (every channel rule, the path allowlist, the
visitor id across days, user agent and bot reading, the payload, the limiter, the switch cache,
the place seam, the handler, the SQL, the route's 204s, pulse.js itself in jsdom, the pages that
carry it, the retention wiring and the privacy section). BDD: `features/analytics-pulse.feature`
against Postgres, and the backfill scenarios in `features/admin-permissions.feature`.

## Admin > Analytics (TASK-482)

Part 4 of site analytics: the page that shows the numbers TASK-479 counts. Admin > Analytics, in the
Admin group of the menu, shown only to people with the `analytics` permission (admins by role; the
group's label now shows for anyone with Team or Analytics). It carries a New pill (TASK-478) for
everyone who can open it until they first do: `analytics` is an area in `src/admin/whats-new.ts`
with a launch entry in `FEATURES` and no arrivals of its own.

**The switch** sits at the top, as a card like the Events page's. Off, it says what switching on
starts counting and links the privacy notice's "Counting visits" section; on, it says since when and
who switched it. Only `analytics: edit` can flip it (after a confirmation); anyone with view sees it
read only. The change is saved through `setCollecting` (audited) and then
`pulseSwitch.forget()`, so `POST /api/pulse` on the same task takes it up at once rather than within
its 30 second memory.

**The numbers**, for the last 7, 30 or 90 UK days (the chips), each beside the same number of days
before. Today is only part of a day, so like is compared with like: the period runs to now, and the
days before are counted up to the same UK clock time on their last day (`periodsFor`), as the small
print under the chips says. Without that, steady traffic read as a fall every morning. Choosing
another period dims the page and says it is loading until the new numbers arrive; a slower answer
for a period chosen earlier is ignored.

| Panel | What it shows |
|---|---|
| Figures | visitors, visits, page views, and the share of visits that saw one page, each with its change on the period before (a share changes in points) |
| Visitors each day | an inline SVG line (no library) with the period before dashed under it, the day under the pointer on hover, and a sentence for screen readers instead of the drawing |
| Where they came from | visits by channel (Newsletter, Email, Search, Social, Other websites, Direct) as bars with their share; the top other websites by name; the visits each newsletter issue brought, named by the newsletter's subject where the campaign is a newsletter id (TASK-480 tags links with it), else the campaign as it came |
| Where they are | visitors by town or city and by country (named from the ISO code with `Intl.DisplayNames`), with the credit "IP geolocation by DB-IP" linked to db-ip.com, as its CC BY 4.0 licence requires |
| What they looked at | each page: views, visitors, average time on screen and average scroll (both ignore views not yet left), and the share of visits that began there. A table on a desktop, one block per page on a phone |
| What they clicked | clicks by kind (Donate and ticket buttons, phone and email links, downloads, links to other websites) and by each button or link |
| What they used | visitors by phone, tablet or computer, and by browser |
| Right now | people with a page view in the last 5 minutes (today's and yesterday's rows only, so the day index does the work), with "Check again", which asks `/api/admin/analytics/now` alone. While counting is off it says so rather than "0 people" |

**The definitions:** a visitor is a distinct (day, visitor id) pair, so the same person on two days
is two; a visit is one visitor's views on one day, split wherever the gap between two views is more
than 30 minutes, and its first view is its entry page and decides its channel; a one page visit is a
bounce; averages ignore missing values.

**Counted in Postgres, not in Node.** The service is one small task that also takes donations and
Stripe webhooks, so `src/db/analytics-report.ts` does every count in SQL and only small aggregate
rows come back: GROUP BYs, and the visit split as a window function (`lag(at)` over each day and
visitor, a new visit where the gap is over 30 minutes, `lead` to find visits of one view). The period
before needs only its figures and line, so only those are read for it. Queries run one after another,
so analytics never holds more than one of the pool's connections. The longest lists (towns, other
websites, clicked labels) stop at 100. What is left (percentages, days with no visitors, country
names, newsletter labels, the periods) is pure, in `src/analytics/report.ts`.

Nothing scrolls inside a box: a list longer than ten shows its top ten and "Show all" grows the
page. A panel with nothing in it says "Not enough visits yet"; if the numbers cannot be loaded,
every panel says so rather than showing zeros (TASK-476).

**Tests.** Unit: `test/unit/analytics-report.test.ts` (the periods at 9am, across the change from
summer time and just after midnight; the empty days; the bounce share; entry shares; country names;
newsletter labels), `test/unit/admin-analytics-routes.test.ts` (401, 403 for editors and viewers,
view against edit, the audit actor, `forget`, the right now endpoint, bad days and bodies, failures),
`test/unit/admin-analytics-page.test.ts` (the page in the admin's jsdom harness: the nav item and its
New pill, the switch off, on, read only, flipped, cancelled and failed, the chips, the loading state
and a stale answer ignored, the small print, the figures, the line's summary and whole number axis,
every panel filled, empty and failed, stored text shown as text and never as markup, the DB-IP
credit, Show all, Check again on its own, and counting off), and `test/unit/whats-new*.test.ts` (the
analytics area). BDD: `features/analytics-admin.feature` against Postgres (the permission, the
audited switch, and the figures from seeded page views, including a gap of over 30 minutes that
splits a visit and one of exactly 30 that does not).

## Community fundraising (TASK-493)

People sign up at `/fundraise` to raise money for NBCC or to hold an event (a bake sale, a quiz).
Staff approve every one in **Admin > Fundraising** before anything about it is public. An approved,
public, raising money fundraiser gets its own page at `/fundraise/<slug>` with a meter and a
supporter wall, and giving on it goes through the donate page's checkout. Organisers change their
page by an emailed link, and every change waits for staff. Design:
`docs/superpowers/specs/2026-10-02-community-fundraising-design.md`.

This is **stage 1, the backend core**. The public pages (`/fundraise`, `/fundraise/<slug>`,
`/fundraise/manage`, Get involved) are TASK-494, below, and the admin screen is TASK-495, below.
Stages 2 to 4 (materials, keeping in touch, requests) follow.

**It ships switched off.** `fundraising_settings.page_on` is false: sign ups are refused, nothing
is listed, every page is a 404, and the private area is closed, until an admin switches it on with
`PATCH /api/admin/fundraising/settings`.

### Where it lives

| Piece | File |
|---|---|
| The rules: form and edit schemas, slugs, the meter, the wall, what the public sees | `src/fundraising/model.ts` |
| Signing in to the private area (TASK-501; the 24 hour manage link it replaced is gone) | `src/fundraising/sign-in.ts`, `src/db/fundraiser-sign-in.ts` |
| The four emails (pure) and sending them (best effort, after the write) | `src/fundraising/emails.ts`, `src/fundraising/send.ts` |
| The SQL, every write audited in the same transaction (entity `fundraiser`) | `src/db/fundraisers.ts` |
| Public API | `src/routes/fundraise.ts` |
| Admin API | `src/routes/admin-fundraising.ts` |
| Checkout and webhook additions | `src/routes/api.ts`, `src/db/stripe-webhook-model.ts`, `src/db/stripe-webhook.ts` |
| Tables | `migrations/1791200000000_fundraising.js`; access backfill `1791200000001_permissions-fundraising.js`; newsletter source `1791200000002_newsletter-source-fundraise.js`; the address boxes and event questions (TASK-499) `1791200000040_fundraiser-sign-up-details.js`; the private area (TASK-501) `1791200000050_fundraising-private-area.js`; the message after paying (TASK-502) `1791200000060_fundraising-wall-after-paying.js`; news updates (TASK-506) `1791200000100_fundraiser-updates.js`; the form's second round and old page links (TASK-511) `1791200000130_fundraising-form-v2.js`; 18 or over and the split with another cause `1791200000180_signup-age-and-split.js`; team pages `1791200000190_teams.js` |

### Data

`fundraising_settings` (the switch), `fundraisers`, `fundraiser_edits` (changes waiting for staff),
`fundraiser_manage_tokens` (only `token_hash`, the sha256 of the emailed token; no longer written since TASK-501), `fundraiser_cash`
(paid in by hand). `fundraisers.live_email_pending` (TASK-497, boolean, default false) marks a page
holder approved while fundraising is off, waiting for "Your page is live"; its migration
(`1791200000020_fundraiser-live-email-pending.js`) also marks any page holder already approved, if
fundraising has never been switched on. On `donations`: `fundraiser_id`, `supporter_message`, `show_name`,
`show_amount` and `message_hidden`, all nullable or defaulted, so existing gifts are untouched.

**The sign up details (TASK-499, `1791200000040_fundraiser-sign-up-details.js`).** New columns on
`fundraisers`, every one nullable or defaulted, so a sign up made before reads as "not answered":

- where to post things, in separate boxes: `post_line1`, `post_line2`, `post_town`, `post_postcode`
  (a UK postcode, stored upper case with one space). The old single box `post_address` stays and stays
  readable: a sign up from before still shows it in the admin, and a new one leaves it empty;
- the event questions, asked only of someone holding an event and worded like the admin's events
  editor: `card_line` (the line for the front of the card, up to 140), `end_time`, `time_tbc`,
  `venue_address` (up to 300), `venue_postcode`, `access` (a `text[]` of the events model's `ACCESS`
  words, checked by `fundraisers_access_check`), `price` (up to 60), `booking` (`away` tickets on
  another website, `door` pay on the door, `free` just come along, or null when not answered;
  `fundraisers_booking_check`), `ticket_url` (https only), `age_limit`, `dress_code`, `included` and
  `credit_name` (the name on the card as organiser; empty shows their first name and last initial).

Columns rather than one jsonb, so each answer goes through the same field to column map
(`COLUMNS` in `src/db/fundraisers.ts`) as every other staff change, and is audited the same way.
Posters, leaflets, buckets and tins need no column: they are new keys in the existing `wants`
jsonb, `posterCount`, `leafletCount`, `bucketCount` and `tinCount`. A sign up from before the split
holds one number of "leaflets or posters" (`leaflets`) and one of "buckets or tins" (`buckets`);
those keys keep that meaning, are still read, and show in those words everywhere.

**Raised** = paid online gifts on the page, less any refund, plus cash staff recorded. The
percentage is rounded down and can pass 100; the bar is held at 100.

**18 or over, and sharing with another cause (Jaimie, 2026-10-03, `1791200000180_signup-age-and-split.js`).**
Two more yes or no questions on the sign up form, on both paths, with nothing chosen for them:

- "Are you 18 or over?" comes straight after the first question. A No stops the form there (the
  questions after it hide and Send does nothing) with a kind note: "You need to be 18 or over to
  set up a page. Ask a parent, guardian or another grown up you trust to set it up for you: they can
  name you on the page (for example, 'for Ella's 10th birthday'). Any questions, call 01292 811 015
  or email events@nbcc.scot." The server refuses any sign up without `over18: true` (`400`, naming
  `over18`). Stored as `fundraisers.over_18`; the admin shows "Confirmed 18 or over". A staff invite
  or Do it again link never fills it in.
- "Are you sharing what you raise with another cause?" On a Yes, NBCC's whole percentage (1 to 99)
  and the other cause's name (up to 120) are required: `shares_with_other`, `nbcc_share_percent`,
  `other_cause_name`, held together by checks (`fundraisers_split_complete`: both when sharing,
  neither when not). The fundraiser's page (beside the Give button; the give form says "Everything
  you give on this page goes to NBCC. <First name> is collecting the share for <the other cause>
  separately, so if you'd like to support them too, please ask <first name> how.", with the team's
  name on a team page and "the organiser" when the name is a group's (the line above then says "this
  page's total"); an event's says only the first sentence; a page in memory of someone keeps "Everything given on this page goes to NBCC, as NBCC's
  share."), every card on Get involved (an event's card,
  which is the only place an event is public, and a raising money card) and every material that
  carries the charity statement (the A4, A3 and A5 posters, the sponsor form on both pages, which also
  says it is in aid of NBCC and the other cause, the certificate and the five pictures to share) carry
  the statement the Charities and Benevolent Fundraising (Scotland) Regulations 2009 ask for,
  `splitStatement` in `src/fundraising/model.ts`: "60% of what we raise goes to the Night Before
  Christmas Campaign, Scottish Charity SC047995. The rest goes to <the other cause>." Clarity audit
  (2026-10-03): because that reads as if each gift were split, the cards on Get involved, the posters
  and the pictures to share say straight after it "Gifts made on the NBCC page all go to NBCC."
  (`ALL_TO_NBCC`; on a poster or picture only where there is a page to give on; never on anything in
  memory of someone, which is as it was). In the private area a shared page's pay in form says "Only
  pay in NBCC's share (<N>%). The share for <the other cause> goes to them from you." (`split` in `GET /api/fundraise/manage/me`: the percentage and the name, both the
  organiser's own answers), and under "£X raised of your £Y target" every page raising money says
  "Plus £Z Gift Aid. Gift Aid is extra, so it doesn't count towards your target. Gift Aid on paper
  sponsor forms is claimed later and isn't shown here." (without the first sentence when there is no
  Gift Aid yet). A page raising money that is still going also tells a giver "Giving here is sponsoring <first name>.
  Already on <first name>'s paper sponsor form? Then please just hand <first name> the money, so it
  isn't counted twice."; a team page says a gift counts towards the team's total and, once someone has
  joined, where to sponsor one person, with "Includes everything the team members have raised." under its meter; a member's
  page says a gift counts towards theirs "and the team's total too". Every email that names an organiser (an approval, a change, a news update, the automatic emails
  and the team organiser's) greets by the first name they gave, skips a title (Mr, Mrs, Ms, Miss, Dr,
  Rev, Sir, Cllr), and says "Hi there," to a group or a business; the automatic emails' subjects then
  drop the name ("One week to go!") (`organiserFirstName` and `organiserGreeting` in
  `src/fundraising/emails.ts`). The same care is taken in the in memory email 19 (a funeral
  director's business name, or no name, is "Hi there,"), the welcome letter and the in memory covering
  note ("Hello," in place of "Dear The,"), and the lines to staff ("Give The Example Arms a ring").
  On a page for someone under 18 the automatic emails go to their parent or guardian, so a subject
  talks about the child, never to them: "One week to go for Jack!", "Can we give you and Jack a
  hand?" and "Jack is doing great!" (an adult's are "One week to go, Jack!", "Need a hand, Jack?" and
  "You're doing great, Jack!"). Approvals are kept by email, not by its words, so these stay approved. Posters always fit the paper: `posterLogoMm` is the most the logo may
  be and the page gives the logo up (to 10mm at the least) before anything else moves; the QR code is
  66mm on the design and a little smaller only for a shared event, a long way in, or a shared or event
  leaflet (`posterQrMm`); a page address over 52 characters is drawn smaller so it stays on one line
  (`posterAddressPt`). The charity
  statement itself is unchanged. So the longest answers still fit the paper, a shared poster's logo
  may go down to 28mm (the leaflet's QR code to 58mm on the design, the pledge to one line), the
  sponsor form has a row less per page (and fewer on page 1 with a long event name, drawn smaller),
  and a crowded certificate is set closer (`c-tight`); checked by printing the worst case.
- **The lock.** Organisers can never change the split: the private area's changes (`editSchema`)
  and staff's ordinary edit (`adminPatchSchema`) do not take it, and an approved change can only
  write the columns in `COLUMNS`. Only an admin may correct it, with
  `PUT /api/admin/fundraisers/:id/split` (Admin > Fundraising, "Sharing with another cause"), and
  only while the fundraiser has no gifts: `setFundraiserSplit` counts its donations and cash paid in
  under the row's lock, and refuses with `409` once there is any. Every correction is audited
  (`fundraiser.split_changed`, with the split before and after).

All four columns are nullable with no default: a sign up from before was never asked, reads as
null, and shows nothing.

### Permissions

A new admin section, `fundraising`: admins **edit**, editors **edit**, viewers **view** by default,
and the migration writes those into every access matrix already saved (the TASK-479 pattern).
Switching fundraising on or off needs edit **and** the admin role, read live from the database.

### Public API

All JSON. Money is always in **pence**. Dates are `YYYY-MM-DD`, times `HH:MM`.

**`POST /api/fundraise`**: sign up. Body:

```json
{
  "path": "raising | event",
  "kind": "walk",                          // a category on the form now (see "Fundraising categories")
  "title": "Sam's Santa Dash",            // 1 to 100
  "description": "...",                    // 1 to 1,000
  "eventDate": "2026-12-05 or empty",      // required when path is event
  "startTime": "10:30 or empty",
  "venue": "", "town": "",
  "targetPence": 50000,                    // optional, 1000 to 10000000; ignored for an event
  "public": true,                          // show it on the NBCC website, or only to let us know
  "kindOther": "",                         // TASK-511: required when kind is other, up to 80; dropped otherwise
  "firstName": "...", "lastName": "...",   // TASK-511: both required, up to 50 each; "name" is made from them
  "email": "...", "phone": "...",          // required
  "instagram": "@name, name or a link",    // TASK-511: optional; tidied to https://www.instagram.com/<name>
  "facebook": "name or a link",            // TASK-511: optional; tidied to https://www.facebook.com/<path>
  "socialOk": true,                        // TASK-511: required, true or false: we may post about it
  "over18": true,                          // 2026-10-03: required, both paths; anything but true is a 400 naming over18
  "sharesWithOther": false,                // 2026-10-03: required, both paths: sharing what is raised with another cause
  "nbccSharePercent": 50,                  // when sharing: required, a whole number 1 to 99 (digits as text too); dropped otherwise
  "otherCauseName": "...",                 // when sharing: required, up to 120; dropped otherwise
  "wants": { "posterCount": 0, "leafletCount": 0, "bucketCount": 0, "tinCount": 0,   // TASK-499
             "qrCount": 0,                 // TASK-511: printed QR codes, up to 200; 0 for an event
             "shoutOut": false, "attend": false },  // TASK-511: both required, true or false
                                           // printed up to 1,000 each, buckets and tins up to 20
  "postLine1": "...", "postLine2": "", "postTown": "...", "postPostcode": "KA1 1AA",
                                           // line 1, town and a UK postcode required once anything is
                                           // to be posted; kept only then. postAddress is dropped.
  "newsletterOk": false,
  // TASK-499, the event questions: required ones only when path is event, all ignored for raising money
  "cardLine": "...",                       // required for an event, up to 140
  "venue": "...",                          // (above) required for an event
  "endTime": "22:30 or empty",             // after startTime when both are given
  "timeTbc": false,
  "venueAddress": "", "venuePostcode": "", // up to 300; a UK postcode if given
  "access": ["step free entry", "accessible toilets", "a hearing loop", "blue badge parking"],
  "price": "",                             // up to 60
  "booking": "away | door | free",         // required for an event
  "ticketUrl": "https://...",              // required when booking is away; https only; dropped otherwise
  "ageLimit": "", "dressCode": "",         // up to 60 each
  "included": "",                          // up to 300
  "creditName": "",                        // up to 80
  "company": "",                           // the honeypot: leave empty and hidden
  "captchaToken": "..."                    // the Turnstile pass, when GET /api/fundraise/captcha gave a site key
}
```

Answers: `200 { "status": "received" }` (also for a filled honeypot, which stores nothing);
`400 { "error": "...", "fields": { "phone": "Please give us a phone number, so we can call you." } }`
with a plain English message per field; `400 { "error": "captcha" }`; `404` while switched off;
`429` after 5 sign ups from one address in 10 minutes. On success the organiser is emailed a thank
you and `events@` a summary. The thank you is a **fixed message carrying nothing the visitor typed**
(no name, title or description), so the form cannot be used to send any words from NBCC to any
address; everything they told us goes to `events@`. A ticked `newsletterOk` subscribes the organiser
**exactly as the footer form does**: both call `subscribeSelf` (`src/newsletter/self-signup.ts`, moved
unchanged out of `src/routes/subscribe.ts`): the newsletter list, `consent_source` `fundraise` (the
footer's is `footer`; both are self signups and both are welcomed), deduped by address, an
earlier opt out of their own revived, the welcome email with its one click unsubscribe, and
suppressed addresses held back at send time like every newsletter. Unticked changes nothing.

**`GET /api/fundraise/captcha`**: `{ "siteKey": "..." | null }`, the same key as the contact form.

**`GET /api/fundraisers`**: for Get involved. `{ "fundraisingOn": false, "fundraisers": [] }` while
off. Otherwise `{ "fundraisingOn": true, "fundraisers": [Card, ...] }`: approved and public, both
paths, an event dropping off the day after its date. A **Card** is:

```json
{
  "id": 9, "slug": "sams-santa-dash", "path": "raising", "kind": "santa_dash",
  "kindLabel": "Santa dash", "title": "...", "description": "...",
  "eventDate": "2026-12-05" | null, "startTime": "10:30" | null, "venue": "", "town": "",
  "imageSrc": "/media/events/<uuid>" | null,
  "organisedBy": "Sam S.",                 // first name and last initial, or an event's creditName
  "url": "/fundraise/sams-santa-dash" | null,   // null for an event: it has no page
  "cardLine", "endTime", "timeTbc", "venueAddress", "venuePostcode", "access", "price", "booking",
  "ticketUrl", "ageLimit", "dressCode", "included",   // TASK-499: the event answers, for its card
  "meter": { "raisedPence": 6000, "onlinePence": 5000, "cashPence": 1000, "targetPence": 25000 | null,
             "percent": 24 | null, "barPercent": 24 | null, "overTarget": false,
             "giftAidPence": 1250 }    // TASK-502: shown under the total, never part of it
}
```

No email, phone, posting address or social link is ever in a public answer.

**`GET /api/fundraisers/:slug`**: a Card plus
`"wall": [{ "name": "Alex E." | "Anonymous", "amountPence": 2500 | null, "giftAidPence": 625 | null, "message": "..." | null, "createdAt": "ISO" }]`
(newest first, every entry; the page shows the top 10 then Show all; a message staff hid shows as
`message: null` with the gift kept; a gift refunded in full never appears; a giver whose details were
redacted at the end of retention shows as Anonymous) and `"giving": { "fundraiserId": 9, "minimumPence": 200 }`,
and (TASK-502) `"finished": true | false`. `404` unless public, raising money, approved or finished,
and switched on.

**Managing a fundraiser** is the private area since TASK-501: signing in with an emailed code,
then asking for changes (all 19 editable fields, the event details included, each waiting for staff
in `fundraiser_edits` exactly as before; a change already waiting is marked `replaced` and the new one
added, never rewritten in place, so staff never approve words they did not see), paying in and "I've
finished". Its API is documented in **Community fundraising, the private area (TASK-501)**. The
TASK-493 link routes (`/api/fundraise/manage/:token`) answer `410`.

### Giving on a fundraiser's page

`POST /api/checkout-session` takes four more optional fields: `fundraiserId` (positive integer),
`supporterMessage` (up to 200, held to the supporters wall's word check: `400` with "Please choose
different words for your message on the supporter wall."), `showName` (default **false** since
TASK-502) and `showAmount` (default true). Since TASK-502 the give form sends only `fundraiserId`:
the message and the choices are added after paying (see **Community fundraising, giving
(TASK-502)**); the other three are still taken from a page opened before then. With
`fundraiserId` the gift must be one off (`mode: "once"`) and at least 200 pence, and the four are
stamped on the Stripe metadata. **Without `fundraiserId` nothing changes**: the other three are
dropped and the session is exactly what the donate page always got (tested). Everything else
(Gift Aid, the card fee, the newsletter tick box, email, name) is the donate page's.

The webhook links the gift (`donations.fundraiser_id`, message, choices) **only if the id names an
approved or (TASK-502) finished fundraiser**, in the same transaction as the donation, and audits
`fundraiser.gift_received`. Anything else is an ordinary donation with no message, audited as
`fundraiser.gift_not_linked`.

### Admin API

Every route needs a session and the `fundraising` section: **view** to read, **edit** to change.
Every write is recorded in `audit_log` (entity `fundraiser`, the fundraiser's id) in the same
transaction, with the actor `admin:<email>`.

| Route | Body | Answer |
|---|---|---|
| `GET /api/admin/fundraising/settings` | | `{ pageOn, updatedAt, updatedBy, liveEmailsWaiting }`; `liveEmailsWaiting` (TASK-497) is how many page holders wait for "Your page is live", left out if it cannot be counted |
| `PATCH /api/admin/fundraising/settings` (admins only) | `{ pageOn: boolean }` | `{ pageOn, updatedAt, updatedBy }`; switching on then sends "Your page is live" to every approved page holder still waiting, in the background (see Emails) |
| `GET /api/admin/fundraisers` | | `{ pageOn, fundraisers: [Fundraiser + meter + editWaiting] }`, newest first |
| `GET /api/admin/fundraisers/:id` | | `{ fundraiser, meter, waitingEdit, editWaiting, edits, cash, wall }` |
| `PATCH /api/admin/fundraisers/:id` | any of the sign up fields, plus `slug` and `imageSrc` (never `over18` or the split) | `{ fundraiser }`; `409` if the slug is taken, or (TASK-511) was ever another page's |
| `PUT /api/admin/fundraisers/:id/split` (admins only) | `{ sharesWithOther, nbccSharePercent, otherCauseName }`, the sign up's rules | `{ fundraiser }`; `409` "The split cannot be changed now: this fundraiser has had its first gift..." once it has any gift or cash paid in (counted under the row's lock); `400` with `fields`; `403` for anyone but an admin |
| `POST /api/admin/fundraisers/:id/approve` | | `{ fundraiser }`; emails the organiser, or marks a page holder as waiting while fundraising is off (see below); from New or Declined; Event pages: `409` "Give this event a short name first, for its web address." (with `fields.slug`) for an event whose short name staff have not set |
| `POST /api/admin/fundraisers/:id/decline` | `{ reason? }` (internal, up to 500) | `{ fundraiser }`; from New or Approved; no email |
| `POST /api/admin/fundraisers/:id/finish` | | `{ fundraiser }`; from Approved |
| `POST /api/admin/fundraisers/:id/edits/:editId/approve` | | `{ fundraiser }` with the change applied, and "Your update is live" (or "saved") to the organiser; `409` "This change has been replaced; look again" if the organiser saved a newer one |
| `POST /api/admin/fundraisers/:id/edits/:editId/reject` | | `{ fundraiser }`, and "About your update" to the organiser; `409` if already dealt with or replaced |
| `POST /api/admin/fundraisers/:id/cash` | `{ amountPence, paidInOn, note? }` | `201 { cash }` |
| `DELETE /api/admin/fundraisers/:id/cash/:cashId` | | `{ removed }` |
| `POST /api/admin/fundraisers/:id/wall/:donationId/hide` and `/show` | | `{ donationId, hidden }` |
| `GET /api/admin/fundraisers/:id/history` | | `{ history: [{ id, actor, action, data, createdAt }] }`, newest first |
| `POST /api/admin/fundraiser-images` | `{ mime, dataBase64 }` | `201 { id, src: "/media/events/<id>" }`, stored and served like an event picture |

A **Fundraiser** (admin) is every column: `id, slug, path, kind, kindLabel, title, description,
eventDate, startTime, venue, town, targetPence, public, status (new | approved | declined |
finished), name, email, phone, socialLink, socialOk, wants, postAddress, newsletterOk, imageSrc,
declinedReason, createdAt, approvedAt, approvedBy, updatedAt, updatedBy, pageUrl`, and (TASK-499)
`postLine1, postLine2, postTown, postPostcode, cardLine, endTime, timeTbc, venueAddress,
venuePostcode, access, price, booking, ticketUrl, ageLimit, dressCode, included, creditName`.
`PATCH` takes any of them, each checked on its own as the sign up checks it (a postcode, an https
ticket link); `booking: ""` clears the answer. A change to either time is checked, under the row's
lock, against the other time as stored, so the finish never ends up at or before the start: a staff
`PATCH` that would do it is a `400` naming the time changed ("The finish time is before the start."),
an organiser's change that would do it is refused when they send it (`400`) and again if it is
approved later (`409`, nothing written; it can still be rejected). A sign up with no finish time,
as every one from before TASK-499 has, is never refused. `edits` are
`{ id, changes, status (waiting | approved | rejected | replaced), createdAt, decidedAt, decidedBy }`, the
waiting one first. `cash` rows are `{ id, amountPence, paidInOn, note, createdBy, createdAt }`.
`wall` rows (hidden ones included) are `{ donationId, fullName, shortName, anonymous, showName,
showAmount, amountPence, refundedPence, message, hidden, createdAt }`. Refusals are
`{ error }` in plain English: `400` (with `fields`), `403`, `404`, `409`.

Admin > Fundraising has a **New pill** (area `fundraising`, lit by each new sign up). Its line in the
admin's new features list arrives with the screen itself (TASK-495, below).

### The admin screen: Admin > Fundraising (TASK-495)

In Content, after Events. The menu link shows to anyone with `fundraising` view; changing anything
needs edit; the switch needs an admin as well. Markup `#view-fundraising` in `admin.html`, code the
`fr` block in `assets/js/admin/app.js` (`loadFundraising`), styles at the end of
`assets/css/admin.css`. It is built from the admin's own parts: the Events switch card, the Events
status chips and Business supporters' rows that open in place.

- **The switch**, as on Events: an admin can switch fundraising on or off after a question; everyone
  else sees it read only, with "Only an admin can switch fundraising on or off."
- **The list**: every sign up with its name, organiser, raising money or holding an event, date,
  status pill (New, Approved, Declined, Finished) and raised against target. Pills: the per person
  **New** pill (TASK-478) and **Changes to check** when an organiser's change is waiting. Chips
  filter by status, with counts. The first 25 show, then "Show all".
- **One sign up** opens below its row: where it is up to, Approve (from New or Declined), Decline
  (from New or Approved, with an optional reason kept inside NBCC) and Mark finished (from
  Approved), each after a question; its page link and a "Download its QR code" link to
  `/fundraise/<slug>/qr.svg` once it is approved and public (that address is served by the public
  pages, built separately; the core has no admin QR route); the waiting change beside the live
  values with Approve change and Reject change (a `409`, such as a change replaced by a newer one,
  reads the sign up again and shows the server's words); everything from the form, with the phone
  as a `tel:` link, the email as a `mailto:` link and the Facebook or Instagram link opened only if
  it is a web address; their requests and consents; a photo uploaded through
  `POST /api/admin/fundraiser-images` and saved as `imageSrc`; the meter (raised, online, cash, an
  accessible progress bar held at 100); cash paid in (add in pounds, with the date and a note;
  remove after a question; a comma only between thousands, so "12,50" is questioned rather than
  read as £1,250); every field staff may change (the name, kind, path, description, date, time,
  place, target, public, web address, the organiser's name, email, phone and social link, whether
  NBCC may post about it, what they would like and where to post it), sending only what differs
  from the live version, with each message from the server under its own box; the supporter wall with the giver's full name, how it
  shows, Hide and Show (10, then "Show all"); and History in plain words (10, then "Show all").
- **The sign up details (TASK-499).** What they would like shows posters, leaflets, collection
  buckets and collection tins each on their own, and the address from its boxes; a sign up from
  before shows "leaflets or posters", "buckets or tins" and its one address box as it always did,
  and only such a sign up keeps those boxes in the edit form. An event's sign up shows every event
  answer under "What they told us" (the access ticks and how people get in in the events editor's
  words, the ticket link opened only if it is a web address, "Not given" or "None ticked" for a
  sign up from before), and the edit form has **The event's card** with every one of them to
  change. Changing one count sends all of what they would like, as the server takes it whole.
- **Safety**: every stored string is escaped; a `401` signs you out as everywhere else; anything
  that fails to load says it could not load, never that there is nothing. One change at a time:
  from the press until the sign up has been read again its buttons rest and its status line says
  what is happening, so a second press sends nothing; added cash empties the form. A message
  belongs to the sign up it is about and never shows under another. Only the boxes someone typed
  in survive a redraw, and approving an organiser's change forgets them, so Save cannot put old
  words back over it. Keyboard focus survives a redraw too. Approving says the organiser's email
  is on its way, as the server sends it after the approval, best effort.
- **Tests**: `test/unit/admin-fundraising-page.test.ts` (the jsdom admin harness, invented data):
  the menu for each role, the switch, the list and its pills and chips, approve, decline and finish,
  editing and its field messages, the photo, the waiting change, cash and the meter, the wall,
  History, hostile stored text, the keyboard, failures, and no scrolling inside a box.

### Emails

All from and replying to `events@nbcc.scot` (`BALL_FROM_EMAIL`), in NBCC's usual shell, each its own
kind on the Email audit. Built in `src/fundraising/emails.ts`, sent by `src/fundraising/send.ts`.

TASK-497 gave them the wording Jaimie signed off on 2026-10-02: warmer, with a signed close (a
friendly line above "NBCC Team", `signOff` in `src/email/brand.ts`) and then a **"Got any
questions?"** box with "Call us" (01292 811 015, a `tel:` link) and "Email us" (the events inbox, a
`mailto:` link) side by side, equally prominent (`questionsBox`). The staff summary has the sign off
("Go team!") but no box. The plain text part of each carries the same words, the questions (phone
and email) and the sign off. Plain English, no dashes, every stored value escaped.

| Kind | To | When | Says |
|---|---|---|---|
| `fundraiseThanks` | the address typed in the form | they sign up | "Thank you, you've made our day!", what happens next. Greets "Hi there <first name>," only with a safe first name (`safeFirstName`: put together first (NFC), then the first word, Latin letters only, accents included, with apostrophes or hyphens inside, at most 20 characters; another script, a lookalike or an invisible letter is refused), otherwise "Hi there,". No other typed words, since anyone can type any address |
| `fundraiseStaff` | `events@` (Reply-To the organiser) | they sign up | "Exciting news: a new fundraiser!", everything they told us and asked for, Next steps. Staff only, so its links are never tagged |
| `fundraiseApproved` | the organiser | approved with a page (raising money and public) while fundraising is on, or at the switch on (below) | "Your page is live!", the page link and three things to do today |
| `fundraiseApproved` | the organiser | approved with no page (private, or an event) | "You're on our list!" |
| `fundraiseManage` | the organiser | (retired by TASK-501) | the 24 hour link; no longer sent, still named on the Email audit for the rows already there |
| `fundraiseCode` | the email asked for | they ask for a sign in code (TASK-501, email 8) | "Here's your code": the 6 digit code in its box, works for 10 minutes, what is inside the private area, "Didn't ask for this?", "Happy fundraising!". Subject "Your NBCC sign in code: 482 915"; the Email audit keeps the subject without the code |
| `fundraiseFinishedStaff` | `events@` (Reply-To the organiser) | the organiser presses "I've finished" (TASK-501), once | "A fundraiser says they've finished": who, what it has raised, next steps. Staff only, so never link tagged |
| `fundraiseEditApproved` | the organiser | staff approve their waiting change | "Your update is live!" with the page link while their page is up (raising money, public, approved and fundraising on); otherwise "Your update is saved!", with no page link |
| `fundraiseEditRejected` | the organiser | staff reject their waiting change | "About your update": not used yet, we'll give you a ring; "your page is still live" only while it is up, otherwise "everything stays just as it was" |
| `fundraiseInvite` | the person invited | staff send or resend an invite from Admin > Fundraising (TASK-503, email 7) | "We'd love you to fundraise with us!", the personal note in a quote box, **Make my page** to the form filled in with their name and email, signed "Warmest wishes," with the first name chosen under Signed by, then "NBCC Team", and the questions box. Subject "We'd love you to fundraise with us" |
| `fundraiseNewsApproved` | the organiser | staff approve a news update they posted (TASK-506) | "Your news update is live!" with the page link while their page is up; otherwise "Your news update is saved!". "Thanks so much," and the questions box |
| `fundraiseNewsRejected` | the organiser | staff do not use a news update (TASK-506) | "About your news update": not on the page, we'll give you a ring; never the internal reason. "Speak soon," and the questions box |
| `fundraiseSummary` | each address on the Weekly summary list | Mondays at 8am (TASK-503, email 11), or Send a test now (to the admin pressing it, marked as a test) | "Good morning, team!": last week's money, new sign ups, Waiting on us, Coming up, Open the admin, "Have a brilliant week,". Staff only: no questions box, never link tagged. Subject like "Fundraising this week: £1,240 raised, 10 things waiting" |
| `fundraiseSupporterThanks` | a giver the organiser picked, who can be emailed | staff approve the organiser's thank you (TASK-507, email 20), in the background, one at a time | "A thank you from Sam": the organiser's message in a quote box, "And from all of us: thank you too.", "Thanks so much,", the questions box. From and Reply-To the events inbox. See **Thank your supporters (TASK-507)** |

**Approved while fundraising is off.** The old "you're approved, your page will appear when our pages
open" email is retired. A page holder approved while fundraising is off gets no email then: the
approval marks them `live_email_pending` (reading the switch under a share lock, so an approval and a
switch on at the same moment cannot miss each other). When an admin switches fundraising on, the
switch is saved and the admin answered first; then, in the background, `sendWaitingLiveEmails`
claims ONE waiting page holder at a time (`FOR UPDATE SKIP LOCKED`, clearing its mark in the same
statement, so a restart part way loses at most the one in flight and a second switch on emails
nobody twice), reads the switch again before each, and stops if fundraising has been switched off
meanwhile. A send that fails is logged and that fundraiser marked as waiting again, for the next
switch on; nothing about the emails can fail the switch. Declining or finishing clears the mark.
Admin > Fundraising says all this in its questions: approving a page holder while fundraising is off
says nothing is emailed yet, switching on says "Your page is live" goes to the waiting fundraisers
(with how many), and rejecting a change says the organiser is emailed a short, kind note.
Every email goes after its write has committed, best effort: a failed send never fails the answer.

### For the page builders

- Reserve nothing in `src/site/pages.ts` for the API: it is all under `/api`. The pages
  `/fundraise`, `/fundraise/<slug>`, `/fundraise/manage` and `/get-involved` are yours to add; the
  slugs `manage` and `help` (TASK-498) can never be a fundraiser's (`RESERVED_SLUGS`).
- The give form posts the donate page's body to `POST /api/checkout-session` with
  `fundraiserId: giving.fundraiserId`, `mode: "once"`, and the message and choices.
- The QR code is `src/fundraising/qr.ts`, built separately.

### Not yet (stage 1)

A supporter's newsletter tick when giving is the donate page's `emailConsent`, landing on
`donors.email_consent` exactly as a donate page gift does (tested). Approval emails point to the page; the QR code is in the organiser's private area (TASK-501), not attached to the
email. Monthly gifts on fundraiser pages, materials, automatic emails and the requests' tracking are
later stages.

### Tests

Unit: `fundraising-model`, `fundraising-emails`, `fundraisers-db`,
`fundraise-routes`, `admin-fundraising-routes`, `checkout-fundraiser`, `stripe-webhook-fundraiser`,
`fundraising-migration`, `whats-new-fundraising`, `newsletter-self-signup`, `fundraising-send`, `fundraising-qr`, plus the permission, backfill, backup, email kind
and tracked link tests. BDD: `features/fundraising.feature` (approval and the switch, a gift raising
the meter and joining the wall, cash, hiding a message, a gift for an unapproved fundraiser, a
change from the private area waiting for staff, who may do what; TASK-497: a page approved while fundraising is off
hears it is live at the switch on, and the emails about an approved or rejected change). TASK-497
unit tests: `fundraising-emails` (the approved words, the safe first name, the questions box and
sign off in both parts), `fundraising-send`, `fundraisers-db`, `admin-fundraising-routes`,
`fundraiser-live-email-migration`, `admin-email-kinds`.

## Community fundraising, the public pages (TASK-494)

What the public sees of community fundraising (stage 1), built on the API above. Design:
`docs/superpowers/specs/2026-10-02-community-fundraising-design.md`.

**Get involved (`/get-involved`).** The Events page, renamed and widened. The menu item reads "Get
involved" everywhere it is added (`src/events/nav-link.ts`), and `/events` redirects for good,
keeping its query string, so old links and newsletter utm tags still land. The Events switch still
decides whether the page exists. While **fundraising** is also switched on, the page adds:

- every approved, public fundraiser: a raising money one as its own card (photo or a holly cover,
  "Fundraiser" in the corner, organised by, the gist, the **meter**, and a button that opens its
  page; the whole card is a tap target); a "holding an event" one as an ordinary event card,
  credited to its organiser, among NBCC's events by date. Since TASK-499 that card is drawn from
  the event questions (`fundraiserEventRecord` in `src/fundraising/render.ts`): the line for the
  front, the finish time and "(to be confirmed)", the full address with its postcode, the access
  ticks, the price, and how people get in: tickets elsewhere get the events page's **Book tickets**
  button with "Tickets are sold on another website" under it, the door gets "Pay on the door. No
  need to book.", and free gets the events page's "No need to book. Just come along." The age
  limit, dress code and what is included join the description in the note on the back. A sign up
  from before the questions is drawn as it always was, except that it no longer says "No need to
  book. Just come along." (it may well be ticketed): it has no booking line at all. That neutral
  line is `bookingSolo` on the card record (`CardRecord` in `src/events/render.ts`), which the
  events editor never sets, so NBCC's own events render byte for byte as before
  (`test/unit/community-event-card.test.ts` against `test/unit/helpers/card-golden.json`);
- the **chips** All, Events and Fundraisers, which filter the cards without reloading
  (`assets/js/events.js` `initChips`). They ship hidden, so without JavaScript everything shows;
- a **Fundraise for us** button in the intro and a panel under the cards, linking `/fundraise`
  and `/fundraise/manage`; the face down card's invitation also goes to `/fundraise`.

Switched off, the page is exactly the Events page it was: no chips, no fundraisers, no panel, and
not even the fundraising stylesheet (the server adds it where `<!-- getinvolved:styles -->` is,
only while fundraising is on). With fundraiser cards among the events, the hint above the deck says
"Turn any event card over", since a fundraiser's card has one face; and a fundraiser's date sits in
its card's corner only while it is still to come.

**The footer.** Every page's footer sends "Fundraise for us" to `/contact`. While fundraising is
switched on the server points it at `/fundraise` instead (`src/fundraising/footer-link.ts`, added
wherever the menu items are, the Festive Ball pages included through `src/ball/page-decor.ts`); off, pages go out as they are on disk.

**Search listing.** `1791200000010_site-seo-get-involved.js` copies an admin's saved listing choice
for `/events` (`site_page_seo`) to `/get-involved`, once, never over a choice already saved there.

**The meter** (`renderMeter`): raised so far, the target and the percentage, as a
`role="progressbar"` bar with `aria-valuetext` and the same in words. Past the target the bar is
held full and the words give the real percentage; with no target it is just "£X raised".

**The sign up (`/fundraise`).** One page, numbered questions in the donate page's style: raising
money or holding an event (a target only for raising money; a date required for an event), the
name, kind, description (a characters left count), date, time and place, public or not, the
organiser's details, the social media consent, what they would like (posters, leaflets,
collection buckets and collection tins, each its own number; the address boxes, line 1, line 2,
town and postcode, appear only when something is to be posted), and the newsletter tick box worded
like the donate page's. Choosing "I'm holding an event" (TASK-499) also asks the venue (then
required), the finish time and "The time is still to be confirmed", and **For your event's card**:
a line for the front (140 characters, counted down), the full address and how to get there, the
venue postcode, "Access: tick only what the venue has confirmed", the price, how people get in
(the ticket link only for tickets on another website, with a note that NBCC can sell the tickets
if they say so in the description), the age limit, dress code, what is included and "Credit it
to". The browser checks what it can (required answers, postcodes, an https ticket link, a finish
after the start) and the server checks it all again. Honeypot and Turnstile exactly as the contact form: `GET /api/fundraise/captcha`, and
Cloudflare's script loads only once someone starts on the form. Each of the server's `400 { fields }`
messages appears beside its own field; a `404` shows the gentle "not open yet" panel; success shows
a thank you saying what happens next. While fundraising is switched off the server sends the page
with that panel instead of the form.

**A fundraiser's page (`/fundraise/<slug>`)**, drawn on the server so it is complete without
JavaScript and a shared link shows the fundraiser's own title and description: kind, date and
place, organised by, the photo, the story, the meter with a Give button, the **give form**, the
**supporter wall**, **sharing** and the **QR code**.

- The give form is the donate page's: presets (£5, £10, £20, £50) or your own amount (£2 at least,
  from the API), name and email, the newsletter tick box, a message up to 200 characters, show my
  name or stay anonymous, show the amount or not, Gift Aid with the donate page's one off
  declaration word for word (from `src/declarations/wording.ts`) and the home address only once it
  is ticked, and the card fee offer. It posts the donate page's one off body plus `fundraiserId`,
  `supporterMessage`, `showName` and `showAmount` to `POST /api/checkout-session`, and opens Stripe
  on the page when it can and on Stripe's own page otherwise, exactly as the donate page does.
  A refused message (the core checks its words) appears beside the message box.
  `test/unit/fundraiser-checkout-contract.test.ts` feeds the browser's body through the real route.
- **After paying** the giver comes back to the fundraiser's own page, not the donate page's thank
  you. `POST /api/checkout-session` looks the fundraiser up itself (`fundraiserReturnPage`, never an
  address from the browser) and, only while fundraising is on and for one with a public page, sets Stripe's return address to
  `<page>?thanks=1` (`&message=1` if they left a message) and, on Stripe's own page, the cancel
  address to the page itself. The page then shows "Thank you for supporting ..." with the share
  links, saying the message will appear on the wall shortly when there is one; the meter and wall
  catch up when the webhook lands. Anything else, and every donate page gift, comes back exactly
  as before (tested byte for byte in `test/unit/fundraiser-return-url.test.ts`).
- The wall shows the newest ten; Show all grows the page with the rest (no inner scrolling).
- Sharing: copy the link (shown only where copying works), Facebook and WhatsApp as plain links.
  No script from anyone else.
- The QR code (`src/fundraising/qr.ts`) is served at `/fundraise/<slug>/qr.svg`. Since TASK-501 it
  is no longer on the page: it is in the organiser's private area and the admin. The page ends with
  a quiet "Is this your page? Manage it" line linking `/fundraise/manage`.

Anything that is not an approved, public, raising money fundraiser while fundraising is on is the
site's own 404 page.

**Managing a page (`/fundraise/manage`).** Since TASK-501 the organiser's private area, signed in
with an emailed code (below). The page is `noindex`, never cached, sends no referrer, does not load
the visit counter, takes an old link's `?token=` out of the address bar, and is a 404 while
fundraising is switched off.

**Fundraising help (`/fundraise/help`, TASK-498).** A plain reading page for organisers, linked
from the sign up form's intro ("New to fundraising? Read our help page"), with a contents list of
anchor links to: an A to Z of fundraising ideas; paying in what you raise (online gifts come
straight to NBCC; cash and sponsor money by card from the private area, by bank transfer after
calling or emailing for the bank details, which the page never prints, or dropped in by
arrangement; paper sponsor forms sent in for Gift Aid); Gift Aid made simple (25p per £1, the
declaration, enough tax paid, never on raffle tickets, cake sales, event tickets or company
payments); staying safe and legal in Scotland (general information, not legal advice: collection
permits under the Civic Government (Scotland) Act 1982, raffles and lotteries, food, safety, and
saying you are fundraising "for" NBCC); using our logo; and a questions panel with the phone and
`events@nbcc.scot` side by side and a button back to the sign up. Outside links go only to pages
checked by hand (GOV.UK, the Gambling Commission, Food Standards Scotland, the Fundraising
Regulator), pinned in `test/unit/fundraise-help-page.test.ts`. It exists only while fundraising is
switched on, so it merged as a draft for Jaimie to sign off before fundraising opens. Template
`fundraise-help.html` (styles: `pages.css` and the help part of `fundraising.css`); listed in the
site maps under `/fundraise` while fundraising is on.

**Where it lives.** Drawing: `src/fundraising/render.ts` (pure, unit tested). Routes:
`src/routes/fundraise-pages.ts`, added to the site router before its catch-all. Templates:
`events.html` (Get involved), `fundraise.html`, `fundraiser.html`, `fundraise-manage.html`, `fundraise-help.html` (all in
the Dockerfile's page list). Scripts: `assets/js/fundraise.js`, `fundraiser.js`,
`fundraise-manage.js`; styles: `assets/css/fundraising.css` and the Get involved part of
`events.css`. None of it touches `main.js` or `styles.css`, so donate.html's page weight budget is
unchanged. Text boxes grow with what is typed rather than scroll.

**Tests.** `fundraising-render`, `fundraise-pages-routes`, `get-involved-page`,
`fundraise-signup-page`, `fundraiser-page`, `fundraise-manage-page`, `fundraise-help-page` and
`fundraiser-checkout-contract` (unit, jsdom), and `features/fundraising-pages.feature` (the
redirect, Get involved with fundraising on and off, a fundraiser's page (no QR code since TASK-501,
the manage line) and its QR code address, 404s, the sign up while off, the manage page's headers,
the help page on and off).

## Community fundraising, the private area (TASK-501)

`/fundraise/manage` is the organiser's private area (stage 1b part 1, section 3 of
`docs/superpowers/specs/2026-10-02-fundraising-stage-1b-part-1-design.md`). They sign in with a
6 digit code we email; the 24 hour link it replaces is retired. Like everything else in
fundraising, it is all a 404 while fundraising is switched off.

**Signing in.** They put in the email they signed up with. If it belongs to an approved or
finished fundraiser (either path; never one that is new or declined), we email a code (email 8,
`fundraiseCode`). It works for 10 minutes and
allows 5 tries. A right code starts a signed in session for 2 hours, scoped to that email, so an
organiser with more than one fundraiser sees them all. A Sign out button ends it.

**Finished fundraisers stay (Jaimie's decision, TASK-501 review).** Finishing never locks an
organiser out. A finished one is listed as "Finished. Thank you for everything you raised." with its
gifts and messages, its QR code and "Pay in what you collected", so late money still reaches it. It
takes no more changes ("Your fundraiser is finished. To change anything, get in touch.", and the
edit route answers `410` with the same words) and has no "I've finished". Since TASK-502 a finished
fundraiser keeps its public page (and its QR code), still taking gifts: see **Community
fundraising, giving (TASK-502)**.

**Inside, for each of their approved or finished fundraisers:** where it is up to and its public page link
(when it has one); its QR code (an `<img>` of `/fundraise/<slug>/qr.svg` with a download link,
only for a page); what it has raised; the latest gifts and messages exactly as the wall shows them
(a short name or Anonymous, the amount unless hidden, the message unless staff hid it, the date,
first ten then Show all; never a giver's email, full name or anything else); their details to
change; "Pay in what you collected"; and "I've finished".

- **Changing the details.** Everything editable before (story, target, date, start time, where,
  town, social link) plus the event details TASK-499 added, for an event: the line for the front of
  the card, the finish time beside the start, time to be confirmed, full address, venue postcode,
  the access ticks, price, how people get in and the ticket link (shown only for tickets sold on
  another website), age limit, dress code and what's included. A page raising money is asked for a
  target and no event details; an event the other way round (the server refuses them too). Every
  change still waits for staff in `fundraiser_edits`, exactly as before. The server checks the change
  as it would land, what is stored with the change on top (`checkOrganiserEdit` in
  `src/fundraising/model.ts`, reusing `finishTimeProblem`): the finish after the start, a ticket link
  only and always for tickets sold elsewhere (switching away from that clears the stored link with
  the change), and an event card's date, line, venue and way in never emptied. A sign up from before
  the event questions is only held to an answer when that answer is the one being changed.
- **Pay in what you collected.** £1 to £10,000, card fee cover optional. It opens the same Stripe
  checkout every gift uses (`buildPayInSessionParams` in `src/routes/api.ts`): one off, tied to the
  fundraiser, Gift Aid off whatever is sent, no name or message for the wall, no newsletter, and one
  more metadata key, `paidInByOrganiser: "true"`, which only the server ever stamps (the public
  checkout drops it if sent). It comes back to `/fundraise/manage?paid=1` ("Thank you for paying
  in"), or to the private area on a cancel. The checkout closes after 31 minutes (Stripe's shortest
  is 30 from when it is made; the extra minute covers clock drift), so a pay in left open cannot
  complete hours later. The webhook links it to the fundraiser when that is approved **or
  finished**, and stamps `paid_in_by_organiser` whatever happens to the link, so money paid in can
  never pass as the organiser's own gift. It stores it with
  `donations.paid_in_by_organiser = true`, no message and nothing shown: it counts on the meter like
  any paid online gift, never appears on the wall (public or private), and staff see it on the
  admin wall with a "Paid in by the organiser" pill. The receipt email thanks them for paying it in
  ("The £X you paid in for your fundraiser has reached NBCC. Please pass on our thanks to everyone
  who gave.") and never has a Gift Aid line; every other receipt is word for word as before.
  **It is never a gift of theirs:** pay ins are left out of the thank you letter list
  (`listThankYouEligible`), the donor portal's giving history and total (`getDonorDonationHistory`),
  the supporters wall's figures, and the outreach reports, "have they started giving?" check and
  business donor picker. The donor portal never takes a donor row whose only donations are pay ins as
  their main record (`findNewestDonorByEmail` passes over it for the newest row that is not, and only
  falls back to it when every row is like that).
- **I've finished.** Records `fundraisers.finished_requested_at` (the first press is kept), emails
  the events inbox once (`fundraiseFinishedStaff`, staff only so never link tagged, Reply-To the
  organiser), and says "Thank you, we'll be in touch." It finishes and hides nothing: staff still
  press Mark finished. Admin > Fundraising shows a **Says they've finished** pill on the row and the
  date in the detail while it is approved.

**Security.**

- **No enumeration.** `POST /api/fundraise/manage/request` gives exactly the same `200` answer
  whether or not the email is signed up, limited, or fundraising is off, and sends it **before** it
  looks anything up, so the time taken says nothing either. Unknown codes, wrong codes, expired
  codes and used up codes all get the same `401`.
- **The code.** 6 digits from `crypto.randomInt`, stored only as HMAC SHA256 under
  `ADMIN_SESSION_SECRET` with its own domain prefix (`fundraisecode.v1:`) and bound to the email
  (`src/fundraising/sign-in.ts`; the admin email code's approach, no new config). One code per email:
  a new one replaces the last. Every try is counted in the same statement that reads the code
  (`UPDATE ... SET attempts = attempts + 1 ... RETURNING`), before the compare, so tries sent at once
  cannot share a count; the sixth try kills it. Compared in constant time. Deleted once used.
- **Rate limits** (in memory, per task, like the rest of the site). Asking: 3 a quarter hour and 10
  a day per email, 20 a quarter hour per address. Trying: 10 a quarter hour per email, 30 per
  address. With 5 tries a code, guessing one email's codes is about one in twenty thousand a day at
  most. Paying in: 10 checkouts a quarter hour per organiser. Requests made on the box itself
  (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`: local development and the pr.yml BDD suite) are exempt,
  exactly as admin login is (TASK-200); behind the ALB `req.ip` is always the real client address,
  so no outside request can claim it.
- **The session.** A right code always starts a NEW random 32 byte id (any session the browser
  already had is ended, so nobody can fix a session on someone else), stored only as its sha256 in
  `fundraiser_sessions`. The cookie `nbcc_fr_session` is `HttpOnly`, `SameSite=Lax`, `Secure` in
  production (like the ball's), `Path=/api/fundraise/manage`, 2 hours. Sign out deletes it on the
  server and clears the cookie.
- **Cross site requests.** Every private area POST (including asking and signing in) is refused
  with `403` unless it comes from our own page: `Sec-Fetch-Site` must be `same-origin`, or, from a
  browser that sends only `Origin`, that must be one of our hosts. SameSite Lax is the first lock.
- **Only their own.** Every per fundraiser endpoint loads the fundraiser and requires its organiser
  email to be the signed in one (and checks again under the row lock when writing); anyone else's
  is a `404`, never a `403`.
- **Never logged.** Codes and session ids are never logged. Email 8's subject carries the code, so
  its Email audit row keeps "Your NBCC sign in code" instead (`logSubject` in `src/clients/email.ts`).

**The old 24 hour links.** No new links are sent (`fundraiseManage` is still named on the Email
audit for the rows already there). A link already in an inbox no longer opens anything: the page
takes `?token=` out of the address bar and says "Links are no longer used. Put in your email
address below and we will send you a sign in code.", and `GET`/`POST /api/fundraise/manage/:token`
answer `410` saying the same. The `fundraiser_manage_tokens` table is no longer written; it is
dropped in a later release (expand and contract).

**The public page.** The QR code is no longer on a fundraiser's page (no picture, no download
link). `/fundraise/<slug>/qr.svg` still answers, public but unlinked (it only encodes the public
page's address), for an approved or finished fundraiser that has (or had) a page, for the private
area and the admin, which now shows the code itself beside its
download link. The page ends with a quiet line: "Is this your page? Manage it", linking
`/fundraise/manage`. The help page's Paying in section now says to sign in with a code at
nbcc.scot/fundraise/manage.

**Known trade-offs (left as they are).**

- The rate limiters are in memory and per task, like every other limiter on the site: with more
  than one task the limits multiply, and a restart forgets them. A shared limiter is a site wide
  follow up, not this feature's.
- The same origin check lets through a POST that carries neither `Sec-Fetch-Site` nor `Origin`.
  Every browser sends one of them on a POST, so only a non browser client gets through, and it
  carries no visitor's cookie to misuse; it still needs a session of its own.

### API

All under `/api/fundraise/manage`, JSON, `404` while fundraising is off.

| Route | Answer |
|---|---|
| `POST /request` `{ email }` | always `200 { "message": "If that email belongs to an approved fundraiser, we have sent a sign in code to it. It works for 10 minutes." }`; `400` only for something that is not an email; `403` from another site |
| `POST /sign-in` `{ email, code }` | `200 { "status": "signed_in" }` plus the cookie; `401 { "error": "That code does not work. Check it, or ask for a new one." }` for every refusal; `400` for a code that is not 6 digits (spaces and a dash are fine, not counted as a try); `429` over the limits |
| `GET /me` | `200 { "fundraisers": [{ "id", "slug", "title", "path", "status", "public", "pageUrl", "qrUrl", "meter", "editable": {...19 fields}, "waitingEdit", "gifts": [wall entries], "finishedRequestedAt" }] }`; `401` signed out |
| `POST /fundraisers/:id/edit` | any of the 19 editable fields; `202 { "status": "waiting", "edit" }`; `400` with `fields`; `404` not theirs; `410` finished ("Your fundraiser is finished. To change anything, get in touch."), new or declined |
| `POST /fundraisers/:id/finished` | `200 { "status": "thanks", "finishedRequestedAt" }` |
| `POST /fundraisers/:id/pay-in` `{ amountPence, coverFee? }` | approved or finished; `200 { "url" }` to Stripe (closes after 31 minutes); `400` outside £1 to £10,000; `502` if Stripe cannot be reached |
| `POST /sign-out` | `200 { "status": "signed_out" }`, cookie cleared |
| `GET`, `POST /:token` | `410`: the retired links |

### Data (`migrations/1791200000050_fundraising-private-area.js`, additive only)

`fundraiser_sign_in_codes` (email, the code's keyed hash, expiry, tries), `fundraiser_sessions`
(the session id's sha256, email, expiry; both tidied a day after expiry when a session starts),
`fundraisers.finished_requested_at` (nullable), `donations.paid_in_by_organiser` (boolean, default
false, so every existing gift reads false). Both new tables are in the nightly backup's table count.

### Where it lives, and tests

Rules: `src/fundraising/sign-in.ts` (code, hash, session, same origin check) and
`src/fundraising/model.ts` (`editSchema`, `checkOrganiserEdit`, the wall leaving out pay ins). SQL:
`src/db/fundraiser-sign-in.ts`, `src/db/fundraisers.ts` (`listForOrganiser`, `requestEdit` held to
the owner, `markFinishedRequested`, `linkFundraiserGift` for pay ins). Routes: `src/routes/fundraise.ts`.
Emails: `buildSignInCodeEmail`, `buildFinishedStaffEmail` in `src/fundraising/emails.ts`, sent by
`src/fundraising/send.ts`. Page: `fundraise-manage.html` and `assets/js/fundraise-manage.js` (one card
per fundraiser, copied from a hidden pattern with every id given its own ending; works at 390px,
nothing scrolls inside a box). Unit tests: `fundraising-sign-in`, `fundraise-private-routes` (same
answer for an unknown email, limits, cookie flags, a planted session ended, two organisers),
`fundraising-private-db`, `fundraising-organiser-edit`, `fundraising-pay-in`,
`fundraising-code-email-log`, `fundraise-manage-page`, `fundraising-emails`, `fundraising-send`,
`fundraising-render` (no QR, the manage line), `fundraise-help-page`, `admin-fundraising-page`,
`fundraising-private-area-migration`. BDD: `features/fundraising-private.feature` (ask for a code,
sign in, see only your own, ask for a change, someone else's is a 404, sign out; an unknown email
gets the same answer and no email; a wrong code sets no cookie) and `fundraising-pages.feature` (no
QR code on the page, the manage line).

## Community fundraising, giving (TASK-502)

Section 4 and "Finishing" in section 5 of
`docs/superpowers/specs/2026-10-02-fundraising-stage-1b-part-1-design.md`. Three changes to giving
on a fundraiser's page. Donate, the Ball and the admin are untouched (a donate page gift's Stripe
session and receipt are pinned field for field: `test/unit/donate-checkout-pinned.test.ts`).

**Gift Aid shown, never counted.** A gift that claimed Gift Aid shows it beside its amount on the
supporter wall, "£20 + £5 Gift Aid", only when the amount is shown (a hidden amount never shows it;
money paid in is never on the wall). Under the meter's total: "+ £45 Gift Aid", the Gift Aid on every
paid online gift that claimed it, each on what is left after any refund, never on money the organiser
paid in; no line at all when it is nothing. It is the basic rate value: a quarter of the gift,
rounded **down** to whole pence per gift so it is never overstated (`giftAidPence`,
`giftAidOnGifts` in `src/fundraising/model.ts`; the same sum in SQL, `GIFT_AID_SQL` in
`src/db/fundraisers.ts`). The raised figure, the target and the percentage are exactly as before. The
fundraiser cards on Get involved show the same line under their meter.

**The message after paying.** The give form now asks only what the donate page asks (amount, Gift
Aid, the card fee, name, email, the newsletter tick box). The giver comes back to
`/fundraise/<slug>?thanks=1&session_id={CHECKOUT_SESSION_ID}` (Stripe fills in the paid session's id;
`fundraiserReturnUrls` in `src/routes/api.ts`). The thank you then offers an optional step, clearly
marked optional: "Add a message to Robin's wall (optional)", a message box (200 characters, the
same rude words check), "Show my name" (chosen) or "Stay anonymous", "Show how much I gave" (ticked),
"Add to the wall" and "No thanks" (which simply closes it). Until a giver chooses, their gift shows on
the wall as **Anonymous with its amount** (the checkout now stamps `showName: false` when it is not
sent): they never saw a name choice before paying, so their name is never shown without it.

How the step is tied to the payment:

- The page shows the step only when `session_id` looks like Stripe's (`cs_` and letters, digits and
  underscores) and the gift recorded for it can still take one, or is not recorded yet; otherwise,
  or if the gift cannot be read, it is the plain thank you. A page opened before TASK-502 that sent a
  message with the gift (`&message=1`) gets the plain thank you too.
- The page's script takes the id out of the address bar as soon as it loads (it becomes
  `?thanks=1`), so it is never copied, shared, bookmarked or kept in the history; the page is served
  `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: same-origin`.
- **`POST /api/fundraisers/:slug/wall-message`** `{ sessionId, message?, showName?, showAmount? }`
  (both choices default true, as the give form's did) checks, under the gift's row lock, that the
  donation the webhook recorded for that session is on **this** fundraiser, has gone through (a
  Direct Debit still settling is allowed: the wall shows a gift only once it is paid), is not money
  the organiser paid in, and has never been added to (`donations.wall_added_at` is empty, and it
  carries no message from the old give form). It saves once, sets `wall_added_at`, and audits
  `fundraiser.wall_message_added` (actor `giver`). The giver cannot change it afterwards; staff can
  still hide the message as before.
- Answers: `200 { status: "added", entry }` (what the wall now shows for that gift; the page then
  reopens at `?thanks=1&added=1`); `400 { error, fields }` (no or a made up session id, over 200
  characters, or rude words, beside the message box); `404` for another fundraiser's gift, money paid
  in, an unknown session, or a fundraiser with no page (never saying which, or whose); `409 { code:
  "already" }` for a second time; `409 { code: "unpaid" }` for a payment that failed. Before the
  webhook has recorded the payment, Stripe is asked: a completed session for this fundraiser (not a
  pay in) is `409 { code: "confirming", error: "Your payment is still being confirmed. Please try
  again in a moment." }`, anything else `404`, and Stripe out of reach `503`.
- Refused unless it comes from our own page (`Sec-Fetch-Site` or `Origin`, as the private area).
  Limited to 10 in 15 minutes from one address and 5 for one session (loopback exempt, for the BDD
  suite). Nothing about the giver is ever returned beyond what the wall shows; never an email.

Old gifts keep their messages, and a gift that left a message on the old give form can take no
other. Migration `1791200000060_fundraising-wall-after-paying.js` adds the one nullable column,
`donations.wall_added_at`.

**Finished pages still take gifts** (Jaimie: "the link for giving works indefinitely"). A finished
fundraiser that had a page (public, raising money) keeps it at the same address (`hasPage` is now
approved **or** finished), with a "Finished, thank you" box giving the total raised, the meter, the
wall, and the give form under "You can still give". Gifts there link to it and count on its meter
(`linkFundraiserGift`: approved or finished, for supporters' gifts as for pay ins), and come back to
its thank you. It is **not** listed on Get involved (`isListed` is still approved only). New and
declined sign ups are still a 404. Its organiser's private area now links the page, and an update
staff approve for it says "Your update is live", as the page is up.

Tests: `fundraising-giving.test.ts` (the sums, the rules, the drawn page), `fundraising-giving-db.test.ts`
(the SQL), `fundraise-wall-message.test.ts` (the endpoint), `fundraising-giving-migration.test.ts`,
`donate-checkout-pinned.test.ts`, and updates to the page, route, checkout and contract tests; BDD
`features/fundraising-giving.feature`.

## Community fundraising, the team's tools (TASK-503)

Four tools for the staff who look after fundraisers, all in **Admin > Fundraising** (section 5 of
`docs/superpowers/specs/2026-10-02-fundraising-stage-1b-part-1-design.md`). Nothing here adds a
config value: who gets the Monday summary is chosen in the admin and kept in the database.

**Invite someone** (editors and admins). A card under the switch: **First name** and **Surname**
(two boxes, up to 50 characters each, as on the sign up form; it was one "Their name" box split at
its first space until 2026-10-03), their email, an optional personal note (up to 5,000 characters)
and **Signed by**, which starts as the person signed in and lists everyone who can sign in to the
admin, by first name. Send the invite asks first, then emails them (email 7, `fundraiseInvite`)
from and replying to the events inbox, like every other fundraising email, greeting them by the
first name typed. Whoever it is **signed by** is copied in on the email (Cc), at the address they
sign in to the admin with, whoever is signed in and sending it (since 2026-10-04; for one day before
that the copy went to the person signed in). A Resend copies in the same address again: the one
kept on the invite's `fundraiser_invite.sent` audit row, so an invite sent before the change still
copies in whoever sent it. The person signed in gets the copy only when the signer has no usable
address, no address was kept, or (on a Resend) the address kept no longer belongs to someone who can
sign in to the admin; when the address is the person invited, it goes with no copy, a Resend of it
goes with none too, and the invite still stands. Who was copied in (or `null`) is on the `fundraiser_invite.sent` and
`.resent` audit rows, whose actor is always whoever pressed Send or Resend.
For a while, an admin page loaded before the two boxes can still send one `name`: it is split at its
first space, and a single word gets `400 { error: "Please refresh the page and try again." }`. Its button opens `/fundraise?invite=<token>`, and the form fills in their first name,
surname and email exactly as typed, and nothing else (a box they have already typed in is left alone). Below the form,
**Invites not taken up yet** lists each one with "Invited by <first name> on <date>", **Resend**
(a new link, emailed again; the old link stops working) and **Remove** (the link stops working),
each after a question. One whose link has run out (60 days after it was last sent) is marked
**Expired**, with Resend still there to send a new link. A viewer sees neither the card nor the
list.

**Invite types** (Jaimie, B1 + I1). The form's first question is a required drop-down, **What are
you inviting them to do?**, with nothing chosen for staff: Raising money, A team, Hosting an event or
In memory. It is kept on the invite (`fundraiser_invites.invite_type`: `raising`, `team`, `event` or
`memory`; migration `1791200000235_invite-types.js`, one nullable column) and decides two things:

- **where their form opens.** `POST /api/fundraise/invite` also answers `path` (and `team: "team"`
  for a team), and the sign up form opens with that first choice already made: "I'm raising money",
  raising money with "A team" chosen at the team step, "I'm holding an event", or "I'm setting up a
  page in memory of someone" (with the gentle words at the top). They can still change it. The name
  and email are filled in as before; the 18 or over answer, consents and permissions never are;
- **the email's words** (`buildInviteEmail`, `src/fundraising/team-emails.ts`). Raising money is the
  approved invite, unchanged. A team is the same email with one line adapted (a team page and a page
  for everyone who joins). Hosting an event is about their event throughout: its own subject ("We'd
  love to help with your event"), heading, chat line, head start line and button ("Set up my
  event"), and "Your event gets its own page on our website, with a meter, posters and a QR code."
  **In memory is gentle, new wording** with its own subject ("A page in memory of someone you
  love"), greeted "Dear" and not "Hi", with no exclamation marks and none of the cheerful invite's
  words. All four are from, and reply to, the events inbox, greet by first name, show the personal
  note, are signed by the chosen signer and copy in the sender.

The in memory wording is **held for sign off** like new automatic email wording, with the same table
(`touch_wording_approvals`, key `invite_memory`; nothing is seeded as approved). Choosing a type shows
its email to read under "Read the email they will get" (an example, never a real link, signed by the
signer chosen in the form and read again when that changes); for In memory
it opens by itself and says whether it is approved. It is approved, and its approval withdrawn, in
the **All emails** card (admins only; see **All emails, in Admin > Fundraising**), not in the form.
Until it is approved the Send button rests with "The in memory invite wording is waiting for sign
off, so this invite cannot be sent yet." and a link, **Approve it in All emails** (**Read it in All
emails** for an editor, who is told only an admin can approve it), which opens that card at the in
memory invite. The server refuses one all the same (`409`, "The in memory invite wording is waiting
for sign off. Read it and approve it first."), storing and emailing nothing. The form reads the sign
off again when it changes in All emails, so Send wakes up without a reload and what was typed stays. A resend of an in memory invite is held the same way if the
approval is withdrawn, leaving its old link working. The server checks the sign off before it starts
and again inside the transaction that stores or resends the invite, with a lock on the sign off's row
(`SELECT ... FOR SHARE`), so a withdrawal cannot slip in between the check and the send. When the
sign offs cannot be read, Send rests with "We could not check the sign off just now. Try again in a
moment." Approving and withdrawing are in `audit_log` as `fundraising.invite_wording_approved` and
`fundraising.invite_wording_withdrawn`, apart from the automatic emails' own actions.

Before sending, the question names everything: "Send an in memory invite to Mary Smith at
mary@example.com, signed by Jaimie?". The list shows each invite's type as a pill, and the Monday
summary says it ("Mary (in memory), invited by Fern"). Resend keeps the type. An invite from before,
or one sent from an admin page loaded before the drop-down (no `type`), has none and behaves exactly
as it always did.

How the invite link works:

- the token is 32 random bytes (base64url, 43 characters), made fresh for every send and resend;
- only its sha256 (with a `fundraiseinvite.v1:` prefix) is stored, in
  `fundraiser_invites.token_hash`, so a copy of the table opens nothing. The token is never logged,
  never sent back to the admin page, and never put in an address the server logs: the form asks
  for the name and email with `POST /api/fundraise/invite { token }`, and straight after asking
  takes the token out of the address bar and the history (`history.replaceState`, keeping anything
  else in the address), as the private area does. While the token is in the address, `/fundraise`
  is served with `Referrer-Policy: strict-origin`, `Cache-Control: no-store` and `noindex`, so only
  ever our origin leaves as a referrer, never the address with its token, to anyone, our own pages
  included. (`same-origin` would still send it in full to our own server; `strict-origin` also keeps
  the origin the spam check may look at.) A plain visit to `/fundraise` keeps its headers as they
  were;
- it works for 60 days from when it was last sent, and once: the sign up made from it carries the
  token back (`invite` on `POST /api/fundraise`), and that marks the invite used and linked to the
  new sign up in one statement, so two sign ups at once cannot both take it. An unknown, used or
  out of date token all get the same `404`, and the form still works without it;
- each member of staff can send 50 invites and resends in a day (`429` after that), and the form's
  lookup allows 30 tries in 15 minutes from one address. The sign up form's own limit (5 in 10
  minutes from one address) does not apply to requests made on the machine itself (127.0.0.1, ::1),
  exactly as for the admin sign in: behind the load balancer the address is always the real
  visitor's, so only the CI suite and local development arrive that way.

**Time to call.** Like the business supporters' call reminders: every approved fundraiser with a
date gets a **Time to call** pill from a week before its date until somebody records the call, and
again from a week after its date until somebody records that one (a call before that was never
made gives way to the call after, so it only ever asks for one call at a time). Open the
fundraiser, press **Mark as called**, add a note if you like (up to 500 characters) and confirm. Who called
and when shows under it, and its History says "Called". A **Calls due** chip filters the list to
those with a call due. Dates are UK calendar days, so the clocks changing never moves one.

**Take off Get involved?** Four weeks after a fundraiser's date, or as soon as the organiser has
pressed "I've finished" in their private area, an approved fundraiser still on Get involved shows a
**Take off Get involved?** pill, and opening it explains why. **Take it off** (after a question)
only removes it from the Get involved list: its page, its giving link and its QR code keep
working, and it stays Approved. **Put it back on Get involved** undoes it. **Mark finished** works exactly as
before.

**The Monday summary** (admins choose who gets it). The **Weekly summary** card lists the addresses
(up to 10, each checked as a whole email address and kept once), with Add to the list, Remove
(after a question) and **Send a test now**, which sends this week's real summary marked as a test
to the admin pressing it, and nobody else. Editors and viewers do not see the card. At 8am UK time
on a Monday, the daily task (`npm run reminders`, the same scheduled run as the reminders) sends
email 11 (`fundraiseSummary`), one email to each address, from and replying to the events inbox:

- last week's money (Monday to Sunday): online gifts less refunds, what organisers paid in and the
  cash staff recorded, the Gift Aid to claim on last week's gifts (a quarter of each gift after any
  refund, rounded down per gift as the meter's is; never on money paid in), how many are live, and
  what every fundraiser has raised in all. Every pound is in exactly one Monday's summary: a gift
  counts in the week it was **paid** and staff cash in the week it was **recorded**. donations has no
  paid time of its own, so a gift's is the time of its `donation.payment_succeeded` audit row (the
  webhook writes it when a Direct Debit settles, days after the gift was made), or else when it was
  made (a card gift is paid there and then). Cash counts by `fundraiser_cash.created_at`, not the
  day it was paid in, so cash typed in after Monday's summary went appears in the next one;
- the new sign ups;
- **Waiting on us**: sign ups to approve, changes to check, thank yous to check (TASK-507), posters, leaflets, buckets and tins to
  send (the split requests and the old combined ones), shout outs, requests for someone to come
  along (since TASK-505 only those not yet marked sent, done or arranged, and a shout out only with
  their permission to post; plus "N buckets or tins still out (M due back)", or "..., none due back yet", each one due back
  counting as a thing waiting: see **Community fundraising, requests tracked to done**), calls due, invites not taken up after a week (with who invited them; not those whose link
  has expired), fundraisers four
  weeks past their date still on Get involved, those who say they have finished, and (TASK-515) the
  calls to make from the smart call prompts;
- **Coming up**: approved fundraisers dated in the next four weeks.

It goes on Mondays only, and never twice for the same Monday: the week is claimed under a row lock
before anything is sent (`fundraising_settings.summary_last_week`), and given back if no email
went, so a rerun can try again. With nobody on the list nothing happens. A failed email is logged
and the rest still go; nothing in it can stop the passes after it in the daily task.

### Routes

Admin routes need a session and the `fundraising` section; every write is in `audit_log` with the
actor `admin:<email>` (an invite against entity `fundraiser_invite`; a call or taking it off the
list against entity `fundraiser`, so it shows in that fundraiser's History).

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/admin/fundraising/team` | view | | `{ today, me, calls: { <id>: { before, after, due, dueWhich } }, prompts: { <id>: "date" \| "finished" }, invites, signers: [{ id, firstName }], inviteWording: { approvals: { invite_memory?: { approvedAt, approvedBy } }, unavailable } }` (each invite carries `type`, or `null`) |
| `POST /api/admin/fundraising/invites` | edit | `{ firstName, lastName, email, note?, signedBy: <user id>, type?: "raising" \| "team" \| "event" \| "memory" }` | `201 { invite, emailed }`, the signer copied in; `400` with `fields` (`firstName`, `lastName`, `type`, ...); `409` for an in memory invite whose wording is waiting for sign off; `429` after 50 in a day |
| `POST /api/admin/fundraising/invites/:id/resend` | edit | | `{ invite, emailed }`, the type kept; `404` once taken up or removed; `409` for an in memory invite whose wording is waiting for sign off |
| `GET /api/admin/fundraising/invite-wording/:type?signedBy=<user id>` | view | | `{ type, label, subject, html, text, wordingKey: "invite_memory" \| null, approval, approvalsUnavailable }`: that type's invite email as an example, signed by that signer (or by whoever is reading it when none is given); `400` with `fields.signedBy` for a signer who is not on the team; `404` for a type that is not one |
| `POST /api/admin/fundraising/invite-wording/:key/approval` | admin | | `{ approval }`; only `invite_memory`, `404` otherwise |
| `DELETE /api/admin/fundraising/invite-wording/:key/approval` | admin | | `{ withdrawn }` |
| `DELETE /api/admin/fundraising/invites/:id` | edit | | `{ removed }`; `404` once taken up or removed |
| `POST /api/admin/fundraisers/:id/calls` | edit | `{ which: "before" \| "after", note? }` | `{ call }`; `404` with no date |
| `POST /api/admin/fundraisers/:id/off-list` and `/on-list` | edit | | `{ offListAt }`; `409` unless approved |
| `GET /api/admin/fundraising/summary` | admin | | `{ recipients, lastWeek }` |
| `PUT /api/admin/fundraising/summary` | admin | `{ recipients: [emails] }` | `{ recipients, lastWeek }`; `400` naming the address that needs another look |
| `POST /api/admin/fundraising/summary/test` | admin | | `{ sentTo }`, always the admin asking; `502` if it did not go |
| `POST /api/fundraise/invite` | anyone | `{ token }` | `200 { name, firstName, lastName, email, path?, team? }` (`path` and `team` only for an invite with a type: where the form opens; `name` is the two joined, for a page loaded before the two boxes; an invite from before them has its one name split at the first space); `404` for any token that does not work |

The admin's fundraiser now carries `offListAt` and `offListBy`.

### Data (`migrations/1791200000070_fundraising-team.js`, additive only)

`fundraiser_invites` (name, email, note, signed by, sent by, sent and resent, `token_hash`, used
and by which sign up), `fundraiser_calls` (which call, when, who, note; cleared with its
fundraiser), `fundraisers.off_list_at` and `off_list_by` (nullable),
`fundraising_settings.summary_recipients` (a list, empty by default) and `summary_last_week`
(nullable). Both new tables are in the nightly backup's table count.

`migrations/1791200000175_invite-first-last-name.js` (additive only) adds `fundraiser_invites.first_name`
and `last_name` (nullable, up to 50 characters each). `name` stays, written as the two joined; an
invite with no first name falls back to splitting `name` at its first space. No new table, so the
backup's table count is unchanged.

### Where it lives, and tests

Rules (pure): `src/fundraising/invite.ts` (token, hash, 60 days, once, what is filled in),
`src/fundraising/follow-up.ts` (the call dates and the finishing prompt), `src/fundraising/summary.ts`
(the summary's counts and lines, Mondays only). Emails: `src/fundraising/team-emails.ts`, with
`quoteBox` and `signOffAs` added to `src/email/brand.ts`. SQL: `src/db/fundraising-team.ts`.
Sending the summary: `src/fundraising/summary-runner.ts`, from `src/scripts/send-reminders.ts`.
Routes: `src/routes/admin-fundraising-team.ts` and `src/routes/fundraise-invite.ts`. Screen: the
`frTeam` parts of `assets/js/admin/app.js`, `#frInvite` and `#frSummary` in `admin.html`, styles at
the end of `assets/css/admin.css`; the form's lookup is in `assets/js/fundraise.js`. Unit tests:
`fundraising-invite`, `fundraise-invite-routes`, `fundraise-invite-form`, `fundraising-follow-up`
(including the clocks changing), `fundraising-summary` and `fundraising-summary-runner` (fixed
clocks: Mondays only, once a week, nobody to send to, failures), `fundraising-team-emails` (emails 7
and 11, html and text), `fundraising-team-db`, `admin-fundraising-team-routes` (admin, editor and
viewer), `admin-fundraising-team-page` (the jsdom admin harness), `fundraising-team-migration` and
`backup-plan`. BDD: `features/fundraising-team.feature` (an invite fills in the form and the sign up
uses it up; taking a fundraiser off Get involved keeps its page; a viewer cannot record a call; only
an admin chooses who gets the summary).

## Community fundraising, requests tracked to done (TASK-505)

What an organiser asks for on the sign up form (`fundraisers.wants`: posters, leaflets, collection
buckets and tins, each with a number, or the old combined "leaflets or posters" and "buckets or
tins"; a social media shout out; someone from NBCC to come along) is tracked to done in **Admin >
Fundraising**, in a **Requests** part of each sign up. Stage 4 of
`docs/superpowers/specs/2026-10-02-community-fundraising-design.md`. No config value.

Each request moves on one step at a time, and the only way back is **Undo**, one step, after a
question (what was entered for that step is cleared, and History keeps it):

| What | Steps | What staff enter |
|---|---|---|
| Posters, leaflets (and the old leaflets or posters) | To send, then Sent | the date, by post or dropped off, who, how many (starting at how many they asked for), a note. **Change the count** fixes how many actually went |
| Collection buckets and tins (and the old buckets or tins) | To send, With them, then Back | out: the date, how many, who, a note; back: the date, how many came back (no more than went out, not before they went out), a note on the money inside or any missing |
| A social media shout out | To do, then Done | the date, who, a link to the post (https only). Only with their permission (`socialOk`): without it the request says **Asked, but no permission to post yet: ask them**, with no button and not counted as waiting (once they say yes, tick it under Change the details) |
| Someone to come along | To arrange, Arranged, then Done | who is going and a note; then the date they came along |

Dates are UK calendar days and none may be still to come. Buckets and tins are **due back** two
weeks after the fundraiser's date, or four weeks after they went out when it has no date; from that
day the request and the list row show a **Due back** pill. Nothing asked for, nothing shown.

A request has no row until staff first act on it: with none it is at its first step, so sign ups
from before this need no backfill. Every change sends the step the person saw (`from`): if someone
else has moved it on meanwhile, nothing changes and the answer is `409` with "Someone else changed
this a moment ago. It now shows how it stands." The fundraiser's row is locked while a change is
made, so two at once take turns.

**The list.** A **Requests to do** pill on a sign up still to come (new or approved, not past its
date, as the Monday summary has always counted) with anything still at its first step, and two
filters: **Requests to do** and **Buckets not back** (every sign up with buckets or tins out, due
or not, whatever its status). A viewer sees all of it, without the buttons.

**The Monday summary** counts only what is still to send or do, and adds "N buckets or tins still
out (M due back)", or "N buckets or tins still out, none due back yet" (N and M are buckets and tins,
as many as went out). Each request with buckets or tins due back counts as one thing waiting.

**The organiser's private area** (`/fundraise/manage`) shows **What you asked us for**, read only,
a line each in words: "Posters: sent on 3 Dec", "Leaflets: dropped off on 4 Dec", "Collection
buckets: with you, please bring them back by 26 Dec" (or "as soon as you can" once due), "back with
us on 5 Dec. Thank you!", "Social media shout out: posted on 2 Dec" with a link to the post,
"Someone from NBCC to come along: arranged, we look forward to seeing you". A shout out asked for
without their permission says "A shout out on our social media: we just need your OK to post about
you. Reply to any of our emails or give us a ring and we'll sort it." Something still at its first
step shows only while the fundraiser is still to come (new or approved, not past its date): there
is no backfill, so one asked for before requests were tracked would otherwise say "we're getting
them ready" for good. Anything staff have moved on always shows. Never a staff note, who
handled it or who is going. Only their own fundraisers' requests are read; if they cannot be read,
the rest of the page still shows (`requests: null`).

### Routes

Admin routes need a session and the `fundraising` section: viewers look, editors and admins change.
Every change writes `fundraiser.request_updated` to `audit_log` against the fundraiser, with the
actor `admin:<email>` and the words for History ("Posters: sent (by post)").

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/admin/fundraising/requests` | view | | `{ today, requests: { <id>: [request] }, toDo: { <id>: true }, notBack: { <id>: true }, totals }`; each request has its `kind`, `label`, `asked`, `status`, `statusLabel`, what was entered, `dueOn`, `dueBack`, `outstanding`, `noPermission` and the `actions` that can be taken |
| `POST /api/admin/fundraisers/:id/requests/:kind` | edit | `{ action, from, on?, how?, by?, quantity?, note?, link?, going? }`; `action` is `send`, `out`, `back`, `done`, `arrange`, `count` or `undo` | `{ row, words }`; `400` with `fields`; `404` for a kind they did not ask for or a fundraiser that is not there; `409` when it has moved on, or that step cannot be taken now |

`GET /api/fundraise/manage/me` now gives each fundraiser `requests: [{ label, words, link? }]`.

### Data (`migrations/1791200000080_fundraising-requests.js`, additive only)

`fundraiser_requests`: one row per fundraiser and kind (unique), cleared with its fundraiser: the
step, how many went and came back, posted or dropped off, the dates sent or out, back and done, who
handled it, who is going, a note, a note on what came back, the link to the post, and when and by
whom it was last changed. It is in the nightly backup's table count (66).

### Where it lives, and tests

Rules (pure): `src/fundraising/requests.ts` (the steps, due back, the totals, the organiser's
words). SQL: `src/db/fundraising-requests.ts`. Routes: `src/routes/admin-fundraising-requests.ts`;
the private area's part in `src/routes/fundraise.ts`; the summary's counts in
`src/fundraising/summary.ts` (read by `src/db/fundraising-team.ts`). Screen: the `frReq` parts of
`assets/js/admin/app.js`, the two filter chips in `admin.html`, styles beside `.fr-wants` in
`assets/css/admin.css`; the private area's part in `fundraise-manage.html`,
`assets/js/fundraise-manage.js` and `assets/css/fundraising.css`. Unit tests:
`fundraising-requests` (every step, Undo, due back across the clocks changing, the totals, the
organiser's words), `fundraising-requests-db`, `fundraising-requests-migration`,
`admin-fundraising-requests-routes` (admin, editor and viewer), `admin-fundraising-requests-page`
(the jsdom admin harness), `fundraising-summary`, `fundraising-team-db`, `fundraise-private-routes`
(only their own), `fundraise-manage-page` and `backup-plan`. BDD:
`features/fundraising-requests.feature` (posters sent and a bucket out then back take what is
waiting down; a second press changes nothing; Undo goes back one step).
## Fundraising categories: one each, A to Z, and staff can add more

The sign up form's "What are you doing to raise money?" (or "What kind of event is it?") is a list of
**categories**, each naming one thing, never "this or that", and named as a plain noun so it reads
well on a card ("Santa dash", not "A Santa dash"). The form shows them **A to Z, with Other last** (once
called "Something else"; its box, "What is it?", for what it is in their words, is unchanged). At
two columns the list reads **down the left column, then down the right**, with Other at the bottom
right: the grid flows by column (`.fr-options--columns`), with half as many rows as categories,
rounded up, set by the server (`--rows`, `kindRows` in `src/fundraising/render.ts`). The page order,
and so the tab order, stays A to Z; on a phone it is one column. To start with:

Bake sale, Birthday, Coffee morning, Party, Quiz, Run, Santa dash, School collection, Walk, Workplace
collection, and Other.

**Admins add more** in Admin > Fundraising, on the **Categories** card: type a name and Add to the
form, and it is on the sign up form at once, in its place A to Z. They can **rename** one (the new
name shows everywhere, on sign ups already made too) and **hide** one from the form (and put it back);
Other is always on the form. Nothing is ever deleted, so every sign up keeps its category
and its name. Each change is in `audit_log` (`fundraising.category_added`,
`fundraising.category_changed`, entity `fundraising_category`, the key in its data). Editors and
viewers do not see the card; the sign up editor's Category list (anyone with Fundraising) offers
every category on the form, plus a sign up's own if it is an old one, shown "(no longer on the form)"
until someone changes it.

**The old categories.** "Run or walk", "Bake sale or coffee morning", "Quiz or party" and "Workplace
or school collection" (keys `run_walk`, `bake_sale`, `quiz_party`, `collection`) are no longer
offered. Sign ups that chose one keep it, shown by that name on the card, the page, the staff email
and the admin, until staff change it to a new one. Santa dash (`santa_dash`), Birthday
(`birthday`) and Other (`other`) mean what they always did, so they keep their keys; a
bake sale on its own is `bake_sale_2`, as `bake_sale` was the old pair.

**Keys.** `fundraisers.kind` holds a category's key: small letters, digits and underscores, made from
its name when an admin adds it ("Sponsored silence" is `sponsored_silence`), with a number if the
key was ever used (`_2`, `_3`). A key never changes. For code that suggests things by kind (the
materials, the keep in touch emails): `categoryLabel(key)` is the name to show, and
`isKind(key, ...kinds)` asks "is it one of these?", matching an old category to the ones it was
split into either way round, so `isKind(f.kind, "bake_sale")` is true for an old bake sale or coffee
morning and for a new Bake sale or Coffee morning (`src/fundraising/categories.ts`).

**Checks.** The sign up accepts only a category on the form now. One no longer on the form (hidden
since their page loaded, or an old one) is refused with "That choice is no longer on the form.
Please choose another."; one that does not exist with "Choose what you are doing to raise money."
(worded for the path). A staff change may set any category on the form ("Choose one of the
categories on the list."). The list is read from the database (without counting sign ups; only the
Categories card counts them) and kept for a minute; a change on the Categories card is read again at
once on that server, and a sign up naming a category the server has not seen yet reads the list
afresh before refusing it. Two admins adding or renaming to the same name at once: the second is
told the name is taken (the unique index decides). Every name shown with a sign up is read with its
row, so a rename shows at once. On the card, after a change the keyboard goes back to that row's
button (or to the status line, if it was refused), and the card waits only for its own changes.

### Routes

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/admin/fundraising/categories` | Fundraising view | | `{ categories: [{ key, label, active, createdAt, createdBy, retiredAt, used }] }`, A to Z, Other last; `used` is how many sign ups have it |
| `POST /api/admin/fundraising/categories` | an admin | `{ label }` (2 to 40, letters and numbers) | `201 { category }`; `409` when a category (hidden or not) has that name |
| `PATCH /api/admin/fundraising/categories/:key` | an admin | `{ label?, active? }` | `200 { category }`; `409` for hiding Other or a name taken; `404` |

`GET /fundraise` draws the form's categories from the list (between `<!-- kinds -->` and
`<!-- /kinds -->` in `fundraise.html`, which holds the starting list for when the database cannot
answer).

### Data (`migrations/1791200000160_fundraising-categories.js`, additive only)

A new table, `fundraising_categories`: `key` (primary key, checked), `label` (unique whatever the
case), `active`, `created_at`, `created_by`, `retired_at`. Seeded with the new list and the four old
categories (not active), `ON CONFLICT DO NOTHING`, plus any key a sign up has that the list does not
know (there should be none). The hard coded check on `fundraisers.kind` (`fundraisers_kind_check`,
named in 1791200000000) is dropped by its name, and any other check listing the old kinds (found by
`quiz_party`, as Postgres keeps `kind IN (...)` as `kind = ANY (ARRAY[...])`), and replaced by a
link to the table (`fundraisers_kind_fkey`), so a category in use can never be deleted. No sign up is
changed. The rollback drops the link and the table and puts the old check back `NOT VALID`. Numbered
160, above 130 on main; the keep in touch work takes 170 and lands after this. The nightly backup's
table count is 71.

**Rolling back past the fundraising categories.** Code from before this release names a category
from its own fixed list, so a sign up with a new key (`bake_sale_2`, `quiz`, one an admin added) has
no name there, and Get involved and that fundraiser's page fail. So **before** rolling back code past
this release (dispatching `deploy-prod.yml` with an earlier `image_sha`), and before migrating down,
point those sign ups at the old categories. Each new one goes to the old one it was split from (Run
and Walk to Run or walk, Bake sale and Coffee morning to Bake sale or coffee morning, Quiz and Party
to Quiz or party, School and Workplace collection to Workplace or school collection), and any other
(one an admin added) to Other, keeping its name as what Other is, in their words. Santa dash,
Birthday and Other keep their keys. Run in the production database (CloudShell; this is
`ROLLBACK_SQL` in the migration):

```sql
UPDATE fundraisers SET kind = CASE kind
    WHEN 'run' THEN 'run_walk' WHEN 'walk' THEN 'run_walk'
    WHEN 'bake_sale_2' THEN 'bake_sale' WHEN 'coffee_morning' THEN 'bake_sale'
    WHEN 'quiz' THEN 'quiz_party' WHEN 'party' THEN 'quiz_party'
    WHEN 'school_collection' THEN 'collection' WHEN 'workplace_collection' THEN 'collection'
  END
 WHERE kind IN ('run', 'walk', 'bake_sale_2', 'coffee_morning', 'quiz', 'party', 'school_collection', 'workplace_collection');
UPDATE fundraisers f SET kind = 'other', kind_other = COALESCE(NULLIF(f.kind_other, ''), c.label)
  FROM fundraising_categories c
 WHERE c.key = f.kind
   AND f.kind NOT IN ('run_walk', 'santa_dash', 'bake_sale', 'quiz_party', 'collection', 'birthday', 'other');
```

The down migration's old check is `NOT VALID`, so it does not stop the rollback, but it does hold
every later UPDATE to the old list: run the SQL above first, or a sign up left with a new key could
never be changed.

### Where it lives, and tests

Rules: `src/fundraising/categories.ts`, and the sign up and staff schemas in
`src/fundraising/model.ts` (`kindLabelOf`). SQL and the one minute list: `src/db/fundraising-categories.ts`;
the name with each row: `RECORD_COLUMNS` in `src/db/fundraisers.ts`. Routes:
`src/routes/admin-fundraising-categories.ts`; the checks in `src/routes/fundraise.ts` and
`src/routes/admin-fundraising.ts`; the form in `src/routes/fundraise-pages.ts` and
`renderFundraiseSignUp` in `src/fundraising/render.ts`. Admin: the Categories card in `admin.html`
and `assets/js/admin/app.js`. Unit tests: `fundraising-categories` (the list, the order, names, keys,
`isKind`, the sign up and staff checks, old sign ups on their card and page),
`fundraising-categories-migration`, `fundraising-categories-db` (the minute, afresh, audit),
`admin-fundraising-categories-routes` (admins only), `fundraise-signup-categories` (the form A to Z),
`fundraise-routes`, `fundraise-pages-routes`, `admin-fundraising-routes`,
`fundraising-staff-email-v2`, and the Categories card in `admin-fundraising-page`. BDD:
`features/fundraising-categories.feature` (an admin adds Sponsored silence, the form offers it A to
Z, a sign up uses it; only an admin may; an old category is refused but keeps its name; hiding one).

## The fundraising sign up form, round two, and short page links (TASK-511)

Jaimie's second round of changes to the sign up form at `/fundraise`, and shorter page links.

(Replaced on 2026-10-03 by Next and Back, one question at a time: see "The sign up tidy" below.)

**One question after another.** `assets/js/fundraise.js` adds `fr-stepped` to the form and shows
each question (each `[data-step]`) once the one before is answered: answered means every question
in it that needs an answer, and is in play for their path, is valid (read from `validity`, so
nothing is flagged red on the way), checked when they leave a box (`change`) or pause typing for
0.6 seconds, never on the first key. A step with nothing it needs comes along with the one before; a
step once shown is never taken away. Once every question for their path shows, stepping stops (and
the other path's questions are let go, so a change of path shows them at once); a fault in the
form's own tidying never stops the next question coming. Each new one is said in a polite live region ("Next question:
What kind of event is it?"), focus stays where they are, and "Show all the questions at once" (or
pressing Send) shows every one, Send then flagging whatever is missing. The rise and fade is off for
anyone who asks for less motion. Without the script every question is in the page as it is.
The order: what you are planning, what kind, about it, the event's card (events only), the target
(raising money only), the NBCC website, your details, social media, what you would like, and the
newsletter and Send.

**Words that follow the first answer.** Elements with `data-say-raising` and `data-say-event` take
those words once a path is chosen ("What are you doing to raise money?" or "What kind of event is
it?"), and a control's `data-invalid-raising` or `data-invalid-event` becomes its message. The
server's messages follow the path too (`kindMissing`, `kindOtherMissing` in
`src/fundraising/model.ts`).

**The answers.**

- First name and surname, both required (up to 50 each). Stored in `first_name` and `last_name`;
  `organiser_name` is still filled as "first last" for everything that reads it. A sign up from
  before keeps its one name. In the admin a new one shows and edits both parts, and changing either
  changes the whole name with it (`organiserNameFor`); an old one shows and edits its one name.
- "Other" (called "Something else" until the fundraising categories) asks "What is it?", in up to 80
  characters, worded for the path, required when chosen (`kind_other`; dropped for any other kind).
  Shown in the staff email and the admin as "Other: A sponsored silence".
- **Social media** is a step of its own: their Instagram and their Facebook (optional), "Can we post
  about it on NBCC's social media?" and "Would you like a shout out from us?". A handle (`@name` or
  `name`) or a link, with or without https, from the app or the website, is tidied to one full link
  (`src/fundraising/social.ts`): `https://www.instagram.com/<name>` (a profile, never a post), and
  `https://www.facebook.com/<path>` (a page, group, event, share link, or `profile.php?id=`; a post
  or video link, `story.php`, `permalink.php`, `photo.php`, `video.php` or `watch`, keeps its
  query less tracking such as `fbclid` and `utm_*`); any other website is refused in plain words.
  The browser has a copy of these rules (`assets/js/social-handles.js`, held to the same answers by
  `fundraising-social-links`), so the form says what is wrong as they leave the box and holds Send.
  Stored in `instagram` and `facebook`; `social_link` is still filled (Facebook first) for
  anything that reads it, and follows every later change to either link (`socialLinkFor`, on a
  staff change and on approving an organiser's); an old sign up keeps its one link. The organiser's
  private area changes Instagram and Facebook in boxes of their own for a sign up made since
  (`linkBoxes: "two"` on `GET /api/fundraise/manage/me`; still approved by staff), and the one link
  box for one from before (`"one"`). A
  shout out asked for without their OK to post is taken, and the form, the staff email and the
  admin all say we need their OK first.
- **Yes or no** questions (posting about it, a shout out, someone coming along, and the website) are
  a pair of choices with nothing chosen, and must be answered: the server asks for any missing one,
  never taking it as No. The newsletter stays an unticked box they tick to join.
- **The website question** says which website: "Shall we show it on the NBCC website, on our Get
  involved page?", and that we are happy to help with posters, leaflets, buckets and the rest
  either way.
- **Printed QR codes** (cards or stickers with their page's QR code): "How many printed QR codes would
  you like?", 0 to 200, asked only of someone raising money (an event has no page, so the server
  keeps 0 for one). Stored as `qrCount` in `wants`; they need an address, like posters. A staff
  change to what they would like that does not send `qrCount` keeps the stored number.
- **A choice made is holly green** (`--holly`): the card's border (doubled), its fill, the radio and
  tick themselves, with a holly focus ring. Yes and No sit side by side, even on a phone.

**Requests.** Printed QR codes are a request kind of their own, `qr_codes` ("QR codes", To send then
Sent, like posters), in the admin's Requests part, the totals, the Monday summary ("printed QR codes
(30) to post") and the organiser's private area (in words only, as every request is).

**Short page links.** A new sign up's page is `nbcc.scot/fundraise/<initials>`: the first letter or
number of each word of its name, in lower case ("Sam's Santa Dash" is `ssd`). Under two letters, the
first word is used instead ("Bakeathon"); nothing usable, `fundraiser`. A clash takes a number
(`ssd2`, `ssd3`); a reserved address (`RESERVED_SLUGS`: manage, help, logos, sponsor-form) is never
used. Existing pages keep the link they have. Staff can still change any page's link in the admin.
Rules: `src/fundraising/slugs.ts`; the lookup of what is taken: `freeSlug` in
`src/db/fundraisers.ts`.

**Old page links keep working.** When staff change a page's link, the old one is kept in
`fundraiser_slug_history`, and `/fundraise/<old>` (and its `qr.svg` and `qr.png`) answer with a
**301** to the page's link now, query string kept, while it has a page; otherwise the site's 404. So a
QR code printed with the old link never breaks. The 301 carries `Cache-Control: public,
max-age=3600`, so a browser asks again after an hour (a link changed and later changed back never
sends anyone round in a circle). No other page may ever take an old link: a new sign up counts
every one as taken, and staff giving one to another page get a `409`; who may take which address is
decided one at a time (a transaction lock, `pg_advisory_xact_lock`, around picking a sign up's
address and moving a page), so a sign up can never take an old address in the moment a page is
moved off it. A page may take back a link it had before.

### Data (`migrations/1791200000130_fundraising-form-v2.js`, additive only)

New nullable columns on `fundraisers`: `first_name`, `last_name`, `kind_other`, `instagram`,
`facebook`. A new table, `fundraiser_slug_history`: the old link (primary key, so each once), the
fundraiser (cleared with it), when and by whom. The requests' kind check is widened to take
`qr_codes`: the old check is dropped by its name (`fundraiser_requests_kind_check`, the name
Postgres gave the column check in 080), and any other check listing the kinds (found by
`shout_out` in it: Postgres keeps `kind IN (...)` as `kind = ANY (ARRAY[...])`, so the words
"kind IN" are never there), and the widened one is added back under that name; the rollback puts the
old list back `NOT VALID`. Printed QR codes need no column: a new key in `wants`. Numbered 130,
above 110 and 120. The nightly
backup's table count was 70 (71 since the fundraising categories).

### Where it lives, and tests

Form: `fundraise.html`, `assets/js/fundraise.js`, the "TASK-511" block in
`assets/css/fundraising.css`. Rules: `src/fundraising/model.ts` (the sign up and staff schemas,
`organiserNameFor`), `src/fundraising/social.ts`, `src/fundraising/slugs.ts`,
`src/fundraising/requests.ts`, `src/fundraising/summary.ts`, the staff email in
`src/fundraising/emails.ts`. SQL: `src/db/fundraisers.ts`, `src/db/fundraiser-slugs.ts`. The
redirect: `src/routes/fundraise-pages.ts`. Admin: `assets/js/admin/app.js`. Unit tests:
`fundraise-signup-steps` (jsdom: one question after another, the words, nothing preselected, the
payload, the look), `fundraise-signup-page`, `fundraising-signup-v2`, `fundraising-social-links`,
`fundraising-short-links`, `fundraisers-db-v2`, `fundraise-old-address`, `fundraising-qr-requests`,
`fundraising-staff-email-v2`, `fundraising-form-v2-migration`, `admin-fundraising-page` and
`backup-plan`. BDD: `features/fundraising-form-v2.feature` (a sign up with the new answers gets an
initials link, a clash takes the next number, an old link answers 301 and is never given to another
page).

## Fundraiser pages: countdown, on the day, and news updates (TASK-506)

Two things for a raising money fundraiser's own page (`/fundraise/<slug>`), decided by Jaimie on
the fundraising master list.

**The countdown and the day itself.** While the fundraiser's date is still to come, a pill under the
date in the intro says how many days to go: "12 days to go", or "Tomorrow!" the day before. On the
date, a festive banner takes its place: "Today's the day! Good luck, Robin!", with the page's own
share links (Copy the link, Facebook, WhatsApp), as the day is when a share helps most. After the
date there is nothing (the finished and thank you states already say what there is to say), and
nothing once the fundraiser is finished. The days are UK days (`Europe/London`), counted on the
calendar, so the clocks changing never makes it a day out. The first name is the organiser's, only
when it is one plain word of letters (`safeFirstName`, as the emails greet people); otherwise the
banner says "Good luck!" with no name. It is drawn on the server, so nothing flashes in after the
page opens, and the page is already revalidated on every view (`Cache-Control: public, max-age=0`,
with a fresh ETag when the words change), so a cached copy is never a day out.

**News updates.** In their private area, for each fundraiser running with its own page (approved,
raising money, public, not finished), the organiser has **News updates**: a short update (up to 500
characters, its words checked like the supporter wall's) and, if they like, a photo (a JPG, PNG or
WebP, shrunk in the browser first exactly as a staff upload is, 2 MB at most). Five a day for each
fundraiser, counted in the database under the fundraiser's lock. Every update waits for staff. Their
updates are listed below the form, newest first, each saying where it is up to: "Waiting for us to
check", "On your page" or "Not used". A finished fundraiser keeps its list, with no form.

In **Admin > Fundraising**, a sign up with updates waiting shows **Updates to check** on its row, and
the open sign up has a **News updates** panel: each update with its words and its photo (fetched
with the admin's own sign in, as a waiting photo has no public address, and shown small), and
**Approve update** or **Don't use it**, with an optional reason that stays in the admin, for staff
only. One on the page can be **hidden**, and shown again. Approving emails the organiser "Your news
update is live!" (with the page link while their page is up), not using one emails "About your news
update" (we'll give you a ring); hiding emails nobody. Every decision records who and when in
`audit_log` (History shows it, with the reason). Viewers see the panel without the buttons; edit
access decides. The Monday summary counts "N news updates to check" under Waiting on us.

On the page, approved updates show in a **News** section after the story, newest first, with their
date: the first three, then **Show all** grows the page. A photo sits in a small frame of one shape
(4 by 3, cropped to fill it, 180 pixels wide beside the words, at most 280 above them on a phone),
never across the page: a whole flyer on a card looked bad live, so a poster can never take the page
over. Its alt text is the start of the update.

What keeps a waiting photo private: it is stored in its update's row with an address of its own (a
uuid), and `GET /media/fundraiser-news/<uuid>` serves it only while its update is approved, on a
public raising money page that is up (approved or finished), with fundraising switched on. Before
then only the organiser (behind their session, by their own email) and staff (behind the admin's
token) can see it, never kept by a cache. Every photo goes out with its checked type and `nosniff`;
its first bytes must match the type it claims, so nothing else can be served as a picture.

| Method + path | Who | Body | Answer |
|---|---|---|---|
| `GET /api/fundraise/manage/news` | the signed in organiser | | `{ fundraisers: [{ id, canPost, updates: [{ id, text, status, statusWords, createdAt, photoUrl }] }] }`, `no-store`. Never the internal reason or who decided |
| `POST /api/fundraise/manage/fundraisers/:id/news` | the signed in organiser, from our own page | `{ text, photo?: { mime, dataBase64 } }` | `202 { status: "waiting", update }`; `400 { fields: { text \| photo } }`; `413` a photo over 2 MB; `429` the sixth in a day; `410` not running with a page; `404` anyone else's; `401` signed out (checked before the body is read) |
| `GET /api/fundraise/manage/news/:updateId/photo` | the signed in organiser | | their own photo, whatever its status, `private, no-store` |
| `GET /media/fundraiser-news/:photoId` | anyone | | the photo, only once its update is approved (see above), `public, max-age=300`, so a hidden one stops being served within minutes; otherwise `404` |
| `GET /api/admin/fundraising/news-waiting` | fundraising view | | `{ counts: { <fundraiser id>: <waiting> } }` |
| `GET /api/admin/fundraisers/:id/news` | fundraising view | | `{ updates: [{ ..., decidedAt, decidedBy, rejectReason, photoUrl }] }` |
| `GET /api/admin/fundraisers/:id/news/:updateId/photo` | fundraising view | | the photo, waiting ones included, `private, no-store` |
| `POST /api/admin/fundraisers/:id/news/:updateId/approve` \| `/reject` \| `/hide` \| `/show` | fundraising edit | reject: `{ reason? }` (up to 500) | `{ update }`; `409` already decided; `404` not there |

The post's body (a photo as base64) is read with a 4 MB limit on that path only, and only when the
request carries a session cookie the shape of one of ours (the session itself is checked after). The news router is mounted before the private area's, whose
retired link route (`GET /api/fundraise/manage/:token`) would otherwise take "news".

### Data (`migrations/1791200000100_fundraiser-updates.js`, additive only)

`fundraiser_updates`: the fundraiser (cleared with it), the words (1 to 500 characters), the photo
(`photo_id` uuid, its type, bytes and size, all or none), `status` (`pending` by default, then
`approved`, `rejected` or `hidden`), when it was posted, who decided and when, and the internal
reason. Indexed by fundraiser, newest first, and by those waiting. In the nightly backup's table
count (66).

### Where it lives, and tests

Rules (pure): `src/fundraising/news.ts` (the countdown, the update form, the photo check, the
statuses, what the public sees). Drawing the page: `src/fundraising/render.ts`. SQL:
`src/db/fundraiser-updates.ts`. Routes: `src/routes/fundraiser-news.ts` (reusing the private area's
session, ownership and same origin checks, exported from `src/routes/fundraise.ts`); the page reads
its news in `src/routes/fundraise-pages.ts`. Emails: `buildNewsApprovedEmail` and
`buildNewsRejectedEmail` in `src/fundraising/emails.ts`, sent by `sendNewsDecisionEmail` in
`src/fundraising/send.ts` (kinds `fundraiseNewsApproved`, `fundraiseNewsRejected`). The private
area's part: `assets/js/fundraise-news.js` and the `<template data-news-pattern>` in
`fundraise-manage.html`. The page's Show all: `initNews` in `assets/js/fundraiser.js`. The admin
panel: the "news updates (TASK-506)" block in `assets/js/admin/app.js`. Styles at the end of
`assets/css/fundraising.css` and `assets/css/admin.css`. Unit tests: `fundraising-news` (the days to
go across both clock changes and on the day itself, the photo check, the form, the rate limit, what
is public), `fundraiser-page-extras` and `fundraiser-page-news-script` (the page drawn and in the
browser), `fundraiser-page-news-route`, `fundraiser-news-routes` (owner only, five a day, the words,
the photo, a waiting photo never public, staff approve, reject and hide by permission, the emails,
how the app mounts it), `fundraiser-updates-db`, `fundraiser-updates-migration`,
`fundraising-news-emails`, `fundraising-summary-news`, `fundraise-news-page` (the private area in
jsdom), `admin-fundraising-news-panel` (the admin in jsdom), `admin-email-kinds` and `backup-plan`.
BDD: `features/fundraising-news.feature` (post, approve, on the page; a waiting photo is not public;
the sixth in a day; the countdown and the day itself).
## Community fundraising, materials (TASK-504)

Stage 2 of community fundraising: everything an organiser prints and shares, each built from the
fundraiser's **approved** details only (the stored record; a change waiting for staff is never read),
the way the business supporters' certificate and the thank you letters are: one self contained HTML
page with the brand fonts and logos inlined, A4 `@page` rules, a print button, and a little script
that shrinks the page to fit a phone screen (printing ignores it). No server side PDF or image
library.

| Piece | What it is |
|---|---|
| `poster` | A4 portrait: the logo, "Fundraising for NBCC", the title, date, time and place, a short line (the card line, or the description's first sentence, trimmed), the target, a big QR code and the address in words, and "Every pound helps the children, young people and vulnerable adults we support, all year round." The code is the public page's (`src/fundraising/qr.ts`, the same encoder as the SVG download); a public event's points at Get involved; one not on the website has no code and says nbcc.scot |
| `social` | Pictures to share: a square (1080 x 1080) and a story (1080 x 1920), drawn in the browser on a canvas by `assets/js/fundraise-social.js` (inlined into the page) and saved as PNGs by a Download button each. Title, "Fundraising for NBCC", the meter (optional, a tick box), the page address and the logo with white lettering |
| `sponsor-form` | A4 landscape, two pages (12 rows, then 11 more and the totals): HMRC's sponsorship and Gift Aid declaration word for word at the head of each page (from HMRC's model "Sponsorship and Gift Aid declaration form", gov.uk), the charity name and number, the fundraiser's title, the columns HMRC asks for (full name, home address, postcode, amount, date paid, Gift Aid tick), totals, and "Please send this form back to us once you have paid the money in, so we can claim Gift Aid." With a page to give on, the heading of each page also says "Sponsoring online instead? Give on the page at <address>, and please don't add your name here as well." (never on the blank form or one in memory of someone). Shared with another cause: the split's lines end "NBCC can claim Gift Aid only on the part of each gift that comes to NBCC.", the foot says "Pay NBCC's <N>% in from your private area...", and the pages have 10 rows each (9 on page 1 when the event's name is over 60 characters or the other cause's name over 38; 9 on page 2 when the page address is over 52 characters, which is also drawn smaller in the heading), `sponsorRowCounts`. A blank one for anyone is at `/fundraise/sponsor-form` |
| `certificate` | A4 landscape certificate of thanks: the organiser's name as they gave it, the title, the final total raised (Gift Aid apart, "+ £X Gift Aid" when there is some), today's date and "NBCC Team". The organiser's once the fundraiser is finished; staff can preview it at any time once approved |

Also: the print size QR code PNG (`/fundraise/<slug>/qr.png`, `src/fundraising/qr-png.ts`, a one bit
PNG written with Node's zlib, every module a whole number of pixels) beside the SVG, and the logo
pack at `/fundraise/logos` (`fundraise-logos.html`: the colour PNG, the white SVG and the white PNG
that already ship in `assets/img`, with the rules), linked from the help page's "Using our logo",
which also links the blank sponsor form.

**Where to find them.** The organiser's private area (`/fundraise/manage`) has a "Your materials"
section on each fundraiser (the links come in `GET /api/fundraise/manage/me` as `materials:
{ poster, social, sponsorForm, certificate, qrPng }`, with `certificate` null until finished and
`qrPng` null without a page), and a "Download a print size PNG" link beside the QR code. Admin >
Fundraising shows "Materials" buttons on an approved or finished sign up: the admin fetches the page
with the staff session and opens it in its own tab from memory (a plain link would carry no
session). Every materials page is `no-store`, `noindex` and `Referrer-Policy: no-referrer`. No email
changes here: the certificate is wired into the finishing email by a later task.

| Where it lives | File |
|---|---|
| The pages (pure renders), what each may show, the HMRC wording | `src/fundraising/materials.ts` |
| The print size QR code | `src/fundraising/qr-png.ts` |
| Who may open them | `src/routes/fundraise-materials.ts` |
| The blank sponsor form, the logo pack, the PNG | `src/routes/fundraise-pages.ts`, `fundraise-logos.html` |
| Drawing the social pictures | `assets/js/fundraise-social.js` |
| Tests | `test/unit/fundraising-materials.test.ts`, `fundraise-materials-routes.test.ts`, `fundraise-materials-pages.test.ts`, `fundraise-social-images.test.ts`, `fundraising-qr-png.test.ts`, and the private area and admin page tests; BDD `features/fundraising-materials.feature` |

No migration: everything comes from tables that already exist.

## Thank your supporters (TASK-507)

An organiser can thank the people who gave on their fundraiser, without ever seeing their email
addresses. Jaimie's decision: the organiser picks gifts and writes a short thank you in their
private area; staff check every one first; NBCC then emails it to each chosen giver (email 20 of the
approved fundraising emails), from and replying to the events inbox, so a reply comes to NBCC and
never to the organiser. No config value.

**The private area** (`/fundraise/manage`). Each fundraiser (approved or finished) with gifts to
thank, or thank yous to look back on, has a **Thank your supporters** part just after its latest
gifts: its gifts with a tick box each, showing only what the gifts list shows (a name or Anonymous,
the amount unless the giver hid it, the message unless staff hid it, the date), ten and then
**Show all**; **Select all not yet thanked** (which ticks the hidden ones too); a message box (600
characters at most, with the rude words check the wall uses); and **Send for checking**. Money the
organiser paid in, and gifts refunded in full, are never listed. A gift is thanked at most once: one
already in a thank you (waiting, sent, or skipped) is marked **Thanked** and cannot be ticked, and a
later thank you that picks it skips it ("Some you picked had been thanked already, so we left those
out."). Only a thank you staff chose not to send frees its gifts. At most three thank yous a day for
one fundraiser. Below the form, **Your thank yous**, each with where it is up to: **Waiting for us to
check**, **Sending now**, **Sent to N supporters** (counts only, never who), or **Not sent**.
Added by its own script, `assets/js/fundraise-thanks.js`, from a `<template data-thanks-pattern>`.

**Admin > Fundraising.** A **Thank yous to check** pill on a sign up with any waiting, and a
**Thank yous to supporters** panel in the open sign up: the organiser's words, the gifts it picked
(each giver's name and amount, and later what happened to each), **Approve and send** and **Don't
send** (with an optional reason that stays with staff), each after a question. A viewer sees it all
without the buttons. History names each step: sent for checking, approved and sent, not sent (with
the reason), and "Thank you emails done: N sent, M not sent".

**Sending.** Approving answers staff straight away, then sends in the background
(`src/fundraising/thanks-send.ts`), one gift at a time: each is claimed (`FOR UPDATE SKIP LOCKED`)
before its email, so two runs never take the same one. Before each email the gift is checked again
(skipped as `refunded` if refunded in full or no longer paid, `paid_in` if it is money the organiser
paid in, `not_running` if its fundraiser is no longer approved or finished), then the giver, by
address, at that moment. Jaimie's decision (2026-10-02): every giver picked is emailed, as the give
form promises "to send your receipt and a thank you", **except** an address with none
(`no_email`), an address on the suppression list (`suppressed`: a hard bounce, a spam complaint, or
stopped by staff; the same `suppressedAmong` the newsletter uses), or an address that has opted out
(`opted_out`: on `email_opt_outs`, below). A list that cannot be read means no email. The newsletter
tick box (`thankyou_consent`) does not decide it. One person whose several gifts were picked gets the
thank you once (`duplicate`), even with two senders at work: an earlier claim for the same address
still sending counts as sent. A failed send is recorded and the run goes on;
nothing throws. A gift left "sending" for 15 minutes (a restart part way) is marked failed rather
than sent twice; gifts left queued (or sending, or a thank you left unmarked) are picked up the next
time anyone opens Admin > Fundraising. When the last gift of a thank you is dealt with, it is marked
delivered and the counts are written to `audit_log` once; every run also ends by marking any
approved thank you with nothing left to send (its mark failed, or its gifts all went with their
donations), so none says "Sending now" for good.

**The email** (kind `fundraiseSupporterThanks`, "Fundraiser thank you to a supporter" on the Email
audit), in the approved words: "A thank you from Sam" (the organiser's first name only, and only if
it is one plain word of letters; otherwise "A thank you for your gift"), "Hello,", "Sam asked us to
pass this on to you, for your gift to **title**:", the message in a quote box, "And from all of us:
thank you too. Your gift helps the children, young people and vulnerable adults we support, all year round.", "Thanks so much, NBCC
Team", and the "Got any questions?" box with the events inbox. Nothing about any other giver, and
never the organiser's address.

**The Monday summary** adds "N thank yous to check" to Waiting on us (one thing waiting each). If
they cannot be counted, the summary still goes, without that line.

### Routes

The organiser's routes reuse the private area's session, ownership and same origin checks
(`signedIn`, `ownFundraiser` and `fromOurOwnPage`, exported from `src/routes/fundraise.ts`). Staff's
need a session and the `fundraising` section: viewers look, editors and admins decide.

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/fundraise/manage/thanks` | the organiser | | `{ fundraisers: [{ id, canThank, gifts: [{ donationId, name, amountPence, giftAidPence, message, createdAt, thanked }], thanks: [{ id, message, status, statusWords, createdAt, gifts }] }] }`, `no-store` |
| `POST /api/fundraise/manage/fundraisers/:id/thanks` | the organiser | `{ message, donationIds }` | `202 { status: "waiting", alreadyThanked, thanks }`; `400` with `fields` (the words, no gift ticked) or when any gift is not one on this fundraiser that can be thanked (nothing stored); `409` when every gift picked is thanked already; `429` after three in a day; `404` for anyone else's; `410` for one not approved or finished |
| `GET /api/admin/fundraising/thanks-waiting` | view | | `{ counts: { <id>: n } }` |
| `GET /api/admin/fundraisers/:id/thanks` | view | | `{ thanks: [{ ...thank you, statusWords, recipients: [{ donationId, name, amountPence, outcome, outcomeWords, sentAt }] }] }` (never an address) |
| `POST /api/admin/fundraisers/:id/thanks/:thanksId/approve` | edit | | `{ thanks }`, then the emails go in the background; `404` not this sign up's; `409` already decided |
| `POST /api/admin/fundraisers/:id/thanks/:thanksId/reject` | edit | `{ reason? }` (500 at most) | `{ thanks }`; emails nobody |

Every step writes `audit_log` against the fundraiser: `fundraiser.thanks_posted` (actor
`organiser`, `{ thanksId, gifts, alreadyThanked }`), `fundraiser.thanks_approved` and
`fundraiser.thanks_rejected` (actor `admin:<email>`, the reason with a reject), and
`fundraiser.thanks_delivered` (actor `system`, `{ thanksId, sent, skipped, failed }`).

### Data (`migrations/1791200000110_fundraiser-thanks.js`, additive only)

`fundraiser_thanks`: one thank you, cleared with its fundraiser: the words (1 to 600 characters),
`pending`, `approved` or `rejected`, who decided and when, a reason kept for staff, and when the last
of its emails was dealt with. `fundraiser_thank_gifts`: one row per gift it picked, cleared with the
thank you or the gift: `waiting`, `queued`, `sending`, `sent`, `skipped` (with `no_email`,
`suppressed`, `opted_out`, `duplicate`, and since 120 `refunded`, `paid_in` or `not_running`),
`failed` or `cancelled`, and when it was sent. A unique index on the gift (except where cancelled)
holds "thanked at most once". No email address is ever stored: it is read from the giver's donor row
at the moment of sending. Numbered 110, above main's 080 and the 100 another open task uses.

`migrations/1791200000120_email-opt-outs.js`: `email_opt_outs`, one live row per lower cased address
that asked us to stop (`kind` `all` for Stop all emails, `thank_you` for thank yous turned off;
`source` `preferences` or `backfill`), lifted by a tombstone (`removed_at`, `removed_by`), never
deleted. It also widens the gifts' skip reasons. All three tables are in the nightly backup's table
count (69).

### The opt out list, and the backfill

The preference centre (`src/routes/preferences.ts`, `postPreferences`) now writes the opt out list as
well as everything it did before, and writes it FIRST: **Stop all emails** always adds the address
(kind `all`, and a `thank_you` one already there becomes `all`), donor row or not; turning thank yous
off adds it (kind `thank_you`); turning thank yous back on lifts it. If that write fails, it is
logged loudly ("PREFERENCES OPT OUT NOT RECORDED") and the rest still saves and shows the saved page.
The write is safe against a double submit (`INSERT ... ON CONFLICT (email) WHERE removed_at IS NULL`,
the live row's unique index). Staff adding a newsletter subscriber by hand ("all our emails back
on", `addNewsletterSubscriber`) also lifts it, recorded as that member of staff. A new gift with the
box ticked does not lift it. `src/db/email-opt-outs.ts` (`addOptOut`, `liftOptOut`, `optedOutAmong`).

**What could be found for people who pressed Stop all emails before this.** Nothing direct. The
preference centre wrote no `audit_log` row and kept no history: it set `email_consent` and
`thankyou_consent` false on every donor row for the address (a plain update) and tombstoned its list
memberships. Both flags false is also how a giver who never ticked the newsletter box looks, so the
flags alone cannot tell the two apart; the newsletter unsubscribe events (`newsletter_email_events`)
record newsletter unsubscribes only, and `email_log` records sends, not choices.

**The rule used (conservative).** A signed link into the preference centre is in every newsletter,
the list welcome email, and the catch up letters `src/scripts/catchup-individuals.ts` emailed to
individual donors. So the migration backfills as opted out (kind `all`, source `backfill`) every
donor address with a row whose `thankyou_consent` is false where: that same row has `email_consent`
true (thank yous off with the newsletter kept, which only the preference centre does), or the
address was sent a newsletter (`newsletter_sends`, or a `sent` row in `newsletter_send_queue`), has
a newsletter unsubscribe or complaint event, is on any list (live or tombstoned), was sent a catch
up letter (`thank_you_sent.sent_by = 'script:catchup-individuals'`), or was on file when a sent
newsletter with no recipients recorded went out. Some who never asked to stop are counted as
opted out (a thank you they do not get); never the other way round. A giver whose address no
newsletter, welcome or list ever reached could not have opened the preference centre, so is emailed.

### Where it lives, and tests

Rules (pure): `src/fundraising/thanks.ts` (what may be sent, the gifts to pick, the organiser's words,
who may be emailed). The email: `src/fundraising/thanks-email.ts`. SQL:
`src/db/fundraiser-thanks.ts`. Sending: `src/fundraising/thanks-send.ts`. Routes:
`src/routes/fundraiser-thanks.ts`, mounted before the private area's router (whose retired link
route would read "thanks" as a link). Screens: the `frThanks` block of `assets/js/admin/app.js`
(reached by one line hooks marked TASK-507), styles beside `.fr-req-form` in `assets/css/admin.css`;
`assets/js/fundraise-thanks.js` and the `<template data-thanks-pattern>` in `fundraise-manage.html`,
styles beside `.fr-form__lead` in `assets/css/fundraising.css`. Unit tests: `fundraising-thanks`,
`fundraising-thanks-email` (email 20, exactly), `fundraiser-thanks-db`, `fundraiser-thanks-migration`,
`fundraising-thanks-send` (one at a time, suppression, opt outs, the gift checked again, never throws), `fundraiser-thanks-routes` (only
the owner, only their own gifts, the limits, staff permissions, sending after the answer),
`fundraising-summary-thanks`, `fundraise-thanks-page` and `admin-fundraising-thanks-panel` (jsdom),
`email-opt-outs-db`, `email-opt-outs-migration`, `preferences-opt-out`, `admin-email-kinds` and
`backup-plan`. BDD: `features/fundraising-thanks.feature` (an organiser thanks three givers, one of
whom pressed Stop all emails in the real preference centre; staff approve; the two who did not opt
out are emailed, ticked newsletter box or not, the third is not; the organiser sees "Sent to 2
supporters" and never an address; a gift on someone else's fundraiser cannot be picked).

In the private area, once every gift has been thanked the form goes and the part says "Everyone has
been thanked. Thank you for saying thank you!". In History, the sender's own step reads "Sent
automatically".

## Community fundraising, materials round two (TASK-512)

Round two of the materials above, from Jaimie's review. No migration and no new packages.

**The charity statement on every printed piece.** The poster, the leaflet, the sponsor form (both
pages, and the blank one) and the certificate carry `MATERIALS_STATEMENT`
(`src/legal/registration.ts`) word for word: "Night Before Christmas Campaign, known as NBCC, is a
Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995. Regulated by the
Scottish Charity Regulator, OSCR. The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank,
KA6 5EE". That is what section 52 of the Charities and Trustee Investment (Scotland) Act 2005 and
OSCR's guidance for a SCIO ask for on fundraising documents: the name, "Scottish Charitable
Incorporated Organisation" in full, and the number. The pictures to share carry the shorter
`MATERIALS_STATEMENT_SHORT` ("Night Before Christmas Campaign (NBCC), a Scottish Charitable
Incorporated Organisation, SC047995"), which still has all three. Both are pinned in
`test/unit/materials-statement.test.ts`. It is never printed smaller than 7pt, so it stays legible: the poster is the A4 design scaled, so the A5 leaflet draws it bigger on the design (`statementPt`) to come out at 7pt rather than about 5.4pt, and A3 lets it grow; the sponsor form and certificate print it at 7pt. The logo pack's footer already has the site's statement.

**The logo, as big as the layout allows.** On the poster it is 38mm to 58mm tall on A4
(`posterLogoMm`, giving a little way only to a long name or line, so the QR code keeps its size);
38mm on the certificate (was 27mm) and 24mm on the sponsor form (was 17mm); on the pictures it takes
whatever room the words leave, between a smallest and a biggest size per layout.

**Three sizes of poster.** `poster` (A4), `poster-a3` (A3) and `leaflet` (A5) are one design: drawn on
an A4 sheet and scaled to the paper with a CSS transform (so the QR code stays a sharp vector), in a
page exactly the paper's size, with its own `@page` size. Checked to fit with the longest title and
line the forms allow.

**A QR code of its own for every printed piece.** Each poster and leaflet's code is a short link,
`https://nbcc.scot/q/<fundraiser id>-<a4|a3|a5>` (`src/fundraising/material-codes.ts`), about 26
characters, so the code stays small and easy to scan. `GET /q/:code` answers with a `302` to wherever
the fundraiser is now, found by its **id**, never its address, so a printed code keeps working for
good whatever its page's address becomes: its page, or Get involved for a listed event, with
`utm_medium=qr&utm_campaign=f<id>-<size>`. It is `no-store` (an address change is followed at once)
and `noindex`. Anything else (not one of ours, no such fundraiser, one that is new, declined or not on
the website, fundraising switched off) falls through to the site's own 404; the target is always a
path on our own site, so it can never send anyone elsewhere. The scan is counted the way every QR code
is (TASK-492): the visit counter on the page it lands on records channel `qr` with the tag. So it
shows in Admin > Analytics, "QR codes", named "Sam's Santa Dash, A4 poster" (`labelQrScans` with the
fundraisers' titles), and per piece in Admin > Fundraising (`GET /api/admin/fundraisers/:id/scans`,
counted once per person per day from `analytics_views`). Nothing new is stored: like every visit, a
scan is not counted for a browser that asks not to be tracked, and it is kept 13 months.

**Pictures in five sizes** (Meta's guidance, October 2026): Instagram post square 1080 x 1080,
Instagram post portrait 1080 x 1350 (4:5, the tallest a feed post can be), a story for Instagram and
Facebook 1080 x 1920, a Facebook post 1200 x 630 (1.91:1), and a Facebook event cover 1920 x 1005 (what
Facebook asks for so it is not cropped on phones). Each has its own Download, and "Download every
picture as a zip" makes all five in the browser and zips them there (`makeZip` in
`assets/js/fundraise-social.js`: stored, not compressed, with a CRC32 of its own; no library). Tall
and square pictures stack down the middle; the two wide ones put the logo on the left.

**"Need something else?"** Every materials page (on screen only, never printed), the private area's
"Your materials" and the logo pack say Jaimie's words (`ASK_US`): "Need something else, like a banner
or a different size? Give us a call on 01292 811 015 or email events@nbcc.scot and we'll make it for
you. Please don't make your own versions of our logo or materials."

**Download everything (staff).** Admin > Fundraising has a "Download everything" button on an
approved or finished sign up: `GET /api/admin/fundraisers/:id/materials/everything` (fundraising:
view) is every printed piece on one page, one after another, each on its own paper (named `@page`
rules: A4 poster, A3 poster, A5 leaflet, the two sponsor form pages, and the certificate once
finished), to print or save as one PDF; its toolbar also has "Download every picture as a zip". A zip
of PNGs made on the server is not possible without an image library (none may be added), so the
pictures are drawn and zipped in the browser, from the same page. Organisers do not have it.

**Ask us to print these.** In "Your materials", beside the posters (A4 and A3) and the leaflet (A5),
an organiser can ask us to print some: `POST /api/fundraise/manage/fundraisers/:id/print-request`
`{ kind: "posters", a4, a3 }` or `{ kind: "leaflets", a5 }` (up to 100 A4, 50 A3, 500 A5 at a time;
their own fundraiser only, from our own page, 10 an hour per organiser, only while approved and still
to come). It becomes the posters or leaflets request staff already track (TASK-505): how many goes in
`fundraisers.wants` (`posterCount` or `leafletCount`), the request is To send with a note of the sizes
and the day ("Asked in their private area on 3 Oct: 10 A4 posters and 2 A3 posters."), and an
`audit_log` row `fundraiser.print_requested` (actor `organiser`, as every organiser action; with the request as it stood `before`, as Undo keeps it) goes in its History. So it shows in the Requests panel,
the Monday summary and the Overview with nothing new to learn. Asking again before we send replaces
the ask; after we sent some, it opens a new To send whose note says what went before, and asking again before that is sent keeps saying so (the earlier sending's date, count and who then live in that note and the History, not on the request). An organiser's ask is at the request's first step, so staff move it on by marking it sent, as for any other ask. With no postal
address on the sign up, the note asks staff to find out where to send them. The private area shows
where each is up to (`print` in `GET /api/fundraise/manage/me`: `{ canAsk, posters, leaflets }`, each
`{ asked, words, status }` or null). Printed QR codes (the new kind of request in TASK-511) are not offered here yet.

| Where it lives | File |
|---|---|
| The statements | `src/legal/registration.ts` |
| The pages, sizes, statement, logo, everything page | `src/fundraising/materials.ts` |
| Each piece's short link, its tag and its label | `src/fundraising/material-codes.ts` |
| Ask us to print these, the rules | `src/fundraising/print-requests.ts` |
| The SQL (scans, the ask) | `src/db/fundraiser-materials.ts` |
| The routes (`/q/:code`, scans, everything, the ask) | `src/routes/fundraise-materials.ts` |
| Naming the scans in Analytics | `src/db/analytics-report.ts`, `src/site/qr.ts` (`labelQrScans`) |
| The five pictures and the zip | `assets/js/fundraise-social.js` |
| Tests | `test/unit/materials-statement.test.ts`, `fundraising-material-codes.test.ts`, `fundraising-materials-v2.test.ts`, `fundraise-materials-v2-routes.test.ts`, `fundraising-print-requests.test.ts`, `fundraiser-materials-db.test.ts`, and additions to the TASK-504 tests, the private area, admin, logo pack, Analytics label and social picture tests; BDD `features/fundraising-materials-v2.feature` |

## Community fundraising, keeping in touch (TASK-515)

Two things that help staff look after fundraisers without having to remember everything: friendly
**automatic emails** to an organiser at the right moments, and **smart call prompts** in Admin >
Fundraising saying who is worth a ring today, and why. Fundraising is live with real fundraisers, so
the automatic emails **ship switched off**: nothing is sent until an admin has read every one in the
admin and switched them on. No new config value.

**The automatic emails** (to the organiser, from and replying to the events inbox, each its own
email kind on the Email audit):

| Email | Kind | When |
|---|---|---|
| 12, Your first gift is in! | `fundraiseFirstGift` | the first online gift (never money paid in) was paid in the last week |
| 13, You're halfway there! | `fundraiseHalfway` | raised (never counting Gift Aid) is at least half the target, and under it; only up to and including the date (never after it, and never once finished) |
| 14, You did it! Target reached | `fundraiseTargetReached` | raised has reached the target, up to and including the date (never after it, and never once finished); it cheers them on to beat their goal, with a **Raise my target** button to their private area (new wording, for sign off) |
| 15, One week to go | `fundraiseWeekBefore` | the date is 7 days away (or 6 or 5, if a run was missed) |
| 16, How did it go? | `fundraiseWeekAfter` | the date was 7 days ago (or 8 or 9), asking them to pay in |
| 17, Thank you from all of us | `fundraiseFinished` | straight after staff press **Mark finished**, with the link to their certificate; only if it was held back there for sign off, or its send failed there (marked in `fundraisers.touch_finished_pending`), the daily run sends it once it can, for up to 7 days after it was finished, never later. One not sent because automatic emails were off is never sent later. While it is held, nothing else (a year on) goes to that page |
| 18, A year ago today... | `fundraiseYearOn` | 365 days after the date, or after it was finished when it had no date (a week to catch a missed run); its **Do it again** button opens the sign up form filled in from last year (below) |
| Need a hand? | `fundraiseNeedAHand` | once, when the call prompt **Behind** holds (new wording, for sign off) |
| You're doing great | `fundraiseOnTrack` | once, when the call prompt **On track** holds (new wording, for sign off) |

The words are the ones Jaimie approved on 2026-10-02 (12 to 18), built with the shared email pieces
(`signOff`, `questionsBox`, `button`, and a new `meterBar` in `src/email/brand.ts`), with a plain text
part. Jaimie's rule: NBCC supports "children, young people and vulnerable adults", never "families",
so every one of these says "the children, young people and vulnerable adults we support" (a test
checks no email here says families). Every guard has to say yes before one goes:

- the **Automatic emails** switch is on (admins only) AND fundraising is on, both read at the start
  of a run and again before each email, so switching either off stops a run part way;
- a public page raising money, approved (or finished, for 17 and 18), with an organiser email, and
  never a page in memory of someone (`isQuietFundraiser` in `src/fundraising/touch-rules.ts`: a page
  set up in memory of someone, see "Community fundraising, in memory pages", and as before a page in
  a category whose key or name mentions "memory");
- the address is on neither the suppression list nor the opt out list (`email_opt_outs`, either
  kind); a list that cannot be read means no email;
- its wording, if new, has been approved by an admin (Jaimie, 2026-10-03; below). One waiting for
  sign off is skipped and NOT claimed, so it can still go once approved while it is due (if its
  window passes first, it simply does not go); the run logs one info line for it, by fundraiser id,
  and the next email due that is approved goes instead (never while the thank you is held). The daily
  run, the admin's next-run line and its preview all pick with one helper (`pickTouch`). Approvals
  that cannot be read count as none (the card says "Couldn't check sign-offs just now, so new
  wording is held.");
- a team page is judged on its whole team's total everywhere: the daily run, Mark finished and the
  preview (`touchFundraiser` in `src/db/fundraising-touch.ts`), so the wording (17 or its nothing
  raised version) and the amount always agree;
- each email goes once per fundraiser, ever: it is claimed in `fundraiser_touchpoints` (unique by
  fundraiser and kind) BEFORE it is sent, and the claim is given back only if the send fails, so
  another day can try. An error from the mail service can come after it has accepted an email (a
  timeout), so a send that errors may still have arrived; it is retried all the same (a rare second
  copy rather than one never sent), and the log says so plainly, by fundraiser id.

First gift, halfway and target are steps: only the highest that applies is ever sent, and none goes
once a higher one has gone. At most one automatic email a day for a fundraiser, in the order a week
after, a week before, target, halfway, first gift, need a hand, doing great, a year on; the two
gentle ones wait a week after any other. Days are UK calendar days (Europe/London), so the clocks
changing never moves one. The daily pass rides the 8am task (`npm run reminders`,
`src/scripts/send-reminders.ts`, its own try/catch) and logs one line:
`fundraising automatic emails: considered=N sent=N skipped=N failed=N waiting=N` (`waiting`: held back
for sign off), or why it did nothing
(`switched off`, `fundraising off`, `could not read`). Each email sent adds "An automatic email went
to the organiser" to the fundraiser's History.

**Admin > Fundraising > Automatic emails.** Jaimie's rule: every automatic email is readable in the
admin before any is sent. A card under the Weekly summary says whether they are on, with **Switch
automatic emails on/off** for admins (after a warning). It also says what the next 8am run would
send (were it on), so the first morning after switching on is no surprise: anyone already past
halfway or their target gets that email then, once; and how many more are held back waiting for sign
off. The emails themselves are no longer read in this card: **Read and approve these in All emails**
opens the **All emails** card at "Keeping in touch (automatic)" (see **All emails, in Admin >
Fundraising**), with a line saying that "How did it go?" and the thank you at Mark finished are under
"Finishing and paying in". Each open sign up says which one it would get next, and its **Read its
automatic emails** button opens All emails with that fundraiser chosen in **Show it for**, on the
email due next for them (the first one when none is due), as it would go to them today. Editors and
viewers see the card but not the switch.

**Signing off new wording** (Jaimie, 2026-10-03). New wording only sends once an admin approves it,
in the **All emails** card. Each version that needs it is approved on its own (`WORDING_KEYS` in
`src/fundraising/touch-rules.ts`): `target`, `finished`, `need_a_hand`, `on_track`, and the nothing
raised versions of 16, 17 and 18, `week_after_zero`, `finished_zero` and `year_on_zero` (approving the
usual 17 never approves its nothing raised version). Approving and withdrawing are for admins only,
each after a check, and each writes an `audit_log` row; editors and viewers see whether it is
approved. The Automatic emails card's next run line says how many are held back, and **Mark
finished** says when the thank you is held back. The card reads what is due again whenever a sign off
changes in All emails. Target, need a hand and on track were approved on 2026-10-03 (seeded by the migration);
finished and the three nothing raised versions wait for Jaimie.

**Smart call prompts.** Pills on the list and a **Keeping in touch** panel in the open sign up, each
with a reason (with the numbers) and a few talking points, and **Called** with an optional note
(editors and admins). The panel also lists the automatic emails it has had, and when. The rules are
one table in `src/fundraising/call-prompts.ts`:

| Prompt | When |
|---|---|
| Behind | the date is 1 to 14 days away and under a third of the target is raised |
| Ahead | the target is reached and the date is more than 7 days away |
| On track | within a quarter either side of the straight line from approval to the date, from a quarter of the way in |
| Gone quiet | no online gift for 14 days (or none since approval), while its page is live and before the date |
| Offer a tin | a bake sale or coffee morning with no bucket or tin asked for |
| Sponsor form | a run, walk or Santa dash (there is no way to ask for a sponsor form yet, so it shows until called) |
| Offer posters | within 21 days of the date, with no posters or leaflets asked for |

Behind, ahead and on track are one verdict on the pace, so at most one shows. A call clears its
prompt for good, except Gone quiet, which can come back a fortnight after the call. Calls are kept in
TASK-503's `fundraiser_calls` (`which = 'prompt'`, with the prompt), and show in History as "Called
about a prompt". The Monday summary adds one line to Waiting on us, "N calls to make from the
prompts: 2 behind, 1 gone quiet, ...", each one a thing waiting (the sponsor form suggestion shows
as a pill but is not counted there: nothing records it but a call); if they cannot be counted, the
summary still goes, without that line. Matching a kind uses `isKind` from
`src/fundraising/categories.ts` (TASK-514), so an old combined category and the new split ones are
read alike. **Mark finished** asks first, and says whether the organiser is emailed their thank you
(automatic emails on) or not.

**Do it again** (Jaimie's ask, so email 18's "it takes one click to make a new one" is true). Each
year on email carries a fresh link, `/fundraise?again=<token>`: 32 random bytes, kept only as a
sha256 with its own prefix (`fundraiser_again_tokens.token_hash`, like TASK-503's invites), working
for 60 days and once. The form asks `POST /api/fundraise/again { token }`, takes the token out of the
address bar at once, and fills in only boxes still empty (and a choice not yet made) with last year's
safe details: raising money or an event (or, should a link ever open a page in memory of someone,
which never gets email 18, the gentle in memory path with who it remembers and their dates, its name
left exactly as the family wrote it), the kind (and its own words for "something else"), the name
(a year in it earlier than this year becomes this year), the description, the target, the venue and
town, the Instagram and Facebook links, the organiser's first and last name, email and phone. Never
the date, the address, what they asked us for, anything staff noted, or anything about anyone who
gave. Then every question shows, to check and change. While the token is in the address, `/fundraise`
is served `no-store`, `noindex` and `Referrer-Policy: strict-origin`, as for an invite. The sign up
carries the token back (`again` on `POST /api/fundraise`), which marks the link used in one statement
with a History row on last year's fundraiser ("The organiser signed up to do it again"); the new sign
up waits for staff to approve it like any other. An unknown, used, out of date link, or one whose
fundraiser has gone, all get the same `404`. Each link gives last year's details at most 3 times
(`lookups`, counted in the same statement that reads it), so a forwarded link cannot keep fetching
the organiser's details for 60 days; the sign up can still use it after that. 30 tries in 15 minutes
from one address (`429` after).
If the link cannot be made, email 18 does not go that day (its words promise one click), and the
claim is given back.

### Routes

Admin routes need a session and the `fundraising` section.

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /api/fundraise/again` | anyone | `{ token }` | `200 { path, kind, kindOther, title, description, targetPence, venue, town, instagram, facebook, firstName, lastName, email, phone }`, at most 3 times a link; `404` for any link that does not work; `429` after 30 tries in 15 minutes |
| `GET /api/admin/fundraising/touch` | view | | `{ today, settings: { on, updatedAt, updatedBy }, kinds: [{ kind, label, when, newWording, waiting: [wordingKey] }], approvals: { <wordingKey>: { approvedAt, approvedBy } }, approvalsUnavailable, sent: { <id>: [{ kind, sentAt }] }, prompts: { <id>: [{ key, pill, label, reason, points }] }, promptCalls: { <id>: [...] }, due: { <id>: kind }, held: { <id>: kind } }` (`due`: what the next 8am run would send, were the switch on; `held`: what it would hold back for sign off) |
| `GET /api/admin/fundraising/touch/preview/:kind` | view | `?fundraiserId=` or `?sample=zero` (optional) | `{ kind, label, newWording, wordingKey, approval: { approvedAt, approvedBy } \| null, approvalsUnavailable, sample, title, subject, html, text }`; `404` for an unknown kind or fundraiser |
| `PUT /api/admin/fundraising/touch/settings` | admin | `{ on: true \| false }` | `{ on, updatedAt, updatedBy }`; `audit_log` `fundraising.touch_emails_switched` |
| `POST /api/admin/fundraising/touch/approvals/:key` | admin | | `{ approval: { key, approvedAt, approvedBy } }` (one already approved keeps its first approval); `404` for a key not in `WORDING_KEYS`; `audit_log` `fundraising.touch_wording_approved` |
| `DELETE /api/admin/fundraising/touch/approvals/:key` | admin | | `{ withdrawn }`; `404` for a key not in `WORDING_KEYS`; `audit_log` `fundraising.touch_wording_withdrawn` (with whose approval it was) |
| `POST /api/admin/fundraisers/:id/prompt-calls` | edit | `{ prompt, note? }` (500 at most) | `{ call }`; `audit_log` `fundraiser.prompt_called` |

`POST /api/admin/fundraisers/:id/finish` now also sends email 17 after the finish has committed,
through the same guards; a failure there never fails the answer.

### Data (`migrations/1791200000170_fundraising-keep-in-touch.js`, additive only)

`fundraiser_touchpoints` (fundraiser, kind, sent at, sent by; unique by fundraiser and kind; cleared
with its fundraiser), `fundraiser_again_tokens` (the Do it again links: last year's fundraiser, the
token's hash, made, runs out, how many times it has been looked up, used and by which new sign up), `fundraising_settings.touch_emails_on` (false by default) with
`touch_emails_updated_at` and `_by`, and `fundraiser_calls.prompt` (nullable), with the check on
`which` widened to allow `prompt`. Numbered 170, above main's 130 and the 160 an open task uses. The
new tables are in the nightly backup's table count (73).

`migrations/1791200000197_touch-wording-approvals.js` (additive only): `touch_wording_approvals` (key,
approved at, approved by; no row means not approved) and `fundraisers.touch_finished_pending`
(`held` or `failed`, nullable) with `_at`, the thank you to catch up; seeded with `target`, `need_a_hand` and
`on_track` as approved by Jaimie on 2026-10-03, each with an `audit_log` row. Numbered 197: after
190 and the 195 and 196 that open changes use, before 200. In the nightly backup's table count (76).

### Where it lives, and tests

Rules (pure): `src/fundraising/touch-rules.ts` (which email is due), `src/fundraising/call-prompts.ts`
(the prompt table), `src/fundraising/again.ts` (Do it again). Do it again's SQL and route:
`src/db/fundraiser-again.ts`, `src/routes/fundraise-again.ts`; the form's part is in
`assets/js/fundraise.js`, beside the invite's. Tests: `fundraising-again`, `fundraising-again-db`,
`fundraise-again-routes`, `fundraise-again-form` (jsdom) and `fundraise-pages-routes`. Emails: `src/fundraising/touch-emails.ts`. SQL: `src/db/fundraising-touch.ts`.
Sending: `src/fundraising/touch-runner.ts` (the daily pass and the finished email). Routes:
`src/routes/admin-fundraising-touch.ts` (the screen only calls its `preview/:kind` with `?fundraiserId=` now, from All emails' **Show it for**; the example and `?sample=zero` forms are no longer called by any screen and are kept for the BDD step that reads one. For a real fundraiser it builds the email with `touchEmailAsSent`, the function the daily run sends with, so a page for someone under 18 shows the hello to their parent or guardian, exactly as it would go). Screen: the `frTouch` block of `assets/js/admin/app.js`
(reached by one line hooks marked TASK-515), `#frTouch` in `admin.html`, styles at the end of
`assets/css/admin.css`. Unit tests: `fundraising-touch-rules` and `fundraising-call-prompts` (fixed
UK days, both clock changes), `fundraising-touch-emails` (each email, html and text, the approved
words), `fundraising-touch-runner` (switch off sends nothing, once only, opt outs and suppression,
the in memory guard, failures given back, the 8am wiring), `fundraising-touch-db`,
`fundraising-touch-migration`, `touch-wording-approvals-migration`, `admin-fundraising-touch-routes` (admin, editor, viewer,
and who may approve wording),
`admin-fundraising-touch-panel` (jsdom), `admin-fundraising-finish-touch`,
`fundraising-summary-prompts`, `admin-email-kinds` and `backup-plan`. BDD:
`features/fundraising-touch.feature` (ships off and only an admin switches it on; a viewer reads an
email; nothing goes while off; a week before goes once; nothing to an address that opted out; Mark
finished sends the thank you; the thank you is held back while its wording waits for sign off, an
editor cannot approve it, and once an admin does the daily run sends it, once; a viewer cannot record
a call; Do it again fills in the form from last year, once, and the new sign up waits for staff).

## Event pages

Every approved public event signed up through `/fundraise` has its own page at
`nbcc.scot/event/<short name>`, as a fundraiser raising money has one at `/fundraise/<slug>`. It is
drawn by the same code (`renderFundraiserPage` in `src/fundraising/render.ts`, the routes in
`src/routes/fundraise-pages.ts`), with what an event needs: when, from and to (and "to be
confirmed"), where in full, the cost, how people get in (as words, with the seller's link when
tickets are sold elsewhere; when NBCC sells them, the page has its own Get tickets section: see
"Event tickets" below), the good to know notes and the access.
Like a fundraiser's page it has the meter (gifts on the page plus cash staff record as paid in; an
event has no target, so no bar), the give form through NBCC's Stripe, the supporter wall, the
countdown (gone once the date has passed), news updates, the share links, its QR codes and its
materials (posters, leaflet, social images, sponsor form), every QR code now leading to the event's
own page. The Get involved card links to it ("See the event page and give", on the card's back).

- **One short name, two kinds.** The short name is the stored slug: one column, unique across both
  kinds, with its history (`fundraiser_slug_history`), so an event and a fundraiser can never share
  one, and the same rules and reserved words apply (`isValidSlug`). `/event/<x>` answers only for an
  event and `/fundraise/<x>` only for a fundraiser raising money; either sends the other kind on to
  its own address with a 302 that is never kept (`Cache-Control: no-store`), so a staff change of
  kind, or a link typed the wrong way, never breaks, a change of kind made twice never loops, and a
  giver's thank you (`?thanks=1&session_id=`) is never kept on the way. An old short name goes on to
  the new one with a 301 kept an hour, as a fundraiser's does.
- **Group and business names.** An event is often credited to a group or a business ("The Red
  Lion"), so its page never takes the first word of that name as a person's: it says "this event's
  total", "Add a message to the wall", "Every share helps this event reach more people", "This event
  has finished", and on the day just "Today's the day!". A fundraiser's page is unchanged.
- **Staff set the short name before approving an event.** `fundraisers.slug_set_at` says when they
  last saved it (`PATCH` with `slug`, the suggested one kept or a new one). Approving an event
  without it is refused under the row's lock (`409`, "Give this event a short name first, for its web
  address."). In the admin the Approve button is replaced by that line, the address it would have,
  and "Use this short name". A fundraiser raising money keeps its suggested address as before.
- **Emails.** An event approved while fundraising is off now waits for its page is live email, like
  any page holder. An event's is its own, "Your event's page is live" (`buildApprovedEmail` in
  `src/fundraising/emails.ts`): share the page, put up the posters with their QR codes, point people
  to the page on the day, and reply for help; no sponsorship tips. The change and news emails link
  the event's page. News photos show on an event's page as on a fundraiser's.
- **QR codes on printed pieces** (`/q/<id>-<size>`) go to the event's page; an event whose stored
  address cannot be linked goes to Get involved, as before.
- **Switched off**, an event's page is the site's 404, like every fundraising page. `/event` is in
  `RESERVED_PREFIXES`. Fundraiser pages are not in the sitemap, so event pages are not either.
- **Data:** `migrations/1791200000185_event-pages.js`, additive: one nullable column,
  `fundraisers.slug_set_at`, filled for every event already approved or finished (they keep their
  address, counted as set).
- **Tests:** `test/unit/event-pages-*.test.ts` (model, migration, database, admin API, routes,
  drawing, links, the page's script, the admin screen); BDD `features/event-pages.feature`.

## Community fundraising, team pages

Jaimie's decisions of 2026-10-03 (the Get involved master list, points 29, 34a and 35). A
sponsorship fundraiser (raising money, never an event) can be a **team**. The person who sets it up
is the **team organiser** (never "captain"): they get the team's emails and look after the team page.
Everything below is off while fundraising is switched off, like the rest of fundraising.

- **The sign up.** "Just me, or a team?" comes straight after "Are you 18 or over?", for someone
  raising money only, with nothing chosen. A team asks the team's name and target (in place of the
  page's), says who the team organiser is, and may add people: a first name, surname and email each
  ("If someone is under 18, tick the box in their row and give their parent or guardian's email"),
  up to 30, added and removed a row at a time. Each row has a tick, **"This person is under 18"**:
  ticked, the email box in that row is labelled "Parent or guardian's email", the tick is kept with
  the held person (`team_invites.under_18`, `migrations/1791200000240_team-invite-under-18.js`,
  cleared with their name and email), staff see "under 18, parent or guardian's email" beside them in
  the admin, the invite and its one reminder speak to the parent ("Robin has invited Jack to join
  Exampleton Juniors"), and the invite's link opens the join form with "Is the person joining under
  18?" already answered Yes (they can change it). A name is kept to one plain line (no line breaks
  or other control characters, one space between words), and where a subject line or a heading names
  the child it is only ever a safe first name, or "your child". One address can be on a team's list
  once (the database keeps it so), so two children at one parent's email cannot both be added: the
  form says "That email is already on the list. If two children share a parent's email, add one here
  and the other can join with the team link." They are **held**: nothing is sent until staff approve the team. Sharing with another
  cause asks one more question, "Just you, or the whole team?". A sign up sent without the question
  (a page opened before it, or the API) is just me, as before.
- **Approval.** Staff approve the team as any sign up. Then (after it commits, best effort) each
  person added is invited (`fundraiseTeamInvite`), and the team organiser gets "Your team page is
  live" (`fundraiseTeamLive`), always with the join link and a short message to forward to a group
  chat. An invite says why they got it ("[team organiser] gave us your email so we could invite you,
  or [first name] if this is a parent or guardian's email, to join [team] for their [kind] on
  [date]"), that that person is the team organiser, and that questions can still come to NBCC (a
  reply, events@ or 01292 811 015); its button opens the join form filled in. For someone the team
  organiser ticked as under 18 the invite is to their parent or guardian, with no maybe: "[team
  organiser] gave us your email, as the parent or guardian of [first name], so we could invite [first
  name] to join [team]", and "As [first name] is under 18, you set up the page as the parent or
  guardian". A team organiser whose name is a group's or a business's is named in full ("The Example
  Arms has invited you"), never by its first word. Every email to an
  invitee ends "Not for you? Ignore this and we won't email again." An address on the suppression or
  opt out list is never invited. A team approved while fundraising is off waits for the switch, as
  every "Your page is live" does.
- **Joining.** `/fundraise/<team>/join`, from the team page's "Join this team", the join link, or an
  invite: first name, surname, email (a parent's for someone under 18), "Are you 18 or over?" (the
  sign up form's kind note on No, and the server refuses it), an optional target and a line about
  why. A whole team split is only said ("This team shares what it raises: 50% comes to NBCC..."),
  never asked, and every member page has it; with just the team organiser's split each member is
  asked. A join makes a **member page** (`<First>'s page for <team>`, the team's kind, date, place
  and website choice) linked to the team in the same transaction, waiting for staff: **staff approve
  every member page**. The member is thanked (`fundraiseTeamJoined`) and the events inbox told
  (`fundraiseTeamJoinStaff`).
- **The team page** (`/fundraise/<team>`): the team's meter is its own gifts and cash plus every
  current member page's (approved or finished, not taken off), with Gift Aid shown under it; giving,
  the wall, news, the QR code and materials are the team page's own. "The team" lists the member
  pages **A to Z by first name**, each with a small meter and a link: never a ranking. A member page
  says "Part of the team ...". Get involved lists a team once, with its whole meter, and never its
  member pages on their own. The combined total is the team's everywhere: the team page and its
  JSON (`/api/fundraisers/<team>`), Get involved, the admin's list and team view, and the automatic
  emails (halfway and target reached read the whole total against the team's target). A team page
  speaks of the team ("counts towards Exampleton Juniors' total", "Every share helps Exampleton
  Juniors", "About the team", "Team organiser: Robin O."); a member page keeps its own name.
- **The team organiser's private area** (`assets/js/fundraise-team-manage.js`): "Your team" on the
  team's card: the join link and the message to forward (each to copy), who has joined (live and
  waiting), and Remove (the member page carries on as their own, no longer counting; the events
  inbox is told, `fundraiseTeamMemberRemoved`). Team news is the team page's own News updates.
- **Handover, staff only.** Admin > Fundraising hands the team organiser role to a member or someone
  new (with their phone). We email them a 6 digit code (`fundraiseTeamHandoverCode`), kept only as a
  keyed hash bound to the team and their email, working for 3 days and 5 tries; they put it in under
  "Taking over a team?" on `/fundraise/manage`, and only then do the team's organiser name, email and
  phone change. No self service handover.
- **Automatic team emails** (the daily 8am task; only while Automatic emails and fundraising are
  both on; never to an address that asked us to stop; each claimed before it is sent, so once):
  the team organiser's "Did you send the invite to your team?" on day 3 after the team went live,
  and a second on day 10 only if still nobody has joined (`fundraiseTeamNudge`); nothing once anyone
  has joined or after the event. ONE gentle reminder to someone invited, 5 days after the invite, if
  they have not joined (`fundraiseTeamInviteReminder`). **Every day, whatever the switches**, the
  names, emails and tokens of the people added are deleted 30 days after the invite (or after they
  were added, if never sent) or once the event is over, whichever is sooner.
- **The split lock** holds for a whole team split: only an admin corrects it, on the team, and only
  while neither the team nor any current member has a gift; it changes on every member page with it.
  A member page of a whole team split refuses a correction of its own (`team_split`).
- **Admin > Fundraising**: a team is marked Team and a member sign up "Joining <team>"; an open team
  shows its split, join link, whole meter, members (every status) and its invites (held, invited,
  reminded, joined, name and email deleted), and the handover. Staff (editors and admins) can take
  a member off the team there too, with the same effect as the team organiser's remove; History says
  "Taken off the team by NBCC". Changing a team (or a page still on one) to an event is refused with
  409 "A team raises money, so it can't be an event. Take everyone off the team first." The Monday summary says how many team
  member sign ups wait for staff, and which teams have had nobody join 10 days after going live.

**After the independent review (PR #645):**
- A team is **always on the website** (it needs a page to be joined): the form never asks a team,
  and the server refuses a team sent as not public. A team approved while fundraising is off always
  waits for the switch, and nothing team related (invites, reminders, nudges, the live email, a
  handover code) emails anyone while fundraising is off.
- **Retention:** invites and reminders go with no name in the email log; when an invite's details are
  deleted (30 days, or after the event, or at once when staff decline the team), its email log rows
  are anonymised too (the address becomes "deleted team invitee", the subject only the team). The
  events inbox's sign up email gives only how many people are to be invited. A handover's name,
  email, phone and code hash are cleared 30 days after it is confirmed, cancelled or runs out. Send
  failures are logged with any address taken out.
- A member joining takes the team's whole team split as it is at that moment, under the team's lock.
  An invite whose email joins another way is marked joined, so it is never reminded. The reminder
  has a link of its own; the invite's first link keeps working. The invite's footer says one gentle
  reminder at most may follow.
- An admin correcting a team's split says whose split it is (asked again when sharing is turned on).
  For a team, first gift and gone quiet read its members' gifts too. The Monday summary lists a team
  nobody has joined only from day 10 to day 30, and never after its event. An invite's link fills
  nothing in while fundraising is off or the team is no longer approved. A handover only goes to an
  approved member still on the team, or someone new.

### Routes

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /api/fundraise` | anyone | as before, plus `team: "me" \| "team"`, `teamShareMode: "team" \| "organiser" \| null`, `teamMembers: [{ firstName, lastName, email }]` | as before; a problem with a person added is named by place, `teamMembers.<n>.<part>` |
| `GET /fundraise/:slug/join` | anyone | | the join form for an approved team (a finished one says it is not taking members); never indexed or kept |
| `POST /api/fundraise/teams/:slug/join` | anyone | `{ firstName, lastName, email, over18, targetPence?, why?, sharesWithOther?, nbccSharePercent?, otherCauseName?, invite?, captchaToken, company }` | `200`; `400 { fields }`; `404` if the team is not taking members; honeypot, the spam check and 5 in 10 minutes from one address, as the sign up |
| `POST /api/fundraise/team-invite` | anyone | `{ token }` | `200 { firstName, lastName, email, teamSlug }`; `404` for anything else; 30 in 15 minutes |
| `GET /api/fundraise/manage/fundraisers/:id/team` | the signed in team organiser | | `{ joinUrl, forwardMessage, shareMode, members: [{ id, name, status, raisedPence, targetPence, pageUrl }] }`; `404` for a page that is not a team |
| `POST /api/fundraise/manage/fundraisers/:id/team/members/:memberId/remove` | the signed in team organiser, from our own page | | `200`; `404` for someone not on the team |
| `POST /api/fundraise/manage/handover` | from our own page | `{ email, code }` | `200 { status: "ok", title }`; `401` for a wrong, old or used code; limited per email and per address |
| `GET /api/admin/fundraisers/:id/team` | view | | `{ kind: "team", shareMode, split, joinUrl, meter, members, invites, handover }`, `{ kind: "member", left, team }` or `{ kind: "none" }` |
| `POST /api/admin/fundraisers/:id/team/handover` | edit | `{ memberId, phone? }` or `{ firstName, lastName, email, phone }` | `{ handover, emailed }`; the code goes only in the email |
| `POST /api/admin/fundraisers/:id/team/handover/cancel` | edit | | `{ cancelled }` |
| `POST /api/admin/fundraisers/:id/team/members/:memberId/remove` | edit | | `{ removed }`; `404` for someone not on the team; `audit_log` `fundraiser.member_removed` / `fundraiser.removed_from_team` with `by: "staff"` |

### Data (`migrations/1791200000190_teams.js`, additive only)

`fundraisers.is_team` (false by default), `team_id` (a member page's team), `team_share_mode`
(`team` or `organiser`, only on a team sharing with another cause), `team_left_at` / `_by` (taken off
the team), `team_nudge_1_at` / `_2_at` (the nudges, claimed before sending), with checks: a team is
raising money and never a member; a page is never its own team. `team_invites` (team, first name,
surname, email, the sha256 of the invite link's token, added, sent, reminded, joined and by which
member page, deleted; one live invite per address on a team; a deleted one keeps no name, email or
token). `team_handovers` (team, the new organiser's name, email and phone, the code's keyed hash,
runs out, tries, who started it, confirmed or cancelled; one open a team). Numbered 190, after the
185 the event pages change adds. The new tables are in the nightly backup's table count (75).

### Where it lives, and tests

Rules (pure): `src/fundraising/teams.ts`. Emails (pure, NEW WORDING for Jaimie):
`src/fundraising/team-page-emails.ts`. Sending: `src/fundraising/team-send.ts` (approval, joining,
removal, handover) and `src/fundraising/team-runner.ts` (the daily pass, on `send-reminders.ts`).
SQL: `src/db/fundraising-teams.ts` (and `createFundraiser`'s extra step, `setFundraiserSplit`'s team
rule and `listFundraisersWhere` in `src/db/fundraisers.ts`). Pages: `src/fundraising/team-render.ts`,
`src/routes/team-pages.ts`, `fundraise-join.html`, `assets/js/fundraise-join.js`; the sign up step in
`fundraise.html` and `assets/js/fundraise.js`. Routes: `src/routes/fundraise-teams.ts` (mounted before
`fundraiseRouter`, whose retired link route would take `/manage/handover`) and
`src/routes/admin-fundraising-teams.ts`. Screen: the `frGroup` block of `assets/js/admin/app.js`.
Unit tests: `fundraising-teams`, `fundraising-team-page-emails`, `fundraising-team-send`,
`fundraising-send-teams`, `fundraising-team-runner`, `fundraising-teams-db`, `fundraisers-db-teams`,
`teams-migration`, `fundraise-signup-teams-routes`, `fundraise-teams-routes`,
`admin-fundraising-teams-routes`, `team-pages-routes`, `fundraising-team-render`,
`fundraise-signup-teams` (jsdom), `fundraise-join-page` (jsdom), `fundraise-team-manage-page` (jsdom),
`admin-fundraising-teams-panel` (jsdom), `fundraising-summary-teams`, `admin-email-kinds` and
`backup-plan`. BDD: `features/fundraising-teams.feature` (a team signs up with members and approval
sends the invites; joining from an invite, staff approve the member, gifts count on the member and
the team; a whole team split is every member's; members A to Z; someone under 18 cannot join).

## Community fundraising, in memory pages

A page raising money **in memory of someone** (Jaimie, 2026-10-03), set up by the family, a friend
or a funeral director, each ticking "I have the family's permission". Staff check it before it goes
live, as every page. The rules are in `src/fundraising/in-memory.ts` (pure, unit tested); migration
`1791200000195_in-memory.js` is additive (new columns only, no new tables, so the backups are
unchanged). No new config value.

**Signing up** (`/fundraise`, raising money only). Straight after "Are you 18 or over?":
**Is this in memory of someone?**, Yes or No with nothing chosen. A Yes asks their name (up to 100),
their dates in their own words (optional, up to 60, like "1948 to 2026"), **Who is setting up the
page?** (A family member, A friend, A funeral director) and the permission tick. The name for the
page becomes optional: left empty, it is "In memory of <name>". With a target, **Show the target on
the page?** is asked, Yes or No with nothing chosen. A photo is not uploaded on the form: the form
says to email it to events@nbcc.scot, and staff add it with the page's usual photo upload (so it is
checked like every page photo). `POST /api/fundraise` takes `inMemory`, `memoryName`, `memoryDates`,
`memorySetupBy` (`family`, `friend` or `funeral_director`), `memoryPermission` (must be `true`) and
`memoryShowTarget` (asked only with a target); a sign up that sends no `inMemory` is not in memory,
as before. An event is never in memory.

**The page** (`/fundraise/<slug>`, drawn by `src/fundraising/memory-render.ts`) is the same page made
quieter: "In memory of <name>" with the dates under it and their photo if staff added one; the house
palette at a lower contrast (`.fr-memory-page` in `fundraising.css`); no countdown, no "Good luck"
banner, nothing festive. What has been given always shows; the target, the bar and the percentage
only if the family chose to show them (`memoryMeter`, also on its Get involved card and in
`GET /api/fundraisers/:slug`). Giving and Gift Aid work exactly as on every page. **Every message
waits for staff**: until approved it is held off the wall (and off the organiser's list). After
giving, the optional step adds **Let the family know I gave** (unticked unless ticked), sent as
`familyNotify` to `POST /api/fundraisers/:slug/wall-message` and kept only on an in memory page.

**The private area.** An in memory page's gifts list is **People who asked us to let you know they
gave**: only givers who ticked it, by the name they gave, with their message once staff have
approved it, never an amount or an email address. **Thank your supporters** offers only those givers
(the database refuses any other gift on an in memory page). **Funeral collection envelopes** sit
first in Your materials.

**Funeral collection envelopes** (`src/fundraising/envelope.ts`): a DL envelope (110 x 220mm, the
common size for collection and Gift Aid envelopes), printed on its front, one to a page:
"In memory of <name>", the dates, the QR code to the page and its address, and a Gift Aid
declaration for one gift: HMRC's model single donation declaration with the amount written in
("I want to Gift Aid my donation of £____ to the Night Before Christmas Campaign. I am a UK
taxpayer...", the same liability sentence as the give form's), a tick box, full name, home address,
postcode and the date, and the note to tell us of a change. NBCC's charity statement runs along the
bottom word for word. From `GET /api/fundraise/manage/fundraisers/:id/materials/envelopes` (the
organiser, signed in) and `GET /api/admin/fundraisers/:id/materials/envelopes` (staff, view), only
for an in memory page that is approved or finished.

**The other materials are the gentle versions too** (`src/fundraising/materials.ts`,
`assets/js/fundraise-social.js`): the posters (A4, A3), the A5 leaflet, the pictures to share and
the sponsor form never say "Fundraising for NBCC". They say "In memory" and "In memory of <name>"
with the dates, "Give in their memory" by the QR code, the target only if the family chose to show
it ("Raising £X in their memory"), the foot line "Every gift goes to NBCC in their memory, for the
children, young people and vulnerable adults we support.", and use the page's quieter cream and
tan (the pictures with the logo that has maroon lettering). The charity statement, any split
statement and HMRC's sponsorship declaration stay word for word.

**Emails.** The only automatic email the organiser gets is **email 19** when staff approve it with a
page ("Your page in memory of <name>", `fundraiseApproved`, the words Jaimie approved on 2026-10-02,
`src/fundraising/memory-emails.ts`). No thank you for signing up (it is upbeat: the screen says we
will call instead), no emails about changes or news updates, none of the keep in touch emails
(`isQuietFundraiser` now asks `isInMemory` first), and no smart call prompts. The sign in code still
goes when they ask for it. The events inbox summary says who it remembers and who set it up. **No
automatic anniversary email**: a year after the page went live, Admin > Fundraising shows **A year
on** and the Monday summary says "N in memory pages a year on: decide whether to get in touch";
staff press **Done** (with an optional note) when they have.

**Admin > Fundraising.** An in memory page has an **In memory** pill, **Messages to check** while any
wait, and **A year on** when due. Open, its **In memory** panel shows who it remembers, who set it
up with the family's permission, the target choice, the envelopes, and the year on reminder. On its
wall each waiting message has **Approve for the page**; **Hide from the page** still says no. An
admin can **Correct the in memory details** (their name, dates, who set it up, the target choice)
when the organiser asks; the family's permission stays as it was given, and the History says
"In memory details corrected". The photo is the page's usual staff photo upload. The
Monday summary counts "N messages to check on in memory pages".

**Privacy of amounts.** On an in memory page "Show how much I gave" starts unticked, and a giver
who ticks "Let the family know I gave" never has their amount on the page (the server sets
`showAmount` to false). The family's list and the page's wall date each gift by its day only
(`memoryDay`), never the time, so a name cannot be matched to an amount by when it came.

**Always just me.** An in memory page is never a team: the sign up puts the team question away and
answers it Just me while in memory is Yes, and the server refuses `team: "team"` with in memory
("A page in memory of someone is just for you, not a team...").

**The envelopes come back sealed.** Each envelope says "Please seal your envelope and hand it back
to the person collecting. All envelopes are posted to NBCC unopened, so we can claim Gift Aid.",
carries a small reference (the page's short name, "Ref: ime"), and the line "This gift is my own
money. It is not from a collection, a company or a group." by the declaration. The print tip and the
private area tell whoever collects to post the sealed envelopes to us unopened at The Elves'
Workshop (or hand them in) rather than paying the cash in online. No certificate of thanks is offered
for an in memory page, and the thank you to a giver (email 20) says "In memory" and closes "With warm
wishes,". Names and dates are kept to one plain line (line breaks and control characters become
spaces). An admin's name correction renames a page still called "In memory of <old name>".

**Clarity (Jaimie, A2, and an audit).** On the sign up, the line at the top of the in memory
questions follows who is setting it up: "Take your time..." until they choose, "We are so sorry for
your loss..." for a family member or a friend, and "Thank you for setting this up for the family..."
for a funeral director (who also gets the professional email 19). In the private area an in memory
page's pay in box asks them not to open the envelopes but post them to us sealed, with paying in other
cash behind "Collected other cash, not in envelopes? Pay it in here.". Shares say "In memory of <name>,
giving to the Night Before Christmas Campaign (NBCC)", the story picture "Give to NBCC in their
memory", and ticking "Let the family know I gave" unticks and locks "Show how much I gave". An
envelope for a page sharing with another cause carries the split statement too.

**Rolling back.** The migration is additive, but rolling the CODE back to before in memory pages
would show their held messages and their hidden targets, and send them the upbeat emails. If a code
rollback is ever needed once in memory pages exist, first make those pages not public (or switch
the automatic emails off) in Admin > Fundraising.

| Route | Who | What |
|---|---|---|
| `GET /api/admin/fundraising/memory-waiting` | fundraising view | `{ counts: { <id>: n } }` messages waiting per page |
| `POST /api/admin/fundraisers/:id/wall/:donationId/approve` | fundraising edit | the message shows; audit `fundraiser.message_approved` |
| `POST /api/admin/fundraisers/:id/memory/year-on-done` `{ note? }` | fundraising edit | the year on reminder is dealt with; audit `fundraiser.memory_year_on_done`; 409 if already |
| `GET /api/admin/fundraisers/:id/materials/envelopes` | fundraising view | the envelope page |
| `PUT /api/admin/fundraisers/:id/memory` `{ memoryName, memoryDates, memorySetupBy, memoryShowTarget }` | an admin (fundraising edit) | correct the in memory details, never the permission; audit `fundraiser.memory_changed` with what it was and is now; 404 if not in memory |
| `GET /api/fundraise/manage/fundraisers/:id/materials/envelopes` | the signed in organiser | the envelope page |

Tests: `test/unit/fundraising-in-memory*.test.ts`, `fundraise-memory-*.test.ts`,
`fundraiser-memory-*.test.ts`, `fundraising-envelope.test.ts`, `fundraise-signup-memory.test.ts`,
`fundraise-manage-memory.test.ts`, `admin-fundraising-memory-panel.test.ts`,
`in-memory-migration.test.ts`; BDD `features/fundraising-in-memory.feature`.
## What gifts could do: impact examples on fundraiser, event and team pages

Jaimie approved, 2026-10-03. One shared list of examples, like "£25 could help buy a pair of school
shoes", that fundraiser, event and team pages show, and that a Fill a Red Bag page will read later
(so it lives in `src/impact/`, not under fundraising). OSCR-safe wording only: every example starts
"could", and none promises ("will buy", "will pay for", "will cover", "will fund", "will provide",
"pays for", "buys"), so a gift never reads as a promise and never becomes a restricted fund. The
server refuses anything else, and so does the table's own check (a check violation is a plain 400).

On a page (`src/fundraising/impact-render.ts`, placed by `renderFundraiserPage`):

- **Under each give amount** that has an example (£5, £10 and £50 to start; £20 has none), its words,
  small, inside the amount's label, so a screen reader hears "£5 could help put a cosy pair of
  pyjamas in a Red Bag" as the choice.
- **Under your own amount**, as it is typed (`assets/js/fundraiser.js`, from the form's `data-could`):
  the line of the example with the largest amount at or below it, nothing below £5 or below the
  page's minimum. Typing £30 shows "£25 could help buy a pair of school shoes". It is a live region
  that is always there (empty until it has something), named by the box's `aria-describedby`, and
  written only when its words change.
- **Under the meter** (`meterImpactLine`): below £50 "Every pound could help fill a Red Bag Full of Joy";
  from £50 "What's been raised so far could fill around N Red Bags Full of Joy" (N is the total over
  the Red Bag example's amount, rounded down; "1 Red Bag Full of Joy" in the singular); from £400 it
  adds ", or help N children start school in a uniform that fits" (the total over the uniform
  example's amount; never "0 children": only once the total covers one). A team page counts the team's combined total. Switch the Red Bag example off and
  the line goes; switch the uniform one off and that part goes.
- **The footnote**, shown once wherever any of it shows: "These show what gifts could do. Every gift
  goes where it's needed most." Under the give amounts when they show examples, else under the
  meter. When both show, the meter's copy is `data-nojs`: without JavaScript the give form is
  hidden, so it stands in; the script that shows the form hides it.
- **Never on a page in memory of someone** (quiet pages): the route passes no list when
  `showsImpact(f)` is false, which asks `isQuietFundraiser` (`src/fundraising/touch-rules.ts`: the
  `in_memory` flag, or a category that mentions memory); and the in memory page's own renderer
  draws the give form with none of it (`renderGiveForm(p, words)` with no impact).

The pages read the list as last read, kept for a minute (`loadImpactExamples`, never throws: on a
failure the page simply shows none).

### Admin > Fundraising, What gifts could do

A card after Categories. Everyone who can see Fundraising sees the list, read only ("Only an admin
can change these."); admins get the controls. Each example switched on, in the list's order, with
where it shows ("Under the give amounts" or "Big totals only", and which part of the meter line
counts with it); Edit (amount, words, Show under the give amounts) in its row; Move up and Move down;
Switch off (after asking) and Switch on. The £50 Red Bag and £40 uniform examples have no Edit: "Used
for the line under the meter, so its words and amount are fixed." (the server refuses with a 409),
but switch off and on and move like the rest. Below, add one: amount in pounds, what it could do,
and the give amounts tick. Nothing is deleted. Each change is in `audit_log` (`impact.example_added`, `impact.example_changed`,
`impact.example_moved`, entity `impact_example`).

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/admin/impact-examples` | Fundraising view | | `{ examples: [{ id, amountPence, wording, active, sortOrder, onGiveForm, meterLine, createdAt, createdBy, updatedAt, updatedBy }] }`, in the list's order |
| `POST /api/admin/impact-examples` | an admin | `{ amountPence (100 to 1000000), wording (10 to 160, starts could, never a promise), onGiveForm? }` | `201 { example }`, switched on, at the end; `400` with the reason |
| `PATCH /api/admin/impact-examples/:id` | an admin | `{ amountPence?, wording?, active?, onGiveForm? }` | `200 { example }`; `400`; `404`; `409` for a new amount or words on one the meter line counts with |
| `POST /api/admin/impact-examples/:id/move` | an admin | `{ direction: "up" \| "down" }` | `200 { examples }` (past any switched the other way; at the end, nothing changes); `404` |

### Data (`migrations/1791200000200_impact-examples.js`, additive only)

A new table, `impact_examples`: `id`, `amount_pence` (100 to 1,000,000), `wording` (checked: starts
could, never a promise), `active`, `sort_order`, `on_give_form` (false: big totals
only), `meter_line` (`red_bags` or `uniforms`, unique, set by the migration and not by staff),
`created_at` / `_by`, `updated_at` / `_by`. Seeded, only into an empty table, with the five Jaimie
approved: £5 "could help put a cosy pair of pyjamas in a Red Bag", £10 "could help put pyjamas,
socks, a hat and gloves in a Red Bag", £25 "could help buy a pair of school shoes", £50 "could help
fill a whole Red Bag Full of Joy" (`red_bags`), and £40 "could help a child start school in a uniform
that fits" (big totals only, `uniforms`). Numbered 200, after 195, 197 and 198, which merge first.
In the nightly backup's table count (77).

### Where it lives, and tests

Rules (pure): `src/impact/examples.ts`. SQL: `src/db/impact-examples.ts`. Page pieces:
`src/fundraising/impact-render.ts`; the own amount line in `assets/js/fundraiser.js`; styles in
`assets/css/fundraising.css`. Route: `src/routes/admin-impact-examples.ts`; the page route passes the
list in `src/routes/fundraise-pages.ts`. Screen: the `frImpact` block of `assets/js/admin/app.js`.
Unit tests: `impact-examples`, `impact-examples-migration`, `impact-examples-db`,
`admin-impact-examples-routes`, `fundraiser-page-impact` (jsdom), `fundraiser-page-impact-route`,
`admin-impact-examples-card` (jsdom) and `backup-plan`. BDD: `features/impact-examples.feature` (an
admin adds an example and a fundraiser's page shows it; words not starting with could, or that
promise, are refused; only an admin may add one).

## The sign up tidy: one question at a time, the welcome pack, and a form that fits each person

Jaimie's changes of 2026-10-03, with the form appropriateness audit: the sign up form at
`/fundraise` should be low friction, upbeat, easy, simple and encouraging, and gentle for someone
setting up a page in memory of someone. It replaces the "one question after another" reveal and the
"Show all the questions at once" button described under TASK-511 above.

**One question at a time.** `assets/js/fundraise-steps.js` (shared with the team join form) shows one
`[data-step]` at a time, with **Back** and **Next** under it, and a progress bar of stages above
(stages, not questions, because the questions branch). The stage they are on is marked
`aria-current="step"` and says "Step 2 of 5: Your fundraiser" in words, never by colour alone; the
ones done are ticked; near the end the words lift ("Nearly there!" on stage 4, "Last step!" on 5).
Nothing goes red while someone types. On Next, anything missing or wrong on that step gets its own
short warm prompt ("Almost! Just add your first name.", from `data-invalid-message`, through
`main.js`'s shared highlighting) and the focus moves to it. Back keeps every answer. Each new step is
said in a polite live region and takes the focus. Enter in a box before the last step is Next. On
the last step, Send checks the whole form and goes back to the first step with a problem; the
server's messages do the same. Without the script every question is in the page as it is.

**Three paths from the first question**: raising money, holding an event, or a page in memory of
someone (now the third choice there; the old "Is this in memory of someone?" step is gone, and it is
still sent as `path: "raising"` with `inMemory: true`). A step or box is only on the paths named in
its `data-paths`; its words follow the path (`data-say-<path>`, `data-invalid-<path>`).

| Stage | Raising money / holding an event | In memory of someone |
| --- | --- | --- |
| 1 | **Your fundraiser** (**Your event**), the fun part first: what you are planning, a quick 18 or over, team, is it a sporting event, the category, the T-shirt size, about it, the event's card, the target, who is fundraising (me, or my child), a business, school or group, Get involved | **About them**: what you are planning, 18 or over, who the page is for and who is setting it up |
| 2 | **About you**: your details, and the address for the welcome pack | **The page**: how people will be giving, about the page, an amount, Get involved, sharing and the split check, sharing the page |
| 3 | **Sharing**: another cause, the split check, social media | **Your details** |
| 4 | **What you'd like**: materials | **Anything we can send**: envelopes, QR cards and posters, and an address only if something is asked for |
| 5 | **Check and send** | **Check the details** |

What is asked, and why:

- **"Rather do this together?"** A tinted panel above the form with the phone number (a `tel:` link).
- **The address** is asked of everyone raising money or holding an event, "So we can post your
  welcome pack." It uses the four `post_*` boxes the form already had (TASK-499), now always asked
  and always kept. In memory there is no welcome pack: the address is asked only when something is
  to be sent ("This can be the funeral director's address.").
- **"Is it a sporting event?"** (raising money only, never in memory, asked before the category). A
  Yes offers only the sporting categories and asks a **T-shirt size** (Kids 3 to 4 up to 13 to 14,
  Adult XS to XXL; nothing chosen for them). A No offers the rest. Other is in both. Each category has
  a `sporty` mark; admins tick **Sporting** in Admin > Fundraising, Categories.
- **The split check.** After the sharing details, a step shows the split as the page and posters
  will say it, with a required tick "Yes, that's right". Changing the split asks for the tick again.
- **A child.** "Who is doing the fundraising?" Me, or my child or a young person I look after: their
  first name (shown on the page) and the parent's or guardian's tick.
- **A business, school or group**: its name (the page says "Organised by" it) and, optionally,
  whether the employer will match what is raised.
- **Get involved.** "Shall we list it on our Get involved page?" Every sign up now gets a page
  (`public` is always true); a No keeps it off the list (`off_list_at`, `off_list_by = 'organiser'`,
  the mechanism staff already use). A team is always listed.
- **Social media** is one question: a shout out, a mention, or no thanks (`socialOk` and
  `wants.shoutOut` as before).
- **Someone from NBCC to come along** is asked only when there is a day or a place to come along to.
- **An event** may be "Free entry, donations welcome", may ask for printed QR codes for its page, and
  may give an amount it hopes to raise.
- **In memory of someone** is asked only what fits: who it remembers, who is setting it up (now also
  "Someone else, like a colleague, club or church"; a funeral director gives the business name, shown
  as "Set up by ... for the family", and may give the family's contact for givers' names), how people
  will be giving (its own list of categories, `memory_only`), an optional date and place for the
  funeral or service, optional words about them, one gentle question about sharing the page, and
  collection envelopes, QR cards or posters for the service. It is never asked about a team, sport, a
  T-shirt, a shout out, someone coming along or the newsletter, and nothing on its path has an
  exclamation mark. Its thank you is quiet, and a short receipt email goes in place of nothing.
- **Under 18** says the same on every form, with no example to copy.
- **"Not decided yet"** is a tick beside the date. Ticked, the date is optional (an event's too) and
  staff see "Date to be confirmed" in the admin and the summary email. An event with no date has its
  page but no card on Get involved until staff add one.
- **"T-shirt"** keeps its hyphen: the one word the no hyphen copy rule lets through
  (`test/unit/copy-rules.test.ts`, the whole word only).
- **Joining a team for someone under 18.** The join form asks "Is the person joining under 18?" A
  Yes asks the parent's or guardian's first name and their tick, and "Why is Jack taking part?".
  Emails about that member page greet the parent: "Hi Sarah, this is about Jack's page."
  (`greetGuardian` in `src/fundraising/signup-tidy-emails.ts`, applied where they are sent).

**A form left open across the deploy.** The rebuilt form sends `formVersion: 2`. A sign up without
it is the old page still open in someone's browser: it is taken by the old rules for what it never
asked (an address only when something is to be posted, no split tick, the old in memory categories),
so no sign up is lost in the deploy window. The trap box for bots is `nbccCheck` now (`company` was
being filled in by browsers' autofill; the old name still counts), and a hit is only counted in the log.

**After review.** A page kept off Get involved is `noindex` (header and meta). A funeral's day and
place never reach the public (`publicCard` blanks them in memory). A child on a team is shown by
first name only, on their page and in the team's list. A sporting answer has to agree with the
category. Sport and the T-shirt are refused for an event, a page in memory, and a team member's page.

### The rules the server keeps (`src/fundraising/signup-tidy.ts`, wired into `signUpSchema`)

| Field | Rule |
| --- | --- |
| `postLine1`, `postTown`, `postPostcode` | needed on every new sign up (a 400 names each), with a UK postcode; in memory only when something is to be posted |
| `isSporting`, `tshirtSize` | raising money only, never in memory; a size from the list is needed with a Yes; a page cached from before (no answer) is taken without |
| `splitConfirmed` | must be `true` when `sharesWithOther` is |
| `childFundraiser`, `childFirstName`, `childConsent` | for `child`: the first name and the tick |
| `forOrganisation`, `orgName`, `employerMatch` | for a Yes: the name; `yes`, `no` or `not_sure` |
| `listed` | `false` keeps the page off Get involved; a team is always listed |
| `eventDate`, `dateTbc` | an event needs a date, or `dateTbc: true`; the tick is kept only while there is no date |
| join: `memberUnder18`, `guardianFirstName`, `guardianConsent` | for `true`: the first name and the tick; a page cached from before sends none, and is taken as an adult |
| `kind` | in memory: one of the in memory ways of giving, or Other; anyone else: never one of those |
| `description` | optional in memory |
| `wants.shoutOut`, `wants.attend` | not needed in memory (both false); come along only for an event, or with a date or venue |
| `wants.envelopeCount` | in memory only; a request kind of its own (`envelopes`), ticked off like posters |
| `memoryDirectorBusiness`, `memoryFamilyContactName`, `memoryFamilyContactEmail`, `callTime` | a funeral director gives the business; the rest are optional |

### After the sign up

| Route | Who | What |
| --- | --- | --- |
| `PATCH /api/admin/fundraising/categories/:key` `{ sporty }` | an admin | the Sporting tick; audit `fundraising.category_changed` |
| `PUT /api/admin/fundraisers/:id/welcome-pack` `{ isSporting, tshirtSize }` | fundraising edit | correct sport and the size before approving; a Yes may wait for a size; audit `fundraiser.welcome_pack_changed` |
| `POST /api/admin/fundraisers/:id/tshirt-ask` | fundraising edit | email the organiser a private link to choose a size (never automatic); audit `fundraiser.tshirt_asked`; 409 unless it is a sporting event with no size |
| `GET /fundraise/t-shirt` | the organiser | the page to choose a size (`fundraise-tshirt.html`, `assets/js/fundraise-tshirt.js`); never indexed |
| `POST /api/fundraise/tshirt/look` `{ token }` | the organiser | their first name, the fundraiser's name and the sizes; one plain 404 for a link not there, used or over 60 days old |
| `POST /api/fundraise/tshirt` `{ token, tshirtSize }` | the organiser | saves the size, once; audit `fundraiser.tshirt_chosen` |

The link is `/fundraise/t-shirt#<token>`: the token rides after the `#`, so it never reaches a server
in an address, and only its sha256 is stored. Admin > Fundraising shows the new answers in **What
they told us**, and a **Sport and the T-shirt** panel: "Waiting for T-shirt size" and the button "Ask
them for their T-shirt size". The summary to the events inbox carries the new answers; for a page in
memory of someone it is headed "A new page in memory of ...", with a plain sign off.

The team join form (`fundraise-join.html`) has the same Next and Back, with three stages (About you,
Your page, Send). `fundraise-join.html` and `fundraise-tshirt.html` are now copied into the image
(the join page was missing from the Dockerfile's list).

### Data (`migrations/1791200000210_signup-tidy.js`, additive only)

| Table | Change |
| --- | --- |
| `fundraising_categories` | `sporty`, `memory_only` (both false by default); Run, Walk and Santa dash marked sporting; three in memory ways of giving added |
| `fundraisers` | `is_sporting`, `tshirt_size` (checked against the list), `tshirt_token_hash`, `tshirt_asked_at`, `tshirt_asked_by`, `child_first_name`, `child_consent`, `org_name`, `employer_match`, `memory_director_business`, `memory_family_contact_name`, `memory_family_contact_email`, `call_time`, `date_tbc`, `guardian_first_name`, all nullable |
| checks | `fundraisers_memory_setup_by_known` takes `someone_else`; `fundraisers_booking_check` takes `donations`; the request kind check takes `envelopes` |

No new table. **Rolling back past the sign up tidy.** Code from before this release does not know
`memory_only`, and would offer the in memory ways of giving on the ordinary form. Before rolling the
code back, run:

```sql
UPDATE fundraising_categories SET active = false, retired_at = COALESCE(retired_at, now()) WHERE memory_only;
```

Tests: `test/unit/fundraising-signup-tidy*.test.ts`, `fundraising-signup-paths.test.ts`,
`fundraising-categories-sporty.test.ts`, `signup-tidy-migration.test.ts`,
`fundraise-signup-tidy-form.test.ts`, `fundraise-tshirt-page.test.ts`,
`admin-fundraising-signup-tidy.test.ts`, `fundraise-join-page.test.ts`; BDD
`features/fundraising-signup-tidy.feature`.

## Welcome packs: what goes in the post to each approved page

Jaimie, 2026-10-03. Every approved fundraiser and event host gets a welcome pack in the post. What is
in it is worked out from their sign up each time, only what applies to that page
(`src/fundraising/welcome-pack.ts`, pure):

| In the pack | Who gets it |
| --- | --- |
| The printed **welcome letter** | Everyone with a pack |
| What they **asked for** on the form, in the numbers they asked for: A4 and A3 posters, A5 leaflets, printed QR codes, collection buckets and tins | Whoever asked. The form asks only how many posters, so they are A4 unless the organiser's last "Ask us to print these" gave sizes that add up to the same number |
| The paper **sponsor form** | A sponsorship fundraiser: someone raising money for a sporting event, or a team organiser's page. Never a bake sale or a coffee morning, an event, or in memory. (Nothing else on the sign up says a page is sponsored: a category is only a name staff can change, with a Sporting tick.) |
| The **NBCC T-shirt**, in the size they chose | A sporting event. With no size yet it shows "Waiting for T-shirt size", cannot be ticked, and has the "Ask them for their T-shirt size" button |

**In memory of someone** there is no welcome pack and no T-shirt. The same panel is **Things to
send**: exactly what they asked for (collection envelopes, QR cards for the order of service, a few
posters) with a gentle covering note, and no panel at all when they asked for nothing. **A team
member's page** has none: it gave no address.

### Admin > Fundraising

Each approved sign up has a **Welcome pack** panel: a tick box for each thing (who ticked it, and
when), **Leave out** with a reason, the address ready to copy (their name, each line, the town and
the postcode; in memory, "This can be the funeral director's address"), who signs the letter,
**Print welcome pack** and **Print letter only**, then **Pack sent** (the date and who) and
**Undo**. Pack sent only works once every thing is ticked or left out with a reason. It is **To
pack**, **Part packed**, **Ready to send** or **Sent**. A tick is kept with what the thing was
called when it was made ("10 A4 posters", "NBCC T-shirt, Adult M"): if the sign up has changed since
(another number, another size, another split between A4 and A3) the tick no longer counts and the
row says what it was ticked for, so it can be ticked again. Once a pack is **Sent** it stays Sent: a
later change shows a small **Changed since it was sent** flag instead, with what changed (what went
and is no longer asked for is named). The same goes for a thing **left out**: a T-shirt left out
while it waited for a size is asked for again once the size comes in ("Their size has come in: Adult
M. Tick it when the T-shirt goes in."), and on a pack already sent it is flagged. A tick and a leave
out say what the list showed when they were pressed: if the sign up has changed since the page was
opened the press is refused (409) and the panel shows how it stands, so a tick always records what
staff saw. A press that leaves the pack as it stands (ticking what is ticked) writes nothing and
records nothing. The list has a **Pack to send** pill (in memory, **Things to send**) and a **Packs to send
(N)** filter: every approved page with a pack not yet sent. Editors and admins tick; viewers read
and print. Every change is in `audit_log` (`fundraiser.pack_updated`) and so in the History.

**Ticking also looks after Requests, without overwriting what staff did there by hand.** What they
asked for is tracked in Requests too. A tick, an untick or a leave out looks only at the request of
the thing pressed: once every thing of that kind that is going has its tick, the request is marked
as it would be by hand (posters, leaflets, QR codes and envelopes **Sent** by post; buckets and tins
**With them**), with how many went and the note "Sent with the welcome pack." Taking the tick off
opens again a request **the pack marked**; re-ticking a thing (they asked for a different number)
puts right how many went on one the pack marked. **Pack sent** only catches up requests still To
send that the pack never marked: never a count, never an undo, and never one the pack marked once
that staff then undid by hand; and ticking its thing again never sends such a request again either,
so a deliberate hand undo is never re-sent by any press (one the pack itself opened again, because a
tick came off, is sent again when the tick goes back). Leaving out one of two things of a kind after both went (the A3
posters, say) puts how many went right too. And a request staff changed by hand **after** the pack
marked it is theirs from then on: the request says who changed it last (the pack writes `pack:`
before the staff member in `fundraiser_requests.updated_by`; a change by hand writes the staff
member alone), and the pack only puts a count right, or opens a request again, while it was the last
to change it. So a request staff undid and then sent again by hand, with their own count, is never
changed by a tick or an untick. The two things the pack keeps (its mark on its rows, and who the
request says changed it last) are read together in one place, `requestOwner` in
`src/fundraising/welcome-pack.ts`. Requests the pack changed before the `pack:` mark existed are
marked once by `migrations/1791200000240_team-invite-under-18.js`: a pack's press writes its own
History line and changes the request in one transaction, so a request whose `updated_at` equals the
time of a `fundraiser.pack_updated` line for its fundraiser was last changed by the pack. Its down
takes every `pack:` mark off again. So a count staff corrected in Requests, or a request they undid
there, is never put back by a press on something else. Whether the pack marked a request is kept on
the pack's own rows (`welcome_pack_items.marked_request`), never read from the request's note. It
uses the Requests' own rules and audit line (`changeRequestIn`, `src/db/fundraising-requests.ts`).

**Signed by** is the admin's one list of who can sign for NBCC (`AdminHelpers.SIGNERS`, as the thank
you letters use). The server reads the same file (`src/fundraising/signers.ts`), takes only a name
on it, and prints the title the list gives them. It is chosen per pack, and each staff member's last
choice (`welcome_packs.signer_by`, `signer_at`) is offered first on their next one; with none, the
first on the list signs, on screen and in a viewer's print alike.

### The print view

`GET /api/admin/fundraisers/:id/pack/print` is one self contained page
(`src/fundraising/welcome-pack-print.ts`), opened in its own tab and printed or saved as a PDF from
the browser, like every material. In order: the welcome letter (A4), their posters in the sizes and
numbers they asked for (the same renderers as the materials; each size on its own paper, so A3 pages
come out as A3), then the sponsor form for someone raising money. `?part=letter` is the letter on its
own. Anything staff left out is left out of the print and of the letter's list; what is in the pack
but cannot be printed (buckets, the T-shirt) is listed on screen only. A poster asked for up to 10
times is drawn once and copied when the print window opens (and the copies put away when it closes).
More than 10 of a kind are never copied in the browser: one is drawn, labelled "print 40 copies of
this page (set Copies in the print window)", and a note says to print the rest from its own page,
with the Materials buttons under Where it is up to. The organisers' "Ask us" note is left off this
staff page. A long address is set smaller (two steps) to stay in the envelope's window and is never
clipped; if it cannot fit, staff see a warning on screen (not printed) to check the envelope or
write it by hand.

The **welcome letter** is in the thank you letter's house style: the maroon frame, our address
(The Elves' Workshop) and the logo, a script signature, the maroon foot with the phone number,
events@nbcc.scot and the charity statement word for word. Their name and address sit where the
window of a C5 or DL envelope shows them with the letter folded in three (22mm in and 48mm down, in
a space 84mm by 34mm). It has their first name, the fundraiser's title, their page's address and QR
code, what is in the pack, how to pay money in (the private area), the help page, and how to reach
us. An event host's says "your event's page" and never mentions a sponsor form. **The wording is a
draft for Jaimie to approve** (`welcomeLetter` and `coveringNote` in `welcome-pack.ts`). In memory,
the covering note is quiet: cream and tan, no QR code, no exclamation marks.

### Elsewhere

- **The Monday summary** (`src/fundraising/summary.ts`): "N welcome packs to send" (pages approved
  more than 2 days ago whose welcome pack is not sent, or sent with a T-shirt left out whose size
  has since come in), "N welcome packs waiting for a T-shirt size" (never a sign up still new, and
  never a pack whose waiting T-shirt staff left out with a reason: that one is a pack to send) and
  "N in memory pages with things to send", all in Waiting on us. Each page is in one line only: a
  pack waiting for a size is not also a pack to send. If the packs cannot be read the summary still
  goes, without them.
- **The organiser's private area**: one small line once theirs has been sent, "Your welcome pack is
  on its way. We posted it on 4 October 2026." (in memory: "The things you asked for are on their
  way."), and nothing before. Never who sent it.

### Routes (`src/routes/admin-welcome-packs.ts`, section Fundraising)

| Route | Needs | What it does |
| --- | --- | --- |
| `GET /api/admin/fundraising/packs` | view | `{ packs: { <id>: view }, toSend: { <id>: true }, mySigner }`: every page's pack, which are still to send, and who this staff member last chose to sign |
| `POST /api/admin/fundraisers/:id/pack` | edit | `{ action: "tick", key, words, quantity }` and `{ action: "skip", key, words, quantity, reason }` (`words` and `quantity` are what the list showed), `{ action: "untick", key }`, `{ action: "send" }`, `{ action: "undo" }` or `{ action: "signer", name, role }`. Answers `{ pack, words, requests }` (`requests`: what it marked in Requests, in their words; `words` is empty when nothing changed); 400 with `fields` (a signer not on the Signed by list is one), 404 when there is no pack, 409 with the reason when it cannot be done as it stands |
| `GET /api/admin/fundraisers/:id/pack/print` | view | The print view, a whole HTML page; `?part=letter` for the letter only. Never kept, never indexed |

(`PUT /api/admin/fundraisers/:id/welcome-pack`, from the sign up tidy, is a different thing: it sets
"Sporting event?" and the T-shirt size.)

### Data (`migrations/1791200000230_welcome-packs.js`, additive only)

Two new tables, cleared with their fundraiser. `welcome_packs`: one row per fundraiser, made the
first time staff touch its pack (`sent_at`, `sent_by`, `signer`, `signer_role`, `signer_by`,
`signer_at`).
`welcome_pack_items`: one row per thing staff have ticked or left out (`key`, the `label` (the
list's words for it) and `quantity` as they were then, `ticked_at`, `ticked_by`, `skipped_reason`, and `marked_request`: the
pack marked this thing's request in Requests; ticked or left out, never both). A thing nobody has touched needs no row, and what a pack holds is never stored.
Numbered 230, above everything on its way to main before it. In the nightly backup's table count
(88).

### Where it lives, and tests

`src/fundraising/welcome-pack.ts` (the rules and the words), `welcome-pack-print.ts` (the print
view), `src/db/welcome-packs.ts`, `src/routes/admin-welcome-packs.ts`, and one marked block in
`assets/js/admin/app.js` ("Welcome packs") with its styles in `assets/css/admin.css`. Unit tests:
`fundraising-welcome-pack`, `fundraising-welcome-pack-print`, `welcome-packs-db`,
`welcome-packs-migration`, `admin-welcome-packs-routes`, `admin-fundraising-pack-panel`,
`fundraising-summary-packs`, `fundraise-manage-pack`. BDD: `features/fundraising-welcome-pack.feature`.

## Community fundraising, profile pictures

Decided by Jaimie (2026-10-03). A page keeps its **main photo**, and gains a small **round photo of
its organiser** beside their name ("Organised by Robin O."), like JustGiving. Both are sent by the
organiser from their private area and **both are checked by staff before they show** (the standing
rule: staff approve all public content, pictures included).

- **Your photos** (`/fundraise/manage`, `assets/js/fundraise-pictures.js`, for an approved
  fundraiser with its own page): a live preview of the top of their page (their title, "Organised
  by" with the round photo, and the main photo), which changes the moment they choose a photo. The
  round photo is shown in a circle they can drag it around in (or move with the arrow keys); the
  browser cuts the square from where they put it and makes the main photo smaller (1600 pixels at
  most), then sends it. Each kind says where it is up to: "Waiting for us to check" (their page keeps
  showing the last approved photo until then), "On your page", or "Not used" with our note. Sending a
  new one replaces the one still waiting. Ten a day at most.
- **On the server** (`src/fundraising/picture-process.ts`, with `sharp`, now a runtime dependency,
  loaded the first time a picture is made so a native problem can never stop the site): the private
  area always sends a JPEG, so only a JPEG is taken (checked by the bytes; HEIC is not supported:
  phones hand over a JPEG when a photo is picked), 2 MB at most like every other upload, at most 3
  million pixels, and refused if damaged or cut short (sharp's `failOn: "warning"`, and its format
  checked before anything else). Each is turned the right way up, made smaller (a round photo 400
  pixels square, a main photo within 1600 pixels) and saved as a fresh JPEG: **nothing from the
  camera is kept** (no location, no phone, no time). One over 2 MB is saved again at a lower quality,
  and refused ("too big") if even that is over.
- **The one 512 MB task is protected before a picture is opened**: every try is counted, failed ones
  too (20 a session and 60 an address in any 24 hours), then the database says whether ten were sent
  today; one picture is made at a time with three waiting, and past that the answer is 503 "Lots of
  photos arriving just now. Please try again in a minute." The runtime image sets
  `MALLOC_ARENA_MAX=2`, and pr.yml's image check proves sharp loads inside the image.
- **Never public until approved.** A waiting photo has no public address: the organiser sees theirs
  through their session, staff through theirs. An approved round photo is served at
  `/media/fundraiser-profile/<uuid>` only while it is approved, on a page that is up, while
  fundraising is on (otherwise 404), with nosniff and a five minute cache, so taking one off works
  within minutes. An approved **main photo** is copied into `event_images` and becomes the page's
  `image_src`, exactly as if staff had uploaded it, so staff can still change it under "Photo for its
  page". The copy is remembered (`event_image_id`): taking it off or replacing it deletes the copy,
  and `/media/events/<id>` serves an organiser's copy only while it is still that page's photo (a
  five minute cache, not for ever), so a photo taken off, replaced or swapped answers 404. Every
  picture staff uploaded (events, logos, "Photo for its page") has no organiser's picture behind it
  and is served exactly as before: 200, kept for good (`immutable`).
- **Only what is needed is kept.** A picture's bytes go when it is not used, replaced or taken off
  (its record stays, for the audit). The daily 8am task lets go of any such bytes still left after
  30 days, and of a main photo staff swapped for another. A photo still **waiting** is never touched,
  however long it waits: the Monday summary's "Waiting on us" says "N photos waiting to be checked"
  (and counts them), so staff are nudged instead. An admin can **Delete for good** (the record, the bytes and any copy on the page; the
  History keeps a note).
- **Who is in the photo.** The private area says: "Only send photos of people who are happy to be on
  the page. For anyone under 18, you need their parent or guardian's OK." Staff have a checklist line
  above the photos.
- **Admin > Fundraising**: "Photos to check" on a sign up with any waiting, and "Photos from the
  organiser" in the open sign up: each photo as the page will show it (a round one beside "Organised
  by", a main one big), Approve photo, Don't use it (with an optional note the organiser sees in their
  private area), Take it off the page for one in use (round or main), and, for admins, Delete for
  good. Every decision is in the fundraiser's History (`fundraiser.picture_sent`, `_approved`,
  `_declined`, `_removed`, `_deleted`). Nothing is emailed.
- **The pages**: the round photo replaces the person icon beside "Organised by" (or "Team organiser")
  on a fundraiser's, event's or team's page, described as "A photo of Robin O." (escaped). Without an
  approved one the page is exactly as before. On a **team page** each member, and the team organiser,
  show their round photo, or the NBCC elf (`/assets/img/nbcc-elf-96.png`, a small copy made for the frame) in the same round frame.
- **In memory pages** show the photo of the person remembered, never a round photo of the organiser:
  `profilePhotoAllowed` is false for them, so the private area offers only the main photo ("A photo
  of them": "A photo of the person you are remembering. It shows at the top of the page."), the page
  route asks for no round photo, the public address and the team list skip them, and staff cannot
  approve one.

### Routes

| Route | Who | Body | Answer |
|---|---|---|---|
| `GET /api/fundraise/manage/pictures` | the signed in organiser | | `{ fundraisers: [{ id, canSend, profileAllowed, name, title, path, isTeam, inTeam, pageImageSrc, main: { inUse, latest }, profile: { inUse, latest } }] }`; each picture `{ id, kind, status, statusWords, createdAt, photoUrl, note }` (the note only on one not used); never who decided |
| `POST /api/fundraise/manage/fundraisers/:id/pictures` | the signed in organiser, from our own page | `{ kind: "main" \| "profile", mime, dataBase64 }` | `202 { status: "waiting", picture }`; `400 { fields: { photo } }`; `413` over 2 MB; `410` not running with a page; `429` after ten a day; the body is only read with a session cookie the shape of ours |
| `GET /api/fundraise/manage/pictures/:pictureId/photo` | the signed in organiser | | their own picture, whatever its status, `private, no-store` |
| `GET /media/fundraiser-profile/:photoId` | anyone | | an approved round photo on a page that is up, while fundraising is on; otherwise `404` |
| `GET /api/admin/fundraising/pictures-waiting` | fundraising view | | `{ counts: { <fundraiser id>: <waiting> } }` |
| `GET /api/admin/fundraisers/:id/pictures` | fundraising view | | `{ pictures, title, organisedBy }`, with the note, size and who decided |
| `GET /api/admin/fundraisers/:id/pictures/:pictureId/photo` | fundraising view | | the picture, waiting ones included, `private, no-store` |
| `POST /api/admin/fundraisers/:id/pictures/:pictureId/approve` \| `decline` \| `remove` | fundraising edit | `{ reason? }` (decline, 500 characters at most) | `{ picture }`; `409` when it was dealt with already, or for a round photo on a page in memory of someone |
| `POST /api/admin/fundraisers/:id/pictures/:pictureId/delete` | admin, fundraising edit | | `{ deleted: true }`; deletes the record, its bytes and any copy on the page; audited |

### Data (`migrations/1791200000205_profile-pictures.js`, additive only)

`fundraiser_pictures`: fundraiser (cleared with it), `kind` (`main` or `profile`), `status`
(`pending`, `approved`, `declined`, `replaced`, `removed`), `photo_id` (its own uuid address), `mime`,
`bytes` (only while it waits or is in use), `byte_size`, `width`, `height`, `event_image_id` (an
approved main photo's copy), when it was sent, decided, by whom, and the decline note. At most one
waiting and one in use of each kind per fundraiser (unique partial indexes). Numbered 205,
after the 200 the impact markers change adds. In the nightly backup's table count (78).

### Where it lives, and tests

Rules (pure): `src/fundraising/pictures.ts`. Processing: `src/fundraising/picture-process.ts`. SQL:
`src/db/fundraiser-pictures.ts`. Routes: `src/routes/fundraiser-pictures.ts` (mounted before
`fundraiseRouter`, whose retired link route would take `/manage/pictures`). Pages:
`src/fundraising/render.ts` (`organiserPhotoSrc`), `src/fundraising/team-render.ts`,
`src/routes/fundraise-pages.ts`, `src/routes/team-pages.ts`. Private area: `fundraise-manage.html`
(`data-pictures-pattern`) and `assets/js/fundraise-pictures.js`. Screen: the `frPics` block of
`assets/js/admin/app.js`. Unit tests: `fundraising-pictures`, `fundraising-picture-process` (real
pictures, made with sharp), `fundraiser-pictures-db`, `fundraiser-pictures-routes`,
`fundraising-profile-render`, `fundraiser-page-profile-route`, `fundraise-pictures-page` (jsdom),
`admin-fundraising-pictures-panel` (jsdom), `event-images-route`, `picture-retention-job`,
`fundraising-summary-pictures`,
`sharp-in-image`, `profile-pictures-migration` and `backup-plan`. BDD:
`features/fundraising-pictures.feature` (a round photo is not public until staff approve it, then
shows; an approved main photo becomes the page's photo; one not used never shows and the organiser
sees our note; a team page shows each approved round photo and the elf until then; a round or main
photo taken off, and a main photo replaced, answers 404).

## Event tickets: NBCC sells an event's tickets

Jaimie, points 23 and 24. An organiser holding an event can ask NBCC to sell the tickets, when ALL
the ticket money comes to NBCC. A separate module: the rules in `src/tickets/model.ts` (pure, unit
tested), the SQL in `src/db/event-tickets.ts`, the routes in `src/routes/event-tickets.ts` and
`src/routes/admin-event-tickets.ts`, the emails in `src/tickets/emails.ts` and `send.ts`, and its
own scripts and styles (`assets/js/event-tickets*.js`, `assets/js/admin/event-tickets.js`,
`assets/css/event-tickets.css`, `assets/css/admin-event-tickets.css`). The Festive Ball's own
ticketing (`src/ball/`) is untouched; this borrows its patterns (the card fee gross up in
`src/ball/pricing.ts`, the CSV quoting in `src/ball/exports.ts`).

**The rules**

- "How do people get in?" (in the sign up form's event step; the form is one step at a time since
  the sign up tidy) has a fifth answer, after "Free entry, donations welcome": **NBCC sells the
  tickets for me** (`booking = 'nbcc'`). Next asks warmly for what is missing ("Almost! Just add at
  least one kind of ticket, like Adult at £10."), and Check your answers shows the tickets, the
  limit and when sales close. The migration re-creates `fundraisers_booking_check` with all five
  values (away, door, free, donations, nbcc).
  The form says: "Choose this only if all the ticket money is going to NBCC. If you're sharing
  ticket money with another cause or keeping some for costs, sell them your own way and pay NBCC its
  share afterwards." and "If you have costs, like the hall, talk to us: we can repay agreed costs
  against receipts." (staff repay agreed costs outside the system). **Never when sharing with
  another cause, on every path**: the sign up and an organiser's change refuse it; a staff change of
  how people get in refuses it for a sharing event ("This event shares what it raises with another
  cause, so NBCC can't sell its tickets."); a staff change of the split refuses sharing once NBCC
  sells the event's tickets or any ticket order exists ("NBCC sells this event's tickets, so it can't
  share with another cause."); and `salesState` (the one place the page, the checkout and the lock
  all ask) is off for a sharing event whatever else is true.
- **Ticket types**: a name (up to 60 characters), a price in whole pence (**£0 for a free ticket**
  that still needs booking, so the host knows the numbers, or from £1 to £500), and an optional
  number on sale; up to 10 for an event. An event may also have an overall **sales limit**. The
  organiser proposes them with the sign up or in their private area; **staff approve each one**
  before it goes on sale (staff approve all public content).
- **Free bookings**: an order where every ticket is £0 never goes to Stripe. It costs nothing to
  make, so it is held tighter: at most **10 free tickets in one order** ("You can book up to 10 free
  tickets at a time. Need more? Email events@nbcc.scot."), at most **2 standing free bookings** for
  an event per email and **6 per address** (a household or a school shares one; past that: "We've
  had several free bookings from this connection. If that isn't you, email events@nbcc.scot and
  we'll book you in."), with one still on its way counted too, and the spam check **fails closed** (if Turnstile cannot be
  reached, or is not set up in production, the booking is refused: "We can't take bookings just
  now. Please try again in a few minutes."). It is reserved under the same lock and limits as any
  order, then booked at once, with the same reference
  and tickets email ("Nothing to pay") and the same thank you. There is nothing to refund: the
  organiser (in their private area) or staff (in the admin) **cancel** it, which puts the places back
  on sale and emails the buyer "Your booking is cancelled" (`eventTicketsCancelled`). An order with a
  free ticket and a paid one goes through Stripe for the paid part: the free tickets stay on our
  order and are never a line at Stripe (its page says "Plus 2 free Child tickets"), so what Stripe
  charges is still exactly the order's total.
- **Sold out**, per type and for the whole event, when the number on sale or the limit is reached.
- Tickets are sold only for an **approved, public** event (listed or taken off the list) while
  **fundraising is on**, never for a page in memory of someone, and a finished event sells none.
- **When sales close is the host's choice** ("When should ticket sales close?", on the sign up and
  in the private area): when the event starts, the day before (midnight, London time), or a date and
  time they choose, which must be before the event starts and must not have passed already. Staff approve it with the tickets and can
  set it in the admin (for an NBCC run event staff set it there). Never asked (older data) is when
  the event starts; an event with no start time closes at the start of its day; and nothing sells
  after the start whatever was chosen. Staff can also close sales at once ("Close sales now").
- Ticket money is **never a gift**: never Gift Aid, never in `donations`, and shown apart from gifts
  everywhere ("£40 from tickets, £25 in gifts"). On the event's page the meter counts both together
  and the line under it says each; Gift Aid stays on the gifts only.
- An organiser can only **ask** for a refund; an **admin** makes it.

**Buying.** The event's page has a **Get tickets** section of its own (`#tickets`), above and apart
from the give form: how many of each type, the buyer's first name, surname, email and optional
phone, and "Add a little to cover the card fee" (the Ball's gross up, on the tickets). It says
"Tickets are not donations, so Gift Aid does not apply." `POST /api/event-tickets/:id/checkout`
reserves the places and opens a Stripe Checkout (card, so Apple Pay and Google Pay too; it closes
after 31 minutes), one line per type at the stored price and the fee cover on its own line. The
session carries `product=event_tickets` and the order's reference (`TIX-` and six characters) in
its metadata. After paying, the buyer is back on the event's page
(`?tickets=thanks&ticket_session=...`, never kept or indexed) with a thank you; the payment's id is
taken out of the address bar.

**Oversell protection.** A checkout locks its event's row in `event_ticket_settings`, so buyers of
one event queue; what is left counts every paid ticket and every checkout still inside its hold.
The order is written `pending` and holds its places for 5 minutes; once Stripe's checkout is
attached to it, for an hour. Stripe's `checkout.session.expired` gives the places back at once
(`expired`); the hour is the backstop if that event were lost, and nothing has to run for it to
work. If Stripe cannot start the checkout the order is cancelled straight away. The price the
buyer's page showed is sent with the order, and a price changed since is refused ("The price of this
ticket has changed. Please refresh the page."). A booking reference already taken is made again.

**Holding the room by asking is stopped four ways**: the spam check (Cloudflare Turnstile, when it is
switched on, as on the sign up form; a refused pass reserves nothing, a check that cannot answer
lets the buyer through), a hidden box only a bot fills, the rate limit (10 checkouts in 10 minutes
from one address), and a cap of two open checkouts for one event per email and per address (a hash
of the address is kept on the order, never the address). An honest buyer is never caught by their
own checkout: when the same email from the same address starts again, their older open checkouts for
that event are closed at Stripe and cancelled first, so the cap only bites on checkouts opened side
by side from different addresses or emails. A hold that ran out while Stripe was opening the checkout
is never brought back: that checkout is closed and the buyer starts again.

**A payment that should not have fitted is still recorded, flagged, and staff are told.** If a
payment lands after its hold ran out and the event is now over its limit, or the amount, the
checkout or the currency is not what the order was made for, the order keeps a flag ("Paid late:
this event is now 2 over its limit", "Amount paid doesn't match: check this booking"), shown on the
booking in the admin, and the events inbox is emailed (`eventTicketsToCheck`).

**The webhook** (`src/tickets/webhook.ts`, called first by `src/db/stripe-webhook.ts`, on its
transaction): `checkout.session.completed` marks the order paid and, once committed, emails the
buyer their tickets (kind `eventTickets`, From and Reply-To events@): the reference, the tickets,
what was paid, when and where, and "Show this email at the door". A ticket checkout never reaches
the donations handler. `checkout.session.expired` releases the places. Every refund event
(`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`) only says which payment
changed: Stripe is then asked what it has refunded on it and the order is made to agree (see
Refunds below). A dispute is noted in the audit log; once the bank takes the money back
(`charge.dispute.funds_withdrawn`) the order is flagged, its money stops counting as ticket money,
and the events inbox is emailed; a dispute won counts again.

**A tickets email that did not go** (the email provider was down when the payment landed) leaves the
order unstamped: the admin shows "Tickets email not sent" with "Send tickets email again" (editors
and admins, audited), and the daily task (`src/tickets/runner.ts`, on `send-reminders`) sends every
one still unsent (free bookings too), newest first, each claimed so two runs never send it
together. After three tries it is left alone and flagged in the admin: "Tickets email keeps failing:
check the address". **A refund email that did not go** marks its order with what it was to say
(`refund_email_unsent_pence`), and the same daily task sends it, three tries at most.

**Refunds.** In the private area the organiser picks a booking and gives a reason
(`event_ticket_refund_requests`, one open request a booking); the events inbox is emailed
(`eventTicketsRefundAsked`, Reply-To the organiser). In Admin > Fundraising > Event tickets an admin
chooses the tickets to refund: the amount is their price as sold, or all that is left of the payment
(card fee cover included) when no ticket is left standing.

**Stripe is the source of truth for refunded money.** One function, `reconcileRefunds`
(`src/db/event-tickets.ts`), is the only place refunded money is decided. Under the order's lock it
asks Stripe for every refund on the payment (`refunds.list`) and makes the order agree:

- `refunded_pence` is the sum of Stripe's **succeeded** refunds, never more than was paid;
- a refund of ours still waiting whose Stripe refund has succeeded is **finished**: its tickets
  back on sale, its request closed, the audit row (`tickets.refunded`), and the buyer emailed
  (`eventTicketsRefund`). It is matched **by the refund's metadata** (`refundIntent`, the intent's
  id) or Stripe's refund id, never by its amount;
- one whose Stripe refund failed or was cancelled, or that Stripe never made and whose key is too
  old to use again (23 hours), is closed as failed;
- a succeeded refund that is not one of ours was **made in Stripe itself**: its money is recorded,
  and no ticket is released, as nobody said which (see below), unless the booking is now refunded
  in full, when every place goes back on sale. The buyer is emailed.

It is run by every refund event on the webhook (the event's own amounts and status are never
used), and by the admin's refund before and after Stripe is asked. Running it twice changes nothing
and sends no second email, so events that come late, twice or out of order do no harm. If Stripe
cannot be reached inside the webhook, the webhook answers 500 and Stripe sends the event again.

An admin's refund, so one that times out or half fails is never paid twice and never leaves the
wrong tickets standing:

1. The booking is reconciled with Stripe. If Stripe cannot be asked, nothing new is started (502).
2. Under the order's lock, the booking must be exactly as the admin's screen showed it (they send how
   many of each line and how much money were already refunded: any difference is a 409, "This
   booking has changed. Refresh and check before refunding."), and a request given must still be
   open. The refund is then written down `pending` (an intent: the tickets, the amount, its own
   idempotency key) and committed, before Stripe is asked.
3. Stripe's refund API is asked with that key. The same refund asked again reuses it.
4. The booking is reconciled again, which finishes the refund Stripe has just made.

If step 4 never happens, the next refund event from Stripe, or the admin making the same refund
again, finishes it. A definite no from Stripe closes the intent as failed and changes nothing. One
still on its way releases nothing until Stripe confirms it. A different refund while one is
unconfirmed is refused until that one is finished. A request can also be declined (admins).

**A refund that fails at the bank** after it was applied here (ours, or one made in Stripe): the
reconcile puts the money back to what Stripe says and closes the refund as failed. The tickets are
**not** taken back (their places may have been sold again). The booking is flagged "Refund failed
at the bank: the buyer has not been paid back. Their tickets were released: contact them and
refund them in Stripe." (with how far over its limit the event is, counting their tickets, if it
is), the events inbox is emailed, and the buyer gets no automatic email. Staff contact the buyer and
refund them in Stripe (the admin's refund screen has no tickets left to choose); that refund is
recorded by the same reconcile. **The flag never clears by itself**: an admin presses **Mark as
sorted** on the booking, after a second press, audited (`tickets.refund_failed_sorted`).

Stripe is asked for a payment's refunds with an eight second wait and no second try, as the order
is locked meanwhile. An admin's refund first checks the booking is this event's (404 if not). If an
old refund of ours is still on its way at Stripe, a new one is refused: "Stripe is still working on
the last refund for this booking. Check again later today."

**Money refunded in Stripe itself** (not in the admin) is recorded by the reconcile as above. A
refund in full puts every place back on sale; a partial one releases nothing. An admin then uses
**Release these tickets (no money)** on the booking: it puts tickets back on sale and emails the
buyer that those tickets are cancelled, with no money moving. It is allowed only for free tickets
(on a mixed booking), and for paid tickets up to the money already refunded. Audited
(`tickets.released_no_money`).

**The guest list** for the door, to print, from the admin and the organiser's private area: a tick
box, the name, the tickets and the reference, by surname, with the totals. No email, phone or
money. Staff can also download every booking as a **CSV** with the money, and (for editors and
admins only) the buyer's email and phone: someone who may only look sees names and tickets, in the
admin and in the CSV.

**Admin > Fundraising > Event tickets** (its own card): every ticketed event with what is waiting;
opened, an event's types (approve, change, take off sale, add), the limit (and the organiser's
proposed one), close or open sales, the money apart from gifts, the guest list and CSV, the refunds
asked for, the bookings and the refunds made.

| Route | Who | What |
|---|---|---|
| `GET /api/event-tickets/:id` | anyone | `{ state, types: [{ id, name, pricePence, remaining, soldOut }], overallRemaining }`; 404 unless the event sells through NBCC |
| `POST /api/event-tickets/:id/checkout` `{ lines: [{ typeId, quantity, pricePence }], firstName, lastName, email, phone?, coverFee, captchaToken? }` | anyone, from our own page | `{ url }` (Stripe); 400 with `fields` (or `{ error: "captcha" }`); 409 `{ error, refresh: true }` when the places are not there or a price has changed; 429 for too many open checkouts; 502 if Stripe cannot start |
| `GET /api/fundraise/manage/fundraisers/:id/tickets` | the signed in organiser | types and where each is up to, the limit, the money, bookings (names and tickets only), refund requests; 404 for anything else |
| `POST /api/fundraise/manage/fundraisers/:id/tickets/propose` `{ ticketTypes?, ticketLimit?, ticketClose?, ticketCloseAt? }` | the signed in organiser | 202; staff are emailed (`eventTicketsToApprove`) |
| `POST /api/fundraise/manage/fundraisers/:id/tickets/bookings/:orderId/cancel` | the signed in organiser | cancels a free booking and emails the buyer; 409 for one that was paid for |
| `POST /api/fundraise/manage/fundraisers/:id/tickets/refund-request` `{ orderId, reason }` | the signed in organiser | 202; staff are emailed |
| `GET /api/fundraise/manage/fundraisers/:id/tickets/guest-list` | the signed in organiser | the guest list page |
| `GET /api/admin/event-tickets`, `GET /api/admin/event-tickets/:id` | fundraising view | the list, and one event |
| `POST /api/admin/event-tickets/:id/types`, `PATCH .../types/:typeId`, `POST .../types/:typeId/approve`, `POST .../types/:typeId/withdraw` | fundraising edit | add, change, approve, take off sale |
| `PUT /api/admin/event-tickets/:id/limit` `{ limit }`, `POST .../limit/approve`, `POST .../limit/decline`, `POST .../sales` `{ open }` | fundraising edit | the limit and the sales switch |
| `PUT /api/admin/event-tickets/:id/close` `{ ticketClose: start, day_before or custom, ticketCloseAt? }`, `POST .../close/approve`, `POST .../close/decline` | fundraising edit | when sales close: set it, or approve or decline the host's choice |
| `POST /api/admin/event-tickets/:id/orders/:orderId/cancel` | fundraising edit | cancels a free booking; 409 for one that was paid for |
| `GET /api/admin/event-tickets/:id/guest-list`, `GET .../orders.csv` | fundraising view | the guest list page, and the CSV |
| `POST /api/admin/event-tickets/:id/orders/:orderId/refund` `{ lines: [{ lineId, quantity, refundedQuantity }], refundedPence, requestId?, note? }` | an admin (fundraising edit) | refunds through Stripe; 409 with why not (`refresh: true` when the booking has changed); 502 if Stripe refuses or could not be reached |
| `POST /api/admin/event-tickets/:id/orders/:orderId/refund-failed-sorted` | an admin (fundraising edit) | takes the "refund failed at the bank" flag off the booking; 404 when there is none |
| `POST /api/admin/event-tickets/:id/orders/:orderId/release` `{ lines: [{ lineId, quantity, refundedQuantity }], refundedPence }` | an admin (fundraising edit) | releases tickets with no money moving and emails the buyer; 409 with why not |
| `POST /api/admin/event-tickets/:id/orders/:orderId/resend` | fundraising edit | sends the buyer's tickets email again; audit `tickets.email_resent` |
| `POST /api/admin/event-tickets/:id/requests/:requestId/decline` `{ note? }` | an admin (fundraising edit) | declines a refund request |

### Deploy note: the Stripe webhook's events

The one Stripe webhook endpoint (`POST /api/stripe/webhook`) must be subscribed, in the Stripe
dashboard, to every event the ticket code handles (`src/tickets/webhook.ts`), on top of the ones
donations and the Ball already use. A missing one fails quietly: Stripe simply never sends it.

| Event | What the tickets do with it |
|---|---|
| `checkout.session.completed` | the order is paid; the buyer's tickets are emailed |
| `checkout.session.expired` | an abandoned checkout gives its places back |
| `charge.refunded` | the order is reconciled with what Stripe has refunded on the payment |
| `refund.created` | the same |
| `refund.updated` | the same |
| `refund.failed` | the same: the money is put right, the booking flagged, and staff told (tickets are not taken back) |
| `charge.dispute.created` | noted in the audit log |
| `charge.dispute.funds_withdrawn` | the order is flagged, its money stops counting, staff are emailed |
| `charge.dispute.funds_reinstated` | a dispute won: the money counts again |
| `charge.dispute.closed` | noted; closed as won counts the money again |

(`checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed` are
donations' events: a ticket checkout takes cards only, and one arriving for a ticket checkout is
ignored rather than treated as a gift.) Turnstile must also be set up in production
(`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`) for free bookings to be taken at all.

### Data (`migrations/1791200000215_event-tickets.js`, additive only)

`fundraisers.booking` takes `'nbcc'` (the check is widened). Six new tables:
`event_ticket_settings` (one row per ticketed event: the limit, the proposed limit, sales closed by
staff, when sales close and the host's proposed closing time),
`event_ticket_types` (name, price, number on sale, proposed, approved or withdrawn),
`event_ticket_orders` (reference, status `pending`, `paid`, `expired` or `cancelled`, the buyer's
first name, surname, email and phone, tickets, fee cover, total and refunded pence, Stripe's
session and payment intent, the hold's expiry, flags for staff, when it was disputed, a hash of the
buyer's address, when its tickets email went), `event_ticket_order_lines` (type, name and price as
sold, quantity, refunded quantity), `event_ticket_refund_requests` (booking, reason, by whom, open,
refunded or declined; one open request a booking) and `event_ticket_refunds` (every refund:
`pending`, `done` or `failed`, its amount, tickets, idempotency key, Stripe's refund id, by whom).
A record of money never goes with its event: orders and refund requests stop an event being deleted,
and a ticket type that has been sold cannot be deleted (`ON DELETE RESTRICT`).

**Personal data.** A buyer's name, email and optional phone are on their order. The **phone number
is deleted 90 days after the event** by the daily task (the buy form says so); the name and email are
part of the record of a payment, kept as long as donation records are (nothing deletes them
automatically yet) and backed up nightly with the rest of the main database. The organiser never
sees a buyer's email or phone, and in the admin only editors and admins do. The printed guest list
says to shred or bin it after the event.

Tests: `test/unit/event-tickets-*.test.ts`, `admin-event-tickets-*.test.ts`,
`stripe-webhook-tickets.test.ts`; BDD `features/event-tickets.feature`.
## All emails, in Admin > Fundraising

One folded card, **All emails**, where every email the website sends about community fundraising,
sponsor pledges, event tickets and the Festive Ball can be read exactly as it would arrive, and
where the few emails whose wording is approval gated are approved. Nothing is edited here. It took
over the reading and approving that used to be spread across three cards (the "Read them" tabs in
Automatic emails, "The two emails to sponsors" in Sponsor pledges, and Approve / Withdraw in Invite
someone).

### One catalogue (`src/email/catalogue.ts`)

The single source of truth. `CATALOGUE` lists every email (69 when it was written) in the order it is shown: by
group, then the order they would be sent. Each entry has a stable `id`, its `group`, `name`, `who`
(one sentence: who gets it and when), `audience` (`public` or `staff`), `logKinds` (the names it is
written to the email log under), an optional quiet `note` (its words are typed elsewhere, or depend
on what people typed), an optional `touchKind` (one of the automatic emails to an organiser), and its
`versions`. A version has an `id`, a `label` for the Version drop-down, a `render(base)` that returns
`{ subject, html }` by calling the **real builder** with invented sample data (never a copy of the
wording), and, only where that wording is gated today, `approval: { key, path }`.

- **Sample data is invented**: Sam Example and "Sam's Santa Dash", "The Example Runners", "The
  Example Christmas Fair", `example.com` addresses. The repo is public, so never a real person.
- **No gate is created or changed.** A version's `approval` only points at a sign off that already
  exists in `touch_wording_approvals`, and at the endpoint that already approves it. The keys are
  worked out with the senders' own rules (`wordingKey` in `src/fundraising/touch-rules.ts`,
  `inviteWordingKey` in `src/fundraising/invite.ts`), not typed in. A unit test pins the set to
  exactly `WORDING_KEYS` + `PLEDGE_WORDING_KEYS` + `INVITE_WORDING_KEYS`.
- The ten groups, in order: Signing up and approval; Invites from staff; Teams; Keeping in touch
  (automatic); Finishing and paying in; In memory; Sponsor pledges; Event pages and tickets; The
  Festive Ball; Staff notices.

What is gated, and how each is shown:

| Email (`id`) | Key(s) | Approved through |
|---|---|---|
| You did it, target reached (`touch-target`) | `target` | `/api/admin/fundraising/touch/approvals/:key` |
| You're doing great (`touch-on-track`) | `on_track` | the same |
| Need a hand? (`touch-need-a-hand`) | `need_a_hand` | the same |
| A year ago today (`touch-year-on`) | `year_on_zero`, its nothing raised version only | the same |
| How did it go? (`touch-week-after`) | `week_after_zero`, its nothing raised version only | the same |
| Thank you, from all of us (`touch-finished`) | `finished`, and `finished_zero` for its nothing raised version | the same |
| Invite: in memory (`invite-memory`) | `invite_memory` | `/api/admin/fundraising/invite-wording/:key/approval` |
| Here's your link to pay your pledge (`pledge-pay`) | `pledge_pay` | `/api/admin/fundraising/pledges/approvals/:key` |
| A reminder about your pledge (`pledge-reminder`) | `pledge_reminder` | the same |

An email's row says **Approved** once every gated version of it is approved, **Waiting for sign off**
while any is not (with "Version: ..." when the one waiting is not the usual one, and the row opens on
it), and nothing when the email has no approval.

### The guard (`test/unit/email-catalogue-guard.test.ts`)

The card promises every email, so a new one cannot ship without a row. Five checks, read from the
source:

1. **Kinds.** Every kind passed to `sendAndLog` / `sendVerbatim` in `src/clients/email.ts` must be
   claimed by an entry's `logKinds`, or be named in the test's `OTHER_PARTS_OF_THE_SITE` list
   (donation receipts for companies, the newsletter, admin sign in and so on). A new kind forces the
   choice.
2. **Kinds are written out.** Check 1 reads kinds as string literals, so every call to
   `sendAndLog` / `sendVerbatim` must name its kind as a literal (apart from the two definitions and
   `sendVerbatim` handing its kind on), neither may be exported, and nothing in the four folders may
   send past them.
3. **Builders.** Every exported `build...Email` (a function or a `const`, and the Ball report's
   `renderReport`) in any file under `src/fundraising`, `src/pledges`, `src/tickets` and `src/ball`,
   however deep, must be called by the catalogue. This catches a new email that reuses an existing
   kind. (`buildTouchEmail` is reached through `touchEmailAsSent`, the function that really sends it.)
4. **Emails that share a builder.** Every `TOUCH_KINDS` kind and every `INVITE_TYPES` type must have
   its entry.
5. **Words typed at the call.** The pledge note to staff takes its words from its caller, so a new
   note written inline would be a new email with an existing kind and builder. Its subject may never
   be a string at the call (`sendPledgeStaffNote`, `notifyStaff`, `buildPledgeStaffEmail`): the words
   live in a named `...Note` function in `src/pledges/emails.ts`, each of which must be in the
   catalogue.

`test/unit/email-catalogue.test.ts` renders every version of every email and checks the groups, the
ids, that no address outside `example.com` and our own appears, that nothing reads "undefined", and
the house style of the catalogue's own words.

### API (`src/routes/admin-fundraising-emails.ts`, section `fundraising`, view)

| Route | Returns |
|---|---|
| `GET /api/admin/fundraising/emails/summary` | `{ count, waiting, approvalsUnavailable }`: the closed card's line. Builds no email. |
| `GET /api/admin/fundraising/emails` | `{ count, waiting, approvalsUnavailable, groups: [{ id, name, emails: [{ id, name, subject, who, audience, note, touchKind, state: "approved" \| "waiting" \| null, waitingVersion, versions: [{ id, label, approval: { key, path, approvedAt, approvedBy } \| null }] }] }] }`. No HTML. `subject` is the usual version's, `null` if that one builder throws. |
| `GET /api/admin/fundraising/emails/:id/:version` | `{ id, version, label, subject, html, approval, approvalsUnavailable }`. `404` for an id or version not in the catalogue; `500` with "That email could not be shown just now. The others are not affected." if its builder throws. |

`count` comes from the catalogue, never a number typed on screen. When the approvals cannot be read,
everything gated reads as waiting (as the senders treat it) and `approvalsUnavailable` is `true`.
There is no write route: approving is `POST`, and withdrawing `DELETE`, on the version's `path`
(admins only, each with its own History action, exactly as before). No migration.

`pledgeHiddenNote` and `pledgesPaidTwiceNote` (`src/pledges/emails.ts`) hold the words of the two
pledge notices to staff, which used to be written where they were sent, so the catalogue shows the
real words.

### The screen (`assets/js/admin/all-emails.js`, its own file beside `app.js`)

- **The card** (`#frAllEmails`, after Sponsor pledges) is folded and closed by default. Its bar says
  "N waiting for sign off" when anything needs an admin, otherwise "69 emails" (the server's count).
- **Lazy.** The count is fetched when Fundraising is shown; the list when the card is first opened;
  an email's HTML when its row is first opened.
- **Groups** are folded (`<details>`), each with how many emails it has and how many are waiting.
- **A row** is a real button (`aria-expanded`, `aria-controls`): the name, the label, the subject
  line, and who gets it and when. Pressing it opens the email underneath in a sandboxed `iframe`
  (`srcdoc`, `scrolling="no"`) as tall as the email is, drawn at 660px and zoomed to fit, or at the
  phone's own width under 480px. Opening another closes nothing: the page grows, and nothing scrolls
  inside a box.
- **Version** drop-down where an email has more than one version. Where another version is the one
  waiting, the open email says so, with **Show that version**.
- **Show it for**, on the automatic emails to organisers only: an example, or any public page raising
  money, as it would go to them today (`GET /api/admin/fundraising/touch/preview/:kind?fundraiserId=`).
  One choice for all of them. The pages come from `window.AdminFundraising.raisingPages()` in `app.js`.
- **Approve this wording** / **Withdraw approval**, for an admin who can also edit Fundraising (what
  the server asks; `window.AdminFundraising.canApprove()` in `app.js`), after a question, on gated
  emails only; everyone else sees "Waiting for sign off. It won't send until an admin approves it." or
  "Approved by ... on ...". After either, every label and the bar are read again, nothing is closed,
  and `nbcc:wording-changed` bubbles from the card so Automatic emails, Sponsor pledges and the invite
  form read their own state again.
- **Links from the other cards**: any button with `data-allemails-open="<group id>"` (and optionally
  `data-allemails-email`, `data-allemails-touch`, `data-allemails-fundraiser`) opens the card at that
  group and moves the focus there.
- **Adding an email**: add its entry to `CATALOGUE` (the guard will tell you if you forget). The card
  needs no change.

Tests: `test/unit/email-catalogue.test.ts`, `test/unit/email-catalogue-guard.test.ts`,
`test/unit/admin-fundraising-emails-routes.test.ts`, `test/unit/admin-all-emails-panel.test.ts`, and
`features/fundraising-all-emails.feature`.

## Sponsor pledges: "Sponsor now, pay after" (Jaimie, 2026-10-03)

On a sponsorship fundraiser's page, next to "give now", a sponsor can **pledge**: promise an amount
today and pay it after the event. A pledge is a **promise, never money**: it is shown apart from the
money raised ("£35 pledged by 4 sponsors, to be paid after Saturday 5 December 2026") and does not
count on the meter or towards the target until it is paid. The paper sponsor form stays, and the page
says so ("Already on Robin's paper sponsor form? You don't need to pledge here as well.").

Built as its own module with a few small hooks in shared files (listed below), so it can change
without touching the rest of fundraising.

### Who can pledge, and where

- **Pages that take pledges:** a public, approved page raising money, including a team **member's**
  page, until its date has gone or staff mark it finished (`canPledge`). **Never** an event page
  (events are not sponsorship), a page in memory of someone, or a team's own page.
- **The form:** amount (£2 to £1,000; above that: "For a pledge over £1,000, please call us on
  01292 811 015."), first name, surname, email, an optional message, show my name or stay anonymous,
  show the amount or not, and Gift Aid with the home address when ticked. The names and the message
  are checked against the blocked word list. A hidden honeypot field, per address and per email
  limits, the same origin check and Turnstile, as on the sign up form. In production the form is
  **closed** if Turnstile is not set up, or cannot answer (config already refuses to boot production without its keys;
  this is the second lock). No payment page opens and nothing is paid.

### Confirm by email

A pledge counts for nothing until its sponsor confirms it. When someone pledges they are sent **one**
email, "Please confirm your £10 pledge", with one button. The page says "Nearly done: we've emailed
you a link to confirm your pledge."

- The button opens `/pledge/confirm?t=<token>`, which only **asks**; pressing Confirm there (a POST)
  is what confirms it, so a mail scanner opening the link confirms nothing.
- Only a **confirmed** pledge (`open`) is on the page, on the wall, in the "£X pledged" line, in the
  organiser's list, and later emailed the pay link. An `unconfirmed` one is shown nowhere (staff see
  it as "Waiting for the sponsor to confirm by email").
- An unconfirmed pledge is **never emailed again** and is **deleted after 7 days**, with the log row
  of its email. The one exception: if the confirm email never went (the send failed), pressing the
  button again within ten minutes sends it then.
- One address may have at most **3 pledges waiting to be confirmed** made in the last 24 hours, on
  any page. A fourth stores nothing and sends nothing, and the form answers exactly as usual. This
  cap is in the database (the form's other limits are in memory, per server). A lock for that
  sponsor on that page is taken while a pledge is made, so two posts at once never make two pledges.
- The confirm email is **not** one of the automatic emails: it goes whatever the Automatic emails
  switch says and its wording is not approval gated, because pledging has to work from day one. It
  still respects the suppression and opt out lists (an address on either gets no email, and the
  pledge simply lapses). The form answers the same either way, so nobody learns who is on a list.
- It carries fixed words, one safe first name and the approved page's title: nothing else a stranger
  typed (no surname, no message).

### On the page

Confirmed pledges have their own "Pledges" section after Supporters ("Alex E. pledged £10"), under
the same name, amount and message rules as a gift. Staff can hide a message; the **organiser can
hide a pledge from their page** (it stays a pledge, its sponsor is still asked to pay, and the events
inbox is told).

### Gift Aid: declared now, for a payment made later

The sponsor makes the declaration **with the pledge**. Beside the tick box: "Yes, add Gift Aid when I
pay. I am a UK taxpayer. This gift is my own money." Its wording (version
`nbcc-pledge-single-2026-10`) names the amount and says it is for when they pay:

> I want to Gift Aid my donation of £10 when I pay it, to the Night Before Christmas Campaign. I am a
> UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount
> of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any
> difference.

The second sentence is HMRC's liability sentence exactly as on an online gift
(`src/declarations/wording.ts`). The pledge keeps the exact words, their version and when they were
agreed (`ga_wording_snapshot`, `ga_wording_version`, `ga_declared_at`). **Nothing is claimed until
the pledge is paid**: only then is there a donation at all.

When the pledge is paid, the pay page shows Gift Aid ticked with who is paying beside it ("Keep Gift
Aid on my donation. I am Alex and this is my own money. I am still a UK taxpayer.", the declaration,
the day it was made, and "If someone else is paying, please untick this."). The donation's
declaration row is then written by the ordinary webhook:

- paying **exactly** what was pledged: the pledge's own declaration, word for word;
- paying **more** (they may give more, never less): the standard single donation declaration, which
  the pay page shows and they confirm by paying;
- Gift Aid can never be added at payment if it was not declared with the pledge;
- a **second** payment for a pledge already paid carries **no** Gift Aid and writes no declaration:
  one declaration covers one donation.

**The declaration date survives.** The `declarations` row is created when the donation is (its
`created_at` is the payment). The day the declaration was actually made is kept in
`sponsor_pledge_declarations` (pledge, donation, declaration, `declared_at`, the pledge's wording and
version): plain numbers with no foreign keys, so it outlives the pledge and the fundraiser. The
checkout also stamps it on the Stripe session (`metadata.pledgeDeclaredAt`), which is what is kept if
the pledge itself has gone by the time the payment lands. It is in the pledge's `pledge.paid`
History row too. **For the accountant:** this relies on HMRC allowing a declaration to be made before
the donation it covers; please confirm the wording, the "own money" line, and that
`sponsor_pledge_declarations` is the right evidence for a claim audit.

### After the event: the pay link, one reminder, then nothing

Two emails to the sponsor, from and replying to the events inbox (`src/pledges/emails.ts`):

| Kind (email log) | When | Subject |
|---|---|---|
| `pledge_pay` (`fundraisePledgePay`) | the day after the fundraiser's date; with no date, the morning after staff mark it finished | "Robin finished Robin's Santa Dash! Here's your link to pay your £10 pledge" |
| `pledge_reminder` (`fundraisePledgeReminder`) | once, a week after the pay link, if still unpaid | "A reminder: your £10 pledge for Robin's Santa Dash" |

Both say why the sponsor is getting the email and carry a link to say "I can't pay this after all".
They are **automatic emails**, sent by the daily 8am task (`runPledgeEmails`,
`src/pledges/runner.ts`) only when every guard says yes:

- the **Automatic emails** switch in Admin > Fundraising is on, and fundraising is on;
- the email's **wording is approved** by an admin. Both keys (`pledge_pay`, `pledge_reminder`) ship
  **unapproved**, in the same `touch_wording_approvals` table as the automatic emails to organisers.
  One waiting is skipped and not claimed, so it still goes once approved while it is due;
- the address is on neither the suppression list nor the opt out list (a list that cannot be read
  means no email);
- each email is **claimed on the pledge before it is sent**, so neither ever goes twice; a failed
  send gives the claim back for another day, and a claim with no send behind it after an hour (the
  task died part way) is stale and may be claimed again.

The pay email can still go up to 60 days after it was due (a missed run, or wording waiting); the
reminder up to 3 weeks after it was due.

**Staff sending the pay link by hand** (Admin > Fundraising > Sponsor pledges) obeys **every** rule
above except the daily task's time window (the first send takes the same claim the daily task
takes, so the two can never both send it): the pledge is open, its page still has pledges on it, the
link is **due** (never early: "Their link goes the day after the event. To send it early, mark the
fundraiser finished first."), the switch and fundraising are on, the wording is approved and the
address is not stopped. A send holds the pledge for ten minutes so two presses never send it twice.
`pay_email_sent_at` stays the **first** send (resends are counted in `pay_email_last_sent_at` and
`pay_email_resends`), so the reminder and the 90 day clocks never restart.

### The links, and what breaks them

Each emailed link is `<pledge id>.<hmac>`, signed with `ADMIN_SESSION_SECRET` over a label for its
purpose, the id and a per pledge nonce (`src/pledges/token.ts`): `pledge.v1` for pay and cancel,
`pledge.confirm.v1` for confirm, so a confirm link can never pay or cancel, and none can be guessed
from a pledge number. The nonce is changed when a pledge is paid, cancelled, or put back from "paid in
cash", so the links already sent for it stop working.

**Rotating `ADMIN_SESSION_SECRET` makes every pay, cancel and confirm link already emailed stop
working.** After rotating it, an admin presses **"Send new pay links to everyone unpaid"** in
Admin > Fundraising > Sponsor pledges: one new link to each open pledge that has already had one,
under the same rules as sending one by hand. (Unconfirmed pledges whose confirm link broke simply
lapse after 7 days; the sponsor can pledge again.)

### Paying

`/pledge/pay?t=<token>` is a plain form that works without JavaScript: the amount is filled in and
may be raised, never lowered. It goes on to Stripe Checkout (card, Apple Pay and Google Pay only, so
a pledge is paid or it is not; the session closes after 31 minutes). The session is the **same one a
gift on the page makes** (`buildSessionParams`) plus `metadata.pledgeId`, so the one webhook records
the donation, links it to the fundraiser (meter and wall), writes the declaration and sends the
receipt as for any gift, and in the same transaction marks the pledge paid (`settlePledge`, behind a
savepoint: an error marking the pledge never rolls back the donation).

**Nobody pays twice by accident.** The pledge remembers the checkout it last opened
(`checkout_session_id`); opening another (a second tab, the email opened twice) closes the earlier
one first (`stripe.checkout.sessions.expire`). When Stripe will not close it, the page asks Stripe
which it is: if that checkout is **already paid** (the money is taken and only the webhook is still to
land) the sponsor is told "Your pledge is paid. Your receipt is on its way." and no new checkout is
opened. The new checkout is remembered only if the pledge still has the one this request read
(`checkout_session_id IS NOT DISTINCT FROM`), so two tabs at the same moment cannot both win: the one
that loses closes its own checkout and is told to finish in the other tab. A checkout is never
started for a pledge that is paid, cancelled or marked as paid in cash. If a second payment lands anyway, or one marked as cash is then
paid online, the pledge is **flagged**: it shows in the admin card ("Paid twice: check the payments
and refund the extra one", with "Mark as checked"), in the Monday summary ("N pledges paid twice:
check and refund"), and the events inbox is emailed (`fundraisePledgeStaff`).

**"I can't pay this after all"** is `/pledge/cancel?t=<token>`. Opening it only asks; a button
(`POST /pledge/cancel`) cancels the pledge quietly. A cancelled pledge gets no more emails.

### The organiser and staff

- **Private area** (`assets/js/fundraise-pledges.js`): each confirmed sponsor by name (**never** an
  email), the amount, and paid / not yet / cancelled, with the totals ("£35 pledged, £25 paid"; a
  refunded payment counts in neither). No cash is handled online; if a sponsor pays the organiser in
  cash, the organiser presses "Paid me in cash" (and can undo it). That pledge gets no pay email, is
  part of the cash they pay in, and its home address is dropped at once: cash has no Gift Aid online,
  and the page says to use the paper sponsor form for it. "Hide from my page" takes a pledge off
  the page.
- **Admin > Fundraising > Sponsor pledges** (`assets/js/admin/pledges.js`, its own file beside
  `app.js`): every fundraiser's pledges with the sponsor's email, send or resend the pay link, cancel
  a pledge, hide a message, mark one paid twice as checked, new pay links for everyone unpaid
  (admins), and a line saying whether the two automatic emails are going (and how many are waiting
  for sign off) with **Read and approve these in All emails**, which opens the **All emails** card at
  "Sponsor pledges". The two emails are read and approved there now, not in this card.
- **Monday summary:** "N pledges unpaid 2 weeks after the event" and "N pledges paid twice: check and
  refund", under Waiting on us.

### Privacy and retention

The form says: "We keep your details until your pledge is paid, or for 90 days after we ask." The
daily task (`runPledgeRetention`, whatever the switches say):

- **deletes** a pledge nobody confirmed, 7 days after it was made;
- **anonymises** an unpaid pledge (name, email, message, home address removed; the amount and state
  kept; an open one becomes `expired`) 90 days after its pay email. Never emailed: 90 days after the
  day it was due, or after it was cancelled or marked paid in cash; with nothing to count from, a
  year after it was made;
- a **paid** pledge drops its home address at once (the declaration has it) and its email 90 days
  after it was paid; its name stays, as on the donation.

Each takes the **email log** rows for that sponsor's pledge emails with it
(`eraseEmailLogFor(email, kinds)`), and the pledge emails are logged with **no name** in the first
place. There is no donor erasure flow in the app yet (erasure today is per story and per contact
enquiry); when one lands it must also clear `sponsor_pledges` for that address, as it must
`email_log`.

### Routes

| Route | Who | Body | Answer |
|---|---|---|---|
| `POST /api/fundraisers/:slug/pledges` | anyone, from our own page | `{ amountPence, firstName, surname, email, message?, showName, showAmount, giftAid, house?, address?, postcode?, nonUk?, company, captchaToken }` | `201 { status: "pledged", confirm: true, amountPence }` (the confirm email is on its way); `400` with `fields`; `409` when the page takes no pledges; `404` while fundraising is off; `503` in production without the spam check |
| `GET /pledge/confirm?t=` | the sponsor | | asks; confirms nothing |
| `POST /pledge/confirm` | the sponsor | form: `t` | confirms the pledge |
| `GET /pledge/pay?t=` | the sponsor | | the pay page, or a notice (paid, cancelled, paid in cash, link no longer works); never kept or indexed |
| `POST /pledge/pay` | the sponsor | form: `t`, `amount`, `giftAid?`, `coverFee?` | `303` to Stripe Checkout; the form again with what was wrong (`400`, less than was pledged) |
| `GET /pledge/cancel?t=` | the sponsor | | asks; cancels nothing |
| `POST /pledge/cancel` | the sponsor | form: `t` | cancels the pledge |
| `GET /api/fundraise/manage/pledges` | the signed in organiser | | `{ fundraisers: [{ id, takesPledges, totals, pledges: [{ id, name, amountPence, paidAmountPence, status, statusWords, giftAid, createdAt, canMarkCash, canUnmarkCash, hidden, canHide }] }] }`, confirmed pledges only |
| `POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/cash` | the signed in organiser | `{ paid: true \| false }` | `{ pledge }`; `409` when it can no longer change |
| `POST /api/fundraise/manage/fundraisers/:id/pledges/:pledgeId/hide` | the signed in organiser | `{ hidden: true \| false }` | `{ pledge }`; the events inbox is told |
| `GET /api/admin/fundraising/pledges` | fundraising view | | `{ today, fundraisers, totals, unpaidTwoWeeks, paidTwice, emails: { on, kinds } }`, with sponsor emails |
| `POST` \| `DELETE /api/admin/fundraising/pledges/approvals/:key` | admin | | approve or withdraw a wording |
| `POST /api/admin/fundraising/pledges/send-pay-links` | admin | | `{ sent, skipped, failed, stopped }`; `409` when the rules say none may go |
| `POST /api/admin/pledges/:id/send-pay-link` | fundraising edit | | `{ status: "sent" }`; `409` with why not (early, switched off, waiting for sign off, stopped address, sent in the last 10 minutes) |
| `POST /api/admin/pledges/:id/cancel` | fundraising edit | | `{ status: "cancelled" }` |
| `POST /api/admin/pledges/:id/message` | fundraising edit | `{ hidden }` | `{ status }` |
| `POST /api/admin/pledges/:id/checked` | fundraising edit | | `{ status: "checked" }` for one paid twice |

### Data (`migrations/1791200000220_sponsor-pledges.js`, additive only)

`sponsor_pledges`: fundraiser (cleared with it); `first_name`, `surname`, `email`, `message` (all
nullable, so they can be removed); `amount_pence` (£2 to £1,000); `show_name`, `show_amount`,
`message_hidden`, `hidden_at` / `hidden_by`; `gift_aid` with `ga_house`, `ga_address`, `ga_postcode`,
`ga_non_uk`, `ga_wording_version`, `ga_wording_snapshot`, `ga_declared_at`; `status` (`unconfirmed`,
`open`, `paid`, `cash`, `cancelled`, `expired`); `confirm_email_sent_at`, `confirmed_at`;
`token_nonce`; when each email was claimed and sent, `pay_email_last_sent_at`, `pay_email_resends`;
`checkout_session_id`; `paid_at`, `paid_amount_pence`, `donation_id`, `declaration_id`;
`double_paid_at` and who checked it; who marked cash or cancelled, and when; `anonymised_at`.

`sponsor_pledge_declarations`: `pledge_id`, `donation_id`, `declaration_id` (plain numbers, no
foreign keys), `declared_at`, `wording_version`, `wording_snapshot`: when the declaration made with a
pledge was made, kept where deleting the pledge or its fundraiser cannot reach it.

Every change writes an `audit_log` row (entity `sponsor_pledge`), never with a name or an address.
Numbered 220, after the 215 event tickets adds. Both tables are in the nightly backup's table
count (86).

### Where it lives, and tests

- `src/pledges/model.ts` (the rules, pure), `token.ts`, `emails.ts`, `render.ts`, `checkout.ts`,
  `runner.ts`; `src/db/pledges.ts`; `src/routes/pledges.ts`; `pledge.html`;
  `assets/js/fundraiser-pledge.js`, `fundraise-pledges.js`, `admin/pledges.js`; `assets/css/pledges.css`.
- **Hooks in shared files:** `src/fundraising/render.ts` (three places the page takes the pledge
  extras), `src/routes/fundraise-pages.ts` (asks for them), `src/db/stripe-webhook.ts` (the Gift Aid
  check on a second payment, marking the pledge paid behind a savepoint, and telling the events inbox
  after commit), `src/app.ts` and `src/routes/site.ts` (the routers), `src/clients/email.ts`,
  `src/email/tracked-links.ts`, `src/db/email-log.ts` (`eraseEmailLogFor` takes kinds) and the
  admin's email kinds, `src/scripts/send-reminders.ts` (the daily passes),
  `src/fundraising/summary.ts` and `src/db/fundraising-team.ts` (the Monday lines), `fundraiser.html`,
  `fundraise-manage.html`, `admin.html`, `Dockerfile`. `test/unit/sponsor-pledges-wiring.test.ts`
  reads the source for each, so one lost in a merge is caught.
- Unit tests: `test/unit/sponsor-pledges-*.test.ts`. BDD: `features/sponsor-pledges.feature`.

## A QR code encoder for fundraiser pages (TASK-493)

`src/fundraising/qr.ts` draws QR codes with no dependencies, written from the QR standard
(ISO/IEC 18004). It is pure: no files, no network.

- `encodeQr(text, { ecc })` returns the grid of modules (`true` = dark), row by row. The text is
  sent as UTF-8 bytes. Error correction defaults to **M** (L, M, Q and H are allowed). It picks the
  smallest size that fits, from version 1 (21 by 21) to version 10 (57 by 57); text that does not
  fit throws an error saying how many bytes it has and how many fit (213 at M, enough for any of
  our page links). It tries all eight masks and keeps the one the standard's four penalty rules
  score lowest.
- `qrSvg(text, { ecc, margin, size, title })` returns a small SVG to put straight into a page:
  a white background and one path of dark squares, `shape-rendering="crispEdges"`, a `viewBox` in
  modules, a 4-module quiet zone by default, a pixel `size` if given (otherwise it fills its
  container), and an escaped `<title>` with `role="img"` when a title is given.

**Tests.** `test/unit/fundraising-qr.test.ts`: 22 codes across every version 1 to 10 and every
level match, module for module, grids made once by a separate encoder; the Reed-Solomon, format and
version bits match the standard's published values; and every code generated (every length from
empty to the version 10 limit at each level, UTF-8 text, the fundraiser link at each level, all
eight masks) is read back by a separate strict decoder in `test/unit/helpers/qr-decode.ts`, which
checks the fixed patterns, the format and version bits, the error correction of every block and
the padding before returning the original text. The SVG tests redraw the path and compare it with
the grid, and check the escaping.

## Backups (TASK-423)

Every night at 02:00 UK, an EventBridge schedule runs `npm run backup` as a
one-off Fargate task (the same pattern as the reminders job, `backups.tf`). It
writes to **two** places, because they defend against different things:

| Where | Protects against | Kept |
|---|---|---|
| S3, Object Lock in COMPLIANCE mode | Deletion, ransomware, a mistaken or compromised admin. Nothing can alter it for 35 days — not an admin, not root, not AWS support. | 35 daily, then monthly to **7 years** |
| Google Drive (Shared Drive), AES-256 | Losing the AWS account altogether: compromise, suspension, closure | 30 daily, 12 monthly |

Neither alone is sufficient. The S3 copy cannot survive losing the account it
lives in; the Drive copy is not immutable.

### There are THREE databases, not one

This is the trap this feature was built around. `DATABASE_URL` holds 85 tables
(42 when this was built; the Events page added three in TASK-453, the Festive Ball ticket
report one in TASK-464, the admin's New pills one, `admin_seen`, in TASK-478, site analytics
four in TASK-479, the business supporter call log in TASK-491, community fundraising five
in TASK-493, the private area's sign in codes and sessions two in TASK-501, the invites and
calls two in TASK-503, the requests one in TASK-505, the news updates one in TASK-506, and the
thank yous to supporters and the address level opt out list three in TASK-507, the old page
links one in TASK-511, the fundraising categories one in TASK-514, and which automatic emails each
fundraiser has had and the Do it again links two in TASK-515, the team invites and team
organiser handovers two for team pages, the approved automatic email wordings one, the impact
examples one for what gifts could do, and the photos organisers send one for profile pictures, six
for event tickets: the ticket types, each event's limit and sales switch, the orders and their
lines (with buyers' names, emails and phones), the refunds and the refund requests, and two for
welcome packs: each page's pack and the things ticked in it),
but `STORIES_DATABASE_URL` and `CONTACT_DATABASE_URL` are separate databases
(deliberately, so the public story and contact forms can never reach donor
data). A `pg_dump $DATABASE_URL` captures 85 of **88** tables and silently
drops every My Story submission (and, since TASK-475, the fingerprints in
`erased_stories` that keep erased stories from coming back) and every contact
enquiry, while producing a
file of entirely plausible size.

`src/backup/plan.ts` is the single source of truth, and
`test/unit/backup-plan.test.ts` reads the migration directories off disk and
fails if one exists that the backup does not know about. **Adding a fourth
database will break that test until you add it here too. That is the point.**

### What the archive contains

- a `pg_dump` per database (restore with `pg_restore`)
- a CSV per table, so the charity can read its own data in Excel without
  Postgres, a developer, or this codebase
- `website.tar.gz` — the deployed site itself, so recovery does not depend on
  GitHub still existing
- `manifest.json` — every table and its row count. **Check a restore against
  this** rather than trusting that it looked fine
- `HOW-TO-RESTORE.txt` in plain English

**Live secrets are deliberately excluded.** Stripe keys, database passwords and
SES credentials are not in the archive. It is the copy most likely to end up
somewhere unintended, and whoever held it could otherwise take card payments as
NBCC. Those live in SSM; recreate them from there.

### The passphrase lives outside AWS

`BACKUP_ARCHIVE_PASSPHRASE` is an SSM SecureString, pasted in by hand, with
`ignore_changes` so Terraform never overwrites it. **A copy must also be in the
charity's password manager.** An archive whose only passphrase is in the account
you just lost is an unopenable file in exactly the disaster it exists for.

### Google auth has no key

The Google organisation enforces `iam.disableServiceAccountKeyCreation`, so
there is no service-account key. Google is told to trust exactly one AWS role
(`charity-site-production-task`), the job signs a `GetCallerIdentity` call with
its task-role credentials, and Google checks that with AWS before issuing a
token good for under an hour. Nothing to store, rotate or leak. See
`src/clients/google-federation.ts`.

### How you know it is working

- a **failure alert** by email when the job detects a problem
- the job **refuses to upload** an incomplete or suddenly-smaller backup, leaving
  yesterday's good archive untouched, and says so
- a **CloudWatch alarm** when no success has been recorded for 48 hours. This is
  the one that matters: the app cannot email about a run that never started, and
  that is how backups actually die. `treat_missing_data = "breaching"`, because
  missing data *is* the emergency
- the alarm's SNS email subscription **must be confirmed** by clicking the link
  AWS sends on first apply, or it fires into nothing

**AWS deletes an unconfirmed SNS subscription after 3 days, silently.** This has
already happened once: the infrastructure was applied on 22 September, nobody
clicked the link, and by the 25th the topic had zero subscriptions and the alarm
had nowhere to send. Nothing warned about it, because the thing that would have
warned was the thing that had gone.

So: confirm the link the day it arrives. If it is ever missed, re-running the
Infra apply recreates the subscription and sends a fresh one, because Terraform
sees it missing. To check at any time, look at the topic
`charity-site-production-backup-alarms` in SNS; it should show **1** confirmed
subscription, not 0.

### pg_dump cannot use the app's connection string as-is (TASK-427)

`DATABASE_URL` ends `sslmode=no-verify`. **That is not a PostgreSQL option.** It is an extension
invented by node-postgres meaning "encrypt but do not verify the certificate", chosen so the image
need not carry the RDS CA bundle. `pg_dump` and `psql` use libpq, which has never heard of it:

```
pg_dump: error: invalid sslmode value: "no-verify"
```

The nightly backup therefore failed **every night from the day it shipped**. Nothing caught it:
every unit test mocks the database, and CI's Postgres does not enforce TLS, so no test ever put
that string in front of a libpq tool. It could only fail against the real RDS instance, at 2am.
The CloudWatch alarm is what surfaced it, which is the one part of this that worked as designed.

`src/backup/pg-tools.ts` translates the connection into libpq's vocabulary (`no-verify` →
`require`; same meaning, different word) and passes it as **environment variables, not command-line
arguments**. A test asserts the output is always one of libpq's six accepted values, whatever
arrives.

**The default when a URL carries no sslmode is `prefer`, not `require`.** `require` was the first
instinct and was wrong in the same shape as the original bug: local development and CI run Postgres
with no TLS, so it would have fixed production and broken everywhere else. Production never reaches
the default, because Terraform always writes an explicit sslmode.

### Why the connection goes through the environment

Not tidiness. The original failure printed the whole failing command, the command carried the
connection string, and **the database password went into CloudWatch logs**. Out of `argv` it cannot
reach an error message, a log line, or `ps` inside the container. `scrubConnectionStrings` masks
passwords in anything logged anyway, as a second line of defence, and is tested against the exact
error text that leaked.

### Object Lock requires a checksum on every upload (TASK-428)

The first backup that got past the sslmode bug dumped all three databases, built the archive, and
was then rejected by S3:

```
InvalidRequest: Content-MD5 OR x-amz-checksum- HTTP header is required for
Put Object requests with Object Lock parameters
```

A write-once bucket will not accept an upload it cannot verify. That is the point of it: having
accepted the bytes it cannot replace them for 35 days, so it declines to immortalise something that
may have arrived corrupted. An ordinary bucket has no such requirement, so nothing short of the
real bucket could have shown this.

`src/clients/s3.ts` sends `x-amz-checksum-sha256`. **Note the two encodings:**
`x-amz-content-sha256` (SigV4's payload hash) is **hex**, while `x-amz-checksum-sha256` is
**base64**. Same digest, and swapping them produces a signature error that says nothing about
encoding.

### Restoring

```bash
7z x nbcc-backup-YYYY-MM-DD.7z        # password from the password manager
createdb nbcc_restore && pg_restore -d nbcc_restore main/main.dump
psql nbcc_restore -c 'SELECT count(*) FROM donors'   # compare with manifest.json
```

**Last rehearsed:** not yet — see the PR checklist. An unverified backup is a
belief, not a backup.

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

The **contact form spam check** (TASK-490) has two keys. `TURNSTILE_SITE_KEY` is Cloudflare
Turnstile's **public** site key, which reaches every visitor's browser, so it is handled like
`STRIPE_PUBLISHABLE_KEY`: a plain task-def `environment` value backed by the `turnstile_site_key`
module variable and set in `infra/envs/production/main.tf`. `TURNSTILE_SECRET_KEY` is a secret: an
SSM `SecureString` created holding `REPLACE_ME` (with `ignore_changes` on its value), injected via
`valueFrom`, its ARN in `exec_secrets`. The real value is set with the `put-parameter` command under
**One-time AWS bootstrap**, followed by a service restart. Both default to empty, and the check runs
only when both are set, so local development and CI run without it. Unlike the publishable key,
the production web server **refuses to start** without them (`productionConfigProblems` in
`src/config/schema.ts`, applied in `src/index.ts`), so the check cannot be lost by accident. The
scheduled jobs (the backup, the reminders) load the same config but not this rule, so they never
depend on the keys. The flip side: the infra apply that adds them must land before the deploy that
needs them, or the new web server tasks will not start and ECS keeps the old ones running.

`CONTACT_FORWARD_URL` (TASK-039, REQ-030) was the form-service endpoint `/api/contact` used to
forward enquiries to. It was retired from the live path by the 2026-07-10 contact-inbox spec —
`POST /api/contact` stores enquiries instead of forwarding them (see **Contact form tab** above) —
and the Resend→SES migration **removed it entirely**: the dead `src/clients/contact.ts` module, the
schema key, `.env.example`/CI entries, the SSM parameter and the task-def/`exec_secrets` wiring are
all gone.

`CONTACT_DATABASE_URL` (2026-07-10 contact-inbox spec) is the connection string for
the **isolated `contact` database** the public enquiry form and its admin tab read
and write (`src/db/contact-pool.ts`, `contactPool` — never the main `charity` DB or
the `stories` DB). Same treatment as `STORIES_DATABASE_URL`: a required, never-defaulted
`z.string().url()` in the schema (a missing value fails boot), an SSM `SecureString`
assembled with `sslmode=no-verify` and injected via `valueFrom` with its ARN in
`exec_secrets`. See **Local development** below for the local DB/role setup and
`migrate:contact` / `bootstrap:contact` scripts.

**Email keys (Resend→SES migration — replaces `EMAIL_SEND_URL`).** The app sends every email
straight to the **Amazon SESv2 API** (`src/clients/ses.ts`) — no relay Worker, no provider API key.
Authentication is the **ECS task role** (`ses:SendEmail` scoped to the two verified identities,
`infra/modules/app/ecs.tf`), signed by a dependency-free SigV4 signer (`src/clients/aws-sigv4.ts`,
pinned to AWS's published test vector — no `@aws-sdk` dependency, deliberately: the npm registry is
blocked on the owner's machine). The keys, all defaulted so boot never blocks:

- `EMAIL_PROVIDER` (`stub`|`ses`, default `stub`) — the stub seam. Outside production `stub` makes
  every send a no-op (the old `.example`-placeholder behaviour); production's task definition sets
  `ses` and production never stubs regardless.
- `SES_REGION` (default `eu-west-2`) — plain task-def env, matching the stack's region.
- `SES_NEWSLETTER_CONFIGURATION_SET` / `SES_TRANSACTIONAL_CONFIGURATION_SET` — the two SES
  configuration sets Terraform creates (`ses.tf`): the newsletter one carries click tracking on
  `click.news.nbcc.scot` (`links.news` before TASK-466), the transactional one deliberately none.
  Blank = send without events.
- `MAIL_FROM` (default `noreply@nbcc.scot`) — the From for app-branded transactional email (the
  retired relay's `MAIL_FROM` role).
- `SES_WEBHOOK_TOKEN` — the ONE email secret: the shared token in the delivery-webhook path
  (`POST /api/webhooks/ses/:token`), minted by Terraform (`random_password` → SSM `SecureString` →
  both the task-def `secrets` and the SNS subscription URL). Blank ⇒ the webhook answers 503.
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` /
  `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` — optional pass-throughs the platform injects (Fargate
  sets the last one for the task role); they exist in the schema only because golden rule 3 forbids
  reading `process.env` outside the config module. Not wired to SSM/task-def by hand.

`DECLARATION_FORM_BASE_URL` (TASK-075) is the public site base the in-person Gift Aid
declaration link + QR short link are built on (`declarationLinks`). **Not** a secret (it
ships in the email/QR), but SSM-held and injected via `valueFrom` like the price IDs — a
plain SSM `String` with its ARN in `exec_secrets`; validated
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

`NEWSLETTER_FROM_EMAIL` (TASK-161 · REQ-069) is the From address stamped on every admin-newsletter
email. Since TASK-298 it defaults to `newsletter@news.nbcc.scot` — the **dedicated sending
subdomain** (TASK-296), so a campaign that upsets a spam filter builds and risks its own reputation
rather than the apex's, which carries donation receipts, Gift Aid confirmations and admin login
codes.

`NEWSLETTER_REPLY_TO_EMAIL` (TASK-298) is where a reply GOES, and it is deliberately a **separate
setting** defaulting to `newsletter@nbcc.scot`. This is not tidiness — `news.nbcc.scot` exists only
to send: it has **no MX and no A record**, so mail addressed there hard-bounces. From and Reply-To
used to be one value, so moving the From alone would have silently broken every reply, including the
ones our own unsubscribe page invites ("just reply to any of our emails and we'll put it right").
DMARC aligns on the From domain, not Reply-To, so pointing it at the apex costs nothing.

**If you ever change the From domain, check the Reply-To still lands somewhere that receives.**
Pinned by `test/unit/newsletter-addresses.test.ts`.

Neither is a secret (both ship in the email headers) — plain SSM `String`s injected via `valueFrom`
like `DECLARATION_FORM_BASE_URL`/`PORTAL_BASE_URL` (their ARNs live in the `exec_secrets` policy,
matching that pattern), validated as email addresses and defaulted so local dev / CI boot without
extra setup. `sendNewsletter` (`src/clients/email.ts`) sends each message via SES with its own
`subject`/`from`/`replyTo` honoured per message, tagged with the click-tracked newsletter
configuration set. **Ops prerequisite:** `newsletter@nbcc.scot` must be a real **receiving mailbox**
(the `news.` sending subdomain is send-only) for replies to land, and both SES identities must be
verified (DKIM CNAMEs applied — `infra/modules/app/ses.tf`).

`GIVING_FROM_EMAIL` (TASK-165 · REQ-069) is the equivalent From **and** Reply-To address for donor
**thank-you letters**, so a donor's reply reaches the giving inbox rather than a noreply. Same shape
as `NEWSLETTER_FROM_EMAIL`: **not** a secret, a plain SSM `String` injected via `valueFrom` (its ARN
in `exec_secrets`), validated as an email and **defaulted** to `giving@nbcc.scot`. `sendThankYou`
(`src/clients/email.ts`) sends its own `subject`/`from`/`replyTo` verbatim via SES.
**Ops prerequisite:** `giving@nbcc.scot` must be a real **receiving mailbox** for replies to land,
and the `nbcc.scot` SES identity must stay verified. A `DMARC` record on `nbcc.scot` (with SPF/DKIM)
is in place for inbox placement. The **business-supporter thank-you invite** (TASK-213,
`sendBusinessSupporterInvite`) reuses this **same** verbatim-send path with the same
`GIVING_FROM_EMAIL` From/Reply-To.

**Signup band, import names and email rules (TASK-269).** Three fixes around the newsletter's edges:

- **Imported names are tidied** (`tidyName` in `src/newsletter/import-parse.ts`). Spreadsheets arrive
  SHOUTY or flat; the first name is what the newsletter greets people by ("Dear John,"). Names are
  normalised in the **parser**, so the admin sees the tidied value in the import preview — what they
  approve is exactly what lands. One capital per word, preserved after a hyphen or apostrophe
  (Anne-Marie, O'Brien), accents included.
- **The footer signup band** (`initFooterSignup`, `assets/js/main.js`) is now **appended last** inside
  the footer's column grid and spans it (`.foot-signup{grid-column:1/-1}`), so it runs the long way
  under the other footer content — and DOM order matches reading order, so tab order is right.
  Previously it was the *first* child of a 3-column grid, so it took one 1.5fr column and shoved the
  brand and link columns out of place. Its consent label was also **invisible**: the global `form{}`
  rule paints a white card, putting cream text (`--cream-82`) on near-white. `.foot-signup-form` now
  clears that card, so the label sits on the footer maroon at ~10:1 contrast.
- **Email rules are visible** (`RULE`/`LINE` in `src/newsletter/theme.ts`). The old `#e5ded3` hairline
  sat at ~1.2:1 on the cream card — nothing in a real inbox. Dividers and list separators now use
  `RULE` (`#A08A6E`, ~3:1 — the non-text contrast bar) with the divider block at **2px**; card and
  image borders use the quieter `LINE` (`#D6C7B4`), still darker than before.

**Donor audience + archiving (TASK-270).** Audiences gained a **`kind`**, replacing a slug-string
special case, and a **tombstone archive**:

- **`kind`** (`subscriber_lists.kind`, `src/db/subscriber-lists.ts`) says what an audience *means*:
  `manual` (exactly the people on it — Volunteers, Partners, Referrers), `donors` (every donor with
  email consent, resolved live, never hand-managed), `everyone` (its own members **plus** the donors —
  the `Newsletter` audience). `listRecipientsForList` now switches on `kind`. Previously donors were
  spliced in **only when the list's slug was literally `newsletter`**, so a rename would have silently
  dropped every donor from a send with nothing on screen to say so — and there was no way to mail
  donors *alone*. A new seeded **Donors** audience makes that possible.
- **Member counts tell the truth.** The count consults the live donor audience for `donors`/`everyone`,
  so the picker no longer says "Newsletter (3)" while the send reaches every consenting donor.
- **Archiving is a tombstone, never a delete** (`archived_at`): the audience leaves the pickers and
  can't be sent to (`DELETE /api/admin/subscriber-lists/:id`, restore via `POST …/:id/restore`,
  `GET …/archived`), while past sends keep their audience label and the membership rows survive as
  consent history. Built-ins (Newsletter, Donors) refuse with a 409.
- **Guards:** you can't hand-add or import into `Donors` (it follows consent) or into an archived
  audience, and a send to an archived audience is refused before the draft is claimed.
- **History shows the audience.** `listNewsletters` joins the list name; the stamped `list_id` was
  previously write-only, so the history couldn't say whether a message went to volunteers or donors.
- The send-recipients endpoint returns `audience`/`kind` alongside the count, so the send
  confirmation can **name** what it is about to mail rather than saying "consenting subscribers".

**One person, several audiences (TASK-282).** Somebody met at an event is often a volunteer *and* a
business contact *and* wants the newsletter. Doing that as three trips through the same form is where
a list ends up half-populated, so a person — or a whole spreadsheet — can now be written to several
audiences in one action.

Three **additive** endpoints. They carry their targets in the **body**, not the path, because there is
no single `:id` to name; the existing `/subscriber-lists/:id/…` routes are untouched and still serve
anything aimed at one audience.

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/admin/subscriber-list-members` | `listIds[]`, `email`, `name?`, `phone?` | per-audience outcomes, folded |
| `POST /api/admin/subscriber-list-import/preview` | `listIds[]`, `filename`, `dataBase64` | rows, issues, per-audience `alreadyOnList` |
| `POST /api/admin/subscriber-list-import` | `listIds[]`, `rows`, `attestation` | totals plus a per-audience breakdown |

- **The rules are pure** (`src/newsletter/audience-targets.ts`), so they are pinned by tests that need
  no database. `parseTargetListIds` returns **`null`, not `[]`**, for an empty or invalid selection:
  a silent no-op that reports success is the worst outcome here, because the volunteer walks away
  believing the person was added.
- **Every audience is checked before any is written.** A half-finished add that still reports success
  is worse than a clean refusal — pressing it again doubles the part that already worked, and nothing
  on screen says which part that was. A BDD scenario pins it: adding to a real audience *and* a
  non-existent one writes nothing at all.
- **Resubscribing is counted apart from adding.** A deliberate staff add may revive an opted-out
  membership (`revive: true`); folding that into "added" would hide a **re-consent** inside a
  routine-looking confirmation. An import still may never revive (`revive: false`) — a spreadsheet
  cannot overrule an opt-out.
- **"Ready" means something precise on an import.** A row is ready if it would join **at least one**
  chosen audience. Somebody already on Volunteers but not on Newsletter is genuinely work to do, and
  calling them "already on the list" would report nothing to do when four hundred additions were.
- **No path sends a welcome email.** `shouldSendWelcome` is true only for the website footer signup,
  so one add across five audiences cannot become five emails — or even one. Pinned in
  `newsletter-welcome.test.ts` so a later "be friendlier" change has to come past that test.
- **Not a transaction, deliberately.** Each membership is an independent, idempotent row, so a partial
  write is recoverable (press it again — `exists` is a no-op) and honestly reportable. A transaction
  would buy an atomicity nobody asked for while hiding *which* audience failed.

**Newsletter tab restructure (TASK-271).** The tab now runs in four numbered stages —
**1 Audiences & people → 2 Write the newsletter → 3 Send → 4 Sent newsletters**. Previously audience
management, the send history, the composer and the send controls were interleaved, so the picker that
decides *who gets a newsletter* sat ~110 lines away from the audiences it names. **The composer
(`.nl-builder`) is unchanged** — only its surroundings moved. What changed and why:

- **Every action that touches an audience names it.** Adding a person and importing a spreadsheet each
  have their **own** destination picker (`#amList`, `#importListPick`), separate from the picker you
  browse with. Sharing one control was a live data bug: the preview was only cleared by a *successful*
  import, so previewing a sheet against Volunteers, changing the picker and clicking Import put the
  Volunteers rows into **Newsletter**. The preview now remembers which audience it was taken against,
  changing destination or file clears it, and the commit refuses on a mismatch.
- **One way to add a person.** There were two add forms twenty lines apart writing to *different
  tables*: "Add a subscriber" (a `donors` row, with no audience choice) and "Add to audience". The
  first is gone from the UI; adding someone is now one form that states which audience they join.
  Adding a person no longer sets `email_consent` on a matching **donor** row — it creates a list
  membership. They still receive the newsletter.
- **Re-consenting a donor is now its own deliberate action** ("Someone asked us to email them again"),
  behind a summary and a `window.confirm` that spells out the blast radius. It hits the same
  `POST /api/admin/newsletters/subscribers` endpoint as before, but where that switch used to be a
  silent *side effect* of typing an address into the plain add box — undoing an opt-out across every
  email the charity sends — it is now something staff choose on purpose.
- **The send confirmation names the audience** ("Send to Volunteers?" / "Yes, send to Volunteers"), and
  a line under the Send button states who it reaches and how many *before* you open it. The old dialog
  said "N consenting subscribers" whoever they were — identical wording whether you were mailing the
  volunteers or every donor the charity has. Its failure fallback no longer claims the send "will
  still reach all consenting subscribers" regardless of the chosen list.
- **Donors is explained where it matters** — stage 1 says Donors follows consent, Newsletter is
  everyone, and other audiences are exactly who you add. Donors is omitted from the add/import pickers
  entirely (rather than offered and then refused), and **Archive** appears only on hand-managed
  audiences, with a confirm that spells out that nobody is deleted.
- **History shows the audience** each newsletter went to.

> **Watch the page-weight budget.** `donate.html` sits at ~99.8% of the 255KB first-paint budget
> (`test/unit/perf-budget.test.ts`) — roughly 460 bytes spare. Any addition to `assets/css/styles.css`
> or `assets/js/main.js` can turn it red. On Windows checkouts with `core.autocrlf=true` the test
> fails **locally** but passes in CI, because CRLF adds ~3.8KB that the LF files in CI don't carry —
> measure the LF total before assuming a real regression.

- Tasks run in public subnets with no NAT gateway (saves ~£25-30/mo); the
  security groups only allow inbound from the ALB. Flip to private+NAT in
  `infra/modules/app/main.tf` if you must.
- RDS is `db.t4g.micro`, multi-AZ in production.
- The DB password is generated and stored in SSM, so it lands in Terraform
  state - keep the state bucket locked (the bootstrap script does). Or switch
  to `manage_master_user_password = true` (noted in `rds.tf`).
- The bootstrap IAM roles are broad (PowerUser + IAM). Tighten before prod.
- HTTPS isn't wired yet - add an ACM cert + 443 listener once you have a domain.

> Generated as a starting baseline. Run `terraform validate` / `plan` and
> `npm ci` before trusting it end to end.

**Deliverability essentials (TASK-272).** The first slice of the mailing-platform review. Everything
here protects the `nbcc.scot` sending reputation, which also carries admin sign-in codes and receipts:

- **Suppression list** (`email_suppressions`, `src/db/email-suppressions.ts`). A spam complaint or a
  **permanent** bounce now takes an address out of every future send. Previously both were recorded
  and then ignored — the recipient queries filtered on consent alone, so a dead mailbox and someone
  who pressed "report spam" were re-mailed on every send, forever, which is the single strongest
  signal a mailbox provider uses to judge a sender careless. Transient bounces (a full inbox) are
  **not** suppressed; suppressing after N repeats is a deliberate follow-up. Filtering happens inside
  `listRecipientsForList`, the one resolver both the send loop and the recipient preview use, so the
  count an admin confirms is the count that goes out. Blocked addresses are listed in the admin
  ("Blocked addresses") and can be lifted — suppression is a tombstone, never a delete.
- **RFC 8058 one-click unsubscribe.** `sendNewsletter` sets `List-Unsubscribe` and
  `List-Unsubscribe-Post` from a per-recipient `unsubscribeUrl` (SES `Content.Simple.Headers`), and
  `/unsubscribe/:token` accepts **POST** as well as GET. Gmail and Yahoo require this of bulk
  senders; without it recipients reach for "report spam" instead, and a complaint costs far more
  than an unsubscribe.
- **An unsubscribe now sticks.** Someone who donated with the box ticked *and* signed up through the
  website footer exists twice — a consenting donor and a list membership. The send deduped them with
  the donor identity winning, so clearing that flag left the subscriber row active and the next
  newsletter reached them anyway. A donor unsubscribe now tombstones every list membership for that
  address (`unsubscribeAllListsForEmail`).
- **The unsubscribe page says what it did** — a donor link stops all marketing including thank-you
  letters (receipts still come, being records of a gift); a subscriber link leaves one audience.
- **"Delivered" was not delivered.** The history column showed relay-*accepted* counts, so a send
  where every address hard-bounced still read "150 / 150". Relabelled **Accepted**; real delivery is a
  webhook fact and lives in the stats panel.
- **CSV export honours the search box** — it exported the whole list regardless of the filter.
- **Viewer accounts can open the Newsletter tab again.** Every read route required `edit`, so a Viewer
  got 403s swallowed by empty catch handlers and a tab stuck on "Loading…". Reads now accept `view`.

**The delivery stats under-counted by half, and a provider export showed why (TASK-305).** A real
send reported 95 delivered and 0 clicks; the provider's own export of the same 200 emails showed **182
arrived and 24 clicks**. Nothing was wrong with the sending — every one of the 200 went out, to 200
distinct people, with no duplicates. The reporting was wrong.

The cause is in the export's timestamps: `sent 09:00:15.013`, `delivered 09:00:15.483` — **under half
a second**. But the row recording *who we sent to* was written once per batch, at the end of a tick,
up to twenty seconds later. A confirmation arriving in that gap matched no send, was classed
`unmatched`, and the webhook answered **200** — which tells Svix the event was handled and not to
retry. It was then gone for good. Fast providers confirm quickest, so Gmail, Yahoo and Outlook were
precisely the ones being lost.

The fix: the send is now recorded **the instant it succeeds**, inside the loop, which closes the gap.

A second change was tried and **reverted in TASK-306**: answering **409** to a *recent* unmatched
event so Svix would retry it. It looked like cheap insurance and was not. A donation receipt raises a
delivery event that legitimately matches no newsletter, and a 409 would have had Svix retrying every
receipt, Gift Aid confirmation and login code for five minutes each — the exact retry storm the
original 200-to-everything existed to prevent. **An unmatched event still gets a 200.** The in-loop
write closes the race on its own; the retry only added risk. BDD caught it.

Note `newsletter_sends` is a plain `INSERT` with **no unique index**, so writing the same person
twice really does create two rows — the in-loop write tracks what it recorded and the end-of-batch
sweep is filtered by it. Adding the constraint properly needs a dedupe migration first.

**What actually arrived, per person (TASK-303).** The per-person view showed our queue row and
labelled it *Received* - but handing a message to the mail service is not the same as it arriving,
and the two come apart exactly when it matters: when the provider is refusing, when an address is
dead, or when a receiving server is holding mail back from a young sending domain. Each recipient
now carries two facts kept deliberately apart - what we did (sent / still to send / gave up) and
what the mailbox said (delivered / bounced / nothing yet). `src/newsletter/recipient-outcome.ts`
(pure) combines them, and **the mailbox wins**: a delivery event is first-hand evidence, while our
row only records what we handed over. Only *Arrived* means a mailbox confirmed it.

The same task fixed the headline: **Accepted** counted queue ROWS (`count(*)`), so a duplicated
record inflated it and a send looked bigger than the number of people it reached - while the event
counts beside it had always used `count(DISTINCT email)`. It counts people now.

**Background sending with a gentle rollout (TASK-274).** Sending is no longer a loop inside the HTTP
request. It is a **job with a queue**, one row per recipient, drained by a background worker.

*Why:* the old loop ran every recipient inside `POST /api/admin/newsletters/:id/send`, one sequential
call each, behind the ALB's 60-second default. A few hundred recipients outran it — the admin saw
**"Send failed" while the server was still sending** — and because the newsletter was flipped to
`sent` *before* the first email left, a timeout or task restart left it marked sent, partly delivered,
with no record of who had been reached and no way to resume. There was no pacing (the provider accepts
roughly 2/second) and no retry, so a burst simply lost people.

- **`newsletter_send_jobs` + `newsletter_send_queue`** — the per-recipient row is what buys
  resumability, retry (3 attempts, failures return to `pending`), honest progress, and the answer to
  *"who exactly received this?"* that the aggregate-only design could not give.
- **Two brakes** (`src/newsletter/send-pacing.ts`, pure and unit-tested): a **throttle** (`per_minute`,
  default 60 — comfortably under the provider's ceiling, spread *within* each tick so a claimed batch
  isn't fired in one millisecond) and a **daily cap**.
- **The gentle rollout** ramps that daily cap: **200 on day 1, then doubling** (400, 800, 1600…) to a
  5,000/day ceiling — about four days for a 2,000-person list. A lightly-used domain that suddenly
  emits thousands of messages looks like a compromised account and is treated as one; a modest first
  day that gets delivered and opened is the evidence that earns the next day's larger allowance.
  Offered as a checkbox at send time and recommended for a first big send.
- **A standing daily ceiling above all of it** — `NEWSLETTER_DAILY_SEND_CAP` (default **70**,
  TASK-302). This is not a limit on the newsletter so much as a **floor under everything else**: the
  mail provider's daily allowance is shared by donation receipts, Gift Aid confirmations, welcome
  emails and admin login codes, so a newsletter that spends the whole allowance does not merely delay
  itself — it silently costs a donor their receipt. The ceiling therefore beats every per-send
  option **including `dailyCap: 0`, which has always meant "uncapped" and is the default**; a
  ceiling that lost to the default would protect nothing. It is read fresh on every tick, so raising
  or lowering it reaches a send that is already running — no restart, no rescheduling.
- **"Not now" never costs a recipient their place (TASK-302).** A failed send goes back in the queue,
  but only three times; after that the recipient is marked failed and is never written to again. That
  is right for a dead mailbox and badly wrong for a capacity refusal — being told "you have used
  today's allowance" three times as their turn came around dropped a real person from the newsletter
  permanently and silently. `src/newsletter/send-failure.ts` (pure) classifies each failure as
  `defer` or `count`: a rate limit, a quota, a 503, or a connection that never landed refunds the
  attempt and ends the tick early (the next recipient would only meet the same wall); anything else,
  including anything **unrecognised**, counts — deferring never gives up, so an unknown fault has to
  fall on the side that eventually stops. Each tick also puts back anyone previously given up on for
  a deferrable reason, judged by that same classifier so there is one rule rather than two, and
  guarded on `status = 'failed'` so a sent recipient can never be resurrected into a second copy.
- **Pause, resume and stop** a send in flight — previously impossible: once the loop started, closing
  the browser did not stop the server.
- **Live progress** that survives a page reload, because the send is server-side. When the daily
  allowance is spent the panel says so and names tomorrow's allowance, rather than looking stuck.
- **Safe across ECS tasks:** the worker claims rows `FOR UPDATE SKIP LOCKED`, so each recipient goes to
  exactly one task. The worker starts in `src/index.ts` (not `createApp()`), so tests and BDD runs
  never start a timer that sends real email.
- `firstNameOf` moved to `src/newsletter/theme.ts` so the worker and the on-screen preview merge names
  by the same rule — two copies would drift, and the drift would show in real donor greetings.

**New endpoints:** `GET /api/admin/newsletters/:id/send-job` (progress),
`GET …/send-job/recipients` (who it reached, and who it didn't and why),
`POST …/send-job/:action` (`pause` | `resume` | `cancel`). The send endpoint now returns **202
queued** with a job id rather than blocking until every email has gone.

**Plain-text newsletters (TASK-275, letter G).** Every newsletter now carries a `text/plain`
alternative alongside the HTML. It went out HTML-only, which counts against a sender with spam
filters and leaves text-only clients, some screen readers and notification previews with nothing but
stripped markup — the thank-you letters have carried a text part for ages; the newsletter was the one
send that skipped it. The test-send carries it too, so a test is a test of the real thing.

`htmlToPlainText` (`src/newsletter/plain-text.ts`) derives it from the **rendered HTML**, not by
walking the block document: a per-block text renderer would need extending for every new block type,
and the day someone forgets is the day half the text part goes missing. Links keep their destination
(`Donate now (https://nbcc.scot/donate)`) so a reader who cannot click still has somewhere to go;
mailto/tel stay as their readable label; script/style/comments are dropped whole; and the whitespace a
table-based email produces is collapsed so the result reads as paragraphs.

**Welcome email on website signup (TASK-276, letter I).** Someone who signs up through the footer now
gets an immediate, branded welcome.

It is not only a courtesy — it is the **safeguard that makes one-step signup safe**. Joining is
immediate (no confirmation click, so nobody is lost to an unclicked email), and the welcome arrives at
once saying what happened, carrying the same one-click unsubscribe as every other send. Anyone added
by somebody else therefore finds out immediately and can leave in one press.

- **Never sent for an import.** `shouldSendWelcome` (`src/newsletter/welcome.ts`) is a predicate, not a
  convention: only `'footer'` qualifies. A volunteer importing a spreadsheet of several hundred people
  must not trigger several hundred unexpected emails — that is the "why am I getting this?" reaction
  that produces spam complaints, and complaints cost the sending domain far more than a welcome is
  worth. `'admin'` is excluded too: staff typing someone in are usually recording a conversation
  already had. Wiring the welcome into another path later would have to change that rule *and* the
  test pinning it.
- **Built as a block document** and rendered through the ordinary newsletter renderer, so the frame,
  footer and unsubscribe button come from the same place as everything else and a future brand change
  flows through automatically.
- **Best-effort and last**: the person is subscribed by the write before it, so a provider outage
  never fails their signup. Recorded in the audit log (`welcome.sent`) so "what have we sent this
  person?" stays answerable.

> **Double-send fix (TASK-276).** TASK-274's worker claimed queue rows with `FOR UPDATE SKIP LOCKED`,
> which hands a row to exactly one claimer *for the life of that transaction* — but the claim only
> bumped `attempts`, so the row was plain `pending` again after the commit. Between claiming and
> marking sent, a second tick could take the same row and **email that person twice**. Reachable in
> normal operation: the send route fires a tick immediately (so a send starts at once) while the
> interval worker is also running, and production may run more than one ECS task. Claiming now moves
> the row to **`sending`** in the same statement, making the claim durable past the commit; progress
> and drain treat an in-flight row as still outstanding, so a gentle rollout cannot finish early; and
> rows stranded by a task killed mid-batch are swept back to `pending` after a grace period, so
> closing a duplicate-send hole does not open a lost-recipient one.

**Pre-send safety (TASK-277 — letters P, R, S).** Three changes aimed squarely at making a *first*
mass send safe.

- **Pre-send checks (P).** `preflightNewsletter` (`src/newsletter/preflight.ts`, pure) runs against the
  CURRENT draft when the send confirmation opens — the mistakes that are obvious in hindsight and
  invisible while writing. **Blocking:** empty content or subject, a button with no working link (the
  renderer silently drops an empty href, so it never looks wrong in the preview either), and a merge
  tag we don't understand (`{{firstname}}` is NOT substituted — it reaches every reader as literal
  text). **Warnings:** images with no description (many inboxes block images by default, so that
  reader sees nothing), and not having sent yourself a test copy. A blocking finding requires an
  explicit "send anyway" tick rather than refusing outright — it is the charity's newsletter, and a
  tool that flatly blocks invites people to work around it.
- **Repeat-bounce suppression (R).** A *permanent* bounce suppresses on its own (TASK-272); a transient
  one still does not, because a full mailbox is temporary and dropping a real supporter over it is its
  own failure. But an address that has bounced **three times** is dead in practice whatever the
  provider calls it, so repetition now suppresses.
- **Seed test (S).** `POST /api/admin/newsletters/test-send` accepts an optional `to` list (max 5) so
  you can send to your own Gmail, Outlook and Yahoo addresses before committing to the real audience.
  Where a message *lands* is decided per provider, and one inbox cannot tell you. Defaults to the
  signed-in admin, so the existing one-click test is unchanged.

**Full audit trail (TASK-278 — letters M and N).** Answers the questions the admin could not: who sent
this, who got it, and who added this person.

- **Who sent it (M).** `sent_by` has been stamped at send time since the atomic claim landed, but was
  never selected back — so the history could not say who pressed the button. Now joined and shown as a
  **Sent by** column.
- **Who got it (M).** `newsletter_send_queue` has held the per-recipient record since TASK-274, and
  nothing read it back: "did Margaret get it?" was unanswerable despite the answer being on file. A
  **Who got it** action on any sent newsletter now lists every address with its outcome, the time, and
  the provider's reason where it failed. Older sends predating the queue show totals only, and say so.
- **Who added this person (N).** `list_subscribers.added_by` records the staff member behind a manual
  add or an import; NULL for a self-signup, where the person themselves is the actor. The member table
  now shows **Added / How / By**. A revive re-stamps it, so the record follows the latest consent
  rather than the original. Nullable by design: memberships predating this show "not recorded" rather
  than inventing an actor for historic rows.

**Email authentication hardening (TASK-273).** Two DNS gaps found by checking the live records:

- **No SPF on the apex.** `nbcc.scot` published only a Google site-verification TXT, so nothing
  contradicted anyone sending mail as `@nbcc.scot`. The apex TXT set now also carries
  `v=spf1 include:_spf.google.com ~all`. It must include Google because the apex MX is
  `smtp.google.com` — staff mail is Google Workspace, and an SPF record omitting it would start
  failing every real email a human sends from the domain. SES is deliberately absent: its envelope
  sender lives on its own bounce subdomain with its own SPF record, and `include:amazonses.com` at
  the apex would authorise every Amazon SES customer to send as NBCC.
- **DMARC reported nothing.** The record was `p=none;` with no `rua`, so it neither protected the
  domain nor told anyone what was happening — it met the letter of the Gmail/Yahoo bulk-sender rule
  and delivered none of the value. Now `v=DMARC1; p=none; rua=mailto:newsletter@nbcc.scot; fo=1;`.
  ⚠️ **Manual step:** `newsletter@nbcc.scot` is the reporting mailbox (an existing, real mailbox)
  or the reports bounce.
  **Intended path once a few weeks of reports look clean:**
  `p=none` → `p=quarantine; pct=25` → `p=quarantine` → `p=reject`. Do not skip to reject blind: it
  risks silently binning legitimate mail from a platform nobody remembered was sending for the charity.

> **Since done:** the dedicated `news.nbcc.scot` sending subdomain shipped in TASK-296/298/299, and
> click tracking is now part of the SES newsletter configuration set (Resend→SES migration). Volume
> warm-up still applies to any new sending domain or provider switch.

**Newsletter tab flow (TASK-279).** The tab was one continuous ~19,000-character scroll: reaching the
composer meant scrolling past all the audience and people management every time, three full-width
collapsible bars sat stacked in the middle of it, and the Send controls were below the template
library. Staff reported it as "all over the place and hard to navigate".

The four stages are now **switchable panels** with a step nav (Audiences & people / Write / Send /
Sent), so one job is on screen at a time and the rest are one click away. Opening a newsletter from
the history jumps to **Write**; starting a send jumps to **Send**, where the progress bar lives.
Measured effect: the tab is **55% shorter** (2635px to 1190px) with no horizontal overflow.

**Nothing was removed and no element id changed** — `app.js` binds by id, so the change is purely
wrapping existing content in panel containers plus CSS. Verified mechanically: all 88 pre-existing ids
still present (5 new panel ids added), all 42 controls `app.js` binds to still reachable inside a
panel, and the composer (`.nl-builder`) untouched. Secondary tools (Manage subscribers, Blocked
addresses, Archived audiences) are grouped into a compact grid rather than stacked full-width; an open
one spans the full row so its table has room.

**Scheduled sends (TASK-280, letter J).** A newsletter can now be given a time to go out. Volunteers
write when they have time — an evening, a weekend — but a newsletter lands best on a weekday morning;
until now the options were "send now" or "remember to come back and press it yourself".

Deliberately small, because TASK-274 already built the machinery: sending is a background job a worker
picks up, so scheduling is **not a new mechanism** — just an instruction not to pick this one up yet.
`listRunnableJobs` skips a job whose `scheduled_at` is still in the future, and `NULL` means "start
now", so every existing job and every unscheduled send behaves exactly as before.

- **Rules are pure and shared** (`src/newsletter/schedule.ts`), so the API and UI cannot disagree about
  what is valid. A time in the **past is refused** rather than sending instantly (the opposite of what
  reaching for "schedule" means), and anything more than **180 days out** is refused because a mistyped
  year would otherwise silently park a newsletter for twelve months with no other symptom. A minute of
  grace either side of *now* absorbs clock skew between browser and server.
- **Time zones:** `<input type="datetime-local">` gives local wall-clock with no zone, so the browser
  converts to a real instant before sending. 9am means 9am where the sender is, not 9am UTC.
- **A send-time hint, honestly framed.** Next to the field: charity newsletters generally do best
  Tuesday to Thursday, 9-11am, plus two quick-pick buttons. Deliberately worded as *general guidance,
  not based on your readers* — with open tracking off and no send history there is nothing to
  personalise from, and presenting a rule of thumb as a "recommended time" would imply knowledge the
  system does not have. Once real click data exists, that is what should drive it.
- **While waiting** the progress panel names the time and says it can still be cancelled — "pending"
  invites someone to assume it is stuck and press send a second time. Cancel/pause work as before.

**Where the newsletter platform stands** is kept in `docs/NEWSLETTER-STATUS.md` — what is live, what
was deliberately not built and why, and the gotchas (migration ordering, squash-merge rebases, the
`donate.html` page-weight ceiling) that have already cost a round trip each. Read it before picking
the newsletter work back up.

**Newsletter Studio (TASK-283).** TASK-279 turned the tab into four switchable panels instead of one
19,000-character scroll. That fixed the scrolling but left the real problem: **one four-step rail was
doing two unrelated jobs.** "Audiences & people" sat at step 1, which reads as *do this every time* —
you don't, it is reference work. "Sent" sat at step 4, which frames the history as the end of
writing, when it is the thing you actually want to land on. And results were split in two: per-send
stats were buried inside the Write panel and only appeared for an already-sent newsletter, while the
history table lived elsewhere, so answering *where did it land* meant visiting both.

Now **three destinations, and composing is a takeover**:

| | |
|---|---|
| **Overview** | The front door. Reach, sends this year, typical delivery, blocked count; recent sends with their outcomes inline; what is in flight; what is worth a look. |
| **Audiences & people** | Reference work — audiences, members, import, blocked addresses, re-consent, archive. A place you visit, not a step you pass through. |
| **All newsletters** | Drafts, scheduled and sent, with a row click through to the full record. |
| **Compose** *(takeover)* | Write → Who → Send, with the actions pinned to the bottom bar. |

- **Composing takes over the screen.** Every real mailing platform does this, and it is what makes the
  flow feel quick: `app.js` puts `.is-composing` on the section, which hides the destination rail and
  the page heading. One job on screen, three steps at the top, actions at the bottom where your hands
  already are.
- **Choosing WHO is its own step.** It used to share a panel with the Send button, which made the most
  consequential decision in the flow look like a dropdown you pass on the way. The reach panel shows
  its **working** — on the audience, minus blocked — so the number on the confirmation is never a
  surprise.
- **Outcomes are on the list, not only behind a stats call.** `listNewsletters` gained a single
  aggregate join over `newsletter_email_events` giving `deliveredCount` / `clickedCount` for every
  newsletter at once. `count(DISTINCT email)` matches `getNewsletterStats` exactly, so the list and
  the detail can never disagree, and both are **null, never 0**, when nothing is known — a send
  predating event tracking must show an em dash, not a confident zero reading as "nobody got it".
- **A rate is drawn as well as counted.** A column of bare percentages makes you read every row to
  find the odd one out, so each is a small bar banded green / amber / red. Semantic colour, separate
  from the brand accent.
- **The element contract is pinned as data.** `app.js` binds by element **id** and fails *silently*
  when one goes missing — no build error, no test failure, just a control that quietly stops working.
  That is the biggest risk in a restructure this size, so `test/unit/newsletter-studio-ui.test.ts`
  asserts all **97** ids the tab had beforehand still exist, and that none is used twice. Elements may
  move, be re-parented, wrapped, restyled or hidden; they may not be renamed or deleted. The list is
  generated from the markup, not typed by hand — typing it produced a phantom id that the test caught.

**Multi-audience tick lists (TASK-283, UI for TASK-282).** `#amList` and `#importListPick` became tick
lists. Both hidden `<select>`s stay in the DOM as a mirror of the first ticked audience, so any path
still reading them keeps working.

- **Donors is shown but not tickable**, with the reason on the row. The dropdown simply omitted it,
  which is fine in a dropdown — a tick list reads as *here are all your audiences*, so a silent gap
  looks like a bug.
- **Nothing ticked is a refusal.** The legacy select is only consulted when the tick list never
  rendered at all. Consulting it when the list *did* render and nothing was ticked would send the
  person to whatever the hidden select happened to default to — the silent-wrong-destination bug this
  screen exists to prevent. A jsdom test pins it.
- **Changing the ticks invalidates an import preview.** A preview belongs to the audiences it was
  taken against; this is the multi-audience form of the TASK-271 bug where a sheet checked against one
  audience could be committed into another, and it is worse here because one wrong tick lands dozens
  of people somewhere they never agreed to be. The commit re-checks the ids rather than trusting the
  UI to have kept up.
- **A resubscribe is said out loud.** "Emails switched back on for X — they had opted out" is never
  folded into a routine-looking "Added."

**Studio parity (TASK-285).** TASK-283 built the shell and TASK-284 the panel interiors; this closes
the last three gaps against the approved prototype, and fixes something worse than a gap — **five
elements shipped as markup with nothing driving them**. The in-flight strip, the compose subject echo
and the saved indicator rendered as empty boxes forever, and no test noticed, because "the id exists"
was all anything checked.

- **The audience is chosen from cards, not a dropdown.** Who a newsletter goes to is the most
  consequential decision in the flow, and a `<select>` made it look like a formality you pass on the
  way to the Send button — you also could not see what each audience *meant* or how big it was
  without opening it. `#sendListPick` stays as the hidden mirror of the chosen card and dispatches a
  real `change`, so the send request, the confirmation and `sendAudienceNote` are untouched.
- **The pre-send checks are shown, not just enforced.** `/preflight` already existed, but only ran
  inside the send confirmation, where it could do nothing except stop you at the last moment. On the
  panel it becomes something you can act on while there is still time. Blocking findings sort above
  warnings, and *nothing wrong* is itself stated — a silent empty list reads as "the checks did not
  run", which is the opposite of the reassurance the panel exists to give.
- **"When" is two explicit choices.** It was "fill in a date, or press the button that clears it";
  empty-means-now was invisible, with nothing on screen saying which you had picked. Choosing *now*
  clears the field, so the control and the summary can never disagree.
- **Where it landed is its own destination** (`#nlPanelResults`). One click from any sent row opens
  the whole record — accepted, delivered, clicked, bounced, unsubscribed, what people clicked, and
  who sent it. The recipient list is one click further in, where it belongs: it is the detail behind
  the summary, not the summary.
- **`GET /api/admin/newsletters/send-jobs/inflight`** (Viewer+) backs the overview strip.
  `listInflightJobs` is deliberately **not** `listRunnableJobs`: that one answers *what should the
  worker pick up now?* and so excludes both paused and future-scheduled jobs. This one answers *what
  has the volunteer got going on?* — where a send paused at 40% and a send scheduled for Tuesday are
  exactly the two things they most need reminding about. Literal path, so it is registered **before**
  `/:id/...` or `send-jobs` is captured as an id.
- **A test for dead markup.** `newsletter-studio-ui.test.ts` now lists every container the tab is
  supposed to *fill* and asserts `app.js` references each one. An element that exists but is never
  written to is not a feature, it is a gap that looks like one. Verified by mutation: renaming a
  single reference turns the suite red with the right message.

**Layout fixes (TASK-286).** Four faults, all from the same root cause: the Studio was designed
against the wrong width. The real content column is **~1006px** — 1280px max-width minus the 210px
nav and padding — and the Overview's main column only ~620px of that. The CSS harness was rendering
full-bleed, so every measurement taken during TASK-283–285 was a lie.

- **Recent sends fits its card.** Four columns needed ~750px in a ~620px column, so the table scrolled
  sideways inside a box that looked like a finished table — and the scrollbar covered the last column.
  The audience moved into the meta line, where it reads better anyway: *"15 July · jon@nbcc.scot ·
  Newsletter"* is one fact about the send, not a column you scan. `table-layout: fixed` with the
  subject ellipsised, so a very long name can never bring the scrollbar back.
- **The tick lists run side to side.** They were stacking in a 303px column: the fieldset is a flex
  item inside `.nl-subscriber-form`, and the `grid-column: 1 / -1` it carried does nothing in a flex
  container. Now a full row that wraps horizontally, with the "Add to" label above rather than
  floating beside a tall column. Donors takes a full row of its own — it is explanatory, not
  choosable, so it should not compete for width with the audiences you can actually tick.
- **Both compose bars are inset.** They ran edge to edge with **no horizontal padding**, so "Close"
  and the footer hint sat flush against the border and the sticky bar had nothing separating it from
  content sliding underneath. Now padded, rounded and shadowed to match the cards, so they read as
  chrome floating over the page. The compose title is clamped to one line: a sticky bar that grows as
  you type shifts everything under it.
- **`min-width: 0` on every grid child.** A grid or flex item defaults to `min-width: auto`, so its
  widest child can force the column wider than the viewport. The preview iframe is a fixed 660px
  until `nlFitPreview` zooms it — and that deliberately bails while the panel is hidden — so on a
  phone the whole admin page could end up scrolling sideways. Verified fixed at 375px.

**The harness now mirrors the real shell** (210px nav column inside the 1280px grid). Measuring
against a full-width page is what produced these four faults in the first place.

**Fit and the blank tab (TASK-287).**

**The tab opened completely blank.** Every panel starts hidden and `app.js` reveals one — except
`nlPanelWrite`, which was the single panel left un-hidden in the markup. That made `nlLivePanel()`
report `"nlPanelWrite"` on first open, so the guard meant to land you on the Overview never fired;
and because `nlPanelWrite` lives inside `.nl-compose` (`display: none` until composing), *nothing at
all* was on screen. The markup no longer picks a winner — `app.js` decides — and a test pins the
invariant, verified by mutation.

**Every table now fits its card.** The shared `.admin-table` sets `white-space: nowrap` on every
cell, so a table grows to its longest email address and the card scrolls sideways with the last
column pushed off the edge. Fixed by carrying fewer columns rather than by hiding the scrollbar:

| Table | Was | Now |
|---|---|---|
| Recent sends | 4 columns | 3 — audience folded into the meta line |
| People on an audience | 7 columns | **3** — Person · Added · Remove |
| All newsletters | 7 columns | **4** — Newsletter · Status · Accepted · actions |

Nothing was dropped. The same facts are grouped as the two questions people actually ask — *who is
this?* and *how did they get here?* — instead of seven columns nobody can read at once. Inside the
newsletter panels cells wrap rather than refuse to, and the tables are fixed-layout so the columns
are shared out rather than fought over.

**Text no longer sits in the card's rounded corner.** The wrap has a 16px radius and the first cell
had 14px of padding, so a long name ran straight into the curve. Now 19px of clearance.

**"Add a person" and "Import a spreadsheet" sit side by side**, as the prototype has them. Stacked
full-width they read as a long form to work down; beside each other they read as a choice: one
person, or a spreadsheet. "Someone asked us to email them again" moved below the pair — it is a rare,
deliberate action and was wedged between the two things that belong together.

**One newsletter, several audiences (TASK-288).** The Who step is multi-select. Pick Volunteers *and*
Donors and both get it — in one send, from one draft.

- **The rule that matters is deduplication.** Somebody on two chosen audiences gets **one** email.
  Sending twice is the fastest way to be marked as spam, and the person who reports it is one of your
  most engaged supporters. The fold lives in `src/newsletter/merge-recipients.ts` — pure and DB-free,
  so the rule is pinned by tests that need no database, plus a BDD scenario that proves it end to end.
- **When the same address appears twice, the better-informed record wins.** A donor row carries the
  donor id the unsubscribe token is built from and usually the full name; letting a bare subscriber
  row overwrite it would cost the greeting and the correct unsubscribe link.
- **The count comes from the server, never from adding the audiences up.** A sum would promise more
  people than will be mailed. The reach panel shows the union *and* the overlap — "on more than one"
  is exactly the number who would otherwise have been mailed twice — and the confirmation repeats the
  same figure from the same endpoint.
- **The confirmation names every audience.** Saying "Volunteers" when it is going to Volunteers and
  Donors would make the one check standing between a draft and several hundred inboxes actively
  misleading.
- **Expand-only migration.** `newsletters.list_ids int[]`, nullable. `list_id` is untouched and still
  holds the first audience, so the history join, the stats panel and `listNewsletters` all work
  unchanged on old and new rows alike. Dropping `list_id` belongs in a later release, once nothing
  reads it.
- `listId` is still accepted on the send and preview endpoints; `listIds` is the richer form.

**Collapsible blocks (TASK-289).** A ten-block newsletter was ten fully expanded forms, so finding
the one you wanted meant scrolling past every field of every other one. Blocks now collapse.

- **Opening a newsletter starts everything collapsed.** You are orienting, not editing — and the
  scrolling was the complaint. Adding a block leaves it open, because you are about to fill it in.
  **Collapse all** / **Expand all** sit above the canvas with the block count.
- **A collapsed block still says what it holds** — the first real text in its data, so a Text block
  shows its opening words and a Button shows its label. A stack of identical "Text" bars you have to
  open one by one would be worse than the scrolling it replaced.
- **Collapsed state is keyed by the block object, not its index** (`WeakMap`). `nlRenderCanvas`
  rebuilds everything on every change, so an index-keyed set would follow the *position*: moving the
  open block up would leave it shut and open whatever landed in its place. Pinned by a test, verified
  by mutation — swapping the WeakMap for `indexOf` turns it red. The WeakMap also keeps the key off
  the block itself, so nothing extra is ever saved.
- **The builder itself is untouched.** The DOM is unchanged; CSS hides everything after the head when
  a block carries `.is-collapsed`. The 49 existing builder tests stay green.

**Email preferences, and private vs public audiences (TASK-291).** Unsubscribing was all-or-nothing
in whichever direction the link happened to point: a subscriber link left one list, a donor link
stopped *everything*. Now a person can choose.

- **Clicking unsubscribe still unsubscribes, immediately.** The preference centre is reached *from*
  the confirmation — it is what you can do next, never a gate in front of leaving. RFC 8058 one-click
  (which Gmail and Apple Mail fire automatically) is untouched and still instant. "Stop all emails"
  is its own submit button, so the way out stays one click; a preference centre that makes leaving
  harder than it was is a dark pattern and a PECR problem. Since TASK-507 it also records the address
  on `email_opt_outs` (and turning thank yous off does too; turning them on lifts it), which a
  fundraiser's thank you to its givers respects: see **Thank your supporters (TASK-507)**.
- **Donor consent is split.** `email_consent` keeps its exact meaning for the newsletter;
  `thankyou_consent` (new) gates thank-you letters, so a donor can stop one and keep the other. The
  migration backfills `thankyou_consent = email_consent` rather than defaulting everyone to true —
  someone who had opted out of everything must not start receiving thank-you letters again because
  we split a column.
- **An audience is private or public** (`subscriber_lists.visibility`, default **private**). Private
  means staff add people to it and nobody outside ever learns it exists; public means people may opt
  in themselves from the preferences page. The admin picker shows a padlock or a globe, with the word
  beside it — the symbol reinforces, it never carries the meaning alone. Only *manual* audiences can
  be flipped: Newsletter is publicly joinable by definition (the website footer) and Donors follows
  donor consent, so offering to change either would record a promise the code does not keep.
- **The disclosure rule is the point of the feature.** An unsubscribe link travels by email and gets
  forwarded, so anyone holding the message holds the token. The page shows only the lists that
  address is genuinely on, plus **public** lists it is not on. A private list never reaches the page
  at all — not greyed out, not mentioned, because a greyed-out row still says the list exists.
  Enforced in `src/newsletter/preferences.ts` (pure, DB-free, 16 tests) and proved end to end by a
  BDD scenario that fails if the response body so much as contains a private audience's name.
- **A submission may only act on what the page offered.** A membership id the person does not hold is
  ignored rather than obeyed, and a join naming a list that was not offered is dropped — otherwise
  the page becomes a way to unsubscribe other people or add yourself to audiences you were never
  meant to see.

**What a reader with no name sees (TASK-292).** `{{firstName}}` used to fall back to the hardcoded
word **"friend"**, so `Hey, {{firstName}}! It's the NBCC Newsletter` arrived as
`Hey, friend! It's the NBCC Newsletter` whether that suited the message or not. Two settings replace
it, because the two places need different answers:

| Setting | Where | Blank means |
|---|---|---|
| `nameFallback` | the subject line, and body copy | **remove the name and tidy the punctuation** — `Hey, {{firstName}}!` becomes `Hey!` |
| `greetingFallback` | the greeting block's "Dear …," | fall back to a word — `Dear,` is not a salutation |

- **The tidying is small and predictable** (`src/newsletter/name-fallback.ts`, pure and DB-free, 14
  tests): drop the tag, remove a comma left dangling in front of punctuation, collapse the doubled
  space, fix the capital if the name opened the line. It does **not** rewrite grammar — `A gift for
  {{firstName}}` becomes `A gift for`, which is why the field's hint says to put a word in when the
  sentence needs one.
- **`firstNameOf` now returns `""`** for a nameless person instead of `"friend"`, so the *caller*
  decides what a missing name becomes. Returning the word itself is exactly why it could never be
  changed.
- **Both settings live on the block document**, so they save with the newsletter, travel to the send
  worker and the live preview through the same `renderNewsletter`, and need no migration. Optional,
  so every newsletter written before this renders unchanged; absent entirely when neither is set,
  rather than storing an empty object that implies a choice nobody made.
- **The hint explains the rule rather than re-implementing it.** A browser copy of the merge logic
  would be a second version of the thing that decides what actually goes out, free to drift from the
  one that does.

**Registered postal address everywhere (TASK-293).** Microsoft and the other large filters look for a
real postal address in bulk email; its absence is a small but real spam signal, and every legitimate
charity newsletter carries one. **The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank,
KA6 5EE** now appears in the site footer on all 11 pages, in the newsletter frame (so the live
preview and every send carry it), in the thank-you letter, and in the donation receipt and
confirmation emails.

- **One source of truth.** It lives in `src/legal/registration.ts` beside the charity number, so the
  footer, the newsletter and the letters cannot drift apart.
- **The building is written one way: The Elves' Workshop.** Plural, apostrophe after the s, and a
  straight apostrophe (not a curly one, not an HTML entity), because `contact-address.test.ts` holds
  `contact.html` to the constant letter for letter. In the middle of a sentence it is "the Elves'
  Workshop". The thank-you letterhead, the sponsor form, the envelopes, the welcome pack and the
  disclosure all read the address from `src/legal/registration.ts` now, where some used to keep
  their own copy with a different spelling. `test/unit/elves-workshop-name.test.ts` reads every
  top-level page and everything under `src/` and fails on any other spelling.
- **`FOOTER_TEXT` / `FOOTER_HTML` are new, and `REGISTRATION_TEXT` / `REGISTRATION_HTML` are
  unchanged.** The footer block is registration *plus* address; the registration constants keep
  meaning the mandated statement alone. A constant called `REGISTRATION_TEXT` that quietly contained
  an address would be a name that lies, and the next person reusing it would carry the address
  somewhere it does not belong.
- The plain-text parts get a real newline, not a `<br />` — worth stating because the first pass got
  that wrong.

**DMARC tightened to quarantine at 25% (TASK-294).** A real send reached Hotmail's junk folder, and
Microsoft weighs DMARC policy strength — `p=none` is the weakest possible signal, and a domain that
never asserts anything about forgery gets treated as one.

Both senders were **checked** to authenticate *and* align before changing it, so neither is affected:

| Sender | SPF | DKIM |
|---|---|---|
| Amazon SES (newsletters, receipts) | envelope on `bounce.nbcc.scot` / `bounce.news.nbcc.scot` → `include:amazonses.com` | Easy-DKIM CNAMEs sign `d=nbcc.scot` / `d=news.nbcc.scot` |
| Google Workspace (staff mail) | apex → `include:_spf.google.com` | `google._domainkey` present |

The policy only ever acts on mail that **fails**. Genuine mail passes and is untouched.

`pct=25` is a hedge against the one thing that can't be verified from the repo: the aggregate reports
go to a mailbox this codebase can't read, so if some forgotten sender does exist, three quarters of
its mail still lands while the reports surface it. Next steps on the documented path are
`p=quarantine` (full) then `p=reject`, once the reports are clean.

**Click-tracking on our own domain (TASK-295; provider-agnostic principle).** The provider rewrites
every link in a newsletter so clicks can be counted. By default those rewritten links point at the
provider's **shared** tracking domain — so an email that says it is from `nbcc.scot` carries links to
somewhere else entirely. That is the shape of a phishing message, and it is very likely part of why a
real send reached Hotmail's junk folder.

A tracking domain on our own subdomain makes the rewritten links match the sender. Since TASK-466
that is `click.news.nbcc.scot`, in front of SES's `r.eu-west-2.awstrack.me`, configured on the SES
newsletter configuration set; the apex tracker is gone because transactional mail no longer carries
click tracking at all. Same click data, nothing suspicious. It is CloudFront holding the domain's own
certificate, not a bare CNAME to the tracker: the links are https, and the bare CNAME that
`links.news` was served SES's certificate for our name, so every link failed with a security warning.

**Open tracking stays off.** It works by embedding an invisible image, which Apple Mail and Gmail
pre-load — so the numbers lie — and some filters read a tracking pixel as a negative signal. Clicks
are the honest measure: somebody actually pressed something.

**A dedicated newsletter sending domain (TASK-296).** Newsletters sent from the apex, `nbcc.scot` —
the same domain as donation receipts, Gift Aid declarations and admin login codes. One campaign that
upsets a spam filter could therefore damage the deliverability of mail people actually *need* to
receive.

`news.nbcc.scot` gives the newsletter its own reputation to build, and its own to lose. All records
sit inside the existing hosted zone — no delegation, no new zone, nothing about the apex changes.
Since the Resend→SES migration they are (see `infra/modules/app/ses.tf`):

| Name | Type | Purpose |
|---|---|---|
| `<token>._domainkey.news` ×3 | CNAME | Easy DKIM — **its own keys**, distinct from the apex |
| `bounce.news` | MX | MAIL FROM / Return-Path: bounce and complaint feedback |
| `bounce.news` | TXT | SPF (`include:amazonses.com`) |
| `click.news` | A + AAAA alias | click tracking → CloudFront (its own certificate) → `r.eu-west-2.awstrack.me` (TASK-466) |
| `links.news` | CNAME | the old click-tracking address, kept for the links in newsletters sent before TASK-466 → `r.eu-west-2.awstrack.me` (its https does not work; see TASK-466) |

DMARC is inherited from the apex policy (there is no `sp=` tag), so the tightened `p=quarantine`
covers this subdomain too without a second record.

Switching `NEWSLETTER_FROM_EMAIL` over was a **separate** change (TASK-298), made only once the
provider reported the domain verified — flipping the from-address before the DNS resolved would have
sent unauthenticated mail, the exact opposite of the point. That change also had to split Reply-To
out into `NEWSLETTER_REPLY_TO_EMAIL`, because this subdomain has no MX at its root and cannot
receive a reply.

**Click tracking is configured per configuration set in SES** and only the newsletter set carries
it; the From address and the rewritten link domain share the `news.` subdomain exactly — the tighter
alignment. Open tracking stays OFF (it embeds an invisible image, which Apple Mail and Gmail
pre-load, so the numbers lie, and some filters read it as a negative signal). Clicks are the honest
measure.

**The Resend→SES migration (2026-08-31).** Every outbound email — newsletters, donation
confirmations, Gift Aid declarations, receipts, refunds, portal/admin links, 2FA codes,
lapsed-subscription notices, thank-you letters, business-supporter mails, Festive Ball emails — now
goes **straight from the app to the Amazon SESv2 API**, and delivery facts come back from SES. The
Cloudflare Worker relay (`services/email-relay/`) and the Resend account are gone entirely.

- **Sending** (`src/clients/ses.ts` + `src/clients/ses-request.ts`): a dependency-free SigV4 signer
  (`src/clients/aws-sigv4.ts`, pinned to AWS's published signing vector — no `@aws-sdk`, because
  the npm registry is blocked on the owner's machine and a new runtime dep would break local dev),
  authenticated by the **ECS task role** (`ses:SendEmail` scoped to the two identities +
  configuration sets). No provider API key exists anywhere.
- **Templates** (`src/email/templates.ts`): the relay's branded shell + per-kind bodies, ported
  verbatim into the app (see the TASK-209 section — same shell, same subjects), pinned by
  `test/unit/email-templates.test.ts`. Templates now ship in the app image: no second deploy, no
  skew window.
- **Delivery events**: SES configuration sets publish to an SNS topic which POSTs to
  **`POST /api/webhooks/ses/:token`** (`src/routes/ses-webhook.ts`). The path token — minted by
  Terraform, held as the SSM `SES_WEBHOOK_TOKEN` SecureString, embedded in the SNS subscription
  URL — is the trust boundary (the role the Svix signing secret played). The route auto-confirms
  the SNS subscription (only for genuine `https://sns.<region>.amazonaws.com` URLs — SSRF-pinned in
  `parseSnsEnvelope`), maps `Delivery`/`Bounce`/`Complaint`/`Click` onto the existing
  `newsletter_email_events` store (`recordEmailEvent`; the `svix_event_id` column keeps its
  historical name and now carries the SNS `MessageId` — same idempotency role, no destructive
  rename), and applies the same suppression rules (complaint always; Permanent bounce; 3 repeat
  bounces). Pinned by `test/unit/ses-webhook.test.ts` + the rewritten webhook scenarios in
  `features/newsletter.feature`.
- **Two configuration sets** (`infra/modules/app/ses.tf`): `…-newsletter` (click tracking on
  `click.news.nbcc.scot` since TASK-466, HTTPS required) and `…-transactional` (no tracking, no link
  rewriting) —
  a receipt must never carry newsletter-tracker links.
- **Config**: `EMAIL_PROVIDER` (`stub`/`ses`) replaces the `.example`-URL stub seam;
  `RESEND_WEBHOOK_SECRET`, `EMAIL_SEND_URL` and `CONTACT_FORWARD_URL` are removed everywhere
  (schema, `.env.example`, `pr.yml`, SSM, task-def, IAM). The dead contact-forwarding client went
  with them. See **Email keys** under **Configuration**.
- **DNS** (`ses.tf` + `dns.tf`): Easy-DKIM CNAMEs ×3 per identity, `bounce.`/`bounce.news.` MAIL
  FROM MX+SPF, `links.news` → `r.eu-west-2.awstrack.me` (superseded by `click.news` through CloudFront
  in TASK-466); every `resend._domainkey`/`send.*` record removed. Root SPF and DMARC values are
  untouched.

⚠️ **Cutover order matters** (sandbox → production): (1) `infra.yml` plan + apply — creates the
identities, DNS, configuration sets, SNS topic/subscription and token; DKIM verifies itself in
minutes once the records exist. (2) In the SES console, **request production access** (the account
starts sandboxed: verified recipients only, 200/day) — cite the charity (SC047995), opt-in lists,
the suppression + one-click-unsubscribe machinery. (3) Only then merge/deploy the app change that
sends via SES — merging earlier leaves production trying to send through an unverified identity.
(4) First campaign after the switch: use the gentle rollout — SES's shared IPs are a new
neighbourhood even though the domain reputation carries. `NEWSLETTER_DAILY_SEND_CAP` (70) guarded a
100/day provider pot that no longer exists; raise it once the SES sending quota (visible in the
console) is confirmed comfortably above campaign size.

**Email audit page (email-audit feature, 2026-09-01).** A new admin view — **Email audit**, under
Governance — listing every email the system has TRIED to send, newest first, with its outcome:
sent, failed (with the reason), and what the mailbox side reported back (delivered / bounced /
marked as spam). Recent failures (14 days) are pinned in a red band at the top. One search box
covers recipient, name and subject; dropdowns filter by kind and status; paginated 50/page.

- **Recording** (`src/db/email-log.ts` + the `email_log` migration): every send in
  `src/clients/email.ts` funnels through one `sendAndLog` seam that writes a **metadata-only** row
  — kind, recipient, name, subject, sent/failed + truncated error; **never a body** (bodies carry
  one-time links and 2FA codes). Best-effort by contract: a bookkeeping failure can never fail the
  send. Stubbed (dev/CI) sends log too, so the page is exercised end to end offline. History
  starts at this feature's deploy — nothing recorded per-send existed before it.
- **Delivery truth**: the SES webhook (`src/routes/ses-webhook.ts`) stamps
  delivered/bounced/complained onto the newest matching un-stamped row — the same windowed,
  per-address correlation the newsletter stats use — so "sent" and "arrived" are never conflated.
- **Access is its own permission**: a new `email-audit` section in the matrix that NO role below
  admin carries (viewer's view-everywhere default and editor's operational defaults both exclude
  it — the page shows donor-identifying send data). Admins — today exactly the two
  commissioners — hold it by role and grant it per person via the Team → Manage access matrix.
- **Retention**: rows are pruned **six years after the end of the UK tax year they were sent in**
  (`src/email/log-retention.ts`, reusing `endOfUkTaxYear` — HMRC's Gift Aid record window),
  by the existing daily reminders task. `eraseEmailLogFor(email)` ships alongside for the day a
  donor-erasure flow lands; nothing calls it yet, by design.
- Covered by `test/unit/email-log.test.ts` (SQL contracts, correlation, prune cutoff, erasure),
  the extended `admin-permissions` tests (role defaults), and `features/email-audit.feature`
  (a real send appearing in the list, a failure in the red band, search + type filter, and the
  editor-gets-403 gate).

**Site addressing: branded 404, /sitemap, sitemap.xml, spare addresses (site-pages feature,
2026-09-01).** Four related pieces, one page registry (`src/site/pages.ts`) behind all of them:

- **Branded 404.** Unknown addresses used to get Express's bare "Cannot GET". The site router
  now ends in a catch-all (`src/routes/site.ts`): GET/HEAD misses first consult the
  spare-address table, then serve `404.html` — branded, warm copy, home/donate/contact buttons —
  with a REAL 404 status and noindex. Unknown `/api/*` paths get a JSON 404, never HTML.
- **Spare addresses (aliases), admin-managed.** `site_aliases` maps a spare path to its
  canonical page as a **301** (one address per page, search-safe). Seeded day one: `/about`,
  `/mystory`, `/contact-us`, `/donations`, `/give`, `/portal`, `/privacy-policy`, `/supporter`,
  `/story`, `/stories`. Managed live in the new **Site pages** admin view; validation refuses a
  spare address that would shadow a real page or system route (`aliasFromProblem`).
- **`/sitemap`.** A branded, server-rendered tree of every public page (the `/supporters`
  pattern over `sitemap.html`), deliberately unlisted: nothing links to it, and it carries
  noindex in both the file and an `X-Robots-Tag` header. Ball pages appear only while the gate
  is open.
- **`sitemap.xml`.** The search-engine feed from the same registry, filtered by the admin's
  per-page "Show to search engines" ticks (`site_page_seo` overrides over registry defaults;
  `/donor-portal` and `/donate/thank-you` default hidden, hard-excluded paths never appear at
  all). Ball pages join only when the gate is open — and a crawler never gets the preview.
- **Access**: a new `site` permission section — admins edit by role (public URLs + what Google
  lists are launch-sensitive, like the ball gate); editors and viewers may look.
- Covered by `test/unit/site-pages.test.ts` (validators, tree, xml, seed list) and
  `features/site-pages.feature` (404 status + brand, JSON API 404, seeded + admin-added alias
  301s, shadow refusal, editor-gets-403 on writes, /sitemap noindex, sitemap.xml honouring the
  visibility ticks).
