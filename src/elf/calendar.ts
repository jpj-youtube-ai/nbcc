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
// (`isDoor`, `isClockTime`, `doorOn`, `clueTimeFor`, `doorInstant`) check it, and answer null or the
// usual time, never a made up date.
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

/** A school day, a weekend, or a weekday staff have marked as a holiday. A weekend is always a weekend. */
export function dayKind(season: ElfSeason, door: Door): DayKind {
  const weekday = new Date(Date.UTC(season.year, 11, door)).getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (weekday === 0 || weekday === 6) return "weekend";
  return season.holidayDoors.includes(door) ? "holiday" : "school";
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
 * The moment a London clock time happens on a door's day. It is how a clue time, and the time a
 * place closes, become a moment to compare with now. Null if the door or the time is not real.
 */
export function doorInstant(season: Pick<ElfSeason, "year">, door: number, time: string): Date | null {
  if (!isDoor(door) || !isClockTime(time)) return null;
  const iso = londonToInstant(`${doorDate(season, door)}T${time.slice(0, 5)}`);
  return iso ? new Date(iso) : null;
}
