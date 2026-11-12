// Admin phone notifications: the pure rules and the shapes. The SQL is in src/db/admin-push.ts,
// the decisions about what to send in src/admin/notify.ts, and the encryption in
// src/admin/web-push.ts.
//
// Split out for the same reason src/admin/whats-new.ts is split from src/db/whats-new.ts: a unit
// test must not need a database (golden rule 5), and importing anything under src/db pulls in the
// pool and therefore the whole config.

import type { Area } from "./whats-new";

export interface StoredSubscription {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface NotifyPrefs {
  bundle: boolean;
  /** "HH:MM:SS", or null for no quiet hours. */
  quietFrom: string | null;
  quietTo: string | null;
  areasOff: Area[];
}

/** What a browser hands us when a phone subscribes. */
export interface BrowserSubscription {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export interface SubscriptionRow {
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The settings of somebody who has never opened the Notifications screen. */
export const DEFAULT_PREFS: NotifyPrefs = { bundle: false, quietFrom: null, quietTo: null, areasOff: [] };

/**
 * One browser subscription, checked and flattened into the row we store.
 *
 * Anything incomplete is rejected rather than stored: a subscription missing a key would sit in
 * the table failing on every sweep, counting up failures no retry could ever fix. The https check
 * matters because this endpoint becomes a URL the server POSTs to on a timer — not somewhere to
 * be talked into making arbitrary requests.
 */
export function subscriptionRow(userId: number, sub: BrowserSubscription): SubscriptionRow {
  const endpoint = (sub.endpoint ?? "").trim();
  if (!endpoint) throw new Error("A push subscription needs an endpoint");

  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error("A push endpoint must be an https URL");
  }
  if (parsed.protocol !== "https:") throw new Error("A push endpoint must be an https URL");

  const p256dh = (sub.keys?.p256dh ?? "").trim();
  const auth = (sub.keys?.auth ?? "").trim();
  if (!p256dh || !auth) throw new Error("A push subscription needs both keys (p256dh and auth)");

  return { userId, endpoint, p256dh, auth };
}

export interface PrefsRow {
  bundle: boolean;
  quiet_from: string | null;
  quiet_to: string | null;
  areas_off: string[] | null;
}

/**
 * Somebody's settings, from their row or from not having one.
 *
 * No row is the normal state and means everything on, nothing bundled, no quiet hours — what
 * Jaimie asked for — so turning notifications on never has to write a settings row first.
 */
export function prefsFromRow(row: PrefsRow | null): NotifyPrefs {
  if (!row) return { ...DEFAULT_PREFS };
  return {
    bundle: row.bundle,
    quietFrom: row.quiet_from,
    quietTo: row.quiet_to,
    areasOff: (row.areas_off ?? []) as Area[],
  };
}
