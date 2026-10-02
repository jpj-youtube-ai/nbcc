import { dayInWords } from "../ball/sales-report";

// "Coming up" on the admin Overview (stage 3): the next 14 days, in date order, grouped by day.
// These are the pure rules; the reads are in src/routes/admin-overview.ts. Design:
// docs/superpowers/specs/2026-10-03-admin-overview-design.md.

/** One dated thing, as a source finds it. */
export interface Upcoming {
  /** The UK day, YYYY-MM-DD. */
  day: string;
  /** The UK time, HH:MM, or null when there is none (or it is still to be confirmed). */
  time: string | null;
  text: string;
  /** The admin screen that deals with it, and its name as the menu shows it. */
  view: string;
  button: string;
}

export interface ComingUpDay {
  day: string;
  /** "Today", "Tomorrow", or the weekday and date: "Wednesday 7 October". */
  label: string;
  items: Array<Omit<Upcoming, "day" | "time"> & { when: string }>;
}

/** How many days ahead, today included. */
export const COMING_UP_DAYS = 14;

// A YYYY-MM-DD day at midday UTC, so adding days never trips over the clocks changing.
const plusDays = (day: string, n: number) =>
  new Date(new Date(`${day}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** 7:30pm, 8am, 12pm. */
function timeInWords(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** Today and the 13 days after it, by day, timed things first and earliest first. */
export function comingUp(items: readonly Upcoming[], today: string): ComingUpDay[] {
  const last = plusDays(today, COMING_UP_DAYS - 1);
  const tomorrow = plusDays(today, 1);
  const inRange = items.filter((i) => i.day >= today && i.day <= last);
  const sorted = [...inRange].sort(
    (a, b) => a.day.localeCompare(b.day) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99"),
  );
  const days: ComingUpDay[] = [];
  for (const i of sorted) {
    let d = days[days.length - 1];
    if (!d || d.day !== i.day) {
      d = { day: i.day, label: i.day === today ? "Today" : i.day === tomorrow ? "Tomorrow" : dayInWords(i.day), items: [] };
      days.push(d);
    }
    d.items.push({ text: i.text, view: i.view, button: i.button, when: timeInWords(i.time) });
  }
  return days;
}

// --- turning each screen's rows into dated lines --------------------------------------------------

const UK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** A moment as the UK day and time it falls on. pg hands timestamptz back as a Date, typed or not. */
export function ukDayAndTime(at: Date | string): { day: string; time: string } {
  const p = Object.fromEntries(UK.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Events on the Events screen; a draft is said to be one, and a time to be confirmed is left off. */
export function eventItems(rows: ReadonlyArray<{ name: string; date: string; start: string | null; timeTbc: boolean; status: string }>): Upcoming[] {
  return rows.map((e) => ({
    day: e.date,
    time: e.timeTbc ? null : e.start,
    text: e.status === "draft" ? `${e.name} (still a draft)` : e.name,
    view: "events",
    button: "Events",
  }));
}

/** Approved fundraisers still on the list, on their event day. */
export function fundraiserItems(
  rows: ReadonlyArray<{ title: string; eventDate: string | null; startTime: string | null; status: string; offListAt?: string | null }>,
): Upcoming[] {
  return rows
    .filter((f) => f.status === "approved" && !f.offListAt && f.eventDate)
    .map((f) => ({ day: f.eventDate as string, time: f.startTime, text: `${f.title} (a fundraiser)`, view: "fundraising", button: "Fundraising" }));
}

/** Newsletters waiting to go at a set time. One with no time is going now, not coming up. */
export function newsletterItems(rows: ReadonlyArray<{ status: string; scheduledAt: Date | string | null; subject: string }>): Upcoming[] {
  return rows
    .filter((j) => j.status === "queued" && j.scheduledAt)
    .map((j) => ({ ...ukDayAndTime(j.scheduledAt as Date | string), text: `The newsletter goes out: ${j.subject}`, view: "newsletter", button: "Newsletter" }));
}

/** The Festive Ball's dates that are set, and the night itself. */
export function ballDateItems(d: {
  gateOpensAt: Date | string | null;
  salesCloseAt: Date | string | null;
  guestDetailsLockAt: Date | string | null;
  night: Date;
}): Upcoming[] {
  const dates: Array<[Date | string | null, string]> = [
    [d.gateOpensAt, "Festive Ball ticket sales open"],
    [d.salesCloseAt, "Festive Ball ticket sales close"],
    [d.guestDetailsLockAt, "Festive Ball guest details and menu choices close"],
    [d.night, "The Festive Ball"],
  ];
  return dates
    .filter(([at]) => at)
    .map(([at, text]) => ({ ...ukDayAndTime(at as Date | string), text, view: "ball", button: "Festive Ball" }));
}
