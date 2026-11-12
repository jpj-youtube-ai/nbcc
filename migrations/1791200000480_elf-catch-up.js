/* eslint-disable camelcase */

// NBCC Elf Detective School, catching up on missed doors (Plan 2c-1; design:
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md). A family that missed a
// door's evening can have a go at it later from home, with the same three clues and one guess.
//
//   elf_guesses   gains late, true for a go: the one guess a family makes at a door once its place is
//                 shown, and final. The primary key (year, door, family_id) keeps it one a family a
//                 door: the go's insert never overwrites anything (ON CONFLICT DO NOTHING), and the
//                 night's save never overwrites a go (its DO UPDATE runs only WHERE NOT late).
//
// Additive: one column with a default, so every guess already saved reads as a guess on the night,
// and code from before it, which never names the column, keeps working, so a code rollback is safe
// (golden rule 2). down drops it.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("elf_guesses", {
    late: {
      type: "boolean",
      notNull: true,
      default: false,
      comment: "A guess made when having a go, once the door was open: one only, and final.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("elf_guesses", ["late"]);
};
