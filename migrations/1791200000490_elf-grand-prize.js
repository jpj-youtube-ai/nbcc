/* eslint-disable camelcase */

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2; design:
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md). On Christmas Eve every
// detective who has done all 24 doors can send in one picture for the grand prize until the entries
// close, and head elves judge the pictures and mark one winner. Families can stop the emails that are
// not essential.
//
//   elf_settings             gains grand_prize_closes_at, when the entries close on Christmas Eve
//                            (empty: 5pm on 24 December of year), and graduate_video_url, the
//                            graduates' video, an https link of 300 letters at most (empty: none).
//   elf_families             gains emails_stopped_at (empty: the emails go) and emails_token, the
//                            random token in the link that stops or starts them. Its default is a
//                            function, worked out again for each row, so every family already there
//                            gets a token of its own (gen_random_uuid is built into Postgres 16).
//   elf_grand_prize_entries  one picture a detective a year (unique on year and detective), replaced
//                            in place until the entries close. Never public: seen only by its own
//                            family and by head elves. One winner a year, kept by the unique index
//                            elf_grand_prize_one_winner on year, where a winner is marked.
//   elf_grand_prize_files    the pictures' bytes, kept apart so the nightly backup leaves them out, as
//                            photos are (BACKUP_TABLE_DATA_LEFT_OUT in src/backup/plan.ts).
//
// The entries and their pictures go at the end of January, with the clear out still to be built,
// which must take them.
//
// Additive: two new tables, and new columns that are empty or have a default, so code from before it,
// which never names them, keeps working and a code rollback is safe (golden rule 2). down drops them;
// the entries' index goes with its table.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("elf_settings", {
    grand_prize_closes_at: {
      type: "timestamptz",
      comment: "When grand prize entries close on Christmas Eve. Empty: 5pm on 24 December of year.",
    },
    graduate_video_url: {
      type: "text",
      check: "graduate_video_url IS NULL OR (graduate_video_url ~ '^https://' AND char_length(graduate_video_url) <= 300)",
      comment: "The graduates' video, an https link. Empty: there is none, and Detective HQ shows no video link.",
    },
  });

  pgm.addColumns("elf_families", {
    emails_stopped_at: {
      type: "timestamptz",
      comment: "When the family stopped the emails that are not essential. Empty: the emails go.",
    },
    emails_token: {
      type: "text",
      notNull: true,
      unique: true,
      default: pgm.func("replace(gen_random_uuid()::text, '-', '')"),
      comment: "The random token in the family's link to stop or start the emails: 32 lower case hex letters.",
    },
  });

  pgm.createTable(
    "elf_grand_prize_entries",
    {
      id: "id",
      year: { type: "integer", notNull: true },
      detective_id: { type: "integer", notNull: true, references: "elf_detectives", onDelete: "CASCADE" },
      family_id: { type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" },
      mime: { type: "text", notNull: true },
      width: { type: "integer", notNull: true },
      height: { type: "integer", notNull: true },
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      winner_at: { type: "timestamptz" },
      winner_by: { type: "text" },
    },
    {
      constraints: { unique: ["year", "detective_id"] },
      comment:
        "Grand prize entries, one picture a detective a year: never public, seen only by its own family and by head elves. Deleted at the end of January by the clear out, which must take them.",
    },
  );
  pgm.createIndex("elf_grand_prize_entries", "year", {
    name: "elf_grand_prize_one_winner",
    unique: true,
    where: "winner_at IS NOT NULL",
  });

  pgm.createTable(
    "elf_grand_prize_files",
    {
      entry_id: { type: "integer", primaryKey: true, references: "elf_grand_prize_entries", onDelete: "CASCADE" },
      bytes: { type: "bytea", notNull: true },
    },
    {
      comment:
        "The picture of each grand prize entry, kept apart from elf_grand_prize_entries so the nightly backup leaves them out, as photos are.",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("elf_grand_prize_files");
  pgm.dropTable("elf_grand_prize_entries");
  pgm.dropColumns("elf_families", ["emails_stopped_at", "emails_token"]);
  pgm.dropColumns("elf_settings", ["grand_prize_closes_at", "graduate_video_url"]);
};
