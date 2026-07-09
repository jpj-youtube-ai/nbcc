# Newsletter block builder — compose & preview

**Requirement:** REQ-069 (Admin-authored newsletter, sent to consenting donors)
— extends the existing newsletter feature (TASK-161) with a block-based
composer + live preview, replacing the raw-HTML `<textarea>` authoring surface.

> `SPEC.md` is a machine-generated projection and is never hand-edited. REQ-069
> is the existing newsletter requirement; this task evolves its authoring UX. The
> send / recipients / unsubscribe pipeline from TASK-161 is reused unchanged.

## Summary

Give NBCC staff a two-pane newsletter builder, in the spirit of the thank-you
letter composer: a **left rail** to add content **blocks** (each block type
offers **4 style variants**), and a **right rail** live **preview** of the exact
HTML email that will be sent. The newsletter is stored as a structured **block
document** (JSON), compiled by one pure renderer to a brand-inlined HTML email.
That single renderer backs the preview, the saved record, and the per-recipient
send, so what staff see is what recipients get.

## What already exists (reuse, do not rebuild)

- **`newsletters` table** (id, subject, body_html, status, timestamps, sent_at,
  sent_by, recipient_count) + model in `src/db/newsletters.ts` (list/get/create/
  update/markSent + recipient query). History model: one row per newsletter,
  sent rows immutable.
- **Send pipeline** — `POST /api/admin/newsletters/:id/send` (Admin-only), the
  best-effort per-recipient loop, `sendNewsletter` in `src/clients/email.ts`,
  the stateless-HMAC unsubscribe route + token, and the appended unsubscribe
  footer (`buildNewsletterHtml` in `src/donors/newsletter.ts`). **All unchanged.**
- **Thank-you renderer** — `src/thank-you/letter.ts` (`buildThankYouEmailHtml`)
  is the template for a pure, DB-free, brand-inlined email builder. The block
  renderer mirrors its palette, fonts, 660px cream-card-on-maroon frame, and
  fixed contact/legal footer bar.
- **Config** — `NEWSLETTER_FROM_EMAIL` already wired. No new config value.
- **Hosted image assets** — `https://nbcc.scot/assets/img/*` (logo, elf,
  `home-red-bags-handover.jpg`, `why-packing.jpg`, `story-tygan.jpg`, ~18
  `team-*.jpg` volunteer portraits). These stay available as a quick-pick
  library; email needs absolute URLs, which these are.

## Image uploads (new subsystem)

Staff **upload** an image on any image-bearing block and get back a durable
absolute URL to embed in the email. Fitting the stack (stateless Fargate, RDS as
the only persistence, no S3 in-stack, "don't fight the deploy model"), uploads
are **stored in Postgres and served by an Express route** — no new AWS infra.

- **Table** (additive migration) `newsletter_images`:
  | column | type | notes |
  |---|---|---|
  | `id` | uuid PK, default `gen_random_uuid()` | unguessable id → the public URL |
  | `mime` | text, not null | one of `image/png|jpeg|webp|gif` (validated) |
  | `bytes` | bytea, not null | the image data |
  | `byte_size` | integer, not null | for the size cap + listing |
  | `uploaded_by` | integer, null, FK → `users` (onDelete SET NULL) | who uploaded |
  | `created_at` | timestamptz, not null, default now() | |
- **Upload** `POST /api/admin/newsletter-images` (**Editor+**, JSON
  `{ filename, mime, dataBase64 }`). Validates mime against the allow-list and
  size against a **2 MB** cap (reject → 400/413), decodes, inserts, and returns
  `{ id, url }` where `url = ${PORTAL_BASE_URL}/media/newsletter/<id>`.
- **Serve** `GET /media/newsletter/:id` — **public, unauthenticated** (email
  clients fetch images with no session), new `src/routes/newsletter-images.ts`
  mounted in `src/app.ts`. Looks the row up by uuid (no path input → no
  traversal), streams `bytes` with the stored `Content-Type`,
  `X-Content-Type-Options: nosniff`, and a long `Cache-Control` (immutable id).
  Unknown id → 404. The mime allow-list is raster-only (no SVG) so a served
  upload can't carry script. The `/media/*` prefix is
  deliberately **not** under `/assets` so it never collides with the static file
  server or the Dockerfile page-list guards.
- Not a secret: images aren't sensitive, the uuid is the capability, and the
  bytes are what recipients see anyway.

## Data model (additive migration — expand/contract safe)

`ALTER TABLE newsletters ADD COLUMN body_json jsonb` (nullable). The block
document is the **source of truth** going forward; `body_html` remains as the
compiled render (immutable record + the string the send loop wraps + sends).

- **Save** compiles `body_json → body_html` server-side and stores both.
- **Legacy rows** (null `body_json`, non-null `body_html`) open in the editor as
  a single **`rawHtml` passthrough block** carrying the existing HTML, so no
  existing draft breaks and the round-trip is lossless.
- The migration converts the existing **seed draft** into a starter block
  document (masthead + greeting + a text block + a donation CTA) so the tab
  demos the builder on first load. Additive + safe.

No destructive change; `body_html` is retained, not dropped.

## The block document

```ts
interface NewsletterDoc { blocks: Block[]; }
interface Block {
  type: BlockType;        // see catalogue
  variant: number;        // 0..3 — which of the 4 styles
  data: Record<string, unknown>; // block-specific fields (text, imageUrl, href, label, items[]…)
}
```

Stored verbatim as `body_json`. The renderer is a pure function:

```ts
// src/newsletter/blocks.ts
renderNewsletter(doc: NewsletterDoc, ctx: { firstName: string }): string
```

It wraps the blocks in the fixed frame (maroon page → 660px cream card →
blocks → NBCC contact/legal footer bar) and returns a complete, inline-styled
HTML email. Palette/fonts are the hex/stack mirrors already in `letter.ts`
(MAROON `#800000`, CRIMSON `#C02238`, CREAM `#F8F5EE`, SLATE `#333`, TAN_SOFT
`#F3E4DD`, HOLLY_DARK `#123C12`; Playfair/Poppins fallbacks). All staff- and
donor-supplied strings are HTML-escaped. The footer bar mirrors the brand
footer: `01292 811 015 · info@nbcc.scot · nbcc.scot` + the OSCR charity line.

## Block catalogue (charity best-practice + the mockup)

Every type ships **4 variants** (`variant: 0..3`). Full set shipped in this PR:

| type | purpose | 4 variants |
|---|---|---|
| `masthead` | issue header | centered logo+title · logo-left/date-right · title-over-hero · slim wordmark |
| `greeting` | "Dear {{firstName}}," (merge) | plain · greeting+lead intro · headline+greeting · warm/casual |
| `text` | body copy | paragraph · lead (large) · pull-quote (serif italic crimson) · highlighted callout (tan/crimson bar) |
| `heading` | section title | crimson serif centered · kicker+title · maroon band · uppercase eyebrow |
| `image` | single image | full-width · rounded · with caption · framed |
| `story` | article/achievement: image+title+text+"Read more" | image-top · image-left · two-up row · text-only w/ rule |
| `spotlight` | volunteer/beneficiary: photo+name+quote | photo-left · centered avatar · big-quote · tinted card |
| `stats` | impact numbers | one big number · 3-across row · number+caption · inline highlight |
| `waysToHelp` | Donate / Volunteer / Spread the word | 3 icon columns · stacked list · 2-up · single CTA |
| `events` | date badge + name + location + Register | date-badge rows · simple list · cards · single featured |
| `donationCta` | closing "Make a donation today" banner | image+button · tinted band · split · centered |
| `button` | standalone CTA | primary crimson · outline · full-width · text+arrow |
| `divider` | rhythm | hairline · short crimson rule · blank space · small mark |
| `rawHtml` | legacy passthrough (not in palette) | — single render, back-compat only |

`stats` (impact numbers) and `waysToHelp` (clear action trio) are added beyond
the two mockup examples — charity-newsletter guidance flags both as the
highest-engagement sections, and both appear in the reference mockup.

## Builder UX (`admin.html` + `assets/js/admin/app.js` + `assets/css/admin.css`)

Two-pane, same conventions as the thank-you compose view (`.ty-*` → new `.nl-*`
styles). Vanilla JS, no framework (matches the repo).

- **Left rail — palette + canvas.**
  - "Add block": the palette of types. Selecting a type reveals its **4 variant
    thumbnails**; picking one appends a block (with sensible default data) to the
    canvas.
  - **Canvas**: ordered list of added blocks. Each block card has: move up / move
    down, duplicate, delete, a **variant switcher**, and inline **fields** for
    its data (text areas, an **image field** = **Upload** (primary; posts to
    the upload endpoint, drops the returned URL in) + "NBCC library" quick-pick
    from the known `/assets/img/*` assets + manual URL paste as fallback; button
    label/href, event/stat/column repeaters).
- **Right rail — live preview.** An `<iframe srcdoc>` showing the real rendered
  email. On any edit (debounced ~300 ms) the client POSTs the current doc to a
  **preview endpoint** and swaps in the returned HTML. Same renderer as send →
  zero drift. Preview uses sample first name **"Jane"**.
- Subject field, Save (Editor+), Send to subscribers (Admin-only) — unchanged
  positions/behaviour. Save is disabled once `status = 'sent'`.

## API changes (`src/routes/admin.ts`)

- `POST /api/admin/newsletters` and `PUT /api/admin/newsletters/:id` accept
  `{ subject, bodyJson }` (Editor+). Server validates `bodyJson` against the
  block schema, compiles `body_html = renderNewsletter(doc, {firstName:'friend'})`,
  and stores both. PUT still 409s on a `sent` row.
- `GET /api/admin/newsletters/:id` returns `bodyJson` (plus `bodyHtml` for the
  legacy/passthrough case).
- **New** `POST /api/admin/newsletters/preview` (Editor+) — body `{ bodyJson }`,
  returns `{ html }` = `renderNewsletter(doc, {firstName:'Jane'})`. Stateless,
  no DB write. Powers the live preview.
- `POST /api/admin/newsletters/:id/send` — **per-recipient merge**. The recipient
  query gains the donor **name**; first name = first whitespace token, fallback
  **"friend"**. For each recipient the row's `body_json` is re-rendered with
  their first name, then wrapped with the unsubscribe footer and sent. (Legacy
  rows with only `body_html` render the passthrough — no merge.) Idempotent
  409-on-sent, best-effort loop, and immutability all unchanged.

## Personalisation

Merge is applied at **render time from `body_json`**, never baked once — so each
recipient gets their own name and the stored source stays a clean template. The
immutable "what was sent" record is `body_json` + `sent_*` metadata; a re-render
is deterministic.

## Testing

- **Unit (Vitest, DB-free)** — `test/unit/newsletter-blocks.test.ts`:
  - each block `type` × each `variant` renders its expected inline markers;
  - the fixed frame + footer bar wrap every render;
  - `{{firstName}}` merge substitutes the ctx name; empty/unknown → "friend";
  - HTML-escaping of staff/donor strings (XSS-safe);
  - `rawHtml` passthrough renders its HTML verbatim inside the frame;
  - schema validation rejects an unknown `type` / out-of-range `variant`.
  - Existing `test/unit/newsletter-html.test.ts` (unsubscribe footer) still green.
- **BDD (Cucumber, HTTP)** — extend `features/newsletter.feature`:
  - Editor creates a **block-doc** draft → save → `body_html` compiled non-empty;
  - `POST …/preview` returns HTML containing a greeting + a chosen block's marker;
  - Admin send → each stubbed email rendered with the recipient's first name;
    re-send → 409; unsubscribe still flips `email_consent` and excludes them.
  - Viewer refused edit, Editor refused send (unchanged role gates).

## Docs

`README.md` — update the Newsletter admin-tab description (block builder + live
preview + image upload + NBCC image library); note the `body_json` column, the
`newsletter_images` table, and the public `/media/newsletter/:id` route. No new
config.

Add unit + BDD coverage for uploads: mime/size validation (reject a non-image
and an over-cap payload), upload → `GET /media/newsletter/:id` round-trips the
bytes with the right `Content-Type`, unknown id → 404, and the returned URL
renders inside a preview.

## Files touched (planned)

- `migrations/<ts>_newsletter-body-json.js` — add `body_json`; convert seed draft.
- `migrations/<ts>_newsletter-images.js` — **new**: `newsletter_images` table
  (needs `pgcrypto`/`gen_random_uuid`).
- `src/newsletter/blocks.ts` — **new**: block types, schema validation, the pure
  `renderNewsletter` (all 14 types × 4 variants + frame + footer + merge).
- `src/db/newsletters.ts` — persist/read `body_json`; recipient query add `name`.
- `src/db/newsletter-images.ts` — **new**: insert/get image rows.
- `src/routes/admin.ts` — accept `bodyJson`; new `/preview` + `/newsletter-images`
  upload; per-recipient merge send.
- `src/routes/newsletter-images.ts` + mount in `src/app.ts` — **new**: public
  `GET /media/newsletter/:id` serve route.
- `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css` — the builder UI.
- `test/unit/newsletter-blocks.test.ts`, `features/newsletter.feature` (+ steps).
- `README.md`.

## Out of scope (YAGNI / follow-ups)

- **S3/CDN** image hosting (in-DB + served route is enough at NBCC's volume;
  revisit if image weight grows).
- WYSIWYG rich-text inside a text block (plain text + variant styling only).
- Test/preview send to self, scheduling, open/click tracking, saved templates,
  drag-and-drop reordering (up/down buttons suffice; DnD is a later polish).
- Background/queued sending for very large lists (already flagged in TASK-161).
