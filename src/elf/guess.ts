import type { Door } from "./calendar";
import { canGuess, isOpen, type DoorState } from "./doors";
import { normalisePlaceName, sameName } from "./place-names";

// NBCC Elf Detective School: the typed guess. The design is
// docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md and the secret places design's
// "Rules, precisely" (docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md).
//
// A family types where it thinks the elf is hiding and can change it until the place is shown. A
// guess is only taken while the door can be guessed (canGuess), and whoever saves it must work the
// door's state out at that moment, never from a copy of the calendar made earlier. A guess is only
// ever called right once the place is shown: asked sooner, `cracked` says no, so no screen can
// confirm a guess while a family could still change it.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-guess.test.ts.

/** The longest guess, in characters, once trimmed. */
export const GUESS_MAX = 80;

export type GuessRefusal = "not-hunting" | "empty" | "too-long" | "place-already-open";

export interface GuessContext {
  /** The state of the door being guessed, worked out at the moment the guess is saved. */
  doorState: DoorState;
  /** The places whose own door is already open, with every name each is known by. */
  openPlaces: readonly { door: Door; names: readonly string[] }[];
}

export type GuessDecision = { ok: true; text: string; norm: string } | { ok: false; reason: GuessRefusal; door?: Door };

/** May this guess be saved? The checks run in a fixed order, so every other text gets the same answer. */
export function decideGuess(ctx: GuessContext, typed: unknown): GuessDecision {
  const text = typeof typed === "string" ? typed.trim() : "";
  if (text === "") return { ok: false, reason: "empty" };
  if (text.length > GUESS_MAX) return { ok: false, reason: "too-long" };
  if (!canGuess(ctx.doorState)) return { ok: false, reason: "not-hunting" };
  for (const place of ctx.openPlaces) {
    if (place.names.some((name) => sameName(text, name))) return { ok: false, reason: "place-already-open", door: place.door };
  }
  return { ok: true, text, norm: normalisePlaceName(text) };
}

/** A family's guess for one door, as it is kept. */
export interface SavedGuess {
  text: string;
  /** The guess as it is matched (normalisePlaceName). */
  norm: string;
  /** When it was last saved. */
  at: Date;
}

/** Did the family crack the case? Only once the place is shown, with a guess saved strictly before
 *  that moment which names the place. `openedAt` is the door's opening moment (openedAt in doors.ts). */
export function cracked(
  door: { state: DoorState; openedAt: Date | null; names: readonly string[] },
  guess: SavedGuess | null,
): boolean {
  if (!isOpen(door.state) || door.openedAt === null || guess === null) return false;
  if (!(guess.at.getTime() < door.openedAt.getTime())) return false;
  return door.names.some((name) => normalisePlaceName(name) === guess.norm);
}
