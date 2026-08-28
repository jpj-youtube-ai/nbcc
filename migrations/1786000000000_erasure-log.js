/* eslint-disable */
// TASK-311: a permanent record that something was erased - without keeping the thing itself.
//
// Three stories vanished from production and nothing could say what had gone, when, or why. The
// table was simply empty. Archiving (see migrations-stories/1786000000000_stories-archive.js) fixes
// the everyday case by making the routine action reversible, but permanent erasure has to remain
// possible: a charity must be able to honour a GDPR erasure request, and the Stories page exists
// partly to "withdraw it if consent is ever revoked".
//
// So erasure keeps a tombstone. Afterwards you can still answer "what happened to that submission?"
// even though the submission is gone.
//
// WHAT THIS TABLE MUST NEVER HOLD: the erased content, or the person's name, email, phone or town.
// Erasure that quietly kept a copy of the personal data in another table would not be erasure at
// all - it would be a compliance failure wearing an audit trail's clothes. The columns here are
// deliberately only: which KIND of record, its numeric id, when, which admin did it, and a reason
// they typed. The reason is free text written by staff, so guidance in the UI (not a schema rule)
// keeps names out of it.
//
// It lives in the MAIN database on purpose. Stories and contact enquiries each sit in their own
// database, and a log kept alongside them would be erased by the very cascade it exists to survive.
//
// Additive: a brand-new table, so nothing existing is touched (golden rule 2).

exports.up = (pgm) => {
  pgm.createTable("erasure_log", {
    id: "id",
    // Which page the record came from. Text rather than an enum so a future page needs no migration
    // to start logging; the CHECK below still keeps today's values honest.
    record_kind: { type: "text", notNull: true },
    // The id the record had in ITS OWN database. Not a foreign key - the row it pointed at is gone,
    // and in another database besides.
    record_id: { type: "integer", notNull: true },
    erased_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    // The signed-in admin who did it. Answering "who" is half the point of the record.
    erased_by: { type: "text", notNull: true },
    // Required, and required at the API too: an erasure with no stated reason is the situation this
    // whole table exists to prevent.
    reason: { type: "text", notNull: true },
  });

  pgm.addConstraint("erasure_log", "erasure_log_record_kind_check", {
    check: "record_kind IN ('story', 'contact_enquiry')",
  });

  // The view reads newest-first, and that is the only way it is ever read.
  pgm.createIndex("erasure_log", [{ name: "erased_at", sort: "DESC" }], {
    name: "erasure_log_erased_at_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("erasure_log");
};
