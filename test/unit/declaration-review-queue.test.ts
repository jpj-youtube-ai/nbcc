import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-136: GET /api/admin/queues/declaration-review lists active enduring/monthly declarations HMRC
// recommends re-confirming (made over ~2 years ago). Read-only (Viewer+). Pool + config mocked.

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

import { getAdminDeclarationReview } from "../../src/routes/admin";
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

describe("GET /api/admin/queues/declaration-review (TASK-136)", () => {
  it("lists an active enduring declaration due review, with reviewDueSince = created + 2y", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 8, donor_id: 42, first_name: "Ada", last_name: "Lovelace", created_at: new Date("2021-01-10T00:00:00Z") }],
      rowCount: 1,
    });
    const res = mockRes();
    await getAdminDeclarationReview(req(true) as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ id: 8, donor_id: 42, first_name: "Ada" });
    expect(res.body.results[0].reviewDueSince).toBe(new Date("2023-01-10T00:00:00Z").toISOString());
    // The query filters active enduring declarations older than the 2-year cutoff.
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/revoked_at is null/i);
    expect(sql).toMatch(/scope\s*=\s*'all_donations'/i);
    expect(sql).toMatch(/created_at\s*<=\s*\$1/i);
    // The cutoff param is ~2 years before now.
    const cutoff = new Date(queryMock.mock.calls[0][1][0] as Date);
    expect(cutoff.getUTCFullYear()).toBeLessThanOrEqual(new Date().getUTCFullYear() - 2);
  });

  it("401s without a token", async () => {
    const res = mockRes();
    await getAdminDeclarationReview(req(false) as any, res as any);
    expect(res.statusCode).toBe(401);
  });
});
