// Admin phone notifications: the reads and writes. The rules and shapes are in src/admin/push.ts,
// the decisions in src/admin/notify.ts and the encryption in src/admin/web-push.ts.
//
// Deliberately shaped like src/db/whats-new.ts, because this is the same idea of "new to you" as
// the New pills, delivered to a phone instead of drawn on a screen. admin_notified mirrors
// admin_seen down to its column names.

import { pool } from "./pool";
import { prefsFromRow, subscriptionRow, type BrowserSubscription, type NotifyPrefs, type PrefsRow, type StoredSubscription } from "../admin/push";
import type { Area } from "../admin/whats-new";

/**
 * Remember a phone. Re-subscribing the same phone refreshes its keys rather than adding a second
 * row, but only for the person it already belongs to: the ON CONFLICT deliberately does NOT move
 * user_id, or anyone signed in who learned an endpoint could point somebody else's phone at their
 * own notifications.
 */
export async function saveSubscription(userId: number, sub: BrowserSubscription): Promise<void> {
  const row = subscriptionRow(userId, sub);
  await pool.query(
    `INSERT INTO admin_push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0
      WHERE admin_push_subscriptions.user_id = EXCLUDED.user_id`,
    [row.userId, row.endpoint, row.p256dh, row.auth],
  );
}

/**
 * Forget a phone. `userId` is optional ONLY for the sweep, which deletes an endpoint the push
 * service has told us is gone and does not care whose it was. Every route passes it, so one
 * signed-in person cannot silence another's phone even if they learn the endpoint.
 */
export async function deleteSubscription(endpoint: string, userId?: number): Promise<void> {
  if (userId === undefined) {
    await pool.query("DELETE FROM admin_push_subscriptions WHERE endpoint = $1", [endpoint]);
    return;
  }
  await pool.query("DELETE FROM admin_push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, userId]);
}

const SELECT_SUBSCRIPTION = `SELECT id, user_id AS "userId", endpoint, p256dh, auth FROM admin_push_subscriptions`;

export async function subscriptionsFor(userId: number): Promise<StoredSubscription[]> {
  const res = await pool.query<StoredSubscription>(`${SELECT_SUBSCRIPTION} WHERE user_id = $1 ORDER BY id`, [userId]);
  return res.rows;
}

export async function allSubscriptions(): Promise<StoredSubscription[]> {
  const res = await pool.query<StoredSubscription>(`${SELECT_SUBSCRIPTION} ORDER BY user_id, id`);
  return res.rows;
}

/** Note that a send worked, and forget any earlier wobbles. */
export async function recordSendOk(id: number): Promise<void> {
  await pool.query("UPDATE admin_push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1", [id]);
}

/** Note a send that failed for a reason that is not "this subscription is gone". */
export async function recordSendFailure(id: number): Promise<void> {
  await pool.query("UPDATE admin_push_subscriptions SET failures = failures + 1 WHERE id = $1", [id]);
}

export async function getPrefs(userId: number): Promise<NotifyPrefs> {
  const res = await pool.query<PrefsRow>(
    "SELECT bundle, quiet_from, quiet_to, areas_off FROM admin_notify_prefs WHERE user_id = $1",
    [userId],
  );
  return prefsFromRow(res.rows[0] ?? null);
}

export async function setPrefs(userId: number, prefs: NotifyPrefs): Promise<void> {
  await pool.query(
    `INSERT INTO admin_notify_prefs (user_id, bundle, quiet_from, quiet_to, areas_off, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id) DO UPDATE
        SET bundle = EXCLUDED.bundle, quiet_from = EXCLUDED.quiet_from, quiet_to = EXCLUDED.quiet_to,
            areas_off = EXCLUDED.areas_off, updated_at = now()`,
    [userId, prefs.bundle, prefs.quietFrom, prefs.quietTo, prefs.areasOff],
  );
}

/** How far each area has already been notified for this person. */
export async function getNotified(userId: number): Promise<Map<string, Date>> {
  const res = await pool.query<{ area: string; notified_at: Date }>(
    "SELECT area, notified_at FROM admin_notified WHERE user_id = $1",
    [userId],
  );
  return new Map(res.rows.map((r) => [r.area, r.notified_at]));
}

/**
 * Claim the window up to `upTo` for this person and area, and say where it starts.
 *
 * Claim BEFORE reading the arrivals, not after, and the whole race disappears. The previous
 * version read the cursor, read the items, then claimed the time of the last item — so two sweeps
 * overlapping during a deploy both read from the same old cursor, both claimed successfully
 * (because the later one's timestamp was higher still), and both sent the overlapping items. The
 * atomic statement only ever blocked a sweep that had computed exactly the same end point, which
 * is the one case that does not happen in practice.
 *
 * Returns the PREVIOUS cursor as text, at full microsecond precision, because a JavaScript Date
 * cannot hold what Postgres stores: rounding it would re-send the row it came from for ever.
 *
 * - `claimed: false` — another sweep has already taken this window. Send nothing.
 * - `from: null` — never notified about this area. The window is claimed so the clock starts
 *   now, and nothing is sent, which is what stops somebody turning notifications on and being
 *   buzzed about every donation the charity has ever taken.
 */
export async function claimWindow(
  userId: number,
  area: Area,
  upTo: Date,
): Promise<{ claimed: boolean; from: string | null }> {
  const res = await pool.query<{ from_at: string | null; claimed: boolean }>(
    `WITH prev AS (
       SELECT notified_at FROM admin_notified WHERE user_id = $1 AND area = $2
     ), claim AS (
       INSERT INTO admin_notified (user_id, area, notified_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, area) DO UPDATE SET notified_at = EXCLUDED.notified_at
        WHERE admin_notified.notified_at < EXCLUDED.notified_at
       RETURNING 1
     )
     SELECT (SELECT notified_at::text FROM prev) AS from_at,
            EXISTS (SELECT 1 FROM claim) AS claimed`,
    [userId, area, upTo],
  );
  const row = res.rows[0];
  return { claimed: !!row?.claimed, from: row?.from_at ?? null };
}
