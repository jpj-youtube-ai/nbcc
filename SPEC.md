<!-- Generated projection — do not hand-edit. Materialized from the requirement log (REQ-012). -->

# Throughline — Specification

## Shipped (51)

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

### REQ-027 — Contact page and enquiry form

An intro with the signature rule and a lede; contact points (info@nightbeforechristmas.co.uk for general enquiries, 01292 811 015, donations via Jaimie Wakefield at giving@, and Annbank Village Hall as the base); and a form with First name (required), Last name, Email (required) and Message (required), with client-side validation. The preview shows a success message; the live site posts to the backend. *Accept:* the contact details display and the validated form yields a success message in the preview.

Tasks:
- TASK-035 — Build the Contact page intro, contact points and validated enquiry form in contact.html

### REQ-028 — Donate front-end checkout contract

Every tier and amount button carries data attributes — `data-mode` (`once` or `monthly`), `data-plan` (`bronze`/`silver`/`gold`/`platinum`, empty for one-off), `data-amount` (pence, empty for choose-your-own) — and calls `startCheckout(button)`, which reads the `#giftAid` checkbox and assembles a single `{ mode, plan, amount, giftAid }` payload. This is the one integration point: in production it POSTs to the backend and redirects to the returned Stripe URL; in the preview it shows the payload. *Accept:* clicking any tier produces the correct payload (alert in preview, POST + redirect in production).

Tasks:
- TASK-036 — Wire the donate tier buttons to the startCheckout payload contract (data attributes + startCheckout in main.js)

### REQ-029 — Checkout session endpoint

`POST /api/create-checkout-session` receives `{ mode, plan, amount, giftAid }`, creates a Stripe Checkout session and returns `{ url }`. Payment methods are Card and BACS Direct Debit (Apple Pay and Google Pay come automatically on supported devices); one-off uses a price built from `amount`, monthly uses recurring prices keyed by `plan`; when `giftAid` is true a Gift Aid declaration is captured and stored for the 25% claim; monthly giving is 18 or over and cancellable under the Direct Debit Guarantee. *Accept:* a valid payload returns a Stripe redirect URL reflecting the correct mode, plan and amount.

Tasks:
- TASK-037 — Wire Stripe config, secret and client for the checkout endpoint
- TASK-038 — Implement POST /api/checkout-session to create a Stripe Checkout session

### REQ-030 — Contact endpoint

`POST /api/contact` receives `{ firstName, lastName, email, message }`, sends to the NBCC inbox (or a form service such as Formspree) and returns success. Until built, the form falls back to opening the visitor's email client. *Accept:* a submitted form reaches the inbox and returns success, with the mail-client fallback when the endpoint is absent.

Tasks:
- TASK-039 — Implement POST /api/contact to forward enquiries to the NBCC inbox

### REQ-031 — Content and copy rules

House style holds sitewide: no dashes in any visible copy (use commas, parentheses or restructured sentences, matching leaflet style such as "one off", "year round", "volunteer run"); always write "NBCC", never "NB4CC"; beneficiaries are always "children, young people and vulnerable adults"; gifts are described as curated by age with emphasis on inclusivity; tone is warm and dignified, never pity-driven. The 2025 donation leaflet is the source of truth for content. *Accept:* a copy review finds no dashes, correct NBCC usage, the full beneficiary phrasing, and the warm dignified tone throughout.

Tasks:
- TASK-040 — Add a sitewide copy-rules guard test and fix any violations across all pages

### REQ-032 — Accessibility floor (WCAG 2.1 AA)

A skip-to-content link; semantic landmarks (header, nav, main, section, footer); visible Holly Green keyboard focus rings; real labels on all form fields with required fields marked; meaningful alt text on all images; the section colour-contrast rules respected; `prefers-reduced-motion` honoured; mobile-first and responsive down to roughly 360px. *Accept:* an AA audit passes on all four pages. *Non-negotiable.*

Tasks:
- TASK-043 — Add a skip-to-content link and complete semantic landmarks across all pages
- TASK-044 — Add a sitewide accessibility-floor guard test asserting the WCAG 2.1 AA invariants on all four pages

### REQ-033 — SEO, performance and hosting

Each page sets its own title, meta description, canonical URL, and Open Graph and Twitter tags (the reason for the multi-page structure); page weight is kept low (optimised images, two web fonts, no framework, no build step); static hosting serves the four pages with the two API endpoints running as serverless functions alongside. *Accept:* each page has unique metadata and meets the low-weight performance budget on mobile.

Tasks:
- TASK-003 — Scaffold static multi-page site skeleton with no build step
- TASK-004 — Add unique per-page SEO and social metadata to each page head
- TASK-005 — Meet the low-weight performance budget and configure static hosting with serverless functions

### REQ-034 — Assets pipeline

The logo PNG (`nbcc-logo.png`) used in nav, footer and Home hero; ten team headshots processed to 4:5 portrait JPEGs at 640×800, quality 82, progressive (about 644KB total), stored as `images/team-<name>.jpg` with a slightly top-biased face crop; and remaining placeholder figures replaced with real, consented photography of volunteers, packing days and deliveries, always with alt text. *Accept:* assets exist at the specified sizes and paths with alt text, and beneficiary images carry consent.

Tasks:
- TASK-041 — Add the headshot/image processing pipeline and wire ten 4:5 team portraits into the About grid
- TASK-042 — Replace the remaining placeholder figures (Tygan headshot, home photo slot, OG image) with consented imagery

### REQ-035 — Supporters page

A fifth marketing page listing supporters grouped into Bronze, Silver and Gold tiers, alphabetical within each tier, including both individual people and brands/organisations. It is reachable at its own clean URL, shares the single nav, footer, stylesheet and script, and is structured so the frequently-changing list is easy to update.

Tasks:
- TASK-022 — Add the Supporters page to the multi-page site structure with clean URL, nav, footer and SEO
- TASK-023 — Build the tiered, alphabetical supporters list on supporters.html

### REQ-036 — One unified donation platform

Build a single on-site platform where the donation flow, Stripe payments, subscriptions, declaration capture, refund logic and admin all share one data model and one set of Stripe webhooks; treat Gift Aid eligibility as a flag/relationship on each donation, never a bolted-on second system. *Accept:* no duplicate donor/donation stores; a refund updates the one record; a single webhook handler set that no other "module" duplicates.

Tasks:
- TASK-045 — Create the unified donation schema and transactional audit-log write helper
- TASK-046 — Add the single Stripe webhook handler set that updates the one donation record

### REQ-037 — Core donation data model

Implement donors, declarations, donations, claim_batches, users and audit_log with the invariant that a donation is claimable only when donor_type is individual, a valid active declaration covers it, and it is not (fully) refunded. *Accept:* company donations are always not-claimable/not_eligible; a donation enters at most one claim batch; every admin write appends an audit_log row.

Tasks:
- TASK-056 — Add claim_batches and users tables plus a one-batch-per-donation FK (additive migration)
- TASK-057 — Enforce the claim invariant and at-most-one-batch assignment with an audited write helper

### REQ-038 — Donor-type routing question

Ask "are you donating as an individual or on behalf of a business?", routing individuals (including sole traders and partners) to the Gift Aid path and incorporated companies (Ltd, PLC, LLP) to the no-Gift-Aid path, with helper text that a sole trader is legally an individual. *Accept:* the optional business-name field is a donors-page display label only and never switches paths; donor_type is persisted.

Tasks:
- TASK-054 — Add the individual-or-business donor-type routing question to the donate give widget
- TASK-055 — Persist donor_type (and business name) through the checkout session and webhook onto the donor record

### REQ-039 — Consent-based contact capture

Capture email (optional and consent-based), full name (required), an optional display business name and an anonymous flag, and require monthly donors to confirm they are 18+. *Accept:* when no email is captured the platform sends nothing; anonymous donors are pulled through to payment but never shown on the public donors page.

Tasks:
- TASK-058 — Add consent-based contact-capture fields to the give widget and fold them into the checkout payload
- TASK-059 — Thread consent-based contact fields through checkout and persist them onto the donor via the webhook

### REQ-040 — Verbatim, versioned HMRC declaration wording

Show HMRC's official template liability statement verbatim (multiple/all-donations template for monthly and enduring, single-donation template for one-offs) and store the exact wording in a versioned config so every saved declaration records the version the donor saw. *Accept:* "I am a UK taxpayer" alone is rejected because the full liability paragraph must be present; wording_version and a wording_snapshot are persisted on each declaration.

Tasks:
- TASK-049 — Add versioned, verbatim HMRC declaration wording config with scope selection and liability-paragraph validation

### REQ-041 — Amount, tier and frequency

Let the donor pick monthly (a Stripe subscription) or one-off (a single charge) and either a preset tier (£10/£25/£50/£100) or a custom GBP amount, pairing monthly with an enduring declaration. *Accept:* amount, frequency and currency are captured; monthly defaults the declaration scope to enduring.

Tasks:
- TASK-060 — Capture explicit frequency/currency on checkout and default declaration scope to enduring for monthly gifts

### REQ-042 — Gift Aid opt-in, never pre-ticked

Offer Gift Aid as an explicit opt-in bound to the displayed HMRC statement, eligible only for genuine gifts of the donor's own money (not goods/services, not crypto, not benefits over the caps). *Accept:* an affirmative tick is required and the consent is stored against the exact statement shown.

Tasks:
- TASK-052 — Show the verbatim HMRC Gift Aid statement in the donate opt-in, bound to the never-pre-ticked tick
- TASK-053 — Stamp the exact HMRC wording version and snapshot onto the checkout session when Gift Aid is affirmatively opted in

### REQ-043 — Declaration field capture

Capture first name, last name, optional title, house name/number as a separate HMRC matching key, the rest of the home address, and a UK postcode, with a non-UK donor flag (Channel Islands / Isle of Man) that omits the postcode. *Accept:* field-level validation enforces postcode format and a required house number; only a home address is accepted (no work or c/o addresses).

Tasks:
- TASK-061 — Add declaration field capture validation and row-builder module
- TASK-062 — Add Gift Aid declaration capture fields to the give widget and fold into the checkout payload
- TASK-063 — Thread declaration fields through the checkout endpoint and persist them onto the declarations table via the webhook

### REQ-044 — Declaration scope

Capture scope as this-donation-only or all-donations (the past four years plus present and future), defaulting monthly to enduring. *Accept:* declaration_scope is persisted and an enduring declaration covers every future charge without re-asking.

Tasks:
- TASK-064 — Add an explicit this-donation-only / all-donations scope choice to the declaration fieldset
- TASK-065 — Let an explicit declaration scope override the mode-derived default through checkout and persistence

### REQ-045 — Benefit tracking and caps

Record the benefits accepted per donation with an admin-set value per perk and an automatic check against HMRC's annualised benefit caps (≤£100 → 25%; £101–£1,000 → £25; £1,001+ → 5% capped at £2,500). *Accept:* recognition perks such as name-on-page, impact updates, social thank-yous, digital badges and certificates are recorded at zero monetary value; any cap breach is flagged.

Tasks:
- TASK-066 — Add benefit_types and donation_benefits tables plus a donation cap-breach flag (additive migration)
- TASK-067 — Add HMRC annualised benefit-cap calculator and an audited donation-benefit recording write helper

### REQ-046 — Immutable declaration audit record

Persist each declaration immutably with all captured fields, the declaration timestamp, the wording-version snapshot, the scope, the benefits accepted and foreign keys to every charge, retaining it six years after the most recent claimed donation (permanently while an enduring or monthly declaration is active, with the clock starting at the final charge on cancellation). *Accept:* online declarations require no 30-day confirmation letter.

Tasks:
- TASK-068 — Add a pure declaration retention-expiry calculator implementing the six-year-after-last-claim rule

### REQ-047 — Post-payment confirmation and donors page

On a successful payment show a confirmation screen, send a confirmation when an email is present, add a donors-page entry showing name or business name unless anonymous, and mark claimable donations for the next claim schedule. *Accept:* anonymous donations never appear on the public page yet are still queued for claiming with real details.

Tasks:
- TASK-069 — Add a post-payment confirmation page wired to Stripe's success_url
- TASK-070 — Send a post-payment confirmation email when the donor's email is present and consented
- TASK-071 — Show real, non-anonymous donors on the public donors page

### REQ-048 — Contactless ingestion via the Paid app

Ingest in-person card-present charges from NBCC's single Stripe account — volunteers sign into the third-party Paid app via Stripe OAuth on their own phones — over webhooks, tagging payment_channel as in_person, with no custom Terminal build and no shared Apple ID. *Accept:* card_present charges are reconciled into the one platform regardless of which volunteer or device took them.

Tasks:
- TASK-072 — Add pure card-present charge mapping for in-person Stripe webhook events
- TASK-073 — Ingest card-present charge.succeeded events into the donations table via the single Stripe webhook

### REQ-049 — Contactless Gift Aid capture by auto-email and QR

Capture Gift Aid for contactless gifts after the tap by autk to the receipt_email Paid attaches to the charge, plus a QR/short-link card fallback, both leading to the same fulldeclaration form. *Accept:* a bounced or undeliverable auto-email sets declaration_status to undelivered and surfaces in admin as awaiting declaration; a sent link is never treated as a completed declaration.

Tasks:
- TASK-074 — Add declaration_status and declaration_token to donations for contactless Gift Aid tracking
- TASK-075 — Send the auto-email (with QR/short-link fallback) after a contactless charge is ingested
- TASK-076 — Build the public Gift Aid declaration completion page and endpoint for the emailed/QR link

### REQ-055 — Stripe subscriptions for monthly giving

Use Stripe Billing subscriptions for monthly tiers with one Price perice, and support mid-subscription tier up or down via Stripe proration with Gift Aid claimed on each actual charge amount.*Accept:* proration is handled and no special Gift Aid handling is needed beyond claiming the actual amount charged.

Tasks:
- TASK-050 — Add a subscription plan-change endpoint that up/downgrades a monthly tier via Stripe proration
- TASK-051 — Ensure the Stripe webhook records the actual charged amount on every recurring/prorated invoice so Gift Aid claims the real amount

### REQ-065 — Webhook-driven donation state (Stripe as source of truth)

A single signature-verified Stripe webhook endpoint is the only writer of authoritative donation payment state (paid/failed/refunded) — the client never sets it. Every webhook write is idempotent and de-duplicated so a resent Stripe event can never double-create or double-mutate a donation.

Tasks:
- TASK-047 — Wire the Stripe webhook signing secret through config, SSM, task-def and IAM
- TASK-048 — Add an idempotent Stripe webhook event ledger (additive migration + de-dup helper)

## Planned (14)

### REQ-050 — GASDS for small contactless gifts

Claim small in-person gifts of £30 or less that carry no declaration via GAseparately within its limits (up to £8,000 of small donations a year, a £2,000 top-up cap, capped at ten times the Gift Aidclaimed that year). *Accept:* gasds_eligible is flagged and the GASDS pool is tracked independently of declared claims.

### REQ-051 — Partnership donations

Support business-partnership donors by collecting one Gift Aid declaration per partner ome address, postcode, taxpayer consent and share — with shares summing to the donation total, via a lightweightthat a sole trader is legally an individual. *Accept:* the optional business-name field is a donors-page display label only and never switches paths; donor_type is persisted.

### REQ-052 — Charities Online claim export

Produce a correctly formatted export (Title, First name, Last name, House name/number, Postcode, Donation date, Amount; one row per successful charge, with OSCR as regulator, charity number SC047995 and NBCC's HMRC reference) for finance to upload to Charities Online, with the direct HMRC API deferred to phase two. *Accept:* each successful charge under an enduring monthly declaration produces its own claimable row.

### REQ-053 — Company donation flow

Provide a company path that suppresses all Gift Aid UI and captures the legal company name (required), an optional registration number, a required contact name and email, a billing address and an anonymous flag, recording the donation as permanently not-claimable. *Accept:* no declaration is taken, no Charities Online row is produced, and the donation never enters a claim.

### REQ-054 — Corporation-tax receipt for companies

Email a dated receipt in place of a declaration stating NBCC's name and OSCR SC047995, the amount and date, that it is a genuine donation with nothing of value given in return, and that NBCC has not and will not claim Gift Aid on it. *Accept:* genuine sponsorship where consideration is given is flagged for trustees as a separate flow rather than processed as a donation.

### REQ-056 — One-off, BACS and card payments

Support one-off single charges via PaymentIntents and both BACS Direct Debit (bacs_debit, handling the setup/confirmation lead time) and card for monthly and one-off giving. *Accept:* the pending BACS mandate state is handled and the Direct Debit Guarantee is honoured.

### REQ-057 — Dunning and failed-payment retries

Configure Stripe Smart Retries for three attempts over roughly two weeks, then mark the subscription lapsed, stop future claims and notify the donor and admin. *Accept:* a lapsed subscription produces no further claimable donations.

### REQ-058 — Refund and chargeback handling

On a refund or dispute update the refunded amount, set the donation not-claimable (or recalculate for a partial) when it has not yet been claimed, and when it has already been claimed set claim_status to adjustment_due and net the over-claim off the next submission, always recalculating partial refunds on the retained amount. *Accept:* Gift Aid is never kept on returned money, adjustments are recorded against the claim batch for auditability, and a company refund voids or corrects the receipt only.

### REQ-059 — Editing a declaration creates a new one

Treat declarations as immutable so that any change to name, address, scope or taxpayer confirmation deactivates the old declaration with a revoked timestamp and creates a new one with the current wording, linking future charges to the new declaration while past claimed donations keep their original. *Accept:* each donation's claim references the declaration that was valid at the time of that donation.

### REQ-060 — Consent-based emails and thank-yous

Send nothing without a captured email, and give every donation that has a, layered with a Gift Aid confirmation and manage/cancel instructions for individuals, a corporation-tax receipt forcompanies, or a refund confirmation where relevant. *Accept:* no email is ever sent without an address.

### REQ-061 — Self-serve donor portal

Let donors edit their details, downgrade, manage or cancel Gift Aid and cancel their subscription, making cancellation easy as required but offering a reduce-instead option first, with cancelling Gift Aid setting the declaration inactive and stopping future claims. *Accept:* cancellation is reachable without contacting staff and a reduce-instead option is offered before cancel.

### REQ-062 — Role-based admin mirroring self-serve

Provide a standalone admin back-end with Viewer (read-only), Editor (view, edit, cancellations and queues) and Admin (all that plus user management, running and submitting claims, recording adjustments and settings) roles, able to perform any self-serve action on a donor's behalf. *Accept:* Kenny and Isabel hold the Admin/Claims permission and roles enforce read-only versus edit versus claim.

### REQ-063 — Admin queues and claim operations

Give admins donor, declaration and donation search, the Charities Online export, batch-submitted marking, the adjustment-due queue, retention-expiry flags and an awaiting-declaration queue for in-person links that were sent but not completed (including bounced emails). *Accept:* every admin write (edit, submit, adjust) appends to the audit log to form the HMRC-claim and governance trail.

### REQ-064 — Data protection and anonymity

Store personal data securely, enforce retention per the audit-record rule, link the privacy notice in the form, and treat anonymity as a public-display setting only while the HMRC claim still uses the donor's real name and address. *Accept:* anonymous donors are hidden on the public page yet fully recorded for claiming.
