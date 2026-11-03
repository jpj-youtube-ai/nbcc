// The moment the Festive Ball's promotion comes down and Fill a Red Bag takes over: 20:00 UK time on
// Saturday 7 November 2026 (20:00 UTC, the clocks have gone back). Nobody presses anything, and no
// deploy happens on the night: every page in question is drawn per visit, and asks here.
//
// Pure: the time is always handed in, and the only reading of the clock is at the edge, in
// src/routes/site.ts, so a test can stand on either side. The Ball's own code knows nothing of this
// (no file in src/ball changes, and the admin's Ball switch is never read differently or written).
//
// What the moment hides is what this check is placed in front of, in src/routes/site.ts and
// src/routes/fundraise-pages.ts. Once the Ball has passed, this file and the things it hides can go.

const AT_MS = Date.UTC(2026, 10, 7, 20, 0, 0);

export const AFTER_BALL_AT = new Date(AT_MS);

/** The Festive Ball's card on What's on and Get involved, which comes down with the rest. */
export const BALL_CARD_SLUG = "festive-ball-2026";

/** Has the moment come? A time that makes no sense has not: nothing comes down by accident. */
export function afterBall(now: Date): boolean {
  return now.getTime() >= AT_MS;
}

/** Did this view ask to see the after state? Exactly ?at=after-ball: an array or anything else is no. */
export function asksForAfterBall(query: unknown): boolean {
  return typeof query === "object" && query !== null && (query as { at?: unknown }).at === "after-ball";
}

/** Should this view show the after state? After the moment, or when it asked to (see above). */
export function showAfterBall(now: Date, query: unknown): boolean {
  return afterBall(now) || asksForAfterBall(query);
}

/**
 * A view that asked for ?at=after-ball is for checking the pages before the night: it carries no
 * search listing and is never kept. It changes that one view and nothing else.
 */
export function markAfterBallCheck(res: { setHeader(name: string, value: string): unknown }, query: unknown): void {
  if (!asksForAfterBall(query)) return;
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "private, no-store");
}
