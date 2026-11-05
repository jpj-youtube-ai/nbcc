/* eslint-disable camelcase */

// Head Elf HQ (docs/superpowers/specs/2026-11-05-elf-admin-design.md, decision 6): a head elf can
// remove a family (a test sign up, or one refunded in Stripe) and put it back. Removing is a mark, not
// a delete: a removed family cannot sign in, is left out of the counts and the money, and keeps its
// badge numbers unused. Additive: two empty columns.

exports.up = (pgm) => {
  pgm.addColumns("elf_families", {
    removed_at: { type: "timestamptz" },
    removed_by: { type: "text" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("elf_families", ["removed_at", "removed_by"]);
};
