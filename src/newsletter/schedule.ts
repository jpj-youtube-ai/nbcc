// TASK-280 (letter J): when a scheduled send is allowed to be scheduled for.
//
// Pure — the caller injects `now`, so every rule here is unit-tested and the API and the UI cannot
// drift apart about what counts as a valid time.
//
// The rules exist because a scheduling field is a foot-gun without them. A time in the past would
// send instantly, which is the opposite of what someone reaching for "schedule" wants. A typo in the
// year ("2027" for "2026") would silently park a newsletter for twelve months with no other symptom.

// A minute of slack: a person picking "09:00" at 08:59:58 means the next 09:00, not a rejection, and
// clocks between a browser and a server are never exactly aligned.
export const SCHEDULE_GRACE_MS = 60 * 1000;
// Far enough ahead for any real campaign, close enough to catch a mistyped year.
export const SCHEDULE_MAX_DAYS = 180;

export type ScheduleResult =
  | { ok: true; at: Date | null } // null = send now
  | { ok: false; reason: string };

// Validate a requested send time. `undefined`/empty means send now, which stays the default: the
// common case must not have to opt out of scheduling.
export function parseScheduleAt(input: string | undefined | null, now: Date): ScheduleResult {
  if (input == null || String(input).trim() === "") return { ok: true, at: null };

  const at = new Date(String(input));
  if (Number.isNaN(at.getTime())) {
    return { ok: false, reason: "That is not a valid date and time." };
  }
  if (at.getTime() < now.getTime() - SCHEDULE_GRACE_MS) {
    return { ok: false, reason: "That time has already passed. Pick a time in the future, or send now." };
  }
  const maxMs = SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000;
  if (at.getTime() > now.getTime() + maxMs) {
    return {
      ok: false,
      reason: `That is more than ${SCHEDULE_MAX_DAYS} days away — check the year is right.`,
    };
  }
  return { ok: true, at };
}

// Is a job due? NULL scheduled_at means "start now", which is how every unscheduled send behaves.
export function isDue(scheduledAt: Date | null, now: Date): boolean {
  if (!scheduledAt) return true;
  return scheduledAt.getTime() <= now.getTime();
}

// What the admin screen says while a send is waiting for its time. Says the time plainly rather than
// "pending", so nobody assumes it is stuck and presses send a second time.
export function scheduleSummary(scheduledAt: Date | null, now: Date): string {
  if (!scheduledAt) return "";
  if (isDue(scheduledAt, now)) return "Starting now.";
  const when = scheduledAt.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });
  return `Scheduled for ${when}. Nothing sends until then, and you can cancel any time before it.`;
}
