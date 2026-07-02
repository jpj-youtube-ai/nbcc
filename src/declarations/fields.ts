import { z } from "zod";
import { SCOPES, type Scope, type DeclarationWording } from "./wording";

// The pure, DB-free declaration field-capture validation + row builder (REQ-043). A
// Gift Aid declaration captures the donor's title (optional), first and last name, the
// house name/number as a SEPARATE HMRC matching key, the rest of the ONE home address,
// and a UK postcode — with a non-UK flag (Channel Islands / Isle of Man) that omits the
// postcode. No pool/config/clock, so it is unit-tested DB-free like
// src/db/donations-model.ts and src/declarations/wording.ts. The scope (REQ-044) and the
// verbatim wording (REQ-040) come from their own modules; this validates only the
// captured fields and maps them onto a declarations row (columns per migration
// 1782923222001). Only a HOME address is captured — there is deliberately no work / c-o
// address field, and the strict schema rejects any extra address-type key.

// UK postcode format — the GOV.UK-published pattern (outward code, an optional space,
// then the inward code = one digit + two letters), case-insensitive, plus the GIR 0AA
// special case. A CONTENT/format check only; it is not a live address lookup.
export const UK_POSTCODE_RE =
  /^(GIR ?0AA|(?:[A-Z][0-9]{1,2}|[A-Z][A-HJ-Y][0-9]{1,2}|[A-Z][0-9][A-Z]|[A-Z][A-HJ-Y][0-9][A-Z]?)\s?[0-9][A-Z]{2})$/i;

export function isValidUkPostcode(value: string): boolean {
  return UK_POSTCODE_RE.test(value.trim());
}

// The captured declaration fields (camelCase input). `.strict()` rejects any unknown
// key, so a stray work/c-o address field cannot slip in — there is one home address
// only. houseNameNumber and postcode are validated conditionally on nonUk below.
export const declarationFieldsSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    houseNameNumber: z.string().trim().min(1).optional(),
    address: z.string().trim().min(1), // the rest of the ONE home address
    postcode: z.string().trim().min(1).optional(),
    nonUk: z.boolean().default(false),
    // REQ-044 (TASK-064): the donor's explicit declaration scope, folded in by the give
    // widget. Accepted here (so the strict schema does not reject it) but the backend still
    // derives the persisted scope from the give mode — switching to this value is the next
    // task. Optional so the base declaration (no scope) still validates.
    scope: z.enum(SCOPES).optional(),
  })
  .strict()
  // A UK declaration needs the house name/number (the HMRC matching key); a non-UK
  // declaration may omit it.
  .refine((d) => d.nonUk || (d.houseNameNumber != null && d.houseNameNumber.length > 0), {
    message: "a house name or number is required for a UK declaration",
    path: ["houseNameNumber"],
  })
  // A UK declaration needs a valid UK postcode; a non-UK declaration omits it.
  .refine((d) => d.nonUk || (d.postcode != null && isValidUkPostcode(d.postcode)), {
    message: "a valid UK postcode is required for a UK declaration",
    path: ["postcode"],
  });

export type DeclarationFields = z.infer<typeof declarationFieldsSchema>;

// A row ready to INSERT into declarations (snake_case columns). created_at is left to
// the column default, so this stays pure/clock-free. donor_id, scope and the wording
// snapshot come from the caller (the webhook has the donor, the checkout stamped the
// scope + wording); this maps the captured fields and normalises the non-UK case.
export interface DeclarationRow {
  donor_id: number;
  title: string | null;
  first_name: string;
  last_name: string;
  house_name_number: string;
  address: string;
  postcode: string | null;
  non_uk: boolean;
  scope: Scope;
  wording_version: string;
  wording_snapshot: string;
  confirmed_taxpayer: boolean;
}

// Build the declarations row from validated fields + the donor FK, scope and wording.
// Pure: a non-UK declaration stores no postcode (REQ-043); confirmed_taxpayer defaults
// to false. house_name_number falls back to an empty string for a non-UK declaration
// that omitted it (the column is NOT NULL).
export function buildDeclarationRow(
  fields: DeclarationFields,
  context: {
    donorId: number;
    scope: Scope;
    wording: DeclarationWording;
    confirmedTaxpayer?: boolean;
  },
): DeclarationRow {
  return {
    donor_id: context.donorId,
    title: fields.title ?? null,
    first_name: fields.firstName,
    last_name: fields.lastName,
    house_name_number: fields.houseNameNumber ?? "",
    address: fields.address,
    postcode: fields.nonUk ? null : (fields.postcode ?? null),
    non_uk: fields.nonUk,
    scope: context.scope,
    wording_version: context.wording.wording_version,
    wording_snapshot: context.wording.wording_snapshot,
    confirmed_taxpayer: context.confirmedTaxpayer ?? false,
  };
}
