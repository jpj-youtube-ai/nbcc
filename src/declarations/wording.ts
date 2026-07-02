import { z } from "zod";
import { MODES } from "../db/donations-model";

// The versioned, verbatim HMRC Gift Aid declaration wording — the single source of
// truth for what a donor is shown and agrees to (REQ-040). PURE: no pool/config/
// clock, so it is unit-tested DB-free like src/db/donations-model.ts. A saved
// declaration records the selected `wording_version` + `wording_snapshot` (the exact
// columns on the declarations table, migration 1782923222001) so we always know the
// precise text the donor saw. This module only provides the wording + selection +
// validation; the declaration-capture form/endpoint (REQ-043) and persistence via
// writeWithAudit in src/db/donations.ts are out of scope here.

// declarations.scope (migration check: this_donation | all_donations, REQ-044).
export const SCOPES = ["this_donation", "all_donations"] as const;
export type Scope = (typeof SCOPES)[number];
export type Mode = (typeof MODES)[number];

// What a saved declaration records — keys match the declarations columns exactly.
export interface DeclarationWording {
  wording_version: string;
  wording_snapshot: string;
}

// HMRC's model Gift Aid declaration — single donation. The taxpayer-responsibility
// (liability) sentence is verbatim HMRC wording and is identical across templates;
// only the "which donations" clause differs.
export const SINGLE_DONATION_WORDING: DeclarationWording = {
  wording_version: "hmrc-single-2024-01",
  wording_snapshot:
    "I want to Gift Aid my donation to the Night Before Christmas Campaign. " +
    "I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital " +
    "Gains Tax than the amount of Gift Aid claimed on all my donations in that tax " +
    "year it is my responsibility to pay any difference.",
};

// HMRC's model Gift Aid declaration — multiple / all donations (covers the past four
// years plus present and future gifts). Same liability sentence, enduring scope.
export const ALL_DONATIONS_WORDING: DeclarationWording = {
  wording_version: "hmrc-all-donations-2024-01",
  wording_snapshot:
    "I want to Gift Aid my donation and any donations I make in the future or have " +
    "made in the past 4 years to the Night Before Christmas Campaign. " +
    "I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital " +
    "Gains Tax than the amount of Gift Aid claimed on all my donations in that tax " +
    "year it is my responsibility to pay any difference.",
};

const selectorInputSchema = z.object({
  mode: z.enum(MODES),
  scope: z.enum(SCOPES),
});

// Choose the wording for a gift. The multiple/all-donations template is used for an
// enduring declaration — any monthly gift (which is always enduring, REQ-041) or any
// all_donations scope; the single-donation template is used for a one-off
// this_donation gift. Returns the immutable { wording_version, wording_snapshot } to
// persist on the declaration.
export function selectDeclarationWording(input: { mode: Mode; scope: Scope }): DeclarationWording {
  const { mode, scope } = selectorInputSchema.parse(input);
  const enduring = scope === "all_donations" || mode === "monthly";
  return enduring ? ALL_DONATIONS_WORDING : SINGLE_DONATION_WORDING;
}

// The declaration scope a gift's frequency DEFAULTS to (REQ-041): a monthly gift is
// *enduring* — one declaration covers this and future (and the past four years')
// donations — while a one-off covers just this donation. This is THE single source of
// the mode→scope decision, so the checkout endpoint stamps it as
// metadata.declarationScope AND reuses it to pick the matching verbatim wording (the
// enduring scope maps to the all-donations template) rather than choosing scope twice.
// The capture flow that lets a one-off donor opt into an enduring scope is REQ-043/044,
// not built yet.
export const DECLARATION_SCOPES = ["enduring", "this_donation"] as const;
export type DeclarationScope = (typeof DECLARATION_SCOPES)[number];

export function declarationScopeForMode(mode: Mode): DeclarationScope {
  return mode === "monthly" ? "enduring" : "this_donation";
}

// Collapse a stamped metadata.declarationScope value onto the persisted declarations.scope
// (a Scope, REQ-044). The stamped value is a union: the mode default ("enduring" |
// "this_donation") OR, when the donor makes an explicit choice (REQ-044, TASK-065), the raw
// SCOPES value ("this_donation" | "all_donations"). Both the wording selection (checkout)
// and the persisted row (webhook) map them the SAME way — "enduring" and "all_donations" are
// the all-donations template; anything else is this_donation — so scope collapse is never
// duplicated. Kept next to declarationScopeForMode so the mode→scope decision stays here.
export function scopeFromDeclarationScope(value: string | null | undefined): Scope {
  return value === "enduring" || value === "all_donations" ? "all_donations" : "this_donation";
}

// The full HMRC liability statement requires the taxpayer-responsibility clause —
// naming Income Tax AND Capital Gains Tax AND the responsibility to pay any
// shortfall. A snapshot of just "I am a UK taxpayer" (or any text missing this
// clause) is NOT a valid declaration. This is a CONTENT check, not a length check.
const LIABILITY_MARKERS: RegExp[] = [
  /income tax/i,
  /capital gains tax/i,
  /responsibility to pay/i,
];

export function hasFullLiabilityStatement(snapshot: string): boolean {
  return LIABILITY_MARKERS.every((marker) => marker.test(snapshot));
}

export function assertFullLiabilityStatement(snapshot: string): void {
  if (!hasFullLiabilityStatement(snapshot)) {
    throw new Error(
      "Gift Aid declaration wording is missing the full HMRC liability statement " +
        "(the taxpayer's responsibility to pay any shortfall between Income/Capital " +
        "Gains Tax paid and the Gift Aid all charities reclaim).",
    );
  }
}

// zod refinement form of the same rule, for validating a snapshot before persistence.
export const wordingSnapshotSchema = z
  .string()
  .min(1)
  .refine(hasFullLiabilityStatement, {
    message: "declaration snapshot must contain the full HMRC liability statement",
  });
