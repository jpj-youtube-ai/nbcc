// TASK-479: the daily visitor id. sha256(daily salt + IP + user agent), cut to 16 hex characters.
// The salt is random, made at the first event of each UK day, kept for that day only and deleted
// the next, so an id cannot be linked across days or turned back into an IP address.
import { createHash, randomBytes } from "node:crypto";

export function visitorId(salt: string, ip: string, userAgent: string): string {
  return createHash("sha256").update(`${salt}\n${ip}\n${userAgent}`).digest("hex").slice(0, 16);
}

export function newSalt(): string {
  return randomBytes(32).toString("hex");
}

const UK_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in the UK, as YYYY-MM-DD. */
export function ukDay(now: Date): string {
  return UK_DATE.format(now);
}
