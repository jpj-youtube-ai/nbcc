# TASK-129 — Portal: edit Gift Aid declaration details (wire reviseDeclaration)

## Goal

Let a magic-link donor correct the identity / address on their **active** Gift
Aid declaration, so the address HMRC matches on stays current — and keep the
donor account name in sync with the declaration name. This makes TASK-128's
`reviseDeclaration` (amend path) reachable for the first time and closes the
address-drift gap (today a donor who moves house has no way to update the
declaration).

## Scope (decided)

- **Editable fields: identity / address only** — `title`, `firstName`,
  `lastName`, `houseNameNumber`, `address`, `postcode`, `nonUk` (overseas
  address). These are all HMRC matching details, so every portal edit is the
  **amend** path (the enduring declaration is kept; `scope` + `confirmed_taxpayer`
  are held at their current values, so `reviseDeclaration` never revises here).
  Changing scope / taxpayer status is out of scope (that is a consent change —
  handled elsewhere: cancel + re-declare).
- **Name sync (option b): first/last name.** The portal name edit is a first
  name + last name pair (declaration-shaped). Saving writes the declaration's
  `first_name`/`last_name` AND `donors.full_name = "First Last"`, so the account
  name and the declaration name cannot diverge.
- Only donors with an **active declaration** see the edit form (a non-Gift-Aid
  donor has nothing to edit).

## Components

### 1. Read: active declaration for a donor

`getActiveDeclarationForDonor(donorId)` in `src/db/portal.ts` — pool.query, read
only. Returns the most-recent non-revoked declaration's editable fields + the
frozen consent, or `null`:

```ts
interface ActiveDeclaration {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  houseNameNumber: string;
  address: string;
  postcode: string | null;
  nonUk: boolean;
  scope: Scope;            // frozen — passed back as context, not editable here
  confirmedTaxpayer: boolean; // frozen
}
```
Query: `SELECT … FROM declarations WHERE donor_id=$1 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`.

### 2. GET response carries the declaration

`getPortal` includes `declaration: ActiveDeclaration | null` in its JSON, so the
page can prefill the form and decide whether to show it. `scope` /
`confirmedTaxpayer` are included so the client round-trips them unchanged (server
re-reads them anyway — see below).

### 3. Route: `PATCH /api/portal/:token/declaration`

`patchDeclaration` in `src/routes/portal.ts`:
- Auth token → donorId (reuse `authOrReject`; invalid → 401).
- Validate body with the existing `declarationFieldsSchema` (from
  `src/declarations/fields.ts`): `title?`, `firstName`, `lastName`,
  `houseNameNumber?`, `address`, `postcode?`, `nonUk` — with the conditional
  house-number / UK-postcode rules. Invalid → 400.
- Load `getActiveDeclarationForDonor(donorId)`. `null` → 404 "No active Gift Aid
  declaration to edit".
- `reviseDeclaration(active.id, fields, { scope: active.scope,
  confirmedTaxpayer: active.confirmedTaxpayer, mode, actor: "donor" })`. Because
  scope + taxpayer are the current values, the outcome is always `amended`
  (or `unchanged`), never `revised`. `mode` is derived from the snapshot
  (`monthly` if a subscription id is present, else `once`); it only feeds wording
  selection, which the amend path never emits, so it does not affect the result.
- Sync the account name: `updateDonorPortal(donorId, { fullName:
  \`${firstName} ${lastName}\` }, "donor")`.
- Return the fresh snapshot + `{ declaration, outcome }`.

**Non-atomicity (documented follow-up):** `reviseDeclaration` and
`updateDonorPortal` are two audited transactions. The declaration (the
HMRC-matching record) commits first; a failure of the name sync afterwards is
logged and surfaced as a 500, leaving the declaration correct and only the
account display name stale — a cosmetic drift a retry fixes. Folding both into
one transaction is a noted follow-up, mirroring the codebase's other documented
follow-ups (the in-memory rate limiter).

### 4. Portal UI (`portal.html` + `assets/js/main.js`)

- New `portal-card` "Gift Aid declaration details" (after "Your Gift Aid"),
  shipped `hidden`, shown by JS only when `declaration != null`. A `<form>` with
  labelled fields (REQ-032): title (optional), first name, last name, house name
  or number, home address, postcode (in a `#portalPostcodeField` wrapper), and
  the overseas-address checkbox (reusing TASK-127's dash-free copy). All fields
  prefilled from `declaration`.
- `initPortal` (JS): render/prefill the form when a declaration is present; wire
  the overseas checkbox to hide/disable/un-require the postcode (same behaviour
  as `initDeclarationCapture`); on submit, `PATCH …/declaration` with the field
  object; on success, update the "Your details" Name display to `First Last` and
  write a confirmation to `#portalActionStatus`; on 400/404/error, show a message.
- Reuse existing `give-field` / `give-check` styles — no new CSS.

### 5. Docs

- README portal section + the "Declaration revision" section: note the amend path
  is now wired via the portal's declaration-edit form (donor-driven), and the
  name stays in sync with the account.

## Tests

- **Unit (route, mocked db)** `test/unit/portal-declaration-edit.test.ts`:
  - valid edit → `reviseDeclaration` called with the active id + current
    scope/taxpayer; `updateDonorPortal` called with `fullName: "First Last"`;
    200 with the fresh declaration.
  - no active declaration → 404, neither writer called.
  - invalid body (blank last name / bad postcode when UK) → 400.
  - invalid token → 401.
- **Unit (read, mocked pool)**: `getActiveDeclarationForDonor` returns the mapped
  object for a row, `null` for none.
- **BDD** `features/portal.feature`: a donor with an active declaration PATCHes a
  new address via a valid token → 200 and the declaration is amended (a new
  `declaration.amended` audit row; the same declaration id, no new row). Reuse the
  portal steps' token setup.
- Full unit + BDD green; `npm run lint && npm run build`.

## Out of scope

- No scope / taxpayer editing via the portal (consent change).
- No admin declaration-edit UI (portal-first; admin is a later task).
- No change to the donate/create path or the HMRC export.
- Single-transaction name sync (documented follow-up).

## Process

One PR, `[TASK-129]` title, branch `task-129-portal-edit-declaration`. Lint +
build + unit + BDD green before self-merge. README + portal guards updated in the
same PR. `portal.html` is in the hardcoded guard PAGES lists already; the new
inputs must satisfy the accessibility (label-for) guard.
