# Design: Claims page — complete the Gift Aid pipeline + make it legible

Date: 2026-07-05
Status: approved (pending spec review)
Task: TASK-NNN (to be assigned; branch task-claims-gift-aid-pipeline)

## Problem

The admin **Claims** page is the cockpit for reclaiming 25% Gift Aid tax from
HMRC (Charities Online): eligible donations are grouped into a **claim batch**,
the batch is **exported as a CSV**, uploaded to HMRC, then marked **submitted**
(later **claimed**). Two defects make it unusable and unclear:

1. **The batch CSV export is always empty.** `listClaimableDonationsForExport(batchId)`
   filters `claim_status='eligible' AND claim_batch_id=$1`. But once a donation is
   assigned to a batch its status is `batched` (then `claimed`), never `eligible` —
   so the two filters can never both be true, and every batch export returns zero
   rows. Confirmed against live data: batch 40 holds a `batched` donation, batch 41
   holds four `claimed`, and the four `eligible` donations have no batch.
2. **There is no way to fill a batch through the app.** `assignDonationToBatch`
   exists in the DB layer but has **no route and no UI**, and there is **no
   `createClaimBatch` at all** (existing batches came from seeds). So an admin
   cannot create a batch or move eligible donations into one — the pipeline dead-ends.

On top of the bugs, the page gives no explanation of what any of it is for.

## Goal

Complete the `eligible → batch → export → submit → claimed` pipeline end to end
through the admin UI, fix the empty export, and redesign the Claims view so a
non-expert admin understands each stage. Scope is the Claims view + its backing
routes; other admin views are untouched.

## Backend changes

All mutations are Editor+ (mirroring `submitClaimBatch`) and audited via the
existing `writeWithAudit` helper (state write + audit row in one transaction).

1. **`createClaimBatch(actor, hmrcReference?)`** (new, `src/db/admin.ts`) — inserts a
   `claim_batches` row. `status`/`regulator`/`charity_number` all default in the
   schema (`open`/`OSCR`/`SC047995`); `hmrc_reference` is nullable and optionally
   set. Returns `{ batchId }`. Audit `claim_batch.created`.
   - Route: `POST /api/admin/claim-batches` → `{ batchId }`. Editor+.
2. **Assign eligible donations to a batch** — a route wrapping the existing
   `assignDonationToBatch` (which already enforces the claim invariant + one-batch
   guard and audits `donation.batched`). Accepts one or many donation ids so the
   checkbox UI can batch-assign.
   - Route: `POST /api/admin/claim-batches/:id/donations` with body
     `{ donationIds: number[] }`. Editor+. Applies each via `assignDonationToBatch`;
     returns `{ assigned: number[], failed: [{ id, reason }] }` so a partial failure
     (a donation already batched / not eligible) is reported, not silently dropped.
     Each assignment is its own audited transaction (reusing the existing helper);
     the route aggregates the outcomes.
3. **Fix the export query** (`listClaimableDonationsForExport`, `src/db/donations.ts`)
   — when a `claimBatchId` is given, select `WHERE d.claim_batch_id = $1` (the batch's
   contents, `batched` or `claimed`) instead of `claim_status='eligible'`. The
   INNER JOIN to `declarations` still guarantees a declaration is present. Without a
   batch id, keep `claim_status='eligible'` (the unbatched picker list, below). This
   is the single line that makes the CSV non-empty.
4. **List eligible-unbatched donations for the picker** — reuse
   `listClaimableDonationsForExport()` with no id (returns the `eligible` donations,
   which by definition have `claim_batch_id IS NULL`). No new query. Expose read-only
   at `GET /api/admin/claims/eligible` (Viewer+), shaped for the table.

No migration, no schema change (all columns already exist).

## Frontend redesign (Claims view)

Rebuild `#view-claims` in `admin.html` (+ `assets/js/admin/app.js`,
`assets/css/admin.css`) as the workflow top-to-bottom, each stage introduced by a
one-line plain-English description so the purpose is self-evident:

- **① Eligible to claim** — table of Gift-Aided donations with a valid declaration,
  not yet batched (`GET /api/admin/claims/eligible`). A **checkbox per row** + an
  **"Add to batch"** control: choose an existing **open** batch or **"New batch"**,
  then POST the selected ids. Helper copy: *"These Gift-Aided gifts can be reclaimed
  from HMRC. Tick the ones to claim and add them to a batch."* Editor+ sees the
  controls; a Viewer sees the list read-only (mirrors the existing role-gating in
  app.js).
- **② Claim batches** — the existing `listClaimBatches` table (count / total /
  status), now with a working **Export CSV** and the existing **Submit to HMRC**,
  plus a **New batch** button. Helper: *"A batch is one HMRC submission. Export it as
  a Charities Online file, upload it to HMRC, then mark it submitted."*
- **③ Adjustment due** — the existing adjustment-due queue, unchanged data. Helper:
  *"Already-claimed gifts that were later refunded — declare these as an adjustment on
  your next HMRC claim."*

The redesign reuses the existing admin table/section styles; new copy and the
eligible table + assign control are the only additions. Empty states carry the
same explanatory tone (e.g. *"No donations are waiting to be claimed."*).

## Out of scope (YAGNI)

Removing a donation from a batch; deleting a batch; editing `hmrc_reference` after
creation (it can be null and set later — not needed to export); the retention /
awaiting-declaration queues (separate views); any change to how a donation *becomes*
eligible (that is the webhook's job).

## Testing / verification

- **Unit** (`test/unit/`): `createClaimBatch` inserts with defaults + audits;
  the fixed `listClaimableDonationsForExport(batchId)` returns a batch's `batched`/
  `claimed` donations (the regression that was empty); the assign route aggregates
  success/failure; `toCharitiesOnlineCsv` over a batch's rows yields header + one
  line per donation. Pure/DB-mocked where the existing tests are; DB-touching query
  behaviour covered by BDD below.
- **BDD** (`features/admin-api.feature`): an Editor walks eligible → create batch →
  assign donations → **export a non-empty CSV** (header + rows) → submit. This
  scenario fails on `main` today (empty CSV) and passes after the fix.
- **UI**: drive the redesigned Claims view in the running admin on :3002 — create a
  batch, tick eligible donations, add them, export, confirm the CSV downloads with
  rows.

## Workflow notes

- Branch `task-claims-gift-aid-pipeline`; PR title must be prefixed with the assigned
  `[TASK-NNN]` before merge (squash convention); drive `pr.yml` green; self-merge.
- New routes → follow the `/new-route` recipe (router + mount already exist; add the
  handlers + a feature scenario + unit tests). No new config, no infra.
</content>
