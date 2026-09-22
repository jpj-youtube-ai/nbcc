# Data safety and cost: design

**Date:** 2026-09-22
**Status:** approved, ready for planning

## The problem

Every copy of NBCC's data lives inside one AWS account. Automated RDS backups with
35-day point-in-time recovery are genuinely good protection against the *ordinary*
failures (a bad migration, a deleted row, a dead instance), but they share the fate
of the account that holds them. One compromised credential, one billing suspension,
one deletion of the wrong thing, and the live data and every backup go together.

Two further gaps:

- **35 days is shorter than the law expects.** HMRC requires Gift Aid declarations and
  claim records to be kept for six years after the accounting period. Today a
  declaration made in 2026 is unrecoverable 36 days later.
- **A contact enquiry notifies nobody.** `contact_enquiries` has a new/replied status,
  but it is only visible from inside the Contact view. Nothing on the dashboard, no
  email. Somebody can write to the charity and wait indefinitely.

Meanwhile the stack costs ~$102/month, of which roughly $425/year buys *availability*
rather than *durability*: a standby database and a second container. The charity's
stated priority is "keep costs as low as possible but don't lose data" — and those
are not in tension, because the things that protect data are the cheap things.

## What the data actually is

42 tables. The owner's own list (donors, partners, email addresses, newsletter, forms)
covered roughly half. The omissions that carry legal weight:

| Omitted | Why it matters |
|---|---|
| `declarations`, `claim_batches`, `claim_adjustments` | Gift Aid. Six-year HMRC retention. |
| `ball_guests` dietary and access needs | Special category data under UK GDPR. Higher bar than names and emails. |
| `email_suppressions` | Restoring without it means emailing people who opted out: a PECR breach, and it destroys the SES sending reputation built in TASK-298. |
| `erasure_log` | The evidence that "delete my data" requests were honoured. |
| `audit_log`, `users`, `admin_login_codes`, `portal_access_tokens` | Access control and the tamper-evident trail. |

Uploaded files are **not** a separate problem: `newsletter_images.bytes` and
`newsletter_attachments.bytes` are `bytea` columns inside Postgres, so a database dump
captures them. There is no app-owned S3 bucket to back up separately.

## Decisions

### 1. Two backup destinations, because they defend against different things

**A locked store inside AWS** (S3, versioning + Object Lock in compliance mode, SSE-KMS,
public access blocked). Object Lock is the point: it is write-once, so a compromised or
mistaken admin cannot delete or alter history. Lifecycle keeps nightly for 35 days, then
one per month to seven years, which closes the HMRC gap. Restores fast, because it sits
next to the database. ~$6/year.

**An encrypted archive on Google Drive**, daily. This is the copy that survives losing the
AWS account, which the S3 copy by definition cannot. Free.

Neither alone is sufficient. Keeping both is cheap.

### 2. The dump is `pg_dump`, plus CSV

`pg_dump` is the authoritative artefact: a real, restorable dump with types, constraints
and `bytea` intact. Alongside it, one CSV per table, because the person who may one day
need this is the charity's operator, not a developer, and a CSV opens in Excel without
AWS, Postgres or help.

**Risk, called out because it fails silently:** `pg_dump` must be at least the server's
major version. RDS runs Postgres 16; `node:20-slim` is Debian bookworm, whose default
`postgresql-client` is 15, which refuses to dump a 16 server. The runtime image therefore
installs `postgresql-client-16` from the PGDG apt repository, not from Debian. If RDS is
ever upgraded to 17 the backup breaks — the failure alert in decision 5 is what catches it.

### 3. What the Drive archive contains

- the `pg_dump` (every table, including image and attachment bytes)
- one CSV per table
- **a snapshot of the website itself** (git bundle of the repo at the deployed commit),
  so the site can be rebuilt and not merely the data recovered
- a manifest: every table, its row count, the dump size, the commit SHA, the timestamp

Packaged as a single AES-256 encrypted archive.

### 4. Secrets are deliberately excluded

Live Stripe keys, the database password and SES credentials are **not** in the archive.
The owner asked for "literally every single piece of data"; this is the one exclusion,
made explicitly rather than quietly. An archive on Drive is, by design, the copy most
likely to end up somewhere unintended, and whoever held it could take card payments as
NBCC and read the donor list directly.

The manifest lists the *names* of the secrets that exist, so recovery knows what to
recreate. The values stay in SSM. A password manager is the correct home for them.

**The archive passphrase is itself subject to this reasoning in reverse.** It must live
*outside* AWS, held by the owner. A passphrase stored only in SSM makes the Drive archive
an unopenable file in precisely the disaster it exists for.

### 5. Proof, because an unverified backup is a belief

- a monthly "backup healthy" email: table count, row counts, archive size
- an immediate alert on: job failure, upload failure, a dump materially smaller than the
  previous one, or no successful backup in 48 hours
- **a restore rehearsal** as part of this work: take the encrypted archive from Drive,
  rebuild into a scratch database, assert row counts match the manifest

Backups do not fail loudly. They stop in February and are discovered in November.

### 6. Cost reductions land *after* the backups

`multi_az = false` (−$230/yr) and `desired_count = 1` (−$195/yr). Neither touches
durability: automated backups run regardless of Multi-AZ, and containers hold no state.
Multi-AZ buys synchronous replication, so the exposure moves from ~0 to up to ~5 minutes
of recent writes in a sudden total instance failure. For donations specifically Stripe is
the source of truth and redelivers, and `stripe_webhook_events` already makes that
idempotent.

Sequenced second deliberately. The difference is a few days and it avoids reducing
anything while the better safety net is half-built.

### 7. Enquiry notifications need no migration

`contact_enquiries.replied_at` and `.replied_by` already exist and are already written by
`src/db/contact.ts`. This is a presentation problem, not a data one: a bar on every admin
page showing unanswered enquiries, click-through, and the existing who/when surfaced in
the list.

## Open question

**Whether the Google account is Workspace or personal Gmail**, which changes the upload
mechanism entirely:

- **Workspace (a domain account):** a *Shared Drive* with the service account as a member.
  Files are owned by the Shared Drive. Clean, and the preferred option.
- **Personal @gmail.com:** Shared Drives do not exist, and a service account has no Drive
  storage quota of its own, so uploads into a shared My Drive folder fail on quota. This
  needs an OAuth refresh token for the human account instead, which is more fragile
  (revocable, expires if unused for six months).

Google for Nonprofits provides Workspace free to registered charities, so moving to a
domain account may be worth doing regardless.

## Delivery

Three PRs, each independently revertible:

1. **Backup system** — image change, backup script, S3 bucket + Object Lock, scheduler,
   Drive upload, alerting, restore rehearsal.
2. **Cost reductions** — `multi_az`, `desired_count`.
3. **Enquiry notification bar** — admin UI only.

## Not doing

- Moving off the load balancer. It is the largest remaining fixed cost (~$25/month) but
  removing it means rebuilding how the site is served, which is disproportionate.
- A second AWS account. Rejected as ongoing admin burden for a charity with one operator;
  Drive achieves the same "survives losing AWS" property with less to maintain.
- Backing up SSM secret values. See decision 4.
