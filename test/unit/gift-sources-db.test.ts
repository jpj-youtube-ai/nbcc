import { describe, it, expect, vi, beforeEach } from "vitest";

// Fill a Red Bag against the Donate page, at the database's edge: the one grouped read behind the
// totals, the list's source field and its filter. DB-free: the pool is mocked and the SQL is read.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listDonations, searchDonations } from "../../src/db/admin";
import { sumGiftsBySource } from "../../src/db/overview-numbers";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
});

const call = (i = 0) => {
  const [sql, params] = queryMock.mock.calls[i];
  return { sql: String(sql).replace(/\s+/g, " "), params: params as unknown[] };
};
const MONTH = { from: "2026-10-01", until: "2026-10-05T09:30:00.000Z" };

describe("the totals: one grouped read", () => {
  it("asks once, with the month and the source as parameters", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(call().params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z", "red_bag"]);
    expect(call().sql).toMatch(/GROUP BY 1/);
    // The source is a parameter, never written into the SQL itself.
    expect(call().sql).not.toMatch(/red_bag/);
  });

  it("counts money as the Overview does: paid gifts, less refunds, the gift alone", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql } = call();
    expect(sql).toMatch(/payment_status = 'paid'/);
    expect(sql).toMatch(/SUM\(GREATEST\(amount_pence - refunded_amount_pence, 0\)\)/);
    // The card fee top up and Gift Aid are separate columns, and neither is added in.
    expect(sql).not.toMatch(/fee_cover_pence|gift_aid/);
  });

  it("uses the Overview's own month: UK days from the 1st, up to now", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    expect(call().sql).toMatch(
      /FILTER \(WHERE \(created_at AT TIME ZONE 'Europe\/London'\)::date >= \$1::date AND created_at <= \$2::timestamptz\)/,
    );
  });

  it("puts a gift in Fill a Red Bag by its source, and in the Donate page only when it is an online gift with no source and no fundraiser's page", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql } = call();
    expect(sql).toMatch(/CASE WHEN source = \$3 THEN 'redBag' ELSE 'donatePage' END/);
    expect(sql).toMatch(/\(source = \$3 OR \(source IS NULL AND payment_channel = 'online' AND fundraiser_id IS NULL\)\)/);
  });

  it("does not count a gift that was refunded in full", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    expect(call().sql).toMatch(/amount_pence > refunded_amount_pence/);
  });

  it("hands back both buckets, a real zero where there were no gifts", async () => {
    queryMock.mockResolvedValue({
      rows: [{ bucket: "redBag", month_pence: "2500", month_gifts: "2", all_pence: "4000", all_gifts: "3" }],
    });
    expect(await sumGiftsBySource(MONTH)).toEqual({
      redBag: { month: { pence: 2500, gifts: 2 }, all: { pence: 4000, gifts: 3 } },
      donatePage: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
    });
  });

  it("lets a failure through, so nobody is shown a zero for it", async () => {
    queryMock.mockRejectedValue(new Error("down"));
    await expect(sumGiftsBySource(MONTH)).rejects.toThrow("down");
  });
});

describe("the donations list says where each gift was started", () => {
  it("selects the source for each row, and changes nothing else about the page", async () => {
    await listDonations({});
    const { sql } = call(1);
    expect(sql).toMatch(/d\.declaration_status, d\.created_at, d\.source FROM donations d/);
    expect(sql).toMatch(/ORDER BY d\.id DESC LIMIT 50 OFFSET 0/);
  });

  it("selects the source in donation search results too", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await searchDonations("ada");
    expect(call().sql).toMatch(/d\.payment_channel, d\.created_at, d\.source FROM donations d/);
  });
});

describe("the Fill a Red Bag only filter", () => {
  it("narrows both the count and the page to that source, as a parameter", async () => {
    await listDonations({ source: "red_bag" });
    for (const i of [0, 1]) {
      expect(call(i).sql).toMatch(/d\.source = \$1/);
      expect(call(i).params).toEqual(["red_bag"]);
    }
  });

  it("returns everything when no source is asked for", async () => {
    await listDonations({});
    expect(call().sql).not.toMatch(/d\.source =/);
  });

  // As with ?mode (TASK-446): junk reads as "no filter". Passed on, it would return an empty list
  // that looks like there are no donations at all.
  it.each(["", "donate", "RED_BAG", "red_bag' OR '1'='1", "1"])("ignores a source that is not on the list: %j", async (junk) => {
    await listDonations({ source: junk });
    expect(call().sql).not.toMatch(/d\.source =/);
    expect(call().params).toEqual([]);
  });

  it("combines with the payment status and type filters, each placeholder on its own value", async () => {
    await listDonations({ paymentStatus: "paid", mode: "monthly", source: "red_bag" });
    const { sql, params } = call();
    expect(params).toEqual(["paid", "monthly", "red_bag"]);
    expect(sql).toMatch(/d\.payment_status = \$1/);
    expect(sql).toMatch(/d\.mode = \$2/);
    expect(sql).toMatch(/d\.source = \$3/);
  });
});
