import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock } }));

import { getActiveDeclarationForDonor } from "../../src/db/portal";

beforeEach(() => queryMock.mockReset());

describe("getActiveDeclarationForDonor (TASK-129)", () => {
  it("maps the active declaration row to camelCase", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          title: "Dr",
          first_name: "Ada",
          last_name: "Lovelace",
          house_name_number: "12",
          address: "Analytical Ave, London",
          postcode: "SW1A 1AA",
          non_uk: false,
          scope: "all_donations",
          confirmed_taxpayer: true,
        },
      ],
      rowCount: 1,
    });
    const decl = await getActiveDeclarationForDonor(42);
    expect(decl).toEqual({
      id: 7,
      title: "Dr",
      firstName: "Ada",
      lastName: "Lovelace",
      houseNameNumber: "12",
      address: "Analytical Ave, London",
      postcode: "SW1A 1AA",
      nonUk: false,
      scope: "all_donations",
      confirmedTaxpayer: true,
    });
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/revoked_at is null/i);
    expect(sql).toMatch(/order by id desc/i);
  });

  it("returns null when the donor has no active declaration", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await getActiveDeclarationForDonor(42)).toBeNull();
  });
});
