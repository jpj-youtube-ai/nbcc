# Portal edit Gift Aid declaration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a magic-link donor correct the identity/address on their active Gift Aid declaration (the amend path from TASK-128), keeping the account name in sync.

**Architecture:** A read (`getActiveDeclarationForDonor`) + a new `PATCH /api/portal/:token/declaration` route that calls `reviseDeclaration` (always the amend path — scope/taxpayer held current) and syncs `donors.full_name`. The GET response carries the active declaration so `portal.html` can prefill a new edit form wired in `assets/js/main.js`.

**Tech Stack:** Express + TypeScript, Zod, Postgres (pool), Vitest (mocked pool), Cucumber (BDD), vanilla `main.js`, static `portal.html`.

## Global Constraints

- Editable fields: `title?`, `firstName`, `lastName`, `houseNameNumber?`, `address`, `postcode?`, `nonUk` — validated by the existing `declarationFieldsSchema` (`src/declarations/fields.ts`). No `scope`/`confirmed_taxpayer` editing.
- Every portal edit is the **amend** path: pass `scope` + `confirmedTaxpayer` = the active declaration's current values, so `reviseDeclaration` returns `amended` or `unchanged`, never `revised`.
- Name sync (option b): on save, write the declaration's `first_name`/`last_name` AND `donors.full_name = "First Last"`.
- Only donors with an active declaration (`revoked_at IS NULL`, newest) see/patch the form; none → 404.
- `reviseDeclaration` / `updateDonorPortal` are two transactions (declaration first); name-sync failure is a logged 500 leaving the declaration correct — documented non-atomic follow-up.
- Overseas-address copy is dash-free (REQ-031); every input has a `<label for>` (REQ-032). `portal.html` is already in the guard PAGES lists.
- One PR, `[TASK-129]` title, branch `task-129-portal-edit-declaration`. Lint + build + unit + BDD green before self-merge.

---

### Task 1: `getActiveDeclarationForDonor` read

**Files:**
- Modify: `src/db/portal.ts`
- Test: `test/unit/portal-active-declaration.test.ts` (new)

**Interfaces:**
- Consumes: `pool` from `./pool`; `Scope` from `../declarations/wording`.
- Produces:
  ```ts
  export interface ActiveDeclaration {
    id: number; title: string | null; firstName: string; lastName: string;
    houseNameNumber: string; address: string; postcode: string | null;
    nonUk: boolean; scope: Scope; confirmedTaxpayer: boolean;
  }
  export function getActiveDeclarationForDonor(donorId: number): Promise<ActiveDeclaration | null>
  ```

- [ ] **Step 1: Write the failing test** `test/unit/portal-active-declaration.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { getActiveDeclarationForDonor } from "../../src/db/portal";

beforeEach(() => queryMock.mockReset());

describe("getActiveDeclarationForDonor (TASK-129)", () => {
  it("maps the active declaration row to camelCase", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 7, title: "Dr", first_name: "Ada", last_name: "Lovelace",
        house_name_number: "12", address: "Analytical Ave, London", postcode: "SW1A 1AA",
        non_uk: false, scope: "all_donations", confirmed_taxpayer: true,
      }],
      rowCount: 1,
    });
    const decl = await getActiveDeclarationForDonor(42);
    expect(decl).toEqual({
      id: 7, title: "Dr", firstName: "Ada", lastName: "Lovelace",
      houseNameNumber: "12", address: "Analytical Ave, London", postcode: "SW1A 1AA",
      nonUk: false, scope: "all_donations", confirmedTaxpayer: true,
    });
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/revoked_at is null/i);
    expect(sql).toMatch(/order by id desc/i);
  });

  it("returns null when the donor has no active declaration", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getActiveDeclarationForDonor(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- portal-active-declaration`
Expected: FAIL — `getActiveDeclarationForDonor` not exported.

- [ ] **Step 3: Implement** in `src/db/portal.ts`. Add the `Scope` import to the existing imports (`import type { Scope } from "../declarations/wording";`) and append:

```ts
// The donor's ACTIVE Gift Aid declaration (REQ-059 · TASK-129) — the newest non-revoked row — with
// its editable identity/address fields plus the frozen consent (scope + taxpayer confirmation) the
// portal edit round-trips unchanged so reviseDeclaration takes the amend path. Read-only (pool.query).
export interface ActiveDeclaration {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  houseNameNumber: string;
  address: string;
  postcode: string | null;
  nonUk: boolean;
  scope: Scope;
  confirmedTaxpayer: boolean;
}

export async function getActiveDeclarationForDonor(donorId: number): Promise<ActiveDeclaration | null> {
  const row = (
    await pool.query<{
      id: number;
      title: string | null;
      first_name: string;
      last_name: string;
      house_name_number: string;
      address: string;
      postcode: string | null;
      non_uk: boolean;
      scope: Scope;
      confirmed_taxpayer: boolean;
    }>(
      `SELECT id, title, first_name, last_name, house_name_number, address, postcode, non_uk,
              scope, confirmed_taxpayer
         FROM declarations
        WHERE donor_id = $1 AND revoked_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [donorId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    firstName: row.first_name,
    lastName: row.last_name,
    houseNameNumber: row.house_name_number,
    address: row.address,
    postcode: row.postcode,
    nonUk: row.non_uk,
    scope: row.scope,
    confirmedTaxpayer: row.confirmed_taxpayer,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- portal-active-declaration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/portal.ts test/unit/portal-active-declaration.test.ts
git commit -m "[TASK-129] Add getActiveDeclarationForDonor read for the portal declaration edit"
```

---

### Task 2: `PATCH /api/portal/:token/declaration` route + GET carries the declaration

**Files:**
- Modify: `src/routes/portal.ts`
- Test: `test/unit/portal-declaration-edit.test.ts` (new)

**Interfaces:**
- Consumes: `getActiveDeclarationForDonor` (Task 1); `reviseDeclaration` (`src/db/declarations.ts`); `updateDonorPortal`, `getDonorPortalSnapshot` (`src/db/portal.ts`); `declarationFieldsSchema` (`src/declarations/fields.ts`).
- Produces: `patchDeclaration(req, res)` handler + the route `portalRouter.patch("/api/portal/:token/declaration", patchDeclaration)`; `getPortal` response gains `declaration`.

- [ ] **Step 1: Write the failing route test** `test/unit/portal-declaration-edit.test.ts`. Mirror `portal-api.test.ts`'s hoisted mocks, but mock the db modules directly so the assertions are on the calls:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const { authMock, getActiveMock, reviseMock, updateMock, snapshotMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  getActiveMock: vi.fn(),
  reviseMock: vi.fn(),
  updateMock: vi.fn(),
  snapshotMock: vi.fn(),
}));

vi.mock("../../src/db/portal", () => ({
  authenticatePortalToken: authMock,
  getActiveDeclarationForDonor: getActiveMock,
  updateDonorPortal: updateMock,
  getDonorPortalSnapshot: snapshotMock,
  // unused-by-these-tests exports the route module imports:
  getDonorDonationHistory: vi.fn(),
  issuePortalAccessToken: vi.fn(),
  findNewestDonorByEmail: vi.fn(),
}));
vi.mock("../../src/db/declarations", () => ({
  reviseDeclaration: reviseMock,
  findActiveDeclarationIdForDonor: vi.fn(),
  cancelDeclaration: vi.fn(),
  DeclarationCancellationError: class extends Error {},
}));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa", STRIPE_WEBHOOK_SECRET: "whsec_x",
    PORTAL_BASE_URL: "https://example.org/portal",
  },
}));

import { patchDeclaration } from "../../src/routes/portal";

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
const makeRes = (): MockRes => {
  const res: MockRes = {
    statusCode: 0, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
};
const validFields = {
  title: "Dr", firstName: "Ada", lastName: "Lovelace", houseNameNumber: "12",
  address: "New Address, Kilmarnock", postcode: "KA1 1AA", nonUk: false,
};

beforeEach(() => {
  authMock.mockReset(); getActiveMock.mockReset(); reviseMock.mockReset();
  updateMock.mockReset(); snapshotMock.mockReset();
  authMock.mockResolvedValue({ donorId: 42 });
  getActiveMock.mockResolvedValue({ id: 7, scope: "all_donations", confirmedTaxpayer: true, firstName: "Ada", lastName: "Lovelace" });
  reviseMock.mockResolvedValue({ outcome: "amended", declarationId: 7, changedFields: ["address"] });
  updateMock.mockResolvedValue({ donorId: 42, fields: ["fullName"] });
  snapshotMock.mockResolvedValue({ donorId: 42, fullName: "Ada Lovelace" });
});

describe("PATCH /api/portal/:token/declaration (TASK-129)", () => {
  it("amends the active declaration and syncs the account name", async () => {
    const res = makeRes();
    await patchDeclaration({ params: { token: "t" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(200);
    expect(reviseMock).toHaveBeenCalledWith(7, expect.objectContaining({ address: "New Address, Kilmarnock" }),
      expect.objectContaining({ scope: "all_donations", confirmedTaxpayer: true, actor: "donor" }));
    expect(updateMock).toHaveBeenCalledWith(42, { fullName: "Ada Lovelace" }, "donor");
  });

  it("404s when the donor has no active declaration", async () => {
    getActiveMock.mockResolvedValueOnce(null);
    const res = makeRes();
    await patchDeclaration({ params: { token: "t" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(404);
    expect(reviseMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("400s on an invalid body (blank last name)", async () => {
    const res = makeRes();
    await patchDeclaration({ params: { token: "t" }, body: { ...validFields, lastName: "" } } as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(reviseMock).not.toHaveBeenCalled();
  });

  it("401s on an invalid token", async () => {
    const { PortalTokenError } = await import("../../src/portal/tokens");
    authMock.mockRejectedValueOnce(new PortalTokenError("expired"));
    const res = makeRes();
    await patchDeclaration({ params: { token: "bad" }, body: validFields } as never, res as never);
    expect(res.statusCode).toBe(401);
  });
});
```

  (If `PortalTokenError`'s constructor signature differs, match it — check `src/portal/tokens.ts`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- portal-declaration-edit`
Expected: FAIL — `patchDeclaration` not exported.

- [ ] **Step 3: Implement in `src/routes/portal.ts`.**

  1. Extend the imports: add `getActiveDeclarationForDonor` to the `../db/portal` import, `reviseDeclaration` to the `../db/declarations` import, and add `import { declarationFieldsSchema } from "../declarations/fields";`.

  2. In `getPortal`, include the active declaration in the response. Replace the `getDonorDonationHistory` block's return with:

```ts
    const history = snapshot.email
      ? await getDonorDonationHistory(snapshot.email)
      : { totalPence: 0, count: 0, donations: [] };
    const declaration = await getActiveDeclarationForDonor(donorId);
    return res.status(200).json({ ...snapshot, history, declaration });
```

  3. Add the handler (after `patchPortal`):

```ts
// Edit the identity / address on the donor's ACTIVE Gift Aid declaration (REQ-059 · TASK-129). The
// token authenticates the donor; the body is the declaration's matching fields (declarationFieldsSchema).
// We hold scope + taxpayer confirmation at the declaration's CURRENT values, so reviseDeclaration always
// takes the AMEND path (update the matching columns in place, a declaration.amended audit note — no new
// row); a scope/consent change is out of scope here. The account name is synced to first+last so
// donors.full_name never diverges from the declaration. No active declaration → 404.
export async function patchDeclaration(req: Request, res: Response): Promise<Response | void> {
  const donorId = await authOrReject(req, res);
  if (donorId == null) return;

  const parsed = declarationFieldsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid declaration update", details: parsed.error.flatten() });
  }
  const fields = parsed.data;

  try {
    const active = await getActiveDeclarationForDonor(donorId);
    if (!active) {
      return res.status(404).json({ error: "No active Gift Aid declaration to edit" });
    }
    // scope + taxpayer held at the current values → always the amend path. mode only feeds wording
    // selection, which the amend path never emits, so a fixed "once" is safe here.
    const result = await reviseDeclaration(active.id, fields, {
      scope: active.scope,
      confirmedTaxpayer: active.confirmedTaxpayer,
      mode: "once",
      actor: "donor",
    });
    // Keep the account name in sync with the declaration name (option b).
    await updateDonorPortal(donorId, { fullName: `${fields.firstName} ${fields.lastName}` }, "donor");

    const declaration = await getActiveDeclarationForDonor(donorId);
    const snapshot = await getDonorPortalSnapshot(donorId);
    return res.status(200).json({ ...snapshot, declaration, outcome: result.outcome });
  } catch (err) {
    console.error("portal declaration update failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Declaration update is temporarily unavailable" });
  }
}
```

  4. Register the route (next to the other portal routes):

```ts
portalRouter.patch("/api/portal/:token/declaration", patchDeclaration);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- portal-declaration-edit`
Expected: PASS.

- [ ] **Step 5: Lint + build + confirm the existing portal-api test still passes**

Run: `npm run lint && npm run build && npm run test:unit -- portal-api portal-declaration-edit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/routes/portal.ts test/unit/portal-declaration-edit.test.ts
git commit -m "[TASK-129] Wire PATCH /api/portal/:token/declaration (amend + name sync)"
```

---

### Task 3: Portal UI — declaration edit form

**Files:**
- Modify: `portal.html`, `assets/js/main.js`

**Interfaces:**
- Consumes: `GET /api/portal/:token` response's `declaration`; `PATCH /api/portal/:token/declaration`.
- Produces: the `#portalDeclaration` card + form; `initPortal` prefill/submit wiring.

- [ ] **Step 1: Add the form to `portal.html`.** After the "Your Gift Aid" `portal-card` (the block ending at the `</div>` after `#cancelGiftAid`), insert a new card, shipped hidden:

```html
          <!-- Edit Gift Aid declaration details (REQ-059 · TASK-129): identity/address only. -->
          <div class="portal-card card reveal" id="portalDeclaration" aria-labelledby="portal-decl-heading" hidden>
            <h2 id="portal-decl-heading">Your Gift Aid declaration details</h2>
            <p class="portal-note">Keep the name and address on your declaration up to date so HMRC can match your donations. Changing these does not affect your Gift Aid — it stays in place.</p>
            <form class="give-declaration" id="portalDeclForm" novalidate>
              <div class="give-field">
                <label for="pdTitle">Title <span class="give-optional">(optional)</span></label>
                <input type="text" id="pdTitle" name="title" class="give-field-input" autocomplete="honorific-prefix" placeholder="Mr, Ms, Dr" />
              </div>
              <div class="give-field">
                <label for="pdFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>
                <input type="text" id="pdFirstName" name="firstName" class="give-field-input" autocomplete="given-name" required aria-required="true" />
              </div>
              <div class="give-field">
                <label for="pdLastName">Last name <span class="give-req" aria-hidden="true">*</span></label>
                <input type="text" id="pdLastName" name="lastName" class="give-field-input" autocomplete="family-name" required aria-required="true" />
              </div>
              <div class="give-field">
                <label for="pdHouse">House name or number <span class="give-req" aria-hidden="true">*</span></label>
                <input type="text" id="pdHouse" name="houseNameNumber" class="give-field-input" required aria-required="true" placeholder="e.g. 12 or Rose Cottage" />
              </div>
              <div class="give-field">
                <label for="pdAddress">Home address <span class="give-req" aria-hidden="true">*</span></label>
                <input type="text" id="pdAddress" name="address" class="give-field-input" autocomplete="street-address" required aria-required="true" placeholder="Street and town" />
              </div>
              <div class="give-field" id="pdPostcodeField">
                <label for="pdPostcode">Postcode <span class="give-req" aria-hidden="true">*</span></label>
                <input type="text" id="pdPostcode" name="postcode" class="give-field-input" autocomplete="postal-code" required aria-required="true" placeholder="e.g. KA1 1AA" />
              </div>
              <label class="give-check" for="pdNonUk">
                <input type="checkbox" id="pdNonUk" name="nonUk" class="give-check-box" value="true" />
                <span class="give-check-text">I have no UK postcode, for example my home address is in the Channel Islands or Isle of Man.</span>
              </label>
              <div class="portal-actions">
                <button class="btn btn-primary" type="submit">Save my declaration details</button>
              </div>
            </form>
          </div>
```

- [ ] **Step 2: Wire it in `assets/js/main.js` `initPortal`.** In the render function (where the snapshot is applied, near `portalName`/`portalGiftAid`), after the existing rendering add prefill + reveal, and register a submit handler. Add this inside `initPortal` (adapt variable names to the file's existing `doc`, `base`, `actionStatus`, and render function):

```js
    // Gift Aid declaration edit (TASK-129): show + prefill only when the donor has an active
    // declaration; PATCH the matching fields, then reflect the synced name in "Your details".
    var declCard = doc.getElementById("portalDeclaration");
    var declForm = doc.getElementById("portalDeclForm");
    var pdPostcodeField = doc.getElementById("pdPostcodeField");
    var pdPostcode = doc.getElementById("pdPostcode");
    var pdNonUk = doc.getElementById("pdNonUk");

    function applyPdNonUk() {
      var off = !!(pdNonUk && pdNonUk.checked);
      if (pdPostcodeField) pdPostcodeField.hidden = off;
      if (pdPostcode) {
        pdPostcode.disabled = off;
        if (off) { pdPostcode.removeAttribute("required"); pdPostcode.removeAttribute("aria-required"); }
        else { pdPostcode.setAttribute("required", ""); pdPostcode.setAttribute("aria-required", "true"); }
      }
    }
    if (pdNonUk) pdNonUk.addEventListener("change", applyPdNonUk);

    function prefillDeclaration(decl) {
      if (!declCard || !decl) return;
      var set = function (id, v) { var el = doc.getElementById(id); if (el) el.value = v == null ? "" : v; };
      set("pdTitle", decl.title); set("pdFirstName", decl.firstName); set("pdLastName", decl.lastName);
      set("pdHouse", decl.houseNameNumber); set("pdAddress", decl.address); set("pdPostcode", decl.postcode);
      if (pdNonUk) pdNonUk.checked = !!decl.nonUk;
      applyPdNonUk();
      declCard.hidden = false;
    }

    if (declForm) {
      declForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var nonUk = !!(pdNonUk && pdNonUk.checked);
        var payload = {
          title: (doc.getElementById("pdTitle").value || "").trim() || undefined,
          firstName: doc.getElementById("pdFirstName").value.trim(),
          lastName: doc.getElementById("pdLastName").value.trim(),
          houseNameNumber: doc.getElementById("pdHouse").value.trim() || undefined,
          address: doc.getElementById("pdAddress").value.trim(),
          nonUk: nonUk,
        };
        if (!nonUk) payload.postcode = doc.getElementById("pdPostcode").value.trim();
        fetch(base + "/declaration", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
          .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, b: b }; }); })
          .then(function (res) {
            if (actionStatus) actionStatus.textContent = res.ok ? "Your declaration details are updated." : (res.b && res.b.error) || "Could not update your declaration.";
            if (res.ok && res.b && res.b.declaration) {
              prefillDeclaration(res.b.declaration);
              var nameEl = doc.getElementById("portalName");
              if (nameEl) nameEl.textContent = res.b.declaration.firstName + " " + res.b.declaration.lastName;
            }
          })
          .catch(function () { if (actionStatus) actionStatus.textContent = "Could not update your declaration."; });
      });
    }
```

  In the snapshot render function, call `prefillDeclaration(data.declaration)` where the snapshot `data` is applied.

- [ ] **Step 3: Verify the page still renders + guards pass**

Run: `npm run test:unit -- portal accessibility copy-rules seo`
Expected: PASS (new inputs have `<label for>`; overseas copy is dash-free). If the accessibility guard needs the postcode field's label association, confirm each `for`/`id` matches.

- [ ] **Step 4: Commit**

```bash
git add portal.html assets/js/main.js
git commit -m "[TASK-129] Portal UI: edit Gift Aid declaration details form + prefill/submit"
```

---

### Task 4: BDD scenario + steps

**Files:**
- Modify: `features/portal.feature`, `features/steps/portal.steps.js`

**Interfaces:** consumes the running app's `PATCH /api/portal/:token/declaration`.

- [ ] **Step 1: Add the scenario** to `features/portal.feature`:

```gherkin
  Scenario: a donor edits the address on their active declaration (amend, not revise)
    Given a donor "Gus Portal" with email "gus.portal.bdd@example.com" and a valid portal token
    And the donor has an active Gift Aid declaration
    When I PATCH the donor's Gift Aid declaration:
      """
      { "firstName": "Gus", "lastName": "Portal", "houseNameNumber": "9", "address": "New Road, Ayr", "postcode": "KA7 1AA", "nonUk": false }
      """
    Then the portal response status should be 200
    And the donor's active declaration address should be "New Road, Ayr"
    And the donor's declaration is not revoked
```

- [ ] **Step 2: Add the steps** to `features/steps/portal.steps.js`:

```js
When("I PATCH the donor's Gift Aid declaration:", async function (docString) {
  const res = await fetch(`${BASE_URL}/api/portal/${this.portalToken}/declaration`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: docString,
  });
  this.portalStatus = res.status;
  this.portalBody = await res.json().catch(() => ({}));
});

Then("the donor's active declaration address should be {string}", async function (addr) {
  const row = await pool.query("SELECT address FROM declarations WHERE id = $1", [this.declarationId]);
  assert.equal(row.rows[0].address, addr);
});

Then("the donor's declaration is not revoked", async function () {
  const row = await pool.query("SELECT revoked_at FROM declarations WHERE id = $1", [this.declarationId]);
  assert.ok(row.rows[0].revoked_at == null, "expected the same declaration row, not revoked");
});
```

- [ ] **Step 3: Run the portal BDD locally**

Start the app on the local port with a DB, then run the portal feature (see memory: local BDD needs the dev DB on 5435 and the app running).
Run: `npm run test:bdd -- features/portal.feature`
Expected: the new scenario passes (200; address updated; same row not revoked). If the local run is impractical, rely on CI `pr.yml` (fresh DB).

- [ ] **Step 4: Commit**

```bash
git add features/portal.feature features/steps/portal.steps.js
git commit -m "[TASK-129] BDD: donor edits declaration address (amend) via the portal"
```

---

### Task 5: README + full green + PR

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README portal + Declaration revision sections.** In the portal section note the new "Gift Aid declaration details" edit (identity/address only, amend path, name synced). In the "Declaration revision" section note the amend path is now donor-reachable via `PATCH /api/portal/:token/declaration`.

- [ ] **Step 2: Full green**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green.

- [ ] **Step 3: Push + PR**

```bash
git add README.md
git commit -m "[TASK-129] Docs: portal declaration-details edit + amend path wired"
git push -u origin task-129-portal-edit-declaration
gh pr create --title "[TASK-129] Portal: edit Gift Aid declaration details (wire reviseDeclaration)" --body "..."
```

- [ ] **Step 4: Watch checks + squash-merge**

`gh pr checks <pr> --watch`; green (incl. BDD on fresh CI DB) ⇒ `gh pr merge <pr> --squash --delete-branch`. Red ⇒ fix + repeat.

---

## Self-Review

- **Spec coverage:** read (Task 1) ✓; route + GET declaration + amend + name sync + 404/400/401 (Task 2) ✓; UI form + prefill + overseas toggle (Task 3) ✓; BDD amend scenario (Task 4) ✓; README + green + PR (Task 5) ✓; identity-only → always amend (fixed scope/taxpayer, Task 2 Step 3) ✓; non-atomic follow-up documented (spec + route comment) ✓.
- **Placeholder scan:** PR `--body "..."` filled at creation from the design summary; no other placeholders.
- **Type consistency:** `ActiveDeclaration` (camelCase) used by the read + route; `reviseDeclaration(id, fields, { scope, confirmedTaxpayer, mode, actor })` matches TASK-128's signature; `result.outcome` matches the `ReviseDeclarationResult` union; `declarationFieldsSchema` fields (`firstName`/`lastName`/`houseNameNumber`/`postcode`/`nonUk`) match the form payload keys.
