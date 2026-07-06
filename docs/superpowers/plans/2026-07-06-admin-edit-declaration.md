# Admin edit Gift Aid declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an Editor/Admin staffer correct the identity/address on a donor's active Gift Aid declaration from the admin donor view (the amend path), keeping the account name in sync, audited as `admin:<email>`.

**Architecture:** A new `PATCH /api/admin/donors/:id/declaration` route mirrors the portal's `patchDeclaration` but authorised by the admin session (Editor+); the admin GET donor gains `declaration`; `assets/js/admin/app.js` renders a prefilled edit form. Reuses `getActiveDeclarationForDonor`, `reviseDeclaration`, `updateDonorPortal`, `declarationFieldsSchema` — no new engine.

**Tech Stack:** Express + TypeScript, Zod, Postgres (pool), Vitest (mocked pool + signed admin token), Cucumber (BDD), vanilla `assets/js/admin/app.js`.

## Global Constraints

- Editable fields: `title?`, `firstName`, `lastName`, `houseNameNumber?`, `address`, `postcode?`, `nonUk` (via `declarationFieldsSchema`). No scope/taxpayer editing.
- Always the **amend** path: pass `scope` + `confirmedTaxpayer` = the active declaration's current values → `reviseDeclaration` returns `amended`/`unchanged`, never `revised`.
- Role gate: **Editor+** (`authorizeAdmin(req, res, "editor")`); Viewer → 403; missing/invalid token → 401; non-numeric id → 400; no active declaration → 404.
- Audit actor: `admin:<email>` (`actorOf(claims)`).
- Name sync: `updateDonorPortal(id, { fullName: "First Last" }, actorOf(claims))`.
- Two transactions (declaration first) — documented single-transaction follow-up (shared with TASK-129).
- One PR, `[TASK-130]` title, branch `task-130-admin-edit-declaration`. Lint + build + unit + BDD green before self-merge.

---

### Task 1: `PATCH /api/admin/donors/:id/declaration` route + GET carries declaration

**Files:**
- Modify: `src/routes/admin.ts`
- Test: `test/unit/admin-declaration-edit.test.ts` (new)

**Interfaces:**
- Consumes: `authorizeAdmin`, `donorId`, `actorOf` (admin.ts locals); `getActiveDeclarationForDonor`, `updateDonorPortal`, `getDonorPortalSnapshot`, `getDonorAddress` (`../db/portal`); `reviseDeclaration` (`../db/declarations`); `declarationFieldsSchema` (`../declarations/fields`).
- Produces: `patchAdminDeclaration(req, res)` + `adminRouter.patch("/api/admin/donors/:id/declaration", patchAdminDeclaration)`; `getAdminDonor` response gains `declaration`.

- [ ] **Step 1: Write the failing route test** `test/unit/admin-declaration-edit.test.ts`. Mirror `admin-api.test.ts`'s pool-level mock + signed token:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-130 (REQ-059/REQ-062): PATCH /api/admin/donors/:id/declaration lets Editor+ staff correct the
// identity/address on a donor's active declaration (amend) + sync the account name, audited as
// admin:<email>. Pool + config mocked; admin token real (signAdminSession).

const { queryMock, clientQueryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, clientQueryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa", STRIPE_WEBHOOK_SECRET: "whsec_x",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { patchAdminDeclaration } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string) =>
  signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;

type MockRes = { statusCode: number; body: any; status: (c: number) => MockRes; json: (b: any) => MockRes };
const mockRes = (): MockRes => {
  const res = { statusCode: 200, body: undefined } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};
const req = (o: { role?: string; token?: string; id?: string; body?: unknown }) => {
  const headers: Record<string, string> = {};
  const token = o.token !== undefined ? o.token : o.role ? tokenFor(o.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: o.id ?? "42" }, headers, body: o.body ?? {} };
};
const run = async (o: any) => { const res = mockRes(); await patchAdminDeclaration(req(o) as any, res as any); return res; };

// The active declaration on file: body matches it except the address, so the edit is an AMEND.
const activeRow = {
  id: 77, donor_id: 42, title: "Dr", first_name: "Ada", last_name: "Lovelace",
  house_name_number: "12", address: "Old Ave, London", postcode: "SW1A 1AA", non_uk: false,
  scope: "all_donations", confirmed_taxpayer: true, revoked_at: null,
};
const body = {
  title: "Dr", firstName: "Ada", lastName: "Lovelace", houseNameNumber: "12",
  address: "New Road, Ayr", postcode: "KA7 1AA", nonUk: false,
};
let activeExists = true;

beforeEach(() => {
  queryMock.mockReset(); clientQueryMock.mockReset(); connect.mockClear();
  activeExists = true;
  queryMock.mockImplementation(async (sql: string) => {
    if (/from declarations/i.test(sql)) return { rows: activeExists ? [activeRow] : [], rowCount: activeExists ? 1 : 0 };
    if (/from donors/i.test(sql)) {
      return { rows: [{ full_name: "Ada Lovelace", email: "ada@example.com", email_consent: true, anonymous: false, subscription_plan: null, subscription_id: null, gift_aid: true }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [activeRow], rowCount: 1 }; // FOR UPDATE
    if (/update declarations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update donors/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const clientSqls = () => clientQueryMock.mock.calls.map((c) => String(c[0]));
const clientHas = (re: RegExp) => clientSqls().some((s) => re.test(s));
const auditActions = () => clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => (c[1] as any[])[1]);

describe("PATCH /api/admin/donors/:id/declaration (TASK-130)", () => {
  it("amends the declaration + syncs the name for an editor, audited as admin:<email>", async () => {
    const res = await run({ role: "editor", body });
    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe("amended");
    // amend UPDATE (matching cols, no revoked_at) + a declaration.amended audit + a donor name sync.
    const declUpdate = clientQueryMock.mock.calls.find((c) => /update declarations/i.test(String(c[0])));
    expect(String(declUpdate?.[0])).not.toMatch(/revoked_at/i);
    expect(auditActions()).toContain("declaration.amended");
    expect(clientHas(/update donors/i)).toBe(true);
  });

  it("403s a viewer (read-only) and writes nothing", async () => {
    const res = await run({ role: "viewer", body });
    expect(res.statusCode).toBe(403);
    expect(clientHas(/update declarations/i)).toBe(false);
    expect(clientHas(/update donors/i)).toBe(false);
  });

  it("404s when the donor has no active declaration", async () => {
    activeExists = false;
    const res = await run({ role: "editor", body });
    expect(res.statusCode).toBe(404);
    expect(clientHas(/update declarations/i)).toBe(false);
  });

  it("400s on an invalid body (blank last name)", async () => {
    const res = await run({ role: "editor", body: { ...body, lastName: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await run({ token: "", body });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- admin-declaration-edit`
Expected: FAIL — `patchAdminDeclaration` not exported.

- [ ] **Step 3: Implement in `src/routes/admin.ts`.**

  1. Extend imports: add `getActiveDeclarationForDonor` to the `../db/portal` import; add `reviseDeclaration` to the `../db/declarations` import (currently `{ DeclarationCancellationError }`); add `import { declarationFieldsSchema } from "../declarations/fields";`.

  2. In `getAdminDonor`, include the declaration:

```ts
    const address = await getDonorAddress(id);
    const declaration = await getActiveDeclarationForDonor(id);
    return res.status(200).json({ ...snapshot, ...address, declaration });
```

  3. Add the handler after `patchAdminDonor`:

```ts
// PATCH /api/admin/donors/:id/declaration — correct the identity/address on the donor's active Gift
// Aid declaration on their behalf (REQ-059 · TASK-130). The admin-authorised twin of the portal's
// patchDeclaration: Editor/Admin only. scope + taxpayer are held at the current values, so
// reviseDeclaration always AMENDS in place (a `declaration.amended` audit note, no new row); the
// account name is synced so donors.full_name never diverges from the declaration. Both audit rows
// record admin:<email>. No active declaration → 404. Two audited transactions (declaration first) —
// same documented single-transaction follow-up as the portal route.
export async function patchAdminDeclaration(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "editor");
  if (!claims) return;
  const id = donorId(req, res);
  if (id == null) return;

  const parsed = declarationFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid declaration update", details: parsed.error.flatten() });
  }
  const fields = parsed.data;

  try {
    const active = await getActiveDeclarationForDonor(id);
    if (!active) {
      return res.status(404).json({ error: "No active Gift Aid declaration to edit" });
    }
    const result = await reviseDeclaration(active.id, fields, {
      scope: active.scope,
      confirmedTaxpayer: active.confirmedTaxpayer,
      mode: "once",
      actor: actorOf(claims),
    });
    await updateDonorPortal(id, { fullName: `${fields.firstName} ${fields.lastName}` }, actorOf(claims));

    const snapshot = await getDonorPortalSnapshot(id);
    const address = await getDonorAddress(id);
    const declaration = await getActiveDeclarationForDonor(id);
    return res.status(200).json({ ...snapshot, ...address, declaration, outcome: result.outcome });
  } catch (err) {
    console.error("admin declaration update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin update is temporarily unavailable" });
  }
}
```

  4. Register the route next to the other admin donor routes:

```ts
adminRouter.patch("/api/admin/donors/:id/declaration", patchAdminDeclaration);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- admin-declaration-edit`
Expected: PASS.

- [ ] **Step 5: Fix the existing admin GET donor test for the new field.** In `test/unit/admin-api.test.ts`, the donor-detail test asserts the response shape. If it uses `toEqual`, add `declaration: <expected|null>`; if it uses `toMatchObject`/field checks, no change. Run:

Run: `npm run test:unit -- admin-api`
Expected: PASS (adjust the one donor-detail assertion if it fails on the extra `declaration` key — the mock's `/from declarations/` returns a row, so map it or assert `expect.objectContaining`).

- [ ] **Step 6: Lint + build + commit**

```bash
npm run lint && npm run build
git add src/routes/admin.ts test/unit/admin-declaration-edit.test.ts test/unit/admin-api.test.ts
git commit -m "[TASK-130] Wire PATCH /api/admin/donors/:id/declaration (amend + name sync, Editor+)"
```

---

### Task 2: Admin UI — declaration edit form in the donor view

**Files:**
- Modify: `assets/js/admin/app.js`

**Interfaces:** consumes `GET /api/admin/donors/:id` `declaration`; calls `PATCH /api/admin/donors/:id/declaration`.

- [ ] **Step 1: Render the form in `renderDonor(d)`.** After the "Edit donor" form block (inside `if (canWrite) { … }`, before the `'<div class="admin-donor-actions">'`), append a declaration form when `d.declaration`:

```js
      if (d.declaration) {
        var dec = d.declaration;
        actions +=
          '<form class="admin-edit" id="donorDeclForm"><h3 class="admin-subhead">Gift Aid declaration details</h3>' +
          editField("declTitle", "Title", "text", dec.title || "") +
          editField("declFirstName", "First name", "text", dec.firstName || "") +
          editField("declLastName", "Last name", "text", dec.lastName || "") +
          editField("declHouse", "House name or number", "text", dec.houseNameNumber || "") +
          editField("declAddress", "Home address", "text", dec.address || "") +
          editField("declPostcode", "Postcode", "text", dec.postcode || "") +
          editCheck("declNonUk", "No UK postcode (overseas address)", dec.nonUk) +
          '<button class="btn btn-primary" type="submit">Save declaration details</button></form>';
      }
```

  (`editField(id, …)` renders an input with id `edit-<id>`; `editCheck(id, …)` an input with id `edit-<id>` — match the helper's convention, confirmed against `editField`/`editCheck` in `app.js`/`helpers.js`.)

- [ ] **Step 2: Wire submit in `wireDonorActions(d)`.** Add after the donor-edit form handler:

```js
    var declForm = el("donorDeclForm");
    if (declForm) {
      declForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var nonUk = el("edit-declNonUk").checked;
        var body = {
          title: (el("edit-declTitle").value || "").trim() || undefined,
          firstName: (el("edit-declFirstName").value || "").trim(),
          lastName: (el("edit-declLastName").value || "").trim(),
          houseNameNumber: (el("edit-declHouse").value || "").trim() || undefined,
          address: (el("edit-declAddress").value || "").trim(),
          nonUk: nonUk,
        };
        if (!nonUk) body.postcode = (el("edit-declPostcode").value || "").trim();
        authFetch("/api/admin/donors/" + currentDonorId + "/declaration", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
          .then(function (res) { return res.ok ? res.json() : null; })
          .then(function (snap) {
            if (snap) { renderDonor(snap); donorStatus("Declaration details saved."); }
            else donorStatus("Could not save the declaration details.");
          })
          .catch(function () { donorStatus("Could not save the declaration details."); });
      });
    }
```

- [ ] **Step 2b: Confirm the `editField`/`editCheck` id convention.** Open `assets/js/admin/app.js` (or `helpers.js`) and verify `editField("x", …)` renders `id="edit-x"` and `editCheck("x", …)` renders `id="edit-x"` with `.checked`. Adjust the `el("edit-decl…")` accessors to match exactly if the convention differs.

- [ ] **Step 3: Verify the admin app guards pass**

Run: `npm run test:unit -- admin-app admin-shell`
Expected: PASS. If `admin-app.test.ts` exercises `renderDonor`, ensure the new form only renders when `d.declaration` is present (a fixture without it is unaffected).

- [ ] **Step 4: Commit**

```bash
git add assets/js/admin/app.js
git commit -m "[TASK-130] Admin UI: edit Gift Aid declaration details in the donor view"
```

---

### Task 3: BDD scenario + steps

**Files:**
- Modify: `features/admin-api.feature`, `features/steps/*` (the admin steps file)

**Interfaces:** consumes the running app's `PATCH /api/admin/donors/:id/declaration`.

- [ ] **Step 1: Find the admin steps file + its login/seed steps.**

Run: `git grep -l "admin" features/steps` and open the admin steps file. Identify the steps that log in as a role and seed a donor + active declaration (there is an admin-api feature already). Reuse them.

- [ ] **Step 2: Add the scenario** to `features/admin-api.feature` (adapt the Given steps to the existing admin seeding steps' wording):

```gherkin
  Scenario: an editor corrects a donor's declaration address (amend, not revise)
    Given an admin session with role "editor"
    And a donor with an active Gift Aid declaration at address "Old Ave, London"
    When the admin PATCHes the donor's declaration:
      """
      { "firstName": "Ada", "lastName": "Lovelace", "houseNameNumber": "12", "address": "New Road, Ayr", "postcode": "KA7 1AA", "nonUk": false }
      """
    Then the admin response status should be 200
    And the donor's declaration address should be "New Road, Ayr"
    And the donor's declaration is not revoked
```

- [ ] **Step 3: Add whatever steps are missing** to the admin steps file, matching the existing admin request helper (base URL, bearer token from the login step, and `this.adminDonorId`/`this.declarationId` from the seed). For example (adapt to the file's helpers):

```js
When("the admin PATCHes the donor's declaration:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/admin/donors/${this.adminDonorId}/declaration`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.adminToken}` },
    body: docString,
  });
  this.adminStatus = res.status;
  this.adminBody = await res.json().catch(() => ({}));
});

Then("the donor's declaration address should be {string}", async function (addr) {
  const row = await pool.query("SELECT address FROM declarations WHERE id = $1", [this.declarationId]);
  assert.equal(row.rows[0].address, addr);
});

Then("the donor's declaration is not revoked", async function () {
  const row = await pool.query("SELECT revoked_at FROM declarations WHERE id = $1", [this.declarationId]);
  assert.ok(row.rows[0].revoked_at == null, "expected the same declaration row, not revoked");
});
```

  Reuse existing "admin session with role" / "donor with an active Gift Aid declaration" steps if present; only add the genuinely new ones. Validate wiring with a dry run:

Run: `npx cucumber-js features/admin-api.feature --dry-run`
Expected: 0 undefined steps.

- [ ] **Step 4: Commit**

```bash
git add features/admin-api.feature features/steps
git commit -m "[TASK-130] BDD: admin editor corrects a declaration address (amend)"
```

---

### Task 4: README + full green + PR

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README admin section** to note `PATCH /api/admin/donors/:id/declaration` (Editor+, amend + name sync, `admin:<email>` audit; GET now carries `declaration`), alongside the existing admin donor routes.

- [ ] **Step 2: Full green**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green.

- [ ] **Step 3: Push + PR**

```bash
git add README.md
git commit -m "[TASK-130] Docs: admin declaration-address correction route"
git push -u origin task-130-admin-edit-declaration
gh pr create --title "[TASK-130] Admin: correct a donor's Gift Aid declaration address" --body "..."
```

- [ ] **Step 4: Watch checks + squash-merge**

`gh pr checks <pr> --watch`; green (incl. BDD on fresh CI DB) ⇒ `gh pr merge <pr> --squash --delete-branch`. Red ⇒ fix + repeat.

---

## Self-Review

- **Spec coverage:** route Editor+ amend + name sync + admin actor (Task 1) ✓; GET declaration (Task 1 Step 3.2) ✓; 403/404/400/401 (Task 1 test) ✓; UI form + prefill + submit (Task 2) ✓; BDD amend (Task 3) ✓; README + green + PR (Task 4) ✓; non-atomic follow-up documented (route comment) ✓.
- **Placeholder scan:** PR `--body "..."` filled at creation from the design summary. Step 2b / Step 3 require confirming existing helper/step names before writing — flagged as verify-then-adapt, not left vague in the code blocks.
- **Type consistency:** `patchAdminDeclaration` uses `reviseDeclaration(id, fields, { scope, confirmedTaxpayer, mode, actor })` (TASK-128 signature); `declarationFieldsSchema` field names match the payload; `actorOf(claims)` returns `admin:<email>`; response shape `{ ...snapshot, ...address, declaration, outcome }` matches the GET plus `outcome`.
