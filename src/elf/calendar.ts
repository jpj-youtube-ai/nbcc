import { londonToInstant } from "../tickets/model";

// NBCC Elf Detective School: which day each door belongs to and when its clue comes out. The design
// is docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// The clue time is what keeps the race fair, so it follows the kind of day: after school and work on
// a school day, in the morning at a weekend or in the school holidays. Staff can set any door's time
// by hand; the defaults here are only what a door starts with.
//
// One rule about bad input, for the whole file. A `Door` can only be had by checking a number with
// `isDoor`, or by writing a number from 1 to 24 in the code, so the functions that take a `Door`
// trust it. The functions that take whatever arrived from a form, an address or a settings row
// (`isDoor`, `isClockTime`, `doorOn`, `clueTimeFor`, `doorInstant`, `closingInstant`) check it, and
// answer null or the usual time, never a made up date.
//
// Pure: no pool, no config, no clock (times are passed in). Unit tested in
// test/unit/elf-calendar.test.ts.

export const DOOR_COUNT = 24;

/** A door number: 1 to 24. */
export type Door =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
  | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24;

export type DayKind = "school" | "weekend" | "holiday";

export interface ElfSeason {
  /** The December the hunt runs in. */
  year: number;
  /** Doors staff have marked as school holidays. Weekends are worked out, not listed. */
  holidayDoors: readonly number[];
  /** The time a clue comes out on a school day, "HH:MM" on a clock in London. */
  schoolClueTime: string;
  /** The time a clue comes out at a weekend or in the holidays. */
  morningClueTime: string;
}

export const DEFAULT_SCHOOL_CLUE_TIME = "17:30";
export const DEFAULT_MORNING_CLUE_TIME = "10:00";

/** Is this a door number, 1 to 24? */
export function isDoor(n: unknown): n is Door {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= DOOR_COUNT;
}

/** Is this a time on a 24 hour clock, "HH:MM"? Seconds are allowed and ignored, as a database gives them. */
export function isClockTime(time: unknown): time is string {
  return typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time);
}

/** A real clock time as "HH:MM", or the fallback when it is not one. */
function clockOr(time: unknown, fallback: string): string {
  return isClockTime(time) ? time.slice(0, 5) : fallback;
}

/** The date a door belongs to, as YYYY-MM-DD. Door 7 is 7 December. */
export function doorDate(season: Pick<ElfSeason, "year">, door: Door): string {
  return `${season.year}-12-${String(door).padStart(2, "0")}`;
}

/** The door a London date belongs to, or null outside 1 to 24 December of the season's year. */
export function doorOn(season: Pick<ElfSeason, "year">, londonDate: string): Door | null {
  const m = /^(\d{4})-12-(\d{2})$/.exec(londonDate);
  if (!m || Number(m[1]) !== season.year) return null;
  const day = Number(m[2]);
  return isDoor(day) ? day : null;
}

/** Christmas Eve's door. Places close early that day, so it is a morning door (TASK-613), and its place
 *  closes at CHRISTMAS_EVE_CLOSING_TIME unless a head elf types its own time (Plan 2c-2). */
export const CHRISTMAS_EVE: Door = 24;

/** A school day, a weekend, or a weekday staff have marked as a holiday. A weekend is always a weekend.
 *  Christmas Eve on a weekday is a holiday whether or not staff marked it (Jaimie, 11 November 2026: its
 *  clue comes out at 10am, because places close early), so its clue starts at the morning time unless
 *  a head elf sets the door's own. */
export function dayKind(season: ElfSeason, door: Door): DayKind {
  const weekday = new Date(Date.UTC(season.year, 11, door)).getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (weekday === 0 || weekday === 6) return "weekend";
  return door === CHRISTMAS_EVE || season.holidayDoors.includes(door) ? "holiday" : "school";
}

/** The clue time a door starts with, before staff change it. Always a real "HH:MM". */
export function defaultClueTime(season: ElfSeason, door: Door): string {
  return dayKind(season, door) === "school"
    ? clockOr(season.schoolClueTime, DEFAULT_SCHOOL_CLUE_TIME)
    : clockOr(season.morningClueTime, DEFAULT_MORNING_CLUE_TIME);
}

/** The clue time a door uses: the one staff set for it when that is a real time, otherwise its default. */
export function clueTimeFor(season: ElfSeason, door: Door, staffTime: string | null | undefined): string {
  return clockOr(staffTime, defaultClueTime(season, door));
}

/**
 * The moment a London clock time happens on a door's day. It is how a clue time becomes a moment to
 * compare with now. For the time a place closes use `closingInstant`, which knows that a place can
 * close after midnight. Null if the door or the time is not real.
 */
export function doorInstant(season: Pick<ElfSeason, "year">, door: number, time: string): Date | null {
  if (!isDoor(door) || !isClockTime(time)) return null;
  const iso = londonToInstant(`${doorDate(season, door)}T${time.slice(0, 5)}`);
  return iso ? new Date(iso) : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When a place is taken to close if staff have set no time for it, on every door but Christmas Eve's. */
export const DEFAULT_CLOSING_TIME = "20:00";

/** When door 24's place is taken to close if staff have set no time for it: places close early on
 *  Christmas Eve (Jaimie, 12 November 2026), and the grand prize entries close an hour later, at 5pm by
 *  default (src/elf/grand-prize.ts). A head elf may type an earlier time, or a later one, which Head Elf
 *  HQ warns about but never refuses in Doors. */
export const CHRISTMAS_EVE_CLOSING_TIME = "16:00";

/** No door's place is shown later than this on Christmas Eve, so that everyone can finish. */
export const LAST_REVEAL_TIME = "20:00";

/** The closing time a door falls back to when staff have set none: 4pm on Christmas Eve, 8pm otherwise. */
function closingTimeOr(door: number, closingTime: string | null | undefined): string {
  return clockOr(closingTime, door === CHRISTMAS_EVE ? CHRISTMAS_EVE_CLOSING_TIME : DEFAULT_CLOSING_TIME);
}

/**
 * The moment a door's place closes, which is when an unfound elf's place is shown. `clueTime` is the
 * door's clue time and `closingTime` is the time staff gave for the place (if they gave none, or one
 * that is not a real time: 4pm on Christmas Eve, door 24, and 8pm on every other door).
 *
 * A closing time that is not after the clue cannot mean that day: the place is open past midnight,
 * or it shut before the clue came out and the hunt carries on when it opens again. Either way it is
 * taken as that time on the next day. So anything that warns staff about a place shutting before
 * its clue must compare the two clock times itself: this function has already moved it on a day.
 *
 * Whatever the times, the answer is never later than 8pm on Christmas Eve. Every door has to be open
 * by then, or nobody could finish. A clue at 8pm or later on Christmas Eve leaves no time to hunt at
 * all, so the answer is null and the admin must refuse it. Null too if the door or its clue time is
 * not real.
 */
export function closingInstant(
  season: Pick<ElfSeason, "year">,
  door: number,
  clueTime: string,
  closingTime: string | null | undefined,
): Date | null {
  const clue = doorInstant(season, door, clueTime);
  const sameDay = doorInstant(season, door, closingTimeOr(door, closingTime));
  const last = doorInstant(season, DOOR_COUNT, LAST_REVEAL_TIME);
  if (!clue || !sameDay || !last) return null;
  // December has no clock change, so a day later is the same time on the clock.
  const close = sameDay.getTime() > clue.getTime() ? sameDay.getTime() : sameDay.getTime() + DAY_MS;
  const capped = Math.min(close, last.getTime());
  return capped > clue.getTime() ? new Date(capped) : null;
}

// A door's evening: the four times of the hunt on its own day. Clue 1 follows the kind of day (or the
// time staff set). Each later time is the one staff set, or half an hour after the one before.

export interface StaffEvening {
  clue1?: string | null;
  clue2?: string | null;
  clue3?: string | null;
  reveal?: string | null;
}

export type EveningProblem =
  | "clue2-not-after-clue1"
  | "clue3-not-after-clue2"
  | "reveal-not-after-clue3"
  | "past-midnight";

export interface Evening {
  clue1: string;
  clue2: string;
  clue3: string;
  reveal: string;
  problems: EveningProblem[];
}

export const EVENING_PROBLEM_WORDS: Record<EveningProblem, string> = {
  "clue2-not-after-clue1": "Clue 2 must come after clue 1.",
  "clue3-not-after-clue2": "Clue 3 must come after clue 2.",
  "reveal-not-after-clue3": "The place must be shown after clue 3.",
  "past-midnight": "Every time must be on the door's own day, before midnight.",
};

const EVENING_GAP_MINUTES = 30;
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function clockOfMinutes(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The four times of a door's evening, and anything wrong with their order. */
export function eveningFor(season: ElfSeason, door: Door, staff: StaffEvening): Evening {
  const problems: EveningProblem[] = [];
  let pastMidnight = false;
  const clue1 = clueTimeFor(season, door, staff.clue1);
  const next = (staffTime: string | null | undefined, before: string): string => {
    if (isClockTime(staffTime)) return staffTime.slice(0, 5);
    const wanted = minutesOf(before) + EVENING_GAP_MINUTES;
    if (wanted > LAST_MINUTE_OF_DAY) {
      pastMidnight = true;
      return clockOfMinutes(LAST_MINUTE_OF_DAY);
    }
    return clockOfMinutes(wanted);
  };
  const clue2 = next(staff.clue2, clue1);
  const clue3 = next(staff.clue3, clue2);
  const reveal = next(staff.reveal, clue3);
  if (minutesOf(clue2) <= minutesOf(clue1)) problems.push("clue2-not-after-clue1");
  if (minutesOf(clue3) <= minutesOf(clue2)) problems.push("clue3-not-after-clue2");
  if (minutesOf(reveal) <= minutesOf(clue3)) problems.push("reveal-not-after-clue3");
  if (pastMidnight) problems.push("past-midnight");
  return { clue1, clue2, clue3, reveal, problems };
}

/** Does the door's place close less than an hour after clue 3? Both are clock times on the same day. A
 *  door with no closing time typed closes at its fallback: 4pm on Christmas Eve, 8pm otherwise. */
export function closesTooSoon(door: number, closesAt: string | null, clue3: string): boolean {
  if (!isClockTime(clue3)) return false;
  return minutesOf(closingTimeOr(door, closesAt)) - minutesOf(clue3) < 60;
}
