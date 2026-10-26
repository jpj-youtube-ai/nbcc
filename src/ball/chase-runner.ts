import { config } from "../config";
import { getSettings } from "../db/ball";
import { claimChaseSend, getChaseRecipients, listChaseBookings, markChaseSent, releaseChaseClaim } from "../db/ball-chase";
import { sendBallChaseList, sendBallRunUp } from "../clients/email";
import { londonDate } from "./sales-report";
import { BALL_DAY } from "./sales-report-runner";
import { guestLink } from "./run-up-runner";
import { parseMenu } from "./menu";
import { chaseDay, planList, planReminders } from "./chase";
import { buildChaseListEmail, buildChaseReminderEmail } from "./chase-email";

// TASK-576: the wiring for the Festive Ball guest chase. It rides the daily 8am task
// (npm run reminders, src/scripts/send-reminders.ts) right after the run-up pass, like the ticket
// report does; the pure ./chase.ts decides whether today is a round day and who is still missing
// something, and ./chase-email.ts writes both emails.
//
// Every email is claimed before it is sent (ball_chase_sends, one per kind, day and address), so a
// second run on the same morning sends nothing. A send that fails gives its claim back, so a rerun can
// try again; a send that went keeps its claim even if recording it then fails, so a rerun can never
// send it twice.

export interface ChaseRunResult {
  /** Days to the deadline, or null when today is not a chase day (no deadline, not a round day, or the Ball is here). */
  day: number | null;
  /** Reminder emails sent: one per booker. */
  reminders: number;
  /** Reminder emails that did not go (each gave its claim back). */
  failed: number;
  /** Whether the volunteers' list went this morning. */
  listSent: boolean;
}

const recordFailed = (what: string) => (err: unknown) =>
  console.error(`ball chase ${what} went, but could not be recorded:`, err instanceof Error ? err.message : err);

export async function runBallChase(now = new Date()): Promise<ChaseRunResult> {
  const settings = await getSettings();
  const lockAt = settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : null;
  const plan = chaseDay(now, lockAt, BALL_DAY);
  if (plan === null || lockAt === null) return { day: null, reminders: 0, failed: 0, listSent: false };

  const today = londonDate(now);
  const days = plan.daysToDeadline;
  const menu = parseMenu(settings.menuOptions);
  const result: ChaseRunResult = { day: days, reminders: 0, failed: 0, listSent: false };

  // The reminders first: one email to each booker still missing something.
  if (plan.reminder) {
    for (const group of planReminders(await listChaseBookings(), menu, today)) {
      const claim = await claimChaseSend("reminder", today, group.email);
      if (claim === null) continue; // already sent this morning
      try {
        const mail = buildChaseReminderEmail({ group, daysToDeadline: days, deadline: lockAt, guestLink });
        await sendBallRunUp({
          email: group.email,
          from: config.BALL_FROM_EMAIL,
          replyTo: config.BALL_FROM_EMAIL,
          ...mail,
        });
      } catch {
        await releaseChaseClaim(claim).catch(() => undefined);
        result.failed += 1;
        continue;
      }
      result.reminders += 1;
      await markChaseSent(claim, group.bookings.map((b) => b.id)).catch(recordFailed("reminder"));
    }
  }

  // Then the volunteers' list, as the bookings stand now, after this morning's reminders.
  if (plan.list) {
    const to = (await getChaseRecipients()).map((r) => r.email);
    if (to.length > 0) {
      const claim = await claimChaseSend("list", today, "*");
      if (claim !== null) {
        const list = planList(await listChaseBookings(), menu);
        try {
          const mail = buildChaseListEmail({ list, daysToDeadline: days, deadline: lockAt, guestLink });
          await sendBallChaseList({ to, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
        } catch (err) {
          await releaseChaseClaim(claim).catch(() => undefined);
          console.error("ball chase list failed:", err instanceof Error ? err.message : err);
          return result;
        }
        result.listSent = true;
        await markChaseSent(claim, list.toChase.map((b) => b.id)).catch(recordFailed("list"));
      }
    }
  }

  return result;
}
