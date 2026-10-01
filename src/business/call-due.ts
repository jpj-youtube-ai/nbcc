// TASK-491: a reminder to phone each business that gives monthly, every three months while they are
// still giving, to thank them and ask whether there is anything we can do.
//
// Pure: every date here is a UK calendar day as YYYY-MM-DD, so a call made late in the evening is
// counted on the day it was made, and comparing two dates is comparing two strings.
// See docs/superpowers/specs/2026-10-02-business-call-reminders-design.md.

/** Nobody is due a first call before this day, however long they have been giving. */
export const CALLS_START = "2026-09-01";

/** How often a business that is still giving is due a call. */
export const CALL_EVERY_MONTHS = 3;

/**
 * The same day of the month, `months` calendar months on. A day the later month does not have
 * becomes its last day: 31 May gives 31 August, 30 November gives 28 or 29 February.
 */
export function addCalendarMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const monthIndex = m - 1 + months;
  const year = y + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12; // 0 to 11
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface CallDueInput {
  /** Today in the UK. */
  today: string;
  /** The day of their first paid monthly gift, or null if they have never paid one. */
  supportingSince: string | null;
  /** The day of their most recent call, or null if nobody has called them yet. */
  lastCalledAt: string | null;
  /** Their monthly gift is neither cancelled nor lapsed. */
  supporting: boolean;
}

export interface CallDue {
  due: boolean;
  /** The day they become (or became) due, or null when they are not supporting and never will be. */
  dueOn: string | null;
}

/**
 * Whether a business is due a call today.
 *
 * Not supporting means no reminder, whatever the dates. After a call, the next one is due three
 * calendar months later. Before the first call, it is due three calendar months after their first
 * paid monthly gift, but never before 1 September 2026, when the reminders began.
 */
export function callDue(input: CallDueInput): CallDue {
  if (!input.supporting || !input.supportingSince) return { due: false, dueOn: null };
  let dueOn: string;
  if (input.lastCalledAt) {
    dueOn = addCalendarMonths(input.lastCalledAt, CALL_EVERY_MONTHS);
  } else {
    const fromStart = addCalendarMonths(input.supportingSince, CALL_EVERY_MONTHS);
    dueOn = fromStart < CALLS_START ? CALLS_START : fromStart;
  }
  return { due: input.today >= dueOn, dueOn };
}

/** The longest phone number we keep. */
export const PHONE_MAX = 40;
const PHONE_CHARS = /^[0-9 +()-]+$/;
const PHONE_MIN_DIGITS = 7;

/**
 * Check a phone number typed in the admin. Digits, spaces, `+`, `(`, `)` and `-` only, up to 40
 * characters and with at least 7 digits. An empty box takes the number away (phone: null).
 */
export function normalisePhone(raw: string): { ok: true; phone: string | null } | { ok: false } {
  const phone = raw.trim();
  if (phone === "") return { ok: true, phone: null };
  if (phone.length > PHONE_MAX || !PHONE_CHARS.test(phone)) return { ok: false };
  if (phone.replace(/[^0-9]/g, "").length < PHONE_MIN_DIGITS) return { ok: false };
  return { ok: true, phone };
}
