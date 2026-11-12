# My Story — public story-sharing page, storage & admin (feature spec)

> **Board note:** this feature is larger than one clean PR, so it is written as an
> **epic of 3 tasks** (A → B → C) plus one deferred task (D). `TASK-NNN` / `REQ-NNN`
> numbers are assigned by the board at claim time (see CLAUDE.md "Task pickup"); the
> letters below are just ordering. Each task ships as its own green PR against its
> own `REQ-NNN`.

## Goal

Give beneficiaries, families, carers, professional partners (social work, schools,
support services), volunteers ("Elves") and supporters a warm, low-pressure way to
share their story with NBCC at `/my-story`. Submissions are **stored** and **managed
inside the existing `/admin` dashboard**. The flow is easier to complete than the
current nightbeforechristmas.co.uk form, and it is compliant with UK GDPR / the
Fundraising Regulator's guidance on collecting and using people's stories.

This replaces a flat ~16-field single page with a **guided 3-step form**, fixes the
consent model to be *specific and informed*, and adds funding-useful signals.

## Non-goals (explicitly out of scope)

- **No public "stories wall"** on the marketing site. This is collection + admin
  only. Nothing auto-publishes; staff use stories manually. The data model leaves
  room to add a wall later with no destructive migration.
- **No photo upload in the form (v1).** The form captures *photo interest* only.
  Real upload is **Task D** (needs S3 + image consent + moderation — see below).
- No automated retention-deletion sweep in v1 (stories are kept indefinitely with
  guardrails — see Retention).

## Regulatory basis (why the form is shaped this way)

Sources: [Fundraising Regulator — Data privacy & fundraising](https://www.fundraisingregulator.org.uk/about-fundraising/resources/data-privacy-and-fundraising),
[CharityComms — case studies/photos are personal data](https://www.charitycomms.org.uk/case-studies-photos-and-films-can-be-personal-data-under-gdpr-too).

- A story that identifies a living person **is personal data**; stories about NBCC's
  beneficiaries (children, vulnerable adults) can be **special-category** data.
- **Lawful basis = consent.** Public use is treated as **explicit, specific consent**:
  we name the channels (website, social, newsletters, press, funding reports) and get
  a distinct opt-in per identifier we might attach (first name, town).
- **Data minimisation:** identifier opt-ins default **off**.
- **Transparency + withdrawal:** the form states plainly that we keep the story as an
  archive unless asked to remove it, and the admin honours withdrawal.
- **Safeguarding:** stories are often *about a third party*. The form asks the
  submitter to confirm they have that person's (or guardian's) permission, and never
  pressures anyone to share identifying detail about a child.

## The form — 3 guided steps

Progress indicator across the top. **Progressive enhancement:** with JS off, all three
steps render as one scrollable form that still validates on submit; JS adds stepping,
the progress bar, and conditional reveals. Voice/tone: gentle, permission-giving,
control-forward (inspired by the old site's copy — *"Share whatever feels right for
you… you will always have full control over how it is used… Your story becomes part
of ours."*) — written fresh, not copied.

Fields marked **\*** are required; everything else is optional.

### Step 1 — You & your story
- **"Which best describes you?"\*** — single choice, inclusive so everyone feels
  addressed:
  `Someone we've supported` · `A parent, family member or carer` ·
  `A volunteer (Elf)` · `A professional partner (social work, school, support service)` ·
  `A supporter or donor` · `Someone else`.
  → maps to `submitter_role`. Doubles as funding provenance and drives the
  professional-partner consent confirm in Step 2.
- **"Your story"\*** — textarea, with gentle prompts (how it felt, the difference it
  made, what stood out, how they heard about NBCC). "Write as much or as little as
  you feel comfortable sharing."
- **"A short quote we could share"** — optional single line.
- Inline safeguarding note: *"Please don't share details that identify someone else —
  especially a child — without their permission."*

### Step 2 — How we can use it (the consent step)
- **"How can we use your story?"\*** — single choice (replaces the old 4-radio bundle):
  - **Publicly** — "you're happy for us to share it (website, social media,
    newsletters, press, funding reports). We may share it in full or in part and edit
    lightly for length/clarity while keeping your meaning." → `use_scope = 'public'`.
  - **Internally only** — "for volunteer training, funding bids and service
    improvement — never published." → `use_scope = 'internal_only'`.
- **If Public** → two identifier opt-ins, **default off**:
  - `"You can share my first name"` → `consent_share_first_name`.
  - `"You can share my town / area"` → `consent_share_town`.
- **If submitter_role = professional partner** → confirm:
  `"I have the permission of the person this story is about (or their parent/guardian)
  to share it."` → strengthens `third_party_consent`.
- **"Would you be happy for us to contact you to hear more?"** — optional. Enables a
  fuller case study for grant bids (uses email). → `contact_for_more`.
- **"We'd love to share a photo too one day"** — optional checkbox
  `"I'd be happy to share a photo — please contact me about this."` → `photo_interest`.
  (No upload in v1 — see Task D.)
- **Retention/withdrawal notice** (static copy): *"We'll keep your story as part of
  our archive unless you ask us to remove it. You can ask us to stop using it or
  delete it at any time — just email us."*

### Step 3 — A little about you (all optional except the final confirm)
- `First name` — "leave blank to stay anonymous" → `submitter_first_name`.
- `Email` — "so we can say thank you or check a detail — never published" →
  `submitter_email`.
- `Phone` — never published → `submitter_phone`.
- `Your age` — `16 to 24` / `25 to 44` / `45 to 64` / `65 plus` → `age_band`.
- `How do you describe your gender?` — free text → `gender` (kept; helpful demographic).
- `Your town / area` → `submitter_town`.
- `The Red Bag went to a:` — `Child` / `Young person` / `Vulnerable adult` →
  `recipient_type`.
- `How did you hear about us?` — free text, **optional** (was required — demoted to
  reduce friction) → `heard_about`.
- **Final confirm\*** (single checkbox, combines age-gate + accuracy + third-party
  permission): *"I'm 16 or over, the information I've given is accurate, and where my
  story involves someone else I have their permission to share it."* → `confirmed_over_16`.

### On success
Inline success state (aria-live) or `/my-story` thank-you view with a warm close
(*"Thank you — your story becomes part of ours."*). No PII echoed back.

## Data model — `stories` table (Task B)

**Lives in a SEPARATE database** (`stories`) on the same RDS server, never in the
main `charity` DB (owner decision — see [[my-story-separate-db]]). The table is the
sole object in that database, created by a migration in its **own** directory
`migrations-stories/<ts>_stories.js` (node-pg-migrate, CommonJS), tracked by that
database's own `pgmigrations` table. Additive-only by construction (a fresh DB), and
it never touches the `charity` DB.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `created_at` | timestamptz, default now() | |
| `consent_captured_at` | timestamptz, default now() | when consent was given — lets admin review age of old consents |
| `submitter_role` | text, null | `supported`/`family_carer`/`volunteer`/`professional_partner`/`supporter_donor`/`other` |
| `story_text` | text, **not null** | the story |
| `short_quote` | text, null | |
| `use_scope` | text, not null, default `'internal_only'` | `public` / `internal_only` |
| `consent_share_first_name` | boolean, not null, default false | |
| `consent_share_town` | boolean, not null, default false | |
| `third_party_consent` | boolean, not null, default false | submitter confirmed permission for anyone else in the story |
| `contact_for_more` | boolean, not null, default false | happy to be contacted for a fuller case study |
| `photo_interest` | boolean, not null, default false | would share a photo (upload = Task D) |
| `submitter_first_name` | text, null | |
| `submitter_email` | text, null | never published |
| `submitter_phone` | text, null | never published |
| `submitter_town` | text, null | |
| `age_band` | text, null | `16_24`/`25_44`/`45_64`/`65_plus` |
| `gender` | text, null | free text |
| `recipient_type` | text, null | `child`/`young_person`/`vulnerable_adult` |
| `heard_about` | text, null | |
| `confirmed_over_16` | boolean, not null, default false | the required final confirm |
| `status` | text, not null, default `'new'` | `new`/`reviewed`/`used`/`withdrawn` — lifecycle + erasure |
| `admin_tags` | text[], null | staff funding/theme tags (admin-only, zero user friction) |
| `admin_notes` | text, null | staff notes |

Text lengths capped in the Zod schema (not the DB) to keep the migration additive.

## Tasks

### Task A — Public My Story page + guided form (frontend only)
*REQ intent: "Public `/my-story` page with a guided 3-step story-submission form."*

- `my-story.html` at repo root, matching the existing page shell (nav, footer, skip
  link, SEO/OG/canonical `https://nbcc.scot/my-story`, brand CSS/fonts).
- Multi-step controller in `assets/js/` (progress, stepping, conditional reveals for
  the public-identifier opt-ins and the professional-partner confirm, client-side
  validation). Progressive-enhancement fallback (all steps visible, native validation)
  when JS is off.
- Clean URL wiring in `_redirects`: `/my-story  /my-story.html  200` + canonical
  `/my-story.html  /my-story  301!`. Add "My Story" to primary nav + footer "Explore".
- **Design skills required** at build time (repo UI rule): `impeccable` +
  `high-end-visual-design`/`minimalist-ui`, then `polish` + `audit`. The form posts
  to `/api/my-story` (wired live in Task B; Task A can stub/no-op the submit).
- **Tests:** Vitest structure/copy/accessibility guards for `my-story.html` (mirror
  `test/unit/contact*`/`nav.test.ts` patterns); BDD `features/my-story.feature` — page
  renders at `/my-story` with the three step regions and required-field markers.

### Task B — Storage: persist submissions to a SEPARATE database
*REQ intent: "Persist My Story submissions to a dedicated stories database with consent & retention metadata."*

The separate-DB decision (own name + credentials, same RDS server) makes this span
app code, migrations tooling, CI, and infra. Split into two shippable slices:

**B1 — App + migrations + CI (one PR, testable in CI):**
- **Config:** add `STORIES_DATABASE_URL: z.string().url()` to `src/config/schema.ts`
  (mirrors `DATABASE_URL`, never defaulted) and a line to `.env.example`
  (`postgres://stories_app:stories@localhost:5432/stories` locally). Golden rule 3.
- **Pool:** `src/db/stories-pool.ts` — a second `Pool` reading `config.STORIES_DATABASE_URL`
  (mirror `src/db/pool.ts`; `max: 5`). This is the ONLY pool the stories feature uses;
  it can never reach the `charity` DB.
- **Migrations:** a new `migrations-stories/` dir + the `stories` table migration; a
  `migrate:stories` npm script pointing node-pg-migrate at `STORIES_DATABASE_URL` and
  `-m migrations-stories` (`DATABASE_URL=$STORIES_DATABASE_URL node-pg-migrate -m migrations-stories up`).
- **Model:** `src/db/stories.ts` — `insertStory(record)` using the stories pool + the
  audit-less single INSERT pattern (no cross-DB audit table; keep it self-contained).
- **Endpoint** `POST /api/my-story` in `src/routes/api.ts`:
  - Accept BOTH `application/json` (JS path) AND `application/x-www-form-urlencoded`
    (no-JS native form POST) — the form's `action`/`method` mean a no-JS submit hits
    this too. On success: JSON → 200 `{ ok: true }`; form POST → 200 self-contained
    `text/html` thank-you response (warm message + link home; links the site
    stylesheet). Chosen over a 303 to a new static thank-you page to avoid adding a
    page/route. (Implemented this way in B1, `src/routes/api.ts`.)
  - Validate with a **Zod schema** (`src/stories/schema.ts`): `storyText` required +
    length-capped; `useScope` enum; role enum; identifier opt-ins boolean/coerced;
    `confirmOver16` must be truthy; email format if present; everything else optional.
    Invalid → 400 (JSON) / re-render with errors (form). Enum values EXACTLY match
    Task A's field values.
  - **Spam/abuse guard:** honeypot `website` must be empty (silently 200, no insert);
    per-IP rate limit via `createRateLimiter` (mirror `portal.ts`). Cap field sizes.
- **CI (`pr.yml`):** create the `stories` database in the Postgres service + set
  `STORIES_DATABASE_URL` + run `npm run migrate:stories`, so BDD can exercise the real
  insert.
- **Tests:** Vitest for the Zod schema (valid/invalid, `confirmOver16` gate,
  scope→identifier rules, honeypot) and the form→record mapping (DB-free); BDD —
  a valid JSON submit and a valid form-encoded submit both persist; missing
  consent/confirm → rejected; honeypot-filled → silently accepted, nothing stored.

**B2 — Infra (Terraform PR via `infra.yml`; MANUAL apply, owner-gated):**
- `random_password.stories` + SSM `STORIES_DATABASE_URL` in `infra/modules/app/main.tf`
  (value `postgres://stories_app:${…}@${rds.address}:5432/stories?sslmode=no-verify`).
- Task-def `secrets` entry + `exec_secrets` IAM ARN in `ecs.tf` (the three-place rule).
- **DB + role creation has no Terraform precedent** (fixed `db_name`, no `postgresql`
  provider, private RDS). Provision imperatively via a one-off **`ecs run-task`** (which
  can reach RDS from the task SG) running a bootstrap: `scripts/bootstrap-stories-db.mjs`
  connects with the MASTER `DATABASE_URL` and idempotently `CREATE DATABASE stories`,
  `CREATE ROLE stories_app LOGIN PASSWORD …` (from the stories secret), `GRANT`s. Wire a
  `bootstrap:stories` npm script + a one-off step in the deploy workflows BEFORE the
  `migrate:stories` step. Bootstrap runs once per environment (idempotent so re-runs are safe).
- **Owner action:** trigger the Infra `apply` (staging), then the deploy runs bootstrap
  + stories migration. I never run `terraform apply`.

### Task C — Admin: view, tag & manage stories (inside `/admin`)
*REQ intent: "Admin panel can view, tag and manage submitted stories, incl. withdrawal."*

- New **"Stories"** tab in the existing dashboard: nav button
  `data-view="stories"` + `<section class="admin-view" id="view-stories">` in
  `admin.html`, rendered by the admin client JS — same pattern as Donations/Search.
- Endpoints in `src/routes/admin.ts` behind the existing session guard
  (`authorizeAdmin`):
  - `GET /api/admin/stories` — list newest-first; filter by `status` and `use_scope`;
    show scope + consent badges + submitter role + age of consent.
  - `GET /api/admin/stories/:id` — full story.
  - `PATCH /api/admin/stories/:id` — update `status` (incl. `withdrawn` = honour
    erasure/withdrawal), `admin_tags`, `admin_notes`. Editor+ role for mutations,
    mirroring existing admin PATCH gating.
- `src/db/stories.ts` gains the admin reads/updates — **all via `storiesPool`** (the
  separate DB; admin code must not reach the `charity` DB for story data). HTML-escape
  story text on render (reuse `escapeHtml` pattern in `site.ts`).
- **Server-side validate the PATCH body** (`status`/`admin_tags`) against the allowed
  enums with Zod before writing — the admin is now a write path into the stories DB.
- **Defense-in-depth (from B1 review):** since Task C adds writes, add DB-level `CHECK`
  constraints for the enum columns (`use_scope`, `submitter_role`, `age_band`,
  `recipient_type`, `status`) via a new additive migration in `migrations-stories/`, so
  invalid values can't be written even by direct DB access. (Deferred from B1 where
  there were no writes yet.)
- **Tests:** Vitest for pure list/badge/render helpers + the PATCH validation; BDD
  `features/admin-stories.feature` — an authed admin lists stories, opens one, and
  withdraws it (then it reads as withdrawn / excluded from use).

### Task D — Optional photo upload (DEFERRED, own task)
*REQ intent: "Optional photo upload for stories with image consent & moderation."*

Not built in this epic. Requires: an S3 bucket + IAM + presigned upload (infra, via the
`infra.yml` plan/apply path, not app deploy), image-specific explicit consent, EXIF/GPS
stripping, size/type caps, and **moderation-before-any-use** (open public image upload
of children/vulnerable adults is the highest-risk surface on the site). The v1 form's
`photo_interest` flag feeds this later.

## Retention (indefinite, with guardrails)

Stories are **kept indefinitely** as an impact archive (per owner decision), made
defensible by three guardrails rather than a hard delete date:
1. **Transparency** — the form states the story is kept as an archive unless removal is
   requested.
2. **Withdrawal** — admin `status = 'withdrawn'` excludes a story from all use (Task C).
3. **Consent-age visibility** — `consent_captured_at` is stored and surfaced in admin so
   staff can review the oldest consents before reusing them publicly.

A future automated retention/anonymise sweep (reusing the existing
`scripts/anonymize-retention-expired.mjs` pattern) is out of scope here.

## Security & privacy checklist

- Public, unauthenticated `POST /api/my-story` → honeypot + rate limit + server-side
  size caps + Zod validation.
- No secrets in code; escape all user text on admin render; never log story PII.
- Identifier opt-ins default off (minimisation); email/phone flagged "never published".
- Admin endpoints behind the existing session auth; mutations gated Editor+.

## README

Update `README.md` in each task's PR (golden rule 7): the new `/my-story` route + nav
entry (Task A), the `stories` table + `POST /api/my-story` (Task B), and the admin
Stories view + endpoints (Task C).
