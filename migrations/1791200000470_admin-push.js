/* eslint-disable camelcase */

// Admin phone notifications: which phones to buzz, what each person wants, and how far each has
// been told. Design: docs/superpowers/specs/2026-11-12-admin-phone-app-design.md.
//
//   admin_push_subscriptions  one row per phone that has been turned on, per person. Deleted with
//                             the person, so somebody who leaves stops being buzzed.
//   admin_notify_prefs        the calm-it-down switches. Absent means "everything on", which is
//                             what Jaimie asked for, so nothing has to write a row to get it.
//   admin_notified            how far each person has been told, per area. Deliberately the same
//                             shape and naming as admin_seen (the New pills' own table): this is
//                             the same idea of "new to you", just for the phone rather than the
//                             screen, and the sweep CLAIMS a row here so two tasks cannot both
//                             send the same arrival.
//
// Additive: three new tables, nothing existing touched.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "admin_push_subscriptions",
    {
      id: "id",
      user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
      // The push service's URL for this phone. Unique because re-subscribing the same phone must
      // replace the row rather than buzz it twice.
      endpoint: { type: "text", notNull: true, unique: true },
      // The subscriber's public key and auth secret, base64url as the browser gives them.
      p256dh: { type: "text", notNull: true },
      auth: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      last_ok_at: { type: "timestamptz" },
      // Consecutive failures that were NOT a 404/410. A gone subscription is deleted outright;
      // this counts the wobbles, so a persistently broken one can be found and looked at.
      failures: { type: "integer", notNull: true, default: 0 },
    },
    { comment: "One phone that has turned admin notifications on (TASK-619)." },
  );

  pgm.createIndex("admin_push_subscriptions", "user_id");

  pgm.createTable(
    "admin_notify_prefs",
    {
      user_id: { type: "integer", primaryKey: true, references: "users", onDelete: "CASCADE" },
      // Off by default: Jaimie asked for a buzz every time, and the switch exists so changing her
      // mind costs a tap rather than another piece of work.
      bundle: { type: "boolean", notNull: true, default: false },
      // Both null means no quiet hours. An arrival inside them is dropped, not held: the New pill
      // still shows it, and production runs one task that restarts on every deploy, so nothing
      // held in memory could be trusted to flush.
      quiet_from: { type: "time" },
      quiet_to: { type: "time" },
      // Areas this person does not want on their phone. Empty means all of them.
      areas_off: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    { comment: "Per person: bundling, quiet hours and which areas never buzz (TASK-619)." },
  );

  pgm.createTable(
    "admin_notified",
    {
      user_id: { type: "integer", notNull: true, references: "users", onDelete: "CASCADE" },
      area: { type: "text", notNull: true },
      notified_at: { type: "timestamptz", notNull: true },
    },
    { comment: "How far each person has been notified, per area. The sweep claims a row (TASK-619)." },
  );

  pgm.addConstraint("admin_notified", "admin_notified_pkey", { primaryKey: ["user_id", "area"] });
};

exports.down = (pgm) => {
  pgm.dropTable("admin_notified");
  pgm.dropTable("admin_notify_prefs");
  pgm.dropTable("admin_push_subscriptions");
};
