# Thank-you letters (admin) — design spec

**REQ-069** · agreed 2026-07-08 · status: building

Let admin staff send a personalised, branded thank-you to significant donors — as
an email from `giving@nbcc.scot` with a printable PDF attached — and keep a record
of every letter sent. Works for monetary gifts and gifts in kind.

## UX (one "Thank you" tab, after Audit)

1. **Donors to thank** — a list of donors whose **single gift** is over a
   configurable threshold (default £1,000) and who have **not yet been thanked**.
   Each row shows gift, Gift-Aid status and a send-state (Ready / Opted out /
   No email / Thanked <date>). Consent-blocked and already-thanked rows are shown
   but can't be sent (already-thanked has a "thank again" override). A
   **"New thank-you"** button covers givers not in the donor DB (e.g. a company or
   church that donated goods).
2. **Compose & send** — form on the left, **live letter preview on the right that
   updates as you type** (the preview is exactly what gets rendered to PDF). Fields:
   - **Thank-you name** (person *or* organisation) → "Thank you, X."
   - **Addressed to** → "Dear X," (for an org, the contact person)
   - **Gift**: Monetary (£ amount) *or* Gift in kind (free-text "what was given",
     spell-checked, British English)
   - **Gift-Aid uplift** line auto-added for Gift-Aided monetary gifts (25%)
   - **Personal message** (optional)
   - **Signed by** — dropdown of the four signatories (Jodie McFarlane, Isabella
     McFarlane, Jon McFarlane, Jaimie Wakefield); anyone logged in may sign as any
     of them; rendered in a self-hosted **signature webfont**
   - **Letter date**, **recipient email**
   - **Pre-send review**: flags issues (blank/short gift description, double
     spaces, ALL-CAPS, invalid email, missing amount) and reminds to fix
     red-underlined spellings before the send fires. Send / Download PDF.
3. **Sent history** — every letter sent, from the database: Sent (date/time),
   Recipient, Gift, **Signed by**, **Sent by** (the logged-in actor — distinct
   from the signatory), and **View PDF** (re-rendered from stored fields). Search
   + Export CSV.

## Letter design (locked)

Branded A4, tokens/fonts only from `styles.css`. Deep-maroon frame, cream sheet;
Elves Workshop letterhead (no recipient postal address — often unknown); large
`nbcc-logo.png` top-right with "HERE ALL YEAR" set beneath in the site font; crimson
Playfair title; slate Poppins body; tan/crimson gift callout (+ holly Gift-Aid
uplift note); italic personal message; **full-name script signature** + typed role;
crimson pull-quote; donate CTA; maroon contact bar (`01292 811 015` ·
`giving@nbcc.scot` · Facebook/Instagram `nbcc.scot`); SC047995/OSCR line. Fits one
A4 page. Preview: `assets/thankyou-mockup.html` (dashboard) + `assets/thankyou-letter-print.html` (letter).

## Data model

`thank_you_sent` (additive migration) — one row per letter sent, powering three
things: **dedupe** (the not-yet-thanked list), **audit** (also written to the audit
log), and the **Sent history** view. Stores enough to re-render the PDF:
donor_id (nullable — non-donor givers), recipient/thank-you name, addressed-to,
recipient email, gift_type (money|in_kind), gift_amount_pence (nullable),
gift_in_kind (nullable text), gift_aided (bool), personal_message, signed_by_name,
sent_by (actor), sent_at.

## Delivery / infra

- **Email** reuses `EMAIL_SEND_URL` → the relay → Resend, via a new
  `sendThankYouLetter()` in `src/clients/email.ts` and a **new discriminator branch
  in the relay's `buildEmail`** (so it gets its own subject). **From/reply-to =
  `giving@nbcc.scot`** (relay change; `nbcc.scot` already verified).
- **PDF**: a small **HTML→PDF worker** (mirrors the email relay; keeps headless
  Chrome off the Fargate image) renders the same letter HTML to a PDF; the relay is
  extended to carry Resend `attachments`. New config `PDF_RENDER_URL` wired via
  `/add-config` (schema + `.env.example` + SSM + ECS task def).
- **Signature font**: one self-hosted webfont (added to the 2-font system, used only
  for signatures) so it renders identically for everyone.

## Task breakdown (each a green, tested PR, one REQ-069 task per PR)

- **TASK-161** — migration `thank_you_sent` (the database) + db-access module.
- **TASK-162** — `GET /api/admin/thank-you/eligible?threshold=&…` (single-gift ≥ £X,
  not-yet-thanked, consent state). Pure threshold/eligibility logic unit-tested.
- **TASK-163** — `POST /api/admin/thank-you/send` (validate, consent guard, write
  row + audit). BDD scenario.
- **TASK-164** — `sendThankYouLetter()` + relay discriminator branch + giving@
  from/reply-to. BDD.
- **TASK-165** — HTML→PDF worker + relay `attachments` + `PDF_RENDER_URL` config.
- **TASK-166** — server-rendered branded letter template (personalised) → preview + PDF.
- **TASK-167** — admin "Thank you" tab: donors list, composer + live preview,
  pre-send review, Sent history, view/download.
- **TASK-168** — in-app threshold + basis setting (default £1,000, single gift).

## Decisions locked

Single-gift threshold (not cumulative) · Gift-Aid uplift shown · gift-in-kind
supported · signatory dropdown of four full names · self-hosted signature font ·
giving@nbcc.scot sends & receives · live preview before send · Sent history retained.
