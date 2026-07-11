import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-135: GET /api/admin/queues/gasds-deadline lists GASDS-eligible small donations approaching or
// past the 2-year claim cliff. Read-only (Viewer+). Pool + config mocked; admin token real.

const { queryMock, getUserAuthRowMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getUserAuthRowMock: vi.fn(), // authorizeSection's fresh per-request DB row (Admin Phase 2)
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
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

import { getAdminGasdsDeadline } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

// authorizeSection loads this fresh per request (Admin Phase 2) instead of trusting the token's
// role claim; a viewer role falls back to view-everywhere-except-team permissions.
getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kenny@nbcc.test", status: "active", role: "viewer", permissions: {} });
const token = signAdminSession({ sub: 1, email: "kenny@nbcc.test", role: "viewer", now: new Date(), secret: "test-admin-secret" }).token;

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockRes = () => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
};
const req = (withToken: boolean) => ({
  headers: withToken ? { authorization: `Bearer ${token}` } : {},
  params: {},
});

beforeEach(() => queryMock.mockReset());

describe("GET /api/admin/queues/gasds-deadline (TASK-135)", () => {
  it("lists a GASDS-eligible small donation past its 2-year cliff as expired", async () => {
    // Collected 2019-05-01 → tax year ends 2020-04-05 → deadline 2022-04-05 → long expired.
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 5, donor_id: 42, full_name: "Ada Small", amount_pence: 2000, created_at: new Date("2019-05-01T00:00:00Z") }],
      rowCount: 1,
    });
    const res = mockRes();
    await getAdminGasdsDeadline(req(true) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ id: 5, donor_id: 42, full_name: "Ada Small", flag: "expired" });
    expect(res.body.results[0].gasdsDeadline).toBe(new Date(Date.UTC(2022, 3, 5)).toISOString());
    // The query only reads gasds_eligible, paid donations.
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/gasds_eligible\s*=\s*true/i);
    expect(sql).toMatch(/payment_status\s*=\s*'paid'/i);
  });

  it("omits a small donation whose deadline is beyond the horizon", async () => {
    // Collected 2099 → deadline far in the future → not a queue item.
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 6, donor_id: 42, full_name: "Ada Small", amount_pence: 2000, created_at: new Date("2099-05-01T00:00:00Z") }],
      rowCount: 1,
    });
    const res = mockRes();
    await getAdminGasdsDeadline(req(true) as any, res as any);
    expect(res.body.results).toHaveLength(0);
  });

  it("401s without a token", async () => {
    const res = mockRes();
    await getAdminGasdsDeadline(req(false) as any, res as any);
    expect(res.statusCode).toBe(401);
  });
});
