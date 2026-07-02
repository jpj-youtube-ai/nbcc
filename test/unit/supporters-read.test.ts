import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-071: listPublicSupporters reads each donor's largest gift and groups them into the
// three display tiers. Proven DB-free by mocking the pool (the mock-the-boundary approach
// from test/unit/stripe-webhook-declaration.test.ts): the SQL result rows flow through the
// pure groupPublicSupporters, so asserting the grouped output proves the read → group
// wiring — anonymous donors excluded, tier from amount, org/person kind — without a DB.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { listPublicSupporters } from "../../src/db/donations";

beforeEach(() => queryMock.mockReset());

describe("listPublicSupporters", () => {
  it("groups the donor rows into tiers, excluding anonymous donors", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { donor_type: "individual", full_name: "Zara Individual", business_name: null, anonymous: false, max_amount: 5000 },
        { donor_type: "company", full_name: "Casey", business_name: "Beacon Trading", anonymous: false, max_amount: 2500 },
        { donor_type: "individual", full_name: "Anon Ghost", business_name: null, anonymous: true, max_amount: 9000 },
      ],
    });

    const tiers = await listPublicSupporters();

    expect(tiers.gold).toEqual([{ name: "Zara Individual", kind: "person" }]);
    expect(tiers.silver).toEqual([{ name: "Beacon Trading", kind: "organisation" }]);
    expect(tiers.bronze).toEqual([]);
    const allNames = [...tiers.bronze, ...tiers.silver, ...tiers.gold].map((s) => s.name);
    expect(allNames).not.toContain("Anon Ghost");
  });

  it("coerces a bigint-style MAX(amount_pence) string into a number before tiering", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { donor_type: "individual", full_name: "Beth Gold", business_name: null, anonymous: false, max_amount: "9000" },
      ],
    });
    const tiers = await listPublicSupporters();
    expect(tiers.gold).toEqual([{ name: "Beth Gold", kind: "person" }]);
  });
});
