/* eslint-disable camelcase */

// NBCC Elf Detective School, wave 2: the 24 doors.
// Design: docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md.
//
//   elf_doors        one row per door per year: the real place and its contact, where the elf hides,
//                    the prize, the elf's name and tag word, the evening clock times, the poster
//                    code, and the print and drop off ticks.
//   elf_door_names   the names that count for a door (any one of them is a right answer).
//   elf_clues        a door's three clues, 1 to 3.
//   elf_settings     gains place_phone, the number shown on the staff card.
//
// These rows name the secret hiding places. They are for staff only: never on a public page and
// never in an export.
//
// Additive: three new tables and one empty column.

exports.shorthands = undefined;

const clock = (column) => ({
  type: "text",
  check: `${column} IS NULL OR ${column} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
});

exports.up = (pgm) => {
  pgm.createTable(
    "elf_doors",
    {
      year: { type: "integer", notNull: true },
      door: { type: "integer", notNull: true, check: "door BETWEEN 1 AND 24" },
      place_name: { type: "text" },
      place_town: { type: "text" },
      place_address: { type: "text" },
      contact_name: { type: "text" },
      contact_phone: { type: "text" },
      contact_email: { type: "text" },
      elf_spot: { type: "text" },
      agreed_by: { type: "text" },
      prize: { type: "text" },
      prize_show_off: { type: "boolean", notNull: true, default: false },
      elf_name: { type: "text" },
      tag_word: { type: "text" },
      closes_at: clock("closes_at"),
      clue1_time: clock("clue1_time"),
      clue2_time: clock("clue2_time"),
      clue3_time: clock("clue3_time"),
      reveal_time: clock("reveal_time"),
      poster_code: { type: "text", notNull: true, unique: true },
      tag_printed_at: { type: "timestamptz" },
      dropped_off_at: { type: "timestamptz" },
      dropped_off_by: { type: "text" },
      thanked_at: { type: "timestamptz" },
      thanked_by: { type: "text" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    {
      constraints: { primaryKey: ["year", "door"] },
      comment: "Elf Detective School doors, one per door per year. Names the secret places: staff only.",
    },
  );

  pgm.createTable(
    "elf_door_names",
    {
      id: "id",
      year: { type: "integer", notNull: true },
      door: { type: "integer", notNull: true },
      name: { type: "text", notNull: true, check: "char_length(name) BETWEEN 1 AND 80" },
      added_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      added_by: { type: "text" },
    },
    {
      constraints: {
        foreignKeys: { columns: ["year", "door"], references: "elf_doors(year, door)", onDelete: "CASCADE" },
      },
      comment: "The names that count for a door. Staff only.",
    },
  );

  pgm.createTable(
    "elf_clues",
    {
      year: { type: "integer", notNull: true },
      door: { type: "integer", notNull: true },
      n: { type: "integer", notNull: true, check: "n BETWEEN 1 AND 3" },
      words: { type: "text", notNull: true, check: "char_length(words) BETWEEN 1 AND 500" },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    {
      constraints: {
        primaryKey: ["year", "door", "n"],
        foreignKeys: { columns: ["year", "door"], references: "elf_doors(year, door)", onDelete: "CASCADE" },
      },
      comment: "A door's three clues. Staff only until the clue is out.",
    },
  );

  pgm.addColumns("elf_settings", {
    place_phone: { type: "text", check: "place_phone IS NULL OR char_length(place_phone) <= 40" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("elf_settings", ["place_phone"]);
  pgm.dropTable("elf_clues");
  pgm.dropTable("elf_door_names");
  pgm.dropTable("elf_doors");
};
