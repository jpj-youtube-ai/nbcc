# TASK-128 — Split declaration edits: identity = amend (note), consent = new declaration

## Problem

The declaration-edit rule (§7 / REQ-059) treats **any** changed field — name,
address, postcode, scope, taxpayer confirmation — as a reason to revoke the old
declaration and insert a superseding one. That was presented as if HMRC requires
it. HMRC does **not**: an enduring declaration stays valid across an address
change; you simply note the change. Immutable-revoke-and-supersede is a
defensible NBCC **design choice** (clean audit), not an HMRC rule, and it grows a
chain of declarations per long-term monthly donor.

Per the reviewer, keep immutability where it matters — the **consent** (scope +
taxpayer confirmation) — but treat an **identity / matching-detail** change
(name, house name/number, address, postcode, overseas-address flag) as a **note**
on the existing enduring declaration.

## Behaviour

Given the current declaration row and the newly captured fields:

- **Consent field changed** (`scope` or `confirmed_taxpayer`) → **revise**:
  revoke the old row + insert a superseding immutable row (today's behaviour).
  The new row also carries any updated matching fields.
- **Only identity / matching fields changed** (`title`, `first_name`,
  `last_name`, `house_name_number`, `address`, `postcode`, `non_uk`) → **amend**:
  update those columns **in place** on the same row, append one
  `declaration.amended` audit row (records the changed field names + donor).
  No revoke, no new row. The consent snapshot (`scope`, `confirmed_taxpayer`,
  `wording_version`, `wording_snapshot`, `created_at`) stays frozen.
- **Nothing meaningful changed** → no-op.

Amending updates the row's address forward, so future / unclaimed claims use the
current address; already-submitted `claim_batches` are untouched. This matches
HMRC's "note the change" intent.

## Components

### 1. `src/declarations/revision.ts` (pure)

`buildDeclarationRevision` returns a discriminated union (or `null`):

```ts
export type DeclarationRevision =
  | { kind: "amend"; declarationId: number; changes: DeclarationMatchingColumns; changedFields: string[] }
  | { kind: "revise"; revokedDeclaration: { id: number; revoked_at: Date }; newDeclaration: DeclarationRow };
// returns null when nothing meaningful changed
```

Split the compared columns:

```ts
const CONSENT_COLUMNS = ["scope", "confirmed_taxpayer"] as const;
const MATCHING_COLUMNS = ["title", "first_name", "last_name", "house_name_number", "address", "postcode", "non_uk"] as const;
```

Build the candidate row as today. Then:
- `consentChanged = CONSENT_COLUMNS.some(c => candidate[c] !== current[c])`
- `changedMatching = MATCHING_COLUMNS.filter(c => candidate[c] !== current[c])`
- `consentChanged` → `{ kind: "revise", ... }` (candidate is the new row).
- else `changedMatching.length` → `{ kind: "amend", declarationId: current.id,
  changes: <candidate's matching columns>, changedFields: changedMatching }`.
- else → `null`.

`DeclarationMatchingColumns` = the seven matching columns of `DeclarationRow`.

### 2. `src/db/declarations.ts` (audited write)

`reviseDeclaration` result becomes a discriminated union:

```ts
export type ReviseDeclarationResult =
  | { outcome: "unchanged"; declarationId: number }
  | { outcome: "amended"; declarationId: number; changedFields: string[] }
  | { outcome: "revised"; revokedDeclarationId: number; newDeclarationId: number };
```

In the same locked transaction (unchanged guards: `FOR UPDATE`, `not_found`,
`already_revoked`):
- `null` → commit, `{ outcome: "unchanged", declarationId }`.
- `kind: "amend"` → `UPDATE declarations SET <matching cols> WHERE id = $n`
  (no `revoked_at`, no new row) + one `insertAudit` `declaration.amended`
  (`data: { changedFields, donorId }`); commit; `{ outcome: "amended",
  declarationId, changedFields }`.
- `kind: "revise"` → today's path (insert new → set old `revoked_at` +
  `superseded_by_declaration_id` → two audit rows: `declaration.revoked` +
  `declaration.created`); `{ outcome: "revised", revokedDeclarationId,
  newDeclarationId }`.

No schema change: amend updates existing columns; `audit_log` already exists.

### 3. Framing (README + comments)

- README "Declaration revision (REQ-059 · TASK-097)" section: describe the split
  — consent (scope/taxpayer) is immutable → new declaration; identity/address is
  a matching detail → amended in place with a `declaration.amended` audit note.
  State explicitly this is NBCC's design choice and HMRC **permits** noting an
  address change on the enduring declaration; it is not an HMRC mandate.
- `src/declarations/revision.ts` + `src/db/declarations.ts` header comments:
  reframe from "any edit revokes + supersedes" to the amend/revise split, same
  "design choice, not HMRC-mandated" note.

### 4. Upstream flag (no edit)

`SPEC.md:450` (REQ-059) says "any change to name, address, scope or taxpayer
confirmation deactivates the old declaration". That is now wrong for
name/address. `SPEC.md` is a generated projection of the requirement log and
must not be hand-edited — flag REQ-059 for the requirement-log owner to reword.

## Tests (TDD)

`test/unit/declaration-revision.test.ts`:

- **Pure builder**:
  - identical fields → `null`.
  - address-only change → `{ kind: "amend", ... }`, `changes.address` = new,
    `changedFields` contains `"address"`, no `newDeclaration`.
  - `postcode`-only and `non_uk`-only change → `amend`.
  - `scope` change → `{ kind: "revise" }`, new row carries current wording.
  - `confirmed_taxpayer` change → `revise`.
  - matching + consent change together → `revise`, new row carries the new
    address.
- **Audited write** (mocked pool):
  - address change → `{ outcome: "amended", declarationId: 10, changedFields:
    ["address"] }`; exactly one `UPDATE declarations` **without** `revoked_at`;
    one `declaration.amended` audit; **no** `insert into declarations`; commit.
  - scope change → `{ outcome: "revised", ... }`; insert new + update
    (revoked_at/superseded) + `declaration.revoked` + `declaration.created`
    (today's assertions).
  - no change → `{ outcome: "unchanged", declarationId: 10 }`, no writes, commit.
  - `not_found` / `already_revoked` / mid-transaction rollback — unchanged.

Full unit suite + BDD green. `npm run lint && npm run build`.

## Out of scope

- No route/UI: `reviseDeclaration`/`buildDeclarationRevision` are not yet wired to
  an endpoint; this changes the pure + write layer + its tests only.
- No migration, no infra, no change to the HMRC claim export.
- `SPEC.md` not hand-edited (flagged upstream).

## Process

One PR, `[TASK-128]` title, branch `task-128-declaration-amend-vs-revise`. Lint +
build + unit + BDD green before self-merge. README updated in the same PR.
