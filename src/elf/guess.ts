import type { Door } from "./calendar";
import { canGuess, isOpen, type DoorState } from "./doors";
import { normalisePlaceName, sameName } from "./place-names";

// NBCC Elf Detective School: the typed guess. The design is
// docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md and the secret places design's
// "Rules, precisely" (docs/superpowers/specs/2026-11-03-elf-detective-secret-places-design.md), with
// catching up on missed doors (docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md).
//
// A family types where it thinks the elf is hiding and can change it until the place is shown. A
// guess is only taken while the door can be guessed (canGuess), and whoever saves it must work the
// door's state out at that moment, never from a copy of the calendar made earlier. A guess is only
// ever called right once the place is shown: asked sooner, `cracked` says no, so no screen can
// confirm a guess while a family could still change it.
//
// Once the place is shown, a family that missed the evening can have a go (src/elf/catch-up.ts): one
// guess, made at or after the shown moment, and final. A guess sent to tonight's door after that
// moment is never saved as the go: a family with a guess is told it is locked in, and one that may
// have a go is sent to have it. A refusal names another open door only when the family can see that
// door's place, so it never gives a place away.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-guess.test.ts.

/** The longest guess, in characters, once trimmed. */
export const GUESS_MAX = 80;

export type GuessRefusal = "not-hunting" | "empty" | "too-long" | "place-already-open" | "locked-in" | "have-a-go";

export interface GuessContext {
  /** The state of the door being guessed, worked out at the moment the guess is saved. */
  doorState: DoorState;
  /** The open doors whose place this family can see (the caller filters them with knowsPlace in
   *  catch-up.ts), with every name each place is known by. Any other door's place is an ordinary guess. */
  openPlaces: readonly { door: Door; names: readonly string[] }[];
  /** Does the family have a guess at this door already? */
  hasGuess: boolean;
  /** May the family have a go at this door (mayHaveAGo in catch-up.ts)? */
  mayHaveAGo: boolean;
}

export type GuessDecision = { ok: true; text: string; norm: string } | { ok: false; reason: GuessRefusal; door?: Door };

/** May this guess be saved? The checks run in a fixed order, so every other text gets the same answer. */
export function decideGuess(ctx: GuessContext, typed: unknown): GuessDecision {
  const text = typeof typed === "string" ? typed.trim() : "";
  if (text === "") return { ok: false, reason: "empty" };
  if (text.length > GUESS_MAX) return { ok: false, reason: "too-long" };
  if (isOpen(ctx.doorState)) {
    if (ctx.hasGuess) return { ok: false, reason: "locked-in" };
    if (ctx.mayHaveAGo) return { ok: false, reason: "have-a-go" };
    return { ok: false, reason: "not-hunting" };
  }
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
  /** True for a go: one guess made once the door was open, and final. False for a guess on the night. */
  late: boolean;
}

/** Did the family crack the case? Only once the place is shown, with a guess which names the place: a
 *  guess on the night saved strictly before that moment, or a go made at it or after. `openedAt` is the
 *  door's opening moment (openedAt in doors.ts). */
export function cracked(
  door: { state: DoorState; openedAt: Date | null; names: readonly string[] },
  guess: SavedGuess | null,
): boolean {
  if (!isOpen(door.state) || door.openedAt === null || guess === null) return false;
  const saved = guess.at.getTime();
  const opened = door.openedAt.getTime();
  if (guess.late ? !(saved >= opened) : !(saved < opened)) return false;
  return door.names.some((name) => normalisePlaceName(name) === guess.norm);
}
