import { describe, it, expect } from "vitest";
import {
  CHARITIES_ONLINE_COLUMNS,
  buildCharitiesOnlineRow,
  charitiesOnlineCells,
  toCharitiesOnlineCsv,
  CharitiesOnlineExportError,
  type ClaimRowInput,
} from "../../src/claims/charities-online";

// TASK-082 (REQ-052): the pure, DB-free Charities Online Gift Aid claim export. It maps an
// ALREADY-ELIGIBLE donation + its linked declarations row onto the exact HMRC columns —
// Title, First name, Last name, House name/number, Postcode, Donation date (DD/MM/YYYY), Amount
// (plain decimal GBP, never pence) — and serializes a header + one row per donation. Read-only
// formatting: eligibility (individual donor, active declaration, not refunded — deriveClaimStatus)
// is the CALLER's job, never re-derived here. Pure like src/declarations/fields.ts /
// src/declarations/render.ts, so it is unit-tested DB-free.

// A UK declaration covering the gifts below (the declarations columns this export reads).
const declaration = {
  title: "Dr",
  first_name: "Ada",
  last_name: "Lovelace",
  house_name_number: "12",
  postcode: "SW1A 1AA",
};

const donation = (created_at: string, amount_pence: number) => ({ created_at, amount_pence });

describe("buildCharitiesOnlineRow (REQ-052)", () => {
  it("emits exactly the seven Charities Online fields in HMRC's order", () => {
    const row = buildCharitiesOnlineRow({
      donation: donation("2025-12-24T10:30:00.000Z", 5000),
      declaration,
    });
    expect(Object.keys(row)).toEqual([
      "Title",
      "First name",
      "Last name",
      "House name/number",
      "Postcode",
      "Donation date",
      "Amount",
    ]);
    // The exported column list is the single source of the order.
    expect(Object.keys(row)).toEqual([...CHARITIES_ONLINE_COLUMNS]);
  });

  it("maps the declaration + donation fields onto the columns", () => {
    const row = buildCharitiesOnlineRow({
      donation: donation("2025-12-24T10:30:00.000Z", 5000),
      declaration,
    });
    expect(row).toEqual({
      Title: "Dr",
      "First name": "Ada",
      "Last name": "Lovelace",
      "House name/number": "12",
      Postcode: "SW1A 1AA",
      "Donation date": "24/12/2025",
      Amount: "50.00",
    });
  });

  it("formats the donation date as DD/MM/YYYY (zero-padded) and accepts a Date instance", () => {
    const row = buildCharitiesOnlineRow({
      donation: { created_at: new Date("2026-01-05T00:00:00.000Z"), amount_pence: 1234 },
      declaration,
    });
    expect(row["Donation date"]).toBe("05/01/2026");
  });

  it("formats the amount as a plain decimal GBP string (two places), never pence", () => {
    for (const [pence, expected] of [
      [5000, "50.00"],
      [2500, "25.00"],
      [1234, "12.34"],
      [100, "1.00"],
      [5, "0.05"],
    ] as const) {
      const row = buildCharitiesOnlineRow({ donation: donation("2025-12-24T00:00:00Z", pence), declaration });
      expect(row.Amount).toBe(expected);
    }
  });

  it("passes an empty title through (HMRC title is optional)", () => {
    const row = buildCharitiesOnlineRow({
      donation: donation("2025-12-24T00:00:00Z", 5000),
      declaration: { ...declaration, title: null },
    });
    expect(row.Title).toBe("");
  });

  it("throws (never emits a blank column) when a required declaration field is missing", () => {
    for (const field of ["first_name", "last_name", "house_name_number", "postcode"] as const) {
      const broken = { ...declaration, [field]: null } as unknown as ClaimRowInput["declaration"];
      expect(
        () => buildCharitiesOnlineRow({ donation: donation("2025-12-24T00:00:00Z", 5000), declaration: broken }),
        `missing ${field} should throw`,
      ).toThrow(CharitiesOnlineExportError);
    }
    // An empty string counts as missing too.
    expect(() =>
      buildCharitiesOnlineRow({
        donation: donation("2025-12-24T00:00:00Z", 5000),
        declaration: { ...declaration, postcode: "   " },
      }),
    ).toThrow(CharitiesOnlineExportError);
  });

  it("throws on an invalid donation date or amount", () => {
    expect(() =>
      buildCharitiesOnlineRow({ donation: donation("not-a-date", 5000), declaration }),
    ).toThrow(CharitiesOnlineExportError);
    expect(() =>
      buildCharitiesOnlineRow({ donation: donation("2025-12-24T00:00:00Z", 0), declaration }),
    ).toThrow(CharitiesOnlineExportError);
  });
});

describe("charitiesOnlineCells", () => {
  it("returns the cells in column order", () => {
    const row = buildCharitiesOnlineRow({
      donation: donation("2025-12-24T00:00:00Z", 5000),
      declaration,
    });
    expect(charitiesOnlineCells(row)).toEqual(["Dr", "Ada", "Lovelace", "12", "SW1A 1AA", "24/12/2025", "50.00"]);
  });
});

describe("toCharitiesOnlineCsv (REQ-052)", () => {
  it("emits a header row plus one row per donation", () => {
    const csv = toCharitiesOnlineCsv([
      { donation: donation("2025-12-24T00:00:00Z", 5000), declaration },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Title,First name,Last name,House name/number,Postcode,Donation date,Amount");
    expect(lines[1]).toBe("Dr,Ada,Lovelace,12,SW1A 1AA,24/12/2025,50.00");
    expect(lines).toHaveLength(2);
  });

  it("gives two donations sharing the SAME enduring declaration their own independent rows", () => {
    // An enduring monthly declaration covers every charge on the subscription: two invoice.paid
    // charges (different dates/amounts) each produce their own claim row from the one declaration.
    const csv = toCharitiesOnlineCsv([
      { donation: donation("2025-11-24T00:00:00Z", 5000), declaration },
      { donation: donation("2025-12-24T00:00:00Z", 2500), declaration },
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3); // header + 2 rows
    expect(lines[1]).toBe("Dr,Ada,Lovelace,12,SW1A 1AA,24/11/2025,50.00");
    expect(lines[2]).toBe("Dr,Ada,Lovelace,12,SW1A 1AA,24/12/2025,25.00");
  });

  it("quotes a field containing a comma (RFC 4180)", () => {
    const csv = toCharitiesOnlineCsv([
      {
        donation: donation("2025-12-24T00:00:00Z", 5000),
        declaration: { ...declaration, house_name_number: "Flat 2, The Mews" },
      },
    ]);
    expect(csv.split("\r\n")[1]).toContain('"Flat 2, The Mews"');
  });

  it("throws if any donation is missing a required field (no partial file)", () => {
    expect(() =>
      toCharitiesOnlineCsv([
        { donation: donation("2025-12-24T00:00:00Z", 5000), declaration },
        {
          donation: donation("2025-12-25T00:00:00Z", 5000),
          declaration: { ...declaration, first_name: "" },
        },
      ]),
    ).toThrow(CharitiesOnlineExportError);
  });
});
