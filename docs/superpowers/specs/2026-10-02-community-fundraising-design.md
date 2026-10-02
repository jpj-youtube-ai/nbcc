# Community fundraising: Get involved

Date: 2026-10-02. Asked for by Jaimie, who answered these before bed:

- **One public page, "Get involved"**, with chips at the top (All, Events, Fundraisers) and a big
  "Fundraise for us" button. It replaces Events; `/events` keeps working and goes there.
- **One sign-up form, two paths:** "I'm raising money" (gets a page, a meter and a QR code) or "I'm
  holding an event" (a bake sale, a quiz: listed as an event, with or without its own giving page).
  They also say whether it is public, or only to let us know and get materials.
- **Staff approve every one** before anything about it is public.
- **Fundraisers manage their page by an emailed link**, no passwords, and **every change waits for
  staff approval** before it shows.
- **Giving works like the donate page** (Stripe, email, Gift Aid, the newsletter tick box), plus a
  short message and a choice to show their name or stay anonymous on the page's **supporter wall**.
  Staff can hide a message.
- **Cash counts when it reaches us:** staff add paid-in amounts in the admin, with a note.
- **Materials for every approved fundraiser:** a poster with their QR code, social media images, a
  sponsor form with proper Gift Aid columns, NBCC's logo pack with simple rules, and a thank-you
  certificate when they finish.
- **They can ask for:** printed leaflets or posters (posted or dropped off), collection buckets or
  tins (lent and tracked), a social media shout-out (with their Facebook link and permission), and
  someone from NBCC to attend.
- **Keeping in touch:** automatic friendly emails at set points, every one readable in the admin
  first, plus "Time to call" pills a week before and a week after, like business supporters.
- **Tonight: build the core, ready for Jaimie's yes.** Materials, emails and call reminders follow
  as the next stages.

The point, in Jaimie's words: one place for everything happening for NBCC, money through our own
systems rather than JustGiving, the givers' details and consents kept like the donate page's, and
consistent, good-looking materials instead of home-made logos.

## Stages

1. **Core (tonight):** the data, the sign-up form, approval, Get involved, each fundraiser's page
   with its meter, QR code, giving and supporter wall, the manage link with approved changes, cash
   paid in, and the admin's Fundraising screen. Behind a switch that ships off.
2. **Materials:** the poster, social images, sponsor form, logo pack and certificate, each built
   from the fundraiser's approved details, the way the business certificate and thank-you letters
   are (print-ready HTML pages).
3. **Keeping in touch:** the automatic emails and the call pills, riding the daily 8am job.
4. **Requests:** leaflets, buckets (out and back), shout-outs and attendance, tracked to done.

Stage 1 already stores everything stages 2 to 4 need (the requests and consents from the form).

## Stage 1 in detail

### Who is who

- **Organiser:** the person who signs up. Name, email, phone, optional Facebook link, consent to
  being posted about on NBCC's social media, and (only if they ask for posted materials) an address.
- **Supporter:** someone who gives on a fundraiser's page. Handled exactly like a donor on the donate
  page, plus their message and name choice.

### The sign-up form (`/fundraise`)

Plain, friendly, one page, works at phone width, no inner scrolling.

- Which path: raising money, or holding an event.
- What: a name for it (for example "Sam's Santa Dash"), the kind (a run or walk, a Santa dash, a
  bake sale or coffee morning, a quiz or party, a workplace or school collection, a birthday, or
  something else), a short description (up to 1,000 characters), the date and time if there is one,
  and where (venue and town) if there is one.
- For raising money: a target (optional, £10 to £100,000).
- Public or private: "Show it on our website" or "Just letting you know / I only want materials".
- Their details: name, email, phone (required, so we can call), Facebook or Instagram link
  (optional), "You can post about this on NBCC's social media" (yes or no).
- What they would like: printed leaflets or posters (how many), a collection bucket or tin (how
  many), a social media shout-out, someone from NBCC to attend. Posted materials ask for an address.
- The newsletter tick box, unticked, worded like the donate page's.
- Anti-spam exactly as the contact form (TASK-490): honeypot, a per-IP limit, Turnstile.

Submitting stores an enquiry, emails the organiser a short "thank you, we'll be in touch" and emails
`events@` a summary (the TASK-487 pattern). Nothing becomes public.

### Fundraiser pages (`/fundraise/<slug>`)

Only for an approved, public, raising-money fundraiser while the switch is on; otherwise 404.

- Their name for it, kind, date and place if any, the description, an optional photo (uploaded by
  staff in stage 1, through the existing event image upload), and "Organised by <first name and last
  initial>".
- **The meter:** raised so far (paid online gifts plus staff-recorded cash), the target and the
  percentage, as an accessible progress bar; "£X raised" alone when there is no target. It can pass
  100%.
- **Give:** an amount (presets and your own, £2 minimum), Gift Aid, cover the card fee, name and
  email, the newsletter tick box, a message (up to 200 characters) and "Show my name" or
  "Anonymous". It goes through the same `POST /api/checkout-session` with a new `fundraiserId`, and
  the same Stripe checkout. One-off gifts only.
- **Supporter wall:** newest first, the giver's first name and last initial (or "Anonymous"), the
  amount unless they chose to hide it, the message, and how long ago. Top 10, then "Show all" growing
  the page. Hidden messages never show.
- **QR code:** an SVG of the page's address, shown on the page with "Download the QR code" (SVG and
  print-size PNG are stage 2; stage 1 gives the SVG).
- Share buttons: copy the link, and Facebook and WhatsApp share links (plain links, no scripts).

### Get involved (`/get-involved`)

The Events page, renamed and widened. The existing events switch (`events_settings.page_on`) still
decides whether the page is on. `/events` redirects (301) to `/get-involved`.

- Chips: All, Events, Fundraisers, filtering the cards on the page without reloading.
- Events are rendered as today. Approved, public fundraisers appear as cards too (with their meter)
  only while the fundraising switch is on; approved public "holding an event" sign-ups appear as
  event cards.
- A "Fundraise for us" panel with a button to `/fundraise`, shown only while fundraising is on.
- The nav item reads "Get involved".

### Managing a page (`/fundraise/manage`)

- The organiser enters their email; if it has an approved fundraiser, they get an email with a link
  valid for 24 hours (the token stored as a sha256 hash; request limits per email and per IP like
  the donor portal).
- The link opens their fundraiser with its editable fields: the description, the target, the date,
  time and place, the social link. Saving sends the change to staff for approval; the page says it
  is waiting. The live page keeps the approved version until staff approve.

### The money

- `donations.fundraiser_id` (nullable) records which page a gift was made on;
  `donations.supporter_message`, `donations.show_name` and `donations.message_hidden` record the
  wall. The webhook takes `fundraiserId` from Stripe metadata and stores it only if it names an
  approved fundraiser; anything else is stored as an ordinary donation.
- `fundraiser_cash` rows: amount, date paid in, note, added by. Staff add and remove them.
- Raised = paid online gifts + cash. Refunded gifts come off.

### Admin: Fundraising

A new admin section `fundraising` (admin edit by default, editor edit, viewer view; the TASK-479
backfill pattern). It holds:

- **The switch:** fundraising on or off (admin only), off when it ships.
- **The list:** every sign-up with its path, status (New, Approved, Declined, Finished), date, raised
  and target, and pills: New (TASK-478), "Changes to check" when an edit is waiting.
- **One sign-up:** everything from the form, including its requests; Approve, Decline (with an
  optional reason kept internal), Mark finished; edit any field directly; upload a photo; the slug;
  the waiting change shown beside the live one with Approve change or Reject change; cash paid in
  (add, remove); the supporter wall with Hide or Show per message; History (audit_log).
- Approving emails the organiser their page link and QR code (or, for a private or event sign-up, a
  short "you're on our list" note).

### Data (additive)

- `fundraising_settings` (one row, `page_on` default false).
- `fundraisers`: id, slug (unique), path (`raising` or `event`), kind, title, description,
  event_date, start_time, venue, town, target_pence, public (bool), status (`new`, `approved`,
  `declined`, `finished`), organiser_name, organiser_email, organiser_phone, social_link,
  social_ok (bool), wants (jsonb: leaflets n, buckets n, shout_out, attend), post_address,
  newsletter_ok (bool), image_src, declined_reason, created_at, approved_at, approved_by, updated_at,
  updated_by.
- `fundraiser_edits`: id, fundraiser_id, changes (jsonb of the editable fields), status (`waiting`,
  `approved`, `rejected`), created_at, decided_at, decided_by.
- `fundraiser_manage_tokens`: token_hash, fundraiser_id, expires_at, used_at.
- `fundraiser_cash`: id, fundraiser_id, amount_pence, paid_in_on, note, created_by, created_at.
- `donations`: fundraiser_id, supporter_message, show_name, message_hidden.
- Everything staff change writes audit_log in the same transaction. Backup table counts updated.

### The QR code

No QR library is reachable (the npm registry is blocked), so `src/fundraising/qr.ts` is a pure
encoder written here: byte mode, error correction level M, versions 1 to 10, all eight masks scored
by the standard penalty rules, output as an SVG path. Tested against known-good codes for fixed
inputs.

## Tests

- Unit: the form and edit schemas, slugs, the meter maths (online plus cash, refunds, over target,
  no target), the wall's name rules, the manage token (hash, expiry, single page), the QR encoder
  against reference codes, the webhook mapping of `fundraiserId`, every admin route's permission,
  and the admin screen and public pages in the jsdom harness.
- BDD against Postgres: sign up, approve, the page appears only when approved and switched on, a
  gift with `fundraiserId` raises the meter and shows on the wall, cash adds, a hidden message
  disappears, a manage edit waits until approved, `/events` redirects.
- Browser checks of the form, the fundraiser page and the admin screen at 1280px and 390px.

## Not doing (stage 1)

- Monthly gifts on fundraiser pages; team fundraising; fundraisers uploading their own photos (staff
  do it); materials, automatic emails and call pills (stages 2 to 4).
