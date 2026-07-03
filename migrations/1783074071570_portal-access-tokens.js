/* eslint-disable */
// TASK-100 (REQ-061): the self-serve donor portal is entered via a passwordless "magic link" — a
// one-time, expiring token emailed to the donor. This migration lays the token store. Additive /
// expand-contract: one brand-new table, no existing table touched, so a code-level rollback stays
// safe (golden rule 2). Independent of the earlier additive migrations (order between them does not
// matter). Mirrors the nullable-token + lifecycle-column style of 1783010739790.
//
// donor_id FK is ON DELETE CASCADE: a token is worthless once its donor is gone, so it is cleaned up
// with the donor (unlike the RESTRICT FKs elsewhere, which protect referenced financial rows). token
// is UNIQUE (it addresses exactly one grant). expires_at bounds the link's life; used_at is NULL
// until the link is consumed (one-time use). The pure token logic lives in src/portal/tokens.ts and
// the audited issue/consume writes in src/db/portal.ts.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "portal_access_tokens",
    {
      id: "id",
      donor_id: { type: "integer", notNull: true, references: "donors", onDelete: "CASCADE" },
      token: { type: "text", notNull: true, unique: true },
      expires_at: { type: "timestamptz", notNull: true },
      used_at: { type: "timestamptz" }, // NULL until the one-time link is consumed
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "One-time, expiring magic-link tokens for the self-serve donor portal (REQ-061)." },
  );
  // token is already indexed by its UNIQUE constraint; index donor_id for per-donor lookups.
  pgm.createIndex("portal_access_tokens", "donor_id");
};

exports.down = (pgm) => {
  pgm.dropTable("portal_access_tokens");
};
