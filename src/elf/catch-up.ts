import type { DoorRun } from "../db/elf-game";
import { londonToInstant } from "../tickets/model";
import { isDoor, type Door } from "./calendar";
import { doorState, isOpen, type DoorState } from "./doors";
import { GUESS_MAX, type SavedGuess } from "./guess";
import { normalisePlaceName } from "./place-names";
import { sameDay } from "./words";

// NBCC Elf Detective School: catching up on missed doors, and the places after Christmas. The design is
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md (part 1, with Jaimie's
// answers 2, 5 and 6).
//
// The one rule. A family can see a door's place once the door is open and the family has a guess at
// it, from the night or from having a go; or once one of its detectives has typed the door's tag word
// (the find, or a visit). Open means the place is shown: the door is found or revealed (isOpen in
// doors.ts), never shut, still hunting, found with the place still hidden, or snowed in.
//
// Having a go. A family that missed a door's evening can crack it later from home, with the same three
// clues and one guess. It is offered at an open door the family has neither guessed nor been to, from
// the door's shown moment until Christmas Day. The go is final: a family that has a guess at the door
// is never given another.
//
// The Christmas window. From midnight in London as Christmas Day begins until midnight as 1 January
// begins, every place is shown to everyone, so having a go closes on Christmas Day and does not open
// again. The practice door (year 0) has no Christmas: its go never closes and its place is never
// shown to everyone.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-catch-up.test.ts.

/** Midnight in London as Christmas Day of `year` begins. An Invalid Date for a year that is not one,
 *  such as the practice door's 0. */
export function christmasDay(year: number): Date {
  return new Date(londonToInstant(`${year}-12-25T00:00`) ?? Number.NaN);
}

/** Midnight in London as 1 January of the year after `year` begins. An Invalid Date for a year that is
 *  not one, as christmasDay. */
export function newYearsDay(year: number): Date {
  return new Date(londonToInstant(`${year + 1}-01-01T00:00`) ?? Number.NaN);
}

/** Is every place shown to everyone? From Christmas Day until 1 January; never for the practice door. */
export function placesPublic(year: number, now: Date): boolean {
  if (year === 0) return false;
  return christmasDay(year).getTime() <= now.getTime() && now.getTime() < newYearsDay(year).getTime();
}

/** Can a family still have a go? Until Christmas Day; always at the practice door. */
export function goesOpen(year: number, now: Date): boolean {
  if (year === 0) return true;
  return now.getTime() < christmasDay(year).getTime();
}

/** What a family has done, door by door. */
export interface FamilyKnowledge {
  /** The family's guesses, by door: from the night, or a go. */
  guesses: ReadonlyMap<number, SavedGuess>;
  /** Every door where a detective of the family has typed the tag's word (the find or a visit),
   *  whether or not it counts yet. */
  typed: ReadonlySet<number>;
}

/** The one rule: can the family see this door's place? */
export function knowsPlace(o: { state: DoorState; guessed: boolean; typed: boolean }): boolean {
  return (isOpen(o.state) && o.guessed) || o.typed;
}

/** May the family have a go at this door? Only at an open door it has neither guessed nor been to,
 *  while having a go is open. */
export function mayHaveAGo(o: { year: number; state: DoorState; guessed: boolean; typed: boolean; now: Date }): boolean {
  return isOpen(o.state) && !o.guessed && !o.typed && goesOpen(o.year, o.now);
}

/** The real doors (1 to 24) that are open at `now` and whose place the family knows, in door order.
 *  A door the family has been to whose place is still hidden comes in once its place is shown. */
export function doorsKnown(o: { runs: readonly DoorRun[]; knowledge: FamilyKnowledge; now: Date }): Door[] {
  const known: Door[] = [];
  for (const run of o.runs) {
    if (!isDoor(run.door)) continue;
    const state = doorState(run.facts, o.now);
    const guessed = o.knowledge.guesses.has(run.door);
    const typed = o.knowledge.typed.has(run.door);
    if (isOpen(state) && knowsPlace({ state, guessed, typed })) known.push(run.door);
  }
  return known.sort((a, b) => a - b);
}

/** The real doors (1 to 24) the family may have a go at, at `now`: newest first. */
export function doorsToCrack(o: { runs: readonly DoorRun[]; knowledge: FamilyKnowledge; now: Date }): DoorRun[] {
  return o.runs
    .filter(
      (run) =>
        isDoor(run.door) &&
        mayHaveAGo({
          year: run.year,
          state: doorState(run.facts, o.now),
          guessed: o.knowledge.guesses.has(run.door),
          typed: o.knowledge.typed.has(run.door),
          now: o.now,
        }),
    )
    .sort((a, b) => b.door - a.door);
}

export type GoRefusal = "not-open" | "closed" | "already" | "been-there" | "empty" | "too-long";

/** May this go be saved? `ctx.typed` is whether a detective of the family has typed the tag's word;
 *  `text` is the guess. The checks run in a fixed order, so a family gets the same answer whatever it
 *  typed: the door, then the family, then the text, which is trimmed before it is checked. */
export function decideGo(
  ctx: { year: number; state: DoorState; guessed: boolean; typed: boolean; now: Date },
  text: unknown,
): { ok: true; text: string; norm: string } | { ok: false; reason: GoRefusal } {
  if (!isOpen(ctx.state)) return { ok: false, reason: "not-open" };
  if (!goesOpen(ctx.year, ctx.now)) return { ok: false, reason: "closed" };
  if (ctx.guessed) return { ok: false, reason: "already" };
  if (ctx.typed) return { ok: false, reason: "been-there" };
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.length > GUESS_MAX) return { ok: false, reason: "too-long" };
  return { ok: true, text: trimmed, norm: normalisePlaceName(trimmed) };
}

/** The closing time the clues show: the place's own closing time, only when one is typed in Doors (the
 *  8pm a door falls back to is not the place's real time), only when it falls on the door's own day in
 *  London, from clue 1 (never on a snow day) until it has passed, and never once the elf has gone home (a
 *  visit is refused then, so the place is no longer worth a trip). Otherwise null. */
export function closingShown(run: DoorRun, now: Date): Date | null {
  if (run.closesAt === null || run.facts.goneHome) return null;
  const closes = run.facts.closesAt;
  if (!sameDay(closes, run.facts.clue1At)) return null;
  const state = doorState(run.facts, now);
  if (state === "shut" || state === "snow") return null;
  return now.getTime() < closes.getTime() ? closes : null;
}
