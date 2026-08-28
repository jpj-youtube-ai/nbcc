/* eslint-disable */
// TASK-311: archive instead of delete, for contact enquiries.
//
// The twin of migrations-stories/1786000000000_stories-archive.js, and here for the same reason: the
// everyday tidy-up action on a page of messages from real people should not be irreversible. A
// contact enquiry can be somebody asking for help; losing one to a misplaced click is a worse
// outcome than a slightly longer list.
//
// Additive and safe on populated data (golden rule 2): a NEW nullable column with no default, plus a
// partial index over only the archived rows. Nothing dropped, renamed, or made NOT NULL, so a
// code-level rollback simply leaves a column nobody reads.

exports.up = (pgm) => {
  pgm.addColumn("contact_enquiries", {
    archived_at: {
      type: "timestamptz",
      notNull: false,
      comment:
        "When this enquiry was archived. NULL = live. Archiving is reversible; deletion is not, which is why it is no longer the everyday action.",
    },
  });

  pgm.createIndex("contact_enquiries", "archived_at", {
    name: "contact_enquiries_archived_at_idx",
    where: "archived_at IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("contact_enquiries", "archived_at", { name: "contact_enquiries_archived_at_idx" });
  pgm.dropColumn("contact_enquiries", "archived_at");
};
