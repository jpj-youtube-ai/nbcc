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
  it("reads the gifts in one grouped read, with the month and the source as parameters", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    // The second read is the Elf Detective School's payments, the third every monthly payment, the
    // fourth fundraiser pages and the card reader, the fifth uniform payments (below).
    expect(queryMock).toHaveBeenCalledTimes(5);
    expect(call().params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z", "red_bag", "ball", "ball_bags", "invoice"]);
    expect(call().sql).toMatch(/GROUP BY 1/);
    // The source is a parameter, never written into the SQL itself.
    expect(call().sql).not.toMatch(/red_bag/);
    expect(call().sql).not.toMatch(/source (=|IN) \(?'/);
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

  it("puts a gift in Fill a Red Bag, the Festive Ball or the Ball's table bags by its source, and in the Donate page only when it is an online gift with no source and no fundraiser's page", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql } = call();
    expect(sql).toContain("CASE WHEN source = $3 THEN 'redBag' WHEN source = $4 THEN 'ball' WHEN source = $5 THEN 'ballBags' WHEN source = $6 THEN 'invoices' ELSE 'donatePage' END");
    expect(sql).toContain("(source IN ($3, $4, $5, $6) OR (source IS NULL AND payment_channel = 'online' AND fundraiser_id IS NULL))");
  });

  it("counts a table bag gift in its own bucket, not the Festive Ball's or the Donate page's", async () => {
    queryMock.mockResolvedValue({
      rows: [{ bucket: "ballBags", month_pence: "10000", month_gifts: "2", all_pence: "15000", all_gifts: "3" }],
    });
    expect(await sumGiftsBySource(MONTH)).toEqual({
      redBag: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      ball: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      ballBags: { month: { pence: 10_000, gifts: 2 }, all: { pence: 15_000, gifts: 3 } },
      invoices: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      elfSchool: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      donatePage: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      fundraiser: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      cardReader: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      monthly: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      uniform: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
    });
  });

  it("does not count a gift that was refunded in full", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    expect(call().sql).toMatch(/amount_pence > refunded_amount_pence/);
  });

  it("hands back every bucket, a real zero where there were no gifts", async () => {
    queryMock.mockResolvedValue({
      rows: [{ bucket: "redBag", month_pence: "2500", month_gifts: "2", all_pence: "4000", all_gifts: "3" }],
    });
    expect(await sumGiftsBySource(MONTH)).toEqual({
      redBag: { month: { pence: 2500, gifts: 2 }, all: { pence: 4000, gifts: 3 } },
      ball: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      ballBags: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      invoices: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      elfSchool: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      donatePage: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      fundraiser: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      cardReader: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      monthly: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
      uniform: { month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } },
    });
  });

  it("lets a failure through, so nobody is shown a zero for it", async () => {
    queryMock.mockRejectedValue(new Error("down"));
    await expect(sumGiftsBySource(MONTH)).rejects.toThrow("down");
  });

  it("reads the Elf Detective School's payments beside the gifts: paid orders of families not removed, entry plus gift, by when each was paid", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql, params } = call(1);
    expect(params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z"]);
    expect(sql).toContain("SELECT 'elfSchool' AS bucket");
    expect(sql).toContain("FROM elf_orders o JOIN elf_families f ON f.id = o.family_id");
    expect(sql).toContain("o.status = 'paid' AND f.active AND f.removed_at IS NULL");
    expect(sql).toContain("SUM(o.entry_pence + o.donation_pence)");
    expect(sql).toContain("(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date >= $1::date");
    // The card fee top up is not money raised.
    expect(sql).not.toMatch(/fee_cover_pence/);
  });

  it("puts the Elf Detective School's payments in a bucket of their own", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ bucket: "elfSchool", month_pence: "148600", month_gifts: "128", all_pence: "148600", all_gifts: "128" }],
    });
    const t = await sumGiftsBySource(MONTH);
    expect(t.elfSchool).toEqual({ month: { pence: 148_600, gifts: 128 }, all: { pence: 148_600, gifts: 128 } });
    expect(t.donatePage).toEqual({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
  });

  it("reads every paid monthly payment beside the places, wherever it was set up, less refunds, by this month", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql, params } = call(2);
    expect(params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z"]);
    expect(sql).toContain("SELECT 'monthly' AS bucket");
    expect(sql).toContain("SUM(GREATEST(amount_pence - refunded_amount_pence, 0)) FILTER (WHERE (created_at AT TIME ZONE 'Europe/London')::date >= $1::date AND created_at <= $2::timestamptz)");
    expect(sql).toContain("WHERE payment_status = 'paid' AND amount_pence > refunded_amount_pence AND mode = 'monthly'");
    expect(sql).not.toMatch(/source|fee_cover_pence|gift_aid/);
  });

  it("puts monthly payments in a bucket of their own, beside their places", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ bucket: "redBag", month_pence: "1000", month_gifts: "1", all_pence: "1000", all_gifts: "1" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ bucket: "monthly", month_pence: "1000", month_gifts: "1", all_pence: "5000", all_gifts: "5" }] });
    const t = await sumGiftsBySource(MONTH);
    expect(t.monthly).toEqual({ month: { pence: 1000, gifts: 1 }, all: { pence: 5000, gifts: 5 } });
    expect(t.redBag).toEqual({ month: { pence: 1000, gifts: 1 }, all: { pence: 1000, gifts: 1 } });
  });

  it("reads card reader gifts and fundraiser page gifts beside the places, paid, less refunds, by this month", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql, params } = call(3);
    expect(params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z"]);
    expect(sql).toContain("CASE WHEN payment_channel = 'in_person' THEN 'cardReader' ELSE 'fundraiser' END AS bucket");
    expect(sql).toContain("SUM(GREATEST(amount_pence - refunded_amount_pence, 0)) FILTER (WHERE (created_at AT TIME ZONE 'Europe/London')::date >= $1::date AND created_at <= $2::timestamptz)");
    expect(sql).toContain("WHERE payment_status = 'paid' AND amount_pence > refunded_amount_pence AND (payment_channel = 'in_person' OR fundraiser_id IS NOT NULL)");
    expect(sql).toContain("GROUP BY 1");
  });

  it("reads uniform payments from their own table, never donations: paid, less refunds, by this month", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await sumGiftsBySource(MONTH);
    const { sql, params } = call(4);
    expect(params).toEqual(["2026-10-01", "2026-10-05T09:30:00.000Z"]);
    expect(sql).toContain("'uniform' AS bucket");
    expect(sql).toContain("SUM(GREATEST(amount_pence - refunded_amount_pence, 0)) FILTER (WHERE (paid_at AT TIME ZONE 'Europe/London')::date >= $1::date AND paid_at <= $2::timestamptz)");
    expect(sql).toContain("FROM uniform_payments WHERE amount_pence > refunded_amount_pence");
    expect(sql).not.toMatch(/donations/);
  });

  it("puts uniform payments in a bucket of their own", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ bucket: "uniform", month_pence: "8000", month_gifts: "2", all_pence: "24000", all_gifts: "6" }] });
    const t = await sumGiftsBySource(MONTH);
    expect(t.uniform).toEqual({ month: { pence: 8000, gifts: 2 }, all: { pence: 24000, gifts: 6 } });
    expect(t.donatePage).toEqual({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
  });

  it("puts card reader gifts in a bucket of their own", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ bucket: "cardReader", month_pence: "1774420", month_gifts: "27", all_pence: "1774420", all_gifts: "27" }] });
    const t = await sumGiftsBySource(MONTH);
    expect(t.cardReader).toEqual({ month: { pence: 1_774_420, gifts: 27 }, all: { pence: 1_774_420, gifts: 27 } });
    expect(t.donatePage).toEqual({ month: { pence: 0, gifts: 0 }, all: { pence: 0, gifts: 0 } });
  });

  it("fails as a whole when the Elf Detective School's read fails", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("elf down"));
    await expect(sumGiftsBySource(MONTH)).rejects.toThrow("elf down");
  });
});

describe("the donations list says where each gift was started", () => {
  it("selects the source for each row, and changes nothing else about the page", async () => {
    await listDonations({});
    const { sql } = call(1);
    expect(sql).toMatch(/d\.declaration_status, d\.created_at, d\.source, d\.invoice_id FROM donations d/);
    // Newest first by when each was given, now that Elf Detective School payments sit among the gifts.
    expect(sql).toMatch(/ORDER BY listed\.created_at DESC, listed\.kind = 'elf', listed\.id DESC LIMIT 50 OFFSET 0/);
  });

  it("selects the source in donation search results too", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await searchDonations("ada");
    expect(call().sql).toMatch(/d\.payment_channel, d\.created_at, d\.source, d\.invoice_id FROM donations d/);
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

  it("accepts the Ball's table bags as a source, as a parameter", async () => {
    await listDonations({ source: "ball_bags" });
    for (const i of [0, 1]) {
      expect(call(i).sql).toMatch(/d\.source = \$1/);
      expect(call(i).params).toEqual(["ball_bags"]);
    }
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
