// TASK-479: the analytics tables (migrations/1791000000000_site-analytics.js). Numbers only: nothing
// stored here identifies a person. The pure rules live in src/analytics/; this module is the SQL.
import type { PoolClient } from "pg";
import { pool } from "./pool";
import { insertAudit } from "./donations";
import type { Arrival } from "../analytics/channel";
import type { ClickRow, ViewRow } from "../analytics/pulse-handler";
import { retentionCutoff } from "../analytics/retention";
import { newSalt, ukDay } from "../analytics/visitor";

export type AnalyticsSettings = { collecting: boolean; updatedAt: string | null; updatedBy: string | null };

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// --- the switch ----------------------------------------------------------------------------------

/** Is collecting switched on? A missing row reads as off. */
export async function getCollecting(): Promise<boolean> {
  const r = await pool.query<{ collecting: boolean }>("SELECT collecting FROM analytics_settings WHERE id = 1");
  return r.rows[0]?.collecting ?? false;
}

type SettingsRow = { collecting: boolean; updated_at: string; updated_by: string | null };
const toSettings = (row: SettingsRow | undefined): AnalyticsSettings =>
  row
    ? { collecting: row.collecting, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by }
    : { collecting: false, updatedAt: null, updatedBy: null };

/** The switch with when and by whom it was last changed, for the admin page (TASK-482). */
export async function getAnalyticsSettings(): Promise<AnalyticsSettings> {
  const r = await pool.query<SettingsRow>(
    "SELECT collecting, updated_at, updated_by FROM analytics_settings WHERE id = 1",
  );
  return toSettings(r.rows[0]);
}

/** Turn collecting on or off, with an audit_log row recording who did it. */
export async function setCollecting(collecting: boolean, actor: string): Promise<AnalyticsSettings> {
  return inTransaction(async (client) => {
    const before = await client.query<{ collecting: boolean }>(
      "SELECT collecting FROM analytics_settings WHERE id = 1 FOR UPDATE",
    );
    await client.query(
      `INSERT INTO analytics_settings (id, collecting, updated_at, updated_by) VALUES (1, $1, now(), $2)
       ON CONFLICT (id) DO UPDATE SET collecting = $1, updated_at = now(), updated_by = $2`,
      [collecting, actor],
    );
    await insertAudit(client, {
      actor,
      action: "analytics.collecting_switched",
      entity: "analytics_settings",
      entityId: 1,
      data: { collecting, wasCollecting: before.rows[0]?.collecting ?? false },
    });
    const r = await client.query<SettingsRow>(
      "SELECT collecting, updated_at, updated_by FROM analytics_settings WHERE id = 1",
    );
    return toSettings(r.rows[0]);
  });
}

// --- the daily salt ------------------------------------------------------------------------------

let saltCache: { day: string; salt: string } | null = null;

/** Test seam: forget the remembered salt. */
export function forgetSaltCache(): void {
  saltCache = null;
}

/**
 * The salt for a UK day: made by whichever event arrives first that day, then shared by every
 * task through the table. Remembered in memory for the rest of the day.
 */
export async function saltFor(day: string): Promise<string> {
  if (saltCache?.day === day) return saltCache.salt;
  // Returns the existing salt when another task made it first.
  const r = await pool.query<{ salt: string }>(
    `INSERT INTO analytics_salts (day, salt) VALUES ($1, $2)
     ON CONFLICT (day) DO UPDATE SET salt = analytics_salts.salt
     RETURNING salt`,
    [day, newSalt()],
  );
  saltCache = { day, salt: r.rows[0].salt };
  return saltCache.salt;
}

// --- views and clicks ----------------------------------------------------------------------------

/** Store one page view. The page's own id makes a repeat harmless. */
export async function insertView(row: ViewRow): Promise<void> {
  await pool.query(
    `INSERT INTO analytics_views
       (view_id, at, day, path, visitor, channel, source, campaign, country, region, city, device, browser, os)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (view_id) DO NOTHING`,
    [
      row.viewId,
      row.at,
      row.day,
      row.path,
      row.visitor,
      row.channel,
      row.source,
      row.campaign,
      row.country,
      row.region,
      row.city,
      row.device,
      row.browser,
      row.os,
    ],
  );
}

/** The time on the page and how far down it was read. Only ever raised, never lowered. */
export async function recordLeave(viewId: string, activeSeconds: number, maxScroll: number): Promise<void> {
  await pool.query(
    `UPDATE analytics_views
        SET active_seconds = GREATEST(COALESCE(active_seconds, 0), $2),
            max_scroll = GREATEST(COALESCE(max_scroll, 0), $3)
      WHERE view_id = $1`,
    [viewId, activeSeconds, maxScroll],
  );
}

/** A click that matters, stored only against a view that was itself counted. */
export async function insertClick(row: ClickRow): Promise<void> {
  await pool.query(
    `INSERT INTO analytics_clicks (view_id, at, day, kind, label)
     SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (SELECT 1 FROM analytics_views WHERE view_id = $1)`,
    [row.viewId, row.at, row.day, row.kind, row.label],
  );
}

/** The channel of this visitor's latest view that day, or null if this is their first. */
export async function lastArrival(day: string, visitor: string): Promise<Arrival | null> {
  const r = await pool.query<Arrival>(
    `SELECT channel, source, campaign FROM analytics_views
      WHERE day = $1 AND visitor = $2
      ORDER BY at DESC LIMIT 1`,
    [day, visitor],
  );
  return r.rows[0] ?? null;
}

// --- retention -----------------------------------------------------------------------------------

/**
 * The daily 8am job: views and clicks are kept 13 months, and every salt older than today is
 * deleted, so yesterday's visitor ids can never be made again.
 */
export async function pruneAnalytics(now: Date = new Date()): Promise<{ views: number; clicks: number; salts: number }> {
  const today = ukDay(now);
  const cutoff = retentionCutoff(today);
  const views = await pool.query("DELETE FROM analytics_views WHERE day < $1", [cutoff]);
  const clicks = await pool.query("DELETE FROM analytics_clicks WHERE day < $1", [cutoff]);
  const salts = await pool.query("DELETE FROM analytics_salts WHERE day < $1", [today]);
  return { views: views.rowCount ?? 0, clicks: clicks.rowCount ?? 0, salts: salts.rowCount ?? 0 };
}
