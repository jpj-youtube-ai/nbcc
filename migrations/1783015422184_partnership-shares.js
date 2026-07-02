/* eslint-disable */
// TASK-079 (REQ-051): the partnership Gift Aid share data model — the join table that
// lets MANY declarations cover ONE donation (one declaration per partner, each with the
// share of the gift attributed to that partner), instead of the single
// donations.declaration_id FK used for individuals/companies. Additive / expand-contract:
// one brand-new table, no existing donors/declarations/donations column dropped, renamed
// or made NOT NULL, so a code-level rollback stays safe (golden rule 2). Independent of
// the earlier additive migrations (order between them does not matter).
//
// The checkout flow that collects the per-partner declarations + shares (REQ-051) and the
// eligibility/claim logic that reads them are NOT built here — this only lays the shared
// model rows they will write through. The pure validator that shares must sum EXACTLY to
// the donation total lives in src/declarations/partnership.ts.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---- donation_partner_shares: one partner's declaration + share of a donation ----
  // donation_id groups the partners of a single partnership gift; declaration_id is that
  // partner's own immutable Gift Aid declaration (REQ-046). share_pence is the amount of
  // the donation attributed to this partner; the shares of a donation must sum EXACTLY to
  // donations.amount_pence (enforced by the pure validator, not a DB constraint, because
  // the invariant spans rows). Both FKs are indexed and RESTRICT so a referenced donation
  // or declaration cannot be deleted while a share points at it.
  pgm.createTable(
    "donation_partner_shares",
    {
      id: "id",
      donation_id: { type: "integer", notNull: true, references: "donations", onDelete: "RESTRICT" },
      declaration_id: {
        type: "integer",
        notNull: true,
        references: "declarations",
        onDelete: "RESTRICT",
      },
      share_pence: { type: "integer", notNull: true, check: "share_pence > 0" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "One partner's declaration + share of a partnership donation; shares sum to the total (REQ-051).",
    },
  );
  pgm.createIndex("donation_partner_shares", "donation_id");
  pgm.createIndex("donation_partner_shares", "declaration_id");
};

exports.down = (pgm) => {
  pgm.dropTable("donation_partner_shares");
};
