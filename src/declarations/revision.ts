import { buildDeclarationRow, type DeclarationFields, type DeclarationRow } from "./fields";
import { selectDeclarationWording, type Scope, type Mode } from "./wording";

// The pure, DB-free declaration REVISION builder (REQ-059 / TASK-128). A declaration edit is split
// by WHAT changed:
//   * a CONSENT change — the scope or the taxpayer confirmation — is immutable (REQ-046): the old
//     row is REVOKED and a corrected row SUPERSEDES it (migration 1783068943728 lays revoked_at /
//     superseded_by_declaration_id).
//   * an IDENTITY / address change (name, house name/number, address, postcode, overseas-address
//     flag) is only an HMRC matching detail, so it AMENDS the enduring declaration in place — no
//     revoke, no new row, just a note in the audit log.
// Revoke-and-supersede on a consent change is NBCC's design choice for a clean audit trail; HMRC
// does NOT require a new declaration for an address change — it permits noting the change on the
// enduring declaration. This module owns ONLY the pure decision + mapping: given the current
// declaration and the newly captured fields, it returns an amend, a revise, or null when nothing
// meaningful changed. NO pool/config — and no ambient clock: the timestamp is INJECTED (`now`), so
// it stays deterministic and unit-tested DB-free like src/db/donations-model.ts. The audited
// transactional write that persists this (reviseDeclaration in src/db/declarations.ts) calls it.

// The comparable subset of the CURRENT declarations row (snake_case columns). Wording is NOT
// compared — a wording-version bump alone is not a donor edit — only the donor-meaningful fields.
export interface CurrentDeclaration {
  id: number;
  donor_id: number;
  title: string | null;
  first_name: string;
  last_name: string;
  house_name_number: string;
  address: string;
  postcode: string | null;
  non_uk: boolean;
  scope: Scope;
  confirmed_taxpayer: boolean;
}

export interface DeclarationRevisionInput {
  current: CurrentDeclaration;
  updated: DeclarationFields; // the newly captured fields (camelCase, already validated)
  scope: Scope; // the new declaration's scope
  confirmedTaxpayer: boolean; // the new taxpayer confirmation
  mode: Mode; // the gift's frequency, to pick the CURRENT verbatim wording
  now: Date; // injected clock — the revocation timestamp
}

// The immutable CONSENT of a declaration — the scope and the taxpayer confirmation. A change here
// is a NEW declaration (revoke the old, insert a superseding one): the donor is agreeing to a
// materially different thing. Immutability protects the consent record, not the address.
const CONSENT_COLUMNS = ["scope", "confirmed_taxpayer"] as const;

// The identity / HMRC MATCHING details (name, house name/number, address, postcode, overseas-address
// flag). A change here is only a matching-detail correction — HMRC lets you note an address change
// and keep the enduring declaration on file — so it AMENDS the existing row in place, no new row.
const MATCHING_COLUMNS = [
  "title",
  "first_name",
  "last_name",
  "house_name_number",
  "address",
  "postcode",
  "non_uk",
] as const;

export type DeclarationMatchingColumns = Pick<DeclarationRow, (typeof MATCHING_COLUMNS)[number]>;

export type DeclarationRevision =
  | {
      kind: "amend";
      declarationId: number;
      changes: DeclarationMatchingColumns;
      changedFields: string[];
    }
  | {
      kind: "revise";
      // The old row to revoke: its id + the revocation timestamp (superseded_by is the new id, set
      // by the writer once the new row is inserted).
      revokedDeclaration: { id: number; revoked_at: Date };
      // The new immutable declarations row, carrying the CURRENT wording_version/snapshot.
      newDeclaration: DeclarationRow;
    };

// Decide the edit. Builds the candidate row (buildDeclarationRow with the CURRENT wording), then
// classifies the diff against the current row:
//   * a CONSENT change (scope / taxpayer confirmation) → "revise": revoke the old row and insert the
//     candidate as a superseding immutable row (the candidate also carries any updated matching
//     fields, so an address changed alongside consent rides along).
//   * only MATCHING changes (name/address/postcode/non-UK) → "amend": update those columns in place
//     on the same row; the consent snapshot (scope/taxpayer/wording/created_at) stays frozen.
//   * nothing meaningful changed → null.
// This amend/revise split is NBCC's design choice; HMRC does not require a new declaration for an
// address change — it permits noting the change on the enduring declaration.
export function buildDeclarationRevision(input: DeclarationRevisionInput): DeclarationRevision | null {
  const { current, updated, scope, confirmedTaxpayer, mode, now } = input;
  const wording = selectDeclarationWording({ mode, scope });
  const candidate = buildDeclarationRow(updated, {
    donorId: current.donor_id,
    scope,
    wording,
    confirmedTaxpayer,
  });

  const consentChanged = CONSENT_COLUMNS.some((col) => candidate[col] !== current[col]);
  if (consentChanged) {
    return { kind: "revise", revokedDeclaration: { id: current.id, revoked_at: now }, newDeclaration: candidate };
  }

  const changedFields = MATCHING_COLUMNS.filter((col) => candidate[col] !== current[col]);
  if (changedFields.length === 0) return null;

  const changes = Object.fromEntries(
    MATCHING_COLUMNS.map((col) => [col, candidate[col]]),
  ) as DeclarationMatchingColumns;
  return { kind: "amend", declarationId: current.id, changes, changedFields: [...changedFields] };
}
