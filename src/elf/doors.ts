// NBCC Elf Detective School: where a door is up to. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A door is shut until its clue comes out, then the elf is hunted. It opens, which means its place
// is shown, in one of two ways: someone finds the elf, or the place closes for the day with the elf
// still hiding. In the second case the elf waits there and the first valid claim still wins.
//
// Every door has a closing time (closingInstant in src/elf/calendar.ts gives one to a place that
// has none set). A door that never opened could never be stamped, and then nobody could graduate.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-doors.test.ts.

export type DoorState = "shut" | "hunting" | "found" | "revealed";

export interface DoorFacts {
  /** When the clue comes out. */
  clueAt: Date;
  /** When the place closes on its day: from then the place is shown, even if the elf is still hiding. */
  revealAt: Date;
  /** When the winning claim was made, or null while nobody has found the elf. */
  foundAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an unfound elf's place is shown. A closing time that is not after the clue cannot be right,
 *  so it is not trusted: the place is shown a day after the clue instead. */
function revealTime(door: DoorFacts): number {
  const clue = door.clueAt.getTime();
  const close = door.revealAt.getTime();
  return close > clue ? close : clue + DAY_MS;
}

/** When the elf was found, if it has been by now. */
function foundTime(door: DoorFacts, now: Date): number | null {
  return door.foundAt && door.foundAt.getTime() <= now.getTime() ? door.foundAt.getTime() : null;
}

/** The door's state at a moment. Found beats everything, because a revealed elf can still be
 *  claimed. A door whose clue time is not a real date stays shut. */
export function doorState(door: DoorFacts, now: Date): DoorState {
  const t = now.getTime();
  if (foundTime(door, now) !== null) return "found";
  if (!(t >= door.clueAt.getTime())) return "shut";
  return t >= revealTime(door) ? "revealed" : "hunting";
}

/** The moment the door opened, which is when its place was first shown: the earlier of the elf
 *  being found and the place being revealed. Null while the door is not open. */
export function openedAt(door: DoorFacts, now: Date): Date | null {
  const t = now.getTime();
  const found = foundTime(door, now);
  const reveal = revealTime(door);
  const revealed = t >= door.clueAt.getTime() && t >= reveal ? reveal : null;
  if (found === null && revealed === null) return null;
  return new Date(Math.min(found ?? Infinity, revealed ?? Infinity));
}

/** Is the place shown? True once the elf is found or the place has been revealed. */
export function isOpen(state: DoorState): boolean {
  return state === "found" || state === "revealed";
}

/** Can the elf still be claimed? True while it is hunted, and while it waits at a revealed place. */
export function isClaimable(state: DoorState): boolean {
  return state === "hunting" || state === "revealed";
}
