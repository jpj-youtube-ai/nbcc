import { choosableCourses, hasChosen, type MenuCourse } from "./menu";

// TASK-418: who has told us what they want to eat, and who still has not.
//
// menuProgress() has existed in ./menu.ts since TASK-345 and was wired to NOTHING — no admin
// view, no chase. So the day the venue finally confirmed a menu there was no way to answer the
// only question staff had: which of these bookings still owes me an answer, and how do I ask?
//
// This is the per-booking half, modelled on ./guest-progress.ts, which answers exactly the same
// question about guest NAMES. Kept separate from it deliberately: the two are chased at
// different times, by different emails, and a booking can be complete on one and not the other.
//
// Pure: no pool, no clock, so it is unit-testable DB-free (golden rule 5).

export interface MenuProgressRow {
  reference: string;
  buyerName: string;
  buyerEmail: string;
  seats: number;
  guestToken: string | null;
  /** One entry per NAMED guest: their stored "Course: choice" lines, or null if they have none. */
  choices: Array<string | null>;
}

export interface BookingMenuProgress extends MenuProgressRow {
  guestsNamed: number;
  chosen: number;
  missing: number;
  complete: boolean;
}

/**
 * How close one booking is to a complete order.
 *
 * Measured against the guests NAMED, not the seats paid for. You cannot choose a dinner for
 * somebody whose name nobody has given you yet, and counting those as outstanding menu answers
 * would blame this list for a gap the guest-name chase (./guest-progress.ts) already owns. A
 * booking with no names yet is therefore "complete" here and outstanding there, which is the
 * truthful split: two different emails fix the two different gaps.
 */
export function bookingMenuProgress(row: MenuProgressRow, menu: MenuCourse[]): BookingMenuProgress {
  const guestsNamed = row.choices.length;
  // Nothing is outstanding while there is nothing to choose from. hasChosen already returns
  // true for an empty menu, so this only guards the arithmetic below from being meaningless.
  const asking = choosableCourses(menu).length > 0;
  const chosen = asking ? row.choices.filter((c) => hasChosen(c, menu)).length : guestsNamed;
  const missing = asking ? guestsNamed - chosen : 0;
  return { ...row, guestsNamed, chosen, missing, complete: missing === 0 };
}

export interface MenuProgressSummary {
  /** False while the venue has not confirmed a menu: the honest answer, rather than "0% done". */
  asking: boolean;
  guestsNamed: number;
  chosen: number;
  outstanding: number;
  bookingsOutstanding: number;
  /** 0-100, rounded. 100 ONLY when nothing is outstanding, matching the guest-name summary. */
  percentComplete: number;
}

export function summariseMenuProgress(
  rows: MenuProgressRow[],
  menu: MenuCourse[],
): MenuProgressSummary {
  const asking = choosableCourses(menu).length > 0;
  const progress = rows.map((r) => bookingMenuProgress(r, menu));
  const guestsNamed = progress.reduce((n, b) => n + b.guestsNamed, 0);
  const chosen = progress.reduce((n, b) => n + b.chosen, 0);
  const outstanding = progress.reduce((n, b) => n + b.missing, 0);
  return {
    asking,
    guestsNamed,
    chosen,
    outstanding,
    bookingsOutstanding: progress.filter((b) => !b.complete).length,
    // A list that is 99.6% done rounds to 100 and reads as finished, which is exactly the wrong
    // thing to tell the person whose job is to chase the last few.
    percentComplete:
      guestsNamed === 0 ? 0 : outstanding === 0 ? 100 : Math.min(99, Math.round((chosen / guestsNamed) * 100)),
  };
}

/** The bookings worth an email, oldest first, with the rest of the row for the chase list. */
export function outstandingMenuBookings(
  rows: MenuProgressRow[],
  menu: MenuCourse[],
): BookingMenuProgress[] {
  return rows.map((r) => bookingMenuProgress(r, menu)).filter((b) => !b.complete);
}
