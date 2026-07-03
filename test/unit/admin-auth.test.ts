import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-105 (REQ-062): the role-based admin user model + admin login endpoint. `users` already
// carries the role enum (viewer/editor/admin); the additive migration adds only the missing
// credential (password_hash). POST /api/admin/login verifies the password (scrypt) and returns a
// signed session token — the bearer-token analogue of the donor portal's magic link — or 401. This
// proves both paths against a mocked pool (mirroring portal-api.test.ts), the pure password/session
// helpers, and that the migration is additive-only (expand-contract, golden rule 2).

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));
vi.mock("../../src/config", () => ({ config: { ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { hashPassword, verifyPassword } from "../../src/admin/password";
import { signAdminSession, verifyAdminSession, AdminSessionError } from "../../src/admin/session";
import { postAdminLogin } from "../../src/routes/admin";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// --- Password hashing (scrypt) ------------------------------------------------------------------
describe("password hashing (scrypt) — TASK-105", () => {
  it("hashes to a salted scrypt string and verifies the right password, rejecting the wrong one", async () => {
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(await verifyPassword("correct horse", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("uses a fresh salt per hash (same password → different stored hash)", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects verification against a null / malformed hash without throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "not-a-scrypt-hash")).toBe(false);
  });
});

// --- Signed session token -----------------------------------------------------------------------
describe("admin session token (HMAC) — TASK-105", () => {
  const NOW = new Date("2026-07-03T00:00:00.000Z");
  const SECRET = "signing-key";

  it("signs a token that verifies with the same key and carries the claims", () => {
    const { token, claims } = signAdminSession({ sub: 7, email: "a@b.co", role: "admin", now: NOW, secret: SECRET });
    expect(token).toContain(".");
    expect(claims.exp).toBeGreaterThan(claims.iat);
    const verified = verifyAdminSession(token, SECRET, NOW);
    expect(verified).toMatchObject({ sub: 7, email: "a@b.co", role: "admin" });
    expect(verified.exp).toBeGreaterThan(verified.iat);
  });

  it("rejects a tampered payload / wrong key with a bad_signature error", () => {
    const { token } = signAdminSession({ sub: 7, email: "a@b.co", role: "admin", now: NOW, secret: SECRET });
    expect(() => verifyAdminSession(token, "other-key", NOW)).toThrow(AdminSessionError);
    const [body] = token.split(".");
    expect(() => verifyAdminSession(body + ".deadbeef", SECRET, NOW)).toThrow(AdminSessionError);
  });

  it("rejects an expired token", () => {
    const { token } = signAdminSession({ sub: 7, email: "a@b.co", role: "admin", now: NOW, ttlMs: 1000, secret: SECRET });
    const later = new Date(NOW.getTime() + 2000);
    expect(() => verifyAdminSession(token, SECRET, later)).toThrow(AdminSessionError);
  });

  it("rejects a malformed token", () => {
    expect(() => verifyAdminSession("garbage", SECRET, NOW)).toThrow(AdminSessionError);
  });
});

// --- POST /api/admin/login (mocked pool) --------------------------------------------------------
type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const login = async (body: unknown) => { const res = mockRes(); await postAdminLogin({ body } as any, res as any); return res; };

let ADMIN_HASH: string;
beforeAll(async () => {
  ADMIN_HASH = await hashPassword("s3cret-admin-pw");
});

// The admin user row findUserByEmail returns for the known email; undefined = unknown email.
let userRow: { id: number; email: string; full_name: string; role: string; password_hash: string | null } | undefined;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockImplementation(async (_sql: string, params: unknown[]) => {
    const email = params?.[0];
    return { rows: userRow && userRow.email === email ? [userRow] : [], rowCount: 0 };
  });
  userRow = { id: 1, email: "kenny@nbcc.test", full_name: "Kenny Admin", role: "admin", password_hash: ADMIN_HASH };
});

describe("POST /api/admin/login (REQ-062)", () => {
  it("returns a signed session token for valid admin credentials", async () => {
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw" });
    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; user: { id: number; role: string; email: string } };
    expect(body.token).toBeTruthy();
    // The token is genuinely signed with the configured secret and carries the admin's identity.
    const claims = verifyAdminSession(body.token, "test-admin-secret", new Date());
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "admin" });
    expect(body.user).toMatchObject({ id: 1, role: "admin", email: "kenny@nbcc.test" });
    // The password hash is never echoed back.
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_HASH);
  });

  it("returns 401 for a wrong password", async () => {
    const res = await login({ email: "kenny@nbcc.test", password: "wrong" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toHaveProperty("token");
  });

  it("returns 401 for an unknown email (no user enumeration)", async () => {
    const res = await login({ email: "nobody@nbcc.test", password: "s3cret-admin-pw" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for a user with no password set (null hash)", async () => {
    userRow = { id: 2, email: "kenny@nbcc.test", full_name: "Kenny", role: "admin", password_hash: null };
    const res = await login({ email: "kenny@nbcc.test", password: "anything" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body (missing password / bad email)", async () => {
    expect((await login({ email: "kenny@nbcc.test" })).statusCode).toBe(400);
    expect((await login({ email: "not-an-email", password: "x" })).statusCode).toBe(400);
  });
});

// --- The migration is additive-only (expand-contract, golden rule 2) ----------------------------
describe("password_hash migration is additive-only", () => {
  const src = readFileSync(resolve(ROOT, "migrations/1783078996722_admin-user-password-hash.js"), "utf8");
  const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

  it("adds a single nullable password_hash column to users and nothing destructive", () => {
    expect(up).toMatch(/addColumn\(\s*["']users["']/);
    expect(up).toContain("password_hash");
    // Nullable: no NOT NULL on the new column; nothing dropped/renamed/altered in the up.
    expect(up).not.toMatch(/notNull/i);
    expect(up).not.toMatch(/dropColumn|dropTable|renameColumn|alterColumn/i);
  });
});
