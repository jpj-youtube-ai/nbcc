import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-071; opt-in monthly 4-band rework TASK-223: listPublicSupporters reads each donor's greatest
// PAID MONTHLY gift plus their opt-in state (individual donors.list_on_supporters, or the business
// fulfilment record's list_on_supporters + captured_at) and groups them into the four metal bands.
// Proven DB-free by mocking the pool (the mock-the-boundary approach from
// stripe-webhook-declaration.test.ts): the SQL result rows flow through the pure
// groupPublicSupporters, so asserting the grouped output proves the read → group wiring — opt-in
// respected, hidden/anonymous excluded, band from the monthly amount, org/person kind — without a DB.
// The SQL string itself is asserted to carry the monthly + paid filter (how the rest of the code
// detects a settled gift).

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { listPublicSupporters } from "../../src/db/donations";

beforeEach(() => queryMock.mockReset());

// The DB row shape the query now returns (aliased columns), with sensible "not shown" defaults so each
// fixture turns on only what it needs.
function dbRow(overrides: Record<string, unknown>) {
  return {
    donor_type: "individual",
    full_name: "Default Name",
    business_name: null,
    anonymous: false,
    hidden_from_supporters: false,
    indiv_list_opt_in: false,
    indiv_credit_name: null,
    biz_list_opt_in: false,
    biz_credit_name: null,
    monthly_amount: 5000,
    ...overrides,
  };
}

describe("listPublicSupporters", () => {
  it("groups opted-in monthly donors into bands, honouring the business vs individual channel", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        // Opted-in monthly individual at gold, by credit name.
        dbRow({
          full_name: "Zara Individual",
          indiv_list_opt_in: true,
          indiv_credit_name: "Zara I.",
          monthly_amount: 5000,
        }),
        // Opted-in monthly business (company) at silver, by business fulfilment consent + credit name.
        dbRow({
          donor_type: "company",
          full_name: "Casey",
          business_name: "Beacon Trading",
          biz_list_opt_in: true,
          biz_credit_name: "Beacon",
          monthly_amount: 2500,
        }),
      ],
    });

    const tiers = await listPublicSupporters();

    expect(tiers.gold).toEqual([{ name: "Zara I.", kind: "person" }]);
    expect(tiers.silver).toEqual([{ name: "Beacon", kind: "organisation" }]);
    expect(tiers.bronze).toEqual([]);
    expect(tiers.platinum).toEqual([]);
  });

  it("excludes a hidden donor even when opted in (query/grouping level)", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        dbRow({
          full_name: "Hidden Harry",
          indiv_list_opt_in: true,
          hidden_from_supporters: true,
          monthly_amount: 10000,
        }),
        dbRow({ full_name: "Shown Sheila", indiv_list_opt_in: true, monthly_amount: 10000 }),
      ],
    });

    const tiers = await listPublicSupporters();
    const allNames = [...tiers.bronze, ...tiers.silver, ...tiers.gold, ...tiers.platinum].map((s) => s.name);
    expect(allNames).toContain("Shown Sheila");
    expect(allNames).not.toContain("Hidden Harry");
  });

  it("the read only selects PAID MONTHLY gifts (matches how settled gifts are detected)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await listPublicSupporters();
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/mode\s*=\s*'monthly'/i);
    expect(sql).toMatch(/payment_status\s*=\s*'paid'/i);
    // It joins the business fulfilment record to resolve business consent.
    expect(sql.toLowerCase()).toContain("business_supporter_fulfilment");
  });

  it("coerces a bigint-style MAX(amount_pence) string into a number before banding", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [dbRow({ full_name: "Beth Gold", indiv_list_opt_in: true, monthly_amount: "9000" })],
    });
    const tiers = await listPublicSupporters();
    expect(tiers.gold).toEqual([{ name: "Beth Gold", kind: "person" }]);
  });
});
