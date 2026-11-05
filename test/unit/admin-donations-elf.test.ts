import { describe, it, expect, vi, beforeEach } from "vitest";

// Head Elf HQ: Elf Detective School payments come through Admin > Donations beside the gifts
// (docs/superpowers/specs/2026-11-05-elf-admin-design.md, decision 8). DB-free: the pool is mocked
// and the SQL is read back.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listDonations } from "../../src/db/admin";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
});

const call = (i: number) => {
  const [sql, params] = queryMock.mock.calls[i];
  return { sql: String(sql).replace(/\s+/g, " ").trim(), params: params as unknown[] };
};
const count = () => call(0);
const page = () => call(1);

describe("elf payments in the Donations list", () => {
  it("puts paid elf payments in the plain list, beside the gifts", async () => {
    await listDonations({});
    for (const q of [count(), page()]) {
      expect(q.sql).toContain("FROM donations d");
      expect(q.sql).toContain("FROM elf_orders o JOIN elf_families f ON f.id = o.family_id");
      expect(q.sql).toContain("o.status = 'paid' AND f.active AND f.removed_at IS NULL");
    }
    expect(page().sql).toContain("UNION ALL");
  });

  it("makes each payment a row as a gift is: the grown up, entry plus gift, paid online, one off and never in a claim", async () => {
    await listDonations({ source: "elf_school" });
    const { sql } = page();
    for (const part of [
      "'elf' AS kind",
      "NULL::int AS donor_id",
      "f.grown_up_name AS donor_name",
      "o.entry_pence + o.donation_pence AS amount_pence",
      // Gift Aid belongs to the gift alone; an entry never has it.
      "(o.gift_aid AND o.donation_pence > 0) AS gift_aid",
      "'not_eligible' AS claim_status",
      "'paid' AS payment_status",
      "'online' AS payment_channel",
      "'once' AS mode",
      "'elf_school' AS source",
      "COALESCE(o.paid_at, o.created_at) AS created_at",
      "o.reference AS elf_reference",
      "o.family_id AS elf_family_id",
      "o.entry_pence AS entry_pence",
      "o.donation_pence AS gift_pence",
    ]) {
      expect(sql, part).toContain(part);
    }
  });

  it("shows only elf payments under Elf Detective School only", async () => {
    await listDonations({ source: "elf_school" });
    for (const q of [count(), page()]) {
      expect(q.sql).toContain("FROM elf_orders o");
      expect(q.sql).not.toContain("FROM donations d");
      expect(q.params).toEqual([]);
    }
  });

  it("sends no gift filter's values with a list of elf payments alone, since it has nowhere to put them", async () => {
    await listDonations({ source: "elf_school", mode: "once", paymentStatus: "paid", channel: "online" });
    for (const q of [count(), page()]) {
      expect(q.sql).toContain("FROM elf_orders o");
      expect(q.sql).not.toMatch(/\$\d/);
      expect(q.params).toEqual([]);
    }
  });

  it("finds nothing, without asking, for Elf Detective School only with a filter no payment of it meets", async () => {
    const out = await listDonations({ source: "elf_school", mode: "monthly" });
    expect(out).toEqual({ results: [], total: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Monthly", { mode: "monthly" }],
    ["Refunded", { paymentStatus: "refunded" }],
    ["Pending", { paymentStatus: "pending" }],
    ["Failed", { paymentStatus: "failed" }],
    ["a claim status", { status: "eligible" }],
    ["in person", { channel: "in_person" }],
    ["Fill a Red Bag only", { source: "red_bag" }],
    ["Festive Ball only", { source: "ball" }],
    ["Red bags at the Ball only", { source: "ball_bags" }],
    ["Invoices only", { source: "invoice" }],
  ])("leaves elf payments out under %s", async (_name, opts) => {
    await listDonations(opts);
    for (const q of [count(), page()]) {
      expect(q.sql).not.toContain("elf_orders");
      expect(q.sql).toContain("FROM donations d");
    }
  });

  it.each([
    ["One off", { mode: "once" }],
    ["Paid", { paymentStatus: "paid" }],
    ["online", { channel: "online" }],
    ["a source not on the list", { source: "nonsense" }],
  ])("keeps elf payments in under %s, which they are", async (_name, opts) => {
    await listDonations(opts);
    expect(page().sql).toContain("FROM elf_orders o");
    expect(page().sql).toContain("FROM donations d");
  });

  it("orders both kinds by when they were given or paid, gifts first at the same moment, then the newest record", async () => {
    await listDonations({});
    expect(page().sql).toMatch(/ORDER BY listed\.created_at DESC, listed\.kind = 'elf', listed\.id DESC LIMIT 50 OFFSET 0$/);
  });

  it("adds both counts into the total", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 7 }] });
    const out = await listDonations({});
    expect(count().sql).toMatch(/^SELECT \(SELECT count\(\*\)::int FROM donations d ?\) \+ \(SELECT count\(\*\)::int FROM elf_orders o /);
    expect(out.total).toBe(7);
  });
});
