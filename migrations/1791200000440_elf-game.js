/* eslint-disable camelcase */

// NBCC Elf Detective School, wave 2: the game.
// Design: docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md.
//
//   elf_settings     gains doors_on, the switch for the December doors (off to start with).
//   elf_doors        gains when its elf was found and by whom, and the snow day and gone home marks.
//   elf_clues        a clue may now be a picture instead of words (words loses its NOT NULL; its
//                    CHECK already passes NULL), and the picture is kept on the row.
//   elf_guesses      a family's one typed guess for a door.
//   elf_word_tries   how many wrong words a family has typed at a door (six are allowed).
//   elf_visits       each detective's visit to a door by the word, and when it counts from.
//   elf_photos       the photos families send: status, who decided, and a random token as address.
//   elf_photo_files  the photo bytes, kept apart so the nightly backup can leave them out (C12).
//   elf_practice     the single practice door (year 0, door 0), with absolute clue times.
//
// The game tables carry year and door but no foreign key to elf_doors, so the practice door (door 0
// of year 0) needs no row there. Photos and clues name the secret places: never in an export.
//
// Additive: new tables, new nullable or defaulted columns, and one NOT NULL dropped.

exports.shorthands = undefined;

const gameKey = () => ({
  year: { type: "integer", notNull: true },
  door: { type: "integer", notNull: true, check: "door BETWEEN 0 AND 24" },
  family_id: { type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" },
});

exports.up = (pgm) => {
  pgm.addColumns("elf_settings", {
    doors_on: { type: "boolean", notNull: true, default: false },
  });

  pgm.addColumns("elf_doors", {
    found_at: { type: "timestamptz" },
    found_family_id: { type: "integer", references: "elf_families", onDelete: "SET NULL" },
    snow_day_at: { type: "timestamptz" },
    snow_day_by: { type: "text" },
    gone_home_at: { type: "timestamptz" },
    gone_home_by: { type: "text" },
  });

  pgm.alterColumn("elf_clues", "words", { notNull: false });
  pgm.addColumns("elf_clues", {
    picture: { type: "bytea" },
    picture_mime: { type: "text" },
    picture_width: { type: "integer" },
    picture_height: { type: "integer" },
    picture_alt: { type: "text", check: "picture_alt IS NULL OR char_length(picture_alt) <= 200" },
  });
  pgm.addConstraint("elf_clues", "elf_clues_has_something", {
    check: "words IS NOT NULL OR picture IS NOT NULL",
  });

  pgm.createTable(
    "elf_guesses",
    {
      ...gameKey(),
      text: { type: "text", notNull: true, check: "char_length(text) BETWEEN 1 AND 80" },
      norm: { type: "text", notNull: true },
      saved_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: { primaryKey: ["year", "door", "family_id"] },
      comment: "A family's typed guess at where a door's elf is hiding, one per door. Door 0 of year 0 is the practice door.",
    },
  );

  pgm.createTable(
    "elf_word_tries",
    {
      ...gameKey(),
      wrong: { type: "integer", notNull: true, default: 0 },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    },
    {
      constraints: { primaryKey: ["year", "door", "family_id"] },
      comment: "How many wrong tag words a family has typed at a door.",
    },
  );

  pgm.createTable(
    "elf_visits",
    {
      id: "id",
      ...gameKey(),
      detective_id: { type: "integer", notNull: true, references: "elf_detectives", onDelete: "CASCADE" },
      typed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      counts_from: { type: "timestamptz", notNull: true },
      found: { type: "boolean", notNull: true, default: false },
      look: { type: "jsonb" },
    },
    {
      constraints: { unique: ["year", "door", "detective_id"] },
      comment: "A detective's visit to a door by its tag word, and the time it counts from.",
    },
  );
  pgm.createIndex("elf_visits", ["year", "door", "counts_from"]);

  pgm.createTable(
    "elf_photos",
    {
      id: "id",
      token: { type: "text", notNull: true, unique: true },
      ...gameKey(),
      status: {
        type: "text",
        notNull: true,
        default: "waiting",
        check: "status IN ('waiting', 'approved', 'declined', 'replaced', 'taken-down', 'deleted')",
      },
      mime: { type: "text" },
      width: { type: "integer" },
      height: { type: "integer" },
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      decided_at: { type: "timestamptz" },
      decided_by: { type: "text" },
      decline_reason: {
        type: "text",
        check: "decline_reason IS NULL OR char_length(decline_reason) <= 200",
      },
      taken_down_at: { type: "timestamptz" },
      taken_down_by: { type: "text" },
      deleted_at: { type: "timestamptz" },
    },
    {
      comment: "Photos families send for a door. The address is a random token, never the id.",
    },
  );
  pgm.createIndex("elf_photos", ["year", "door", "status"]);
  pgm.createIndex("elf_photos", ["status", "sent_at"]);

  pgm.createTable(
    "elf_photo_files",
    {
      photo_id: { type: "integer", primaryKey: true, references: "elf_photos", onDelete: "CASCADE" },
      bytes: { type: "bytea", notNull: true },
    },
    {
      comment:
        "The bytes of each photo, kept apart from elf_photos so the nightly backup can leave them out (C12).",
    },
  );

  pgm.createTable(
    "elf_practice",
    {
      id: { type: "integer", primaryKey: true, check: "id = 1" },
      started_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      started_by: { type: "text", notNull: true },
      place_name: { type: "text", notNull: true },
      place_town: { type: "text", notNull: true },
      elf_name: { type: "text", notNull: true },
      tag_word: { type: "text", notNull: true },
      poster_code: { type: "text", notNull: true },
      clue1_at: { type: "timestamptz", notNull: true },
      clue2_at: { type: "timestamptz", notNull: true },
      clue3_at: { type: "timestamptz", notNull: true },
      reveal_at: { type: "timestamptz", notNull: true },
      found_at: { type: "timestamptz" },
      found_family_id: { type: "integer", references: "elf_families", onDelete: "SET NULL" },
    },
    {
      comment: "The one practice door (year 0, door 0), with absolute times, seen only with the preview cookie.",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("elf_practice");
  pgm.dropTable("elf_photo_files");
  pgm.dropTable("elf_photos");
  pgm.dropTable("elf_visits");
  pgm.dropTable("elf_word_tries");
  pgm.dropTable("elf_guesses");

  pgm.dropConstraint("elf_clues", "elf_clues_has_something");
  pgm.dropColumns("elf_clues", ["picture", "picture_mime", "picture_width", "picture_height", "picture_alt"]);
  pgm.alterColumn("elf_clues", "words", { notNull: true });

  pgm.dropColumns("elf_doors", [
    "found_at",
    "found_family_id",
    "snow_day_at",
    "snow_day_by",
    "gone_home_at",
    "gone_home_by",
  ]);
  pgm.dropColumns("elf_settings", ["doors_on"]);
};
