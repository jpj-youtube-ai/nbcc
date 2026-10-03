/* eslint-disable camelcase */

// Event pages: every approved public event gets its own page at nbcc.scot/event/<short name>, like a
// fundraiser's at /fundraise/<slug>. The short name is the stored slug (one column, unique across
// both kinds, with its history), and staff must set it in the admin before approving an event.
// slug_set_at says when they last did. Additive: one nullable column, so a code rollback is safe.
// Every event already approved or finished keeps the address it has, counted as set, so none is
// stuck. Numbered to sort after keep-in-touch (170) and the two builds alongside it (175, 180).

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", { slug_set_at: { type: "timestamptz" } });
  pgm.sql(
    `UPDATE fundraisers SET slug_set_at = COALESCE(approved_at, updated_at)
      WHERE path = 'event' AND status IN ('approved', 'finished') AND slug_set_at IS NULL`,
  );
};

exports.down = (pgm) => {
  pgm.dropColumns("fundraisers", ["slug_set_at"]);
};
