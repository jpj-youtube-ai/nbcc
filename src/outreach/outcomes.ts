import { OUTCOMES, type Outcome } from "./model";

// TASK-404: what each outcome MEANS. Pure - no pool, no config - so the rules are unit-tested
// without a database (golden rule 5).
//
// The outcomes themselves were declared in model.ts back in TASK-354. What was missing is
// everything a person or a screen needs to do with one: what to call it, whether it counts as the
// business having engaged, and whether it leaves us owing them something later.

/**
 * What a volunteer reads. Written as the answer to "what happened?", in the words somebody would
 * actually say out loud - "Said no", not "Declined"; "Passed on internally", not "Referred".
 *
 * KEEP IN SYNC with OUT_OUTCOMES in assets/js/admin/app.js. A sync test holds them together
 * (test/unit/outreach-outcomes.test.ts), the same way SECTIONS is held to the browser copy.
 */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  signed_up: "Signed up",
  interested: "Interested",
  asked_for_info: "Asked for information",
  passed_on: "Passed on internally",
  not_this_year: "Not this year",
  declined: "Said no",
  no_reply: "No reply",
};

/**
 * The one-line explanation under each button, so a volunteer picking between "Interested" and
 * "Asked for information" knows which is which without guessing. These are the difference
 * between an outcome list people use accurately and one they use approximately.
 */
export const OUTCOME_MEANINGS: Record<Outcome, string> = {
  signed_up: "They are giving, or have promised to.",
  interested: "Warm, but nothing agreed yet.",
  asked_for_info: "They want to know more before deciding.",
  passed_on: "The person we wrote to has handed it to someone else there.",
  not_this_year: "A no for now, and worth asking again later.",
  declined: "A no, and they should not be asked again.",
  no_reply: "We heard nothing back.",
};

/**
 * A decline is an instruction, not a score. Recording one puts the business on the permanent
 * do-not-contact side of the matcher, so it is the only outcome that takes something away.
 */
export function isDoNotContactOutcome(outcome: Outcome): boolean {
  return outcome === "declined";
}

/**
 * Anything except silence counts as the business having engaged.
 *
 * This is what holds off the three-year retention purge and what puts a business on the call
 * list. "No reply" deliberately does not count: recording silence is not contact, and treating it
 * as engagement would keep a dead record alive for ever.
 */
export function isEngagement(outcome: Outcome): boolean {
  return outcome !== "no_reply";
}

/**
 * Does this outcome leave us owing them something later?
 *
 * Only "not this year" - which is the outcome worth more than a decline, but only if something
 * remembers the date. Without one it is indistinguishable from a no.
 */
export function wantsAskAgainDate(outcome: Outcome): boolean {
  return outcome === "not_this_year";
}

/**
 * A sensible default for that date: eleven months out, so the ask lands slightly BEFORE the same
 * point in their year rather than slightly after. A business that said "not this year" in
 * September is thinking about next year's budget in August.
 *
 * The volunteer can change it. A default that is roughly right is what stops the field being
 * left empty, which is the only outcome that actually costs us anything.
 */
export function suggestedAskAgain(now: Date): string {
  const then = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 11, 1));
  return then.toISOString().slice(0, 10);
}

/** Every outcome, in the order a volunteer should read them: best news first, silence last. */
export const OUTCOME_ORDER: Outcome[] = [
  "signed_up",
  "interested",
  "asked_for_info",
  "passed_on",
  "not_this_year",
  "declined",
  "no_reply",
];

/** Guard for a value arriving from a request body. */
export function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (OUTCOMES as readonly string[]).includes(value);
}
