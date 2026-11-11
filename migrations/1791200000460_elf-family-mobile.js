/* eslint-disable camelcase */

// NBCC Elf Detective School (TASK-613, Jaimie, 11 November 2026): the grown up's mobile number, given
// when they enrol, so a head elf can ring the grand prize winner's grown up straight away on Christmas
// Eve. It is only for that: shown to head elves in Head Elf HQ, never public, never in an email to
// anyone else and never in a log line, and it goes at the end of January with the rest.
//
// Kept exactly as a head elf's own mobile is (elf_head_elves.mobile, 1791200000450_elf-alerts.js):
// +447 and nine digits. Additive: one empty column, as families who enrolled before it was asked
// have none.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("elf_families", {
    mobile: { type: "text", check: "mobile IS NULL OR mobile ~ '^\\+447[0-9]{9}$'" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("elf_families", ["mobile"]);
};
