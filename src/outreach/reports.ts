import { isEngagement, isOutcome } from "./outcomes";
import type { Outcome } from "./model";

// TASK-413: is any of this working, and what works best?
//
// Pure - no pool, no config - so every figure is unit-tested without a database (golden rule 5).
// The queries hand over rows; everything that could be argued with is worked out here.
//
// The rule underneath all of it: never divide by a number that includes businesses which have not
// had their chance yet. A business emailed yesterday has not "failed to reply", and counting it as
// one drags every rate down and makes the report look like bad news when it is just early.

export interface ReportRow {
  outcome: string | null;
  sentAt: string | null;
  owner: string | null;
  sentWithPersonalMessage: boolean | null;
  /** Total given, in pence, by the donor this business became. 0 when it never did. */
  raisedPence: number;
}

export interface Funnel {
  added: number;
  emailed: number;
  replied: number;
  signedUp: number;
  /** Of those emailed, how many said anything at all. Null while nobody has been emailed. */
  replyRate: number | null;
  /** Of those emailed, how many became supporters. Null while nobody has been emailed. */
  signUpRate: number | null;
}

/** A percentage to one decimal place, or null when the denominator is zero. */
function rate(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * Added, emailed, replied, signed up.
 *
 * "Replied" is any recorded outcome except "no reply" - the same engagement rule the call list and
 * the retention purge use, so the report and the screens can never disagree about what counts.
 *
 * Both rates are out of EMAILED, not out of added. A business sitting on the list with no address
 * has not declined to reply, and putting it in the denominator would punish the charity for having
 * a to-do item.
 */
export function buildFunnel(rows: ReportRow[]): Funnel {
  const added = rows.length;
  const emailed = rows.filter((r) => r.sentAt).length;
  const replied = rows.filter(
    (r) => r.sentAt && r.outcome && isOutcome(r.outcome) && isEngagement(r.outcome as Outcome),
  ).length;
  const signedUp = rows.filter((r) => r.outcome === "signed_up").length;

  return {
    added,
    emailed,
    replied,
    signedUp,
    replyRate: rate(replied, emailed),
    signUpRate: rate(signedUp, emailed),
  };
}

export interface MoneyRaised {
  /** Businesses whose sign-up a volunteer has linked to a donor. */
  supporters: number;
  totalPence: number;
  /** Mean per supporter. Null with none, rather than a misleading zero. */
  averagePence: number | null;
}

/**
 * What outreach has actually raised.
 *
 * Only counts businesses a volunteer LINKED to a donor when recording the sign-up. A name match
 * would be a guess, and a guess is not a figure to put in front of trustees - it misses a firm
 * trading under a different name and wrongly joins two similar ones.
 */
export function buildMoneyRaised(rows: ReportRow[]): MoneyRaised {
  const paying = rows.filter((r) => r.raisedPence > 0);
  const totalPence = paying.reduce((sum, r) => sum + r.raisedPence, 0);
  return {
    supporters: paying.length,
    totalPence,
    averagePence: paying.length ? Math.round(totalPence / paying.length) : null,
  };
}

export interface VolunteerTally {
  owner: string;
  emailed: number;
  signedUp: number;
  signUpRate: number | null;
}

/**
 * How each volunteer's approaches have gone.
 *
 * Only counts what they actually SENT, so somebody who added ten businesses and emailed none does
 * not appear to have a nought per cent rate. Unassigned work is grouped rather than dropped,
 * because it is real work and hiding it would make the totals not add up.
 *
 * Ordered by sign-ups rather than by rate: one sign-up from one email is not a hundred per cent
 * success, and sorting by rate would put it at the top of the table for ever.
 */
export function buildByVolunteer(rows: ReportRow[]): VolunteerTally[] {
  const tallies = new Map<string, VolunteerTally>();
  for (const row of rows) {
    if (!row.sentAt) continue;
    const owner = row.owner ?? "Nobody assigned";
    const t = tallies.get(owner) ?? { owner, emailed: 0, signedUp: 0, signUpRate: null };
    t.emailed += 1;
    if (row.outcome === "signed_up") t.signedUp += 1;
    tallies.set(owner, t);
  }
  return [...tallies.values()]
    .map((t) => ({ ...t, signUpRate: rate(t.signedUp, t.emailed) }))
    .sort((a, b) => b.signedUp - a.signedUp || b.emailed - a.emailed);
}

export interface PersonalMessageEffect {
  withMessage: { emailed: number; signedUp: number; rate: number | null };
  without: { emailed: number; signedUp: number; rate: number | null };
  /** True once both sides have enough sends for the comparison to mean anything. */
  worthReading: boolean;
}

/** Below this, the difference between the two columns is noise wearing a percentage sign. */
export const ENOUGH_TO_COMPARE = 10;

/**
 * Does taking the extra minute to write a line actually help?
 *
 * The honest part of this function is `worthReading`. With four sends on one side and three on the
 * other, one sign-up swings the "rate" by twenty points, and a charity could reasonably change how
 * it works on the strength of nothing at all. So the screen is told when not to believe the
 * numbers yet, rather than being left to guess.
 */
export function buildPersonalMessageEffect(rows: ReportRow[]): PersonalMessageEffect {
  const side = (want: boolean) => {
    const sent = rows.filter((r) => r.sentAt && r.sentWithPersonalMessage === want);
    const signedUp = sent.filter((r) => r.outcome === "signed_up").length;
    return { emailed: sent.length, signedUp, rate: rate(signedUp, sent.length) };
  };
  const withMessage = side(true);
  const without = side(false);
  return {
    withMessage,
    without,
    worthReading: withMessage.emailed >= ENOUGH_TO_COMPARE && without.emailed >= ENOUGH_TO_COMPARE,
  };
}
