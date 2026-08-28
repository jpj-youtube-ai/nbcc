/* eslint-disable */
// TASK-311: archive instead of delete.
//
// Three stories were submitted to production, all three were permanently deleted, and nothing in the
// system could say what had gone, when, or why - only that the table was empty. There is no
// automatic purge in the code, so a person pressed a button and the rows ceased to exist. That is
// too sharp an edge for the everyday action on a page of supporters' stories.
//
// `archived_at` makes the routine action reversible: archiving hides a story from the working list
// and puts it behind an "Archived" filter, and un-archiving is one click. Permanent erasure stays
// possible - a charity must be able to honour a GDPR erasure request, and this page exists partly to
// "withdraw it if consent is ever revoked" - but it moves behind the archive and asks for a reason.
//
// Additive and safe on populated data (golden rule 2):
//   • a NEW nullable column with no default, so every existing row keeps working untouched and
//     reads as not-archived;
//   • a partial index covering only archived rows, which is the smaller set and the one the new
//     filter reads;
//   • nothing dropped, renamed, or made NOT NULL. Rolling the code back leaves a column nobody
//     reads, which is harmless.

exports.up = (pgm) => {
  pgm.addColumn("stories", {
    archived_at: {
      type: "timestamptz",
      notNull: false,
      comment:
        "When this story was archived. NULL = live. Archiving is reversible; deletion is not, which is why it is no longer the everyday action.",
    },
  });

  // The list query filters on this constantly (every default view excludes archived rows), and the
  // archived set is the small one - so index that side rather than the whole table.
  pgm.createIndex("stories", "archived_at", {
    name: "stories_archived_at_idx",
    where: "archived_at IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("stories", "archived_at", { name: "stories_archived_at_idx" });
  pgm.dropColumn("stories", "archived_at");
};
