// What actually gets sent to a phone, and what does not. The sending itself is in
// notify-runner.ts, the encryption in web-push.ts, the storage in src/db/admin-push.ts.
//
// Pure: no pool, no config, no network, no ambient clock. Every decision Jaimie made about how
// noisy this is allowed to be lives here and is unit-tested DB-free (golden rule 5).

import { AREA_TITLES, type Area, type ArrivalItem } from "./whats-new";
import type { NotifyPrefs } from "./push";

/**
 * How many arrivals in one sweep stop being news and start being a flood.
 *
 * Jaimie asked for a buzz every single time and that is the default. But a CSV import, a webhook
 * replay or a backfill puts hundreds of rows in at once, and two hundred buzzes in a minute is
 * precisely the "switch it off forever" moment the whole design exists to avoid. She agreed to
 * this one exception on 12 Nov 2026. A normal busy afternoon — the 27 taps at the last event were
 * spread over hours — never comes near it.
 */
export const BURST_CAP = 20;

export interface Outgoing {
  title: string;
  body: string;
  /** Which section to open when it is tapped, or null to open the admin generally. */
  area: Area | null;
  /** Lets a phone replace an earlier notification rather than stacking a duplicate. */
  tag: string;
}

/** Everything that has arrived for one person since they were last told, by area. */
export interface PendingArea {
  area: Area;
  items: ArrivalItem[];
}

const summary = (count: number): Outgoing => ({
  title: "NBCC Admin",
  body: `${count} new things`,
  // A burst spans areas, so it cannot honestly claim to be about one of them.
  area: null,
  tag: "nbcc-admin-many",
});

/**
 * The notifications due for one person this sweep.
 *
 * Areas the caller passes have already been filtered to the ones this person's permissions reach
 * — that check belongs with the permissions, not here, and it is read fresh on every sweep so a
 * change takes effect at once.
 */
export function dueNotifications(input: { areas: PendingArea[]; prefs: NotifyPrefs }): Outgoing[] {
  const wanted = input.areas.filter((a) => !input.prefs.areasOff.includes(a.area) && a.items.length > 0);
  const total = wanted.reduce((n, a) => n + a.items.length, 0);
  if (total === 0) return [];

  // One line is one line, whatever the switches say: "1 new things" would be worse than useless.
  if (total === 1) {
    const only = wanted.find((a) => a.items.length > 0)!;
    return [one(only.area, only.items[0])];
  }

  if (total > BURST_CAP || input.prefs.bundle) return [summary(total)];

  return wanted.flatMap((a) => a.items.map((item) => one(a.area, item)));
}

function one(area: Area, item: ArrivalItem): Outgoing {
  return {
    title: AREA_TITLES[area],
    body: item.line,
    area,
    // Per area and per arrival time, so a retry replaces rather than repeats, while two genuine
    // arrivals a second apart stay two notifications.
    tag: `nbcc-${area}-${item.at.getTime()}`,
  };
}

/** "HH:MM:SS" as minutes since midnight, or null when it is not a time. */
function minutes(hhmmss: string | null): number | null {
  if (!hhmmss) return null;
  const m = /^(\d{2}):(\d{2})/.exec(hhmmss);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Whether we are inside this person's quiet hours.
 *
 * Off unless BOTH ends are set, so half a setting can never silence a phone by accident. The
 * usual case runs past midnight (23:00 to 07:00), which a plain from <= now < to gets backwards,
 * so that case is handled explicitly rather than hoped about.
 *
 * An arrival inside quiet hours is DROPPED, not held: the New pill still shows it on the screen,
 * and production runs a single task that restarts on every deploy, so nothing held in memory
 * could be trusted to come out the other side.
 */
export function quietNow(prefs: NotifyPrefs, at: Date): boolean {
  const from = minutes(prefs.quietFrom);
  const to = minutes(prefs.quietTo);
  if (from === null || to === null) return false;

  const now = at.getUTCHours() * 60 + at.getUTCMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}
