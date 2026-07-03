import { z } from "zod";
import { isValidUkPostcode } from "../declarations/fields";

// The pure, DB-free field-capture validation + row builder for a COMPANY donation (REQ-038 /
// REQ-053). An incorporated company (Ltd, PLC, LLP) is never Gift Aided; instead of a Gift Aid
// declaration it supplies its legal name, an optional registration number, a required billing
// contact (name + email) and a required billing address + UK postcode. Pure like
// src/declarations/fields.ts (no pool/config/clock), so it is unit-tested DB-free. This only
// validates the captured fields and maps them onto donors columns; the checkout endpoint
// validates + stamps them and the webhook persists the donor row.

// Coerce an empty/blank string to undefined so the OPTIONAL registration number accepts the
// give widget's empty value (it always folds the key, blank when unset) without failing min(1).
const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

// The captured company fields (camelCase input). `.strict()` rejects any unknown key. Only the
// registration number is optional; the rest are required, the email must be a valid address, and
// the billing postcode must be a valid UK postcode (the same GOV.UK format as a declaration).
export const companyFieldsSchema = z
  .object({
    legalName: z.string().trim().min(1),
    registrationNumber: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
    contactName: z.string().trim().min(1),
    contactEmail: z.string().trim().email(),
    billingAddress: z.string().trim().min(1),
    billingPostcode: z
      .string()
      .trim()
      .min(1)
      .refine(isValidUkPostcode, { message: "a valid UK postcode is required" }),
  })
  .strict();

export type CompanyFields = z.infer<typeof companyFieldsSchema>;

// A row ready to map onto the donors columns for a company donor (snake_case). donor_type is
// forced to 'company' by the caller (one source of truth via the donation), so it is not here.
// The registration number maps onto the existing donors.company_number column (nullable).
export interface CompanyDonorRow {
  business_name: string;
  company_number: string | null;
  full_name: string;
  email: string;
  billing_address: string;
  billing_postcode: string;
}

// Map validated company fields onto the donors columns (REQ-038): the legal name is the
// business_name, the registration number is the company_number (null when omitted), the billing
// contact name/email are the donor full_name/email, and the billing address + postcode are the
// new donors columns. Pure.
export function buildCompanyDonorRow(fields: CompanyFields): CompanyDonorRow {
  return {
    business_name: fields.legalName,
    company_number: fields.registrationNumber ?? null,
    full_name: fields.contactName,
    email: fields.contactEmail,
    billing_address: fields.billingAddress,
    billing_postcode: fields.billingPostcode,
  };
}
