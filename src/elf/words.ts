// NBCC Elf Detective School: times, dates and lists as people read them. The design is
// docs/superpowers/specs/2026-10-04-elf-detective-school-design.md.
//
// Every screen says when a clue comes out, when an elf was found and how long is left. They all say
// it through here, so a time is written one way everywhere ("5:30pm", never "17:30" in one place and
// "5.30 PM" in another), and always as it is on the clock in London, wherever the server runs.
//
// The pieces of a time are read with formatToParts and put together here. The whole formatted text
// is never used: what a formatter puts between "5:30" and "pm" has changed between versions.
//
// Pure: no pool, no config, no clock (every time is passed in). Unit tested in
// test/unit/elf-words.test.ts.

const LONDON = "Europe/London";

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" });
const LONG_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, weekday: "long", day: "numeric", month: "long" });
const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: LONDON, year: "numeric", month: "2-digit", day: "2-digit" });

const isRealDate = (at: Date): boolean => at instanceof Date && !Number.isNaN(at.getTime());

/** One named piece of a formatted date, such as its weekday. */
function part(format: Intl.DateTimeFormat, at: Date, type: Intl.DateTimeFormatPartTypes): string {
  return format.formatToParts(at).find((p) => p.type === type)?.value ?? "";
}

/** A time on the clock in London: "5:30pm", "10am", "12 noon", "midnight". Nothing for a date that is not one. */
export function clockWords(at: Date): string {
  if (!isRealDate(at)) return "";
  const hour = Number(part(CLOCK, at, "hour"));
  const minute = Number(part(CLOCK, at, "minute"));
  if (minute === 0 && hour === 12) return "12 noon";
  if (minute === 0 && hour === 0) return "midnight";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = minute === 0 ? "" : `:${String(minute).padStart(2, "0")}`;
  return `${twelve}${minutes}${hour < 12 ? "am" : "pm"}`;
}

/** A day in London, short enough for a door: "Mon 7 Dec". */
export function dayWords(at: Date): string {
  if (!isRealDate(at)) return "";
  return `${part(SHORT_DAY, at, "weekday")} ${part(SHORT_DAY, at, "day")} ${part(SHORT_DAY, at, "month")}`;
}

/** A day in London, in full for a sentence: "Monday 7 December". */
export function longDayWords(at: Date): string {
  if (!isRealDate(at)) return "";
  return `${part(LONG_DAY, at, "weekday")} ${part(LONG_DAY, at, "day")} ${part(LONG_DAY, at, "month")}`;
}

/** How long is left, for a countdown: "2:14:09", "14:09", "0:05". A part second counts as a whole
 *  one, so it reads "0:00" exactly when the time comes, and stays there. */
export function countdownWords(ms: number): string {
  const left = Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0;
  const hours = Math.floor(left / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  const seconds = String(left % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The London date as a count of days, for taking one day from another. */
function londonDayNumber(at: Date): number {
  const year = Number(part(DATE, at, "year"));
  const month = Number(part(DATE, at, "month"));
  const day = Number(part(DATE, at, "day"));
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Are these two moments on the same day in London? */
export function sameDay(a: Date, b: Date): boolean {
  return isRealDate(a) && isRealDate(b) && londonDayNumber(a) === londonDayNumber(b);
}

/** How many nights there are between now and a day to come, in London. None on the day itself. */
export function sleepsUntil(now: Date, then: Date): number {
  if (!isRealDate(now) || !isRealDate(then)) return 0;
  return Math.max(0, londonDayNumber(then) - londonDayNumber(now));
}

/** A list as a sentence would have it: "Ruby", "Ruby and Sam", "Ruby, Sam and Mia". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A count with its noun: "1 door", "3 doors", "2 elves". */
export function things(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
