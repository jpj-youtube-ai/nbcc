// TASK-338: what the run-up to the ball sends, to whom, and when.
//
// Pure — no pool, no network, no clock of its own (the time is always passed in) — so the whole
// schedule is unit-testable DB-free, the way ./capacity.ts and ./holds.ts are. The script that
// runs daily only wires the seams.
//
// The shape it replaces: one manual button that sent one email once. Someone had to remember to
// press it, and anyone who booked afterwards never got one.

export const CHASE_DAYS_BEFORE_LOCK = 14;
// Jaimie, 2026-10-04: the practical email says "A week to go" and "A week on Saturday you'll be with
// us", so it goes a week before the Ball. It went 3 days before, which made its own words wrong.
// Sent on any other day (to someone who booked in the last week, or early with the staff button) it
// says the true number of days instead: daysToBall below, and ./reminder-email.ts.
export const PRACTICAL_DAYS_BEFORE_EVENT = 7;

export type RunUpStage = "chase" | "final-call" | "practical";

export interface RunUpBooking {
  id: number;
  reference: string;
  buyerEmail: string;
  buyerName: string;
  buyerFirstName: string | null;
  tableName: string | null;
  // Null only for a booking paid seconds ago - the token is minted with the confirmation. A
  // chase with no link in it is not worth sending, so those are skipped until it exists.
  guestToken: string | null;
  seats: number;
  guestsNamed: number;
  guestChaseSentAt: string | null;
  guestFinalCallSentAt: string | null;
  reminderSentAt: string | null;
}

export interface RunUpWindow {
  now: Date;
  eventDate: Date;
  // NULL until NBCC agrees it with the venue. While it is null NOTHING is chased: an email
  // asking for names "as soon as possible" is nagging, and it burns the one message people will
  // actually read when there IS a date.
  lockAt: Date | null;
}

const days = (n: number) => n * 24 * 60 * 60 * 1000;

// The practical email is timed by the DAY in the UK, not by counting hours back from the 7pm start:
// the morning run a week before is hours short of seven whole days, and would otherwise wait until
// the next morning.
const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const ukDay = (at: Date): string => UK_DAY.format(at);
function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * How many days it is to the Ball, counted by the day in the UK: 7 on the Saturday before, 1 the day
 * before, 0 on the day, below 0 after it. The reminder says this number when it is not a week.
 */
export function daysToBall(now: Date, eventDate: Date): number {
  const at = (day: string) => new Date(`${day}T12:00:00Z`).getTime();
  return Math.round((at(ukDay(eventDate)) - at(ukDay(now))) / days(1));
}

/**
 * Is the practical reminder due for this booking today?
 *
 * From the day a week before the Ball, up to the day before it, for any paid booking that has not
 * had it. So everyone booked in good time gets it on the morning a week before, and someone who
 * books inside the last week gets it on the next morning's run (as they always did), saying the true
 * number of days. A send that failed is not stamped, so a later morning tries again. Never on the
 * day of the Ball or after it: a booking first seen by that morning's run (paid the day before after
 * the run, or on the day) gets no reminder; its confirmation, hours old, has the same details.
 */
function practicalDue(booking: RunUpBooking, window: RunUpWindow): boolean {
  if (booking.reminderSentAt !== null) return false;
  const today = ukDay(window.now);
  const eventDay = ukDay(window.eventDate);
  return today >= daysBefore(eventDay, PRACTICAL_DAYS_BEFORE_EVENT) && today < eventDay;
}

export function outstanding(booking: RunUpBooking): boolean {
  return booking.guestsNamed < booking.seats;
}

// What this booking is due RIGHT NOW, or null.
//
// One stage per pass, most urgent first. A booking that has crossed both the chase point and the
// lock date gets the final call and never the chase it missed: sending the softer "a fortnight to
// go" email after the deadline has passed would be worse than sending nothing.
export function stageFor(booking: RunUpBooking, window: RunUpWindow): RunUpStage | null {
  if (!booking.buyerEmail) return null;
  const now = window.now.getTime();

  // The practical email goes to EVERYONE, a week out (or the morning after a later booking), whether
  // or not they ever sent guest details. It is the one that says where to go and when, so it is not conditional
  // on them having done their bit.
  if (practicalDue(booking, window)) return "practical";

  // A chase whose whole point is a link, with no link in it, is worse than silence.
  if (!booking.guestToken) return null;
  if (!outstanding(booking) || window.lockAt === null) return null;
  const lock = window.lockAt.getTime();

  // Past the deadline there is nothing left to ask for, so the chase stops rather than running
  // forever. Staff chase the stragglers by hand at that point, from the outstanding list.
  if (now > lock + days(1)) return null;

  // Past the lock date the chase window is CLOSED, not merely already used. Testing the two
  // flags independently let a late booking take the final call and then, the next morning, the
  // gentle "a fortnight to go" note it had never been sent — arriving after the deadline it was
  // warning about. Caught by the test, not by reading it.
  if (now >= lock) {
    return booking.guestFinalCallSentAt === null ? "final-call" : null;
  }
  if (now >= lock - days(CHASE_DAYS_BEFORE_LOCK) && booking.guestChaseSentAt === null) {
    return "chase";
  }
  return null;
}

export interface RunUpPlanned {
  booking: RunUpBooking;
  stage: RunUpStage;
}

export function planRunUp(bookings: RunUpBooking[], window: RunUpWindow): RunUpPlanned[] {
  const planned: RunUpPlanned[] = [];
  for (const booking of bookings) {
    const stage = stageFor(booking, window);
    if (stage) planned.push({ booking, stage });
  }
  return planned;
}

export interface RunUpPassResult {
  considered: number;
  sent: number;
  failed: number;
  byStage: Record<RunUpStage, number>;
}

export interface RunUpSeams {
  listBookings: () => Promise<RunUpBooking[]>;
  send: (booking: RunUpBooking, stage: RunUpStage) => Promise<void>;
  markSent: (bookingId: number, stage: RunUpStage) => Promise<void>;
  window: RunUpWindow;
}

// One pass over everything due.
//
// The stamp is written only AFTER a successful send, and a failure is counted and stepped over
// rather than thrown. Both matter for the same reason: this runs unattended once a day, and the
// alternative to "skip and try again tomorrow" is either a booking silently marked as emailed
// when it was not, or one bad address stopping every email behind it in the queue.
export async function runRunUpPass(seams: RunUpSeams): Promise<RunUpPassResult> {
  const bookings = await seams.listBookings();
  const planned = planRunUp(bookings, seams.window);
  const result: RunUpPassResult = {
    considered: bookings.length,
    sent: 0,
    failed: 0,
    byStage: { chase: 0, "final-call": 0, practical: 0 },
  };

  for (const { booking, stage } of planned) {
    try {
      await seams.send(booking, stage);
      await seams.markSent(booking.id, stage);
      result.sent += 1;
      result.byStage[stage] += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
