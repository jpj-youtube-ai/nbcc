import { describe, it, expect, vi, beforeEach } from "vitest";

// One donor's page and Search, at the database's edge (2026-11-14 admin refresh): the gift search
// that says how each gift's payment went, the donor search that also looks at postcodes and phone
// numbers, a donor's giving, the truth about their monthly gift, and their lines from the audit
// trail. DB-free: the pool is mocked and the SQL is read. Every name and figure is invented.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { searchDonations, searchDonors } from "../../src/db/admin";
import { getDonorGiving, getDonorMonthlyGift, listDonorAuditTrail } from "../../src/db/donor-page";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

const call = (i = 0) => {
  const [sql, params] = queryMock.mock.calls[i];
  return { sql: String(sql).replace(/\s+/g, " "), params: params as unknown[] };
};

describe("the gift search says how each gift's payment went", () => {
  // Search drew a green Paid pill on every gift, failed ones included: the pill is worked out from
  // these two columns (helpers.paymentLabel), and the search never returned them.
  it("returns the payment status and what has been refunded, as the Donations list does", async () => {
    await searchDonations("rowan");
    expect(call().sql).toContain("d.payment_status");
    expect(call().sql).toContain("d.refunded_amount_pence");
  });

  it("hands the two columns on untouched", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 4, payment_status: "failed", refunded_amount_pence: 0 }] });
    const rows = await searchDonations("rowan");
    expect(rows[0].payment_status).toBe("failed");
    expect(rows[0].refunded_amount_pence).toBe(0);
  });
});

describe("the donor search", () => {
  it("still looks in the name, business name, email and donor number", async () => {
    await searchDonors("12");
    const { sql, params } = call();
    expect(sql).toContain("dn.full_name ILIKE $1 OR dn.business_name ILIKE $1 OR dn.email ILIKE $1");
    expect(sql).toContain("dn.id = $2::int");
    expect(params[0]).toBe("%12%");
    expect(params[1]).toBe(12);
  });

  it("looks at the postcode on a Gift Aid declaration and on a business's billing address, with or without the space", async () => {
    await searchDonors("ka1 1aa");
    const { sql, params } = call();
    expect(sql).toContain("REPLACE(dn.billing_postcode, ' ', '') ILIKE $3");
    expect(sql).toContain("FROM declarations dec WHERE dec.donor_id = dn.id AND REPLACE(dec.postcode, ' ', '') ILIKE $3");
    expect(params[2]).toBe("%ka11aa%");
  });

  it("does not treat a plain name or a bare number as a postcode", async () => {
    await searchDonors("rowan");
    expect(call().params[2]).toBe(null);
    await searchDonors("12");
    expect(call(1).params[2]).toBe(null);
  });

  it("looks at a business supporter's phone number, however it was typed or stored", async () => {
    await searchDonors("0131 496 0000");
    const { sql, params } = call();
    expect(sql).toContain("FROM business_supporter_fulfilment f WHERE f.donor_id = dn.id AND regexp_replace(f.phone, '[^0-9]', '', 'g') LIKE $4");
    // The leading 0 (or 44) is left off, so 0131..., +44 131... and 0044 131... all find each other.
    expect(params[3]).toBe("%1314960000%");
    await searchDonors("+44 (131) 496-0000");
    expect(call(1).params[3]).toBe("%1314960000%");
  });

  it("does not treat a short number or a name as a phone number", async () => {
    await searchDonors("1234");
    expect(call().params[3]).toBe(null);
    await searchDonors("rowan 07700");
    expect(call(1).params[3]).toBe(null);
  });

  // A phone number typed with no spaces is all digits. Asked for as an id it does not fit the
  // column's type, the database refuses the whole query, and the search says it is unavailable.
  it("never asks for a run of digits too long to be an id as one", async () => {
    await searchDonors("07700900111");
    expect(call().params[1]).toBe(null);
    expect(call().params[3]).toBe("%7700900111%");
    await searchDonations("07700900111");
    expect(call(1).params[1]).toBe(null);
    await searchDonors("2147483647");
    expect(call(2).params[1]).toBe(2147483647);
  });

  it("keeps every value a parameter and the list capped at 50", async () => {
    await searchDonors("ka1 1aa'; drop table donors; --");
    const { sql } = call();
    expect(sql).not.toContain("drop table");
    expect(sql).toContain("LIMIT 50");
  });
});

describe("a donor's giving", () => {
  const sums = { paid_count: 2, all_count: 3, total_pence: 4000, first_at: new Date("2025-12-01T10:00:00Z"), latest_at: new Date("2026-11-02T09:30:00Z") };
  const giftRow = (over: Record<string, unknown> = {}) => ({
    id: 31, donor_id: 7, created_at: new Date("2026-11-02T09:30:00Z"), amount_pence: 2500, refunded_amount_pence: 0,
    mode: "once", plan: null, gift_aid: true, payment_status: "paid", source: null, invoice_id: null, ...over,
  });

  it("counts every gift under the same email address, since one person is several donor records", async () => {
    await getDonorGiving(7);
    for (const i of [0, 1]) {
      expect(call(i).sql).toContain("d.donor_id = $1 OR LOWER(dn.email) = (SELECT LOWER(me.email) FROM donors me WHERE me.id = $1)");
      expect(call(i).params).toEqual([7]);
    }
  });

  it("leaves out money they paid in for their own fundraiser, which is their supporters' giving", async () => {
    await getDonorGiving(7);
    expect(call(0).sql).toContain("NOT d.paid_in_by_organiser");
    expect(call(1).sql).toContain("NOT d.paid_in_by_organiser");
  });

  it("totals paid gifts only, less anything refunded", async () => {
    await getDonorGiving(7);
    const { sql } = call(0);
    expect(sql).toContain("sum(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)) FILTER (WHERE d.payment_status = 'paid')");
    expect(sql).toContain("count(*) FILTER (WHERE d.payment_status = 'paid')");
    expect(sql).toContain("min(d.created_at) FILTER (WHERE d.payment_status = 'paid')");
    expect(sql).toContain("max(d.created_at) FILTER (WHERE d.payment_status = 'paid')");
  });

  it("lists the gifts newest first, and no more than 200 of them", async () => {
    await getDonorGiving(7);
    expect(call(1).sql).toContain("ORDER BY d.created_at DESC, d.id DESC LIMIT 200");
  });

  it("gives the figures and each gift in the page's own words", async () => {
    queryMock.mockResolvedValueOnce({ rows: [sums] });
    queryMock.mockResolvedValueOnce({
      rows: [giftRow(), giftRow({ id: 30, donor_id: 6, mode: "monthly", plan: "silver", amount_pence: 1500, refunded_amount_pence: 500, gift_aid: false, source: "red_bag" }), giftRow({ id: 29, payment_status: "failed" })],
    });
    expect(await getDonorGiving(7)).toEqual({
      totalPence: 4000,
      count: 2,
      listed: 3,
      firstAt: "2025-12-01T10:00:00.000Z",
      latestAt: "2026-11-02T09:30:00.000Z",
      gifts: [
        { id: 31, donorId: 7, date: "2026-11-02T09:30:00.000Z", amountPence: 2500, refundedPence: 0, mode: "once", plan: null, giftAid: true, status: "paid", source: null, invoiceId: null },
        { id: 30, donorId: 6, date: "2026-11-02T09:30:00.000Z", amountPence: 1500, refundedPence: 500, mode: "monthly", plan: "silver", giftAid: false, status: "paid", source: "red_bag", invoiceId: null },
        { id: 29, donorId: 7, date: "2026-11-02T09:30:00.000Z", amountPence: 2500, refundedPence: 0, mode: "once", plan: null, giftAid: true, status: "failed", source: null, invoiceId: null },
      ],
    });
  });

  it("is nothing given, not a failure, for a donor with no gifts", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ paid_count: 0, all_count: 0, total_pence: 0, first_at: null, latest_at: null }] });
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getDonorGiving(7)).toEqual({ totalPence: 0, count: 0, listed: 0, firstAt: null, latestAt: null, gifts: [] });
  });
});

describe("the truth about a donor's monthly gift", () => {
  const paid = [
    { amount_pence: 2000, created_at: new Date("2026-11-01T08:00:00Z") },
    { amount_pence: 1000, created_at: new Date("2026-05-01T08:00:00Z") },
  ];
  /** Answers the three reads by what each asks for, whatever order they run in. */
  function answer(over: { dunning?: unknown[]; cancelledByTeam?: unknown[]; paid?: unknown[] }) {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM subscription_dunning/.test(sql)) return { rows: over.dunning ?? [] };
      if (/FROM audit_log/.test(sql)) return { rows: over.cancelledByTeam ?? [] };
      if (/FROM donations/.test(sql)) return { rows: over.paid ?? paid };
      return { rows: [] };
    });
  }
  const sqlOf = (re: RegExp) => {
    const hit = queryMock.mock.calls.find((c) => re.test(String(c[0])));
    return { sql: String(hit![0]).replace(/\s+/g, " "), params: hit![1] as unknown[] };
  };

  it("reads the payment health of this subscription, the team's own cancellation, and what has been paid", async () => {
    answer({});
    await getDonorMonthlyGift(7, "sub_pretend", "silver");
    expect(sqlOf(/FROM subscription_dunning/).params).toEqual(["sub_pretend"]);
    const audit = sqlOf(/FROM audit_log/);
    expect(audit.sql).toContain("entity = 'donor' AND entity_id = $1 AND action = 'admin.subscription_cancelled' AND data->>'subscriptionId' = $2");
    expect(audit.params).toEqual([7, "sub_pretend"]);
    const gifts = sqlOf(/FROM donations/);
    expect(gifts.sql).toContain("donor_id = $1 AND stripe_subscription_id = $2 AND payment_status = 'paid'");
    expect(gifts.params).toEqual([7, "sub_pretend"]);
  });

  it("is giving, at what they give now, since their first payment", async () => {
    answer({ dunning: [{ status: "active", cancelled_at: null, lapsed_at: null, failed_attempts: 0 }] });
    expect(await getDonorMonthlyGift(7, "sub_pretend", "silver")).toEqual({
      subscriptionId: "sub_pretend", plan: "silver", state: "active", monthlyPence: 2000, firstPaidAt: "2026-05-01T08:00:00.000Z",
      payments: 2, cancelledAt: null, lapsedAt: null, failedAttempts: 0,
    });
  });

  it("is cancelled once Stripe has said so, even though the status column still says active", async () => {
    answer({ dunning: [{ status: "active", cancelled_at: new Date("2026-11-10T12:00:00Z"), lapsed_at: null, failed_attempts: 0 }] });
    const m = await getDonorMonthlyGift(7, "sub_pretend", "silver");
    expect(m.state).toBe("cancelled");
    expect(m.cancelledAt).toBe("2026-11-10T12:00:00.000Z");
  });

  // The page reads this the moment after the team cancels, before Stripe's own message has arrived.
  it("is cancelled as soon as the team has cancelled it, before Stripe's message arrives", async () => {
    answer({ dunning: [{ status: "active", cancelled_at: null, lapsed_at: null, failed_attempts: 0 }], cancelledByTeam: [{ created_at: new Date("2026-11-14T16:20:00Z") }] });
    const m = await getDonorMonthlyGift(7, "sub_pretend", "silver");
    expect(m.state).toBe("cancelled");
    expect(m.cancelledAt).toBe("2026-11-14T16:20:00.000Z");
  });

  it("says when the card is failing, and when the gift has stopped for it", async () => {
    answer({ dunning: [{ status: "past_due", cancelled_at: null, lapsed_at: null, failed_attempts: 2 }] });
    expect(await getDonorMonthlyGift(7, "sub_pretend", null)).toMatchObject({ state: "past_due", failedAttempts: 2 });
    answer({ dunning: [{ status: "lapsed", cancelled_at: null, lapsed_at: new Date("2026-10-03T07:00:00Z"), failed_attempts: 4 }] });
    expect(await getDonorMonthlyGift(7, "sub_pretend", null)).toMatchObject({ state: "lapsed", lapsedAt: "2026-10-03T07:00:00.000Z" });
  });

  it("is unknown, not a problem, for an older gift with no payment health on record", async () => {
    answer({ dunning: [], paid: [] });
    expect(await getDonorMonthlyGift(7, "sub_pretend", "bronze")).toEqual({
      subscriptionId: "sub_pretend", plan: "bronze", state: "unknown", monthlyPence: null, firstPaidAt: null,
      payments: 0, cancelledAt: null, lapsedAt: null, failedAttempts: 0,
    });
  });
});

describe("a donor's lines from the audit trail", () => {
  it("reads what was done to the donor, to their monthly gift and to their Gift Aid declarations, newest first", async () => {
    await listDonorAuditTrail(7);
    const { sql, params } = call();
    expect(sql).toContain("(entity IN ('donor', 'subscription') AND entity_id = $1)");
    expect(sql).toContain("(entity = 'declaration' AND entity_id IN (SELECT id FROM declarations WHERE donor_id = $1))");
    expect(sql).toContain("ORDER BY id DESC LIMIT 50");
    expect(params).toEqual([7]);
  });

  it("hands on who, what and when, and only the names of the details that changed", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { id: 9, actor: "admin:fern@example.com", action: "donor.updated", data: { fields: ["fullName", "email"] }, created_at: new Date("2026-11-14T16:00:00Z") },
        // A sign in link's audit row carries the link's own secret: it must never leave the server.
        { id: 8, actor: "donor", action: "portal.token_used", data: { token: "pretend-secret-link" }, created_at: new Date("2026-11-13T09:00:00Z") },
        { id: 7, actor: "stripe", action: "subscription.payment_failed", data: { eventId: "evt_pretend", failedAttempts: 2 }, created_at: new Date("2026-11-12T09:00:00Z") },
      ],
    });
    const lines = await listDonorAuditTrail(7);
    expect(lines).toEqual([
      { id: 9, action: "donor.updated", actor: "admin:fern@example.com", at: "2026-11-14T16:00:00.000Z", fields: ["fullName", "email"] },
      { id: 8, action: "portal.token_used", actor: "donor", at: "2026-11-13T09:00:00.000Z", fields: [] },
      { id: 7, action: "subscription.payment_failed", actor: "stripe", at: "2026-11-12T09:00:00.000Z", fields: [] },
    ]);
    expect(JSON.stringify(lines)).not.toContain("pretend-secret-link");
  });
});
