import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin-management Phase 1, Task 5: GET/POST /api/admin/users, PATCH/DELETE /api/admin/users/:id,
// POST /api/admin/users/:id/reset — all Admin-role ONLY (authorizeAdmin(req,res,"admin"); a
// viewer/editor token gets 403). Plus the two PUBLIC endpoints: POST /api/admin/forgot (uniform
// 200, no account enumeration) and POST /api/admin/set-password (token round-trip). Mirrors
// admin-contact-routes.test.ts's mock/req/res style: mock the db layer (../../src/db/admin-users)
// and the email client's two new sends, keep config/pool minimally stubbed so importing the router
// (which pulls in the whole of src/routes/admin.ts) doesn't require a real pool/DB. src/admin/tokens
// is left REAL (pure/deterministic HMAC) so the set-password tests exercise a genuine issue->verify
// round trip instead of a mocked one.

const {
  listUsersMock,
  getManagedUserMock,
  getManagedUserByEmailMock,
  getPasswordHashMock,
  inviteUserMock,
  setUserRoleMock,
  setUserStatusMock,
  deleteUserMock,
  setUserPasswordMock,
  isLastEnabledAdminMock,
} = vi.hoisted(() => ({
  listUsersMock: vi.fn(),
  getManagedUserMock: vi.fn(),
  getManagedUserByEmailMock: vi.fn(),
  getPasswordHashMock: vi.fn(),
  inviteUserMock: vi.fn(),
  setUserRoleMock: vi.fn(),
  setUserStatusMock: vi.fn(),
  deleteUserMock: vi.fn(),
  setUserPasswordMock: vi.fn(),
  isLastEnabledAdminMock: vi.fn(),
}));

const { MockDuplicateEmailError, MockLastAdminError } = vi.hoisted(() => ({
  MockDuplicateEmailError: class MockDuplicateEmailError extends Error {
    email: string;
    constructor(email: string) {
      super(`a user with email ${email} already exists`);
      this.name = "DuplicateEmailError";
      this.email = email;
    }
  },
  MockLastAdminError: class MockLastAdminError extends Error {
    constructor() {
      super("this change would leave zero enabled admins");
      this.name = "LastAdminError";
    }
  },
}));

vi.mock("../../src/db/admin-users", () => ({
  listUsers: listUsersMock,
  getManagedUser: getManagedUserMock,
  getManagedUserByEmail: getManagedUserByEmailMock,
  getPasswordHash: getPasswordHashMock,
  inviteUser: inviteUserMock,
  setUserRole: setUserRoleMock,
  setUserStatus: setUserStatusMock,
  deleteUser: deleteUserMock,
  setUserPassword: setUserPasswordMock,
  isLastEnabledAdmin: isLastEnabledAdminMock,
  DuplicateEmailError: MockDuplicateEmailError,
  LastAdminError: MockLastAdminError,
}));

const { sendAdminInviteMock, sendAdminResetMock } = vi.hoisted(() => ({
  sendAdminInviteMock: vi.fn(),
  sendAdminResetMock: vi.fn(),
}));
vi.mock("../../src/clients/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/clients/email")>();
  return { ...actual, sendAdminInvite: sendAdminInviteMock, sendAdminReset: sendAdminResetMock };
});

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    PORTAL_BASE_URL: "https://nbcc.scot",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
// admin.ts (pulled in via ./admin's authorizeAdmin/actorOf) also imports these at module load time;
// stub them minimally so importing the router doesn't require a real pool/DB.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import {
  getAdminUsers,
  postAdminUsers,
  patchAdminUser,
  deleteAdminUser,
  postAdminUserReset,
  postAdminForgot,
  postAdminSetPassword,
} from "../../src/routes/admin-users";
import { signAdminSession } from "../../src/admin/session";
import { issueAdminActionToken } from "../../src/admin/tokens";

const SECRET = "test-admin-secret";
const tokenFor = (role: string, email = "kenny@nbcc.test") =>
  signAdminSession({ sub: 1, email, role, now: new Date(), secret: SECRET }).token;

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
function req(opts: {
  id?: string;
  role?: string;
  token?: string;
  body?: unknown;
  query?: unknown;
  email?: string;
  ip?: string;
}) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role, opts.email) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    params: { id: opts.id ?? "7" },
    headers,
    body: opts.body ?? {},
    query: opts.query ?? {},
    ip: opts.ip ?? "127.0.0.1",
  };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runList = async (o: any) => {
  const res = mockRes();
  await getAdminUsers(req(o) as any, res as any);
  return res;
};
const runInvite = async (o: any) => {
  const res = mockRes();
  await postAdminUsers(req(o) as any, res as any);
  return res;
};
const runPatch = async (o: any) => {
  const res = mockRes();
  await patchAdminUser(req(o) as any, res as any);
  return res;
};
const runDelete = async (o: any) => {
  const res = mockRes();
  await deleteAdminUser(req(o) as any, res as any);
  return res;
};
const runReset = async (o: any) => {
  const res = mockRes();
  await postAdminUserReset(req(o) as any, res as any);
  return res;
};
const runForgot = async (o: any) => {
  const res = mockRes();
  await postAdminForgot(req(o) as any, res as any);
  return res;
};
const runSetPassword = async (o: any) => {
  const res = mockRes();
  await postAdminSetPassword(req(o) as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const ADMIN_USER = {
  id: 1,
  email: "admin@nbcc.test",
  full_name: "Admin One",
  role: "admin",
  status: "active",
  invited_at: null,
  last_login_at: null,
};
const EDITOR_USER = { ...ADMIN_USER, id: 2, role: "editor" };

beforeEach(() => {
  listUsersMock.mockReset();
  getManagedUserMock.mockReset();
  getManagedUserByEmailMock.mockReset();
  getPasswordHashMock.mockReset();
  inviteUserMock.mockReset();
  setUserRoleMock.mockReset();
  setUserStatusMock.mockReset();
  deleteUserMock.mockReset();
  setUserPasswordMock.mockReset();
  isLastEnabledAdminMock.mockReset();
  sendAdminInviteMock.mockReset();
  sendAdminResetMock.mockReset();
});

describe("Admin-role gate: every /api/admin/users* route rejects non-admins", () => {
  it("401s GET with no token", async () => {
    const res = await runList({ token: "" });
    expect(res.statusCode).toBe(401);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"])("%s gets 403 on GET /api/admin/users", async (role) => {
    const res = await runList({ role });
    expect(res.statusCode).toBe(403);
    expect(listUsersMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"])("%s gets 403 on POST /api/admin/users (invite)", async (role) => {
    const res = await runInvite({ role, body: { email: "a@b.com", fullName: "A B", role: "viewer" } });
    expect(res.statusCode).toBe(403);
    expect(inviteUserMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"])("%s gets 403 on PATCH /api/admin/users/:id", async (role) => {
    const res = await runPatch({ role, body: { role: "editor" } });
    expect(res.statusCode).toBe(403);
    expect(getManagedUserMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"])("%s gets 403 on DELETE /api/admin/users/:id", async (role) => {
    const res = await runDelete({ role });
    expect(res.statusCode).toBe(403);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "editor"])("%s gets 403 on POST /api/admin/users/:id/reset", async (role) => {
    const res = await runReset({ role });
    expect(res.statusCode).toBe(403);
    expect(sendAdminResetMock).not.toHaveBeenCalled();
  });

  it("an admin token passes the gate on GET", async () => {
    listUsersMock.mockResolvedValueOnce([]);
    const res = await runList({ role: "admin" });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/admin/users", () => {
  it("200s with the results list for an admin", async () => {
    listUsersMock.mockResolvedValueOnce([ADMIN_USER, EDITOR_USER]);
    const res = await runList({ role: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: [ADMIN_USER, EDITOR_USER] });
  });
});

describe("POST /api/admin/users (invite)", () => {
  it("creates the invited user, emails an invite link, and 201s with the id", async () => {
    inviteUserMock.mockResolvedValueOnce({ id: 42 });
    const res = await runInvite({
      role: "admin",
      email: "boss@nbcc.test",
      body: { email: "newbie@nbcc.test", fullName: "New Bie", role: "viewer" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ id: 42 });
    expect(inviteUserMock).toHaveBeenCalledWith(
      { email: "newbie@nbcc.test", full_name: "New Bie", role: "viewer" },
      "admin:boss@nbcc.test",
    );
    expect(sendAdminInviteMock).toHaveBeenCalledTimes(1);
    const sent = sendAdminInviteMock.mock.calls[0][0];
    expect(sent.email).toBe("newbie@nbcc.test");
    expect(sent.link).toMatch(/^https:\/\/nbcc\.scot\/invite\?token=/);
  });

  it("409s a duplicate email and never sends an email", async () => {
    inviteUserMock.mockRejectedValueOnce(new MockDuplicateEmailError("dupe@nbcc.test"));
    const res = await runInvite({
      role: "admin",
      body: { email: "dupe@nbcc.test", fullName: "Dupe", role: "viewer" },
    });
    expect(res.statusCode).toBe(409);
    expect(sendAdminInviteMock).not.toHaveBeenCalled();
  });

  it("400s an invalid invite body (bad role) and never calls inviteUser", async () => {
    const res = await runInvite({ role: "admin", body: { email: "x@y.com", fullName: "X", role: "boss" } });
    expect(res.statusCode).toBe(400);
    expect(inviteUserMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users/:id", () => {
  it("404s when the user does not exist", async () => {
    getManagedUserMock.mockResolvedValueOnce(null);
    const res = await runPatch({ role: "admin", body: { role: "editor" } });
    expect(res.statusCode).toBe(404);
  });

  it("409s { error: 'last_admin' } demoting the only enabled admin, without mutating", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(true);
    const res = await runPatch({ role: "admin", body: { role: "editor" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
    expect(isLastEnabledAdminMock).toHaveBeenCalledWith(ADMIN_USER, "demote");
    expect(setUserRoleMock).not.toHaveBeenCalled();
  });

  it("409s { error: 'last_admin' } disabling the only enabled admin, without mutating", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(true);
    const res = await runPatch({ role: "admin", body: { status: "disabled" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
    expect(isLastEnabledAdminMock).toHaveBeenCalledWith(ADMIN_USER, "disable");
    expect(setUserStatusMock).not.toHaveBeenCalled();
  });

  it("applies a role change when another admin remains", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(false);
    setUserRoleMock.mockResolvedValueOnce({ ...ADMIN_USER, role: "editor" });
    const res = await runPatch({ role: "admin", email: "boss@nbcc.test", body: { role: "editor" } });
    expect(res.statusCode).toBe(200);
    expect(setUserRoleMock).toHaveBeenCalledWith(7, "editor", "admin:boss@nbcc.test");
  });

  it("applies a status change with no guard needed for a non-admin target", async () => {
    getManagedUserMock.mockResolvedValueOnce(EDITOR_USER);
    setUserStatusMock.mockResolvedValueOnce({ ...EDITOR_USER, status: "disabled" });
    const res = await runPatch({ role: "admin", body: { status: "disabled" } });
    expect(res.statusCode).toBe(200);
    // The guard is still consulted (it is DB-bound and decides internally), but never blocks a
    // non-admin target — the mock's default resolved value (undefined -> falsy) lets the write through.
    expect(setUserStatusMock).toHaveBeenCalledWith(7, "disabled", "admin:kenny@nbcc.test");
  });

  it("400s an empty patch body", async () => {
    const res = await runPatch({ role: "admin", body: {} });
    expect(res.statusCode).toBe(400);
    expect(getManagedUserMock).not.toHaveBeenCalled();
  });

  it("400s a non-numeric id", async () => {
    const res = await runPatch({ role: "admin", id: "abc", body: { role: "editor" } });
    expect(res.statusCode).toBe(400);
    expect(getManagedUserMock).not.toHaveBeenCalled();
  });

  // Security review FIX #4: the fast pre-check (isLastEnabledAdmin) is good UX but is NOT atomic
  // with the write — a concurrent request can race past it. The db layer's authoritative,
  // same-transaction guard throws LastAdminError when a role change would leave zero enabled
  // admins; the route must map that to the same 409 the pre-check produces.
  it("409s { error: 'last_admin' } when the db's transactional guard rejects a role change that raced past the pre-check", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(false);
    setUserRoleMock.mockRejectedValueOnce(new MockLastAdminError());
    const res = await runPatch({ role: "admin", body: { role: "editor" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
  });

  it("409s { error: 'last_admin' } when the db's transactional guard rejects a status disable that raced past the pre-check", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(false);
    setUserStatusMock.mockRejectedValueOnce(new MockLastAdminError());
    const res = await runPatch({ role: "admin", body: { status: "disabled" } });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("404s when the user does not exist", async () => {
    getManagedUserMock.mockResolvedValueOnce(null);
    const res = await runDelete({ role: "admin" });
    expect(res.statusCode).toBe(404);
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("409s { error: 'last_admin' } deleting the only enabled admin, without deleting", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(true);
    const res = await runDelete({ role: "admin" });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("200s { deleted: true } when another admin remains", async () => {
    getManagedUserMock.mockResolvedValueOnce(EDITOR_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(false);
    deleteUserMock.mockResolvedValueOnce(true);
    const res = await runDelete({ role: "admin", email: "boss@nbcc.test" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expect(deleteUserMock).toHaveBeenCalledWith(7, "admin:boss@nbcc.test");
  });

  // Security review FIX #4: same TOCTOU race as PATCH — the pre-check can be raced, so the db
  // layer's same-transaction guard is authoritative. LastAdminError from the delete -> 409.
  it("409s { error: 'last_admin' } when the db's transactional guard rejects a delete that raced past the pre-check", async () => {
    getManagedUserMock.mockResolvedValueOnce(EDITOR_USER);
    isLastEnabledAdminMock.mockResolvedValueOnce(false);
    deleteUserMock.mockRejectedValueOnce(new MockLastAdminError());
    const res = await runDelete({ role: "admin" });
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "last_admin" });
  });
});

describe("POST /api/admin/users/:id/reset (admin-initiated)", () => {
  it("404s when the user does not exist", async () => {
    getManagedUserMock.mockResolvedValueOnce(null);
    const res = await runReset({ role: "admin" });
    expect(res.statusCode).toBe(404);
    expect(sendAdminResetMock).not.toHaveBeenCalled();
  });

  it("200s { sent: true } and emails a reset link bound to the current hash", async () => {
    getManagedUserMock.mockResolvedValueOnce(ADMIN_USER);
    getPasswordHashMock.mockResolvedValueOnce("scrypt$abc$def");
    const res = await runReset({ role: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: true });
    expect(sendAdminResetMock).toHaveBeenCalledTimes(1);
    const sent = sendAdminResetMock.mock.calls[0][0];
    expect(sent.email).toBe(ADMIN_USER.email);
    expect(sent.link).toMatch(/^https:\/\/nbcc\.scot\/reset\?token=/);
  });
});

describe("POST /api/admin/forgot (public, no account enumeration)", () => {
  it("200s for an unknown email and never sends", async () => {
    getManagedUserByEmailMock.mockResolvedValueOnce(null);
    const res = await runForgot({ token: "", body: { email: "nobody@nbcc.test" }, ip: "1.1.1.1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendAdminResetMock).not.toHaveBeenCalled();
  });

  it("200s for a known, active email and DOES send", async () => {
    getManagedUserByEmailMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 9 });
    getPasswordHashMock.mockResolvedValueOnce("scrypt$abc$def");
    const res = await runForgot({ token: "", body: { email: "admin@nbcc.test" }, ip: "1.1.1.2" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendAdminResetMock).toHaveBeenCalledTimes(1);
  });

  it("200s for a known but disabled email and never sends", async () => {
    getManagedUserByEmailMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 9, status: "disabled" });
    const res = await runForgot({ token: "", body: { email: "admin@nbcc.test" }, ip: "1.1.1.3" });
    expect(res.statusCode).toBe(200);
    expect(sendAdminResetMock).not.toHaveBeenCalled();
  });

  it("200s for a known but still-invited email and never sends", async () => {
    getManagedUserByEmailMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 9, status: "invited" });
    const res = await runForgot({ token: "", body: { email: "admin@nbcc.test" }, ip: "1.1.1.4" });
    expect(res.statusCode).toBe(200);
    expect(sendAdminResetMock).not.toHaveBeenCalled();
  });

  it("400s an invalid email", async () => {
    const res = await runForgot({ token: "", body: { email: "not-an-email" }, ip: "1.1.1.5" });
    expect(res.statusCode).toBe(400);
    expect(getManagedUserByEmailMock).not.toHaveBeenCalled();
  });

  // Security review FIX #3: the response must not wait on the send, or its latency leaks whether
  // an active account exists. Prove it's fire-and-forget by having the send hang forever and
  // asserting the route still resolves (this test would time out under the old awaited code).
  it("200s immediately without waiting for the reset email send (no timing leak)", async () => {
    // A fresh email — forgotEmailLimiter is created once at module scope (not reset between
    // tests), so reusing "admin@nbcc.test" here would trip its max:3 window from earlier tests.
    getManagedUserByEmailMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 9, email: "hangs@nbcc.test" });
    getPasswordHashMock.mockResolvedValueOnce("scrypt$abc$def");
    // A send that never resolves: if the route awaited it, this test would hang until Vitest's
    // per-test timeout and fail — proving the fix actually stopped awaiting the send.
    sendAdminResetMock.mockImplementationOnce(() => new Promise(() => {}));
    const res = await runForgot({ token: "", body: { email: "hangs@nbcc.test" }, ip: "1.1.1.6" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sendAdminResetMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/set-password (public)", () => {
  it("accepts a valid invite token: activates the account", async () => {
    const token = issueAdminActionToken({
      sub: 5,
      purpose: "invite",
      bind: "",
      now: new Date(),
      secret: SECRET,
    });
    getManagedUserMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 5 });
    getPasswordHashMock.mockResolvedValueOnce(null);
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setUserPasswordMock).toHaveBeenCalledWith(
      5,
      expect.any(String),
      `self:${ADMIN_USER.email}`,
      "admin_user.activated",
    );
  });

  it("accepts a valid reset token bound to the current hash: records a password_reset", async () => {
    const token = issueAdminActionToken({
      sub: 6,
      purpose: "reset",
      bind: "scrypt$abc$def",
      now: new Date(),
      secret: SECRET,
    });
    getManagedUserMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 6 });
    getPasswordHashMock.mockResolvedValueOnce("scrypt$abc$def");
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.2",
    });
    expect(res.statusCode).toBe(200);
    expect(setUserPasswordMock).toHaveBeenCalledWith(
      6,
      expect.any(String),
      `self:${ADMIN_USER.email}`,
      "admin_user.password_reset",
    );
  });

  it("400s when the bind no longer matches (link already used / password changed since)", async () => {
    const token = issueAdminActionToken({
      sub: 6,
      purpose: "reset",
      bind: "scrypt$stale$hash",
      now: new Date(),
      secret: SECRET,
    });
    getManagedUserMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 6 });
    getPasswordHashMock.mockResolvedValueOnce("scrypt$new$hash");
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.3",
    });
    expect(res.statusCode).toBe(400);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  it("400s a malformed/tampered token", async () => {
    const res = await runSetPassword({
      token: "",
      body: { token: "not-a-real-token", password: "a-long-enough-password" },
      ip: "2.2.2.4",
    });
    expect(res.statusCode).toBe(400);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  it("400s an expired token", async () => {
    const token = issueAdminActionToken({
      sub: 6,
      purpose: "reset",
      bind: "",
      now: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ttlMs: 1000,
      secret: SECRET,
    });
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.5",
    });
    expect(res.statusCode).toBe(400);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  it("400s when the token's user no longer exists", async () => {
    const token = issueAdminActionToken({
      sub: 999,
      purpose: "reset",
      bind: "",
      now: new Date(),
      secret: SECRET,
    });
    getManagedUserMock.mockResolvedValueOnce(null);
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.6",
    });
    expect(res.statusCode).toBe(400);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  it("400s a too-short password", async () => {
    const token = issueAdminActionToken({
      sub: 5,
      purpose: "invite",
      bind: "",
      now: new Date(),
      secret: SECRET,
    });
    const res = await runSetPassword({ token: "", body: { token, password: "short" }, ip: "2.2.2.7" });
    expect(res.statusCode).toBe(400);
    expect(getManagedUserMock).not.toHaveBeenCalled();
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });

  // Security review FIX #5: a disabled account's reset-token bind can still match its (never
  // cleared) password_hash. Completing set-password must NOT be able to reactivate it — same
  // generic invalid-link 400 as a bad token, and the password/status must never be touched.
  it("400s a valid, correctly-bound token whose target is disabled, and never sets the password (cannot self-reactivate)", async () => {
    const token = issueAdminActionToken({
      sub: 8,
      purpose: "reset",
      bind: "scrypt$abc$def",
      now: new Date(),
      secret: SECRET,
    });
    getManagedUserMock.mockResolvedValueOnce({ ...ADMIN_USER, id: 8, status: "disabled" });
    const res = await runSetPassword({
      token: "",
      body: { token, password: "a-long-enough-password" },
      ip: "2.2.2.8",
    });
    expect(res.statusCode).toBe(400);
    expect(setUserPasswordMock).not.toHaveBeenCalled();
  });
});
