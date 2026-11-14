import { describe, it, expect, vi, beforeEach } from "vitest";

// The server side of the Giving refresh (docs/superpowers/specs/2026-11-14-admin-refresh-giving.md):
// the donations inside a claim batch, the donor behind a donation that is ready to claim, every small
// donation not yet claimed (not only those near the deadline), what was marked claimed lately and its
// undo, and what a monthly giver gives and since when. Pool and config are mocked; the admin token is
// real. Every name, address and figure is invented.

const { queryMock, clientQueryMock, connect, getUserAuthRowMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const getUserAuthRowMock = vi.fn();
  return { queryMock, clientQueryMock, connect, getUserAuthRowMock };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
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

import {
  getAdminEligibleForClaim,
  getAdminClaimBatchDonations,
  getAdminGasdsDeadline,
  getAdminGasdsClaimed,
  postAdminUnmarkGasdsClaimed,
  getAdminDunning,
} from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const tokenFor = (role: string) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "fern@example.com", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: "fern@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockRes = () => {
  const res: any = { statusCode: 0, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
};
const req = (o: { role?: string; token?: string; body?: unknown; id?: string; query?: Record<string, string> }) => {
  const headers: Record<string, string> = {};
  const token = o.token !== undefined ? o.token : o.role ? tokenFor(o.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, body: o.body ?? {}, params: { id: o.id ?? "7" }, query: o.query ?? {} };
};
const run = async (handler: (rq: any, rs: any) => Promise<unknown>, o: Parameters<typeof req>[0]) => {
  const res = mockRes();
  await handler(req(o) as any, res as any);
  return res;
};
const sqlOf = (mock: typeof queryMock, n = 0) => String(mock.mock.calls[n][0]);

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  connect.mockClear();
  getUserAuthRowMock.mockReset();
});

describe("GET /api/admin/claims/eligible carries the donor", () => {
  it("reads each donation's donor id, so the screen can open the donor", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 5, donor_id: 42, donor_name: "Rowan Example", amount_pence: 2500, postcode: "KA1 1AA", created_at: new Date(0) }],
      rowCount: 1,
    });
    const res = await run(getAdminEligibleForClaim, { role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results[0].donor_id).toBe(42);
    expect(sqlOf(queryMock)).toContain("d.donor_id");
  });
});

describe("GET /api/admin/claim-batches/:id/donations", () => {
  it("lists the donations in the batch for someone who may view Claims", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 31, donor_id: 42, donor_name: "Rowan Example", amount_pence: 2500, refunded_amount_pence: 0, postcode: "KA1 1AA", created_at: new Date(0), claim_status: "batched" },
      ],
      rowCount: 1,
    });
    const res = await run(getAdminClaimBatchDonations, { role: "viewer", id: "7" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({ id: 31, donor_id: 42, donor_name: "Rowan Example", amount_pence: 2500 });
    const sql = sqlOf(queryMock);
    expect(sql).toContain("claim_batch_id = $1");
    expect(queryMock.mock.calls[0][1]).toEqual([7]);
  });

  it("changes nothing: it is one read and never opens a transaction", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await run(getAdminClaimBatchDonations, { role: "viewer", id: "7" });
    expect(connect).not.toHaveBeenCalled();
    expect(sqlOf(queryMock).trim().toLowerCase().startsWith("select")).toBe(true);
  });

  it("401s without a token", async () => {
    expect((await run(getAdminClaimBatchDonations, { token: "" })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("400s a batch id that is not a whole number", async () => {
    expect((await run(getAdminClaimBatchDonations, { role: "viewer", id: "abc" })).statusCode).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("says it could not, as an error, when the read fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("db down"));
    const res = await run(getAdminClaimBatchDonations, { role: "viewer", id: "7" });
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBeTruthy();
  });
});

describe("GET /api/admin/queues/gasds-deadline?all=1", () => {
  const far = { id: 6, donor_id: 42, full_name: "Card reader", amount_pence: 2000, created_at: new Date("2099-05-01T00:00:00Z") };
  const old = { id: 5, donor_id: 42, full_name: "Card reader", amount_pence: 1500, created_at: new Date("2019-05-01T00:00:00Z") };

  it("still leaves out a small donation whose deadline is far off when not asked for all", async () => {
    queryMock.mockResolvedValueOnce({ rows: [old, far], rowCount: 2 });
    const res = await run(getAdminGasdsDeadline, { role: "viewer" });
    expect(res.body.results.map((r: any) => r.id)).toEqual([5]);
  });

  it("lists every small donation not yet claimed when asked for all, the far off ones flagged later", async () => {
    queryMock.mockResolvedValueOnce({ rows: [old, far], rowCount: 2 });
    const res = await run(getAdminGasdsDeadline, { role: "viewer", query: { all: "1" } });
    expect(res.statusCode).toBe(200);
    expect(res.body.results.map((r: any) => [r.id, r.flag])).toEqual([[5, "expired"], [6, "later"]]);
    expect(res.body.results[1].gasdsDeadline).toBe(new Date(Date.UTC(2102, 3, 5)).toISOString());
  });
});

describe("POST /api/admin/queues/gasds-deadline/unmark-claimed", () => {
  beforeEach(() => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/update donations/i.test(sql)) return { rows: [{ id: 5 }, { id: 6 }], rowCount: 2 };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 0 };
    });
  });

  it("clears the mark for an editor, only on donations that carry one, and says how many", async () => {
    const res = await run(postAdminUnmarkGasdsClaimed, { role: "editor", body: { donationIds: [5, 6] } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ unclaimed: 2, unclaimedIds: [5, 6] });
    const update = clientQueryMock.mock.calls.find((c) => /update donations/i.test(String(c[0])));
    const sql = String(update?.[0]).toLowerCase();
    expect(sql).toContain("gasds_claimed_at = null");
    expect(sql).toContain("gasds_claimed_at is not null");
    expect(sql).toContain("gasds_eligible = true");
    expect(update?.[1]).toEqual([[5, 6]]);
  });

  it("writes its own audit row, in the same transaction", async () => {
    await run(postAdminUnmarkGasdsClaimed, { role: "editor", body: { donationIds: [5, 6] } });
    const audit = clientQueryMock.mock.calls.find((c) => /insert into audit_log/i.test(String(c[0])));
    const params = audit?.[1] as any[];
    expect(params[0]).toBe("admin:fern@example.com");
    expect(params[1]).toBe("gasds.unclaimed");
    expect(params[2]).toBe("donation");
    expect(params[4]).toEqual({ donationIds: [5, 6] });
    const order = clientQueryMock.mock.calls.map((c) => String(c[0]).trim().split(/\s+/)[0].toUpperCase());
    expect(order[0]).toBe("BEGIN");
    expect(order[order.length - 1]).toBe("COMMIT");
  });

  it("403s someone who may only look", async () => {
    const res = await run(postAdminUnmarkGasdsClaimed, { role: "viewer", body: { donationIds: [5] } });
    expect(res.statusCode).toBe(403);
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("400s an empty list", async () => {
    expect((await run(postAdminUnmarkGasdsClaimed, { role: "editor", body: { donationIds: [] } })).statusCode).toBe(400);
  });

  it("401s without a token", async () => {
    expect((await run(postAdminUnmarkGasdsClaimed, { token: "", body: { donationIds: [5] } })).statusCode).toBe(401);
  });
});

describe("GET /api/admin/queues/gasds-claimed", () => {
  const markedAt = new Date("2026-11-03T10:15:00.000Z");

  it("lists the latest marks: who, when, how many and how much, and which are still marked by that mark", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 900, actor: "admin:fern@example.com", created_at: markedAt, data: { donationIds: [5, 6, 7] } }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 5, amount_pence: 1500, gasds_claimed_at: markedAt },
          // Undone since: no mark at all.
          { id: 6, amount_pence: 2000, gasds_claimed_at: null },
          // Undone, then marked again by a later mark: not this one's to undo.
          { id: 7, amount_pence: 500, gasds_claimed_at: new Date("2026-11-09T09:00:00.000Z") },
        ],
        rowCount: 3,
      });
    const res = await run(getAdminGasdsClaimed, { role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results).toEqual([
      {
        auditId: 900,
        actor: "admin:fern@example.com",
        at: markedAt.toISOString(),
        donationIds: [5, 6, 7],
        count: 3,
        totalPence: 4000,
        stillClaimedIds: [5],
      },
    ]);
    const first = sqlOf(queryMock, 0).toLowerCase();
    expect(first).toContain("from audit_log");
    expect(first).toContain("gasds.claimed");
    expect(first).toContain("limit 20");
    expect(queryMock.mock.calls[1][1]).toEqual([[5, 6, 7]]);
  });

  it("answers an empty list, and asks nothing about donations, when nothing has been marked", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const res = await run(getAdminGasdsClaimed, { role: "viewer" });
    expect(res.body.results).toEqual([]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("copes with an audit row whose data is not a list of ids", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ id: 901, actor: "admin:fern@example.com", created_at: markedAt, data: {} }], rowCount: 1 });
    const res = await run(getAdminGasdsClaimed, { role: "viewer" });
    expect(res.body.results[0]).toMatchObject({ auditId: 901, count: 0, totalPence: 0, donationIds: [], stillClaimedIds: [] });
  });

  it("401s without a token", async () => {
    expect((await run(getAdminGasdsClaimed, { token: "" })).statusCode).toBe(401);
  });
});

describe("GET /api/admin/subscriptions/dunning says what they give, since when, and a number to ring", () => {
  it("reads the latest and first paid charge of the subscription, and a business supporter's phone", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: 3, donor_id: 42, donor_name: "Rowan Example", donor_email: "rowan@example.com", stripe_subscription_id: "sub_invented",
        status: "past_due", failed_attempts: 2, lapsed_at: null, cancelled_at: null, updated_at: new Date(0),
        monthly_pence: 1000, first_paid_at: new Date("2024-03-04T00:00:00Z"), phone: "01632 960123",
      }],
      rowCount: 1,
    });
    const res = await run(getAdminDunning, { role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results[0]).toMatchObject({ monthly_pence: 1000, phone: "01632 960123" });
    const sql = sqlOf(queryMock).toLowerCase();
    expect(sql).toContain("monthly_pence");
    expect(sql).toContain("first_paid_at");
    expect(sql).toContain("payment_status = 'paid'");
    expect(sql).toContain("business_supporter_fulfilment");
  });
});
