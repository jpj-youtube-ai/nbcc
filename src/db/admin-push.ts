// Admin phone notifications: the reads and writes. The rules and shapes are in src/admin/push.ts,
// the decisions in src/admin/notify.ts and the encryption in src/admin/web-push.ts.
//
// Deliberately shaped like src/db/whats-new.ts, because this is the same idea of "new to you" as
// the New pills, delivered to a phone instead of drawn on a screen. admin_notified mirrors
// admin_seen down to its column names.

import { pool } from "./pool";
import { prefsFromRow, subscriptionRow, type BrowserSubscription, type NotifyPrefs, type PrefsRow, type StoredSubscription } from "../admin/push";
import type { Area } from "../admin/whats-new";

/** Remember a phone. Re-subscribing the same phone replaces the row rather than adding a second. */
export async function saveSubscription(userId: number, sub: BrowserSubscription): Promise<void> {
  const row = subscriptionRow(userId, sub);
  await pool.query(
    `INSERT INTO admin_push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
        SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failures = 0`,
    [row.userId, row.endpoint, row.p256dh, row.auth],
  );
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await pool.query("DELETE FROM admin_push_subscriptions WHERE endpoint = $1", [endpoint]);
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
 * Claim the right to notify this person about this area up to `upTo`.
 *
 * The whole concurrency story in one statement. Production runs a single task today, but a deploy
 * overlaps two and the sweep is on a timer in both, so without this a donation would buzz twice.
 * The WHERE on the UPDATE half is what makes it a claim rather than a write: whoever gets there
 * first moves the cursor, everyone else gets no row back and sends nothing.
 */
export async function claimNotified(userId: number, area: Area, upTo: Date): Promise<boolean> {
  const res = await pool.query(
    `INSERT INTO admin_notified (user_id, area, notified_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, area) DO UPDATE SET notified_at = EXCLUDED.notified_at
      WHERE admin_notified.notified_at < EXCLUDED.notified_at
     RETURNING notified_at`,
    [userId, area, upTo],
  );
  return (res.rowCount ?? 0) > 0;
}
