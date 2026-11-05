/* eslint-disable camelcase */

// NBCC Elf Detective School: favourite looks (docs/superpowers/specs/2026-11-04-elf-paper-design.md).
// On the paper wardrobe a child can Snap a photo of a look they like and wear it again later. Up to
// three are kept with the detective, so they follow the child to another device. Each is made safe
// (src/elf/wardrobe.ts, normaliseFavourites) before it is stored or shown.
//
// Additive only (golden rule 2): one new column on elf_detectives, with a default, so every existing
// detective reads as having no favourites. elf_detectives.look and fresh keep their types: a look is
// now a costume look, and fresh now holds the ids of costumes not yet opened (the elf code has never
// been live, so no stored look is in the old shape; one would be made safe to the start anyway).
//
// Numbered 1791200000320: after the elf school's own 310, the newest anywhere (main has reached 305).

exports.up = (pgm) => {
  pgm.addColumns("elf_detectives", {
    favourites: { type: "jsonb", notNull: true, default: pgm.func("'[]'::jsonb") },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("elf_detectives", ["favourites"]);
};
