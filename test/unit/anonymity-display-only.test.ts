import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-113 (REQ-047/REQ-052): the "anonymity is DISPLAY-ONLY" invariant. A donor's `anonymous` flag
// suppresses them from the PUBLIC donors page (REQ-047) but must NEVER suppress the real name/address
// HMRC needs on a Gift Aid claim (REQ-052) — the charity is still legally the claimant. Both behaviours
// already exist (groupPublicSupporters drops anonymous donors; the export reads the declaration's real
// captured fields, which carry no `anonymous` flag). This feeds ONE anonymous-donor fixture through
// BOTH paths so the invariant can't silently regress. DB-free: the pure functions need no pool; the
// listClaimableDonationsForExport query is proven against a mocked pool.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { groupPublicSupporters } from "../../src/db/donations-model";
import { buildCharitiesOnlineRow } from "../../src/claims/charities-online";
import { listClaimableDonationsForExport } from "../../src/db/donations";

// ONE anonymous donor. Their real identity (name + address) is captured on the Gift Aid declaration
// and on the donor row; `anonymous: true` is only a display preference.
const ANON = {
  donorType: "individual" as const,
  fullName: "Ada Lovelace",
  anonymous: true,
  amountPence: 5000, // gold tier — would show publicly if not anonymous
  declaration: {
    title: "Dr" as string | null,
    first_name: "Ada",
    last_name: "Lovelace",
    house_name_number: "12",
    postcode: "SW1A 1AA" as string | null,
  },
  donation: { created_at: new Date("2026-01-15T00:00:00.000Z"), amount_pence: 5000 },
};

beforeEach(() => {
  queryMock.mockReset();
});

describe("anonymity is display-only — public donors page (REQ-047)", () => {
  it("omits the anonymous donor from every public supporter tier", () => {
    const tiers = groupPublicSupporters([
      {
        donorType: ANON.donorType,
        fullName: ANON.fullName,
        anonymous: ANON.anonymous,
        amountPence: ANON.amountPence,
      },
    ]);
    expect(tiers.bronze).toHaveLength(0);
    expect(tiers.silver).toHaveLength(0);
    expect(tiers.gold).toHaveLength(0);
    // Their name never appears anywhere in the public output.
    const everyName = [...tiers.bronze, ...tiers.silver, ...tiers.gold].map((s) => s.name);
    expect(everyName).not.toContain("Ada Lovelace");
  });
});

describe("anonymity is display-only — HMRC claim export still carries the real identity (REQ-052)", () => {
  it("buildCharitiesOnlineRow emits the donor's real name, house name/number and postcode", () => {
    const row = buildCharitiesOnlineRow({ donation: ANON.donation, declaration: ANON.declaration });
    expect(row["First name"]).toBe("Ada");
    expect(row["Last name"]).toBe("Lovelace");
    expect(row["House name/number"]).toBe("12");
    expect(row.Postcode).toBe("SW1A 1AA");
    expect(row.Amount).toBe("50.00");
  });

  it("listClaimableDonationsForExport includes the anonymous donor's eligible gift with real fields", async () => {
    // The query filters ONLY on claim_status='eligible' (no `anonymous` predicate), so an anonymous
    // donor's eligible donation is returned in full. Mocked pool returns exactly that db row.
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          full_name: ANON.fullName,
          title: ANON.declaration.title,
          first_name: ANON.declaration.first_name,
          last_name: ANON.declaration.last_name,
          house_name_number: ANON.declaration.house_name_number,
          postcode: ANON.declaration.postcode,
          created_at: ANON.donation.created_at,
          amount_pence: ANON.donation.amount_pence,
        },
      ],
      rowCount: 1,
    });

    const rows = await listClaimableDonationsForExport();
    expect(rows).toHaveLength(1);
    expect(rows[0].donorFullName).toBe("Ada Lovelace");
    expect(rows[0].declaration.first_name).toBe("Ada");
    expect(rows[0].declaration.house_name_number).toBe("12");
    expect(rows[0].declaration.postcode).toBe("SW1A 1AA");

    // And the query itself carries no anonymity filter — anonymity can never reach the claim path.
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/claim_status\s*=\s*'eligible'/i);
    expect(sql.toLowerCase()).not.toContain("anonymous");
  });
});
