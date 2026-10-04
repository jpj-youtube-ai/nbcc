import type { DoorState } from "./doors";

// NBCC Elf Detective School: the daily guess. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// Each family locks in one guess a day, picked from this year's hiding places, and can change it
// until the door opens. It is how a child who lives too far away to race still plays every day. The
// list they pick from gets shorter as elves are found, which suits the little ones.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-guess.test.ts.

export type GuessRefusal = "not-hunting" | "unknown-place" | "place-already-open";
export type GuessDecision = { ok: true } | { ok: false; reason: GuessRefusal };

export interface GuessContext {
  /** The state of the door being guessed. */
  doorState: DoorState;
  /** Every hiding place this year. */
  placeIds: readonly string[];
  /** The places whose own door is already open. */
  openPlaceIds: readonly string[];
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

/** Did the family crack the case? Only a guess that names the door's real place counts. */
export function cracked(guessPlaceId: string | null, doorPlaceId: string): boolean {
  return guessPlaceId !== null && guessPlaceId === doorPlaceId;
}
