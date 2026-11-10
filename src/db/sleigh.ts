import { pool } from "./pool";
import { writeWithAudit } from "./donations";
import type { SleighNight, SleighSettings } from "../sleigh/model";

// The Kilmarnock Santa Sleigh's data (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md): the
// nights and the one row of settings (migrations/1791200000430_santa-sleigh.js), and the year's total.
//
// The total has three parts: gifts on the sleigh page (donations.source = 'santa_sleigh', stamped from
// the checkout), card machine taps on a sleigh night (the same source, written by TAG_CARD_SLEIGH_SQL
// after the Stripe webhook has saved the tap), and the bucket cash staff type in per night. Bucket
// cash lives here only and is never in a donation figure.

// ------------------------------------------------------------------------------------------------
// A night's card machine window: an hour before the start to an hour after the finish, UK time. While
// a night's times are to be confirmed it runs as if the sleigh went out 5pm to 9pm, so 4pm to 10pm.
// Card machines are only used on the sleigh (Jaimie, 10 November 2026), so a tap by time is safe.
// ------------------------------------------------------------------------------------------------

export const WINDOW_TBC_START = "17:00";
export const WINDOW_TBC_END = "21:00";
const WINDOW_MARGIN_MINUTES = 60;

const LONDON_AT = `(d.created_at AT TIME ZONE 'Europe/London')`;
const IN_WINDOW = `${LONDON_AT} >= n.night_on + COALESCE(n.starts_at, time '${WINDOW_TBC_START}') - interval '1 hour'
      AND ${LONDON_AT} <= n.night_on + COALESCE(n.ends_at, time '${WINDOW_TBC_END}') + interval '1 hour'`;

/** True when donation `d` was stored inside any sleigh night's window. */
export const SLEIGH_WINDOW_SQL = `EXISTS (SELECT 1 FROM sleigh_nights n WHERE ${IN_WINDOW})`;

/**
 * One card machine tap, by its charge id: tagged santa_sleigh if it has no source yet, was taken in
 * person, and fell inside a night's window. Run after COMMIT by tagDonationSource (src/db/stripe-webhook.ts).
 * The tap's created_at is when the webhook stored it, seconds after the tap: close enough.
 */
export const TAG_CARD_SLEIGH_SQL = `UPDATE donations d SET source = 'santa_sleigh'
  WHERE d.stripe_charge_id = $1 AND d.source IS NULL AND d.payment_channel = 'in_person'
    AND ${SLEIGH_WINDOW_SQL}`;

/** After a night is saved: sleigh card taps now outside every window lose the tag. Never an online gift. */
export const RESORT_UNTAG_SQL = `UPDATE donations d SET source = NULL
  WHERE d.source = 'santa_sleigh' AND d.payment_channel = 'in_person'
    AND NOT ${SLEIGH_WINDOW_SQL}`;

/** After a night is saved: untagged card taps now inside a window take the tag, from the year's count only. */
export const RESORT_TAG_SQL = `UPDATE donations d SET source = 'santa_sleigh'
  WHERE d.source IS NULL AND d.payment_channel = 'in_person'
    AND d.created_at >= (SELECT s.season_from::timestamp AT TIME ZONE 'Europe/London' FROM sleigh_settings s WHERE s.id = 1)
    AND ${SLEIGH_WINDOW_SQL}`;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-12-15", "18:00", minutes added (may be negative) → "2026-12-15 17:00", past midnight if need be. */
function shifted(nightOn: string, hhmm: string, minutes: number): string {
  const [y, m, d] = nightOn.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d, h, mi + minutes));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`;
}

/** A night's window as UK date and time ("YYYY-MM-DD HH:MM"), the same window the SQL above uses. */
export function sleighWindow(night: Pick<SleighNight, "nightOn" | "startsAt" | "endsAt">): { from: string; to: string } {
  return {
    from: shifted(night.nightOn, night.startsAt ?? WINDOW_TBC_START, -WINDOW_MARGIN_MINUTES),
    to: shifted(night.nightOn, night.endsAt ?? WINDOW_TBC_END, WINDOW_MARGIN_MINUTES),
  };
}

/** Whether a UK date and time ("YYYY-MM-DD HH:MM") falls inside any night's window, ends included. */
export function inSleighWindow(londonAt: string, nights: readonly Pick<SleighNight, "nightOn" | "startsAt" | "endsAt">[]): boolean {
  return nights.some((n) => {
    const w = sleighWindow(n);
    return londonAt >= w.from && londonAt <= w.to;
  });
}

// ------------------------------------------------------------------------------------------------
// The nights and the settings.
// ------------------------------------------------------------------------------------------------

export interface SleighNightRow extends SleighNight {
  bucketPence: number;
}

export interface SleighNightTotals extends SleighNightRow {
  cardPence: number;
  cardGifts: number;
  window: { from: string; to: string };
}

const NIGHT_COLUMNS = `id, to_char(night_on, 'YYYY-MM-DD') AS night_on, areas,
  to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at, bucket_pence`;

type NightRow = {
  id: number | string;
  night_on: string;
  areas: string;
  starts_at: string | null;
  ends_at: string | null;
  bucket_pence: number | string;
};

function toNight(row: NightRow): SleighNightRow {
  return {
    id: Number(row.id),
    nightOn: row.night_on,
    areas: row.areas,
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    bucketPence: Number(row.bucket_pence) || 0,
  };
}

/** Each night in date order, with the card machine taps tagged inside its window. */
export const LIST_NIGHTS_SQL = `SELECT n.id, to_char(n.night_on, 'YYYY-MM-DD') AS night_on, n.areas,
       to_char(n.starts_at, 'HH24:MI') AS starts_at, to_char(n.ends_at, 'HH24:MI') AS ends_at, n.bucket_pence,
       COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)), 0) AS card_pence,
       COUNT(d.id) AS card_gifts
  FROM sleigh_nights n
  LEFT JOIN donations d
    ON d.source = 'santa_sleigh' AND d.payment_channel = 'in_person' AND d.payment_status = 'paid'
   AND ${IN_WINDOW}
 GROUP BY n.id
 ORDER BY n.night_on`;

export async function listNights(): Promise<SleighNightTotals[]> {
  const r = await pool.query<NightRow & { card_pence: number | string; card_gifts: number | string }>(LIST_NIGHTS_SQL);
  return r.rows.map((row) => {
    const night = toNight(row);
    return { ...night, cardPence: Number(row.card_pence) || 0, cardGifts: Number(row.card_gifts) || 0, window: sleighWindow(night) };
  });
}

const SETTINGS_DEFAULT: SleighSettings = { seasonFrom: "2026-11-01", offOn: "2027-01-31" };
const SETTINGS_COLUMNS = `to_char(season_from, 'YYYY-MM-DD') AS season_from, to_char(off_on, 'YYYY-MM-DD') AS off_on`;
type SettingsRow = { season_from: string; off_on: string };
const toSettings = (row: SettingsRow): SleighSettings => ({ seasonFrom: row.season_from, offOn: row.off_on });

export async function getSleighSettings(): Promise<SleighSettings> {
  const r = await pool.query<SettingsRow>(`SELECT ${SETTINGS_COLUMNS} FROM sleigh_settings WHERE id = 1`);
  return r.rows[0] ? toSettings(r.rows[0]) : { ...SETTINGS_DEFAULT };
}

export interface NightChanges {
  areas?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  bucketPence?: number;
}

class Missing extends Error {}

/**
 * Save what staff changed on one night, with an audit row, then re-sort the card machine taps both
 * ways (a night's times decide which taps are the sleigh's), all in one transaction. Null for a night
 * that is not there: nothing written, nothing audited.
 */
export async function saveNight(id: number, changes: NightChanges, actor: string): Promise<SleighNightRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const written: Record<string, unknown> = {};
  const set = (column: string, key: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
    written[key] = value;
  };
  if (changes.areas !== undefined) set("areas", "areas", String(changes.areas).trim().replace(/\s+/g, " "));
  if (changes.startsAt !== undefined) set("starts_at", "startsAt", changes.startsAt);
  if (changes.endsAt !== undefined) set("ends_at", "endsAt", changes.endsAt);
  if (changes.bucketPence !== undefined) set("bucket_pence", "bucketPence", changes.bucketPence);
  sets.push("updated_at = now()");
  try {
    const { night } = await writeWithAudit(
      async (client) => {
        const r = await client.query<NightRow>(`UPDATE sleigh_nights SET ${sets.join(", ")} WHERE id = $1 RETURNING ${NIGHT_COLUMNS}`, params);
        if (!r.rows[0]) throw new Missing();
        const untagged = (await client.query(RESORT_UNTAG_SQL)).rowCount ?? 0;
        const tagged = (await client.query(RESORT_TAG_SQL)).rowCount ?? 0;
        return { night: toNight(r.rows[0]), untagged, tagged };
      },
      ({ night, untagged, tagged }) => ({
        actor,
        action: "sleigh_night.saved",
        entity: "sleigh_night",
        entityId: night.id,
        data: { nightOn: night.nightOn, changes: written, cardTapsUntagged: untagged, cardTapsTagged: tagged },
      }),
    );
    forgetSleighTotals();
    return night;
  } catch (err) {
    if (err instanceof Missing) return null;
    throw err;
  }
}

/** Save the switch off day, with an audit row. */
export async function saveSleighSettings(changes: { offOn: string }, actor: string): Promise<SleighSettings> {
  const settings = await writeWithAudit(
    async (client) => {
      const r = await client.query<SettingsRow>(
        `UPDATE sleigh_settings SET off_on = $1, updated_at = now() WHERE id = 1 RETURNING ${SETTINGS_COLUMNS}`,
        [changes.offOn],
      );
      return r.rows[0] ? toSettings(r.rows[0]) : { ...SETTINGS_DEFAULT, offOn: changes.offOn };
    },
    (s) => ({ actor, action: "sleigh_settings.saved", entity: "sleigh_settings", entityId: 1, data: { offOn: s.offOn } }),
  );
  forgetSleighTotals();
  return settings;
}

// ------------------------------------------------------------------------------------------------
// The year's total: net paid santa_sleigh gifts since season_from, online and card machine apart, plus
// the bucket cash of the nights since season_from.
// ------------------------------------------------------------------------------------------------

export interface SleighTotals {
  onlinePence: number;
  cardPence: number;
  bucketPence: number;
  totalPence: number;
  gifts: number;
}

export const SLEIGH_TOTALS_SQL = `SELECT
  COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)) FILTER (WHERE d.payment_channel <> 'in_person'), 0) AS online_pence,
  COALESCE(SUM(GREATEST(d.amount_pence - d.refunded_amount_pence, 0)) FILTER (WHERE d.payment_channel = 'in_person'), 0) AS card_pence,
  COUNT(d.id) FILTER (WHERE d.amount_pence > d.refunded_amount_pence) AS gifts,
  (SELECT COALESCE(SUM(n.bucket_pence), 0) FROM sleigh_nights n WHERE n.night_on >= s.season_from) AS bucket_pence
  FROM sleigh_settings s
  LEFT JOIN donations d
    ON d.source = 'santa_sleigh' AND d.payment_status = 'paid'
   AND d.created_at >= (s.season_from::timestamp AT TIME ZONE 'Europe/London')
 WHERE s.id = 1
 GROUP BY s.season_from`;

type TotalsRow = { online_pence: number | string; card_pence: number | string; bucket_pence: number | string; gifts: number | string };

/** The total straight from the database, uncached (the admin's, which may throw). */
export async function readSleighTotalsNow(): Promise<SleighTotals> {
  const r = await pool.query<TotalsRow>(SLEIGH_TOTALS_SQL);
  const row = r.rows[0];
  const onlinePence = Math.max(0, Number(row?.online_pence) || 0);
  const cardPence = Math.max(0, Number(row?.card_pence) || 0);
  const bucketPence = Math.max(0, Number(row?.bucket_pence) || 0);
  return { onlinePence, cardPence, bucketPence, totalPence: onlinePence + cardPence + bucketPence, gifts: Number(row?.gifts) || 0 };
}

// The public page's read: a minute's cache, never a throw (as src/db/red-bag-workshops.ts).
const KEEP_MS = 60_000;
const WAIT_MS = 1500;

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no answer in ${ms}ms`)), ms);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    work.then(
      (v) => {
        clearTimeout(timer);
        done(v);
      },
      (e) => {
        clearTimeout(timer);
        fail(e);
      },
    );
  });
}

/**
 * One cached read: the last good value for a minute; on trouble the last good value, or `none`, kept
 * for a minute too, so a failing database is asked once a minute and not on every visit. forget()
 * starts a new generation, and a read from an older one that comes back late changes nothing.
 */
function cachedRead<T>(read: () => Promise<T>, none: T) {
  let value: T | undefined;
  let at = 0;
  let pending: Promise<T> | null = null;
  let generation = 0;
  return {
    get(): Promise<T> {
      if (value !== undefined && Date.now() - at < KEEP_MS) return Promise.resolve(value);
      if (!pending) {
        const mine = generation;
        const current = within(read(), WAIT_MS)
          .then((v) => {
            if (mine === generation) {
              value = v;
              at = Date.now();
            }
            return v;
          })
          .catch((e: unknown) => {
            console.error(`[sleigh] total read failed: ${(e as Error)?.message ?? e}`);
            if (mine !== generation) return value ?? none;
            value = value ?? none; // try again in a minute, not on every visit
            at = Date.now();
            return value;
          })
          .finally(() => {
            if (pending === current) pending = null;
          });
        pending = current;
      }
      return pending;
    },
    forget(): void {
      generation += 1;
      value = undefined;
      at = 0;
      pending = null;
    },
  };
}

const totals = cachedRead<SleighTotals | null>(readSleighTotalsNow, null);

/** The year's total for the page: cached a minute, the last good value on trouble, null if never read. */
export function sleighTotals(): Promise<SleighTotals | null> {
  return totals.get();
}

/** Forget the cached total, so the next visit reads afresh (after an admin change, and for tests). */
export function forgetSleighTotals(): void {
  totals.forget();
}
