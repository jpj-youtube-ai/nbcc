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
vi.mock("../../src/config", () => ({
  config: {
    ADMIN_SESSION_SECRET: "test-admin-secret",
    // admin.ts imports the stripe client (cancelSubscription for TASK-106), which builds
    // `new Stripe(...)` at module load — needs a non-empty key + webhook secret even though these
    // login tests never touch Stripe.
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    // Phase 3 (TASK-188): a non-production NODE_ENV so the login-code response includes devCode —
    // production must NEVER see it (that path is exercised in the dedicated devCode-gate test below).
    NODE_ENV: "test",
  },
}));

const { touchLastLoginMock } = vi.hoisted(() => ({ touchLastLoginMock: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ touchLastLogin: touchLastLoginMock }));

// Phase 3 (TASK-188): the login-code challenge store, mocked so step 1/step 2 tests don't touch a
// real DB — mirrors touchLastLoginMock above.
const {
  upsertLoginCodeMock,
  getLoginCodeMock,
  bumpLoginCodeAttemptsMock,
  deleteLoginCodeMock,
} = vi.hoisted(() => ({
  upsertLoginCodeMock: vi.fn(),
  getLoginCodeMock: vi.fn(),
  bumpLoginCodeAttemptsMock: vi.fn(),
  deleteLoginCodeMock: vi.fn(),
}));
vi.mock("../../src/db/login-codes", () => ({
  upsertLoginCode: upsertLoginCodeMock,
  getLoginCode: getLoginCodeMock,
  bumpLoginCodeAttempts: bumpLoginCodeAttemptsMock,
  deleteLoginCode: deleteLoginCodeMock,
}));

import { hashPassword, verifyPassword } from "../../src/admin/password";
import { signAdminSession, verifyAdminSession, AdminSessionError } from "../../src/admin/session";
import { hashLoginCode, issueDeviceToken, verifyDeviceToken } from "../../src/admin/two-factor";
import { postAdminLogin, postAdminLoginTwoFactor } from "../../src/routes/admin";

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const verify2fa = async (body: unknown) => { const res = mockRes(); await postAdminLoginTwoFactor({ body } as any, res as any); return res; };

let ADMIN_HASH: string;
beforeAll(async () => {
  ADMIN_HASH = await hashPassword("s3cret-admin-pw");
});

// The admin user row findUserByEmail returns for the known email; undefined = unknown email.
let userRow:
  | { id: number; email: string; full_name: string; role: string; password_hash: string | null; status: string }
  | undefined;

beforeEach(() => {
  queryMock.mockReset();
  touchLastLoginMock.mockReset();
  upsertLoginCodeMock.mockReset();
  getLoginCodeMock.mockReset();
  bumpLoginCodeAttemptsMock.mockReset();
  deleteLoginCodeMock.mockReset();
  queryMock.mockImplementation(async (_sql: string, params: unknown[]) => {
    const email = params?.[0];
    return { rows: userRow && userRow.email === email ? [userRow] : [], rowCount: 0 };
  });
  userRow = {
    id: 1,
    email: "kenny@nbcc.test",
    full_name: "Kenny Admin",
    role: "admin",
    password_hash: ADMIN_HASH,
    status: "active",
  };
});

describe("POST /api/admin/login (REQ-062)", () => {
  // Admin management Phase 3 (TASK-188) made 2FA mandatory: valid credentials ALONE no longer issue
  // a session (see the "2FA challenge / trusted device" describe block below for that case) — a
  // signed session at step 1 now requires a valid device token too (trusted device).
  it("returns a signed session token for valid admin credentials on a trusted device", async () => {
    const deviceToken = issueDeviceToken({ sub: 1, now: new Date(), secret: SECRET });
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw", deviceToken });
    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; user: { id: number; role: string; email: string } };
    expect(body.token).toBeTruthy();
    // The token is genuinely signed with the configured secret and carries the admin's identity.
    const claims = verifyAdminSession(body.token, "test-admin-secret", new Date());
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "admin" });
    expect(body.user).toMatchObject({ id: 1, role: "admin", email: "kenny@nbcc.test" });
    // The password hash is never echoed back.
    expect(JSON.stringify(res.body)).not.toContain(ADMIN_HASH);
    // A successful login stamps last_login_at (Task 6).
    expect(touchLastLoginMock).toHaveBeenCalledWith(1);
  });

  it("returns 401 for a disabled user with the CORRECT password, and does not issue a session (Task 6)", async () => {
    userRow = {
      id: 3,
      email: "kenny@nbcc.test",
      full_name: "Kenny",
      role: "admin",
      password_hash: ADMIN_HASH,
      status: "disabled",
    };
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toHaveProperty("token");
    // Same generic message as a bad password — no account enumeration of the disabled status.
    expect(res.body).toEqual({ error: "Invalid email or password" });
    expect(touchLastLoginMock).not.toHaveBeenCalled();
  });

  it("returns 401 for an invited (no-password-yet) user even if somehow a password is supplied (Task 6)", async () => {
    userRow = {
      id: 4,
      email: "kenny@nbcc.test",
      full_name: "Kenny",
      role: "admin",
      password_hash: ADMIN_HASH,
      status: "invited",
    };
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toHaveProperty("token");
    expect(touchLastLoginMock).not.toHaveBeenCalled();
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

// --- Admin management Phase 3 (TASK-188): mandatory email 2FA + trusted device ------------------
const SECRET = "test-admin-secret";

describe("POST /api/admin/login — step 1 (2FA challenge / trusted device)", () => {
  it("password ok + no device token -> { step: '2fa' } with a 6-digit devCode (non-production)", async () => {
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw" });
    expect(res.statusCode).toBe(200);
    const body = res.body as { step: string; email: string; devCode: string };
    expect(body).toEqual({ step: "2fa", email: "kenny@nbcc.test", devCode: expect.any(String) });
    expect(body.devCode).toMatch(/^\d{6}$/);
    // No session is issued at step 1 — 2FA is mandatory absent a trusted device.
    expect(res.body).not.toHaveProperty("token");
    expect(touchLastLoginMock).not.toHaveBeenCalled();
    // A code was generated, hashed, and stored with a ~10 minute expiry.
    expect(upsertLoginCodeMock).toHaveBeenCalledTimes(1);
    const [userId, codeHash, expiresAt] = upsertLoginCodeMock.mock.calls[0] as [number, string, Date];
    expect(userId).toBe(1);
    expect(typeof codeHash).toBe("string");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000 + 1000);
  });

  it("a valid device token for this user issues the session directly, no code generated", async () => {
    const deviceToken = issueDeviceToken({ sub: 1, now: new Date(), secret: SECRET });
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw", deviceToken });
    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; user: { id: number; email: string; role: string } };
    expect(body.token).toBeTruthy();
    const claims = verifyAdminSession(body.token, SECRET, new Date());
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "admin" });
    expect(body.user).toMatchObject({ id: 1, email: "kenny@nbcc.test", role: "admin" });
    expect(res.body).not.toHaveProperty("step");
    expect(touchLastLoginMock).toHaveBeenCalledWith(1);
    // Trusted device -> 2FA is skipped entirely, so no code is ever generated.
    expect(upsertLoginCodeMock).not.toHaveBeenCalled();
  });

  it("a device token for a DIFFERENT user is not accepted — falls through to the 2FA challenge", async () => {
    const deviceToken = issueDeviceToken({ sub: 999, now: new Date(), secret: SECRET });
    const res = await login({ email: "kenny@nbcc.test", password: "s3cret-admin-pw", deviceToken });
    expect(res.statusCode).toBe(200);
    expect((res.body as { step: string }).step).toBe("2fa");
    expect(res.body).not.toHaveProperty("token");
    expect(touchLastLoginMock).not.toHaveBeenCalled();
    expect(upsertLoginCodeMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/login/2fa — step 2 (code verification)", () => {
  it("the correct code issues a session; no deviceToken when remember is not set", async () => {
    const codeHash = hashLoginCode("482913", SECRET);
    getLoginCodeMock.mockResolvedValue({ code_hash: codeHash, expires_at: new Date(Date.now() + 5 * 60 * 1000), attempts: 0 });
    bumpLoginCodeAttemptsMock.mockResolvedValue(1);

    const res = await verify2fa({ email: "kenny@nbcc.test", code: "482913" });
    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; user: { id: number }; deviceToken?: string };
    expect(body.token).toBeTruthy();
    const claims = verifyAdminSession(body.token, SECRET, new Date());
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "admin" });
    expect(body.user).toMatchObject({ id: 1, email: "kenny@nbcc.test" });
    expect(body).not.toHaveProperty("deviceToken");
    expect(deleteLoginCodeMock).toHaveBeenCalledWith(1);
    expect(touchLastLoginMock).toHaveBeenCalledWith(1);
  });

  it("remember: true returns a deviceToken that itself verifies for this user", async () => {
    const codeHash = hashLoginCode("482913", SECRET);
    getLoginCodeMock.mockResolvedValue({ code_hash: codeHash, expires_at: new Date(Date.now() + 5 * 60 * 1000), attempts: 0 });
    bumpLoginCodeAttemptsMock.mockResolvedValue(1);

    const res = await verify2fa({ email: "kenny@nbcc.test", code: "482913", remember: true });
    expect(res.statusCode).toBe(200);
    const body = res.body as { deviceToken: string };
    expect(body.deviceToken).toBeTruthy();
    const deviceClaims = verifyDeviceToken(body.deviceToken, SECRET, new Date());
    expect(deviceClaims).toEqual({ sub: 1 });
  });

  it("a wrong code returns 401 and increments the attempt counter", async () => {
    const codeHash = hashLoginCode("482913", SECRET);
    getLoginCodeMock.mockResolvedValue({ code_hash: codeHash, expires_at: new Date(Date.now() + 5 * 60 * 1000), attempts: 1 });
    bumpLoginCodeAttemptsMock.mockResolvedValue(2);

    const res = await verify2fa({ email: "kenny@nbcc.test", code: "000000" });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toHaveProperty("token");
    expect(bumpLoginCodeAttemptsMock).toHaveBeenCalledWith(1);
    expect(deleteLoginCodeMock).not.toHaveBeenCalled();
  });

  it("the 6th wrong attempt locks out (401) and deletes the pending code", async () => {
    const codeHash = hashLoginCode("482913", SECRET);
    getLoginCodeMock.mockResolvedValue({ code_hash: codeHash, expires_at: new Date(Date.now() + 5 * 60 * 1000), attempts: 5 });
    bumpLoginCodeAttemptsMock.mockResolvedValue(6);

    const res = await verify2fa({ email: "kenny@nbcc.test", code: "000000" });
    expect(res.statusCode).toBe(401);
    expect(deleteLoginCodeMock).toHaveBeenCalledWith(1);
  });

  it("an expired code returns 401 without bumping attempts", async () => {
    const codeHash = hashLoginCode("482913", SECRET);
    getLoginCodeMock.mockResolvedValue({ code_hash: codeHash, expires_at: new Date(Date.now() - 1000), attempts: 0 });

    const res = await verify2fa({ email: "kenny@nbcc.test", code: "482913" });
    expect(res.statusCode).toBe(401);
    expect(bumpLoginCodeAttemptsMock).not.toHaveBeenCalled();
  });

  it("no pending code (none requested / already used) returns 401", async () => {
    getLoginCodeMock.mockResolvedValue(null);
    const res = await verify2fa({ email: "kenny@nbcc.test", code: "482913" });
    expect(res.statusCode).toBe(401);
  });

  it("a disabled user at step 2 gets the generic 401 without looking up a code", async () => {
    userRow = {
      id: 3,
      email: "kenny@nbcc.test",
      full_name: "Kenny",
      role: "admin",
      password_hash: ADMIN_HASH,
      status: "disabled",
    };
    const res = await verify2fa({ email: "kenny@nbcc.test", code: "482913" });
    expect(res.statusCode).toBe(401);
    expect(getLoginCodeMock).not.toHaveBeenCalled();
  });

  it("an unknown email at step 2 gets the generic 401 (no enumeration)", async () => {
    const res = await verify2fa({ email: "nobody@nbcc.test", code: "482913" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for a malformed body (non-6-digit code / bad email)", async () => {
    expect((await verify2fa({ email: "kenny@nbcc.test", code: "12a456" })).statusCode).toBe(400);
    expect((await verify2fa({ email: "kenny@nbcc.test", code: "12345" })).statusCode).toBe(400);
    expect((await verify2fa({ email: "not-an-email", code: "482913" })).statusCode).toBe(400);
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

// TASK-200 (fix TASK-188): the mandatory-2FA rate limiters (10/email, 30/IP per 15m) are keyed on
// req.ip, which behind the ALB (trust proxy = 1) is always the real forwarded client IP — so a
// request only presents as loopback when it originates ON the box (local `npm run dev`, or the
// pr.yml BDD suite driving the app over http://localhost). That suite makes ~86 logins from one IP
// reusing emails 20-25x, which exhausted the in-memory limiter mid-run and 429'd most admin
// scenarios (login() then returns no token → every admin request 401s). Exempting loopback keeps
// the caps fully in force for every real external client while letting the local suite log in.
describe("admin login rate limiting is skipped for same-host (loopback) traffic (TASK-200)", () => {
  const loginFrom = async (ip: string, body: unknown) => {
    const res = mockRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await postAdminLogin({ body, ip } as any, res as any);
    return res;
  };

  it("caps a real external IP but never a loopback IP", async () => {
    const creds = { email: "ratelimit-probe@nbcc.test", password: "whatever" };

    // A real external client IS rate-limited: repeated attempts trip the per-email cap → 429.
    let real = mockRes();
    for (let i = 0; i < 12; i += 1) real = await loginFrom("203.0.113.7", creds);
    expect(real.statusCode).toBe(429);

    // Loopback (127.0.0.1) is exempt: even 40 attempts on the same already-capped email never 429,
    // so the local BDD suite — one IP, reused emails — can still exercise the login flow.
    let loop = mockRes();
    for (let i = 0; i < 40; i += 1) loop = await loginFrom("127.0.0.1", creds);
    expect(loop.statusCode).not.toBe(429);
  });
});
