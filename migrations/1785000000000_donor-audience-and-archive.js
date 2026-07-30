/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1784900000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-270: make the donor audience explicit, and let an audience be retired.
//
// Until now "donors" was not an audience at all. Consenting donors were spliced into a send only when
// the chosen list's slug happened to be the literal string 'newsletter' (src/db/newsletters.ts). That
// hid a promise the admin screen could not show, broke silently if the row were ever renamed, and
// left no way to mail donors ALONE — which is exactly what the charity needs when a message suits
// donors but not volunteers.
//
//   kind        — what a list MEANS, replacing that slug-string special case:
//                   'manual'   exactly the people on it (Volunteers, Partners, Referrers)
//                   'donors'   every donor with email consent, resolved live — never hand-managed
//                   'everyone' that list's own members PLUS the donors (the 'Newsletter' audience)
//   archived_at — retiring an audience is a TOMBSTONE, like an unsubscribe: it leaves the pickers so
//                 nothing can be sent to it, while past sends keep their audience label and the
//                 membership rows survive as consent history. Never a delete.
//
// Additive: two columns (one defaulted, one nullable) and one seeded row.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("subscriber_lists", {
    kind: {
      type: "text",
      notNull: true,
      default: "manual",
      check: "kind IN ('manual', 'donors', 'everyone')",
    },
    archived_at: { type: "timestamptz" },
  });
  // 'newsletter' has always meant "its own members plus consenting donors" — this just names it.
  pgm.sql(`UPDATE subscriber_lists SET kind = 'everyone' WHERE slug = 'newsletter'`);
  // The donors-only audience. ON CONFLICT so a re-run, or an admin who already made a 'Donors' list
  // by hand, converges instead of failing.
  pgm.sql(`INSERT INTO subscriber_lists (slug, name, kind) VALUES ('donors', 'Donors', 'donors')
             ON CONFLICT (slug) DO UPDATE SET kind = 'donors'`);
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM subscriber_lists WHERE slug = 'donors'`);
  pgm.dropColumns("subscriber_lists", ["kind", "archived_at"]);
};
