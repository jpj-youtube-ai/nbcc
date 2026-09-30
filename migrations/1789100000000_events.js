/* eslint-disable camelcase */

// TASK-453: the /events page, built from the admin and switched on and off from it.
//
// Additive only: three brand-new tables, nothing existing touched.
//
//   events_settings  one row, the page switch. OFF by default, so this ships dark: until an admin
//                    turns it on, /events is a 404 and no page offers it in the menu.
//   event_images     pictures and organiser logos uploaded from the admin. Bytes in Postgres,
//                    served by GET /media/events/:id, exactly as newsletter_images is.
//   events           one row per event: a column per field on the admin form.
//
// The enumerated columns carry CHECK constraints that match src/events/model.ts, so a value the
// app would never write cannot be written by anything else either. Picture sources are held to
// the same rule as the validation: an uploaded picture or one of the site's own images, never a
// link to another website.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "events_settings",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1" },
      page_on: { type: "boolean", notNull: true, default: false },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "The Events page switch (TASK-453). One row. Off until an admin turns it on." },
  );
  pgm.sql("INSERT INTO events_settings (id, page_on) VALUES (1, false) ON CONFLICT (id) DO NOTHING");

  pgm.createTable(
    "event_images",
    {
      id: { type: "uuid", primaryKey: true }, // app-supplied crypto.randomUUID(); the uuid is the capability
      mime: { type: "text", notNull: true },
      bytes: { type: "bytea", notNull: true },
      byte_size: { type: "integer", notNull: true },
      uploaded_by: { type: "integer", references: "users", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Pictures and organiser logos for events, served by GET /media/events/:id (TASK-453)." },
  );

  pgm.createTable(
    "events",
    {
      id: "id", // an integer, because audit_log.entity_id is one
      slug: { type: "text", notNull: true, unique: true },
      name: { type: "text", notNull: true },
      subtitle: { type: "text", notNull: true, default: "" },
      gist: { type: "text", notNull: true, default: "" },
      event_date: { type: "date", notNull: true },
      start_time: { type: "time" },
      end_time: { type: "time" },
      time_tbc: { type: "boolean", notNull: true, default: false },
      venue: { type: "text", notNull: true, default: "" },
      town: { type: "text", notNull: true, default: "" },
      address: { type: "text", notNull: true, default: "" },
      access: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
      image_src: { type: "text" },
      image_fit: { type: "text", notNull: true, default: "cover" },
      image_ground: { type: "text", notNull: true, default: "night" },
      image_alt: { type: "text", notNull: true, default: "" },
      cover: { type: "text", notNull: true, default: "crimson" },
      cost_front: { type: "text", notNull: true, default: "" },
      cost_back: { type: "text", notNull: true, default: "" },
      flag: { type: "text", notNull: true, default: "" },
      list_heading: { type: "text", notNull: true, default: "" },
      whats_on: { type: "text", notNull: true, default: "" },
      note: { type: "text", notNull: true, default: "" },
      run_by: { type: "text", notNull: true, default: "nbcc" },
      partner_name: { type: "text", notNull: true, default: "" },
      partner_front: { type: "text", notNull: true, default: "Organised by" },
      partner_credit: { type: "text", notNull: true, default: "Organised by" },
      partner_logo_src: { type: "text" },
      partner_line: { type: "text", notNull: true, default: "" },
      booking_how: { type: "text", notNull: true, default: "site" },
      booking_url: { type: "text", notNull: true, default: "" },
      booking_label: { type: "text", notNull: true, default: "" },
      booking_note: { type: "text", notNull: true, default: "" },
      status: { type: "text", notNull: true, default: "draft" },
      show_from: { type: "date" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      created_by: { type: "text" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "Events on the /events page (TASK-453). Built in the admin; see src/events/model.ts." },
  );

  const checks = {
    events_image_fit_check: "image_fit IN ('cover', 'whole')",
    events_image_ground_check: "image_ground IN ('night', 'cream', 'crimson', 'holly')",
    events_cover_check: "cover IN ('crimson', 'holly', 'maroon')",
    events_flag_check:
      "flag IN ('', 'Spaces limited', 'Selling fast', 'Last few tickets', 'Sold out', 'Free entry', 'Family friendly')",
    events_run_by_check: "run_by IN ('nbcc', 'partner')",
    events_partner_front_check: "partner_front IN ('Organised by', 'Hosted by', 'In partnership with')",
    events_partner_credit_check:
      "partner_credit IN ('Organised by', 'Organised and sponsored by', 'Organised and paid for by', 'Hosted by')",
    events_booking_how_check: "booking_how IN ('site', 'away', 'none')",
    events_status_check: "status IN ('draft', 'live', 'scheduled')",
    events_scheduled_needs_date_check: "status <> 'scheduled' OR show_from IS NOT NULL",
    // An uploaded picture, or one of the site's own images. Never a link to somewhere else.
    events_image_src_check:
      "image_src IS NULL OR image_src ~ '^/media/events/[0-9a-f-]{36}$' OR image_src ~ '^/assets/img/[A-Za-z0-9][A-Za-z0-9._-]*$'",
    events_partner_logo_src_check:
      "partner_logo_src IS NULL OR partner_logo_src ~ '^/media/events/[0-9a-f-]{36}$' OR partner_logo_src ~ '^/assets/img/[A-Za-z0-9][A-Za-z0-9._-]*$'",
  };
  for (const [name, expression] of Object.entries(checks)) {
    pgm.addConstraint("events", name, { check: expression });
  }

  // The page's one query: what is live or scheduled, by date.
  pgm.createIndex("events", ["status", "event_date"]);
};

exports.down = (pgm) => {
  pgm.dropTable("events");
  pgm.dropTable("event_images");
  pgm.dropTable("events_settings");
};
