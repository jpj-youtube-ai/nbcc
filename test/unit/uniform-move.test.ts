import { describe, it, expect, vi, beforeEach } from "vitest";
import { moveUniformSale } from "../../src/db/uniform-payments";
import type { UniformPaymentWrite } from "../../src/uniform/model";

// The one off move of earlier uniform payments (TASK-604, src/scripts/move-uniform-payments.ts). A
// uniform bought before the Uniform tile was recorded as a donation; each is moved to uniform_payments,
// its whole donations row kept in donations_moved_to_uniform, and taken out of donations. A donation
// already in a Gift Aid claim or linked to anything else is left alone for staff to look at.
// A dry run writes nothing. DB-free: the client is mocked and the SQL read back. Every name is invented.

const sale: UniformPaymentWrite = {
  sessionId: "cs_test_u1",
  paymentIntentId: "pi_test_u1",
  paymentLinkId: "plink_test_u",
  amountPence: 4000,
  currency: "GBP",
  buyerName: "Robin Testperson",
  buyerEmail: "robin.uniform@example.com",
  details: [{ label: "Size", value: "Age 7 to 8" }],
  paid: true,
};
const PAID_AT = new Date("2026-10-20T10:00:00Z");

let donation: { id: number; created_at: Date; refunded_amount_pence: number; held: boolean } | null;
let uniformExists: boolean;
const query = vi.fn();
const client = { query };
const sqls = () => query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));
const writes = () => sqls().filter((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s));

beforeEach(() => {
  query.mockReset();
  donation = { id: 77, created_at: new Date("2026-10-20T10:00:05Z"), refunded_amount_pence: 0, held: false };
  uniformExists = false;
  query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/SELECT id FROM uniform_payments/i.test(s)) return { rows: uniformExists ? [{ id: 31 }] : [], rowCount: uniformExists ? 1 : 0 };
    if (/FROM donations d/i.test(s)) return { rows: donation ? [donation] : [], rowCount: donation ? 1 : 0 };
    if (/INSERT INTO uniform_payments/i.test(s)) return { rows: [{ id: 31 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
});

describe("moving an earlier uniform payment out of donations", () => {
  it("finds the donation by its checkout session or its payment, locked", async () => {
    await moveUniformSale(client, sale, PAID_AT, { apply: false });
    const find = query.mock.calls.find((c) => /FROM donations d/i.test(String(c[0])))!;
    expect(String(find[0]).replace(/\s+/g, " ")).toContain("WHERE d.stripe_session_id = $1 OR ($2::text IS NOT NULL AND d.stripe_payment_intent_id = $2)");
    expect(String(find[0])).toContain("FOR UPDATE");
    expect(find[1]).toEqual(["cs_test_u1", "pi_test_u1"]);
  });

  it("writes nothing on a dry run, and says what it would do", async () => {
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: false })).toEqual({ outcome: "moved", amountPence: 4000 });
    expect(writes()).toEqual([]);
  });

  it("moves it: a uniform payment from it, its whole row kept, an audit line, and out of donations", async () => {
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: true })).toEqual({ outcome: "moved", amountPence: 4000 });
    const insert = query.mock.calls.find((c) => /INSERT INTO uniform_payments/i.test(String(c[0])))!;
    // Paid when the donation was recorded, with its refunds, and where it came from.
    expect(insert[1]).toEqual(["cs_test_u1", "pi_test_u1", "plink_test_u", 4000, "GBP", "Robin Testperson", "robin.uniform@example.com", JSON.stringify(sale.details), donation!.created_at, 0, 77]);
    const w = writes();
    expect(w[1]).toContain("INSERT INTO donations_moved_to_uniform (donation_id, uniform_payment_id, donation_row) SELECT d.id, $2, to_jsonb(d) FROM donations d WHERE d.id = $1");
    expect(w[2]).toContain("INSERT INTO audit_log");
    expect(w[3]).toContain("DELETE FROM donations WHERE id = $1");
  });

  it("leaves a donation in a claim or linked to anything else alone, and writes nothing", async () => {
    donation!.held = true;
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: true })).toEqual({ outcome: "held", amountPence: 4000 });
    expect(writes()).toEqual([]);
    const find = sqls().find((s) => /FROM donations d/i.test(s))!;
    for (const part of ["d.claim_batch_id IS NOT NULL", "d.claim_status NOT IN ('eligible', 'not_eligible')", "donation_partner_shares", "claim_adjustments", "sponsor_pledges", "donation_invoices"]) {
      expect(find, part).toContain(part);
    }
  });

  it("keeps a sale that was never recorded at all as a uniform payment, paid when Stripe says", async () => {
    donation = null;
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: true })).toEqual({ outcome: "recorded", amountPence: 4000 });
    const insert = query.mock.calls.find((c) => /INSERT INTO uniform_payments/i.test(String(c[0])))!;
    expect(insert[1]).toEqual(["cs_test_u1", "pi_test_u1", "plink_test_u", 4000, "GBP", "Robin Testperson", "robin.uniform@example.com", JSON.stringify(sale.details), PAID_AT, 0, null]);
    expect(writes().some((s) => /donations/i.test(s.replace(/uniform_payments/g, "")) && !/audit_log/i.test(s))).toBe(false);
  });

  it("still moves a donation left behind beside a uniform payment kept since, against that payment", async () => {
    // A late paying uniform (bank payment) half recorded as a pending donation before the Uniform tile,
    // and kept as a uniform payment when its money came in after.
    uniformExists = true;
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: true })).toEqual({ outcome: "moved", amountPence: 4000 });
    const w = writes();
    expect(w.some((s) => /INSERT INTO uniform_payments/i.test(s))).toBe(false);
    expect(w[0]).toContain("UPDATE uniform_payments SET moved_from_donation_id = $2 WHERE id = $1 AND moved_from_donation_id IS NULL");
    expect(query.mock.calls.find((c) => /UPDATE uniform_payments/i.test(String(c[0])))![1]).toEqual([31, 77]);
    expect(w[1]).toContain("INSERT INTO donations_moved_to_uniform");
    expect(w[3]).toContain("DELETE FROM donations WHERE id = $1");
  });

  it("does nothing to one already kept as a uniform payment, so it can be run again", async () => {
    uniformExists = true;
    donation = null;
    expect(await moveUniformSale(client, sale, PAID_AT, { apply: true })).toEqual({ outcome: "already_uniform", amountPence: 4000 });
    expect(writes()).toEqual([]);
  });
});
