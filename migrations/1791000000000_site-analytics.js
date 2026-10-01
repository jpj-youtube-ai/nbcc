/* eslint-disable camelcase */

// TASK-479: site analytics (docs/superpowers/specs/2026-09-30-site-analytics-design.md).
//
// Additive only: four brand-new tables, nothing existing touched. Numbers only: no table here holds
// an IP address, a user agent, a full referring address or a query string.
//
//   analytics_settings  one row, the switch. OFF by default, so this ships dark: nothing is kept
//                       until an admin turns it on.
//   analytics_salts     one random salt per UK day, for making that day's visitor ids. The daily
//                       job deletes every salt older than today, so an id cannot be made again.
//   analytics_views     one row per page view: the page, the daily visitor id, where they came from,
//                       roughly where they are, what they used, and how long and how far they read.
//   analytics_clicks    the clicks that matter (donate, tickets, phone, email, downloads, links to
//                       other websites), each against its view.
//
// Views and clicks are kept 13 months (src/scripts/send-reminders.ts prunes them). The enumerated
// columns carry CHECK constraints matching src/analytics/, so nothing else can write a value the
// app never would.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "analytics_settings",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1" },
      collecting: { type: "boolean", notNull: true, default: false },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    { comment: "The site analytics switch (TASK-479). One row. Off until an admin turns it on." },
  );
  pgm.sql("INSERT INTO analytics_settings (id, collecting) VALUES (1, false) ON CONFLICT (id) DO NOTHING");

  pgm.createTable(
    "analytics_salts",
    {
      day: { type: "date", primaryKey: true },
      salt: { type: "text", notNull: true },
    },
    { comment: "Today's random salt for daily visitor ids (TASK-479). Older days are deleted each morning." },
  );

  pgm.createTable(
    "analytics_views",
    {
      id: "id",
      view_id: { type: "text", notNull: true, unique: true },
      at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      day: { type: "date", notNull: true },
      path: { type: "text", notNull: true },
      visitor: { type: "text", notNull: true },
      channel: {
        type: "text",
        notNull: true,
        check: "channel IN ('newsletter', 'email', 'search', 'social', 'other_websites', 'direct')",
      },
      source: { type: "text" },
      campaign: { type: "text" },
      country: { type: "text" },
      region: { type: "text" },
      city: { type: "text" },
      device: { type: "text", notNull: true, check: "device IN ('phone', 'tablet', 'computer')" },
      browser: { type: "text", notNull: true },
      os: { type: "text", notNull: true },
      active_seconds: { type: "integer", check: "active_seconds BETWEEN 0 AND 1800" },
      max_scroll: { type: "integer", check: "max_scroll BETWEEN 0 AND 100" },
    },
    { comment: "One row per counted page view (TASK-479). No IP address or user agent is stored." },
  );
  pgm.createIndex("analytics_views", "day");
  pgm.createIndex("analytics_views", ["day", "visitor"]);

  pgm.createTable(
    "analytics_clicks",
    {
      id: "id",
      view_id: { type: "text", notNull: true },
      at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      day: { type: "date", notNull: true },
      kind: {
        type: "text",
        notNull: true,
        check: "kind IN ('donate', 'tickets', 'phone', 'email', 'download', 'outbound')",
      },
      label: { type: "text", notNull: true, default: "" },
    },
    { comment: "Clicks that matter, each against its counted view (TASK-479)." },
  );
  pgm.createIndex("analytics_clicks", "day");
};

exports.down = (pgm) => {
  pgm.dropTable("analytics_clicks");
  pgm.dropTable("analytics_views");
  pgm.dropTable("analytics_salts");
  pgm.dropTable("analytics_settings");
};
