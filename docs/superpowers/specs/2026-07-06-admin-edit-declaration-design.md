# TASK-130 — Admin: correct a donor's Gift Aid declaration address

## Goal

Let an Editor/Admin staffer correct the identity / address on a donor's active
Gift Aid declaration from the admin donor view — the staff-side twin of TASK-129.
Same amend semantics (the enduring declaration is kept), same name sync, audited
as `admin:<email>` so the trail shows which staffer acted.

## Scope (mirror of TASK-129, admin-authorised)

- **Editable fields: identity / address only** — `title`, `firstName`,
  `lastName`, `houseNameNumber`, `address`, `postcode`, `nonUk`. Always the
  **amend** path (scope + `confirmed_taxpayer` held at their current values, so
  `reviseDeclaration` never revises). Scope/taxpayer editing out of scope.
- **Role gate: Editor+** (`authorizeAdmin(req, res, "editor")`), matching
  `patchAdminDonor`. Viewer → 403.
- **Name sync (option b):** write the declaration `first_name`/`last_name` AND
  `donors.full_name = "First Last"`, so account and declaration names cannot
  diverge.
- **Actor:** `admin:<email>` (`actorOf(claims)`), so the `declaration.amended` and
  `donor.updated` audit rows name the staffer.
- Only a donor with an active declaration is editable; none → 404.

## Components

### 1. Admin GET donor carries the declaration

`getAdminDonor` (`src/routes/admin.ts`) already merges the postal address; add the
active declaration too, reusing the TASK-129 read:

```ts
const address = await getDonorAddress(id);
const declaration = await getActiveDeclarationForDonor(id);
return res.status(200).json({ ...snapshot, ...address, declaration });
```

### 2. Route: `PATCH /api/admin/donors/:id/declaration`

`patchAdminDeclaration` in `src/routes/admin.ts` (mirrors `patchDeclaration` in
portal.ts, but admin-authorised):
- `authorizeAdmin(req, res, "editor")` → claims (401 no/invalid token; 403 Viewer).
- `donorId(req, res)` → id (400 if not numeric).
- Validate body with `declarationFieldsSchema`. Invalid → 400.
- `getActiveDeclarationForDonor(id)`; `null` → 404 "No active Gift Aid declaration
  to edit".
- `reviseDeclaration(active.id, fields, { scope: active.scope, confirmedTaxpayer:
  active.confirmedTaxpayer, mode: "once", actor: actorOf(claims) })` → always
  `amended` / `unchanged`.
- `updateDonorPortal(id, { fullName: \`${firstName} ${lastName}\` },
  actorOf(claims))`.
- Return `{ ...snapshot, ...address, declaration, outcome }` (re-read like the GET
  so the client re-renders).
- Register `adminRouter.patch("/api/admin/donors/:id/declaration",
  patchAdminDeclaration)`.

**Non-atomicity:** same documented two-transaction follow-up as TASK-129 (the
declaration commits first; a name-sync failure leaves only a stale display name).

### 3. Admin UI (`admin.html` is JS-rendered; edit `assets/js/admin/app.js`)

- In `renderDonor(d)`, when `canWrite` (Editor+) **and** `d.declaration`, append a
  "Gift Aid declaration details" edit form built from the existing `editField` /
  `editCheck` helpers: title, first name, last name, house name/number, address,
  postcode, and an overseas-address checkbox. Prefilled from `d.declaration`.
- In `wireDonorActions`, bind its submit: build the payload (omit `postcode` when
  the overseas box is ticked), `PATCH /api/admin/donors/:id/declaration`, then on
  success `openDonor(currentDonorId)` to refresh + `donorStatus("Declaration
  details saved.")`.
- No new HTML in `admin.html` (the donor view is rendered by `app.js`).

### 4. Docs

- README admin section: note the new `PATCH /api/admin/donors/:id/declaration`
  (Editor+, amend + name sync, `admin:<email>` audit) alongside the existing admin
  donor routes.

## Tests

- **Unit (route)** `test/unit/admin-declaration-edit.test.ts` — mock the db
  functions (`getActiveDeclarationForDonor`, `reviseDeclaration`,
  `updateDonorPortal`, `getDonorPortalSnapshot`, `getDonorAddress`) and use a real
  signed admin token (`signAdminSession`, config secret mocked):
  - editor token → amend: `reviseDeclaration` called with active id + current
    scope/taxpayer + `actor: "admin:<email>"`; `updateDonorPortal` with `fullName`
    + admin actor; 200.
  - **viewer token → 403**, no writers called.
  - no active declaration → 404.
  - invalid body (blank last name) → 400.
  - missing/invalid token → 401.
- **Unit (admin GET)**: extend the existing `admin-api.test.ts` donor-detail
  assertion so the response carries `declaration` (mock the declarations select).
- **BDD** `features/admin-api.feature`: an Editor edits a donor's declaration
  address by id → 200 and the declaration is amended (same row, `revoked_at` still
  null, address updated). Reuse the admin steps' login + donor/declaration seeds.
- Full unit + BDD green; `npm run lint && npm run build`.

## Out of scope

- No scope/taxpayer editing (consent change).
- No new migration/infra/HMRC-export change.
- Single-transaction name sync (shared documented follow-up with TASK-129).

## Process

One PR, `[TASK-130]` title, branch `task-130-admin-edit-declaration`. Lint +
build + unit + BDD green before self-merge. README updated in the same PR.
