// TASK-482: the reads behind Admin > Analytics. Every count is done here in SQL, so only small
// aggregate rows reach Node: the service is one small task that also takes donations and Stripe
// webhooks, and must not spend seconds walking months of page views. What is left (percentages, the
// days with no visitors, country names, newsletter labels) is pure, in src/analytics/report.ts.
//
// Queries run one after another, never side by side: the pool's few connections are shared with
// donations, and analytics is never allowed more than its share (src/routes/pulse.ts).
import { pool } from "./pool";
import { getCollecting } from "./analytics";
import { labelQrScans } from "../site/qr";
import { SITE_PAGES } from "../site/pages";
import {
  countriesFrom,
  fillDays,
  headlineFrom,
  labelNewsletters,
  newsletterIds,
  pagesFrom,
  periodsFor,
  type Comparison,
  type Panels,
  type Period,
  type PeriodDays,
} from "../analytics/report";
import { ukDay } from "../analytics/visitor";

export type RightNow = { collecting: boolean; people: number };

export type AnalyticsReport = {
  days: PeriodDays;
  current: Period & Panels;
  previous: Period & Comparison;
  rightNow: RightNow;
  generatedAt: string;
};

// The longest lists (towns, other websites, clicked labels) stop here; "Show all" shows this many.
export const LIST_LIMIT = 100;

// The period's page views, each marked `starts` when it begins a visit: the visitor's first view of
// the day, or one more than 30 minutes after their view before it. `next_starts` is the same for the
// view after it, so a visit with one view (a bounce) starts and is followed by a start or nothing.
// $1 and $2 are the first and last UK day, $3 the moment to count up to.
const VISITS = `
  WITH marked AS (
    SELECT id, day, visitor, at, path, channel, source, campaign, active_seconds, max_scroll,
           CASE WHEN lag(at) OVER w IS NULL OR at - lag(at) OVER w > interval '30 minutes' THEN 1 ELSE 0 END AS starts
      FROM analytics_views
     WHERE day BETWEEN $1 AND $2 AND at <= $3
    WINDOW w AS (PARTITION BY day, visitor ORDER BY at, id)
  ), v AS (
    SELECT *, lead(starts) OVER (PARTITION BY day, visitor ORDER BY at, id) AS next_starts FROM marked
  )`;

const IN_PERIOD = "day BETWEEN $1 AND $2 AND at <= $3";

type HeadlineRow = { visitors: number; visits: number; views: number; bounces: number };

async function rows<T extends object>(sql: string, p: Period): Promise<T[]> {
  const r = await pool.query<T>(sql, [p.from, p.to, p.until]);
  return r.rows;
}

async function headline(p: Period) {
  const [row] = await rows<HeadlineRow>(
    `${VISITS}
     SELECT count(DISTINCT visitor || '@' || day::text)::int AS visitors,
            (count(*) FILTER (WHERE starts = 1))::int AS visits,
            count(*)::int AS views,
            (count(*) FILTER (WHERE starts = 1 AND (next_starts IS NULL OR next_starts = 1)))::int AS bounces
       FROM v`,
    p,
  );
  return row;
}

async function daily(p: Period) {
  const r = await rows<{ day: string; visitors: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(DISTINCT visitor)::int AS visitors
       FROM analytics_views WHERE ${IN_PERIOD} GROUP BY day`,
    p,
  );
  return fillDays(r, p);
}

/** Visitors (distinct day and visitor pairs; the id is hex, so '@' cannot join two into one) by some columns of the view, most first. */
function visitorsBy<T extends object>(p: Period, columns: string, where: string, limit = LIST_LIMIT) {
  return rows<T>(
    `SELECT ${columns}, count(DISTINCT visitor || '@' || day::text)::int AS visitors
       FROM analytics_views WHERE ${IN_PERIOD} AND ${where}
      GROUP BY ${columns.replace(/ AS \w+/g, "")}
      ORDER BY visitors DESC, 1
      LIMIT ${limit}`,
    p,
  );
}

/** Visits by how they arrived (the first view of each visit), most first. */
function visitsBy<T extends object>(p: Period, columns: string, where: string) {
  return rows<T>(
    `${VISITS}
     SELECT ${columns}, count(*)::int AS visits
       FROM v WHERE starts = 1 AND ${where}
      GROUP BY ${columns}
      ORDER BY visits DESC, 1
      LIMIT ${LIST_LIMIT}`,
    p,
  );
}

async function pages(p: Period, visits: number) {
  const r = await rows<{
    path: string;
    views: number;
    visitors: number;
    avgActiveSeconds: number | null;
    avgScroll: number | null;
    entries: number;
  }>(
    `${VISITS}
     SELECT path, count(*)::int AS views, count(DISTINCT visitor || '@' || day::text)::int AS visitors,
            round(avg(active_seconds))::int AS "avgActiveSeconds", round(avg(max_scroll))::int AS "avgScroll",
            (count(*) FILTER (WHERE starts = 1))::int AS entries
       FROM v GROUP BY path ORDER BY views DESC, path`,
    p,
  );
  return pagesFrom(r, visits);
}

function clicksBy<T extends object>(p: Period, columns: string, limit: number) {
  return rows<T>(
    `SELECT ${columns}, count(*)::int AS clicks
       FROM analytics_clicks WHERE ${IN_PERIOD}
      GROUP BY ${columns} ORDER BY clicks DESC, 1 LIMIT ${limit}`,
    p,
  );
}

/** The subjects of the newsletters whose ids appear as campaigns. */
async function newsletterSubjects(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const r = await pool.query<{ id: number; subject: string }>(
    "SELECT id, subject FROM newsletters WHERE id = ANY($1::int[])",
    [[...new Set(ids)]],
  );
  return new Map(r.rows.map((row) => [row.id, row.subject]));
}

async function panels(p: Period): Promise<Panels> {
  const head = await headline(p);
  const campaigns = await visitsBy<{ campaign: string | null; visits: number }>(p, "campaign", "channel = 'newsletter'");
  return {
    headline: headlineFrom(head),
    daily: await daily(p),
    channels: await visitsBy<Panels["channels"][number]>(p, "channel", "true"),
    otherWebsites: await visitsBy<Panels["otherWebsites"][number]>(p, "source", "channel = 'other_websites' AND source IS NOT NULL"),
    qrCodes: labelQrScans(await visitsBy<{ campaign: string | null; visits: number }>(p, "campaign", "channel = 'qr'"), SITE_PAGES),
    newsletters: labelNewsletters(campaigns, await newsletterSubjects(newsletterIds(campaigns))),
    cities: await visitorsBy<Panels["cities"][number]>(p, "city, region, country", "city IS NOT NULL"),
    countries: countriesFrom(await visitorsBy<{ country: string; visitors: number }>(p, "upper(country) AS country", "country IS NOT NULL", 300)),
    pages: await pages(p, head?.visits ?? 0),
    clickKinds: await clicksBy<Panels["clickKinds"][number]>(p, "kind", 10),
    clicks: await clicksBy<Panels["clicks"][number]>(p, "kind, label", LIST_LIMIT),
    devices: await visitorsBy<Panels["devices"][number]>(p, "device", "true", 10),
    browsers: await visitorsBy<Panels["browsers"][number]>(p, "browser", "true", 20),
  };
}

/**
 * People with a page view in the last 5 minutes, and whether counting is on at all. Today's and
 * yesterday's rows only, so the day index does the work (just after midnight, the last 5 minutes
 * are partly yesterday's).
 */
export async function readRightNow(now: Date = new Date()): Promise<RightNow> {
  const collecting = await getCollecting();
  const yesterday = new Date(new Date(`${ukDay(now)}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const r = await pool.query<{ n: number }>(
    `SELECT count(DISTINCT visitor)::int AS n FROM analytics_views
      WHERE day >= $1 AND at > $2::timestamptz - interval '5 minutes'`,
    [yesterday, now.toISOString()],
  );
  return { collecting, people: r.rows[0]?.n ?? 0 };
}

/** Every panel for the period, and the figures and line for the same days before it. */
export async function readAnalyticsReport(days: PeriodDays, now: Date = new Date()): Promise<AnalyticsReport> {
  const { current, previous } = periodsFor(now, days);
  const cur = await panels(current);
  const before = await headline(previous);
  return {
    days,
    current: { ...current, ...cur },
    previous: { ...previous, headline: headlineFrom(before), daily: await daily(previous) },
    rightNow: await readRightNow(now),
    generatedAt: now.toISOString(),
  };
}
