import { londonToInstant } from "../tickets/model";

// NBCC Elf Detective School: which day each door belongs to and when its clue comes out. The design
// is docs/superpowers/specs/2026-10-04-elf-detective-school-design.md ("Rules, precisely").
//
// The clue time is what keeps the race fair, so it follows the kind of day: after school and work on
// a school day, in the morning at a weekend or in the school holidays. Staff can set any door's time
// by hand; these are only the times a door starts with.
//
// Pure: no pool, no config, no clock (times are passed in). Unit tested in
// test/unit/elf-calendar.test.ts.

export const DOOR_COUNT = 24;

export type DayKind = "school" | "weekend" | "holiday";

export interface ElfSeason {
  /** The December the hunt runs in. */
  year: number;
  /** Doors staff have marked as school holidays. Weekends are worked out, not listed. */
  holidayDoors: readonly number[];
  /** The clue time on a school day, "HH:MM" on a clock in London. */
  schoolClue: string;
  /** The clue time at a weekend or in the holidays. */
  morningClue: string;
}

export const DEFAULT_SCHOOL_CLUE = "17:30";
export const DEFAULT_MORNING_CLUE = "10:00";

/** Is this a door number, 1 to 24? */
export function isDoor(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= DOOR_COUNT;
}

/** The date a door belongs to, as YYYY-MM-DD. Door 7 is 7 December. */
export function doorDate(season: Pick<ElfSeason, "year">, door: number): string {
  return `${season.year}-12-${String(door).padStart(2, "0")}`;
}

/** The door a London date belongs to, or null outside 1 to 24 December of the season's year. */
export function doorOn(season: Pick<ElfSeason, "year">, londonDate: string): number | null {
  const m = /^(\d{4})-12-(\d{2})$/.exec(londonDate);
  if (!m || Number(m[1]) !== season.year) return null;
  const day = Number(m[2]);
  return isDoor(day) ? day : null;
}

/** A school day, a weekend, or a weekday staff have marked as a holiday. A weekend is always a weekend. */
export function dayKind(season: ElfSeason, door: number): DayKind {
  const weekday = new Date(Date.UTC(season.year, 11, door)).getUTCDay(); // 0 is Sunday, 6 is Saturday
  if (weekday === 0 || weekday === 6) return "weekend";
  return season.holidayDoors.includes(door) ? "holiday" : "school";
}

/** The clue time a door starts with, before staff change it. */
export function defaultClueTime(season: ElfSeason, door: number): string {
  return dayKind(season, door) === "school" ? season.schoolClue : season.morningClue;
}

/** The moment a door's clue comes out: its own day at a London clock time. Null if either is not real. */
export function clueInstant(season: Pick<ElfSeason, "year">, door: number, time: string): Date | null {
  if (!isDoor(door) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const iso = londonToInstant(`${doorDate(season, door)}T${time}`);
  return iso ? new Date(iso) : null;
}
