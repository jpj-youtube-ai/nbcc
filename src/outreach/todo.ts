import { isEngagement, isOutcome } from "./outcomes";

// TASK-405: what needs doing today, and why.
//
// Pure - no pool, no config, no clock passed in from anywhere but the caller - so the rules that
// decide who gets chased are unit-tested without a database (golden rule 5).
//
// One list, not three. A separate nudge list, call list and ask-again list would be three places
// for a busy volunteer to forget instead of one, and the whole value here is that nobody falls
// through. Every row carries the REASON it is there, because a list of names with no explanation
// gets skimmed and then ignored.

/** Two weeks: long enough that a business on holiday has had a fair chance, short enough that the
 *  trail is still warm when somebody follows up. */
export const NUDGE_AFTER_DAYS = 14;

/** A week. Added from a phone call with no address is normal; added and forgotten is not. */
export const FIND_ADDRESS_AFTER_DAYS = 7;

/** Straight after they replied is too soon to chase. A week later is about right. */
const CALL_AFTER_DAYS = 7;

export type TodoKind = "ask-again" | "call" | "nudge" | "send" | "find-address";

export interface TodoBusiness {
  id: number;
  businessName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  owner: string | null;
  ownerEmail: string | null;
  sentAt: string | null;
  /** When the single follow-up went. Its presence ends the chasing, whatever else is true. */
  nudgeSentAt: string | null;
  outcome: string | null;
  outcomeAt: string | null;
  askAgainOn: string | null;
  createdAt: string;
}

export interface Todo {
  id: number;
  businessName: string;
  kind: TodoKind;
  /** Why this business is on the list, in a volunteer's words. */
  reason: string;
  /** What to do about it. Carries the phone number where there is one. */
  action: string;
  /** How late we are. Drives the order within a kind, and reads as urgency on screen. */
  daysOverdue: number;
  owner: string | null;
  ownerEmail: string | null;
}

/**
 * A promise we made outranks a chase, and a warm business outranks a cold one. Sorting by date
 * alone would bury the two rows that actually matter under whatever happened to be oldest.
 */
const RANK: Record<TodoKind, number> = {
  "ask-again": 0,
  call: 1,
  nudge: 2,
  send: 3,
  "find-address": 4,
};

const DAY = 86_400_000;

/** Whole days from `then` to `now`, negative when `then` is still ahead. */
function daysBetween(then: string | Date, now: Date): number {
  const start = typeof then === "string" ? new Date(then) : then;
  return Math.floor((now.getTime() - start.getTime()) / DAY);
}

/** A date-only column compared at midnight UTC, so a time zone cannot move it by a day. */
function daysSinceDate(isoDate: string, now: Date): number {
  const due = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.floor((today.getTime() - due.getTime()) / DAY);
}

/**
 * What this business needs today, or null when the answer is "nothing".
 *
 * Order matters: the first rule that fires wins, so the two states that end the relationship are
 * checked before anything that could put the business back on a list.
 */
export function whatIsNeeded(b: TodoBusiness, now: Date): Todo | null {
  const todo = (kind: TodoKind, reason: string, action: string, daysOverdue: number): Todo => ({
    id: b.id,
    businessName: b.businessName,
    kind,
    reason,
    action,
    daysOverdue: Math.max(0, daysOverdue),
    owner: b.owner,
    ownerEmail: b.ownerEmail,
  });

  // A decline is an instruction, and a business that already gives is not a task. Both are
  // checked first so nothing below can put them back on somebody's list.
  if (b.outcome === "declined" || b.outcome === "signed_up") return null;

  // A promise with a date on it. The reason "not this year" is worth more than a no.
  if (b.askAgainOn) {
    const overdue = daysSinceDate(b.askAgainOn, now);
    if (overdue >= 0) {
      return todo(
        "ask-again",
        "They asked us to come back around now.",
        "Ask again",
        overdue,
      );
    }
    // A date still ahead of us is the whole point of having set it: leave them alone until then.
    return null;
  }

  // Warm, and nothing agreed. The most expensive thing on this screen to lose, because the work
  // is already spent. "No reply" is not warmth, so isEngagement does the filtering.
  if (b.outcome && isOutcome(b.outcome) && isEngagement(b.outcome)) {
    const since = b.outcomeAt ? daysBetween(b.outcomeAt, now) : 0;
    if (since >= CALL_AFTER_DAYS) {
      return todo(
        "call",
        "They were interested and nothing has happened since.",
        b.contactPhone ? `Call ${b.contactPhone}` : "Follow it up",
        since - CALL_AFTER_DAYS,
      );
    }
    return null;
  }

  // Recording "no reply" is a decision, not a dead end: it stops the nagging.
  if (b.outcome === "no_reply") return null;

  if (b.sentAt) {
    // One follow-up, ever. The cap is here rather than in the button so it holds however the send
    // is reached, and so a business cannot be chased twice by two volunteers on the same morning.
    if (b.nudgeSentAt) return null;
    const since = daysBetween(b.sentAt, now);
    if (since >= NUDGE_AFTER_DAYS) {
      return todo(
        "nudge",
        `Emailed ${since} days ago, no reply.`,
        "Send a nudge, or record that there was none",
        since - NUDGE_AFTER_DAYS,
      );
    }
    return null;
  }

  // Never emailed. An address in hand is the easiest win on the whole page.
  if (b.contactEmail) {
    return todo("send", "Added, with an address, but never emailed.", "Send the invitation", daysBetween(b.createdAt, now));
  }

  const waiting = daysBetween(b.createdAt, now);
  if (waiting >= FIND_ADDRESS_AFTER_DAYS) {
    return todo(
      "find-address",
      "On the list with no email address.",
      "Find an address, or give them a call",
      waiting - FIND_ADDRESS_AFTER_DAYS,
    );
  }
  return null;
}

/** Most important kind first, most overdue first within a kind. */
export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort(
    (a, b) => RANK[a.kind] - RANK[b.kind] || b.daysOverdue - a.daysOverdue,
  );
}
