// TASK-482: the arithmetic behind Admin > Analytics that is not counting. Pure: no database and no
// clock of its own. The counting is SQL, in src/db/analytics-report.ts (GROUP BYs, and the 30
// minute visit split as a window function), so only small aggregate rows ever reach Node; the app
// shares one small task with donations and must not spend seconds walking months of page views.
//
// The definitions (docs/superpowers/specs/2026-09-30-site-analytics-design.md, "What the page answers"):
//   visitor   a distinct (day, visitor id) pair. The id changes every day, so the same person on two
//             days is two visitors, and a visitor is only ever counted once per day.
//   visit     one visitor's views on one day, split wherever the gap between two views is MORE than
//             30 minutes. Its first view is its entry page and decides its channel.
//   bounce    a visit with one view. The headline gives their share of all visits.
//   averages  of active seconds and scroll ignore views with no leave event yet (null).
import type { Channel } from "./channel";
import type { Device } from "./user-agent";
import { ukDay } from "./visitor";

export const PERIOD_DAYS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

/** UK days `from` to `to` inclusive, counting only page views at or before `until` (an ISO time). */
export type Period = { from: string; to: string; until: string };

export type Headline = { visitors: number; visits: number; views: number; bounceShare: number };
export type Daily = { day: string; visitors: number }[];
export type NewsletterRow = { campaign: string | null; label: string; visits: number };
export type PageRow = {
  path: string;
  views: number;
  visitors: number;
  avgActiveSeconds: number | null;
  avgScroll: number | null;
  entryShare: number;
};

/** Every panel, for the period being looked at. */
export type Panels = {
  headline: Headline;
  daily: Daily;
  channels: { channel: Channel; visits: number }[];
  otherWebsites: { source: string; visits: number }[];
  newsletters: NewsletterRow[];
  cities: { city: string; region: string | null; country: string | null; visitors: number }[];
  countries: { country: string; name: string; visitors: number }[];
  pages: PageRow[];
  clickKinds: { kind: string; clicks: number }[];
  clicks: { kind: string; label: string; clicks: number }[];
  devices: { device: Device; visitors: number }[];
  browsers: { browser: string; visitors: number }[];
};

/** The period before needs only what the page compares: the figures and the line. */
export type Comparison = { headline: Headline; daily: Daily };

const DAY_MS = 86_400_000;

// --- days and times ------------------------------------------------------------------------------

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

const UK_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** How far the UK clock is ahead of UTC at this moment: 0 in winter, an hour in summer. */
function ukOffsetMs(at: Date): number {
  const p = Object.fromEntries(UK_CLOCK.formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment that shows the same UK clock time `days` days earlier. */
function sameClockDaysBefore(now: Date, days: number): Date {
  let at = new Date(now.getTime() - days * DAY_MS);
  for (let i = 0; i < 2; i++) at = new Date(now.getTime() - days * DAY_MS + ukOffsetMs(now) - ukOffsetMs(at));
  return at;
}

/**
 * The last `days` UK days, today included up to now, and the same days just before, counted up to
 * the same time of day. Today is only part of a day, so comparing it with a whole day would read as
 * a fall every morning; this compares a morning with a morning.
 */
export function periodsFor(now: Date, days: PeriodDays): { current: Period; previous: Period } {
  const today = ukDay(now);
  const from = addDays(today, -(days - 1));
  return {
    current: { from, to: today, until: now.toISOString() },
    previous: {
      from: addDays(from, -days),
      to: addDays(from, -1),
      until: sameClockDaysBefore(now, days).toISOString(),
    },
  };
}

/** Every day of the period with its visitors, zero for a day with none. */
export function fillDays(rows: Daily, period: { from: string; to: string }): Daily {
  const byDay = new Map(rows.map((r) => [r.day, r.visitors]));
  const out: Daily = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) out.push({ day: d, visitors: byDay.get(d) ?? 0 });
  return out;
}

// --- shaping the SQL's rows ----------------------------------------------------------------------

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export function headlineFrom(row: { visitors: number; visits: number; views: number; bounces: number } | undefined): Headline {
  if (!row) return { visitors: 0, visits: 0, views: 0, bounceShare: 0 };
  return { visitors: row.visitors, visits: row.visits, views: row.views, bounceShare: percent(row.bounces, row.visits) };
}

/** Each page's entries as a share of all the period's visits. */
export function pagesFrom(rows: (Omit<PageRow, "entryShare"> & { entries: number })[], visits: number): PageRow[] {
  return rows.map(({ entries, ...rest }) => ({ ...rest, entryShare: percent(entries, visits) }));
}

let regionNames: Intl.DisplayNames | null = null;

/** "GB" to "United Kingdom". A code the list does not know is shown as it is. */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames("en", { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function countriesFrom(rows: { country: string; visitors: number }[]): Panels["countries"] {
  return rows.map((r) => ({ country: r.country, name: countryName(r.country), visitors: r.visitors }));
}

const NEWSLETTER_ID = /^\d{1,9}$/;

/** The campaigns that are newsletter ids (TASK-480 tags newsletter links with the newsletter's id). */
export function newsletterIds(rows: { campaign: string | null }[]): number[] {
  return rows.filter((r) => r.campaign !== null && NEWSLETTER_ID.test(r.campaign)).map((r) => Number(r.campaign));
}

/** Each issue labelled with its newsletter's subject where the campaign is one, else as it came. */
export function labelNewsletters(rows: { campaign: string | null; visits: number }[], subjects: Map<number, string>): NewsletterRow[] {
  return rows.map((r) => {
    const subject = r.campaign !== null && NEWSLETTER_ID.test(r.campaign) ? subjects.get(Number(r.campaign)) : undefined;
    return { campaign: r.campaign, label: subject ?? r.campaign ?? "Not known", visits: r.visits };
  });
}
