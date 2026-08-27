// TASK-274: how fast a send is allowed to go. Pure — no database, no clock of its own (the caller
// injects `now`), so every rule here is unit-testable and cannot drift from what the worker does.
//
// Two independent brakes, both of which must be satisfied:
//
//   1. THE THROTTLE (per_minute). The provider accepts roughly 2 messages a second and rejects the
//      rest; the old loop sent as fast as the event loop allowed and had no retry, so a burst simply
//      lost people. The default here is deliberately under that ceiling.
//
//   2. THE DAILY CAP (daily_cap, 0 = uncapped). This is what makes a GENTLE ROLLOUT possible. A young
//      or lightly-used sending domain that suddenly emits two thousand messages in ten minutes looks
//      exactly like a compromised account, and mailbox providers treat it that way — the mail lands in
//      junk, or is refused outright, and the reputation damage outlives the campaign. Ramping the
//      daily allowance instead lets the domain build a track record: a modest first day that mostly
//      gets delivered and opened is the evidence that earns the next day's larger allowance.
//
// The ramp doubles daily rather than creeping, because doubling is the standard warm-up shape and
// keeps a 2,000-person list to about four days rather than a fortnight.

export const GENTLE_FIRST_DAY = 200;
export const GENTLE_MAX_PER_DAY = 5000;
// How often the worker wakes. Long enough that a tick is cheap, short enough that "paused" and
// "cancelled" take effect while a person is still watching the screen.
export const TICK_SECONDS = 20;
// Comfortably under the provider's ~2/second so a retry has headroom rather than compounding a jam.
export const DEFAULT_PER_MINUTE = 60;

// Day 1 → 200, day 2 → 400, day 3 → 800, doubling to a ceiling. Day numbers are 1-based.
export function gentleDailyCap(dayNumber: number): number {
  if (dayNumber < 1) return 0;
  // 2^30 would overflow into nonsense for an absurd day number; the ceiling clamps long before that.
  const exponent = Math.min(dayNumber - 1, 30);
  return Math.min(GENTLE_FIRST_DAY * 2 ** exponent, GENTLE_MAX_PER_DAY);
}

// Whole days elapsed since the send began, in UTC. Day 1 is the day it started.
export function sendDayNumber(startedAt: Date, now: Date): number {
  const startDay = Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const elapsed = Math.floor((nowDay - startDay) / 86_400_000);
  return Math.max(1, elapsed + 1);
}

export interface JobPacing {
  rollout: "immediate" | "gentle";
  perMinute: number;
  dailyCap: number; // 0 = uncapped; ignored entirely when rollout is 'gentle'
  // TASK-302: a STANDING ceiling that beats both of the above, including "uncapped". The provider's
  // daily allowance is shared with donation receipts, Gift Aid confirmations and admin login codes,
  // so a newsletter that spends the whole day silently costs a donor their receipt. 0 = no ceiling.
  ceiling: number;
  startedAt: Date | null;
}

// The cap that applies TODAY. A gentle rollout computes it from how long the send has been running,
// so the allowance grows on its own without anything needing to be rescheduled.
export function dailyCapFor(job: JobPacing, now: Date): number {
  const asked =
    job.rollout === "gentle"
      ? gentleDailyCap(sendDayNumber(job.startedAt ?? now, now))
      : Math.max(0, job.dailyCap);
  // TASK-302: the ceiling wins - and it has to beat 0, which has always meant "uncapped" and is the
  // DEFAULT send option. A ceiling that lost to the default would protect nothing at all.
  const ceiling = Math.max(0, job.ceiling ?? 0);
  if (ceiling <= 0) return asked;
  if (asked <= 0) return ceiling;
  return Math.min(asked, ceiling);
}

// How many messages this tick may send: the throttle, further limited by whatever is left of today's
// cap. Returning 0 is normal and simply means "nothing more today" — the worker sleeps and the ramp
// picks up tomorrow.
export function tickAllowance(
  job: JobPacing,
  sentToday: number,
  now: Date,
  tickSeconds: number = TICK_SECONDS,
): number {
  const byThrottle = Math.max(0, Math.floor((Math.max(0, job.perMinute) * tickSeconds) / 60));
  const cap = dailyCapFor(job, now);
  if (cap <= 0) return byThrottle; // uncapped (only reachable when rollout is 'immediate')
  return Math.min(byThrottle, Math.max(0, cap - sentToday));
}

// Plain-English summary for the admin screen — a progress bar that says "paused" without saying WHY
// invites someone to assume it is broken and start a second send.
export function pacingSummary(job: JobPacing, sentToday: number, remaining: number, now: Date): string {
  if (remaining <= 0) return "All sent.";
  const cap = dailyCapFor(job, now);
  if (cap > 0 && sentToday >= cap) {
    const day = job.rollout === "gentle" ? sendDayNumber(job.startedAt ?? now, now) : 0;
    const tomorrow = job.rollout === "gentle" ? gentleDailyCap(day + 1) : cap;
    return `Today's ${cap} sent — ${remaining} still to go. Sending resumes tomorrow, up to ${tomorrow}.`;
  }
  const perHour = Math.max(1, job.perMinute) * 60;
  const hours = remaining / perHour;
  const eta = hours < 1 ? `${Math.max(1, Math.round(remaining / Math.max(1, job.perMinute)))} min` : `${hours.toFixed(1)} hrs`;
  return `${remaining} still to send — about ${eta} at the current pace.`;
}
