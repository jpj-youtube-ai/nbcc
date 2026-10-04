import { isOpen, type DoorState } from "./doors";

// NBCC Elf Detective School: the daily guess. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each family locks in one guess a day, picked from this year's hiding places, and can change it
// until the door opens. It is how a child who lives too far away to race still plays every day. The
// list they pick from gets shorter as elves are found, which suits the little ones.
//
// Two things keep it fair. A guess is only taken while the elf is hunted, and whoever saves it must
// work the door's state out at that moment, never from a copy of the calendar made earlier. And a
// guess is only ever called right once the door is open: asked sooner, `cracked` says no, so no
// screen can confirm a guess while a family could still change it.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-guess.test.ts.

export type GuessRefusal = "not-hunting" | "unknown-place" | "place-already-open";
export type GuessDecision = { ok: true } | { ok: false; reason: GuessRefusal };

export interface GuessContext {
  /** The state of the door being guessed, worked out at the moment the guess is saved. */
  doorState: DoorState;
  /** Every hiding place this year. */
  placeIds: readonly string[];
  /** The places whose own door is already open. */
  openPlaceIds: readonly string[];
}

/** A family's guess for one door, as it is kept. */
export interface SavedGuess {
  placeId: string;
  /** When it was last saved. */
  at: Date;
}

/** The places a family can still choose: every hiding place whose own door is not open, in list order. */
export function guessOptions(placeIds: readonly string[], openPlaceIds: readonly string[]): string[] {
  const open = new Set(openPlaceIds);
  return placeIds.filter((id) => !open.has(id));
}

/** May this guess be locked in? Only while the elf is hunted, and only for a place still in play. */
export function decideGuess(ctx: GuessContext, placeId: string): GuessDecision {
  if (ctx.doorState !== "hunting") return { ok: false, reason: "not-hunting" };
  if (!ctx.placeIds.includes(placeId)) return { ok: false, reason: "unknown-place" };
  if (ctx.openPlaceIds.includes(placeId)) return { ok: false, reason: "place-already-open" };
  return { ok: true };
}

/** Did the family crack the case? Only once the door is open, with a guess saved before it opened
 *  that names the door's real place. `openedAt` is the door's opening moment (openedAt in doors.ts). */
export function cracked(
  door: { state: DoorState; placeId: string; openedAt: Date | null },
  guess: SavedGuess | null,
): boolean {
  if (!isOpen(door.state) || door.openedAt === null || guess === null) return false;
  return guess.at.getTime() < door.openedAt.getTime() && guess.placeId === door.placeId;
}
