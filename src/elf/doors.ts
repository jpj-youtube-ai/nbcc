// NBCC Elf Detective School: where a door is up to. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely"), with the
// secret places design (2026-11-03) for the three clues and the reveal, and the wave 2 design for
// snow days.
//
// A door is shut until clue 1 comes out. Then the elf is hunted, with clue 2 and clue 3 following.
// The place is shown at `shownAt`: the staff reveal time, but never before the elf is found, and
// never later than the place closing. So a door has six states:
//   shut          before clue 1.
//   hunting       clue 1 is out, the elf is not found, the place is not yet shown.
//   found-hidden  the elf is found but the place is still hidden (found before the reveal time).
//   found         the elf is found and the place is shown.
//   revealed      the place was shown with the elf still hiding; the first valid claim still wins.
//   snow          a snow day, stored on the door (never worked out live): the door is cancelled
//                 from clue 1 on, no clues, no place, and it counts as done so nobody loses out.
//
// Every door has a closing time (closingInstant in src/elf/calendar.ts gives one to a place that
// has none set). A door that never opened could never be stamped, and then nobody could graduate.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-doors.test.ts.

export type DoorState = "shut" | "hunting" | "found-hidden" | "found" | "revealed" | "snow";

export interface DoorFacts {
  /** When clue 1 comes out. */
  clue1At: Date;
  clue2At: Date;
  clue3At: Date;
  /** The staff time the place is shown. */
  revealAt: Date;
  /** When the place closes on its day (closingInstant's answer): from then the place is shown even if the elf is hiding. */
  closesAt: Date;
  /** When the winning claim was made, or null while nobody has found the elf. */
  foundAt: Date | null;
  /** Stored: true when elf_doors.snow_day_at is set. Never worked out live. */
  snowDay: boolean;
  goneHome: boolean;
}

/** The moment the place is shown: the later of the reveal time and the earlier of the find and closing. */
export function shownAt(door: DoorFacts): Date {
  const earlier = door.foundAt ? Math.min(door.foundAt.getTime(), door.closesAt.getTime()) : door.closesAt.getTime();
  return new Date(Math.max(door.revealAt.getTime(), earlier));
}

/** The door's state at a moment. A clue 1 time that is not a real date stays shut. */
export function doorState(door: DoorFacts, now: Date): DoorState {
  const t = now.getTime();
  if (!(t >= door.clue1At.getTime())) return "shut";
  if (door.snowDay) return "snow";
  const shown = t >= shownAt(door).getTime();
  const found = door.foundAt !== null && door.foundAt.getTime() <= t;
  if (found) return shown ? "found" : "found-hidden";
  return shown ? "revealed" : "hunting";
}

/** The moment the place was shown, once now has reached it and the door is not a snow day; else null. */
export function openedAt(door: DoorFacts, now: Date): Date | null {
  if (doorState(door, now) === "snow") return null;
  if (!(now.getTime() >= door.clue1At.getTime())) return null;
  const shown = shownAt(door);
  return now.getTime() >= shown.getTime() ? shown : null;
}

/** How many clues are out: 0 on a snow day whatever the time. */
export function cluesOut(door: DoorFacts, now: Date): 0 | 1 | 2 | 3 {
  if (door.snowDay) return 0;
  const t = now.getTime();
  if (t >= door.clue3At.getTime()) return 3;
  if (t >= door.clue2At.getTime()) return 2;
  if (t >= door.clue1At.getTime()) return 1;
  return 0;
}

/** The next of the three clues still to come, or null once all are out or on a snow day. */
export function nextClueAt(door: DoorFacts, now: Date): Date | null {
  if (door.snowDay) return null;
  const t = now.getTime();
  return [door.clue1At, door.clue2At, door.clue3At].find((c) => c.getTime() > t) ?? null;
}

/** Is the place shown? True once the door is found or revealed. */
export function isOpen(state: DoorState): boolean {
  return state === "found" || state === "revealed";
}

/** Can the elf still be claimed? True while it is hunted, and while it waits at a revealed place. */
export function isClaimable(state: DoorState): boolean {
  return state === "hunting" || state === "revealed";
}

/** Can a place still be guessed? True while hunting, and when found but the place is still hidden. */
export function canGuess(state: DoorState): boolean {
  return state === "hunting" || state === "found-hidden";
}

/** Does the door count as done? Open, or a snow day. */
export function isDone(state: DoorState): boolean {
  return isOpen(state) || state === "snow";
}
