// TASK-302: telling "come back later" apart from "this address is no good".
//
// A send that fails is put back in the queue, but only THREE times - after that the recipient is
// marked failed and never written to again. That limit exists so one dead mailbox cannot hold up a
// send forever, and for a bad address it is exactly right.
//
// It is exactly wrong for a capacity refusal. When the mail provider says "you have used today's
// allowance", that is not a fact about the recipient. Counting it against their three attempts meant
// a person could be dropped from the newsletter permanently because we happened to reach the daily
// limit three times while their turn came around - silently, and with no way to tell afterwards that
// they had been skipped rather than sent.
//
// Pure and dependency-free, like the rest of src/newsletter, so the classification is unit-tested
// without a queue or a network.

export type FailureDisposition =
  /** Not this recipient's fault. Put them back WITHOUT spending an attempt. */
  | "defer"
  /** Something about this message or address. Spend an attempt; give up after the limit. */
  | "count";

// Statuses that mean "later", not "no". 429 is the rate limit / quota; 503 and 504 are the provider
// being briefly unable to take the message. Deliberately NOT 502: our relay wraps EVERY provider
// error as a 502, so treating it as temporary would defer genuinely bad addresses forever.
const TEMPORARY_STATUS = /\b(429|503|504)\b/;

const TEMPORARY_WORDS =
  /rate.?limit|quota|daily limit|too many|temporarily unavailable|try again later|service unavailable/i;

// The message never reached the provider at all - a dropped connection says nothing about the
// address, so it must not cost the recipient an attempt.
const NETWORK_TROUBLE =
  /fetch failed|network|socket hang up|econnreset|econnrefused|etimedout|timed? ?out|aborted/i;

/**
 * What a failed send should cost the recipient.
 *
 * Unrecognised errors deliberately fall to "count". Deferring is the generous branch - it never
 * gives up - so an unknown fault must land on the side that eventually stops, or a single strange
 * error could keep one recipient looping through the queue forever.
 */
export function dispositionFor(errorMessage: string): FailureDisposition {
  const message = String(errorMessage ?? "");
  if (!message.trim()) return "count";
  if (TEMPORARY_STATUS.test(message)) return "defer";
  if (TEMPORARY_WORDS.test(message)) return "defer";
  if (NETWORK_TROUBLE.test(message)) return "defer";
  return "count";
}
