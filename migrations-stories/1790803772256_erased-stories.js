/* eslint-disable */
// TASK-475: an erased story stays erased, even if the old website's export is added again.
//
// The import from the old website (TASK-461) recognises a story by the moment it was sent and its
// exact words, and leaves out any it finds already here. An erased story is not here, so the same
// file would bring it straight back. This table remembers each erased story by a one way
// fingerprint: the sha256, in hex, of that same identity. The import leaves out anything whose
// fingerprint is remembered.
//
// WHAT THIS MUST NEVER CARRY: the story, or anything about the person. Only the fingerprint, and
// when it was taken. A sha256 cannot be turned back into the words; it can only say "this exact
// story, sent at this exact moment, was erased" to someone who already holds the story. The CHECK
// below refuses anything that is not a sha256 in hex, so nothing readable can be put here by
// mistake. There is no story id either: linking it to erasure_log (main database) would add nothing.
//
// It lives in the STORIES database, beside the stories it guards, so the erase and the remembering
// happen in one transaction (src/db/stories.ts deleteStory).
//
// Additive only (golden rule 2): a new table, nothing else touched. Rolling the code back leaves a
// table nobody reads, which is harmless.
//
// Stories erased before this table existed cannot be remembered: their words are gone, and
// erasure_log holds only an id, a date, who and why. That is by design.

exports.up = (pgm) => {
  pgm.createTable(
    "erased_stories",
    {
      fingerprint: {
        type: "text",
        primaryKey: true,
        comment: "sha256 in hex of the erased story's sent time (ISO, UTC, milliseconds) and its exact words.",
      },
      erased_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      comment:
        "Stories erased from the admin, remembered by a one way fingerprint only, so an old export added again never brings one back (TASK-475).",
    },
  );
  pgm.addConstraint("erased_stories", "erased_stories_fingerprint_is_sha256", {
    check: "fingerprint ~ '^[0-9a-f]{64}$'",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("erased_stories");
};
