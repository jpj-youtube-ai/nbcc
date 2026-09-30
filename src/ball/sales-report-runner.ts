import { config } from "../config";
import { sendBallReport } from "../clients/email";
import {
  claimScheduledSend,
  getReportSettings,
  lastCountedTo,
  markSendSent,
  readSalesInputs,
  recordTestSend,
  releaseClaim,
  scheduledSendExists,
} from "../db/ball-report";
import { londonDate, renderReport, reportDue } from "./sales-report";
import { BALL_EVENT_DATE } from "./run-up-runner";

// TASK-464: the wiring for the twice-weekly Festive Ball ticket report. It rides the daily 8am task
// (npm run reminders, src/scripts/send-reminders.ts) like the run-up emails do, rather than having a
// schedule of its own; the pure ./sales-report.ts decides whether today is a report day.
//
// The day is claimed before anything is sent, so a second run on the same morning sends nothing. A
// send that fails gives the day back, so a rerun can try again; a send that went keeps the day even
// if recording it then fails, so a rerun can never send it twice.

/** The Ball's date in the UK: the last day a report can go. */
export const BALL_DAY = londonDate(BALL_EVENT_DATE);

export interface ReportRunResult {
  sent: boolean;
  recipients: number;
}

export async function runBallSalesReport(now = new Date()): Promise<ReportRunResult> {
  const settings = await getReportSettings();
  const today = londonDate(now);
  const due = reportDue({
    now,
    reportOn: settings.reportOn,
    recipients: settings.recipients.length,
    eventDate: BALL_DAY,
    sentToday: await scheduledSendExists(today),
  });
  if (!due) return { sent: false, recipients: 0 };

  const claim = await claimScheduledSend(today, "system:schedule");
  if (claim === null) return { sent: false, recipients: 0 };
  const to = settings.recipients.map((r) => r.email);
  let inputs;
  try {
    // Counted up to `now`, on from exactly where the last report counted to.
    inputs = await readSalesInputs(now, await lastCountedTo());
    const email = renderReport(inputs, { today, eventDate: BALL_DAY, test: false });
    await sendBallReport({ to, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...email });
  } catch (err) {
    await releaseClaim(claim).catch(() => undefined);
    throw err;
  }
  try {
    await markSendSent(claim, to, inputs, now);
  } catch (err) {
    // It went. The day stays claimed, so nothing sends it again; only the record is missing.
    console.error(
      "ball ticket report went, but could not be recorded:",
      err instanceof Error ? err.message : err,
    );
  }
  return { sent: true, recipients: to.length };
}

/**
 * "Send a test to me": the real email with today's numbers, marked as a test, to the person asking
 * and nobody else. Throws only when the email did not go; failing to record a test that went is
 * logged, not reported as a failed send.
 */
export async function sendTestReport(o: { to: string; actor: string; now: Date }): Promise<void> {
  const today = londonDate(o.now);
  const inputs = await readSalesInputs(o.now, await lastCountedTo());
  const email = renderReport(inputs, { today, eventDate: BALL_DAY, test: true });
  // Only ever to the person asking: a test must never reach the organiser or the sponsor.
  await sendBallReport({ to: [o.to], from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...email });
  try {
    await recordTestSend(today, o.to, inputs, o.actor);
  } catch (err) {
    console.error("ball report test went, but could not be recorded:", err instanceof Error ? err.message : err);
  }
}
