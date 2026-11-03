/* eslint-disable camelcase */

// NBCC Elf Detective School, wave 1: signing up, paying and accounts.
// Designs: docs/superpowers/specs/2026-10-04-elf-detective-school-design.md and
// 2026-11-03-elf-detective-secret-places-design.md.
//
//   elf_settings       one row: the switch (OFF, so this ships dark), the year, and the pay what you
//                      can amounts per detective (from £1, £5 suggested), set in the admin.
//   elf_families       one per grown up's email (stored lower case). Active once a payment settles.
//   elf_detectives     a family's detectives: a first name and a festive surname, never a real
//                      surname, school or age. The first name shows in public only once staff tick
//                      it. A badge number is given when the payment settles.
//   elf_orders         one payment: the entry (never Gift Aided), an optional gift (which can be),
//                      the card fee cover, the Stripe session, and the hash of the token the paying
//                      browser holds so it can be signed in when Stripe sends it back, but only
//                      when this payment opened the family's account (opened_family).
//   elf_sign_in_codes  the emailed 6 digit codes, kept only as keyed hashes (as the fundraisers').
//   elf_sessions       signed in families, kept only as sha256 hashes of the cookie's random id.
//   elf_badge_seq      badge numbers, EDS 0001 upwards.
//
// Additive only: new tables and a sequence, and one check widened to allow the newsletter source
// 'elf' (golden rule 2).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "elf_settings",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1" },
      school_on: { type: "boolean", notNull: true, default: false },
      year: { type: "integer", notNull: true, default: 2026 },
      entry_from_pence: { type: "integer", notNull: true, default: 100, check: "entry_from_pence BETWEEN 100 AND 1000" },
      entry_suggested_pence: { type: "integer", notNull: true, default: 500, check: "entry_suggested_pence BETWEEN 100 AND 5000" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "Elf Detective School settings. One row. Off until an admin turns it on." },
  );
  pgm.sql("INSERT INTO elf_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");

  pgm.createTable(
    "elf_families",
    {
      id: "id",
      email: { type: "text", notNull: true, unique: true }, // lower case, trimmed
      grown_up_name: { type: "text", notNull: true },
      newsletter: { type: "boolean", notNull: true, default: false },
      active: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Elf Detective School families: one per grown up's email." },
  );

  pgm.createTable(
    "elf_detectives",
    {
      id: "id",
      family_id: { type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" },
      first_name: { type: "text", notNull: true },
      surname: { type: "text", notNull: true },
      name_approved: { type: "boolean", notNull: true, default: false },
      badge_number: { type: "integer", unique: true },
      look: { type: "jsonb" },
      fresh: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
      active: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Elf Detective School detectives: first name and festive surname only." },
  );
  pgm.createIndex("elf_detectives", "family_id");

  pgm.createTable(
    "elf_orders",
    {
      id: "id",
      reference: { type: "text", notNull: true, unique: true },
      family_id: { type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" },
      detective_ids: { type: "integer[]", notNull: true },
      entry_pence: { type: "integer", notNull: true, check: "entry_pence > 0" },
      donation_pence: { type: "integer", notNull: true, default: 0, check: "donation_pence >= 0" },
      fee_cover_pence: { type: "integer", notNull: true, default: 0, check: "fee_cover_pence >= 0" },
      gift_aid: { type: "boolean", notNull: true, default: false },
      declaration: { type: "jsonb" }, // the Gift Aid declaration as given, written to declarations once paid
      declaration_id: { type: "integer", references: "declarations", onDelete: "RESTRICT" },
      stripe_session_id: { type: "text", unique: true },
      status: { type: "text", notNull: true, default: "pending", check: "status IN ('pending', 'paid', 'expired')" },
      browser_token_hash: { type: "text" },
      // Set when this payment settled while its family had no other paid order: only then may the
      // paying browser be signed in straight away (src/routes/elf.ts, /elf/welcome).
      opened_family: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      paid_at: { type: "timestamptz" },
    },
    { comment: "Elf Detective School payments: entry, optional gift and card fee cover." },
  );
  pgm.createIndex("elf_orders", "family_id");

  pgm.createTable(
    "elf_sign_in_codes",
    {
      email: { type: "text", primaryKey: true }, // lower case
      code_hash: { type: "text", notNull: true },
      expires_at: { type: "timestamptz", notNull: true },
      attempts: { type: "integer", notNull: true, default: 0 },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Emailed Elf Detective School sign in codes, kept only as keyed hashes." },
  );

  pgm.createTable(
    "elf_sessions",
    {
      session_hash: { type: "text", primaryKey: true }, // sha256 hex of the cookie's random id
      family_id: { type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" },
      expires_at: { type: "timestamptz", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Signed in Elf Detective School families, kept only as sha256 hashes." },
  );
  pgm.createIndex("elf_sessions", "expires_at");

  pgm.sql("CREATE SEQUENCE IF NOT EXISTS elf_badge_seq START 1");

  // A grown up who ticks the newsletter box when enrolling joins the newsletter with consent_source
  // 'elf' (src/newsletter/self-signup.ts). Widening the check is additive: older code never writes it.
  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin', 'fundraise', 'elf')",
  });
};

exports.down = (pgm) => {
  // Back to the narrower set: only safe while no row says 'elf' (down is never run on production).
  pgm.dropConstraint("list_subscribers", "list_subscribers_consent_source_check");
  pgm.addConstraint("list_subscribers", "list_subscribers_consent_source_check", {
    check: "consent_source IN ('footer', 'import', 'admin', 'fundraise')",
  });
  pgm.sql("DROP SEQUENCE IF EXISTS elf_badge_seq");
  pgm.dropTable("elf_sessions");
  pgm.dropTable("elf_sign_in_codes");
  pgm.dropTable("elf_orders");
  pgm.dropTable("elf_detectives");
  pgm.dropTable("elf_families");
  pgm.dropTable("elf_settings");
};
