# Newsletter hosted documents (+ maroon frame & preview polish)

Date: 2026-07-22. Approved by the user in-session (approach 1 of 3).

## Problem

1. Newsletter "attachments" are a silent trap: the admin uploads a file, the app sends it,
   and the email relay Worker drops the `attachments` array — recipients never receive it
   (verified in `services/email-relay/src/index.js`: neither the newsletter branch of
   `buildEmail` nor `sendViaResend` forwards attachments).
2. The user wants to include a certificate with a newsletter the way the thank-you email
   includes the letter: a button in the email that opens a hosted page where the recipient
   can view, print, and download the document — not an email attachment.
3. The composer's live preview feels horizontally uneven (rounded corners + scrollbar
   gutter), and the user wants the maroon that today only shows as the inbox page
   background baked into the newsletter itself as a full frame, matching the thank-you
   email's cream-card-on-maroon look.

## Decisions (user-confirmed)

- **Per-newsletter documents** (not a shared library): a document belongs to the issue it
  was uploaded to, exactly like attachments today.
- **Replace attachments entirely**: the attach-to-email path at send time is deleted; the
  upload machinery is repurposed as hosted documents. The relay never needs an
  attachments fix.
- **Approach 1**: reuse the `newsletter_attachments` table and the existing `button`
  block. No migration, no new block type.

## Design

### Storage

`newsletter_attachments` unchanged (UUID id, filename, mime, bytes, byte_size,
cascade-delete with the newsletter). A draft's documents die with the draft; a sent
newsletter is immutable and undeletable (TASK-258), so links in delivered email can never
break. No migration.

### Public routes (new `src/routes/newsletter-documents.ts`, mounted in `src/app.ts`)

- `GET /newsletter/document/:id` — branded viewer page (standalone HTML with inline
  styles, pattern of `src/thank-you/letter-page.ts`): document previewed inline (PDF via
  embed, images via `<img>`), a "Open full size / print" button (opens the file URL — the
  browser's native PDF viewer prints most reliably), and a "Download" button
  (`?download=1`). Malformed/unknown id → branded 404. Page builder is a pure DB-free
  function in `src/newsletter/document-page.ts` (unit-tested).
- `GET /newsletter/document/:id/file` — the bytes, stored mime, `inline` disposition;
  `?download=1` switches to `attachment` with the original filename. Long-lived
  `Cache-Control` (bytes for a given UUID never change).

Access model: the random UUID is the capability (122 bits, unguessable) — same trust level
as the thank-you letter's tokenized link. No auth, no public listing. A forwarded email
exposes the document to whoever holds the link (inherent to links-in-email; accepted).

### Composer (assets/js/admin/app.js + admin.html)

The attachments panel becomes **Documents**: same upload/list/delete endpoints
(`/api/admin/newsletters/:id/attachments` — path kept; renaming the API is churn with no
behaviour change), new per-row **"Insert button"** action that appends the existing
`button` block to the end of the document with
`href = location.origin + "/newsletter/document/" + id` and `label = "Open <filename>"`
(editable like any button label). Copy updated: documents are linked, not attached.

### Send path

`postAdminNewsletterSend` stops loading/encoding attachments; the `attachments` field is
removed from `NewsletterEmail` in `src/clients/email.ts`. Upload/list/delete admin
endpoints stay. The relay is untouched.

### Maroon frame (second PR, with preview polish)

`src/newsletter/theme.ts`: the 660px cream card gains a maroon frame as part of the email
layout itself (email-safe: outer table cell `background:#800000` with ~12px padding all
around the cream card), matching the thank-you letter's framed look, so the frame renders
in every client and in the composer preview. The masthead's existing maroon strip visually
merges with the frame.

### Preview polish (second PR)

Chrome is the user's browser, so the zoom-fit mechanism works; the unevenness is visual.
With the frame in place the preview reads edge-to-edge maroon; additionally square the
preview wrapper's inner geometry (align radius/scrollbar-gutter so nothing looks clipped).

## Testing

- Unit (Vitest, DB-free): document-page builder — PDF vs image preview markup, escaping,
  download/print hrefs, 404 page; theme frame present in rendered newsletter HTML.
- BDD (Cucumber): upload a document to a draft via the admin API, then fetch the public
  viewer page (200, contains print + download links) and the file route (bytes, mime,
  disposition switches with `?download=1`); unknown id → 404; send payload carries no
  attachments.
- README updated in the same PRs (golden rule 7).

## Rollout

Two PRs, one task each: (1) hosted documents replacing attachments; (2) maroon frame +
preview polish. Both green through pr.yml, squash-merged, staging-deployed via /ship;
production promote stays manual.
