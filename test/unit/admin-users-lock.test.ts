import { describe, it, expect, beforeEach, vi } from "vitest";

// TASK-186 write-skew fix: setUserRole/setUserStatus/deleteUser/setUserPermissions each acquire a
// shared Postgres transaction-level advisory lock (pg_advisory_xact_lock) as the FIRST query
// inside their writeWithAudit transaction, before the SELECT/UPDATE/DELETE and before
// assertAdminsRemain's count — see admin-users.ts's TEAM_MUTATION_LOCK comment for why (unlocked
// concurrent mutations on different rows can each see the other as still-enabled, both pass the
// guard, both commit, and the team ends up with zero admins). This proves the lock is issued, is
// issued FIRST, and uses the SAME key across all four mutations — mirroring the mock-the-pool
// approach in test/unit/donations-batch.test.ts (assigns no real DB; asserts query sequence).

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect, query: vi.fn() } }));

import {
  setUserRole,
  setUserStatus,
  deleteUser,
  setUserPermissions,
} from "../../src/db/admin-users";

const managedUserRow = {
  id: 1,
  email: "a@x",
  full_name: "A",
  role: "admin",
  status: "active",
  invited_at: null,
  last_login_at: null,
  permissions: {},
};

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^\s*update users/i.test(sql)) return { rows: [managedUserRow], rowCount: 1 };
    if (/^\s*delete from users/i.test(sql))
      return { rows: [{ id: 1, email: "a@x", role: "admin" }], rowCount: 1 };
    if (/select count\(\*\)/i.test(sql)) return { rows: [{ n: 1 }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
const lockKeys = (): unknown[] =>
  queryMock.mock.calls
    .filter((c) => /pg_advisory_xact_lock/i.test(String(c[0])))
    .map((c) => (c[1] as unknown[])[0]);

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
});

describe("team-affecting mutations serialize on a shared advisory lock (TASK-186)", () => {
  it("setUserRole acquires the lock as the first query in the transaction", async () => {
    await setUserRole(1, "editor", "actor");
    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[1]).toMatch(/pg_advisory_xact_lock/i);
    // The lock must be acquired BEFORE the UPDATE and BEFORE assertAdminsRemain's SELECT.
    const lockIdx = seq.findIndex((s) => /pg_advisory_xact_lock/i.test(s));
    const updateIdx = seq.findIndex((s) => /^update users/i.test(s));
    const countIdx = seq.findIndex((s) => /select count\(\*\)/i.test(s));
    expect(lockIdx).toBeLessThan(updateIdx);
    expect(lockIdx).toBeLessThan(countIdx);
  });

  it("setUserStatus acquires the lock as the first query in the transaction", async () => {
    await setUserStatus(1, "disabled", "actor");
    const seq = sqls();
    expect(seq[1]).toMatch(/pg_advisory_xact_lock/i);
  });

  it("deleteUser acquires the lock as the first query in the transaction", async () => {
    await deleteUser(1, "actor");
    const seq = sqls();
    expect(seq[1]).toMatch(/pg_advisory_xact_lock/i);
  });

  it("setUserPermissions acquires the lock as the first query in the transaction", async () => {
    await setUserPermissions(1, { team: "edit" }, "actor");
    const seq = sqls();
    expect(seq[1]).toMatch(/pg_advisory_xact_lock/i);
  });

  it("all four mutations use the SAME advisory lock key, so they serialize against each other", async () => {
    await setUserRole(1, "editor", "actor");
    await setUserStatus(1, "disabled", "actor");
    await deleteUser(1, "actor");
    await setUserPermissions(1, { team: "edit" }, "actor");

    const keys = lockKeys();
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1); // one shared key across all four
  });
});
