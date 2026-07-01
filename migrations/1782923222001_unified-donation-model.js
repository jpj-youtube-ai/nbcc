/* eslint-disable */
// TASK-045 (REQ-036/REQ-037): the unified donation model — the ONE shared data
// model the whole platform writes through. Additive / expand-contract: four brand
// new tables (donors, declarations, donations, audit_log) plus an append-only
// trigger on audit_log. No existing table is touched, so a code-level rollback is
// safe (golden rule 2).
//
// Gift Aid is a FLAG/relationship on the donation (gift_aid boolean + nullable
// declaration_id FK), never a second store (REQ-036). A donation is claimable only
// when the donor is an individual, an active declaration covers it and it is not
// (fully) refunded (REQ-037); company donations are permanently not_eligible
// (REQ-053).
//
// Deliberately NOT built here (separate tasks — named, not implemented): the
// claim_batches + users tables and the one-batch-per-donation / admin-write
// invariants (REQ-037), and REQ-036's Stripe webhook that populates these rows.

exports.shorthands = undefined;

exports.up = (pgm) => {
  // ---- donors: an individual or a company; the person/business behind a gift ----
  pgm.createTable(
    "donors",
    {
      id: "id",
      donor_type: {
        type: "text",
        notNull: true,
        check: "donor_type IN ('individual', 'company')",
      },
      full_name: { type: "text", notNull: true }, // person name, or a company's contact name
      business_name: { type: "text" }, // optional display / legal business name (REQ-038/REQ-053)
      company_number: { type: "text" }, // optional registration number (REQ-053)
      email: { type: "text" }, // optional, consent-based (REQ-039)
      email_consent: { type: "boolean", notNull: true, default: false },
      anonymous: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Donor identity: individual or company (REQ-038/REQ-039/REQ-053)." },
  );

  // ---- declarations: the immutable Gift Aid / HMRC declaration (REQ-040/REQ-043/REQ-046) ----
  pgm.createTable(
    "declarations",
    {
      id: "id",
      donor_id: { type: "integer", notNull: true, references: "donors", onDelete: "RESTRICT" },
      title: { type: "text" }, // optional (REQ-043)
      first_name: { type: "text", notNull: true },
      last_name: { type: "text", notNull: true },
      house_name_number: { type: "text", notNull: true }, // separate HMRC matching key (REQ-043)
      address: { type: "text", notNull: true }, // rest of the home address
      postcode: { type: "text" }, // nullable: a non-UK declaration omits it (REQ-043)
      non_uk: { type: "boolean", notNull: true, default: false },
      scope: {
        type: "text",
        notNull: true,
        check: "scope IN ('this_donation', 'all_donations')", // REQ-044
      },
      wording_version: { type: "text", notNull: true }, // the versioned HMRC wording shown (REQ-040)
      wording_snapshot: { type: "text", notNull: true }, // the exact statement text at that version
      confirmed_taxpayer: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "Immutable Gift Aid / HMRC declaration; the app never updates a saved row (REQ-046).",
    },
  );

  // ---- donations: THE one donation record every channel writes to ----
  pgm.createTable(
    "donations",
    {
      id: "id",
      donor_id: { type: "integer", notNull: true, references: "donors", onDelete: "RESTRICT" },
      // Gift Aid FLAG relationship: the declaration covering this gift, or NULL. NOT
      // a second store — the boolean below plus this FK are the whole of Gift Aid.
      declaration_id: { type: "integer", references: "declarations", onDelete: "RESTRICT" },
      mode: { type: "text", notNull: true, check: "mode IN ('once', 'monthly')" }, // REQ-041
      plan: { type: "text" }, // preset tier for monthly, or NULL for a custom one-off amount
      amount_pence: { type: "integer", notNull: true, check: "amount_pence > 0" },
      currency: { type: "text", notNull: true, default: "GBP" },
      gift_aid: { type: "boolean", notNull: true, default: false }, // the flag (REQ-042)
      refunded_amount_pence: {
        type: "integer",
        notNull: true,
        default: 0,
        check: "refunded_amount_pence >= 0",
      },
      claim_status: {
        type: "text",
        notNull: true,
        default: "not_eligible",
        check: "claim_status IN ('not_eligible', 'eligible', 'batched', 'claimed')", // REQ-037/REQ-052
      },
      payment_channel: {
        type: "text",
        notNull: true,
        default: "online",
        check: "payment_channel IN ('online', 'in_person')", // REQ-048
      },
      stripe_session_id: { type: "text" },
      stripe_payment_intent_id: { type: "text" },
      stripe_subscription_id: { type: "text" },
      stripe_charge_id: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "The single donation record; Gift Aid is a flag + declaration FK (REQ-036)." },
  );
  // Reconciling webhooks look donations up by their Stripe ids.
  pgm.createIndex("donations", "donor_id");
  pgm.createIndex("donations", "stripe_session_id");
  pgm.createIndex("donations", "stripe_payment_intent_id");

  // ---- audit_log: append-only trail; every admin/state write appends one row ----
  pgm.createTable(
    "audit_log",
    {
      id: "id",
      actor: { type: "text", notNull: true }, // who/what performed the action
      action: { type: "text", notNull: true }, // e.g. 'donation.created'
      entity: { type: "text", notNull: true }, // 'donation' | 'donor' | 'declaration' | ...
      entity_id: { type: "integer" }, // the affected row's id (no cross-table FK)
      data: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Append-only audit trail (REQ-037); UPDATE/DELETE are blocked by a trigger." },
  );
  pgm.createIndex("audit_log", ["entity", "entity_id"]);

  // Enforce append-only at the DB level: reject any UPDATE or DELETE on audit rows.
  pgm.sql(`
    CREATE FUNCTION audit_log_block_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
    END;
    $$;
    CREATE TRIGGER audit_log_no_update_delete
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
  `);
};

exports.down = (pgm) => {
  pgm.sql("DROP TRIGGER IF EXISTS audit_log_no_update_delete ON audit_log;");
  pgm.dropTable("audit_log");
  pgm.sql("DROP FUNCTION IF EXISTS audit_log_block_mutation();");
  pgm.dropTable("donations"); // FKs to donors + declarations, so drop first
  pgm.dropTable("declarations"); // FK to donors
  pgm.dropTable("donors");
};
