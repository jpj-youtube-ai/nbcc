import type { DoorRun } from "../db/elf-game";
import { doorInstant, type Door } from "./calendar";
import { doorSeason } from "./door-setup";
import { RANKS, type Progress, type Rank } from "./progress";

// NBCC Elf Detective School wave 2: what the elf worker (src/elf/worker.ts) sends, and when. Pure: the
// doors and the moment come in, the sends that are due go out, each with the key it is claimed by in
// elf_sends, so it goes once however many tasks tick and however often. Design:
// docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md, "Emails in wave 2". Times are
// Europe/London. Unit tested in test/unit/elf-schedule.test.ts.
//
//   clue      a door's first clue is out: the clue email to every family, for six hours from clue 1
//   reminder  9am on a door's day: the reminder to its place, for three hours, when it has an email
//   morning   from 8am each day, 30 November to 25 December: the Elf HQ email to head elves
//   find      a door's elf has been found: the find alert to head elves
//   sweep     every ten minutes: promotions and graduations earned any way (a guess, a snow day, a visit
//             that counts from the reveal) that no word has sent yet
//
// A snowed in door sends no clue email and no reminder. With December's doors off nothing is due.

export type DueKind = "clue" | "reminder" | "morning" | "find" | "sweep";

export interface Due {
  kind: DueKind;
  key: string;
  door: Door | null;
}

/** How many families one tick sends a door's clue email to: a tick every 30 seconds gets through 50 a
 *  minute without holding the worker up. */
export const CLUE_EMAILS_A_TICK = 25;

const HOUR_MS = 60 * 60 * 1000;
/** How long after clue 1 its email may still go: past that, a family has had the evening anyway. */
const CLUE_WINDOW_MS = 6 * HOUR_MS;
/** The place's reminder goes at 9am, or as soon after as the worker can, until noon. */
const REMINDER_TIME = "09:00";
const REMINDER_WINDOW_MS = 3 * HOUR_MS;
/** The morning email goes at 8am. */
const MORNING_HOUR = 8;
const SWEEP_MS = 10 * 60 * 1000;

const LONDON_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** The London date as YYYY-MM-DD, and the London hour, of a moment. */
export function londonDateAndHour(at: Date): { date: string; hour: number } {
  const p = Object.fromEntries(LONDON_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

/** Is a London date one of the morning email's days: 30 November to 25 December of that December's year? */
function morningDay(year: number, date: string): boolean {
  if (date === `${year}-11-30`) return true;
  const m = /^(\d{4})-12-(\d{2})$/.exec(date);
  return !!m && Number(m[1]) === year && Number(m[2]) >= 1 && Number(m[2]) <= 25;
}

/** Everything due at `now`, in the order a tick sends it: the clue emails families wait for first, then the
 *  reminders, the morning email, the find alerts and the sweep. */
export function dueNow(o: { year: number; runs: DoorRun[]; now: Date; doorsOn: boolean }): Due[] {
  if (!o.doorsOn) return [];
  const t = o.now.getTime();
  const season = doorSeason(o.year);
  const clues: Due[] = [];
  const reminders: Due[] = [];
  const finds: Due[] = [];
  for (const run of o.runs) {
    // The practice door never sends anything to anyone.
    if (run.door === 0) continue;
    const door = run.door;
    const key = `${o.year}-${door}`;
    const clue1 = run.facts.clue1At.getTime();
    if (!run.facts.snowDay && clue1 <= t && t < clue1 + CLUE_WINDOW_MS) clues.push({ kind: "clue", key, door });
    const nine = doorInstant(season, door, REMINDER_TIME)?.getTime();
    if (nine !== undefined && !run.facts.snowDay && run.contactEmail && nine <= t && t < nine + REMINDER_WINDOW_MS) reminders.push({ kind: "reminder", key, door });
    if (run.facts.foundAt) finds.push({ kind: "find", key, door });
  }
  const { date, hour } = londonDateAndHour(o.now);
  const morning: Due[] = hour >= MORNING_HOUR && morningDay(o.year, date) ? [{ kind: "morning", key: date, door: null }] : [];
  return [...clues, ...reminders, ...morning, ...finds, { kind: "sweep", key: `${o.year}:${Math.floor(t / SWEEP_MS)}`, door: null }];
}

/** A proud moment a detective has reached: a promotion to a rank, or graduating. */
export interface ProudMoment {
  key: string;
  kind: "promoted" | "graduated";
  rank: Rank | null;
}

/** Every proud moment a detective's progress has reached, in order: a promotion for each rank above
 *  Trainee reached, then graduating once every door is done. Graduate is the rank every door brings, so it
 *  is the graduation alone: a family is never sent a promotion to Graduate as well. */
export function proudMomentsOf(detectiveId: number, progress: Progress): ProudMoment[] {
  const out: ProudMoment[] = RANKS.filter((r) => r.at > 0 && r.rank !== "Graduate" && r.at <= progress.doorsDone).map((r) => ({
    key: `rank:${detectiveId}:${r.rank}`,
    kind: "promoted" as const,
    rank: r.rank,
  }));
  if (progress.graduate) out.push({ key: `grad:${detectiveId}`, kind: "graduated", rank: null });
  return out;
}

/** The keys of a detective's proud moments, each claimed as ("proud", `${year}:${key}`). */
export function proudKeys(year: number, detectiveId: number, progress: Progress): string[] {
  return proudMomentsOf(detectiveId, progress).map((m) => m.key);
}
