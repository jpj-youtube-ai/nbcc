/* eslint-disable camelcase */

// TASK-506: news updates on a fundraiser's page.
//
//   fundraiser_updates   a short update the organiser posts from their private area (up to 500
//                        characters), with an optional photo kept in the row itself (a JPEG, PNG or
//                        WebP of 2 MB at most, like the photos staff upload). Every one waits for
//                        staff (pending); approved, it shows on the page, newest first; rejected, it
//                        never does (the reason is internal, never shown to anyone outside staff);
//                        hidden, staff took it off the page after approving it. The photo has its own
//                        address (photo_id, a uuid), served to the public only while its update is
//                        approved: until then only the organiser and staff can see it. Cleared with
//                        the fundraiser it belongs to.
//
// Additive only: one new table, so a code rollback is safe (golden rule 2). Numbered 1791200000100,
// above 1791200000070 (the highest on main) and the 1791200000080 another open task uses.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_updates",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      body: { type: "text", notNull: true },
      photo_id: { type: "uuid", unique: true },
      photo_mime: { type: "text", check: "photo_mime IS NULL OR photo_mime IN ('image/jpeg', 'image/png', 'image/webp')" },
      photo_bytes: { type: "bytea" },
      photo_byte_size: { type: "integer" },
      status: {
        type: "text",
        notNull: true,
        default: "pending",
        check: "status IN ('pending', 'approved', 'rejected', 'hidden')",
      },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
      decided_by: { type: "text" }, // "admin:<email>"
      reject_reason: { type: "text" },
    },
    {
      constraints: {
        check: [
          "char_length(body) BETWEEN 1 AND 500",
          "reject_reason IS NULL OR char_length(reject_reason) <= 500",
          "(photo_id IS NULL) = (photo_bytes IS NULL)",
        ],
      },
      comment: "News updates organisers post to their fundraiser page; each waits for staff (TASK-506).",
    },
  );
  pgm.createIndex("fundraiser_updates", ["fundraiser_id", { name: "created_at", sort: "DESC" }]);
  pgm.createIndex("fundraiser_updates", "fundraiser_id", { name: "fundraiser_updates_pending_idx", where: "status = 'pending'" });
};

exports.down = (pgm) => {
  pgm.dropTable("fundraiser_updates");
};
