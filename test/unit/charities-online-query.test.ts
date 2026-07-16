import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-083 (REQ-052): the claimable-donations export query. The pure row builder / CSV
// serializer is unit-tested DB-free in charities-online-export.test.ts; here we prove the
// QUERY shape without a real DB by mocking the pool — the same mock-the-boundary approach as
// test/unit/donations-batch.test.ts. Asserting the SQL proves it selects only
// claim_status='eligible' donations INNER-joined to their declaration + donor (so company and
// otherwise non-claimable gifts, whose claim_status is never 'eligible', are excluded), and
// that the returned rows feed straight into toCharitiesOnlineCsv.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const connect = vi.fn();
  return { queryMock, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import { listClaimableDonationsForExport } from "../../src/db/donations";
import { toCharitiesOnlineCsv, CHARITIES_ONLINE_COLUMNS } from "../../src/claims/charities-online";

// Two eligible donations sharing one enduring declaration (Ada), plus a third donor.
const dbRows = [
  {
    id: 1,
    full_name: "Ada Lovelace",
    title: "Dr",
    first_name: "Ada",
    last_name: "Lovelace",
    house_name_number: "12",
    postcode: "SW1A 1AA",
    created_at: new Date("2025-11-24T00:00:00.000Z"),
    amount_pence: 5000,
  },
  {
    id: 2,
    full_name: "Ada Lovelace",
    title: "Dr",
    first_name: "Ada",
    last_name: "Lovelace",
    house_name_number: "12",
    postcode: "SW1A 1AA",
    created_at: new Date("2025-12-24T00:00:00.000Z"),
    amount_pence: 2500,
  },
];

const lastSql = (): string => String(queryMock.mock.calls[queryMock.mock.calls.length - 1][0]);
const lastParams = (): unknown[] => queryMock.mock.calls[queryMock.mock.calls.length - 1][1];

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: dbRows, rowCount: dbRows.length });
});

describe("listClaimableDonationsForExport (REQ-052)", () => {
  it("selects ONLY claim_status='eligible' donations, INNER-joined to declarations and donors", async () => {
    await listClaimableDonationsForExport();
    const sql = lastSql();
    expect(sql).toMatch(/from\s+donations/i);
    expect(sql).toMatch(/claim_status\s*=\s*'eligible'/i);
    // Inner joins (not LEFT): an eligible row always has a declaration, and we need the donor.
    expect(sql).toMatch(/join\s+declarations/i);
    expect(sql).toMatch(/join\s+donors/i);
    expect(sql).not.toMatch(/left\s+join/i);
  });

  it("does not filter by batch when none is given (no claim_batch_id predicate, empty params)", async () => {
    await listClaimableDonationsForExport();
    expect(lastSql()).not.toMatch(/claim_batch_id/i);
    expect(lastParams()).toEqual([]);
  });

  it("scopes to a single claim batch when a claim_batch_id is given (parameterised)", async () => {
    await listClaimableDonationsForExport(7);
    expect(lastSql()).toMatch(/claim_batch_id\s*=\s*\$1/i);
    expect(lastParams()).toEqual([7]);
  });

  it("does NOT constrain claim_status='eligible' for a batch export (the empty-CSV regression)", async () => {
    // A donation in a batch is 'batched' (then 'claimed'), never 'eligible', so an
    // AND claim_status='eligible' predicate made every batch export return zero rows.
    await listClaimableDonationsForExport(7);
    expect(lastSql()).not.toMatch(/claim_status\s*=\s*'eligible'/i);
  });

  it("claims the NET amount (donation minus any refund) and excludes a fully-refunded gift (TASK-244)", async () => {
    // A partial refund keeps a gift 'eligible', but Gift Aid is claimed on the amount RETAINED — so the
    // export must net refunded_amount_pence, or NBCC over-reclaims 25% of the refunded portion from HMRC.
    // A fully-refunded gift nets to 0 and must not appear in the CSV at all.
    await listClaimableDonationsForExport();
    const sql = lastSql();
    expect(sql).toMatch(/amount_pence\s*-\s*d\.refunded_amount_pence/i); // net claimed amount in SELECT
    expect(sql).toMatch(/-\s*d\.refunded_amount_pence\)\s*>\s*0/i); // net > 0 guard (excludes fully refunded)
    // The batch export nets too.
    await listClaimableDonationsForExport(7);
    expect(lastSql()).toMatch(/-\s*d\.refunded_amount_pence\)\s*>\s*0/i);
  });

  it("excludes overseas (non-UK) declarations so one can't break the whole export (TASK-246)", async () => {
    // A non-UK declaration stores a blank postcode/house, which the CSV builder requires and THROWS on,
    // aborting the entire batch. Until proper HMRC overseas handling exists, they are left out of the
    // standard export rather than breaking it. Both export paths exclude them.
    await listClaimableDonationsForExport();
    expect(lastSql()).toMatch(/dec\.non_uk\s+IS\s+NOT\s+TRUE/i);
    await listClaimableDonationsForExport(7);
    expect(lastSql()).toMatch(/dec\.non_uk\s+IS\s+NOT\s+TRUE/i);
  });

  it("maps each DB row into the { donation, declaration } shape the CSV builder consumes", async () => {
    const rows = await listClaimableDonationsForExport();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      donationId: 1,
      donorFullName: "Ada Lovelace",
      declaration: {
        title: "Dr",
        first_name: "Ada",
        last_name: "Lovelace",
        house_name_number: "12",
        postcode: "SW1A 1AA",
      },
      donation: { amount_pence: 5000 },
    });
  });

  it("feeds straight into toCharitiesOnlineCsv: header + one row per eligible donation", async () => {
    const rows = await listClaimableDonationsForExport();
    const csv = toCharitiesOnlineCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe([...CHARITIES_ONLINE_COLUMNS].join(","));
    expect(lines).toHaveLength(1 + rows.length); // header + 2 donations
    // The two gifts share one declaration but each produces its own independent row.
    expect(lines[1]).toBe("Dr,Ada,Lovelace,12,SW1A 1AA,24/11/2025,50.00");
    expect(lines[2]).toBe("Dr,Ada,Lovelace,12,SW1A 1AA,24/12/2025,25.00");
  });
});
