// TASK-345: the menu, and who has chosen from it.
//
// Pure — no pool, no clock — so it is unit-tested DB-free like ./capacity.ts and ./run-up.ts.
//
// Built BEFORE the venue has confirmed a menu, deliberately. Choices are never asked for at the
// point of sale; they are collected later on the guest page a buyer already holds a link to. So
// the launch does not wait on the hotel, and the only thing left to do on the day the menu
// arrives is paste it into admin.

export interface MenuCourse {
  name: string;
  options: string[];
}

// Staff paste what the venue sends, one course per line:
//
//   Starter: Cullen skink | Haggis bon bons | Melon
//   Main: Steak pie | Salmon | Mushroom wellington
//   Dessert: Cranachan | Cheesecake
//
// Free text rather than a table of courses and options, because nobody knows yet whether this
// hotel offers three mains or a set menu with two swaps, and a schema guessed now is a migration
// to undo later.
export function parseMenu(raw: string | null): MenuCourse[] {
  if (!raw) return [];
  const courses: MenuCourse[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const at = text.indexOf(":");
    // A line with no colon is a course with no options — a fixed course everybody gets. Keeping
    // it (rather than dropping it) means the menu shown to guests is the menu the venue sent.
    const name = at === -1 ? text : text.slice(0, at).trim();
    const rest = at === -1 ? "" : text.slice(at + 1);
    const options = rest
      .split("|")
      .map((o) => o.trim())
      .filter(Boolean);
    if (name) courses.push({ name, options });
  }
  return courses;
}

// Only courses that actually ask something. A fixed course is not a question, so it must not
// count towards "has this guest answered everything".
export function choosableCourses(menu: MenuCourse[]): MenuCourse[] {
  return menu.filter((c) => c.options.length > 0);
}

// A guest's answers, stored as "Course: choice" lines — the same shape as the menu itself, so
// the two can be read side by side without a decoder.
export function formatChoice(pairs: Array<[string, string]>): string {
  return pairs
    .filter(([, choice]) => choice.trim().length > 0)
    .map(([course, choice]) => `${course.trim()}: ${choice.trim()}`)
    .join("\n");
}

export function parseChoice(raw: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const course = line.slice(0, at).trim();
    const choice = line.slice(at + 1).trim();
    if (course && choice) out[course] = choice;
  }
  return out;
}

// Has this guest answered every course that asks a question?
//
// A choice the menu no longer offers does NOT count. The venue changing "Salmon" to "Sea bass"
// after some people have answered is an ordinary thing to happen, and treating a stale answer as
// valid would hand the caterer a number for a dish that is not being cooked.
export function hasChosen(choiceRaw: string | null, menu: MenuCourse[]): boolean {
  const asked = choosableCourses(menu);
  if (asked.length === 0) return true;
  const chosen = parseChoice(choiceRaw);
  return asked.every((c) => {
    const answer = chosen[c.name];
    return Boolean(answer) && c.options.includes(answer);
  });
}

export interface MenuProgressGuest {
  fullName: string;
  menuChoice: string | null;
}

// How far off a complete order for the kitchen is. Same purpose as the guest-details chase list:
// staff need to know who to nudge, and whether the venue can be given final numbers.
export function menuProgress(guests: MenuProgressGuest[], menu: MenuCourse[]) {
  const asked = choosableCourses(menu);
  const chosen = guests.filter((g) => hasChosen(g.menuChoice, menu)).length;
  return {
    // Nothing is outstanding while there is no menu to choose from — the honest answer before
    // the venue confirms one, rather than "0% complete" against a menu that does not exist.
    asking: asked.length > 0,
    guests: guests.length,
    chosen,
    outstanding: asked.length === 0 ? 0 : guests.length - chosen,
  };
}
