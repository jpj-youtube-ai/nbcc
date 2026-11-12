# Claims Gift Aid Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the admin Gift Aid claims pipeline (`eligible → batch → export → submit`) end to end, fix the always-empty batch CSV export, and redesign the Claims view so each stage is self-explanatory.

**Architecture:** Small backend additions (`createClaimBatch`, an assign route wrapping the existing `assignDonationToBatch`, an eligible-list route) + a one-clause fix to `listClaimableDonationsForExport`, then a rebuild of the `#view-claims` UI. All mutations are Editor+ and audited via the existing `writeWithAudit`.

**Tech Stack:** Express/TypeScript, Zod, `pg`, vanilla admin JS (`assets/js/admin`), Vitest, Cucumber.

## Global Constraints

- Mutations Editor+; reads Viewer+ (mirror `authorizeAdmin(req,res,"editor"|"viewer")` in `src/routes/admin.ts`).
- Every state write + its audit row in ONE transaction (`writeWithAudit`); reuse `assignDonationToBatch` / `submitClaimBatch` patterns.
- No migration, no schema change (all columns exist). No new config, no infra.
- `claim_batches` defaults: `status='open'`, `regulator='OSCR'`, `charity_number='SC047995'`; `hmrc_reference` nullable.
- Export CSV columns (fixed, HMRC order): Title, First name, Last name, House name/number, Postcode, Donation date, Amount (`CHARITIES_ONLINE_COLUMNS`, `src/claims/charities-online.ts`).
- README.md tracks changes (golden rule 7). Branch `task-claims-gift-aid-pipeline`; PR prefixed `[TASK-NNN]` before merge; drive `pr.yml` green; self-merge.

Confirmed DB shapes: `donations(claim_status, claim_batch_id, declaration_id, …)`; `claim_status` lifecycle `eligible → batched → claimed` (also `not_eligible`, `adjustment_due`). `assignDonationToBatch(donationId, claimBatchId, actor)` sets `claim_batch_id` + `claim_status='batched'`, throws `BatchAssignmentError(reason, donationId)` (`reason ∈ not_found|not_eligible|already_batched|…`). `submitClaimBatch(batchId, actor)`. `listClaimBatches()`, `listAdjustmentDueDonations()`, `listClaimableDonationsForExport(claimBatchId?)`.

---

## File Structure

- Modify `src/db/donations.ts` — fix `listClaimableDonationsForExport` batch filter (Task 1); add `createClaimBatch` is in admin.ts.
- Modify `src/db/admin.ts` — add `createClaimBatch`, `listEligibleForClaim` (Task 2/3).
- Modify `src/routes/admin.ts` — add 3 handlers + routes (Task 2/3).
- Modify `admin.html`, `assets/js/admin/app.js`, `assets/css/admin.css` — Claims redesign (Task 4).
- Modify `README.md` — admin claims section (Task 4).
- Tests: `test/unit/charities-online-query.test.ts`/new unit files; `features/admin-api.feature` + `features/steps/admin-api.steps.js` (Task 1/2/3/5).

---

### Task 1: Fix the empty batch CSV export

**Files:**
- Modify: `src/db/donations.ts` (`listClaimableDonationsForExport`, ~line 314-345)
- Test: `test/unit/charities-online-query.test.ts` (extend) or a BDD assertion in Task 5. Primary proof is the BDD in Task 5; add a focused unit/integration note here.

**Interfaces:**
- Produces: `listClaimableDonationsForExport(claimBatchId?)` — with an id, returns the batch's donations (`claim_batch_id = id`, any status, declaration present); without, returns eligible-unbatched (`claim_status='eligible'`).

- [ ] **Step 1: Write the failing test**

The current query filters `d.claim_status='eligible' AND d.claim_batch_id=$1`, which is unsatisfiable for a batched donation. Prove it against a real DB via BDD (Task 5). For a fast unit guard, add to `test/unit/charities-online-query.test.ts` a test using the existing mocked-pool pattern in that file (mirror its setup) asserting the SQL for a batch id filters on `claim_batch_id` and does NOT constrain `claim_status='eligible'`:

```ts
// (extend the existing describe; follow the file's existing pool-mock harness)
it("selects a batch's donations by claim_batch_id, not by claim_status='eligible' (empty-CSV regression)", async () => {
  // Arrange the mocked pool to capture the SQL + params (as the file already does).
  await listClaimableDonationsForExport(42);
  const sql = capturedSql(); // helper already in this test file / add one mirroring it
  expect(sql).toMatch(/claim_batch_id\s*=\s*\$1/);
  expect(sql).not.toMatch(/claim_status\s*=\s*'eligible'/);
});
it("selects eligible unbatched donations when no batch id is given", async () => {
  await listClaimableDonationsForExport();
  expect(capturedSql()).toMatch(/claim_status\s*=\s*'eligible'/);
});
```

If `charities-online-query.test.ts` does not already mock the pool to capture SQL, follow the pool-mock pattern used in the other `src/db` unit tests (e.g. `test/unit/admin-read.test.ts`) — mock `../../src/db/pool` with a `query` spy, assert on `query.mock.calls[0][0]`.

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run test/unit/charities-online-query.test.ts`
Expected: FAIL — current SQL always contains `claim_status = 'eligible'`.

- [ ] **Step 3: Fix the query**

In `listClaimableDonationsForExport` (`src/db/donations.ts`), branch the WHERE by whether a batch id is given:

```ts
export async function listClaimableDonationsForExport(
  claimBatchId?: number,
): Promise<ClaimableExportRow[]> {
  const filterByBatch = claimBatchId != null;
  // A batch's export is its assigned donations (claim_status is 'batched' once assigned,
  // 'claimed' after submit) — NOT 'eligible', which by definition are still UNbatched. The
  // INNER JOIN to declarations still guarantees a declaration is present. Without a batch id
  // this lists the eligible-unbatched donations (the "ready to claim" picker).
  const whereSql = filterByBatch
    ? "WHERE d.claim_batch_id = $1"
    : "WHERE d.claim_status = 'eligible'";
  const res = await pool.query<ClaimableExportDbRow>(
    `SELECT d.id, dn.full_name,
            dec.title, dec.first_name, dec.last_name, dec.house_name_number, dec.postcode,
            d.created_at, d.amount_pence
       FROM donations d
       JOIN declarations dec ON dec.id = d.declaration_id
       JOIN donors dn ON dn.id = d.donor_id
      ${whereSql}
      ORDER BY d.id ASC`,
    filterByBatch ? [claimBatchId] : [],
  );
  return res.rows.map((r) => ({ /* unchanged mapping */
    donationId: r.id,
    donorFullName: r.full_name,
    declaration: { title: r.title, first_name: r.first_name, last_name: r.last_name, house_name_number: r.house_name_number, postcode: r.postcode },
    donation: { created_at: r.created_at, amount_pence: r.amount_pence },
  }));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run test/unit/charities-online-query.test.ts` → PASS.
Run: `npm run lint && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/db/donations.ts test/unit/charities-online-query.test.ts
git commit -m "[TASK-NNN] Fix empty claim-batch CSV: export by batch id, not claim_status='eligible'"
```

---

### Task 2: createClaimBatch + POST /api/admin/claim-batches

**Files:**
- Modify: `src/db/admin.ts` (add `createClaimBatch` near `submitClaimBatch`, ~line 117)
- Modify: `src/routes/admin.ts` (add handler + route near the other claim routes, ~line 349)
- Test: `test/unit/admin-api.test.ts` (create-batch handler) + `features/admin-api.feature` (+ steps)

**Interfaces:**
- Produces: `createClaimBatch(actor: string, hmrcReference?: string): Promise<{ batchId: number }>` — inserts a `claim_batches` row (defaults), audits `claim_batch.created`.
- Route `POST /api/admin/claim-batches` (Editor+) → `201 { batchId }`.

- [ ] **Step 1: Write the failing unit test** (mirror an existing handler test in `test/unit/admin-api.test.ts`; it already mocks `../../src/db/admin` and the session). Add:

```ts
it("POST /api/admin/claim-batches creates a batch (Editor) and returns its id", async () => {
  createClaimBatch.mockResolvedValue({ batchId: 77 });
  const res = await callRoute(postAdminCreateClaimBatch, { role: "editor", body: {} });
  expect(res.statusCode).toBe(201);
  expect(res.body).toEqual({ batchId: 77 });
});
it("POST /api/admin/claim-batches is forbidden for a Viewer", async () => {
  const res = await callRoute(postAdminCreateClaimBatch, { role: "viewer", body: {} });
  expect(res.statusCode).toBe(403);
  expect(createClaimBatch).not.toHaveBeenCalled();
});
```

(Use the file's existing `callRoute`/mock harness; add `createClaimBatch` to the `vi.mock("../../src/db/admin")` factory and import `postAdminCreateClaimBatch`.)

- [ ] **Step 2: Run, verify fail** — `npx vitest run test/unit/admin-api.test.ts` → FAIL (symbol not exported).

- [ ] **Step 3: Implement DB + route**

`src/db/admin.ts`:

```ts
// Create a new (open) claim batch (REQ-052/REQ-062). status/regulator/charity_number all default
// in the schema; hmrc_reference is optional (set later when the claim is prepared). Audited
// (claim_batch.created) in one transaction, mirroring submitClaimBatch.
export async function createClaimBatch(
  actor: string,
  hmrcReference?: string,
): Promise<{ batchId: number }> {
  return writeWithAudit(
    async (client) => {
      const row = (
        await client.query<{ id: number }>(
          `INSERT INTO claim_batches (hmrc_reference) VALUES ($1) RETURNING id`,
          [hmrcReference ?? null],
        )
      ).rows[0];
      return { batchId: row.id };
    },
    (r) => ({ actor, action: "claim_batch.created", entity: "claim_batch", entityId: r.batchId, data: {} }),
  );
}
```

`src/routes/admin.ts` (near the claim routes; import `createClaimBatch`):

```ts
const createBatchBodySchema = z.object({ hmrcReference: z.string().min(1).optional() });

export async function postAdminCreateClaimBatch(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "editor");
  if (!claims) return;
  const parsed = createBatchBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid claim batch request" });
  try {
    const { batchId } = await createClaimBatch(actorOf(claims), parsed.data.hmrcReference);
    return res.status(201).json({ batchId });
  } catch (err) {
    console.error("admin create claim-batch failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Claim batch create is temporarily unavailable" });
  }
}
// register with the other claim routes:
adminRouter.post("/api/admin/claim-batches", postAdminCreateClaimBatch);
```

- [ ] **Step 4: Run unit → PASS**; `npm run lint && npm run build`.

- [ ] **Step 5: Add a BDD scenario** to `features/admin-api.feature` (reuse the admin-user + auth step helpers already in `features/steps/admin-api.steps.js`; add a "create a claim batch" When step that POSTs and stores the returned id on the World):

```gherkin
  Scenario: an Editor creates a claim batch
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    When I create a claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 201
    And the created claim batch id is returned
```

Add the two step defs to `admin-api.steps.js` mirroring the existing auth-fetch helper (there is already a helper that logs in and returns a token; reuse it).

- [ ] **Step 6: Commit** (after the app-running BDD run in Task 5, or run this scenario now if the app is up).

```bash
git add src/db/admin.ts src/routes/admin.ts test/unit/admin-api.test.ts features/admin-api.feature features/steps/admin-api.steps.js
git commit -m "[TASK-NNN] Add createClaimBatch + POST /api/admin/claim-batches"
```

---

### Task 3: Assign donations to a batch + eligible-list route

**Files:**
- Modify: `src/db/admin.ts` (`listEligibleForClaim` — thin read, or reuse `listClaimableDonationsForExport()` shaped for UI)
- Modify: `src/routes/admin.ts` (assign handler + eligible-list handler + routes)
- Test: `test/unit/admin-api.test.ts` + `features/admin-api.feature`

**Interfaces:**
- Produces:
  - `GET /api/admin/claims/eligible` (Viewer+) → `{ results: [{ id, donor_name, amount_pence, postcode, created_at }] }` — eligible-unbatched donations.
  - `POST /api/admin/claim-batches/:id/donations` (Editor+), body `{ donationIds: number[] }` → `200 { assigned: number[], failed: [{ id, reason }] }`.

- [ ] **Step 1: Write failing unit tests** for both handlers in `test/unit/admin-api.test.ts` (mock `assignDonationToBatch` to resolve for one id and throw `BatchAssignmentError('already_batched', id)` for another; assert the route returns `{ assigned:[...], failed:[{id,reason}] }` and is 403 for Viewer; assert eligible-list is 200 for Viewer).

```ts
it("POST /api/admin/claim-batches/:id/donations assigns each id and reports failures", async () => {
  assignDonationToBatch.mockImplementation(async (donationId) => {
    if (donationId === 2) throw new BatchAssignmentError("already_batched", 2);
    return { donationId, claimBatchId: 9 };
  });
  const res = await callRoute(postAdminAssignBatchDonations, { role: "editor", params: { id: "9" }, body: { donationIds: [1, 2] } });
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ assigned: [1], failed: [{ id: 2, reason: "already_batched" }] });
});
it("assign is forbidden for a Viewer", async () => {
  const res = await callRoute(postAdminAssignBatchDonations, { role: "viewer", params: { id: "9" }, body: { donationIds: [1] } });
  expect(res.statusCode).toBe(403);
});
it("GET /api/admin/claims/eligible returns the list for a Viewer", async () => {
  listEligibleForClaim.mockResolvedValue([{ id: 1, donor_name: "Ada", amount_pence: 5000, postcode: "KA1 1AA", created_at: new Date(0) }]);
  const res = await callRoute(getAdminEligibleForClaim, { role: "viewer" });
  expect(res.statusCode).toBe(200);
  expect(res.body.results).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**

`src/db/admin.ts` — a read shaped for the picker (reuse the eligible query):

```ts
export interface EligibleClaimRow {
  id: number; donor_name: string; amount_pence: number; postcode: string | null; created_at: Date;
}
// Eligible-unbatched donations (claim_status='eligible' ⇒ claim_batch_id IS NULL) with a declaration,
// shaped for the "ready to claim" picker. Read-only; mirrors listClaimableDonationsForExport's joins.
export async function listEligibleForClaim(): Promise<EligibleClaimRow[]> {
  const res = await pool.query<EligibleClaimRow>(
    `SELECT d.id, dn.full_name AS donor_name, d.amount_pence, dec.postcode, d.created_at
       FROM donations d
       JOIN declarations dec ON dec.id = d.declaration_id
       JOIN donors dn ON dn.id = d.donor_id
      WHERE d.claim_status = 'eligible'
      ORDER BY d.id ASC`,
  );
  return res.rows;
}
```

`src/routes/admin.ts` (import `assignDonationToBatch`, `BatchAssignmentError` from `../db/donations`, `listEligibleForClaim` from `../db/admin`):

```ts
export async function getAdminEligibleForClaim(req: Request, res: Response): Promise<Response | void> {
  if (!authorizeAdmin(req, res, "viewer")) return;
  try {
    return res.status(200).json({ results: await listEligibleForClaim() });
  } catch (err) {
    console.error("admin eligible-for-claim list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Admin is temporarily unavailable" });
  }
}

const assignBodySchema = z.object({ donationIds: z.array(z.number().int().positive()).min(1) });

export async function postAdminAssignBatchDonations(req: Request, res: Response): Promise<Response | void> {
  const claims = authorizeAdmin(req, res, "editor");
  if (!claims) return;
  const id = claimBatchId(req, res);
  if (id == null) return;
  const parsed = assignBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid assignment request" });
  const assigned: number[] = [];
  const failed: { id: number; reason: string }[] = [];
  for (const donationId of parsed.data.donationIds) {
    try {
      await assignDonationToBatch(donationId, id, actorOf(claims));
      assigned.push(donationId);
    } catch (err) {
      if (err instanceof BatchAssignmentError) failed.push({ id: donationId, reason: err.reason });
      else {
        console.error("admin assign donation to batch failed:", err instanceof Error ? err.message : err);
        failed.push({ id: donationId, reason: "error" });
      }
    }
  }
  return res.status(200).json({ assigned, failed });
}

adminRouter.get("/api/admin/claims/eligible", getAdminEligibleForClaim);
adminRouter.post("/api/admin/claim-batches/:id/donations", postAdminAssignBatchDonations);
```

- [ ] **Step 4: Run unit → PASS**; `npm run lint && npm run build`.

- [ ] **Step 5: Commit** (BDD for the full walk is Task 5).

```bash
git add src/db/admin.ts src/routes/admin.ts test/unit/admin-api.test.ts
git commit -m "[TASK-NNN] Add eligible-for-claim list + bulk assign-to-batch route"
```

---

### Task 4: Redesign the Claims view

**Files:**
- Modify: `admin.html` (`#view-claims`, ~line 101-108)
- Modify: `assets/js/admin/app.js` (`loadClaims`, add eligible table + assign control + new-batch; ~line 265-337, delegation ~line 537)
- Modify: `assets/css/admin.css` (reuse existing classes; add minimal helpers)
- Modify: `README.md` (admin claims section)

**Interfaces:**
- Consumes: `GET /api/admin/claims/eligible`, `POST /api/admin/claim-batches`, `POST /api/admin/claim-batches/:id/donations`, plus existing list/submit/export.

- [ ] **Step 1: Restructure the markup** (`admin.html` `#view-claims`) into three labelled stages with helper copy:

```html
<section class="admin-view" id="view-claims" aria-labelledby="claims-heading" hidden>
  <h2 id="claims-heading">Gift Aid claims</h2>
  <p class="admin-view-intro">Reclaim 25% Gift Aid tax from HMRC: group eligible gifts into a batch, export it as a Charities Online file, upload it to HMRC, then mark the batch submitted.</p>

  <h3 class="admin-subhead">1. Ready to claim</h3>
  <p class="admin-help">Gift-Aided gifts with a valid declaration, not yet in a batch. Tick the ones to claim and add them to a batch.</p>
  <div class="admin-claim-actions" id="eligibleActions" hidden>
    <label>Add selected to
      <select id="assignBatchSelect"><option value="new">New batch</option></select>
    </label>
    <button class="admin-btn" type="button" id="assignBtn">Add to batch</button>
  </div>
  <div class="admin-table-wrap" id="eligibleTable"><p class="admin-loading">Loading…</p></div>

  <h3 class="admin-subhead">2. Claim batches</h3>
  <p class="admin-help">Each batch is one HMRC submission. Export it, upload to HMRC, then mark it submitted.</p>
  <div class="admin-table-wrap" id="batchesTable"><p class="admin-loading">Loading…</p></div>

  <h3 class="admin-subhead">3. Adjustment due</h3>
  <p class="admin-help">Already-claimed gifts that were later refunded — declare these as an adjustment on your next HMRC claim.</p>
  <div class="admin-table-wrap" id="adjustmentTable"><p class="admin-loading">Loading…</p></div>
</section>
```

- [ ] **Step 2: Extend `loadClaims`** in `app.js` to also load the eligible list + populate the batch `<select>`, render an eligible table with a checkbox per row (Editor+ only), and wire the assign + new-batch actions. Full JS:

```js
function loadClaims() {
  var canWrite = H.roleCan(currentRole, "editor");
  el("eligibleActions").hidden = !canWrite;
  authFetch("/api/admin/claims/eligible").then(j).then(function (d) {
    el("eligibleTable").innerHTML = eligibleTable(d.results || [], canWrite);
  }).catch(function () {});
  authFetch("/api/admin/claim-batches").then(j).then(function (d) {
    var rows = d.results || [];
    el("batchesTable").innerHTML = batchesTable(rows);
    var sel = el("assignBatchSelect");
    if (sel) {
      var opts = '<option value="new">New batch</option>';
      rows.forEach(function (b) { if (b.status === "open") opts += '<option value="' + b.id + '">Batch ' + b.id + '</option>'; });
      sel.innerHTML = opts;
    }
  }).catch(function () {});
  authFetch("/api/admin/claims/adjustment-due").then(j).then(function (d) {
    el("adjustmentTable").innerHTML = adjustmentTable(d.results || []);
  }).catch(function () {});
}
function eligibleTable(rows, canWrite) {
  if (!rows.length) return '<p class="admin-empty">No donations are waiting to be claimed.</p>';
  var body = rows.map(function (r) {
    var box = canWrite ? '<td><input type="checkbox" class="elig-check" value="' + r.id + '"></td>' : "";
    return "<tr>" + box + "<td>" + r.id + "</td><td>" + H.escapeHtml(r.donor_name) +
      '</td><td class="admin-num">' + H.formatPence(r.amount_pence) + "</td><td>" +
      H.escapeHtml(r.postcode || "") + "</td><td>" + H.fmtDate(r.created_at) + "</td></tr>";
  }).join("");
  var head = (canWrite ? "<th></th>" : "") + "<th>ID</th><th>Donor</th><th>Amount</th><th>Postcode</th><th>Date</th>";
  return '<table class="admin-table"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table>";
}
function assignSelected() {
  var ids = Array.prototype.slice.call(doc.querySelectorAll(".elig-check:checked")).map(function (c) { return Number(c.value); });
  if (!ids.length) { window.alert("Tick at least one donation first."); return; }
  var target = el("assignBatchSelect").value;
  function post(batchId) {
    authFetch("/api/admin/claim-batches/" + batchId + "/donations", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ donationIds: ids }),
    }).then(function (res) { return res.ok ? res.json() : null; }).then(function (out) {
      if (out && out.failed && out.failed.length) window.alert("Added " + out.assigned.length + ", " + out.failed.length + " could not be added.");
      loadClaims();
    }).catch(function () {});
  }
  if (target === "new") {
    authFetch("/api/admin/claim-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(function (res) { return res.json(); }).then(function (d) { post(d.batchId); }).catch(function () {});
  } else { post(target); }
}
```

Wire the buttons: add `bindClick("assignBtn", assignSelected);` where the other `bindClick`s are, and (since `newBatch` is folded into the assign "New batch" option) no separate handler is needed. Keep the existing `data-submit-batch` / `data-export-batch` delegation as-is.

- [ ] **Step 3: Add minimal CSS** to `assets/css/admin.css` (only if the classes don't already exist — check first):

```css
.admin-view-intro { color: var(--admin-muted, #555); margin: 0 0 1rem; max-width: 60ch; }
.admin-help { color: var(--admin-muted, #666); font-size: 0.9rem; margin: 0.25rem 0 0.5rem; }
.admin-claim-actions { display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
```

(Match existing token names in admin.css — inspect the file for the muted-text variable before adding; reuse it rather than hardcoding.)

- [ ] **Step 4: Update README.md** admin section — describe the Claims workflow (eligible → batch → export → submit) and that the export is by batch id.

- [ ] **Step 5: Verify in the running admin UI** (:3002, app booted per the TASK-116 recipe): log in as an editor, open Claims, create a batch by ticking eligible donations + "New batch", Export the batch → CSV downloads with rows, Submit. Screenshot/confirm.

- [ ] **Step 6: Commit**

```bash
git add admin.html assets/js/admin/app.js assets/css/admin.css README.md
git commit -m "[TASK-NNN] Redesign the Claims view: labelled pipeline, eligible picker, assign-to-batch"
```

---

### Task 5: End-to-end BDD + full verification

**Files:**
- Modify: `features/admin-api.feature`, `features/steps/admin-api.steps.js`

- [ ] **Step 1: Add the pipeline scenario** (reuse existing admin-user/auth + "an eligible donation" seeding if present; otherwise add a Given that seeds a donation with `claim_status='eligible'` + a declaration via SQL in the steps World, mirroring the existing `@db` seed steps):

```gherkin
  Scenario: an Editor claims eligible donations end to end and exports a non-empty CSV
    Given an admin user "editor.admin.bdd@example.com" with role "editor" and password "edit-pw-123"
    And an eligible Gift-Aided donation
    When I create a claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    And I add the eligible donation to the batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    When I export the claim batch as "editor.admin.bdd@example.com" with password "edit-pw-123"
    Then the admin response status should be 200
    And the exported CSV has at least 1 data row
```

Add the step defs (create batch → store id; seed an eligible donation → store id; add-to-batch POST; export GET → capture CSV text; assert the CSV has > 1 line). Reuse the existing login/token helper and the `pg` pool already in `admin-api.steps.js`.

- [ ] **Step 2: Run the whole thing** with the app booted (TASK-116 recipe: build, boot on :3002 with the stub env, `source bddenv.sh`):

```bash
npm run lint && npm run build && npm run test:unit
# boot app on :3002, then:
npx cucumber-js --tags @admin   # or the tag on admin-api.feature
npx cucumber-js                 # full suite (clear evt_bdd_% ledger first if re-running locally)
```

Expected: the new scenario passes (was impossible before — empty CSV); whole suite green; unit green; lint clean.

- [ ] **Step 3: Commit**

```bash
git add features/admin-api.feature features/steps/admin-api.steps.js
git commit -m "[TASK-NNN] Add end-to-end claims pipeline BDD (eligible -> batch -> non-empty export)"
```

---

### Task 6: PR to green merge

- [ ] Rebase on `origin/main`, push, open PR (title prefixed with the assigned `[TASK-NNN]`).
- [ ] `gh pr checks --watch`; on green, `gh pr merge --squash --delete-branch`. Red ⇒ fix, push, re-watch.

---

## Self-Review

**Spec coverage:** empty-CSV fix → Task 1; createClaimBatch + route → Task 2; assign + eligible-list routes → Task 3; UI redesign + README → Task 4; end-to-end BDD → Task 5; merge → Task 6. All spec sections mapped.

**Placeholder scan:** Backend + query + route code is complete and concrete. UI JS/markup/CSS is concrete. The two soft spots — the exact `test/unit/admin-api.test.ts` mock harness names (`callRoute`) and the `admin-api.steps.js` login helper name — are "follow the existing pattern in this file" because those helpers already exist and must be reused verbatim; the implementer reads the file and matches. Not inventing new patterns.

**Type/name consistency:** `createClaimBatch(actor, hmrcReference?) → {batchId}`, `listEligibleForClaim() → EligibleClaimRow[]`, `postAdminAssignBatchDonations` returns `{assigned, failed:[{id,reason}]}`, `listClaimableDonationsForExport(batchId?)` — names used identically across tasks and the UI fetch calls. Routes: `POST /api/admin/claim-batches`, `POST /api/admin/claim-batches/:id/donations`, `GET /api/admin/claims/eligible` — consistent between route registration, unit tests, BDD, and app.js.
</content>
