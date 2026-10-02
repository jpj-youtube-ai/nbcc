/* eslint-disable camelcase */

// TASK-493: community fundraising, stage 1. See
// docs/superpowers/specs/2026-10-02-community-fundraising-design.md, "Data".
//
// Additive only: five brand new tables and five new columns on donations, each nullable or with
// a default, so the rows already there are untouched and a code rollback stays safe.
//
//   fundraising_settings      one row, the switch. OFF by default, so this ships dark.
//   fundraisers               one row per sign up from /fundraise: what it is, who is behind it,
//                             what they would like from us, and where it is in approval.
//   fundraiser_edits          a change an organiser asked for through their emailed link. It waits
//                             for staff; approving it copies it onto the fundraiser.
//   fundraiser_manage_tokens  the emailed manage links. Only the sha256 of each is kept, so a copy
//                             of this table opens nothing.
//   fundraiser_cash           money paid in by hand (buckets, cheques), added by staff with a note.
//   donations.*               which fundraiser's page a gift was made on, and its supporter wall
//                             entry: the message, show my name, show the amount, hidden by staff.
//
// The enumerated columns carry CHECK constraints that match src/fundraising/model.ts, and a
// picture is held to the same rule as an event's: one uploaded here, never a link elsewhere.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraising_settings",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1" },
      page_on: { type: "boolean", notNull: true, default: false },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "The community fundraising switch (TASK-493). One row. Off until an admin turns it on." },
  );
  pgm.sql("INSERT INTO fundraising_settings (id, page_on) VALUES (1, false) ON CONFLICT (id) DO NOTHING");

  pgm.createTable(
    "fundraisers",
    {
      id: "id", // an integer, because audit_log.entity_id is one
      slug: { type: "text", notNull: true, unique: true },
      path: { type: "text", notNull: true },
      kind: { type: "text", notNull: true },
      title: { type: "text", notNull: true },
      description: { type: "text", notNull: true, default: "" },
      event_date: { type: "date" },
      start_time: { type: "time" },
      venue: { type: "text", notNull: true, default: "" },
      town: { type: "text", notNull: true, default: "" },
      target_pence: { type: "integer" },
      public: { type: "boolean", notNull: true, default: false },
      status: { type: "text", notNull: true, default: "new" },
      organiser_name: { type: "text", notNull: true },
      organiser_email: { type: "text", notNull: true },
      organiser_phone: { type: "text", notNull: true },
      social_link: { type: "text" },
      social_ok: { type: "boolean", notNull: true, default: false },
      wants: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
      post_address: { type: "text" },
      newsletter_ok: { type: "boolean", notNull: true, default: false },
      image_src: { type: "text" },
      declined_reason: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      approved_at: { type: "timestamptz" },
      approved_by: { type: "text" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "Community fundraisers and events signed up at /fundraise (TASK-493)." },
  );
  const checks = {
    fundraisers_path_check: "path IN ('raising', 'event')",
    fundraisers_kind_check:
      "kind IN ('run_walk', 'santa_dash', 'bake_sale', 'quiz_party', 'collection', 'birthday', 'other')",
    fundraisers_status_check: "status IN ('new', 'approved', 'declined', 'finished')",
    fundraisers_target_check: "target_pence IS NULL OR (target_pence >= 1000 AND target_pence <= 10000000)",
    fundraisers_slug_check: "slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'",
    fundraisers_image_src_check:
      "image_src IS NULL OR image_src ~ '^/media/events/[0-9a-f-]{36}$' OR image_src ~ '^/assets/img/[A-Za-z0-9][A-Za-z0-9._-]*$'",
  };
  for (const [name, check] of Object.entries(checks)) pgm.addConstraint("fundraisers", name, { check });
  // Get involved's one query: what is approved and public.
  pgm.createIndex("fundraisers", ["status", "public"]);
  pgm.createIndex("fundraisers", "organiser_email");

  pgm.createTable(
    "fundraiser_edits",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      changes: { type: "jsonb", notNull: true },
      status: { type: "text", notNull: true, default: "waiting" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
      decided_by: { type: "text" },
    },
    { comment: "Changes an organiser asked for by their manage link, waiting for staff (TASK-493)." },
  );
  pgm.addConstraint("fundraiser_edits", "fundraiser_edits_status_check", {
    check: "status IN ('waiting', 'approved', 'rejected')",
  });
  pgm.createIndex("fundraiser_edits", ["fundraiser_id", "status"]);

  pgm.createTable(
    "fundraiser_manage_tokens",
    {
      token_hash: { type: "text", primaryKey: true }, // sha256 hex of the emailed token
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      expires_at: { type: "timestamptz", notNull: true },
      used_at: { type: "timestamptz" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Emailed 24 hour manage links, kept only as sha256 hashes (TASK-493)." },
  );
  pgm.createIndex("fundraiser_manage_tokens", "fundraiser_id");

  pgm.createTable(
    "fundraiser_cash",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      amount_pence: { type: "integer", notNull: true, check: "amount_pence > 0" },
      paid_in_on: { type: "date", notNull: true },
      note: { type: "text", notNull: true, default: "" },
      created_by: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Cash and cheques paid in for a fundraiser, added by staff (TASK-493)." },
  );
  pgm.createIndex("fundraiser_cash", "fundraiser_id");

  pgm.addColumns("donations", {
    fundraiser_id: { type: "integer", references: "fundraisers", onDelete: "SET NULL" },
    supporter_message: { type: "text" },
    show_name: { type: "boolean", notNull: true, default: true },
    show_amount: { type: "boolean", notNull: true, default: true },
    message_hidden: { type: "boolean", notNull: true, default: false },
  });
  pgm.createIndex("donations", "fundraiser_id", { where: "fundraiser_id IS NOT NULL" });
};

exports.down = (pgm) => {
  pgm.dropColumns("donations", ["fundraiser_id", "supporter_message", "show_name", "show_amount", "message_hidden"]);
  pgm.dropTable("fundraiser_cash");
  pgm.dropTable("fundraiser_manage_tokens");
  pgm.dropTable("fundraiser_edits");
  pgm.dropTable("fundraisers");
  pgm.dropTable("fundraising_settings");
};
