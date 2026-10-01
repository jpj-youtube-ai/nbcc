// TASK-484: retiring the inline card checkout that the Ball page's fallback to Stripe's own page
// replaces. Without it, the first checkout stayed pending and held its seats beside the new one.
//
// The rules, in order:
//   * Only a still-pending CARD booking with that reference is a candidate.
//   * The page proves it is its own with the client secret it was given, which begins with the
//     session id and "_secret_" (the suffix stops cs_x matching cs_xy).
//   * The session is expired at Stripe FIRST. Stripe refuses to expire one that has been paid, so a
//     checkout somebody did pay can never be cancelled under them.
//   * Only then is the booking cancelled. If that fails, the session is already dead at Stripe, so its
//     own expired event, or the one-hour cap in SOLD_SQL, gives the seats back; the new checkout goes ahead.
// Nothing here throws: whatever happens, the buyer's new checkout must still be made.

export interface ReplaceDeps {
  pendingCardSession(reference: string): Promise<string | null>;
  expire(sessionId: string): Promise<unknown>;
  cancel(sessionId: string): Promise<void>;
}

export type ReplaceOutcome = "retired" | "not_found" | "not_theirs" | "stripe_refused" | "expired_only";

export async function retireReplacedCheckout(
  replaces: { reference: string; clientSecret: string },
  deps: ReplaceDeps,
): Promise<ReplaceOutcome> {
  let sid: string | null;
  try {
    sid = await deps.pendingCardSession(replaces.reference);
  } catch {
    return "not_found";
  }
  if (!sid) return "not_found";
  if (!replaces.clientSecret.startsWith(`${sid}_secret_`)) return "not_theirs";
  try {
    await deps.expire(sid);
  } catch {
    return "stripe_refused";
  }
  try {
    await deps.cancel(sid);
    return "retired";
  } catch {
    return "expired_only";
  }
}
