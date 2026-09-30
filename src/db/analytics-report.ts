// TASK-482: the reads behind Admin > Analytics. The SQL only fetches rows for the period and the one
// before it; every figure is worked out by the pure functions in src/analytics/report.ts.
import { pool } from "./pool";
import {
  buildPanels,
  labelNewsletters,
  newsletterIds,
  periodsFor,
  type ClickFact,
  type Panels,
  type Period,
  type PeriodDays,
  type ViewFact,
} from "../analytics/report";
import { ukDay } from "../analytics/visitor";

export type AnalyticsReport = {
  days: PeriodDays;
  current: Period & Panels;
  previous: Period & Panels;
  /** Distinct visitors with a page view in the last 5 minutes. */
  rightNow: number;
  generatedAt: string;
};

type ViewRow = Omit<ViewFact, "activeSeconds" | "maxScroll"> & {
  active_seconds: number | null;
  max_scroll: number | null;
};

async function readViews(from: string, to: string): Promise<ViewFact[]> {
  const r = await pool.query<ViewRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, at, visitor, path, channel, source, campaign,
            country, region, city, device, browser, active_seconds, max_scroll
       FROM analytics_views
      WHERE day BETWEEN $1 AND $2`,
    [from, to],
  );
  return r.rows.map(({ active_seconds, max_scroll, ...rest }) => ({
    ...rest,
    activeSeconds: active_seconds,
    maxScroll: max_scroll,
  }));
}

async function readClicks(from: string, to: string): Promise<ClickFact[]> {
  const r = await pool.query<ClickFact>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, label, count(*)::int AS count
       FROM analytics_clicks
      WHERE day BETWEEN $1 AND $2
      GROUP BY 1, 2, 3`,
    [from, to],
  );
  return r.rows;
}

/** The subjects of the newsletters whose ids appear as campaigns (TASK-480 tags links with the id). */
async function readNewsletterSubjects(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const r = await pool.query<{ id: number; subject: string }>(
    "SELECT id, subject FROM newsletters WHERE id = ANY($1::int[])",
    [[...new Set(ids)]],
  );
  return new Map(r.rows.map((row) => [row.id, row.subject]));
}

async function readRightNow(): Promise<number> {
  const r = await pool.query<{ n: number }>(
    "SELECT count(DISTINCT visitor)::int AS n FROM analytics_views WHERE at > now() - interval '5 minutes'",
  );
  return r.rows[0]?.n ?? 0;
}

/** Every panel for the last `days` UK days and the same number of days before. */
export async function readAnalyticsReport(days: PeriodDays, now: Date = new Date()): Promise<AnalyticsReport> {
  const { current, previous } = periodsFor(ukDay(now), days);
  // One after another, not side by side: the pool's few connections are shared with donations, and
  // analytics is never allowed to take more than its share (src/routes/pulse.ts).
  const views = await readViews(previous.from, current.to);
  const clicks = await readClicks(previous.from, current.to);
  const rightNow = await readRightNow();
  const cur = buildPanels(views, clicks, current);
  const before = buildPanels(views, clicks, previous);
  const subjects = await readNewsletterSubjects(newsletterIds([...cur.newsletters, ...before.newsletters]));
  return {
    days,
    current: { ...current, ...cur, newsletters: labelNewsletters(cur.newsletters, subjects) },
    previous: { ...previous, ...before, newsletters: labelNewsletters(before.newsletters, subjects) },
    rightNow,
    generatedAt: now.toISOString(),
  };
}
