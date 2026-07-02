import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-078 (REQ-050/REQ-058): the GASDS pool DB read. Proven DB-free by mocking the pool
// (the mock-the-boundary approach of donations-batch.test.ts): the two sums are read by
// SEPARATE queries and the remaining headroom is the pure gasdsPoolLimitPence over them, so
// the pool total is reported INDEPENDENTLY of the Gift Aid claim total it also reads.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { getGasdsPoolReport } from "../../src/gasds/pool";
import { gasdsPoolLimitPence } from "../../src/gasds/caps";

// Route each sum query to its own stubbed total by matching the WHERE clause.
function installSums(gasdsTotal: number, giftAidTotal: number) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/gasds_eligible = true/i.test(sql)) return { rows: [{ total: gasdsTotal }] };
    if (/gift_aid = true/i.test(sql)) return { rows: [{ total: giftAidTotal }] };
    return { rows: [{ total: 0 }] };
  });
}

beforeEach(() => queryMock.mockReset());

describe("getGasdsPoolReport", () => {
  it("reports the year's GASDS pool total and remaining headroom, read via two separate queries", async () => {
    installSums(120_000, 30_000); // £1,200 pooled small donations; £300 Gift Aid claimed

    const report = await getGasdsPoolReport(2026);

    expect(report.year).toBe(2026);
    expect(report.gasdsPoolTotalPence).toBe(120_000);
    expect(report.giftAidClaimedPence).toBe(30_000);
    // Two independent SELECTs — the pool total is never conflated with the Gift Aid total.
    expect(queryMock).toHaveBeenCalledTimes(2);
    const clauses = queryMock.mock.calls.map((c) => String(c[0]));
    expect(clauses.some((s) => /gasds_eligible = true/.test(s))).toBe(true);
    expect(clauses.some((s) => /gift_aid = true/.test(s))).toBe(true);
    // Both queries are scoped to the requested year.
    for (const c of queryMock.mock.calls) expect(c[1]).toEqual([2026]);

    // Remaining headroom is exactly the pure calculator over the two independent sums.
    expect(report.remainingHeadroomPence).toBe(
      gasdsPoolLimitPence({
        smallDonationsClaimedPenceThisYear: 120_000,
        giftAidClaimedPenceThisYear: 30_000,
      }),
    );
  });

  it("lets the 10× Gift Aid cap bind the headroom below the £8,000/£2,000 ceilings", async () => {
    installSums(0, 15_000); // no pool used yet; £150 Gift Aid claimed → 10× = £1,500 binds
    const report = await getGasdsPoolReport(2026);
    expect(report.remainingHeadroomPence).toBe(150_000);
  });

  it("coerces bigint-style SUM strings and treats an empty year as zero", async () => {
    installSums("0", "0");
    const report = await getGasdsPoolReport(2026);
    expect(report.gasdsPoolTotalPence).toBe(0);
    expect(report.giftAidClaimedPence).toBe(0);
  });
});
