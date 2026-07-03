import { buildDeclarationRow, type DeclarationFields, type DeclarationRow } from "./fields";
import { selectDeclarationWording, type Scope, type Mode } from "./wording";

// The pure, DB-free declaration REVISION builder (REQ-059). A Gift Aid declaration is immutable
// (REQ-046) — editing it never mutates the saved row; instead the old row is REVOKED and a new,
// corrected row SUPERSEDES it (migration 1783068943728 lays revoked_at / superseded_by_declaration_id).
// This module owns ONLY the pure decision + mapping: given the current declaration and the newly
// captured fields, it returns the revoke-old + insert-new pair, or null when nothing meaningful
// changed. NO pool/config — and no ambient clock: the timestamp is INJECTED (`now`), so it stays
// deterministic and unit-tested DB-free like src/db/donations-model.ts. The audited transactional
// write that persists this (reviseDeclaration in src/db/declarations.ts) calls it.

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

export interface DeclarationRevision {
  // The old row to revoke: its id + the revocation timestamp (superseded_by is the new id, set by
  // the writer once the new row is inserted).
  revokedDeclaration: { id: number; revoked_at: Date };
  // The new immutable declarations row, carrying the CURRENT wording_version/snapshot.
  newDeclaration: DeclarationRow;
}

// The donor-meaningful columns compared to decide whether a revision is needed (name, address,
// postcode, scope, non-UK flag, taxpayer confirmation). Both a DeclarationRow and a
// CurrentDeclaration carry these keys, so the candidate can be diffed against the current row.
const COMPARED_COLUMNS = [
  "title",
  "first_name",
  "last_name",
  "house_name_number",
  "address",
  "postcode",
  "non_uk",
  "scope",
  "confirmed_taxpayer",
] as const;

// Decide the revision. Builds the candidate new row (buildDeclarationRow with the CURRENT wording
// from selectDeclarationWording), then diffs it against the current row on the meaningful columns:
// identical → null (a no-op, nothing to revise); any change → the revoke-old + insert-new pair.
export function buildDeclarationRevision(input: DeclarationRevisionInput): DeclarationRevision | null {
  const { current, updated, scope, confirmedTaxpayer, mode, now } = input;
  const wording = selectDeclarationWording({ mode, scope });
  const candidate = buildDeclarationRow(updated, {
    donorId: current.donor_id,
    scope,
    wording,
    confirmedTaxpayer,
  });

  const unchanged = COMPARED_COLUMNS.every((col) => candidate[col] === current[col]);
  if (unchanged) return null;

  return {
    revokedDeclaration: { id: current.id, revoked_at: now },
    newDeclaration: candidate,
  };
}
