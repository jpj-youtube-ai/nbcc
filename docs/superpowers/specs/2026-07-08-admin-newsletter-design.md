# TASK-161 — Admin newsletter: edit, save, send to subscribers

**Requirement:** REQ-066 (new) — Admin-authored newsletter, sent by email to consenting donors.

## Summary

Give NBCC staff an admin tab to write an HTML newsletter, save it, and (as an
Admin) send it as an individual email to every donor who consented to marketing
at donation time. Recipients can reply (real inbox, not noreply) and can
unsubscribe via a link that flips their consent off.

## Context / what already exists (reuse, don't rebuild)

- **Subscribe flag** — `donors.email_consent` (boolean), captured at Stripe
  checkout. The newsletter audience is exactly the donors with this flag set and
  a non-null email. No new opt-in plumbing.
- **Admin page** — a single `admin.html` served by Express, with a `data-view`
  tab nav (Overview / Search / Donations / Claims / GASDS / Subscriptions /
  Audit) toggled by the admin JS, backed by the role-gated API in
  `src/routes/admin.ts`. A new "Newsletter" tab slots in the same way.
- **Email client** — `src/clients/email.ts`, a thin `fetch` wrapper over
  `config.EMAIL_SEND_URL` with a stub seam: a placeholder `.example` URL means
  "no network" outside production (so local + CI exercise the flow without a
  provider), a real URL POSTs in every environment, production never stubs.
- **Config reuse** — `PORTAL_BASE_URL` (public site base, ships in emails) is
  reused to build the unsubscribe link; `ADMIN_SESSION_SECRET` is reused as the
  HMAC key for unsubscribe tokens. Only one new config value is introduced.

## Roles

- **Editor+** can create and edit (save) newsletter drafts.
- **Admin only** can send. The Send control is Admin-gated in the UI and the
  send endpoint re-checks the role server-side.

## Data model (additive migration — expand/contract safe)

New table `newsletters`:

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `subject` | text, not null | |
| `body_html` | text, not null | raw HTML authored by staff |
| `status` | text, not null, default `'draft'` | check in (`'draft'`,`'sent'`) |
| `created_at` | timestamptz, not null, default now() | |
| `updated_at` | timestamptz, not null, default now() | |
| `sent_at` | timestamptz, null | set when sent |
| `sent_by` | integer, null, FK → `users` (onDelete RESTRICT) | admin who sent |
| `recipient_count` | integer, null | number of emails attempted at send |

The migration also **seeds one starter draft row** (placeholder subject + body)
so the tab is never empty on first load ("give me one by default"). Seeding a
row is additive and safe.

**History model:** each newsletter is its own row. New drafts never overwrite
older ones; sent newsletters remain as an immutable record (what went out, when,
by whom, to how many).

## Recipients

```sql
SELECT DISTINCT lower(email) AS email, min(id) AS donor_id
FROM donors
WHERE email_consent = true AND email IS NOT NULL
GROUP BY lower(email)
```

Dedupe by lowercased email (a person and a company, or repeat donations, can
produce more than one donor row for the same address). One `donor_id` per email
is used to mint that recipient's unsubscribe token.

## Email client

New `sendNewsletter(message)` in `src/clients/email.ts`, same stub-seam and
best-effort contract as the existing sends. Payload:

```ts
interface NewsletterEmail {
  to: string;        // recipient email
  from: string;      // config.NEWSLETTER_FROM_EMAIL  (newsletter@nbcc.scot)
  replyTo: string;   // same as from — replies reach a real inbox, not noreply
  subject: string;
  html: string;      // body_html + an appended unsubscribe footer link
}
```

## Admin API (role-gated, in `src/routes/admin.ts`)

All under the existing admin bearer-token auth. Role checks reuse the existing
session-role helper.

- `GET  /api/admin/newsletters` — list (id, subject, status, sent_at,
  recipient_count), Editor+.
- `GET  /api/admin/newsletters/:id` — one newsletter incl. `body_html`, Editor+.
- `POST /api/admin/newsletters` — create a new draft `{subject, body_html}`,
  Editor+.
- `PUT  /api/admin/newsletters/:id` — edit `{subject, body_html}`, Editor+,
  **only while `status = 'draft'`** (a sent newsletter is immutable → 409).
- `POST /api/admin/newsletters/:id/send` — **Admin only**. Guards:
  - not found → 404; already `sent` → **409** (idempotent; a double-click or
    retry cannot re-blast).
  - Load recipients (query above). For each, build the unsubscribe link and send
    one individual email (best-effort loop; a single failed send is logged, not
    fatal). Then mark the row `sent`, set `sent_at = now()`,
    `sent_by = <admin id>`, `recipient_count = <attempted>` in one update.
  - Returns `{ status: 'sent', recipientCount }`.

Note on send volume: the send loops synchronously over the consented-donor list
within the request. For NBCC's donor base this is acceptable; if the list grows
large enough to risk a request timeout, moving the loop to a background job is a
follow-up (called out here, not built — YAGNI now).

## Unsubscribe (compliance — PECR/UK GDPR)

Public route `GET /unsubscribe/:token` (new `src/routes/unsubscribe.ts`, mounted
in `src/app.ts`):

- **Stateless HMAC token**, no extra table. Token encodes the `donor_id` plus an
  HMAC-SHA256 signature over it, keyed by `ADMIN_SESSION_SECRET`. Build/verify
  live in a pure module (`src/donors/unsubscribe-token.ts`) so they are
  unit-testable without a DB.
- On a valid token, set `email_consent = false` for that donor (idempotent — a
  second visit is a no-op) and return a small HTML confirmation page rendered by
  the route (no new static `.html` file → avoids the Dockerfile-COPY / page-list
  guard drift). Invalid/garbled token → 400 with a plain message.
- Every newsletter email's HTML gets an appended footer:
  `You're receiving this because you opted in when you donated. Unsubscribe:
  ${PORTAL_BASE_URL}/unsubscribe/${token}`.

## Config (golden rule 3)

One new **non-secret** config value, wired via the `/add-config` recipe:

- `NEWSLETTER_FROM_EMAIL` — `z.string().email()`, default
  `newsletter@nbcc.scot`. The `From` and `Reply-To` of every newsletter email.
  Wire through: `src/config/schema.ts`, `.env.example`, the SSM **String**
  parameter (`infra/modules/app/main.tf`), the task-def `environment` block
  (`infra/modules/app/ecs.tf`), **and** `pr.yml`'s env block (CI app-boot needs
  every required key). Non-secret → no `exec_secrets` IAM entry needed.

No new secret: the HMAC key reuses `ADMIN_SESSION_SECRET`; the link base reuses
`PORTAL_BASE_URL`.

**Dependency (external, flagged):** `newsletter@nbcc.scot` must be a verified
sender on the email provider behind `EMAIL_SEND_URL`, and the provider must honour
per-message `from`/`replyTo`. Not a code change; noted as an ops prerequisite for
production sends.

## Testing

- **Unit (DB-free, Vitest):**
  - unsubscribe token — sign then verify round-trips; a tampered token fails.
  - recipient dedupe — pure helper collapses duplicate emails case-insensitively.
  - newsletter HTML assembly — footer/unsubscribe link is appended correctly.
  - send-guard predicates — cannot send a `sent` newsletter; role predicate
    allows Admin, denies Editor/Viewer.
- **BDD (Cucumber, HTTP):**
  - Editor creates + edits a draft; Viewer is refused edit.
  - Admin sends a draft (email stubbed) → newsletter becomes `sent`,
    `recipient_count` matches the consented donors; re-send → 409.
  - Editor is refused send.
  - `GET /unsubscribe/:token` flips `email_consent` to false and shows the
    confirmation page; a subsequent newsletter excludes that email.

## Docs

`README.md` updated in the same PR: the new `/unsubscribe` route, the Newsletter
admin tab, and the `NEWSLETTER_FROM_EMAIL` config value.

## Files touched (planned)

- `migrations/<ts>_newsletters.js` — new table + seed row.
- `src/db/newsletters.ts` — model: list/get/create/update/markSent + recipient
  query.
- `src/donors/unsubscribe-token.ts` — pure sign/verify.
- `src/donors/newsletter.ts` — pure HTML assembly (append unsubscribe footer).
- `src/clients/email.ts` — `sendNewsletter`.
- `src/routes/admin.ts` — the five newsletter endpoints.
- `src/routes/unsubscribe.ts` + mount in `src/app.ts` — public unsubscribe.
- `src/config/schema.ts`, `.env.example`, `infra/modules/app/{main,ecs}.tf`,
  `.github/workflows/pr.yml` — `NEWSLETTER_FROM_EMAIL`.
- `admin.html` + admin JS — Newsletter tab + editor UI.
- `test/unit/*.test.ts`, `features/newsletter.feature` (+ steps) — tests.
- `README.md`.

## Out of scope (YAGNI / follow-ups)

- Background/queued sending for very large lists.
- Rich-text WYSIWYG editor (staff author raw HTML for now).
- Test/preview send to self, scheduling, open/click tracking, templates.
- A dedicated unsubscribe secret (reusing `ADMIN_SESSION_SECRET` for now).
