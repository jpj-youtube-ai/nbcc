import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-447: the individuals who give every month.
//
// Businesses have had a screen of their own since TASK-208. The people quietly paying £10 a month
// had nothing, and were findable only by paging the whole donations list — which is how three of
// them went four months without a thank-you and nobody noticed (TASK-430).

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listMonthlySupporters } from "../../src/db/monthly-supporters";

const row = (over: Record<string, unknown> = {}) => ({
  donor_id: 16,
  full_name: "Fiona McIlloney",
  email: "fionamcilloney@btinternet.com",
  monthly_pence: 1000,
  first_paid_at: new Date("2026-05-21T10:00:00Z"),
  most_recent_paid_at: new Date("2026-09-19T10:00:00Z"),
  payment_count: 5,
  total_pence: 5000,
  gift_aid: false,
  state: "active",
  cancelled_at: null,
  lapsed_at: null,
  failed_attempts: 0,
  thanked_at: new Date("2026-09-29T12:00:00Z"),
  ...over,
});

beforeEach(() => queryMock.mockReset());

describe("who appears", () => {
  it("asks only for individuals, because businesses have their own screen", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listMonthlySupporters();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/dn\.donor_type = 'individual'/);
  });

  it("counts only paid monthly gifts", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listMonthlySupporters();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/mode = 'monthly'/);
    expect(sql).toMatch(/payment_status = 'paid'/);
  });

  // A donor who asked to stay anonymous still belongs here: the charity's own record of its
  // regular income is not a public listing, and leaving them out would understate it.
  it("does not exclude anonymous donors", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listMonthlySupporters();
    expect(String(queryMock.mock.calls[0][0])).not.toMatch(/anonymous/);
  });
});

describe("what it reports", () => {
  it("gives the amount they pay now and the total they have given", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row()], rowCount: 1 });
    const [s] = await listMonthlySupporters();
    expect(s.monthlyPence).toBe(1000);
    expect(s.totalPence).toBe(5000);
    expect(s.paymentCount).toBe(5);
  });

  // The monthly figure is the LATEST paid gift, not an average: somebody who moved from £5 to £20
  // gives £20, and £12.50 would be true of nothing.
  it("takes the monthly figure from the most recent gift, not an average", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listMonthlySupporters();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/ORDER BY created_at DESC\s+LIMIT 1/);
  });

  it("says when they started, so 'giving since' is a fact rather than when we noticed", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row()], rowCount: 1 });
    expect((await listMonthlySupporters())[0].firstPaidAt).toBe("2026-05-21T10:00:00.000Z");
  });

  it("says whether they have been thanked", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row({ thanked_at: null })], rowCount: 1 });
    expect((await listMonthlySupporters())[0].thankedAt).toBeNull();
  });
});

describe("what state they are in", () => {
  it("reports a healthy subscription as active", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row()], rowCount: 1 });
    expect((await listMonthlySupporters())[0].state).toBe("active");
  });

  it("reports a failing card", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row({ state: "past_due", failed_attempts: 2 })], rowCount: 1 });
    const [s] = await listMonthlySupporters();
    expect(s.state).toBe("past_due");
    expect(s.failedAttempts).toBe(2);
  });

  // THE one worth pinning. Stripe keeps a cancelled subscription 'active' until its paid period
  // ends, so the status column alone would call somebody who has left a current supporter — on the
  // one screen that exists to say how much income is dependable.
  it("calls a cancelled subscription cancelled, whatever the status column says", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [row({ state: "active", cancelled_at: new Date("2026-09-01T00:00:00Z") })],
      rowCount: 1,
    });
    const [s] = await listMonthlySupporters();
    expect(s.state).toBe("cancelled");
    expect(s.cancelledAt).toBe("2026-09-01T00:00:00.000Z");
  });

  // A hand-imported supporter has no dunning row. That is not a fault, and reporting it as one
  // would send somebody looking for a problem that is not there.
  it("does not treat a missing dunning row as a problem", async () => {
    queryMock.mockResolvedValueOnce({ rows: [row({ state: null, failed_attempts: null })], rowCount: 1 });
    const [s] = await listMonthlySupporters();
    expect(s.state).toBe("unknown");
    expect(s.failedAttempts).toBe(0);
  });
});
