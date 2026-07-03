import { describe, it, expect } from "vitest";
import { companyFieldsSchema, buildCompanyDonorRow } from "../../src/donors/company";

// TASK-085 (REQ-038/REQ-053): the pure, DB-free company field-capture validation + donor-row
// builder. An incorporated company supplies a legal name, an optional registration number, a
// required billing contact (name + valid email) and a required billing address + UK postcode —
// no Gift Aid declaration. Pure like src/declarations/fields.ts (no pool/config/clock), so it is
// unit-tested here without a DB. buildCompanyDonorRow maps the validated fields onto the donors
// columns (business_name / company_number / full_name / email / billing_address / billing_postcode).

const validFields = {
  legalName: "Acme Ltd",
  registrationNumber: "SC123456",
  contactName: "Ada Lovelace",
  contactEmail: "finance@acme.test",
  billingAddress: "1 Office Park, London",
  billingPostcode: "SW1A 1AA",
  considerationGiven: false,
};

describe("companyFieldsSchema (REQ-038)", () => {
  it("accepts a well-formed company object", () => {
    const parsed = companyFieldsSchema.parse(validFields);
    expect(parsed.legalName).toBe("Acme Ltd");
    expect(parsed.registrationNumber).toBe("SC123456");
    expect(parsed.contactEmail).toBe("finance@acme.test");
  });

  it("treats the registration number as OPTIONAL (absent or blank)", () => {
    const { registrationNumber, ...noReg } = validFields;
    void registrationNumber;
    expect(companyFieldsSchema.safeParse(noReg).success).toBe(true);
    // The give widget always folds the key, blank when unset — a blank must be accepted too.
    const blank = companyFieldsSchema.parse({ ...validFields, registrationNumber: "" });
    expect(blank.registrationNumber).toBeUndefined();
  });

  it("requires legalName, contactName, contactEmail, billingAddress and billingPostcode", () => {
    for (const field of ["legalName", "contactName", "contactEmail", "billingAddress", "billingPostcode"] as const) {
      expect(
        companyFieldsSchema.safeParse({ ...validFields, [field]: "" }).success,
        `blank ${field} should fail`,
      ).toBe(false);
      const { [field]: _omit, ...without } = validFields;
      void _omit;
      expect(companyFieldsSchema.safeParse(without).success, `missing ${field} should fail`).toBe(false);
    }
  });

  it("requires the considerationGiven boolean (REQ-053 · TASK-088)", () => {
    const { considerationGiven, ...without } = validFields;
    void considerationGiven;
    expect(companyFieldsSchema.safeParse(without).success).toBe(false);
    expect(companyFieldsSchema.parse({ ...validFields, considerationGiven: true }).considerationGiven).toBe(true);
  });

  it("rejects an invalid contact email", () => {
    expect(companyFieldsSchema.safeParse({ ...validFields, contactEmail: "not-an-email" }).success).toBe(false);
  });

  it("rejects an invalid UK billing postcode", () => {
    expect(companyFieldsSchema.safeParse({ ...validFields, billingPostcode: "NOPE" }).success).toBe(false);
  });

  it("is strict — rejects an unknown key", () => {
    expect(companyFieldsSchema.safeParse({ ...validFields, sortCode: "00-00-00" }).success).toBe(false);
  });
});

describe("buildCompanyDonorRow (REQ-038)", () => {
  it("maps the validated fields onto the donors columns", () => {
    const row = buildCompanyDonorRow(companyFieldsSchema.parse(validFields));
    expect(row).toEqual({
      business_name: "Acme Ltd",
      company_number: "SC123456",
      full_name: "Ada Lovelace",
      email: "finance@acme.test",
      billing_address: "1 Office Park, London",
      billing_postcode: "SW1A 1AA",
    });
  });

  it("nulls company_number when the registration number is omitted", () => {
    const { registrationNumber, ...noReg } = validFields;
    void registrationNumber;
    const row = buildCompanyDonorRow(companyFieldsSchema.parse(noReg));
    expect(row.company_number).toBeNull();
  });
});
