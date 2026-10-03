/* eslint-disable camelcase */

// Profile pictures (Jaimie, 2026-10-03): the pictures an organiser sends from their private area.
//
//   fundraiser_pictures   one row per picture sent. Two kinds:
//                           main     the big photo on their page. Approved, its bytes are copied
//                                    into event_images and the page's image_src points there, so
//                                    it is exactly a photo staff uploaded (staff can still change it).
//                           profile  a small round photo of the organiser, beside their name on
//                                    their page and on their team's page. Served from this table
//                                    only, by photo_id, and only while it is approved on a page
//                                    that is up, so staff can take it off at once.
//
//     status        pending (waiting for staff), approved (in use), declined (staff did not use it;
//                   decline_reason is an optional note the organiser sees), replaced (a newer one
//                   took its place, waiting or in use), removed (staff took a profile photo off).
//     photo_id      the picture's own address; nothing answers to it until it is approved.
//     mime, bytes   the picture as the server made it: turned the right way up, made smaller, and
//                   saved again, so nothing from the camera (the place it was taken, the phone) is
//                   kept. JPEG, PNG or WebP only, never SVG. The bytes are kept only while it waits
//                   or is in use: they go when it is not used, replaced or taken off (the row stays,
//                   for the audit), and the daily task clears any left 30 days on. One still waiting
//                   is kept until staff decide.
//     event_image_id   an approved main photo's copy in event_images (the page's image_src), so
//                   taking it off or replacing it deletes the copy too.
//
// At most one waiting and one in use of each kind per fundraiser (unique partial indexes), so two
// sent at once can never both wait. Every write a person makes is in audit_log against the
// fundraiser. Cleared with its fundraiser.
//
// Additive only: one new table, so a code rollback is safe (golden rule 2). Numbered 1791200000205,
// above 1791200000200 (impact markers, on its way to main).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_pictures",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      kind: { type: "text", notNull: true, check: "kind IN ('main', 'profile')" },
      status: {
        type: "text",
        notNull: true,
        default: "pending",
        check: "status IN ('pending', 'approved', 'declined', 'replaced', 'removed')",
      },
      photo_id: { type: "uuid", notNull: true, unique: true },
      mime: { type: "text", notNull: true, check: "mime IN ('image/jpeg', 'image/png', 'image/webp')" },
      bytes: { type: "bytea" },
      byte_size: { type: "integer", notNull: true },
      width: { type: "integer", notNull: true },
      height: { type: "integer", notNull: true },
      event_image_id: { type: "uuid", references: "event_images", onDelete: "SET NULL" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
      decided_by: { type: "text" }, // "admin:<email>", or "organiser" when they sent a newer one
      decline_reason: { type: "text" },
    },
    {
      constraints: {
        check: [
          "byte_size BETWEEN 1 AND 2097152",
          "width BETWEEN 1 AND 4000 AND height BETWEEN 1 AND 4000",
          "decline_reason IS NULL OR char_length(decline_reason) <= 500",
          "status NOT IN ('pending', 'approved') OR bytes IS NOT NULL",
        ],
      },
      comment: "Page photos and round profile photos organisers send from their private area; each waits for staff.",
    },
  );
  pgm.createIndex("fundraiser_pictures", ["fundraiser_id", "kind"], {
    name: "fundraiser_pictures_one_waiting",
    unique: true,
    where: "status = 'pending'",
  });
  pgm.createIndex("fundraiser_pictures", ["fundraiser_id", "kind"], {
    name: "fundraiser_pictures_one_in_use",
    unique: true,
    where: "status = 'approved'",
  });
  pgm.createIndex("fundraiser_pictures", ["fundraiser_id", { name: "created_at", sort: "DESC" }]);
};

exports.down = (pgm) => {
  pgm.dropTable("fundraiser_pictures");
};
