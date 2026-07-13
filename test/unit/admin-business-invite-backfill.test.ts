import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-214: the admin endpoint that triggers the one-time catch-up invite backfill —
// POST /api/admin/business-supporters/backfill-invites. Editor+ (donations:edit), same gate as the
// rest of the business-supporter fulfilment API: an unauthenticated or Viewer-level request is
// rejected (401/403) and touches nothing. An Editor+ call drives the REAL wiring end to end (the route
// → runBusinessInviteBackfill → the real list/send/mark/audit) over a mocked pool + a stubbed email
// client (dev + placeholder EMAIL_SEND_URL ⇒ the send stubs, no network), returns the counts, and
// appends exactly one `fulfilment.backfill_invites` audit row. DB-free, mirroring
// admin-fulfilment-api.test.ts: pool, the per-request auth row (getUserAuthRow), config, and the
// Stripe client (imported at admin.ts load) are mocked.

const { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock } = vi.hoisted(() => {
  const queryMock = vi.fn(); // pool.query — the un-invited list read + the per-supporter invited stamp
  const clientQueryMock = vi.fn(); // client.query — the recordAudit summary insert
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const getUserAuthRowMock = vi.fn();
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
    // The env-correct public base for the tokenised link + the repliable giving inbox (no new key).
    PORTAL_BASE_URL: "https://nbcc.test",
    GIVING_FROM_EMAIL: "giving@nbcc.scot",
    // EMAIL_SEND_URL deliberately absent ⇒ the email client treats it as a placeholder ⇒ dev sends stub.
  },
}));
// routes/admin.ts imports the Stripe client at module load (cancelSubscription); stub it so the real
// client never instantiates Stripe. This endpoint doesn't touch Stripe.
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { postAdminBackfillBusinessInvites } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";

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
function req(opts: { role?: string; token?: string }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: {}, headers, body: {}, query: {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runBackfill = async (o: any) => {
  const res = mockRes();
  await postAdminBackfillBusinessInvites(req(o) as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// Two un-invited supporters the list read returns (invited_at NULL, captured_at NULL, with email + token).
const uninvitedRows = [
  { id: 1, token: "tok-1", band: "gold", email: "a@biz.test", business_name: "Bean There", full_name: "Jo Trader" },
  { id: 2, token: "tok-2", band: "bronze", email: "b@biz.test", business_name: null, full_name: "Sam Sole" },
];

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  authRow = { id: 1, email: "kenny@nbcc.test", status: "active", role: "viewer", permissions: {} };
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);

  queryMock.mockImplementation(async (sql: string) => {
    if (/from business_supporter_fulfilment/i.test(sql) && /invited_at is null/i.test(sql)) {
      return { rows: uninvitedRows, rowCount: uninvitedRows.length };
    }
    if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [], rowCount: 1 }; // stamp invited
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const auditInserts = () => clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));

describe("POST /api/admin/business-supporters/backfill-invites requires a valid session (401)", () => {
  it("401s with no Authorization header, reading/writing nothing", async () => {
    expect((await runBackfill({ token: "" })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("401s on a token signed with the wrong key", async () => {
    const forged = signAdminSession({ sub: 1, email: "x@y.co", role: "admin", now: new Date(), secret: "wrong-key" }).token;
    expect((await runBackfill({ token: forged })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("role enforcement: Editor+ only (Viewer is 403)", () => {
  it("403s a Viewer, reading/writing nothing", async () => {
    expect((await runBackfill({ role: "viewer" })).statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(auditInserts()).toHaveLength(0);
  });
});

describe.each(["editor", "admin"])("role %s (Editor+) may run the backfill", (role) => {
  it("returns the counts, stamps each supporter invited, and audits one summary row", async () => {
    const res = await runBackfill({ role });
    expect(res.statusCode).toBe(200);
    // Both un-invited supporters were sent (the email client stubs in dev) + stamped ⇒ sent: 2.
    expect(res.body).toEqual({ pending: 2, sent: 2, failed: 0 });

    // Each supporter was stamped invited (one UPDATE ... invited_at per supporter).
    const stamps = queryMock.mock.calls.filter((c) => /update business_supporter_fulfilment/i.test(String(c[0])));
    expect(stamps).toHaveLength(2);

    // Exactly one summary audit row, actor = the acting admin, action = fulfilment.backfill_invites.
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1][0]).toBe("admin:kenny@nbcc.test"); // actor
    expect(audits[0][1][1]).toBe("fulfilment.backfill_invites"); // action
    expect(audits[0][1][2]).toBe("business_supporter_fulfilment"); // entity
  });
});

describe("idempotent second run (nobody left un-invited)", () => {
  it("sends 0 when the un-invited list is empty", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/from business_supporter_fulfilment/i.test(sql) && /invited_at is null/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await runBackfill({ role: "editor" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pending: 0, sent: 0, failed: 0 });
    // No supporter was stamped, but the (empty) run is still audited.
    expect(queryMock.mock.calls.filter((c) => /update business_supporter_fulfilment/i.test(String(c[0])))).toHaveLength(0);
    expect(auditInserts()).toHaveLength(1);
  });
});
