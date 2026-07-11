import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-114 (REQ-066): the admin dashboard read lists — browse donations, list claim batches, read
// the audit trail, list subscription dunning, and export a claim batch as Charities Online CSV.
// Reads are Viewer and up; the CSV export is a claims op (Editor and up). Auth + role gating and the
// pure page-clamp are covered here DB-free (pool + config mocked); end-to-end shape is in
// features/admin-api.feature.

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
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { clampPage } from "../../src/db/admin";
import {
  getAdminDonations,
  getAdminClaimBatches,
  getAdminClaimBatchExport,
  getAdminAuditLog,
  getAdminDunning,
} from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

// authorizeSection re-loads the caller's row fresh (getUserAuthRowMock) rather than trusting the
// token's role claim; tokenFor keeps that row's role in sync so every `role: "viewer"/"editor"`
// case here drives the same effective section+level access as before Phase 2 (role->permissions
// fallback, src/admin/permissions.ts).
const tokenFor = (role: string) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@nbcc", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: "staff@nbcc", role, now: new Date(), secret: "test-admin-secret" }).token;
};

function mockRes() {
  const res: Record<string, unknown> & { statusCode: number; body: unknown; contentType: string } = {
    statusCode: 0,
    body: undefined,
    contentType: "",
  };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.type = (t: string) => ((res.contentType = t), res);
  res.set = () => res;
  res.send = (b: unknown) => ((res.body = b), res);
  return res as never;
}

function req(role: string | null, query: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
  return {
    headers: role ? { authorization: `Bearer ${tokenFor(role)}` } : {},
    query,
    params,
  } as never;
}

beforeEach(() => {
  queryMock.mockReset();
  getUserAuthRowMock.mockReset();
});

describe("clampPage (TASK-114)", () => {
  it("defaults limit 50 / offset 0", () => {
    expect(clampPage()).toEqual({ limit: 50, offset: 0 });
  });
  it("caps limit at 100 and passes a valid offset", () => {
    expect(clampPage(500, 10)).toEqual({ limit: 100, offset: 10 });
  });
  it("rejects non-positive / non-integer inputs back to the defaults", () => {
    expect(clampPage(-1, -5)).toEqual({ limit: 50, offset: 0 });
    expect(clampPage(20.5, 3.2)).toEqual({ limit: 50, offset: 0 });
  });
  it("keeps a valid in-range window", () => {
    expect(clampPage(20, 40)).toEqual({ limit: 20, offset: 40 });
  });
});

describe("admin read endpoints — auth + role gating (TASK-114)", () => {
  it("rejects a missing token with 401 (donations)", async () => {
    const res = mockRes() as unknown as { statusCode: number };
    await getAdminDonations(req(null), res as never);
    expect(res.statusCode).toBe(401);
  });

  it("lets a Viewer browse donations (200 with results + total)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 2 }] }); // total count
    queryMock.mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 1 }] }); // the page
    const res = mockRes() as unknown as { statusCode: number; body: { total: number; results: unknown[] } };
    await getAdminDonations(req("viewer", { status: "eligible" }), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.results).toHaveLength(2);
  });

  it("lets a Viewer read claim batches, audit and dunning", async () => {
    for (const handler of [getAdminClaimBatches, getAdminAuditLog, getAdminDunning]) {
      queryMock.mockResolvedValue({ rows: [{ count: 0 }] });
      const res = mockRes() as unknown as { statusCode: number };
      await handler(req("viewer"), res as never);
      expect(res.statusCode).toBe(200);
    }
  });

  it("gates the CSV export to Editor and up (Viewer -> 403, no DB touched)", async () => {
    const res = mockRes() as unknown as { statusCode: number };
    await getAdminClaimBatchExport(req("viewer", {}, { id: "5" }), res as never);
    expect(res.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("400s an invalid claim-batch id on export", async () => {
    const res = mockRes() as unknown as { statusCode: number };
    await getAdminClaimBatchExport(req("editor", {}, { id: "abc" }), res as never);
    expect(res.statusCode).toBe(400);
  });

  // Admin management Phase 2 (TASK-186): authorizeSection re-loads the caller's row fresh, so a
  // disabled account's still-valid token stops working on the very next request.
  it("401s (generic) a disabled user's otherwise-valid token", async () => {
    const token = tokenFor("admin");
    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@nbcc", status: "disabled", role: "admin", permissions: {} });
    const res = mockRes() as unknown as { statusCode: number; body: unknown };
    await getAdminDonations({ headers: { authorization: `Bearer ${token}` }, query: {}, params: {} } as never, res as never);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });
});
