import { londonToday } from "../events/model";
import { isListed, type FundraiserRecord } from "./model";

// TASK-503: looking after a fundraiser around its date, for Admin > Fundraising and the Monday
// summary. Pure: every date is a UK calendar day as YYYY-MM-DD (so the clocks changing never moves
// one, and comparing two is comparing two strings), and today is passed in.
//
//   Time to call   two calls to every approved fundraiser with a date, like the business supporters'
//                  call reminders (src/business/call-due.ts): one from a week before the date, and
//                  one from a week after it. Each is due until somebody records it. A call before
//                  that was never made gives way to the call after once that one is due, so staff
//                  are only ever asked to make one call at a time.
//   Take it off    "Take off Get involved?" on a fundraiser still listed there four weeks after its
//                  date, or straight away when the organiser pressed "I've finished". Staff take it
//                  off by hand; its page and giving link keep working.

export const CALL_DAYS = 7;
export const OFF_LIST_AFTER_DAYS = 28;

export type CallWhich = "before" | "after";
export const CALL_WHICH: readonly CallWhich[] = ["before", "after"];

export interface CallRecord {
  which: CallWhich;
  /** ISO time. */
  calledAt: string;
  calledBy: string | null;
  note: string | null;
}

export interface CallState {
  which: CallWhich;
  /** The UK day it becomes due. */
  dueOn: string;
  due: boolean;
  /** The latest call of this kind, or null when nobody has made it yet. */
  called: CallRecord | null;
}

export interface CallStates {
  before: CallState | null;
  after: CallState | null;
  /** Is a call due today? */
  due: boolean;
  /** Which one, when one is. */
  dueWhich: CallWhich | null;
}

/** Today in the UK. */
export function followUpToday(now: Date): string {
  return londonToday(now);
}

/** A UK day `n` days on (or back). Worked at midday UTC, so the clocks changing never trips it. */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const latest = (calls: CallRecord[], which: CallWhich): CallRecord | null =>
  calls.filter((c) => c.which === which).sort((a, b) => (a.calledAt < b.calledAt ? 1 : -1))[0] ?? null;

export function callStates(
  f: Pick<FundraiserRecord, "status" | "eventDate">,
  calls: CallRecord[],
  today: string,
): CallStates {
  if (!f.eventDate) return { before: null, after: null, due: false, dueWhich: null };
  const live = f.status === "approved";
  const afterOn = addDays(f.eventDate, CALL_DAYS);
  const beforeOn = addDays(f.eventDate, -CALL_DAYS);
  const beforeCall = latest(calls, "before");
  const afterCall = latest(calls, "after");
  const afterDue = live && !afterCall && today >= afterOn;
  const beforeDue = live && !beforeCall && today >= beforeOn && today < afterOn;
  return {
    before: { which: "before", dueOn: beforeOn, due: beforeDue, called: beforeCall },
    after: { which: "after", dueOn: afterOn, due: afterDue, called: afterCall },
    due: beforeDue || afterDue,
    dueWhich: afterDue ? "after" : beforeDue ? "before" : null,
  };
}

export type OffListPrompt = "date" | "finished";

/** Should the admin ask "Take off Get involved?" about this one, and why? */
export function offListPrompt(
  f: Pick<FundraiserRecord, "status" | "public" | "path" | "eventDate" | "finishedRequestedAt" | "offListAt">,
  today: string,
): OffListPrompt | null {
  if (f.offListAt || !isListed(f, today)) return null;
  if (f.finishedRequestedAt) return "finished";
  if (f.eventDate && today >= addDays(f.eventDate, OFF_LIST_AFTER_DAYS)) return "date";
  return null;
}
