import { describe, it, expect } from "vitest";
import {
  declarationFieldsSchema,
  isValidUkPostcode,
  buildDeclarationRow,
} from "../../src/declarations/fields";

// TASK-061 (REQ-043): the pure, DB-free declaration field-capture validation + row
// builder — the shape a Gift Aid declaration captures (title, names, house name/number
// as a separate HMRC matching key, the ONE home address, a UK postcode) with a non-UK
// flag that omits the postcode. Pure like src/db/donations-model.ts and
// src/declarations/wording.ts (no pool/config/clock), so it is unit-tested here without
// a DB. The scope (REQ-044) and verbatim wording (REQ-040) come from their own modules;
// this only validates the captured fields and maps them onto a declarations row.

const ukFields = {
  title: "Dr",
  firstName: "Ada",
  lastName: "Lovelace",
  houseNameNumber: "12",
  address: "Analytical Avenue, London",
  postcode: "SW1A 1AA",
  nonUk: false,
};

describe("isValidUkPostcode (GOV.UK format)", () => {
  it("accepts well-formed UK postcodes in assorted formats", () => {
    for (const pc of ["SW1A 1AA", "M1 1AE", "B33 8TH", "CR2 6XH", "DN55 1PT", "EC1A 1BB", "W1A 0AX", "GIR 0AA"]) {
      expect(isValidUkPostcode(pc), `${pc} should be valid`).toBe(true);
    }
  });

  it("is case-insensitive and tolerates a missing space", () => {
    expect(isValidUkPostcode("m1 1ae")).toBe(true);
    expect(isValidUkPostcode("sw1a1aa")).toBe(true);
  });

  it("rejects malformed postcodes", () => {
    for (const pc of ["NOTAPOSTCODE", "12345", "SW1A", "1AA", "", "SW1A 1A"]) {
      expect(isValidUkPostcode(pc), `${pc} should be invalid`).toBe(false);
    }
  });
});

describe("declarationFieldsSchema (REQ-043)", () => {
  it("accepts a well-formed UK declaration", () => {
    const parsed = declarationFieldsSchema.parse(ukFields);
    expect(parsed.firstName).toBe("Ada");
    expect(parsed.postcode).toBe("SW1A 1AA");
    expect(parsed.nonUk).toBe(false);
  });

  it("rejects a UK declaration with a malformed postcode", () => {
    expect(declarationFieldsSchema.safeParse({ ...ukFields, postcode: "NOPE" }).success).toBe(false);
  });

  it("rejects a UK declaration missing the house name/number", () => {
    const { houseNameNumber, ...withoutHouse } = ukFields;
    void houseNameNumber;
    expect(declarationFieldsSchema.safeParse(withoutHouse).success).toBe(false);
  });

  it("requires first and last name (title stays optional)", () => {
    expect(declarationFieldsSchema.safeParse({ ...ukFields, firstName: "" }).success).toBe(false);
    expect(declarationFieldsSchema.safeParse({ ...ukFields, lastName: "" }).success).toBe(false);
    const { title, ...withoutTitle } = ukFields;
    void title;
    expect(declarationFieldsSchema.safeParse(withoutTitle).success).toBe(true);
  });

  it("lets a non-UK declaration omit the postcode and house name/number", () => {
    const nonUk = {
      firstName: "Jean",
      lastName: "Le Maistre",
      address: "La Rue, St Helier, Jersey",
      nonUk: true,
    };
    const res = declarationFieldsSchema.safeParse(nonUk);
    expect(res.success).toBe(true);
  });

  it("exposes exactly one address field — an extra work/c-o address field is rejected", () => {
    expect(
      declarationFieldsSchema.safeParse({ ...ukFields, workAddress: "1 Office Park" }).success,
    ).toBe(false);
    expect(
      declarationFieldsSchema.safeParse({ ...ukFields, addressType: "work" }).success,
    ).toBe(false);
  });
});

describe("buildDeclarationRow (REQ-043/REQ-044)", () => {
  const wording = { wording_version: "hmrc-single-2024-01", wording_snapshot: "I am a UK taxpayer ..." };

  it("maps validated fields onto snake_case declarations columns with the donor + scope + wording", () => {
    const row = buildDeclarationRow(declarationFieldsSchema.parse(ukFields), {
      donorId: 42,
      scope: "this_donation",
      wording,
      confirmedTaxpayer: true,
    });
    expect(row).toMatchObject({
      donor_id: 42,
      title: "Dr",
      first_name: "Ada",
      last_name: "Lovelace",
      house_name_number: "12",
      address: "Analytical Avenue, London",
      postcode: "SW1A 1AA",
      non_uk: false,
      scope: "this_donation",
      wording_version: "hmrc-single-2024-01",
      wording_snapshot: "I am a UK taxpayer ...",
      confirmed_taxpayer: true,
    });
  });

  it("nulls the postcode for a non-UK declaration and defaults confirmed_taxpayer to false", () => {
    const row = buildDeclarationRow(
      declarationFieldsSchema.parse({
        firstName: "Jean",
        lastName: "Le Maistre",
        address: "La Rue, Jersey",
        nonUk: true,
      }),
      { donorId: 7, scope: "all_donations", wording },
    );
    expect(row.postcode).toBeNull();
    expect(row.non_uk).toBe(true);
    expect(row.title).toBeNull();
    expect(row.confirmed_taxpayer).toBe(false);
  });
});
