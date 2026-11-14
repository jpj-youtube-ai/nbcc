import type { DoorRun } from "../db/elf-game";
import { londonToInstant } from "../tickets/model";
import { CHRISTMAS_EVE, doorInstant, isDoor } from "./calendar";
import { newYearsDay } from "./catch-up";
import { doorSeason } from "./door-setup";
import { doorState, isDone, shownAt } from "./doors";
import type { ElfSettings } from "./settings";
import { clockWords } from "./words";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2). The design is
// docs/superpowers/specs/2026-11-12-elf-catch-up-and-grand-prize-design.md, part 2, with Jaimie's
// answers 1, 3 and 4.
//
// Every detective who has done all 24 doors can send in one picture for the grand prize, from midnight
// in London as Christmas Eve begins until the entries close: 5pm on Christmas Eve, unless a head elf sets
// another time in Head Elf HQ > Settings. A family can finish door 24 only once its place is shown: when
// its elf is found and the reveal time has come, or when its place closes (4pm unless a head elf types a
// time, src/elf/calendar.ts). So the entries may close no earlier than an hour after the latest door 24
// can open. In the week before Christmas Eve, the clue email asks a family that is up to date whether its
// picture is ready and tells one that is behind what it can still crack from home, and door 23's email
// says when door 24's first clue comes out.
//
// Pure: no pool, no config, no clock (the time is passed in). Unit tested in
// test/unit/elf-grand-prize.test.ts.

const HOUR_MS = 60 * 60 * 1000;

/** When the entries close on Christmas Eve unless a head elf sets another time (Jaimie, 12 November 2026). */
export const GRAND_PRIZE_DEFAULT_TIME = "17:00";

/** Head Elf HQ's words when the one winner index refuses a marking because another head elf marked a
 *  winner at the same moment (ruling F5). The year's entries are locked first, so this is a safety net. */
export const WINNER_TAKEN_WORDS = "Someone has just marked a winner. Reload to see it.";

/** The emails of the week before Christmas Eve: those of doors 17 to 23 (the spec's call). */
const WEEK_BEFORE = { first: 17, last: 23 } as const;

/** The day before Christmas Eve: its email says when door 24's first clue comes out. */
const DAY_BEFORE_CHRISTMAS_EVE = 23;

const isRealDate = (d: unknown): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

/** Midnight in London as 24 December of `year` begins, when the entries open. In practice nobody has done
 *  all 24 doors before door 24's first clue. An Invalid Date for a year that is not one. */
export function entriesOpenAt(year: number): Date {
  return new Date(londonToInstant(`${year}-12-24T00:00`) ?? Number.NaN);
}

/** When the entries close: the moment a head elf stored, when it is a real date from entriesOpenAt(year)
 *  on; otherwise 5pm in London on Christmas Eve of `year`. A moment stored for an earlier year, or none
 *  (older settings have no such key), reads as that default (ruling F7). */
export function grandPrizeClosesAt(s: Pick<ElfSettings, "year" | "grandPrizeClosesAt">): Date {
  const stored = s.grandPrizeClosesAt;
  if (isRealDate(stored) && stored.getTime() >= entriesOpenAt(s.year).getTime()) return stored;
  return doorInstant(doorSeason(s.year), CHRISTMAS_EVE, GRAND_PRIZE_DEFAULT_TIME) ?? new Date(Number.NaN);
}

/** May a detective send in a picture now? Only one who has done all 24 doors (a graduate), from
 *  entriesOpenAt(year) until the entries close. */
export function entryOpen(o: { graduate: boolean; year: number; closesAt: Date; now: Date }): boolean {
  const t = o.now.getTime();
  return o.graduate && entriesOpenAt(o.year).getTime() <= t && t < o.closesAt.getTime();
}

/** Does Detective HQ show the grand prize section? While December's doors are on, from entriesOpenAt(year)
 *  until the later of the entries closing and 1 January. The one rule (ruling F9) for both reading a
 *  family's entries and drawing the section. */
export function prizeSectionShows(o: { doorsOn: boolean; year: number; closesAt: Date; now: Date }): boolean {
  if (!o.doorsOn) return false;
  const t = o.now.getTime();
  const end = Math.max(o.closesAt.getTime(), newYearsDay(o.year).getTime());
  return entriesOpenAt(o.year).getTime() <= t && t < end;
}

/** The latest door 24's place can be shown: the later of its reveal time and its closing, as when nobody
 *  finds its elf. Like every rule below, it takes door 24's run (ruling F3). */
export function latestOpening(door24: DoorRun): Date {
  return shownAt({ ...door24.facts, foundAt: null });
}

/** The earliest the entries may close: an hour after door 24's latest opening, so every family has an
 *  hour to finish once its place is shown. */
export function earliestClosing(door24: DoorRun): Date {
  return new Date(latestOpening(door24).getTime() + HOUR_MS);
}

/** Why Head Elf HQ refuses a closing time for the entries, or null when it may be saved: the closing is
 *  before earliestClosing. */
export function closingRefusal(o: { closesAt: Date; door24: DoorRun }): string | null {
  const earliest = earliestClosing(o.door24);
  if (o.closesAt.getTime() >= earliest.getTime()) return null;
  return `Door 24's hiding place closes at ${clockWords(latestOpening(o.door24))}, so grand prize entries can close at ${clockWords(earliest)} at the earliest.`;
}

/** The warning for Settings and for door 24 in Doors, or null: door 24's place can be shown later than an
 *  hour before the entries close. Doors only warns: a head elf may type a later closing for door 24. */
export function door24Warning(o: { closesAt: Date; door24: DoorRun }): string | null {
  const by = new Date(o.closesAt.getTime() - HOUR_MS);
  if (latestOpening(o.door24).getTime() <= by.getTime()) return null;
  return `Grand prize entries close at ${clockWords(o.closesAt)}, so door 24's place must close by ${clockWords(by)}.`;
}

/** What a family's clue email says in the week before Christmas Eve. */
export type CatchUp = { ready: true } | { ready: false; fromHome: number };

/** For the clue email of `door`: null unless it is one of doors 17 to 23. Ready when the family has done
 *  (`done`) every real door but the email's own that is done for everyone at `now`: open, or snowed in.
 *  Otherwise behind, with the doors it can still crack from home (`fromHome`, as the caller counted them). */
export function catchUpOf(o: { door: number; runs: readonly DoorRun[]; done: readonly number[]; fromHome: number; now: Date }): CatchUp | null {
  if (o.door < WEEK_BEFORE.first || o.door > WEEK_BEFORE.last) return null;
  const done = new Set(o.done);
  const ready = o.runs.every(
    (run) => !isDoor(run.door) || run.door === o.door || !isDone(doorState(run.facts, o.now)) || done.has(run.door),
  );
  return ready ? { ready: true } : { ready: false, fromHome: o.fromHome };
}

/** For door 23's email: when door 24's first clue comes out, so families know Christmas Eve starts in the
 *  morning. Null for every other door's email; and when door 24 is snowed in, because a head elf can call
 *  it off before its first clue and then no clue comes out (ruling F17), or is not among the runs. */
export function christmasEveOf(o: { door: number; runs: readonly DoorRun[] }): { clue1At: Date } | null {
  if (o.door !== DAY_BEFORE_CHRISTMAS_EVE) return null;
  const eve = o.runs.find((run) => run.door === CHRISTMAS_EVE);
  if (!eve || eve.facts.snowDay) return null;
  return { clue1At: eve.facts.clue1At };
}
