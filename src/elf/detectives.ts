// NBCC Elf Detective School: which of a family's detectives a form is talking about. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Claiming an elf and earning a stamp both start with "which detectives are here?", answered by
// tick boxes. A form sends one ticked box as a single value, several as a list and none as nothing
// at all, and an id can arrive as a number or as text. Both rules read the answer through here, so
// they agree about it and neither falls over on what a form really sends.
//
// Ids are compared as text. An id that is a number in the database and the same id sent by a form
// are the same detective.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-detectives.test.ts.

/** The most detectives one form can name. No family has this many, so a longer list is not a family
 *  ticking boxes, and it is not worth the site's time to read it. */
export const MAX_CHOSEN = 50;

/** The detectives ticked on a form, each once, as text, in the order they were ticked. Anything that
 *  is not an id is dropped, and a list longer than MAX_CHOSEN is nobody at all. */
export function chosenDetectives(sent: unknown): string[] {
  const list: unknown[] = Array.isArray(sent) ? sent : sent === undefined || sent === null ? [] : [sent];
  if (list.length > MAX_CHOSEN) return [];
  const ids = new Set<string>();
  for (const value of list) {
    const isId = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
    const id = isId ? String(value).trim() : "";
    if (id !== "") ids.add(id);
  }
  return [...ids];
}

/** Is somebody chosen, and are they all in the family? Nobody chosen is a no, so a gate built on this
 *  fails shut. */
export function allInFamily(chosen: readonly string[], family: readonly (string | number)[] | null | undefined): boolean {
  const own = new Set((family ?? []).map((id) => String(id)));
  return chosen.length > 0 && chosen.every((id) => own.has(id));
}
