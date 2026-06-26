<!-- Generated projection — do not hand-edit. Materialized from the requirement log (REQ-012). -->

# Throughline — Specification

## Shipped (27)

### REQ-001 — Multi-page site structure

Four real pages, each its own URL and HTML document, sharing one stylesheet and one script: Home (`index.html`, `/`), About (`about.html`, `/about-us`), Donate (`donate.html`, `/donate`), Contact (`contact.html`, `/contact`). Multi-page (not one long scroll) so each page can rank in search. *Accept:* each of the four URLs serves its own document sharing one CSS file and one JS file.

Tasks:
- TASK-001 — Scaffold four-page static site sharing one CSS and one JS file
- TASK-002 — Add clean-URL routing so pages serve at /, /about-us, /donate, /contact

### REQ-002 — Site navigation

A sticky top bar on every page: transparent over the hero, switching to a translucent cream bar with a hairline and soft shadow once scrolled past 24px. The current page's link is marked active. At or below 680px the links collapse into a burger menu; above mobile a persistent Donate button sits to the right of the links. *Accept:* the bar flips state past 24px, marks the active page, shows the Donate button above mobile, and collapses to a burger at ≤680px.

Tasks:
- TASK-006 — Bootstrap the site project skeleton and page shells
- TASK-007 — Implement sticky top navigation bar with scroll state, active link, Donate button and mobile burger

### REQ-003 — Site footer

A maroon footer with cream text present on every page: three columns (brand and socials, Explore, Ways to give) plus a legal strip carrying the SCIO line and the OSCR registration link for SC047995. *Accept:* every page shows the three-column footer and the SCIO/OSCR legal strip.

Tasks:
- TASK-008 — Add the maroon three-column site footer with SCIO/OSCR legal strip to every page

### REQ-004 — Brand colour system

The six official NBCC colours as tokens (Deep Crimson `#C02238`, Rich Maroon `#800000`, Natural Cream `#F8F5EE`, Elfin Tan `#D29C8A`, Dark Slate `#333333`, Holly Green `#1A531A`) plus derived surfaces (card `#FFFDFA`, line `#E9DFD2`, tan-soft `#F3E4DD`, holly-soft `#EAF0E7`, slate-soft `#6F6A66`). No colours outside this system without a deliberate decision, and body text is never set in Elfin Tan or Holly Green on cream. *Accept:* every colour used maps to a defined token and the tan/holly-on-cream contrast rule holds.

Tasks:
- TASK-009 — Define the full NBCC brand colour token system in CSS and route all colours through it

### REQ-005 — Typography system

Two families only: Playfair Display for all headings, large donation amounts, the founding quote and key numbers (crimson by default); Poppins for body copy, labels, buttons, navigation and eyebrows. A fluid `clamp`-based type scale governs hero, page-intro, section, lede, body and eyebrow sizes. Fonts load from Google Fonts, with a documented self-hosted `@font-face` fallback for offline builds. *Accept:* only the two families appear, sizes follow the clamp scale, and headings render in Playfair crimson.

Tasks:
- TASK-010 — Implement the two-family typography system with a fluid clamp type scale and self-hosted/Google-Fonts loading

### REQ-006 — Layout, radius and shadow tokens

Max content width 1180px with fluid side padding (`clamp(20px,5vw,48px)`); corner radii 16px standard, 24px large cards/figures, 999px pills/buttons; three warm shadow levels tinted with maroon rather than neutral grey; sticky-nav height 78px with a matching scroll-margin on linked sections so headings are never hidden under the bar. *Accept:* content is capped at 1180px and anchored sections clear the sticky nav.

Tasks:
- TASK-011 — Add layout, radius and shadow design tokens and apply max-width, fluid padding and scroll-margin

### REQ-007 — Brand marks

The signature divider motif (a Holly Green hairline with a centred crimson diamond, `.rule`) appears under page headings and major section heads, used sparingly so it stays a signature. The master logo lockup (elf over a line above the NBCC wordmark) is used whole, never rebuilt from parts, at 50px in the nav, 74px in the footer, and larger as the Home hero illustration, keeping brand clear space around it. *Accept:* the rule appears only under headings, and the supplied logo PNG is used whole at the specified sizes with clear space.

Tasks:
- TASK-012 — Add the signature .rule divider motif (Holly Green hairline with centred crimson diamond) and place it under page headings
- TASK-013 — Use the master logo lockup whole in the nav (50px) and footer (74px) with brand clear space

### REQ-008 — Motion system

Restrained motion: scroll reveal fades content up on entry, the nav transitions state on scroll, and buttons, cards and tiers lift on hover. Everything is disabled under `prefers-reduced-motion: reduce`. *Accept:* reveals and hover lifts are present, and with reduced-motion enabled all motion is disabled while content stays visible.

Tasks:
- TASK-014 — Implement the restrained motion system: scroll-reveal, hover lifts, and prefers-reduced-motion off-switch

### REQ-009 — Global UI components

A button system with three pill-shaped variants (primary crimson, ghost outlined-maroon, holly green) and an animated arrow on hover; and a shared card surface (card background, hairline border, soft shadow) reused by pillars, tiers, reassurance items and team members. *Accept:* the three button variants and the shared card surface render to spec wherever used.

Tasks:
- TASK-015 — Add the global button system (three pill variants + hover arrow) and shared card surface

### REQ-010 — Home hero

Eyebrow "Volunteer run Scottish charity"; H1 "No one should feel forgotten on Christmas Eve" with "forgotten" emphasised in maroon italic; a lede on the volunteer-run, year-round mission; two buttons, Donate now (primary) and Who we help (ghost); the logo as the hero illustration with a floating proof card reading "7,657 Red Bags Full of Joy delivered in 2025". *Accept:* the hero shows the emphasised H1, both CTAs, and the proof card figure.

Tasks:
- TASK-016 — Build the Home hero section in index.html with emphasised H1, both CTAs and the proof card

### REQ-011 — Home four pillars

A tinted band of the four leaflet pillars, each an icon, title and one line: Volunteer run ("Powered by kindness, driven by community"); South West Scotland ("Supporting children, young people and vulnerable adults from Girvan to Largs"); Red Bags Full of Joy ("Thoughtful gifts. Dignity. Comfort. Moments of joy."); 7,657 delivered in 2025 ("Real impact. Real children, young people and vulnerable adults. Real difference."). *Accept:* four pillars render with their exact titles and lines.

Tasks:
- TASK-017 — Build the Home four-pillars tinted band in index.html

### REQ-012 — Home why-your-donation-matters section

A heading, the signature rule, two paragraphs drawn from the leaflet, a Support NBCC button, and an impact photo slot (currently a placeholder, to be swapped for a real packing or delivery photo). *Accept:* the section shows the two leaflet paragraphs, the CTA, and an image slot.

Tasks:
- TASK-018 — Build the Home why-your-donation-matters section in index.html

### REQ-013 — Recurring closing CTA strip

A crimson panel reused at the foot of the Home and About pages: a short rallying headline (Home: "Help us reach even more in 2026") and a Donate now button. *Accept:* the crimson CTA strip with headline and Donate button appears at the foot of Home and About.

Tasks:
- TASK-019 — Add the recurring crimson closing CTA strip to the foot of Home and About

### REQ-014 — About intro

Eyebrow "About us"; H1 "Powered by kindness, driven by community"; a lede on Annbank, Ayrshire and the Girvan-to-Largs reach. *Accept:* the intro shows the H1 and the reach lede.

Tasks:
- TASK-020 — Build the About intro section in about.html with eyebrow, H1 and reach lede

### REQ-015 — About our story

The founding quote ("Do all children get a Christmas Eve box like I do?", Tygan, 2015), the origin narrative, and Tygan's real headshot with a caption. This is the one piece of copy carried from the existing site rather than the leaflet, so wording and figures must be verified. *Accept:* the story shows the quote, the narrative, and a captioned headshot, flagged for content verification.

Tasks:
- TASK-021 — Build the About our story section in about.html with founding quote, origin narrative and captioned headshot

### REQ-016 — About meet-the-team grid

A tinted band with a grid of ten members, each a portrait photo, name and role, laid out five across on desktop, three on tablet and two on mobile. Six of the ten roles are "Volunteer Elf" placeholders to be confirmed by NBCC before launch. *Accept:* ten responsive team cards render, with placeholder roles marked for confirmation.

Tasks:
- TASK-024 — Build the About meet-the-team responsive grid in about.html

### REQ-017 — About age-reach figures (2025)

A maroon band presenting eight age-band counts that sum to exactly 7,657: 0–12 months 182; 1–3 years 762; 4–7 years 1,663; 8–11 years 1,990; 12–15 years 1,719; 16–17 years 587; 18 and over 528; not stated 226. *Accept:* the eight figures display and total exactly 7,657.

Tasks:
- TASK-025 — Build the About age-reach figures (2025) maroon band in about.html

### REQ-018 — About top-10 communities (2025)

A ranked horizontal bar list of the top ten 2025 communities, bar width relative to Ayr at 100%: Ayr 2,096 (27.4%); Kilwinning 692 (9.0%); Stevenston 547 (7.1%); Kilmarnock 532 (6.9%); Auchinleck 510 (6.7%); Maybole 370 (4.8%); Dalmellington 332 (4.3%); Ardrossan 301 (3.9%); Irvine 280 (3.7%); Girvan 205 (2.7%). *Accept:* ten communities are ranked with proportional bars, Ayr at full width. A geographic map is a later enhancement, not this requirement.

Tasks:
- TASK-026 — Build the About top-10 communities (2025) ranked bar list in about.html

### REQ-019 — Donate intro

Headline "Your gift becomes someone's Christmas" with a lede noting the volunteer base and that around £50 is the value of one Red Bag Full of Joy. *Accept:* the intro shows the headline and the £50-per-Red-Bag framing.

Tasks:
- TASK-027 — Build the Donate intro section in donate.html

### REQ-020 — Give widget shell and mode toggle

The conversion centrepiece: a card split into a main column and a Holly Green side panel, with a toggle between Give once and Give monthly that switches the visible tiers. *Accept:* the widget renders the two-column layout and a working once/monthly toggle.

Tasks:
- TASK-028 — Build the Give widget shell and once/monthly mode toggle in donate.html

### REQ-021 — Give once tiers

Suggested one-off amounts — £10 (cosy essentials), £25 (towards a Red Bag, marked "Most chosen"), £50 (one full Red Bag), £100 (a whole family) — plus a Choose-your-own-amount option. These amounts are a suggestion to be confirmed or reworded, since the leaflet specifies only monthly tiers. *Accept:* the one-off tiers and the custom-amount option render, with the Most-chosen marker, flagged as suggested amounts.

Tasks:
- TASK-029 — Build the Give once tiers into #tiersOnce on donate.html

### REQ-022 — Give monthly tiers

Four monthly tiers with the exact leaflet copy: Bronze £10/month "Building towards Christmas joy"; Silver £25/month "Halfway to a Red Bag Full of Joy"; Gold £50/month "One Christmas made brighter"; Platinum £100/month "More joy, every month" — each with its leaflet description — plus a line for other monthly amounts linking to giving@nightbeforechristmas.co.uk. *Accept:* the four monthly tiers render with leaflet headlines and descriptions and the other-amount contact line.

Tasks:
- TASK-030 — Build the four monthly give tiers into #tiersMonthly on donate.html

### REQ-023 — Gift Aid callout

A Gift Aid callout with a tick box, worth 25% on eligible gifts, enabled only once NBCC is registered to claim Gift Aid and removed otherwise. Gift Aid is not in the leaflet, so its inclusion is a pending NBCC decision. *Accept:* the Gift Aid control renders and is gated on the registration decision.

Tasks:
- TASK-031 — Build the Gift Aid callout with tick box into the give widget on donate.html

### REQ-024 — Donate side panel

The Holly Green side panel: where the money goes (three points), the charity number SC047995, and payment-method chips for Card, Direct Debit, Apple Pay and Google Pay. *Accept:* the side panel shows the three points, the charity number, and the four payment chips.

Tasks:
- TASK-032 — Fill the Holly Green donate side panel with where-the-money-goes points, charity number and payment chips

### REQ-025 — Monthly donor benefits

A tinted band: all monthly donors are named on the Donors Page (unless anonymous) and receive a post-Christmas impact update; Platinum donors also receive a social-media thank-you, an optional digital supporter badge, and a personalised supporter certificate. *Accept:* the benefits clearly distinguish all-donor perks from Platinum-only perks.

Tasks:
- TASK-033 — Build the monthly donor benefits tinted band on donate.html distinguishing all-donor from Platinum-only perks

### REQ-026 — Donate reassurance

Three reassurance items: cancel any time under the Direct Debit Guarantee; secure via Stripe and 18 or over; and a help line pointing to Jaimie Wakefield at giving@nightbeforechristmas.co.uk or 01292 811 015. *Accept:* the three reassurance items render with the correct contact details.

Tasks:
- TASK-034 — Build the donate reassurance section in donate.html with the three reassurance items

### REQ-033 — SEO, performance and hosting

Each page sets its own title, meta description, canonical URL, and Open Graph and Twitter tags (the reason for the multi-page structure); page weight is kept low (optimised images, two web fonts, no framework, no build step); static hosting serves the four pages with the two API endpoints running as serverless functions alongside. *Accept:* each page has unique metadata and meets the low-weight performance budget on mobile.

Tasks:
- TASK-003 — Scaffold static multi-page site skeleton with no build step
- TASK-004 — Add unique per-page SEO and social metadata to each page head
- TASK-005 — Meet the low-weight performance budget and configure static hosting with serverless functions

## Planned (8)

### REQ-027 — Contact page and enquiry form

An intro with the signature rule and a lede; contact points (info@nightbeforechristmas.co.uk for general enquiries, 01292 811 015, donations via Jaimie Wakefield at giving@, and Annbank Village Hall as the base); and a form with First name (required), Last name, Email (required) and Message (required), with client-side validation. The preview shows a success message; the live site posts to the backend. *Accept:* the contact details display and the validated form yields a success message in the preview.

Tasks:
- TASK-035 — Build the Contact page intro, contact points and validated enquiry form in contact.html

### REQ-028 — Donate front-end checkout contract

Every tier and amount button carries data attributes — `data-mode` (`once` or `monthly`), `data-plan` (`bronze`/`silver`/`gold`/`platinum`, empty for one-off), `data-amount` (pence, empty for choose-your-own) — and calls `startCheckout(button)`, which reads the `#giftAid` checkbox and assembles a single `{ mode, plan, amount, giftAid }` payload. This is the one integration point: in production it POSTs to the backend and redirects to the returned Stripe URL; in the preview it shows the payload. *Accept:* clicking any tier produces the correct payload (alert in preview, POST + redirect in production).

### REQ-029 — Checkout session endpoint

`POST /api/create-checkout-session` receives `{ mode, plan, amount, giftAid }`, creates a Stripe Checkout session and returns `{ url }`. Payment methods are Card and BACS Direct Debit (Apple Pay and Google Pay come automatically on supported devices); one-off uses a price built from `amount`, monthly uses recurring prices keyed by `plan`; when `giftAid` is true a Gift Aid declaration is captured and stored for the 25% claim; monthly giving is 18 or over and cancellable under the Direct Debit Guarantee. *Accept:* a valid payload returns a Stripe redirect URL reflecting the correct mode, plan and amount.

### REQ-030 — Contact endpoint

`POST /api/contact` receives `{ firstName, lastName, email, message }`, sends to the NBCC inbox (or a form service such as Formspree) and returns success. Until built, the form falls back to opening the visitor's email client. *Accept:* a submitted form reaches the inbox and returns success, with the mail-client fallback when the endpoint is absent.

### REQ-031 — Content and copy rules

House style holds sitewide: no dashes in any visible copy (use commas, parentheses or restructured sentences, matching leaflet style such as "one off", "year round", "volunteer run"); always write "NBCC", never "NB4CC"; beneficiaries are always "children, young people and vulnerable adults"; gifts are described as curated by age with emphasis on inclusivity; tone is warm and dignified, never pity-driven. The 2025 donation leaflet is the source of truth for content. *Accept:* a copy review finds no dashes, correct NBCC usage, the full beneficiary phrasing, and the warm dignified tone throughout.

### REQ-032 — Accessibility floor (WCAG 2.1 AA)

A skip-to-content link; semantic landmarks (header, nav, main, section, footer); visible Holly Green keyboard focus rings; real labels on all form fields with required fields marked; meaningful alt text on all images; the section colour-contrast rules respected; `prefers-reduced-motion` honoured; mobile-first and responsive down to roughly 360px. *Accept:* an AA audit passes on all four pages. *Non-negotiable.*

### REQ-034 — Assets pipeline

The logo PNG (`nbcc-logo.png`) used in nav, footer and Home hero; ten team headshots processed to 4:5 portrait JPEGs at 640×800, quality 82, progressive (about 644KB total), stored as `images/team-<name>.jpg` with a slightly top-biased face crop; and remaining placeholder figures replaced with real, consented photography of volunteers, packing days and deliveries, always with alt text. *Accept:* assets exist at the specified sizes and paths with alt text, and beneficiary images carry consent.

### REQ-035 — Supporters page

A fifth marketing page listing supporters grouped into Bronze, Silver and Gold tiers, alphabetical within each tier, including both individual people and brands/organisations. It is reachable at its own clean URL, shares the single nav, footer, stylesheet and script, and is structured so the frequently-changing list is easy to update.

Tasks:
- TASK-022 — Add the Supporters page to the multi-page site structure with clean URL, nav, footer and SEO
- TASK-023 — Build the tiered, alphabetical supporters list on supporters.html
