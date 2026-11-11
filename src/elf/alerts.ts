import type { ManagedUser } from "../db/admin-users";
import { can, effectivePermissions } from "../admin/permissions";

// NBCC Elf Detective School wave 2: the rules for photo alerts, and who gets them. Pure: no pool, no
// clock (the caller passes the moment). Design: docs/superpowers/specs/2026-11-10-elf-detective-wave-2-design.md,
// "Alerts" (call C13). Unit tested in test/unit/elf-alerts.test.ts.

/** After an alert, no other goes for at least half an hour. */
export const ALERT_GAP_MS = 30 * 60_000;
/** Nothing goes from 9pm (London) until 8am. */
export const QUIET_FROM = 21;
export const QUIET_TO = 8;

const londonHour = (now: Date): number => {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(h) % 24;
};

/** True from 9pm until 8am London time. */
export function quietHours(now: Date): boolean {
  const h = londonHour(now);
  return h >= QUIET_FROM || h < QUIET_TO;
}

/**
 * Whether an alert should go now: a photo is waiting, it is not quiet hours, and either no alert has
 * gone or every photo that was waiting at the last alert has been checked since (the oldest waiting
 * photo came after it) and half an hour has passed. Photos sent overnight wait for 8am.
 */
export function photoAlertDue(o: { oldestWaitingAt: Date | null; lastAlertAt: Date | null }, now: Date): boolean {
  if (!o.oldestWaitingAt) return false;
  if (quietHours(now)) return false;
  if (!o.lastAlertAt) return true;
  return o.oldestWaitingAt.getTime() > o.lastAlertAt.getTime() && now.getTime() - o.lastAlertAt.getTime() >= ALERT_GAP_MS;
}

/** A typed UK mobile as +447 and nine digits, or null for anything else. */
export function normaliseUkMobile(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const digits = typed.replace(/[\s.()-]/g, "");
  const m = /^(?:(?:\+?44)0?|0)(7\d{9})$/.exec(digits);
  if (!m) return null;
  return `+44${m[1]}`;
}

/** A head elf's name on a screen: their full name, or their email when that is blank. */
export function headElfName(u: { full_name: string; email: string }): string {
  const name = (u.full_name ?? "").trim();
  return name || u.email;
}

export interface HeadElf {
  userId: number;
  name: string;
  email: string;
  mobile: string | null;
  alertsOn: boolean;
}

/** Users whose account is active and who may see the Elf Detective School, joined to their mobile and tick
 *  (no row: no mobile, alerts on), in name order. An account is active once its invite is accepted (the
 *  first password set, src/db/admin-users.ts): someone invited who has not yet signed in is not a head elf
 *  here, so no alert, with its full names, goes to an address that may not be theirs. */
export function headElvesOf(
  users: ManagedUser[],
  rows: { userId: number; mobile: string | null; alertsOn: boolean }[],
): HeadElf[] {
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  return users
    .filter((u) => u.status === "active" && can(effectivePermissions(u), "elf", "view"))
    .map((u): HeadElf => {
      const row = byUser.get(u.id);
      return { userId: u.id, name: headElfName(u), email: u.email, mobile: row?.mobile ?? null, alertsOn: row ? row.alertsOn : true };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everyone with alerts on gets the email; those with a mobile as well get the text. */
export function alertRecipients(elves: HeadElf[]): { emails: HeadElf[]; texts: HeadElf[] } {
  const emails = elves.filter((e) => e.alertsOn);
  return { emails, texts: emails.filter((e) => !!e.mobile) };
}
