// Pure, DB-free row builder + CSV serializer for the HMRC Charities Online Gift Aid claim
// export (REQ-052). Like src/declarations/fields.ts and src/declarations/render.ts it touches
// nothing external — no pool, no config, no clock (it formats an already-persisted
// created_at, never `now()`), so it is unit-tested in isolation. It is READ-ONLY formatting:
// it maps an ALREADY-ELIGIBLE donation + its linked declarations row onto the exact Charities
// Online columns, sourcing only existing columns (declarations.title/first_name/last_name/
// house_name_number/postcode and donations.created_at/amount_pence) — no new columns.
//
// Eligibility is NOT re-derived here: the caller (the REQ-052 claim pipeline) is responsible
// for passing only rows that satisfy the claim invariant (individual donor, active
// declaration, not refunded — deriveClaimStatus in src/db/donations-model.ts). This builder
// only formats and, as a safety net, THROWS on a row missing a required declaration field so a
// blank HMRC column can never be emitted silently.

// The Charities Online columns, in HMRC's expected order. Exported so the serializer and any
// caller share the one ordering (never re-listed).
export const CHARITIES_ONLINE_COLUMNS = [
  "Title",
  "First name",
  "Last name",
  "House name/number",
  "Postcode",
  "Donation date",
  "Amount",
] as const;

export type CharitiesOnlineColumn = (typeof CHARITIES_ONLINE_COLUMNS)[number];
export type CharitiesOnlineRow = Record<CharitiesOnlineColumn, string>;

// The subset of the declarations row this export reads (REQ-043 columns). Title is optional
// (HMRC allows a blank title); the rest are required HMRC matching keys.
export interface ClaimDeclaration {
  title: string | null;
  first_name: string;
  last_name: string;
  house_name_number: string;
  postcode: string | null;
}

// The subset of the donations row this export reads (REQ-036 columns). created_at is the
// gift's timestamp (a Date, or an ISO string as pg may hand back); amount_pence is the integer
// pence charged.
export interface ClaimDonation {
  created_at: Date | string;
  amount_pence: number;
}

// A donation paired with the declaration covering it — one claimable gift. TWO donations may
// share the SAME declaration (an enduring monthly declaration covers every charge on the
// subscription), so each pairing is independent and yields its own row.
export interface ClaimRowInput {
  donation: ClaimDonation;
  declaration: ClaimDeclaration;
}

// A required Charities Online field was missing/blank on an input row (a defensive guard — the
// caller should only pass pre-filtered eligible rows). Typed like the other domain errors so a
// caller can branch on it rather than a bare Error.
export class CharitiesOnlineExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharitiesOnlineExportError";
  }
}

function requireField(value: string | null | undefined, field: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) {
    throw new CharitiesOnlineExportError(`Charities Online export: missing required field '${field}'`);
  }
  return trimmed;
}

// Format a persisted timestamp as Charities Online's expected DD/MM/YYYY. Uses UTC components
// so the calendar date is stable regardless of the runtime timezone. Pure — it formats the
// given instant, never the current time.
function formatDonationDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CharitiesOnlineExportError("Charities Online export: invalid donation date");
  }
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getUTCFullYear()).padStart(4, "0");
  return `${dd}/${mm}/${yyyy}`;
}

// Format pence as a plain decimal GBP amount (two decimal places), NEVER pence: 5000 → "50.00".
function formatAmount(amountPence: number): string {
  if (!Number.isFinite(amountPence) || !Number.isInteger(amountPence) || amountPence <= 0) {
    throw new CharitiesOnlineExportError(
      `Charities Online export: invalid amount_pence '${amountPence}'`,
    );
  }
  return (amountPence / 100).toFixed(2);
}

// Map ONE eligible donation + declaration pair onto the seven Charities Online columns, in
// order. Title is passed through (blank allowed); the other declaration fields are required and
// a missing one THROWS. Read-only: no eligibility is re-derived, only formatting.
export function buildCharitiesOnlineRow(input: ClaimRowInput): CharitiesOnlineRow {
  const { donation, declaration } = input;
  return {
    Title: typeof declaration.title === "string" ? declaration.title.trim() : "",
    "First name": requireField(declaration.first_name, "First name"),
    "Last name": requireField(declaration.last_name, "Last name"),
    "House name/number": requireField(declaration.house_name_number, "House name/number"),
    Postcode: requireField(declaration.postcode, "Postcode"),
    "Donation date": formatDonationDate(donation.created_at),
    Amount: formatAmount(donation.amount_pence),
  };
}

// The row's cells in column order, for CSV/tabular output — never re-list the order.
export function charitiesOnlineCells(row: CharitiesOnlineRow): string[] {
  return CHARITIES_ONLINE_COLUMNS.map((column) => row[column]);
}

// Minimal RFC-4180 CSV field escaping: quote a field that contains a comma, quote or newline,
// doubling any embedded quote. Mirrors the plain-string building style of
// src/declarations/render.ts (no CSV dependency).
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Serialize eligible donations to a Charities Online CSV: a header row of the column names,
// then ONE row per donation (two gifts sharing one declaration each get their own row). Any
// row missing a required field throws (via buildCharitiesOnlineRow), so a blank HMRC column is
// never emitted. Lines are CRLF-joined per RFC 4180.
export function toCharitiesOnlineCsv(inputs: ClaimRowInput[]): string {
  const lines = [CHARITIES_ONLINE_COLUMNS.map(csvField).join(",")];
  for (const input of inputs) {
    lines.push(charitiesOnlineCells(buildCharitiesOnlineRow(input)).map(csvField).join(","));
  }
  return lines.join("\r\n");
}
