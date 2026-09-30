import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin management Phase 2, Task 3: authorizeSection is the DB-backed gate that replaces
// authorizeAdmin (src/routes/admin.ts). It verifies the bearer session token EXACTLY as
// authorizeAdmin does (same 401 messages), then re-loads the user's live row from the DB on every
// request (getUserAuthRow) so a disable takes effect immediately (closing Phase 1's stale-session
// gap), then checks the effective per-section permission. Mirrors admin-auth.test.ts's mock/req/res
// style; mocks only ../../src/db/admin-users (getUserAuthRow) and uses REAL signed session tokens
// (signAdminSession) so the token-verification path is genuinely exercised, not mocked.

const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));

vi.mock("../../src/config", () => ({
  config: {
    ADMIN_SESSION_SECRET: "test-admin-secret",
  },
}));

import { authorizeSection, authorizeSections, authorizeAny, loadEffectivePermissions } from "../../src/routes/admin-authz";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";
// Sign session tokens relative to the CURRENT time, never a fixed date. authorizeSection
// verifies the bearer token against the real clock (`new Date()` in src/routes/admin-authz.ts)
// and the session TTL is 8h (ADMIN_SESSION_TTL_MS), so a hardcoded past date makes the token
// "expired" the moment real time moves past date+8h — which rotted these tests (they were
// pinned to 2026-07-11 and started failing on 2026-07-12). Relative-to-now keeps them valid.
const NOW = new Date();

function tokenFor(sub: number, role: string, email = "kenny@nbcc.test"): string {
  return signAdminSession({ sub, email, role, now: NOW, secret: SECRET }).token;
}

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function req(token?: string): any {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers };
}

function authRow(overrides: {
  status?: string;
  role?: string;
  permissions?: PermissionMap;
  id?: number;
  email?: string;
}) {
  return {
    id: overrides.id ?? 1,
    email: overrides.email ?? "kenny@nbcc.test",
    status: overrides.status ?? "active",
    role: overrides.role ?? "viewer",
    permissions: overrides.permissions ?? {},
  };
}

beforeEach(() => {
  getUserAuthRowMock.mockReset();
});

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("authorizeSection (Admin Phase 2, Task 3)", () => {
  it("returns the claims for a valid token whose effective permissions satisfy a view request", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "viewer" })); // viewer defaults to view on stories
    const res = mockRes();
    const claims = await authorizeSection(req(tokenFor(1, "viewer")), res as any, "stories", "view");
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "viewer" });
    expect(res.statusCode).toBe(200); // no error response sent
  });

  it("returns 401 (generic — no account enumeration) when the user's row is disabled", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "admin", status: "disabled" }));
    const res = mockRes();
    const claims = await authorizeSection(req(tokenFor(1, "admin")), res as any, "stories", "view");
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });

  it("returns 401 (generic) when the user's row no longer exists", async () => {
    getUserAuthRowMock.mockResolvedValue(null);
    const res = mockRes();
    const claims = await authorizeSection(req(tokenFor(1, "admin")), res as any, "stories", "view");
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });

  it("returns 403 forbidden when edit is requested but the user only holds view", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "viewer" })); // viewer: view-only everywhere
    const res = mockRes();
    const claims = await authorizeSection(req(tokenFor(1, "viewer")), res as any, "stories", "edit");
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
  });

  it("returns claims when view is requested and the user holds edit (edit satisfies view)", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "admin" })); // admin: edit everywhere
    const res = mockRes();
    const claims = await authorizeSection(req(tokenFor(1, "admin")), res as any, "stories", "view");
    expect(claims).toMatchObject({ sub: 1, role: "admin" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 with 'Missing admin session token' when no bearer token is supplied", async () => {
    const res = mockRes();
    const claims = await authorizeSection(req(undefined), res as any, "stories", "view");
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing admin session token" });
    expect(getUserAuthRowMock).not.toHaveBeenCalled();
  });

  it("returns 401 with 'Invalid or expired admin session' for an invalid/malformed token", async () => {
    const res = mockRes();
    const claims = await authorizeSection(req("garbage"), res as any, "stories", "view");
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
    expect(getUserAuthRowMock).not.toHaveBeenCalled();
  });
});

// TASK-464: a card on one section's page that shows another section's data (the Festive Ball's
// ticket report, on the Events page) needs both. Access that leaves the Ball out must not see the
// Ball's numbers by way of Events.
describe("authorizeSections (TASK-464): every section named, at its level", () => {
  const BOTH = [["events", "edit"], ["ball", "view"]] as const;

  it("returns the claims when the user holds every one", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "editor" })); // editor: events edit, ball view
    const res = mockRes();
    const claims = await authorizeSections(req(tokenFor(1, "editor")), res as any, BOTH);
    expect(claims).toMatchObject({ sub: 1, role: "editor" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 when any one is missing", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ permissions: { events: "edit", ball: "none" } }));
    const res = mockRes();
    expect(await authorizeSections(req(tokenFor(1, "viewer")), res as any, BOTH)).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
  });

  it("returns 403 when a level is too low, even if the others are fine", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ permissions: { events: "view", ball: "edit" } }));
    const res = mockRes();
    expect(await authorizeSections(req(tokenFor(1, "viewer")), res as any, BOTH)).toBeNull();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 exactly as authorizeSection does without a session", async () => {
    const res = mockRes();
    expect(await authorizeSections(req(), res as any, BOTH)).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing admin session token" });
  });
});

describe("authorizeAny (Admin Phase 2, Task 5) — session-only gate, no section/level check", () => {
  it("returns the claims for any valid, non-disabled session regardless of permissions", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "viewer" })); // a viewer has no team access at all
    const res = mockRes();
    const claims = await authorizeAny(req(tokenFor(1, "viewer")), res as any);
    expect(claims).toMatchObject({ sub: 1, email: "kenny@nbcc.test", role: "viewer" });
    expect(res.statusCode).toBe(200); // no error response sent
  });

  it("returns 401 (generic) when the user's row is disabled", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "admin", status: "disabled" }));
    const res = mockRes();
    const claims = await authorizeAny(req(tokenFor(1, "admin")), res as any);
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });

  it("returns 401 with 'Missing admin session token' when no bearer token is supplied", async () => {
    const res = mockRes();
    const claims = await authorizeAny(req(undefined), res as any);
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Missing admin session token" });
    expect(getUserAuthRowMock).not.toHaveBeenCalled();
  });

  it("returns 401 with 'Invalid or expired admin session' for an invalid/malformed token", async () => {
    const res = mockRes();
    const claims = await authorizeAny(req("garbage"), res as any);
    expect(claims).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
    expect(getUserAuthRowMock).not.toHaveBeenCalled();
  });
});

describe("loadEffectivePermissions (Admin Phase 2, Task 3)", () => {
  it("returns the user's effective permissions when active", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "admin" }));
    const perms = await loadEffectivePermissions(1);
    expect(perms).toMatchObject({ stories: "edit", team: "edit" });
  });

  it("returns null when the user is disabled", async () => {
    getUserAuthRowMock.mockResolvedValue(authRow({ role: "admin", status: "disabled" }));
    expect(await loadEffectivePermissions(1)).toBeNull();
  });

  it("returns null when the user no longer exists", async () => {
    getUserAuthRowMock.mockResolvedValue(null);
    expect(await loadEffectivePermissions(1)).toBeNull();
  });
});
