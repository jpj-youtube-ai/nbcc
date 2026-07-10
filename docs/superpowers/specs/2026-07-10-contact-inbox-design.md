# Contact Form Inbox — Design Spec

**Date:** 2026-07-10
**Status:** Approved (brainstorming) → ready for implementation plan
**Feature:** Persist public contact-form submissions and surface them in a new
"Contact form" tab inside the existing `/admin` panel, with a Gmail reply action.

## Goal

Every submission of the public contact form (`/contact` → `POST /api/contact`)
is stored and appears newest-first in a new **Contact form** tab in the single
existing `/admin` panel. Staff can read the full message, open a pre-filled
Gmail reply (which marks the enquiry **Replied**), and delete it. The current
external email-forwarding behaviour is retired.

## Why (context)

Today `POST /api/contact` validates the enquiry and forwards it to an external
form service (`src/clients/contact.ts` → `forwardEnquiry`); **nothing is
stored**, so there is no record to show in `/admin`. This feature adds
persistence and an admin view. It is deliberately modelled on the already-live
**My Story** feature (separate DB + `/admin` tab), reusing that proven
machinery rather than inventing anything new.

## Decisions (locked during brainstorming)

1. **Storage: a dedicated, isolated `contact` database** with its own restricted
   login (`contact_app`), on the same RDS server, walled off from **both** the
   donor/financial `charity` DB **and** the `stories` DB. Rationale: the owner's
   bar is "if there is *any* chance of accidental deletion/editing of the main
   data, separate it." A shared-DB table is safe at the SQL level but still runs
   under a login that *can* write donor rows; a dedicated DB+login makes it
   provably impossible for contact code to touch donor, Gift-Aid, or story data.
2. **Retire the external email forward.** Enquiries are no longer forwarded to a
   form service. They are stored, full stop.
3. **Reply via Gmail.** Each enquiry has a "Reply in Gmail" button that opens
   Gmail's web compose in a new tab, pre-filled with the sender's address, a
   subject, and a body quoting the original message **with its submission date
   and time**.
4. **Marking "Replied".** We cannot detect an actual Gmail send (that happens
   entirely inside Google). So clicking **"Reply in Gmail"** both opens the
   compose tab **and** flips the enquiry to **Replied** in the same action. The
   enquiry records **who** marked it replied — the logged-in admin's email, taken
   from the session claims (`authorizeAdmin` already exposes `claims.email`; same
   source as the donor-audit `actorOf`) — and **when** (`replied_at`). Any admin
   can **unmark** it back to New (which clears `replied_at`/`replied_by`). No
   Gmail-API integration.
5. **One admin page.** This is the same `/admin` panel and login that already
   exists — a new tab beside Overview, Donations, Gift Aid, Stories, etc. The
   only thing "separate" is the database behind that one tab.

## Architecture

Same shape as My Story. A second isolated Postgres database on the shared RDS
instance, reached through its own connection pool, provisioned imperatively
(bootstrap → migrate → deploy), and exposed only through authenticated
`/api/admin/contact*` routes.

```
public /contact form
   │  POST /api/contact  (honeypot + rate-limit, dual content-type)
   ▼
insertEnquiry()  ──►  contactPool  ──►  [ contact DB · contact_enquiries ]
                                              ▲
/admin "Contact form" tab                     │
   GET/PATCH/DELETE /api/admin/contact*  ──────┘  (authorizeAdmin: viewer read, editor write)
```

### Data model

One additive table `contact_enquiries` in the `contact` DB
(`migrations-contact/<ts>_create-contact-enquiries.js`, additive-only):

| column       | type                    | notes                                        |
|--------------|-------------------------|----------------------------------------------|
| `id`         | serial primary key      |                                              |
| `first_name` | text not null           |                                              |
| `last_name`  | text not null default ''| optional on the form                         |
| `email`      | text not null           |                                              |
| `message`    | text not null           | length-capped in the app schema (≤ 5000)     |
| `status`     | text not null default 'new' | CHECK IN ('new','replied') — defence in depth |
| `created_at` | timestamptz not null default now() |                                    |
| `replied_at` | timestamptz             | set when marked replied; null otherwise      |
| `replied_by` | text                    | email of the admin who marked it replied; null otherwise |

No `audit_log` table (mirrors the stories DB — this DB holds only contact
enquiries and nothing references an audit table).

## Components

### Config & infra (golden rule 3 — every touch-point)
- `src/config/schema.ts` — add `CONTACT_DATABASE_URL` (URL).
- `.env.example` — add `CONTACT_DATABASE_URL` (local value pointing at localhost).
- `infra/modules/app/main.tf` — `random_password.contact` + `aws_ssm_parameter.contact_db_url` (assembles the URL with `sslmode=no-verify`, mirroring `stories_db_url`).
- `infra/modules/app/ecs.tf` — task-def `secrets` entry for `CONTACT_DATABASE_URL` **and** its SSM ARN added to the `exec_secrets` IAM policy.

### Database access
- `src/db/contact-pool.ts` — a **separate** `Pool` on `config.CONTACT_DATABASE_URL` (mirrors `stories-pool.ts`; `max: 5`). The **only** pool the contact feature may use; never imports `src/db/pool.ts` or `stories-pool.ts`.
- `src/db/contact.ts` — `insertEnquiry`, `listEnquiries(status?)`, `getEnquiry(id)`, `markReplied(id)`, `deleteEnquiry(id)`. All parameterised, all via `contactPool`.

### Provisioning (bootstrap → migrate → deploy ordering is load-bearing)
- `scripts/bootstrap-contact-db.mjs` — copy of `bootstrap-stories-db.mjs`, renamed for `contact` DB + `contact_app` role (keep the `GRANT <role> TO CURRENT_USER` before `CREATE DATABASE OWNER` fix, and no transaction around `CREATE DATABASE`).
- `package.json` — `"migrate:contact": "node-pg-migrate -m migrations-contact -d CONTACT_DATABASE_URL up"` and `"bootstrap:contact": "node scripts/bootstrap-contact-db.mjs"`.
- `Dockerfile` — `COPY migrations-contact ./migrations-contact` **and** `COPY scripts/bootstrap-contact-db.mjs ./scripts/bootstrap-contact-db.mjs` (the MODULE_NOT_FOUND gotcha from My Story — must ship in the image).
- `docker-compose.yml` — `CONTACT_DATABASE_URL` env, a create-contact-db init step, and a `migrate-contact` one-off service (mirror the stories entries).
- `.github/workflows/pr.yml` — add `CONTACT_DATABASE_URL` to the job env, a "Create contact database" psql step, and `npm run migrate:contact`. (CI app-boot needs the env var present.)
- `.github/workflows/deploy-staging.yml` & `deploy-prod.yml` — add "Bootstrap contact database" then "Run contact DB migrations" ECS run-task steps (bootstrap **before** migrate), mirroring the stories steps.

### Public submission endpoint
- `src/contact/schema.ts` — Zod schema: `firstName` (1–100), `lastName` (≤100, optional default ''), `email` (valid email, ≤254), `message` (1–5000). Reject on failure with 400.
- `src/routes/api.ts` — rewrite `postContact`:
  - Accept **both** JSON and form-urlencoded (progressive enhancement; the form has `action="/api/contact" method="post"` and also posts via fetch), mirroring the My Story endpoint.
  - **Honeypot** hidden field (e.g. `company`): if filled, return a 200 "sent" without storing (silent drop), mirroring My Story.
  - **Rate limit** via the existing `createRateLimiter` (`src/portal/request-limiter.ts`) — a `contactLimiter`.
  - On valid input, `insertEnquiry(...)` → `200 { status: "sent" }`. On DB error → `500` (the front-end shows an error and preserves the message — honest-save).
  - Remove the `forwardEnquiry` call. `src/clients/contact.ts` is retired from the flow.
- `contact.html` — add the hidden honeypot field; keep the existing form otherwise. Field names stay `firstName`, `lastName`, `email`, `message`.
- `assets/js/main.js` (`initContactForm`) — **honest-save**: await the fetch, show success **only** on `res.ok` (200); on 4xx/5xx show an error and keep the entered message; guard against double-submit. Drop the old "degrade to mailto on 502" path (there is no forward to fail now; a real failure should surface as a retryable error, not silently hand off to a mail client).

### Admin tab (same `/admin` page)
- `src/routes/admin.ts` — new routes on `adminRouter`, guarded by `authorizeAdmin`:
  - `GET /api/admin/contact?status=` — list newest-first, optional status filter. **Viewer+**.
  - `GET /api/admin/contact/:id` — full record. **Viewer+**.
  - `PATCH /api/admin/contact/:id` — body `{ status: 'replied' | 'new' }`; sets/clears `replied_at`. **Editor+**.
  - `DELETE /api/admin/contact/:id` — hard delete. **Editor+**.
  - Reads/writes go to `contactPool` only.
- `admin.html` — a nav `<li><button data-view="contact">Contact form</button></li>`; a `#view-contact` section (intro + `New / Replied / All` segmented filter + `#contactTable`); a `#view-contact-detail` section (`#contactDetail`, a `#contactBack` button, an action status line).
- `assets/js/app.js` (admin front-end) — `loadContact()` (list), row → detail, a **Reply in Gmail** button, a **Delete** button, and the segmented status filter. The Reply button: open the Gmail compose URL in a new tab **and** PATCH status→replied, then refresh the row.
- **Gmail reply URL builder** — a pure function `buildGmailReplyUrl(enquiry)` returning
  `https://mail.google.com/mail/?view=cm&fs=1&to=<email>&su=<subject>&body=<body>`
  with `subject = "Re: your message to NBCC"` and a body that quotes the original
  message under a `Received: <formatted created_at>` / `From: <name> <<email>>`
  header. Authored as an importable module so it is **unit-tested** without a
  browser.

## Data flow

1. Visitor submits `/contact`. Browser posts JSON via fetch (or form-urlencoded with no JS).
2. `postContact` validates, checks honeypot + rate limit, `insertEnquiry` → row in `contact` DB, `200`.
3. `initContactForm` shows success only on 200; error otherwise (message preserved).
4. Staff open `/admin` → **Contact form** → `loadContact` lists rows.
5. Staff open a row → full message + submission time.
6. Staff click **Reply in Gmail** → Gmail compose opens pre-filled → PATCH status→replied.
7. Staff may **Delete** an enquiry (hard delete).

## Error handling

- Invalid submission → 400 with field errors (front-end shows inline errors).
- Honeypot filled → 200 "sent", nothing stored (silent spam drop).
- Rate-limit exceeded → 429.
- DB write failure → 500; front-end shows a retry error and keeps the message.
- Admin routes: 400 on bad id/body, 404 on missing row, 401/403 via `authorizeAdmin`.
- Contact DB unreachable → admin list shows an error state; the public form's
  failure is independent of donor/story data (isolated pool).

## Testing

- **Unit (Vitest, DB-free):**
  - `src/contact/schema.ts` — accept valid, reject each invalid field, enforce caps.
  - `buildGmailReplyUrl` — correct URL, encoding, subject/body, date formatting.
  - `bootstrap-contact-db.mjs` URL parse/quote helpers (mirror the stories bootstrap URL test).
  - Honeypot behaviour (pure branch) where feasible.
- **BDD (Cucumber):** update `features/contact.feature` — submitting a valid
  enquiry returns success (stored); the old forward/502 scenario is replaced.
- **Guard test:** extend the Dockerfile "scripts shipped" unit test to assert
  `migrations-contact` and `bootstrap-contact-db.mjs` are COPYed (prevents the
  MODULE_NOT_FOUND regression).

## Documentation (golden rule 7)

Update `README.md` for: the new `CONTACT_DATABASE_URL` config, the `contact` DB +
`migrate:contact`/`bootstrap:contact` scripts, the retired forward, the new
`/api/admin/contact*` routes, and the Contact form admin tab.

## Out of scope (v1)

- Gmail-API send detection / automatic "replied" (not possible without deep OAuth).
- Removing the now-orphaned `CONTACT_FORWARD_URL` config + `src/clients/contact.ts`
  file: left in place to keep this PR focused; noted as a follow-up cleanup.
- Tags, admin notes, multi-status workflow beyond New/Replied.
- Attachments / file uploads.
```
