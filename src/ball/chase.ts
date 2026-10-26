// TASK-575: who to chase for guest names and meal choices in the last week before the deadline, and
// what the volunteers' list says.
//
// Pure - no pool, no network, no clock of its own (the time is always passed in) - so the whole
// plan is unit-testable DB-free, the way ./run-up.ts is. The daily script only wires the seams.
//
// Days are counted by the date in Europe/London, never by subtracting hours: the morning run lands
// at a different hour of the day when the clocks change, and "7 days to go" must still mean the
// seventh calendar day before the deadline.

import { choosableCourses, hasChosen, type MenuCourse } from "./menu";
import { londonDate } from "./sales-report";

/** The days before the deadline day (0) that bookers get a reminder email. */
export const REMINDER_DAYS = [7, 5, 3, 1];
/** The days the volunteers get their chase list: the reminder days, and the deadline day itself. */
export const LIST_DAYS = [7, 5, 3, 1, 0];

export interface ChaseBooking {
  id: number;
  reference: string;
  status: "paid" | "pending";
  paymentMethod: string;
  buyerName: string;
  buyerFirstName: string | null;
  buyerEmail: string;
  buyerPhone: string | null;
  guestToken: string | null;
  seats: number;
  /** One entry per NAMED guest: their stored "Course: choice" lines, or null if they have none. */
  choices: Array<string | null>;
  /** The London day (YYYY-MM-DD) the week-to-go email went, or null. */
  reminderSentOn: string | null;
}

// A YYYY-MM-DD day at midday UTC, so counting days never trips over the clocks changing.
const midday = (day: string) => new Date(`${day}T12:00:00Z`).getTime();

/**
 * What goes today, or null when nothing does.
 *
 * `daysToDeadline` is the whole number of London days from today to the deadline's London day, so the
 * deadline day itself is 0. Nothing goes without a deadline, on a day that is not a round one, or on
 * or after the Ball day, even when the deadline is set later than the Ball.
 */
export function chaseDay(
  now: Date,
  lockAt: Date | null,
  ballDay: string,
): { daysToDeadline: number; reminder: boolean; list: boolean } | null {
  if (lockAt === null) return null;
  const today = londonDate(now);
  if (today >= ballDay) return null;
  const daysToDeadline = Math.round((midday(londonDate(lockAt)) - midday(today)) / (24 * 60 * 60 * 1000));
  if (!LIST_DAYS.includes(daysToDeadline)) return null;
  return { daysToDeadline, reminder: REMINDER_DAYS.includes(daysToDeadline), list: true };
}

/**
 * What this booking still owes: seats with no guest named, and named guests who have not chosen.
 * Choices are only asked for when the menu has a course to choose from, so with none, only names count.
 */
export function missing(b: ChaseBooking, menu: MenuCourse[]): { unnamed: number; unchosen: number } {
  const unnamed = Math.max(0, b.seats - b.choices.length);
  const asking = choosableCourses(menu).length > 0;
  const unchosen = asking ? b.choices.filter((c) => !hasChosen(c, menu)).length : 0;
  return { unnamed, unchosen };
}

export function isIncomplete(b: ChaseBooking, menu: MenuCourse[]): boolean {
  const m = missing(b, menu);
  return m.unnamed > 0 || m.unchosen > 0;
}

type Row = ChaseBooking & { unnamed: number; unchosen: number };

export interface ReminderGroup {
  email: string;
  firstName: string;
  bookings: Row[];
}

const withMissing = (b: ChaseBooking, menu: MenuCourse[]): Row => ({ ...b, ...missing(b, menu) });

function firstNameOf(b: ChaseBooking): string {
  const given = b.buyerFirstName?.trim();
  if (given) return given;
  return b.buyerName.trim().split(/\s+/)[0] || "there";
}

/**
 * Who gets a reminder today: paid bookings with an address and a guest link that are still
 * incomplete, and whose week-to-go email did not go today. One group per lower-cased address, so a
 * booker with two bookings gets one email covering both (in the order the bookings were given).
 */
export function planReminders(bookings: ChaseBooking[], menu: MenuCourse[], today: string): ReminderGroup[] {
  const groups = new Map<string, ReminderGroup>();
  for (const b of bookings) {
    const email = b.buyerEmail.trim().toLowerCase();
    if (b.status !== "paid" || email === "" || !b.guestToken) continue;
    if (b.reminderSentOn === today) continue;
    if (!isIncomplete(b, menu)) continue;
    const group = groups.get(email);
    if (group) group.bookings.push(withMissing(b, menu));
    else groups.set(email, { email, firstName: firstNameOf(b), bookings: [withMissing(b, menu)] });
  }
  return [...groups.values()];
}

export interface ChaseList {
  /** Paid, incomplete, and reachable by email: the volunteers phone these. */
  toChase: Row[];
  /** Paid and incomplete, but no address or no guest link yet: only a phone call reaches them. */
  cannotEmail: Row[];
  /** Bank transfer bookings not yet paid. Every seat counts as unnamed. */
  awaitingPayment: Row[];
  /** Paid bookings with everything named and chosen. */
  complete: number;
  /** Seats still unnamed, over the paid bookings still to chase (both sections). */
  unnamed: number;
  /** Named guests still to choose, over the paid bookings still to chase (both sections). */
  unchosen: number;
}

// Most missing first, then by reference so the order is steady from one day to the next.
const byMostMissing = (a: Row, b: Row) =>
  b.unnamed + b.unchosen - (a.unnamed + a.unchosen) || a.reference.localeCompare(b.reference);

/** The volunteers' chase list. Not filtered by today's reminder: it lists everything still open. */
export function planList(bookings: ChaseBooking[], menu: MenuCourse[]): ChaseList {
  const toChase: Row[] = [];
  const cannotEmail: Row[] = [];
  const awaitingPayment: Row[] = [];
  let complete = 0;

  for (const b of bookings) {
    if (b.status === "pending") {
      if (b.paymentMethod === "transfer") awaitingPayment.push({ ...b, unnamed: b.seats, unchosen: 0 });
      continue;
    }
    if (!isIncomplete(b, menu)) {
      complete += 1;
      continue;
    }
    const emailable = b.buyerEmail.trim() !== "" && Boolean(b.guestToken);
    (emailable ? toChase : cannotEmail).push(withMissing(b, menu));
  }

  toChase.sort(byMostMissing);
  cannotEmail.sort(byMostMissing);
  awaitingPayment.sort(byMostMissing);

  const open = [...toChase, ...cannotEmail];
  return {
    toChase,
    cannotEmail,
    awaitingPayment,
    complete,
    unnamed: open.reduce((n, r) => n + r.unnamed, 0),
    unchosen: open.reduce((n, r) => n + r.unchosen, 0),
  };
}
