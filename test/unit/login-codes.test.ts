import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin management Phase 3 (TASK-188, mandatory email 2FA), Task 2: the login-code store backing
// admin_login_codes. Plain pool.query, no audit — these are transient auth artifacts, not
// user-management writes (mirrors touchLastLogin in src/db/admin-users.ts, which is also
// unaudited). Mocked pool, mirroring test/unit/portal-active-declaration.test.ts.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { upsertLoginCode, getLoginCode, bumpLoginCodeAttempts, deleteLoginCode } from "../../src/db/login-codes";

beforeEach(() => queryMock.mockReset());

describe("upsertLoginCode", () => {
  it("inserts, upserting on conflict and resetting attempts to 0", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const expiresAt = new Date("2026-07-11T12:10:00.000Z");
    await upsertLoginCode(42, "hashed-code", expiresAt);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/insert into admin_login_codes/i);
    expect(String(sql)).toMatch(/on conflict \(user_id\) do update/i);
    expect(String(sql)).toMatch(/attempts\s*=\s*0/i);
    expect(params).toEqual([42, "hashed-code", expiresAt]);
  });
});

describe("getLoginCode", () => {
  it("returns the row for a user with a pending code", async () => {
    const expiresAt = new Date("2026-07-11T12:10:00.000Z");
    queryMock.mockResolvedValueOnce({
      rows: [{ code_hash: "hashed-code", expires_at: expiresAt, attempts: 2 }],
      rowCount: 1,
    });
    const row = await getLoginCode(42);
    expect(row).toEqual({ code_hash: "hashed-code", expires_at: expiresAt, attempts: 2 });
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/select .* from admin_login_codes/i);
    expect(params).toEqual([42]);
  });

  it("returns null when the user has no pending code", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getLoginCode(42)).toBeNull();
  });
});

describe("bumpLoginCodeAttempts", () => {
  it("increments attempts and returns the new count", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ attempts: 3 }], rowCount: 1 });
    const count = await bumpLoginCodeAttempts(42);
    expect(count).toBe(3);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/update admin_login_codes/i);
    expect(String(sql)).toMatch(/attempts\s*=\s*attempts\s*\+\s*1/i);
    expect(String(sql)).toMatch(/returning attempts/i);
    expect(params).toEqual([42]);
  });

  it("returns 0 when there is no row for the user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await bumpLoginCodeAttempts(42)).toBe(0);
  });
});

describe("deleteLoginCode", () => {
  it("deletes the user's login-code row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await deleteLoginCode(42);
    const [sql, params] = queryMock.mock.calls[0];
    expect(String(sql)).toMatch(/delete from admin_login_codes/i);
    expect(params).toEqual([42]);
  });
});
