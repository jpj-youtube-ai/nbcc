import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-097 (REQ-059): the pure declaration-revision builder + the audited revise write. Editing an
// immutable Gift Aid declaration REVOKES the old row and inserts a new one that SUPERSEDES it. The
// builder is DB-free (clock injected); the write is proven against a mocked pool, mirroring
// test/unit/donations-batch.test.ts (lock row, guard, write, two audits, rollback-on-throw).

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

import { buildDeclarationRevision } from "../../src/declarations/revision";
import { reviseDeclaration, DeclarationRevisionError } from "../../src/db/declarations";
import { selectDeclarationWording } from "../../src/declarations/wording";

// The current declaration row (snake_case), and the newly captured fields (camelCase) that match it.
const currentRow = {
  id: 10,
  donor_id: 42,
  title: "Dr",
  first_name: "Ada",
  last_name: "Lovelace",
  house_name_number: "12",
  address: "Analytical Avenue, London",
  postcode: "SW1A 1AA",
  non_uk: false,
  scope: "this_donation" as const,
  confirmed_taxpayer: true,
};
const currentFields = {
  title: "Dr",
  firstName: "Ada",
  lastName: "Lovelace",
  houseNameNumber: "12",
  address: "Analytical Avenue, London",
  postcode: "SW1A 1AA",
  nonUk: false,
};
const NOW = new Date("2026-07-03T00:00:00.000Z");
const ctx = { scope: "this_donation" as const, confirmedTaxpayer: true, mode: "once" as const };

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

// --- The audited write, mocked-pool ------------------------------------------------------------
const NEW_DECL_ID = 11;
let selectRow: (typeof currentRow & { revoked_at: Date | null }) | undefined;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select[\s\S]*from declarations/i.test(sql))
      return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
    if (/insert into declarations/i.test(sql)) return { rows: [{ id: NEW_DECL_ID }], rowCount: 1 };
    if (/update declarations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
const has = (re: RegExp): boolean => sqls().some((s) => re.test(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
  selectRow = { ...currentRow, revoked_at: null };
});

describe("reviseDeclaration (audited write) — REQ-059", () => {
  it("REVISES (revoke old + insert new + two audits) when the scope changes", async () => {
    const result = await reviseDeclaration(10, currentFields, { ...ctx, scope: "all_donations" });
    expect(result).toEqual({ outcome: "revised", revokedDeclarationId: 10, newDeclarationId: NEW_DECL_ID });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);

    // The new immutable row is inserted, then the old row is revoked + superseded by the new id.
    expect(has(/insert into declarations/i)).toBe(true);
    const update = call(/update declarations/i);
    expect(update?.[0]).toMatch(/revoked_at/i);
    expect(update?.[0]).toMatch(/superseded_by_declaration_id/i);
    expect(update?.[1][1]).toBe(NEW_DECL_ID); // superseded_by = new id
    expect(update?.[1][2]).toBe(10); // old id

    // Two audit rows: declaration.revoked (old) + declaration.created (new).
    const actions = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => c[1][1]);
    expect(actions).toContain("declaration.revoked");
    expect(actions).toContain("declaration.created");

    // Ordering: insert new → update old, all before COMMIT.
    const insIdx = seq.findIndex((s) => /insert into declarations/i.test(s));
    const updIdx = seq.findIndex((s) => /update declarations/i.test(s));
    expect(insIdx).toBeLessThan(updIdx);

    // The helper NEVER modifies donations (an existing donation.declaration_id is untouched).
    expect(has(/update donations/i)).toBe(false);
    expect(has(/insert into donations/i)).toBe(false);
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

  it("throws DeclarationRevisionError('not_found') and rolls back when the id is unknown", async () => {
    selectRow = undefined;
    await expect(reviseDeclaration(999, currentFields, ctx)).rejects.toMatchObject({ reason: "not_found" });
    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/insert into declarations/i)).toBe(false);
  });

  it("throws DeclarationRevisionError('already_revoked') for an already-revoked row", async () => {
    selectRow = { ...currentRow, revoked_at: new Date("2026-01-01T00:00:00Z") };
    await expect(reviseDeclaration(10, { ...currentFields, address: "New" }, ctx)).rejects.toBeInstanceOf(
      DeclarationRevisionError,
    );
    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/insert into declarations/i)).toBe(false);
  });

  it("rolls back all writes if a step throws mid-transaction", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [selectRow], rowCount: 1 };
      if (/insert into declarations/i.test(sql)) return { rows: [{ id: NEW_DECL_ID }], rowCount: 1 };
      if (/update declarations/i.test(sql)) throw new Error("update failed");
      return { rows: [], rowCount: 0 };
    });
    await expect(reviseDeclaration(10, { ...currentFields, address: "New" }, ctx)).rejects.toThrow("update failed");
    const seq = sqls();
    expect(seq.some((s) => /rollback/i.test(s))).toBe(true);
    expect(seq.some((s) => /^commit/i.test(s))).toBe(false);
  });
});
