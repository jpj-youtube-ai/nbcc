# Declaration amend-vs-revise split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editing a Gift Aid declaration amends identity/address in place (a note) but revokes-and-supersedes only on a consent change (scope / taxpayer confirmation), and stop framing the immutable-revise rule as HMRC-mandated.

**Architecture:** The pure `buildDeclarationRevision` returns a discriminated union `amend | revise | null`; the audited `reviseDeclaration` handles both (amend = in-place `UPDATE` + one audit row; revise = today's revoke+supersede). No schema change. Docs reframed; SPEC flagged upstream.

**Tech Stack:** TypeScript, Vitest (unit, mocked pool), Postgres (node-pg-migrate), Cucumber (BDD).

## Global Constraints

- CONSENT columns (immutable → revise): `scope`, `confirmed_taxpayer`.
- MATCHING columns (amend in place): `title`, `first_name`, `last_name`, `house_name_number`, `address`, `postcode`, `non_uk`.
- Consent change dominates: if a consent field changed, revise (the new row carries updated matching too), regardless of matching changes.
- No schema change (amend updates existing columns; `audit_log` exists), no route/UI (`reviseDeclaration` is not yet wired to an endpoint), no HMRC-export change.
- Audit action for an amend: `declaration.amended`, `data: { changedFields, donorId }`.
- Framing: the revise-on-consent-change is NBCC's design choice, NOT HMRC-mandated; HMRC permits noting an address change on the enduring declaration. Do NOT hand-edit `SPEC.md` (generated) — flag REQ-059 upstream.
- One PR, `[TASK-128]` title, branch `task-128-declaration-amend-vs-revise`. Lint + build + unit + BDD green before self-merge.

---

### Task 1: Amend-vs-revise in the pure builder + audited write

**Files:**
- Modify: `src/declarations/revision.ts`
- Modify: `src/db/declarations.ts`
- Test: `test/unit/declaration-revision.test.ts`

**Interfaces:**
- Consumes: `buildDeclarationRow`, `DeclarationRow`, `DeclarationFields` (fields.ts); `selectDeclarationWording` (wording.ts); `insertAudit`, `insertDeclaration` (donors/db).
- Produces:
  - `type DeclarationRevision = { kind: "amend"; declarationId: number; changes: DeclarationMatchingColumns; changedFields: string[] } | { kind: "revise"; revokedDeclaration: { id: number; revoked_at: Date }; newDeclaration: DeclarationRow }` (or `null`).
  - `buildDeclarationRevision(input): DeclarationRevision | null` (same input shape as today).
  - `type ReviseDeclarationResult = { outcome: "unchanged"; declarationId: number } | { outcome: "amended"; declarationId: number; changedFields: string[] } | { outcome: "revised"; revokedDeclarationId: number; newDeclarationId: number }`.
  - `reviseDeclaration(declarationId, updated, context): Promise<ReviseDeclarationResult>` (same params as today).

- [ ] **Step 1: Rewrite the builder tests** in `test/unit/declaration-revision.test.ts`. Replace the whole `describe("buildDeclarationRevision (pure) — REQ-059", ...)` block with:

```ts
describe("buildDeclarationRevision (pure) — REQ-059 / TASK-128", () => {
  it("returns null (no-op) when the meaningful fields are identical", () => {
    expect(
      buildDeclarationRevision({ current: currentRow, updated: currentFields, scope: "this_donation", confirmedTaxpayer: true, mode: "once", now: NOW }),
    ).toBeNull();
  });

  it("AMENDS in place when only identity/address fields change (name/address/postcode/non-UK)", () => {
    const result = buildDeclarationRevision({
      current: currentRow,
      updated: { ...currentFields, address: "New Address, Kilmarnock" },
      scope: "this_donation",
      confirmedTaxpayer: true,
      mode: "once",
      now: NOW,
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("amend");
    if (result!.kind !== "amend") throw new Error("expected amend");
    expect(result!.declarationId).toBe(10);
    expect(result!.changes.address).toBe("New Address, Kilmarnock");
    expect(result!.changedFields).toContain("address");
  });

  it("AMENDS for a postcode-only or non-UK-only change", () => {
    for (const updated of [
      { ...currentFields, postcode: "M1 1AE" },
      { firstName: "Ada", lastName: "Lovelace", houseNameNumber: "12", address: "Analytical Avenue, London", nonUk: true },
    ]) {
      const r = buildDeclarationRevision({ current: currentRow, updated, scope: "this_donation", confirmedTaxpayer: true, mode: "once", now: NOW });
      expect(r?.kind).toBe("amend");
    }
  });

  it("REVISES (revoke+new) when the scope changes, the new row carrying the current wording", () => {
    const result = buildDeclarationRevision({
      current: currentRow, updated: currentFields, scope: "all_donations", confirmedTaxpayer: true, mode: "once", now: NOW,
    });
    expect(result!.kind).toBe("revise");
    if (result!.kind !== "revise") throw new Error("expected revise");
    expect(result!.revokedDeclaration).toEqual({ id: 10, revoked_at: NOW });
    const wording = selectDeclarationWording({ mode: "once", scope: "all_donations" });
    expect(result!.newDeclaration.wording_version).toBe(wording.wording_version);
    expect(result!.newDeclaration.scope).toBe("all_donations");
  });

  it("REVISES when the taxpayer confirmation changes", () => {
    const r = buildDeclarationRevision({ current: currentRow, updated: currentFields, scope: "this_donation", confirmedTaxpayer: false, mode: "once", now: NOW });
    expect(r?.kind).toBe("revise");
  });

  it("REVISES when consent AND identity both change, the new row carrying the new address", () => {
    const r = buildDeclarationRevision({
      current: currentRow, updated: { ...currentFields, address: "New Address, Kilmarnock" }, scope: "all_donations", confirmedTaxpayer: true, mode: "once", now: NOW,
    });
    expect(r!.kind).toBe("revise");
    if (r!.kind !== "revise") throw new Error("expected revise");
    expect(r!.newDeclaration.address).toBe("New Address, Kilmarnock");
  });
});
```

- [ ] **Step 2: Run the builder tests to verify they fail**

Run: `npm run test:unit -- declaration-revision`
Expected: FAIL — `result.kind` undefined (builder still returns the old shape).

- [ ] **Step 3: Rewrite `src/declarations/revision.ts`.** Replace the `COMPARED_COLUMNS`, the `DeclarationRevision` interface, and `buildDeclarationRevision` with:

```ts
// The immutable CONSENT of a declaration — the scope and the taxpayer confirmation. A change here
// is a NEW declaration (revoke the old, insert a superseding one): the donor is agreeing to a
// materially different thing. Immutability protects the consent record, not the address.
const CONSENT_COLUMNS = ["scope", "confirmed_taxpayer"] as const;

// The identity / HMRC MATCHING details (name, house name/number, address, postcode, overseas-address
// flag). A change here is only a matching-detail correction — HMRC lets you note an address change
// and keep the enduring declaration on file — so it AMENDS the existing row in place, no new row.
const MATCHING_COLUMNS = [
  "title",
  "first_name",
  "last_name",
  "house_name_number",
  "address",
  "postcode",
  "non_uk",
] as const;

export type DeclarationMatchingColumns = Pick<DeclarationRow, (typeof MATCHING_COLUMNS)[number]>;

export type DeclarationRevision =
  | {
      kind: "amend";
      declarationId: number;
      changes: DeclarationMatchingColumns;
      changedFields: string[];
    }
  | {
      kind: "revise";
      revokedDeclaration: { id: number; revoked_at: Date };
      newDeclaration: DeclarationRow;
    };

// Decide the edit. Builds the candidate row (buildDeclarationRow with the CURRENT wording), then
// classifies the diff against the current row:
//   * a CONSENT change (scope / taxpayer confirmation) → "revise": revoke the old row and insert the
//     candidate as a superseding immutable row (the candidate also carries any updated matching
//     fields, so an address changed alongside consent rides along).
//   * only MATCHING changes (name/address/postcode/non-UK) → "amend": update those columns in place
//     on the same row; the consent snapshot (scope/taxpayer/wording/created_at) stays frozen.
//   * nothing meaningful changed → null.
// This amend/revise split is NBCC's design choice; HMRC does not require a new declaration for an
// address change — it permits noting the change on the enduring declaration.
export function buildDeclarationRevision(input: DeclarationRevisionInput): DeclarationRevision | null {
  const { current, updated, scope, confirmedTaxpayer, mode, now } = input;
  const wording = selectDeclarationWording({ mode, scope });
  const candidate = buildDeclarationRow(updated, {
    donorId: current.donor_id,
    scope,
    wording,
    confirmedTaxpayer,
  });

  const consentChanged = CONSENT_COLUMNS.some((col) => candidate[col] !== current[col]);
  if (consentChanged) {
    return { kind: "revise", revokedDeclaration: { id: current.id, revoked_at: now }, newDeclaration: candidate };
  }

  const changedFields = MATCHING_COLUMNS.filter((col) => candidate[col] !== current[col]);
  if (changedFields.length === 0) return null;

  const changes = Object.fromEntries(
    MATCHING_COLUMNS.map((col) => [col, candidate[col]]),
  ) as DeclarationMatchingColumns;
  return { kind: "amend", declarationId: current.id, changes, changedFields: [...changedFields] };
}
```

  Also update the module header comment (lines ~4-11) to describe the amend/revise split and the "design choice, not HMRC-mandated" note. Keep `CurrentDeclaration`, `DeclarationRevisionInput`, and imports as they are. Remove the now-unused old `DeclarationRevision` interface and `COMPARED_COLUMNS`.

- [ ] **Step 4: Run the builder tests to verify they pass**

Run: `npm run test:unit -- declaration-revision`
Expected: the `buildDeclarationRevision` describe passes; the `reviseDeclaration` describe still FAILS (write helper not updated) — that is expected, fixed in Step 6.

- [ ] **Step 5: Rewrite the `reviseDeclaration` write tests.** Replace the two behaviour cases in `describe("reviseDeclaration (audited write) — REQ-059", ...)` — the "revokes the old row…" test and the "no-op" test — with these three (keep the `not_found`, `already_revoked`, and rollback tests as they are):

```ts
  it("REVISES (revoke old + insert new + two audits) when the scope changes", async () => {
    const result = await reviseDeclaration(10, currentFields, { ...ctx, scope: "all_donations" });
    expect(result).toEqual({ outcome: "revised", revokedDeclarationId: 10, newDeclarationId: NEW_DECL_ID });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(has(/insert into declarations/i)).toBe(true);
    const update = call(/update declarations/i);
    expect(update?.[0]).toMatch(/revoked_at/i);
    expect(update?.[0]).toMatch(/superseded_by_declaration_id/i);
    const actions = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => c[1][1]);
    expect(actions).toContain("declaration.revoked");
    expect(actions).toContain("declaration.created");
    expect(has(/update donations/i)).toBe(false);
  });

  it("AMENDS in place (one update, one declaration.amended audit, no new row) on an address change", async () => {
    const result = await reviseDeclaration(10, { ...currentFields, address: "New Address, Kilmarnock" }, ctx);
    expect(result).toEqual({ outcome: "amended", declarationId: 10, changedFields: ["address"] });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(has(/insert into declarations/i)).toBe(false); // no new row
    const update = call(/update declarations/i);
    expect(update?.[0]).not.toMatch(/revoked_at/i); // an amend, not a revoke
    const actions = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => c[1][1]);
    expect(actions).toEqual(["declaration.amended"]);
    expect(has(/update donations/i)).toBe(false);
  });

  it("is a no-op (commit, no writes) when nothing meaningful changed", async () => {
    const result = await reviseDeclaration(10, currentFields, ctx);
    expect(result).toEqual({ outcome: "unchanged", declarationId: 10 });
    expect(has(/insert into declarations/i)).toBe(false);
    expect(has(/update declarations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
    expect(sqls().pop()).toMatch(/^commit/i);
  });
```

- [ ] **Step 6: Rewrite `reviseDeclaration` in `src/db/declarations.ts`.** Replace the `ReviseDeclarationResult` interface with the union, and the body from the `buildDeclarationRevision(...)` call through the `return { revised: true, ... }`:

```ts
export type ReviseDeclarationResult =
  | { outcome: "unchanged"; declarationId: number }
  | { outcome: "amended"; declarationId: number; changedFields: string[] }
  | { outcome: "revised"; revokedDeclarationId: number; newDeclarationId: number };
```

  and, inside the `try` after the `not_found` / `already_revoked` guards:

```ts
    const revision = buildDeclarationRevision({
      current: {
        id: row.id,
        donor_id: row.donor_id,
        title: row.title,
        first_name: row.first_name,
        last_name: row.last_name,
        house_name_number: row.house_name_number,
        address: row.address,
        postcode: row.postcode,
        non_uk: row.non_uk,
        scope: row.scope,
        confirmed_taxpayer: row.confirmed_taxpayer,
      },
      updated,
      scope: context.scope,
      confirmedTaxpayer: context.confirmedTaxpayer,
      mode: context.mode,
      now: new Date(),
    });

    // Nothing meaningful changed → commit the (read-only) transaction and return.
    if (!revision) {
      await client.query("COMMIT");
      return { outcome: "unchanged", declarationId };
    }

    // An identity / address change AMENDS the enduring declaration in place: update the matching
    // columns and note it in the audit log — no revoke, no new row (the consent snapshot stays put).
    if (revision.kind === "amend") {
      await client.query(
        `UPDATE declarations
            SET title = $1, first_name = $2, last_name = $3, house_name_number = $4,
                address = $5, postcode = $6, non_uk = $7
          WHERE id = $8`,
        [
          revision.changes.title,
          revision.changes.first_name,
          revision.changes.last_name,
          revision.changes.house_name_number,
          revision.changes.address,
          revision.changes.postcode,
          revision.changes.non_uk,
          declarationId,
        ],
      );
      await insertAudit(client, {
        actor,
        action: "declaration.amended",
        entity: "declaration",
        entityId: declarationId,
        data: { changedFields: revision.changedFields, donorId: row.donor_id },
      });
      await client.query("COMMIT");
      return { outcome: "amended", declarationId, changedFields: revision.changedFields };
    }

    // A CONSENT change (scope / taxpayer confirmation) revokes the old row and inserts a superseding
    // immutable one. Insert the new row FIRST so its id wires onto the old row's superseded_by.
    const newDeclarationId = await insertDeclaration(client, revision.newDeclaration);
    await client.query(
      `UPDATE declarations SET revoked_at = $1, superseded_by_declaration_id = $2 WHERE id = $3`,
      [revision.revokedDeclaration.revoked_at, newDeclarationId, declarationId],
    );
    await insertAudit(client, {
      actor,
      action: "declaration.revoked",
      entity: "declaration",
      entityId: declarationId,
      data: { supersededBy: newDeclarationId, donorId: row.donor_id },
    });
    await insertAudit(client, {
      actor,
      action: "declaration.created",
      entity: "declaration",
      entityId: newDeclarationId,
      data: { supersedes: declarationId, donorId: row.donor_id },
    });

    await client.query("COMMIT");
    return { outcome: "revised", revokedDeclarationId: declarationId, newDeclarationId };
```

  Also update the `reviseDeclaration` doc comment (lines ~40-47) and the module header (lines ~11-16) to describe the amend/revise split and the "design choice, not HMRC-mandated" note.

- [ ] **Step 7: Run the full revision test file to verify it passes**

Run: `npm run test:unit -- declaration-revision`
Expected: PASS (both describes).

- [ ] **Step 8: Lint + build**

Run: `npm run lint && npm run build`
Expected: clean (no unused `COMPARED_COLUMNS`, union types resolve).

- [ ] **Step 9: Commit**

```bash
git add src/declarations/revision.ts src/db/declarations.ts test/unit/declaration-revision.test.ts
git commit -m "[TASK-128] Split declaration edits: amend identity in place, revise on consent change"
```

---

### Task 2: Reframe the docs (README) + flag SPEC upstream

**Files:**
- Modify: `README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Reword the README "Declaration revision" section** (around line 1480). Replace the paragraph so it describes the split: a consent change (scope / taxpayer confirmation) revokes-and-supersedes; an identity/address change amends the enduring declaration in place with a `declaration.amended` audit note. State it is NBCC's design choice and HMRC permits noting an address change on the enduring declaration — not an HMRC mandate. Concretely, replace the first two sentences:

  Old: `A Gift Aid declaration is immutable (REQ-046), so editing it never mutates the saved row: the old row is **revoked** and a new, corrected row **supersedes** it.`

  New: `A Gift Aid declaration's **consent** is immutable (REQ-046): changing the **scope** or **taxpayer confirmation** revokes the old row and inserts a superseding one. An **identity / address** change (name, house name/number, address, postcode, overseas-address flag) is only an HMRC matching detail, so it **amends the enduring declaration in place** with a **declaration.amended** audit note — no revoke, no new row. Revoke-and-supersede on a consent change is NBCC's design choice for a clean audit trail; HMRC does **not** require a new declaration for an address change — it permits noting the change on the enduring declaration.`

  Update the rest of the paragraph's field list to say the builder returns `amend | revise | null` and the write helper `reviseDeclaration` performs an in-place update for an amend.

- [ ] **Step 2: Confirm SPEC.md is untouched.**

Run: `git status --porcelain SPEC.md`
Expected: no output (SPEC.md not modified). The REQ-059 wording is flagged for the requirement-log owner in the design doc + memory, not hand-edited.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "[TASK-128] Docs: declaration amend-vs-revise split is a design choice, not an HMRC rule"
```

---

### Task 3: Full green + PR

**Files:** verify only.

- [ ] **Step 1: Full unit suite + lint + build**

Run: `npm run lint && npm run build && npm run test:unit`
Expected: all green. If any other test imported the old `ReviseDeclarationResult.revised` / old `DeclarationRevision` shape, update it to the union (search: `grep -rn "\.revised\b\|revokedDeclarationId\|newDeclarationId" src/ test/`).

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin task-128-declaration-amend-vs-revise
gh pr create --title "[TASK-128] Declaration edits: amend identity in place, revise only on consent change" --body "..."
```

- [ ] **Step 3: Watch checks + squash-merge**

`gh pr checks <pr> --watch`; green ⇒ `gh pr merge <pr> --squash --delete-branch`. Red (incl. BDD on fresh CI DB) ⇒ open the failing job, fix, repeat.

---

## Self-Review

- **Spec coverage:** builder union amend/revise/null (Task 1 Steps 3) ✓; write helper both paths + result union (Task 1 Step 6) ✓; consent-dominates (builder `consentChanged` first) ✓; no schema change ✓; tests amend/revise/no-op/errors (Task 1 Steps 1,5) ✓; README reframe (Task 2) ✓; SPEC untouched + upstream flag (Task 2 Step 2 + design doc) ✓; code-comment reframe (Task 1 Steps 3,6) ✓.
- **Placeholder scan:** PR `--body "..."` filled at creation from the design summary; no other placeholders.
- **Type consistency:** `DeclarationRevision` (`kind: "amend" | "revise"`), `DeclarationMatchingColumns`, `ReviseDeclarationResult` (`outcome: "unchanged" | "amended" | "revised"`), `changedFields`, `declarationId` used identically across builder, write helper, and tests.
