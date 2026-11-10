import { describe, it, expect, vi, beforeEach } from "vitest";

// Uniform payments in Admin > Donations (TASK-604): pressing the Uniform tile lists them, and only
// then. They are purchases, never gifts, so the plain list and every other tile leave them out.
// DB-free: the pool is mocked and the SQL is read back.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listDonations } from "../../src/db/admin";
import { givenOnLabel, paidByLabel } from "../../src/donations/labels";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
});

const call = (i: number) => {
  const [sql, params] = queryMock.mock.calls[i];
  return { sql: String(sql).replace(/\s+/g, " ").trim(), params: params as unknown[] };
};

describe("uniform payments in the Donations list", () => {
  it("are never in the plain list, or under another tile", async () => {
    for (const source of [undefined, "red_bag", "elf_school", "donate_page", "card_reader"]) {
      queryMock.mockClear();
      await listDonations({ source });
      for (const c of queryMock.mock.calls) expect(String(c[0])).not.toContain("uniform_payments");
    }
  });

  it("are all the Uniform tile lists: from their own table, never donations or elf payments", async () => {
    await listDonations({ source: "uniform" });
    expect(queryMock).toHaveBeenCalledTimes(2);
    for (const q of [call(0), call(1)]) {
      expect(q.sql).toContain("FROM uniform_payments u");
      expect(q.sql).not.toMatch(/donations|elf_orders/);
    }
  });

  it("makes each a row as a gift is: the buyer, the amount, paid online, one off, never in a claim, newest first", async () => {
    await listDonations({ source: "uniform", limit: 25, offset: 25 });
    const { sql } = call(1);
    for (const part of [
      "'uniform' AS kind",
      "COALESCE(u.stripe_payment_intent_id, u.stripe_session_id) AS stripe_ref",
      "NULL::int AS donor_id",
      "u.buyer_name AS donor_name",
      "u.buyer_email AS donor_email",
      "u.amount_pence",
      "false AS gift_aid",
      "'not_eligible' AS claim_status",
      "'paid' AS payment_status",
      "'online' AS payment_channel",
      "'once' AS mode",
      "u.refunded_amount_pence",
      "u.paid_at AS created_at",
      "'uniform' AS source",
      "u.details AS uniform_details",
      "ORDER BY u.paid_at DESC, u.id DESC LIMIT 25 OFFSET 25",
    ]) {
      expect(sql, part).toContain(part);
    }
  });

  it("are found by name or email, by Stripe reference when it looks like one, and by UK dates", async () => {
    await listDonations({ source: "uniform", q: "pi_123", from: "2026-11-01", to: "2026-11-09" });
    const { sql, params } = call(1);
    expect(sql).toContain("u.buyer_name ILIKE $1 OR u.buyer_email ILIKE $1 OR u.stripe_payment_intent_id ILIKE $1 OR u.stripe_session_id ILIKE $1");
    expect(sql).toContain("(u.paid_at AT TIME ZONE 'Europe/London')::date >= $2::date");
    expect(sql).toContain("(u.paid_at AT TIME ZONE 'Europe/London')::date <= $3::date");
    expect(params).toEqual(["%pi\\_123%", "2026-11-01", "2026-11-09"]);
  });

  it("are found by name alone when the words do not look like a Stripe reference", async () => {
    await listDonations({ source: "uniform", q: "robin" });
    expect(call(1).sql).not.toContain("stripe_payment_intent_id ILIKE");
  });

  it("show only the refunded ones under Refunded", async () => {
    await listDonations({ source: "uniform", paymentStatus: "refunded" });
    expect(call(1).sql).toContain("u.refunded_amount_pence > 0");
  });

  it("are none of what only a gift can be: a claim, Monthly, Gift Aid, a way of paying, where they came from, in person", async () => {
    for (const opts of [{ status: "eligible" }, { mode: "monthly" }, { giftAid: "yes" }, { method: "card" }, { came: "email" }, { channel: "in_person" }, { paymentStatus: "failed" }]) {
      queryMock.mockClear();
      expect(await listDonations({ source: "uniform", ...opts })).toEqual({ results: [], total: 0 });
      expect(queryMock).not.toHaveBeenCalled();
    }
  });

  it("are worded Uniform on their card, with nothing claimed about how they were paid", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ kind: "uniform", id: 3, amount_pence: 4000, payment_channel: "online", source: "uniform", invoice_id: null }] });
    const { results } = await listDonations({ source: "uniform" });
    expect(results[0]).toMatchObject({ given_on_label: "Uniform", paid_by_label: null });
    expect(givenOnLabel({ kind: "uniform", source: "uniform", paymentChannel: "online", invoiceId: null, fundraiserTitle: null, pledgeId: null })).toBe("Uniform");
    expect(paidByLabel({ kind: "uniform", paymentChannel: "online", payMethod: null, payWallet: null, cardBrand: null, cardLast4: null })).toBeNull();
  });
});
