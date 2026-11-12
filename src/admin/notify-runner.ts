// The sweep that notices arrivals and pushes them to staff phones. The decisions are in
// notify.ts, the encryption in web-push.ts, the storage in src/db/admin-push.ts.
//
// It reads the SAME arrivals the New pills read, so the phone and the screen can never disagree
// about what is new. Nothing here is a second idea of "new": the areas, the permission rules and
// each person's own cursor all come from the pill system.

import { config } from "../config";
import { pushIsConfigured, vapidSubject } from "../config/schema";
import { loadEffectivePermissions } from "../routes/admin-authz";
import {
  allSubscriptions,
  claimNotified,
  deleteSubscription,
  getNotified,
  getPrefs,
  recordSendFailure,
  recordSendOk,
} from "../db/admin-push";
import { arrivalDetails } from "../db/whats-new";
import { dueNotifications, quietNow, type Outgoing, type PendingArea } from "./notify";
import { encryptPayload, subscriptionIsDead, vapidAuthHeader } from "./web-push";
import { reachableAreas } from "./whats-new";
import type { StoredSubscription } from "./push";

/** How long a push service should hold a notification for a phone that is switched off. */
const TTL_SECONDS = 24 * 60 * 60;

function failed(what: string, err: unknown): void {
  console.error(`admin notify: ${what} failed:`, err instanceof Error ? err.message : err);
}

/** Post one encrypted notification to one phone. Resolves to false when the subscription is gone. */
async function send(subscription: StoredSubscription, outgoing: Outgoing): Promise<boolean> {
  const endpoint = new URL(subscription.endpoint);
  const body = encryptPayload({
    plaintext: Buffer.from(JSON.stringify(outgoing), "utf8"),
    uaPublicKey: Buffer.from(subscription.p256dh, "base64url"),
    authSecret: Buffer.from(subscription.auth, "base64url"),
  });

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      // RFC 8292 wants the push service's ORIGIN here, not the whole endpoint; vapidAuthHeader
      // refuses anything else rather than letting APNs reject it silently.
      Authorization: vapidAuthHeader({
        audience: endpoint.origin,
        subject: vapidSubject(config),
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
      }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(TTL_SECONDS),
    },
    // A Buffer is a Uint8Array at runtime and fetch sends it fine; the DOM BodyInit type just
    // does not admit an ArrayBufferView. Same cast as src/clients/s3.ts put().
    body: body as unknown as BodyInit,
  });

  if (res.ok) {
    await recordSendOk(subscription.id);
    return true;
  }
  if (subscriptionIsDead({ statusCode: res.status })) {
    // The phone was wiped, the app deleted, or permission withdrawn. Nothing to retry.
    await deleteSubscription(subscription.endpoint);
    return false;
  }
  await recordSendFailure(subscription.id);
  failed(`send to ${endpoint.origin}`, new Error(`${res.status} ${res.statusText}`));
  return true;
}

/** Everything new for one person, by area, and how far to move their cursor. */
async function pendingFor(userId: number, now: Date): Promise<{ areas: PendingArea[]; upTo: Map<string, Date> }> {
  const perms = await loadEffectivePermissions(userId);
  // null also covers a disabled account, so somebody who has left stops being buzzed even before
  // their row is removed.
  if (!perms) return { areas: [], upTo: new Map() };

  const notified = await getNotified(userId);
  const areas: PendingArea[] = [];
  const upTo = new Map<string, Date>();

  for (const { area } of reachableAreas(perms)) {
    const since = notified.get(area);
    if (!since) {
      // Never notified about this area before. Start the clock NOW and send nothing: the
      // alternative is somebody turning notifications on and being buzzed about every donation
      // the charity has ever taken.
      upTo.set(area, now);
      continue;
    }
    try {
      const items = await arrivalDetails(area, since);
      if (items.length === 0) continue;
      areas.push({ area, items });
      upTo.set(area, items[items.length - 1].at);
    } catch (err) {
      // One area's database being unreachable must not stop the others.
      failed(`reading ${area}`, err);
    }
  }
  return { areas, upTo };
}

/**
 * One pass over every subscribed phone. Returns how many notifications went out.
 *
 * The cursor is claimed BEFORE anything is sent, and that ordering is deliberate. Claim-then-send
 * can lose a buzz if the send fails; send-then-claim can buzz twice if two tasks overlap during a
 * deploy. A missed buzz costs nothing permanent — the New pill still shows the arrival on screen
 * — while a duplicate is exactly what makes somebody switch the whole thing off.
 */
export async function sweep(now = new Date()): Promise<number> {
  if (!pushIsConfigured(config)) return 0;

  const subscriptions = await allSubscriptions();
  if (subscriptions.length === 0) return 0;

  const byUser = new Map<number, StoredSubscription[]>();
  for (const s of subscriptions) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  let sent = 0;
  for (const [userId, phones] of byUser) {
    try {
      const prefs = await getPrefs(userId);
      const { areas, upTo } = await pendingFor(userId, now);

      // Claim every area we looked at, including the ones with nothing in them, so a first-ever
      // sweep sets the baseline and a quiet area's cursor keeps up with the clock.
      const claimed: PendingArea[] = [];
      for (const area of areas) {
        const at = upTo.get(area.area);
        if (at && (await claimNotified(userId, area.area, at))) claimed.push(area);
      }
      for (const [area, at] of upTo) {
        if (!areas.some((a) => a.area === area)) await claimNotified(userId, area as never, at);
      }

      if (quietNow(prefs, now)) continue; // dropped, not held — the pill still shows it
      for (const outgoing of dueNotifications({ areas: claimed, prefs })) {
        for (const phone of phones) {
          try {
            if (await send(phone, outgoing)) sent += 1;
          } catch (err) {
            failed(`send for user ${userId}`, err);
          }
        }
      }
    } catch (err) {
      failed(`sweep for user ${userId}`, err);
    }
  }
  return sent;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Ticks every minute, from src/index.ts. Guarded so a slow sweep never has another start beside
 * it in this task; claimNotified keeps several tasks apart.
 *
 * Does nothing at all until both VAPID keys are real, so a laptop and a freshly deployed task
 * with REPLACE_ME in SSM sit quiet rather than failing every minute.
 */
export function startNotifyWorker(intervalMs = 60_000): NodeJS.Timeout | null {
  if (!pushIsConfigured(config)) {
    console.log("admin notify: no VAPID keys set, phone notifications are off");
    return null;
  }
  timer = setInterval(() => {
    if (running) return;
    running = true;
    Promise.resolve()
      .then(() => sweep(new Date()))
      .catch((err) => failed("sweep", err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Never hold the process open for a timer: the container should still exit cleanly.
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

export function stopNotifyWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
