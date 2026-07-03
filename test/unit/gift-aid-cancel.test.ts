import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-103 (REQ-061): the pure Gift Aid declaration-CANCELLATION builder + the audited cancel write.
// Cancelling Gift Aid REVOKES the donor's active declaration with NO superseding replacement (unlike
// an EDIT, which revokes-and-supersedes — REQ-059). The builder is DB-free (clock injected); the
// write is proven against a mocked pool, mirroring test/unit/declaration-revision.test.ts (lock row,
// guard, revoke, one audit, rollback-on-throw, and — critically — no new declaration row).

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

import { buildDeclarationCancellation } from "../../src/declarations/cancellation";
import { cancelDeclaration, DeclarationCancellationError } from "../../src/db/declarations";

const NOW = new Date("2026-07-03T00:00:00.000Z");

describe("buildDeclarationCancellation (pure) — REQ-061", () => {
  it("revokes the declaration at `now` and builds a declaration.revoked audit with NO supersession", () => {
    const result = buildDeclarationCancellation({
      current: { id: 10, donor_id: 42 },
      now: NOW,
      actor: "donor",
    });
    expect(result.revokedDeclaration).toEqual({ id: 10, revoked_at: NOW });
    expect(result.audit).toMatchObject({
      actor: "donor",
      action: "declaration.revoked",
      entity: "declaration",
      entityId: 10,
    });
    expect(result.audit.data).toMatchObject({ donorId: 42 });
    // A cancellation has no replacement — unlike an edit, it never records a superseding declaration.
    expect(result.audit.data).not.toHaveProperty("supersededBy");
  });
});

// --- The audited write, mocked-pool ------------------------------------------------------------
type Row = { id: number; donor_id: number; revoked_at: Date | null };
let selectRow: Row | undefined;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select[\s\S]*from declarations/i.test(sql))
      return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
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
  selectRow = { id: 10, donor_id: 42, revoked_at: null };
});

describe("cancelDeclaration (audited write) — REQ-061", () => {
  it("sets revoked_at + appends a declaration.revoked audit row, in one transaction, creating NO new declaration", async () => {
    const result = await cancelDeclaration(10, "donor");
    expect(result).toMatchObject({ cancelled: true, declarationId: 10, donorId: 42 });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);

    // The row is locked, then revoked (revoked_at set) — with NO superseding declaration id.
    expect(has(/select[\s\S]*for update/i)).toBe(true);
    const update = call(/update declarations/i);
    expect(update?.[0]).toMatch(/revoked_at/i);
    expect(update?.[0]).not.toMatch(/superseded_by_declaration_id/i);
    expect(update?.[1][1]).toBe(10); // the declaration id

    // Exactly one audit row: declaration.revoked.
    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits).toHaveLength(1);
    expect(audits[0][1][1]).toBe("declaration.revoked");

    // NO new declaration row is created — a cancellation has no replacement, so future donations
    // for this donor no longer carry an active declaration.
    expect(has(/insert into declarations/i)).toBe(false);
    // And donations are never touched.
    expect(has(/update donations/i)).toBe(false);
    expect(has(/insert into donations/i)).toBe(false);
  });

  it("throws DeclarationCancellationError('not_found') and rolls back, writing nothing, when the id is unknown", async () => {
    selectRow = undefined;
    await expect(cancelDeclaration(999, "donor")).rejects.toMatchObject({ reason: "not_found" });
    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/update declarations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
  });

  it("throws DeclarationCancellationError('already_revoked') and writes nothing for an already-revoked declaration", async () => {
    selectRow = { id: 10, donor_id: 42, revoked_at: new Date("2026-01-01T00:00:00Z") };
    await expect(cancelDeclaration(10, "donor")).rejects.toBeInstanceOf(DeclarationCancellationError);
    expect(sqls().pop()).toMatch(/^rollback/i);
    // Nothing is written on the already-revoked path.
    expect(has(/update declarations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
  });

  it("rolls back all writes if a step throws mid-transaction", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [selectRow], rowCount: 1 };
      if (/update declarations/i.test(sql)) throw new Error("update failed");
      return { rows: [], rowCount: 0 };
    });
    await expect(cancelDeclaration(10, "donor")).rejects.toThrow("update failed");
    const seq = sqls();
    expect(seq.some((s) => /rollback/i.test(s))).toBe(true);
    expect(seq.some((s) => /^commit/i.test(s))).toBe(false);
  });
});
