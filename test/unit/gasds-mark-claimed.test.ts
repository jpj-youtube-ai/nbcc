import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-138: POST /api/admin/queues/gasds-deadline/mark-claimed stamps gasds_claimed_at on the given
// GASDS-eligible donations (Editor+) so the deadline queue stops surfacing them. Pool + config mocked.

const { queryMock, clientQueryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, clientQueryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { postAdminMarkGasdsClaimed } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const tokenFor = (role: string) =>
  signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: "test-admin-secret" }).token;

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockRes = () => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
};
const req = (o: { role?: string; token?: string; body?: unknown }) => {
  const headers: Record<string, string> = {};
  const token = o.token !== undefined ? o.token : o.role ? tokenFor(o.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, body: o.body ?? {} };
};
const run = async (o: any) => { const res = mockRes(); await postAdminMarkGasdsClaimed(req(o) as any, res as any); return res; };

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  connect.mockClear();
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/update donations/i.test(sql)) return { rows: [{ id: 5 }, { id: 6 }], rowCount: 2 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

describe("POST /api/admin/queues/gasds-deadline/mark-claimed (TASK-138)", () => {
  it("stamps the gifts claimed for an editor and returns the count", async () => {
    const res = await run({ role: "editor", body: { donationIds: [5, 6] } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ claimed: 2, claimedIds: [5, 6] });
    const sqls = clientQueryMock.mock.calls.map((c) => String(c[0]));
    const update = clientQueryMock.mock.calls.find((c) => /update donations/i.test(String(c[0])));
    expect(String(update?.[0])).toMatch(/gasds_claimed_at\s*=\s*now\(\)/i);
    expect(String(update?.[0])).toMatch(/gasds_eligible\s*=\s*true/i);
    expect(String(update?.[0])).toMatch(/gasds_claimed_at is null/i);
    const actions = clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => (c[1] as any[])[1]);
    expect(actions).toContain("gasds.claimed");
    expect(sqls.some((s) => /^commit/i.test(s))).toBe(true);
  });

  it("403s a viewer", async () => {
    const res = await run({ role: "viewer", body: { donationIds: [5] } });
    expect(res.statusCode).toBe(403);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s on an empty id list", async () => {
    const res = await run({ role: "editor", body: { donationIds: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await run({ token: "", body: { donationIds: [5] } });
    expect(res.statusCode).toBe(401);
  });
});
