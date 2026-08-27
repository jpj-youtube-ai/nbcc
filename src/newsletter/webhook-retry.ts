// TASK-305: what to do with a delivery event we cannot tie to a send.
//
// The provider confirms delivery astonishingly fast - under half a second in a real export:
//
//   sent      09:00:15.013
//   delivered 09:00:15.483
//
// The row recording WHO we sent to used to be written once per batch, at the end of a tick, up to
// twenty seconds later. A confirmation arriving in that gap matched nothing, was classed unmatched,
// and the webhook answered 200 - which tells Svix the event was handled and not to retry. It was
// then gone permanently. Fast providers confirm quickest, so Gmail, Yahoo and Outlook were precisely
// the ones being lost: 182 people had the newsletter while the dashboard said 95.
//
// The send is now recorded the instant it succeeds, which closes the gap. This is the second line of
// defence: an unmatched event that is still RECENT is answered with a retry instead, because at that
// age a race with our own bookkeeping is far more likely than a genuinely foreign message.
//
// It cannot be unconditional. Donation receipts, Gift Aid confirmations and admin login codes all
// raise events on the same provider account and legitimately match no newsletter. Asking Svix to
// retry those would be a self-inflicted flood - which is exactly why the original code answered 200
// to everything. The window is what makes the distinction safe.

/** How recent an unmatched event has to be for a race to be the likelier explanation. */
export const UNMATCHED_RETRY_WINDOW_MS = 5 * 60 * 1000;

export type UnmatchedDisposition =
  /** Probably our own race. Answer non-2xx so Svix delivers it again shortly. */
  | "retry"
  /** Old enough that it is genuinely not a newsletter of ours. Answer 200 and forget it. */
  | "ignore";

/**
 * An event stamped in the FUTURE is retried rather than discarded: clock skew between the provider
 * and us is normal, and it must never cost a delivery record.
 */
export function unmatchedDisposition(occurredAt: Date, now: Date): UnmatchedDisposition {
  const age = now.getTime() - occurredAt.getTime();
  if (Number.isNaN(age)) return "ignore";
  if (age < 0) return "retry";
  return age < UNMATCHED_RETRY_WINDOW_MS ? "retry" : "ignore";
}
