/* eslint-disable camelcase */

// Site addressing (site-pages feature): admin-managed spare addresses (aliases) and per-page
// search-engine visibility overrides. Additive only (expand-contract, golden rule 2).
//
// site_aliases seeds the approved day-one list here rather than in code, so the admin panel is
// the single owner from the first boot: what staff see in the table IS what the router serves,
// with no invisible baseline underneath it. ON CONFLICT keeps the seed idempotent for a re-run.

const DEFAULT_ALIASES = [
  ["/about", "/about-us"],
  ["/mystory", "/my-story"],
  ["/contact-us", "/contact"],
  ["/donations", "/donate"],
  ["/give", "/donate"],
  ["/portal", "/donor-portal"],
  ["/privacy-policy", "/privacy"],
  ["/supporter", "/supporters"],
  ["/story", "/my-story"],
  ["/stories", "/my-story"],
];

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("site_aliases", {
    id: "id",
    from_path: { type: "text", notNull: true, unique: true },
    to_path: { type: "text", notNull: true },
    created_by: { type: "text", notNull: true, default: "seed" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Per-page override of the registry's listed-by-default flag (src/site/pages.ts). A row
  // exists only where an admin has made a choice; absence means "use the default".
  pgm.createTable("site_page_seo", {
    page_path: { type: "text", primaryKey: true },
    listed: { type: "boolean", notNull: true },
    updated_by: { type: "text", notNull: true },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  for (const [from, to] of DEFAULT_ALIASES) {
    pgm.sql(
      `INSERT INTO site_aliases (from_path, to_path) VALUES ('${from}', '${to}')
       ON CONFLICT (from_path) DO NOTHING`,
    );
  }
};

exports.down = (pgm) => {
  pgm.dropTable("site_aliases");
  pgm.dropTable("site_page_seo");
};
