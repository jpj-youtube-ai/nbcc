import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-207: the admin API for the business-supporter fulfilment feature — GET /api/admin/fulfilments
// (list) and POST /api/admin/fulfilments/:id/mark (mark one status flag). Both are Editor+
// (donations:edit): an unauthenticated or Viewer-level request is rejected (401/403) and never
// reads/writes; an Editor+ session may list, and may mark a flag — which flips the boolean and
// appends EXACTLY ONE audit_log row in the same transaction (writeWithAudit — the truth model). An
// unknown flag is rejected (400), and the fixed five-flag allowlist prevents any arbitrary-column
// write. DB-free, mirroring test/unit/admin-api.test.ts: pool (the read + the writeWithAudit
// transaction), the per-request auth row (getUserAuthRow), and config are mocked.

const { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock } = vi.hoisted(() => {
  const queryMock = vi.fn(); // pool.query — the list read
  const clientQueryMock = vi.fn(); // client.query — the markFulfilmentFlag transaction
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const getUserAuthRowMock = vi.fn(); // authorizeSection's fresh per-request DB row
  return { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
// routes/admin.ts imports the Stripe client at module load (cancelSubscription); stub it so the real
// client never instantiates Stripe. These endpoints don't touch Stripe.
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { getAdminFulfilments, postAdminMarkFulfilment } from "../../src/routes/admin";
import { isFulfilmentFlag, FULFILMENT_FLAGS } from "../../src/db/fulfilment";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";

// authorizeSection re-loads the user's row fresh per request (getUserAuthRowMock), so tokenFor sets
// BOTH the token's role claim and the mocked DB row, keeping `role: ...` driving the effective
// access via the role->permissions fallback (effectivePermissions).
let authRow: { id: number; email: string; status: string; role: string; permissions: PermissionMap } = {
  id: 1,
  email: "kenny@nbcc.test",
  status: "active",
  role: "viewer",
  permissions: {},
};
const tokenFor = (role: string) => {
  authRow = { ...authRow, role };
  return signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;
};

// --- mock req/res --------------------------------------------------------------------------------
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
function req(opts: { id?: string; role?: string; token?: string; body?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "7" }, headers, body: opts.body ?? {}, query: {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runList = async (o: any) => {
  const res = mockRes();
  await getAdminFulfilments(req(o) as any, res as any);
  return res;
};
const runMark = async (o: any) => {
  const res = mockRes();
  await postAdminMarkFulfilment(req(o) as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// A representative fulfilment row (base table) as the UPDATE ... RETURNING * yields it.
const fulfilmentRow = {
  id: 7,
  donor_id: 42,
  band: "platinum",
  token: "tok-abc",
  credit_name: "Acme Ltd",
  website: null,
  socials: null,
  list_on_supporters: true,
  want_social: true,
  want_badge: true,
  want_certificate: true,
  certificate_delivery: "post",
  certificate_address: "1 Office Park",
  consent_featured: true,
  captured_at: new Date("2026-07-01T00:00:00Z"),
  certificate_sent: false,
  certificate_posted: false,
  badge_sent: false,
  social_done: false,
  added_to_supporters: false,
  reminder_5_at: null,
  reminder_14_at: null,
  created_at: new Date("2026-06-01T00:00:00Z"),
  updated_at: new Date("2026-06-01T00:00:00Z"),
};
// The list row (fulfilment joined to its donor).
const listRow = {
  id: 7,
  donor_id: 42,
  donor_name: "Ada Lovelace",
  business_name: "Acme Ltd",
  band: "platinum",
  credit_name: "Acme Ltd",
  website: null,
  socials: null,
  list_on_supporters: true,
  want_social: true,
  want_badge: true,
  want_certificate: true,
  certificate_delivery: "post",
  certificate_address: "1 Office Park",
  consent_featured: true,
  captured_at: new Date("2026-07-01T00:00:00Z"),
  certificate_sent: false,
  certificate_posted: false,
  badge_sent: false,
  social_done: false,
  added_to_supporters: false,
  created_at: new Date("2026-06-01T00:00:00Z"),
};

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  authRow = { id: 1, email: "kenny@nbcc.test", status: "active", role: "viewer", permissions: {} };
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);

  queryMock.mockImplementation(async (sql: string) => {
    if (/from business_supporter_fulfilment/i.test(sql)) return { rows: [listRow], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [fulfilmentRow], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const auditInserts = () =>
  clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));

// --- 401: missing / invalid token ---------------------------------------------------------------
describe("admin fulfilment endpoints require a valid session token (401)", () => {
  it("401s the list and the mark with no Authorization header, reading/writing nothing", async () => {
    expect((await runList({ token: "" })).statusCode).toBe(401);
    expect((await runMark({ token: "", body: { flag: "certificate_sent" } })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("401s on a token signed with the wrong key", async () => {
    const forged = signAdminSession({ sub: 1, email: "x@y.co", role: "admin", now: new Date(), secret: "wrong-key" }).token;
    expect((await runList({ token: forged })).statusCode).toBe(401);
    expect((await runMark({ token: forged, body: { flag: "certificate_sent" } })).statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });
});

// --- 403: Editor+ only (a Viewer is insufficient) -----------------------------------------------
describe("role enforcement: Editor+ only (Viewer is 403)", () => {
  it("403s a Viewer on the list and the mark, reading/writing nothing", async () => {
    expect((await runList({ role: "viewer" })).statusCode).toBe(403);
    expect((await runMark({ role: "viewer", body: { flag: "certificate_sent" } })).statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(auditInserts()).toHaveLength(0);
  });

  it("403s a caller whose stored permissions grant donations:view only (not edit)", async () => {
    getUserAuthRowMock.mockResolvedValue({
      id: 1,
      email: "kenny@nbcc.test",
      status: "active",
      role: "viewer",
      permissions: { donations: "view" },
    });
    expect((await runList({ role: "viewer" })).statusCode).toBe(403);
    expect((await runMark({ role: "viewer", body: { flag: "badge_sent" } })).statusCode).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });
});

// --- 200: Editor and Admin may list and mark ----------------------------------------------------
describe.each(["editor", "admin"])("role %s (Editor+) may list and mark", (role) => {
  it("lists business-supporter fulfilment records (200, { results }), most recent first + bounded", async () => {
    const res = await runList({ role });
    expect(res.statusCode).toBe(200);
    const body = res.body as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results).toHaveLength(1);
    const call = queryMock.mock.calls.find((c) => /from business_supporter_fulfilment/i.test(String(c[0])));
    expect(call?.[0]).toMatch(/join\s+donors/i);
    expect(call?.[0]).toMatch(/order by[\s\S]*desc/i);
    expect(call?.[0]).toMatch(/limit/i);
  });

  it("marks a flag: flips the boolean + one audit row in one transaction (writeWithAudit)", async () => {
    const res = await runMark({ role, id: "7", body: { flag: "certificate_sent" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 7, flag: "certificate_sent", value: true });

    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    // Set exactly the requested flag column true and bumped updated_at, in-tx.
    const update = clientQueryMock.mock.calls.find((c) => /update business_supporter_fulfilment/i.test(String(c[0])));
    expect(update?.[0]).toMatch(/set\s+certificate_sent\s*=\s*true/i);
    expect(update?.[0]).toMatch(/updated_at\s*=\s*now\(\)/i);
    // Exactly one audit row: actor admin:<email>, action fulfilment.<flag>, entity + id.
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1][0]).toBe("admin:kenny@nbcc.test"); // actor
    expect(audits[0][1][1]).toBe("fulfilment.certificate_sent"); // action
    expect(audits[0][1][2]).toBe("business_supporter_fulfilment"); // entity
    expect(audits[0][1][3]).toBe(7); // entityId
  });
});

// Every one of the five flags maps to ITS OWN column + action (no cross-talk, all allow-listed).
describe.each(FULFILMENT_FLAGS)("mark flag %s", (flag) => {
  it("flips that column true and audits fulfilment.<flag>", async () => {
    const res = await runMark({ role: "editor", id: "7", body: { flag } });
    expect(res.statusCode).toBe(200);
    const update = clientQueryMock.mock.calls.find((c) => /update business_supporter_fulfilment/i.test(String(c[0])));
    expect(update?.[0]).toMatch(new RegExp(`set\\s+${flag}\\s*=\\s*true`, "i"));
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1][1]).toBe(`fulfilment.${flag}`);
  });
});

// --- mark validation: id, flag allowlist, not-found ---------------------------------------------
describe("mark validation", () => {
  it("400s an unknown flag and never opens a transaction (no arbitrary-column write)", async () => {
    const res = await runMark({ role: "editor", id: "7", body: { flag: "is_admin" } });
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s a SQL-injection-style flag and writes nothing", async () => {
    const res = await runMark({
      role: "editor",
      id: "7",
      body: { flag: "certificate_sent = true; DROP TABLE donors; --" },
    });
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("400s a missing flag", async () => {
    expect((await runMark({ role: "editor", id: "7", body: {} })).statusCode).toBe(400);
  });

  it("400s a non-numeric fulfilment id", async () => {
    const res = await runMark({ role: "editor", id: "abc", body: { flag: "certificate_sent" } });
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("404s an unknown fulfilment id (UPDATE matches no row), rolling back with no audit row", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const res = await runMark({ role: "editor", id: "999", body: { flag: "badge_sent" } });
    expect(res.statusCode).toBe(404);
    expect(auditInserts()).toHaveLength(0);
    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq.some((s) => /^rollback/i.test(s))).toBe(true);
  });
});

// --- DB-free: the flag-name allowlist (the security boundary) -----------------------------------
describe("isFulfilmentFlag allowlist (pure, DB-free)", () => {
  it("is exactly the five known flags", () => {
    expect(FULFILMENT_FLAGS).toHaveLength(5);
    for (const flag of FULFILMENT_FLAGS) expect(isFulfilmentFlag(flag)).toBe(true);
  });

  it("rejects any other value (unknown/other column, injection, wrong case, non-string)", () => {
    for (const bad of [
      "",
      "token",
      "band",
      "id",
      "donor_id",
      "updated_at",
      "reminder_5_at",
      "certificate",
      "CERTIFICATE_SENT",
      "certificate_sent; DROP TABLE donors",
    ]) {
      expect(isFulfilmentFlag(bad)).toBe(false);
    }
    expect(isFulfilmentFlag(undefined)).toBe(false);
    expect(isFulfilmentFlag(null)).toBe(false);
    expect(isFulfilmentFlag(1)).toBe(false);
    expect(isFulfilmentFlag({})).toBe(false);
  });
});
