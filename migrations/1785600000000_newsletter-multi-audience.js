/* eslint-disable camelcase */

// TASK-288: a newsletter can go to several audiences at once.
//
// EXPAND ONLY. `list_id` is left exactly as it is and keeps being written with the FIRST chosen
// audience, so every existing read — the history table, the stats panel, listNewsletters' join —
// works untouched on old and new rows alike. The new column is additive and nullable: a row written
// before this migration simply has NULL, which reads as "one audience, see list_id".
//
// Dropping list_id belongs in a LATER release, once nothing reads it. Not here.

exports.up = (pgm) => {
  pgm.addColumn("newsletters", {
    list_ids: {
      type: "integer[]",
      notNull: false,
      comment:
        "TASK-288: every audience this newsletter was sent to, in the order chosen. NULL on rows " +
        "predating multi-audience sends, where list_id is the whole answer. list_id continues to " +
        "hold the first entry so existing reads keep working.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("newsletters", "list_ids");
};
