// NBCC Elf Detective School: where a door is up to. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// A door is shut until its clue comes out, then the elf is hunted. It opens, which means its place
// is shown, in one of two ways: someone finds the elf, or the place closes for the day with the elf
// still hiding. In the second case the elf waits there and the first valid claim still wins.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-doors.test.ts.

export type DoorState = "shut" | "hunting" | "found" | "revealed";

export interface DoorFacts {
  /** When the clue comes out. */
  clueAt: Date;
  /** When the place closes on its day. Null means no time is set, so the door hunts until found. */
  revealAt: Date | null;
  /** When the winning claim was made, or null while nobody has found the elf. */
  foundAt: Date | null;
}

/** The door's state at a moment. Found beats everything, because a revealed elf can still be claimed. */
export function doorState(door: DoorFacts, now: Date): DoorState {
  const t = now.getTime();
  if (door.foundAt && door.foundAt.getTime() <= t) return "found";
  if (t < door.clueAt.getTime()) return "shut";
  if (door.revealAt && t >= door.revealAt.getTime()) return "revealed";
  return "hunting";
}

/** Is the place shown? True once the elf is found or the place has been revealed. */
export function isOpen(state: DoorState): boolean {
  return state === "found" || state === "revealed";
}

/** Can the elf still be claimed? True while it is hunted, and while it waits at a revealed place. */
export function isClaimable(state: DoorState): boolean {
  return state === "hunting" || state === "revealed";
}
