// NBCC Elf Detective School wave 2: the one piece of SQL that counts how many different families have an
// approved photo on a door. A door's photos stay hidden until two families have (so one family's photo is
// never alone beside that family's elves). The family side (src/db/elf-game.ts) and the photo check
// (src/db/elf-photos.ts) both read it from here so the rule cannot drift. Pure: no pool.

/** A scalar subquery: how many different, not removed families have an approved, not deleted photo on the
 *  same year and door as the photo whose table alias is `photo`. With `exceptOwnFamily`, the family of
 *  that photo is left out (a waiting photo: how many OTHER families are already up on its door). The
 *  aliases a and fa are the subquery's own. */
export function approvedFamiliesSql(photo: string, exceptOwnFamily = false): string {
  return `(SELECT count(DISTINCT a.family_id) FROM elf_photos a JOIN elf_families fa ON fa.id = a.family_id
     WHERE a.year = ${photo}.year AND a.door = ${photo}.door AND a.status = 'approved' AND a.deleted_at IS NULL
       AND fa.removed_at IS NULL${exceptOwnFamily ? ` AND a.family_id <> ${photo}.family_id` : ""})`;
}
