# TASK-131 — Atomic declaration edit + donor-name sync

## Problem

TASK-129/130 edit a declaration then sync `donors.full_name` in **two** audited
transactions (`reviseDeclaration` then `updateDonorPortal`). A failure of the
second leaves the declaration correct but the account display name stale — a
documented follow-up. Fold both into **one** transaction so they commit or roll
back together.

## Approach (decided)

Extend `reviseDeclaration` with an optional `syncDonorFullName` in its context.
When present, the same `BEGIN…COMMIT` that amends/revises the declaration also
updates the donor's name and audits it — the donor is the declaration's own
`donor_id`, so no extra id is threaded. The two edit routes pass
`syncDonorFullName` and drop their separate `updateDonorPortal` call.

## Changes

### `src/db/declarations.ts` — `reviseDeclaration`

- Context type gains `syncDonorFullName?: string`.
- In **both** write branches (amend and revise), after the declaration writes and
  before `COMMIT`, when `syncDonorFullName != null`:
  - `UPDATE donors SET full_name = $1 WHERE id = $2` with `[syncDonorFullName,
    row.donor_id]`.
  - `insertAudit(client, { actor, action: "donor.updated", entity: "donor",
    entityId: row.donor_id, data: { fields: ["fullName"] } })`.
- The **unchanged** branch does nothing new: an unchanged declaration means the
  name fields (first/last) are unchanged, so the derived full name is identical —
  no write needed.
- Result type unchanged.

### `src/routes/portal.ts` — `patchDeclaration`

- Pass `syncDonorFullName: \`${fields.firstName} ${fields.lastName}\`` in the
  `reviseDeclaration` context.
- Remove the separate `await updateDonorPortal(...)` call. (Keep the import;
  `patchPortal` still uses it.)

### `src/routes/admin.ts` — `patchAdminDeclaration`

- Same: pass `syncDonorFullName` (actor stays `admin:<email>`), drop the separate
  `updateDonorPortal` call. (Keep the import; `patchAdminDonor` still uses it.)

## Tests

- **`test/unit/declaration-revision.test.ts`** — new cases:
  - amend + `syncDonorFullName` → the transaction also runs `UPDATE donors` and a
    `donor.updated` audit, all before the single `COMMIT` (no intermediate
    commit), with the donor id from the row.
  - revise + `syncDonorFullName` → likewise inside the one transaction.
  - amend **without** `syncDonorFullName` → **no** `UPDATE donors` (unchanged
    behaviour).
- **`test/unit/portal-declaration-edit.test.ts`** — assert `reviseDeclaration`
  called with `syncDonorFullName: "Ada Lovelace"`; assert `updateDonorPortal` is
  **not** called.
- **`test/unit/admin-declaration-edit.test.ts`** — still asserts an `UPDATE
  donors` runs (now inside `reviseDeclaration`'s transaction) and a
  `declaration.amended` audit; no substantive change.
- Full unit + BDD green (the existing portal/admin BDD amend scenarios still pass
  — behaviour is unchanged, only atomicity improves).

## Out of scope

- No new route/UI, no schema change, no behaviour change beyond atomicity.
- The name is still derived first+last (option b), unchanged.

## Process

One PR, `[TASK-131]` title, branch `task-131-atomic-name-sync`. Lint + build +
unit + BDD green before self-merge. README: update the two route paragraphs to
drop the "two transactions / documented follow-up" note (now one transaction).
