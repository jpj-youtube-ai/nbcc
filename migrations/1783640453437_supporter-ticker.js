/* eslint-disable */
// TASK-178: the supporter_ticker table — an admin-curated list of ongoing supporters (businesses or
// people) shown in a scrolling ticker under the site nav. Distinct from the donor-derived Supporters
// page; these are hand-added by staff. Enough to render + order the ticker and toggle entries on/off.
//
// Additive / expand-contract (golden rule 2): one BRAND-NEW table plus an index. No existing table
// or column is dropped, renamed or made NOT NULL, so a code-level rollback stays safe.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "supporter_ticker",
    {
      id: "id",
      name: { type: "text", notNull: true }, // the supporter's display name (business or person)
      active: { type: "boolean", notNull: true, default: true }, // shown in the ticker when true
      sort_order: { type: "integer", notNull: true, default: 0 }, // lower = earlier; ties break by id
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "Admin-curated ongoing supporters (REQ-003/TASK-178) shown in the site's scrolling ticker.",
    },
  );
  // The public ticker query filters active + orders by sort_order,id — index it.
  pgm.createIndex("supporter_ticker", ["active", "sort_order", "id"]);
};

exports.down = (pgm) => {
  pgm.dropTable("supporter_ticker");
};
