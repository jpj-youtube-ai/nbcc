// TASK-482: the arithmetic behind Admin > Analytics. Pure: rows in, panels out, no database and no
// clock. src/db/analytics-report.ts reads the rows; this turns them into what the page shows.
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

export type ViewFact = {
  at: Date | string;
  day: string;
  visitor: string;
  path: string;
  channel: Channel;
  source: string | null;
  campaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: Device;
  browser: string;
  activeSeconds: number | null;
  maxScroll: number | null;
};

/** Clicks already added up by day, kind and label in SQL. */
export type ClickFact = { day: string; kind: string; label: string; count: number };

export type Period = { from: string; to: string };

export type Visit = { views: ViewFact[]; entry: ViewFact };

export type NewsletterRow = { campaign: string | null; label: string; visits: number };

export type Panels = {
  headline: { visitors: number; visits: number; views: number; bounceShare: number };
  daily: { day: string; visitors: number }[];
  channels: { channel: Channel; visits: number }[];
  otherWebsites: { source: string; visits: number }[];
  newsletters: NewsletterRow[];
  cities: { city: string; region: string | null; country: string | null; visitors: number }[];
  countries: { country: string; name: string; visitors: number }[];
  pages: {
    path: string;
    views: number;
    visitors: number;
    avgActiveSeconds: number | null;
    avgScroll: number | null;
    entryShare: number;
  }[];
  clickKinds: { kind: string; clicks: number }[];
  clicks: { kind: string; label: string; clicks: number }[];
  devices: { device: Device; visitors: number }[];
  browsers: { browser: string; visitors: number }[];
};

export const PERIOD_DAYS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];

const VISIT_GAP_MS = 30 * 60 * 1000;
const DAY_MS = 86_400_000;

// --- days ----------------------------------------------------------------------------------------

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY_MS);
}

/** The last `days` UK days up to and including today, and the same number of days just before. */
export function periodsFor(today: string, days: PeriodDays): { current: Period; previous: Period } {
  const from = addDays(today, -(days - 1));
  return {
    current: { from, to: today },
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
  };
}

function daysOf(period: Period): string[] {
  const out: string[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) out.push(d);
  return out;
}

// --- visits --------------------------------------------------------------------------------------

const ms = (at: Date | string) => new Date(at).getTime();
const visitorKey = (v: ViewFact) => `${v.day}\n${v.visitor}`;

/** Each visitor's views on each day, in time order, split where the gap exceeds 30 minutes. */
export function splitVisits(views: ViewFact[]): Visit[] {
  const byVisitor = new Map<string, ViewFact[]>();
  for (const v of views) {
    const key = visitorKey(v);
    const list = byVisitor.get(key);
    if (list) list.push(v);
    else byVisitor.set(key, [v]);
  }
  const visits: Visit[] = [];
  for (const list of byVisitor.values()) {
    list.sort((a, b) => ms(a.at) - ms(b.at));
    let current: ViewFact[] = [];
    for (const v of list) {
      const last = current[current.length - 1];
      if (last && ms(v.at) - ms(last.at) > VISIT_GAP_MS) {
        visits.push({ views: current, entry: current[0] });
        current = [];
      }
      current.push(v);
    }
    if (current.length) visits.push({ views: current, entry: current[0] });
  }
  return visits;
}

// --- counting helpers ----------------------------------------------------------------------------

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function average(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null && v !== undefined);
  if (!known.length) return null;
  return Math.round(known.reduce((a, b) => a + b, 0) / known.length);
}

/** Tally by key, most first, ties in alphabetical order of their label. */
function ranked<K, R>(
  items: Iterable<{ key: string; sample: K; weight?: number }>,
  make: (sample: K, total: number) => R,
  label: (sample: K) => string,
): R[] {
  const tally = new Map<string, { sample: K; total: number }>();
  for (const { key, sample, weight = 1 } of items) {
    const t = tally.get(key);
    if (t) t.total += weight;
    else tally.set(key, { sample, total: weight });
  }
  return [...tally.values()]
    .sort((a, b) => b.total - a.total || label(a.sample).localeCompare(label(b.sample)))
    .map((t) => make(t.sample, t.total));
}

/** Visitors (distinct day and visitor pairs) per value of `keyOf`, skipping views where it is null. */
function visitorsBy<R>(views: ViewFact[], keyOf: (v: ViewFact) => string | null, make: (v: ViewFact, n: number) => R): R[] {
  const seen = new Set<string>();
  const items: { key: string; sample: ViewFact }[] = [];
  for (const v of views) {
    const key = keyOf(v);
    if (key === null) continue;
    const pair = `${key}\n${visitorKey(v)}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    items.push({ key, sample: v });
  }
  return ranked(items, make, (v) => keyOf(v) ?? "");
}

// --- countries -----------------------------------------------------------------------------------

let regionNames: Intl.DisplayNames | null = null;

/** "GB" to "United Kingdom". A code the browser's list does not know is shown as it is. */
export function countryName(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames("en", { type: "region" });
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

// --- newsletter issues ---------------------------------------------------------------------------

/** The campaigns that are newsletter ids (TASK-480 tags newsletter links with the newsletter's id). */
export function newsletterIds(rows: { campaign: string | null }[]): number[] {
  return rows.filter((r) => r.campaign !== null && /^\d{1,9}$/.test(r.campaign)).map((r) => Number(r.campaign));
}

/** Label each issue with its newsletter's subject where the campaign is one; any other stays as it is. */
export function labelNewsletters(rows: NewsletterRow[], subjects: Map<number, string>): NewsletterRow[] {
  return rows.map((r) => {
    const subject = r.campaign !== null && /^\d{1,9}$/.test(r.campaign) ? subjects.get(Number(r.campaign)) : undefined;
    return subject ? { ...r, label: subject } : r;
  });
}

// --- the panels ----------------------------------------------------------------------------------

/** Every panel for one period, from rows that may also hold other periods' (they are left out). */
export function buildPanels(allViews: ViewFact[], allClicks: ClickFact[], period: Period): Panels {
  const inPeriod = (day: string) => day >= period.from && day <= period.to;
  const views = allViews.filter((v) => inPeriod(v.day));
  const clicks = allClicks.filter((c) => inPeriod(c.day));
  const visits = splitVisits(views);
  const entries = visits.map((v) => v.entry);

  const visitorSet = new Set(views.map(visitorKey));
  const perDay = new Map<string, Set<string>>();
  for (const v of views) {
    const set = perDay.get(v.day) ?? new Set<string>();
    set.add(v.visitor);
    perDay.set(v.day, set);
  }

  const entriesByPath = new Map<string, number>();
  for (const e of entries) entriesByPath.set(e.path, (entriesByPath.get(e.path) ?? 0) + 1);

  const viewsByPath = new Map<string, ViewFact[]>();
  for (const v of views) {
    const list = viewsByPath.get(v.path);
    if (list) list.push(v);
    else viewsByPath.set(v.path, [v]);
  }
  const pages = [...viewsByPath.entries()]
    .map(([path, list]) => ({
      path,
      views: list.length,
      visitors: new Set(list.map(visitorKey)).size,
      avgActiveSeconds: average(list.map((v) => v.activeSeconds)),
      avgScroll: average(list.map((v) => v.maxScroll)),
      entryShare: percent(entriesByPath.get(path) ?? 0, visits.length),
    }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path));

  return {
    headline: {
      visitors: visitorSet.size,
      visits: visits.length,
      views: views.length,
      bounceShare: percent(visits.filter((v) => v.views.length === 1).length, visits.length),
    },
    daily: daysOf(period).map((day) => ({ day, visitors: perDay.get(day)?.size ?? 0 })),
    channels: ranked(
      entries.map((e) => ({ key: e.channel, sample: e.channel })),
      (channel, visits) => ({ channel, visits }),
      (c) => c,
    ),
    otherWebsites: ranked(
      entries.filter((e) => e.channel === "other_websites" && e.source).map((e) => ({ key: e.source!, sample: e.source! })),
      (source, n) => ({ source, visits: n }),
      (s) => s,
    ),
    newsletters: ranked(
      entries.filter((e) => e.channel === "newsletter").map((e) => ({ key: e.campaign ?? "\0", sample: e.campaign })),
      (campaign, n) => ({ campaign, label: campaign ?? "Not known", visits: n }),
      (c) => c ?? "Not known",
    ),
    cities: visitorsBy(
      views,
      (v) => (v.city ? `${v.city}\n${v.region ?? ""}\n${v.country ?? ""}` : null),
      (v, n) => ({ city: v.city!, region: v.region, country: v.country, visitors: n }),
    ),
    countries: visitorsBy(
      views,
      (v) => (v.country ? v.country.toUpperCase() : null),
      (v, n) => ({ country: v.country!.toUpperCase(), name: countryName(v.country!), visitors: n }),
    ),
    pages,
    clickKinds: ranked(
      clicks.map((c) => ({ key: c.kind, sample: c.kind, weight: c.count })),
      (kind, n) => ({ kind, clicks: n }),
      (k) => k,
    ),
    clicks: ranked(
      clicks.map((c) => ({ key: `${c.kind}\n${c.label}`, sample: c, weight: c.count })),
      (c, n) => ({ kind: c.kind, label: c.label, clicks: n }),
      (c) => c.label,
    ),
    devices: visitorsBy(views, (v) => v.device, (v, n) => ({ device: v.device, visitors: n })),
    browsers: visitorsBy(views, (v) => v.browser, (v, n) => ({ browser: v.browser, visitors: n })),
  };
}
