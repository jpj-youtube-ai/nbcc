import { config } from "../config";
import { sendBallReport } from "../clients/email";
import {
  claimScheduledSend,
  getReportSettings,
  lastScheduledSendAt,
  markSendSent,
  readSalesInputs,
  releaseClaim,
  scheduledSendExists,
} from "../db/ball-report";
import { londonDate, renderReport, reportDue } from "./sales-report";
import { BALL_EVENT_DATE } from "./run-up-runner";

// TASK-464: the wiring for the twice-weekly Festive Ball ticket report. It rides the daily 8am task
// (npm run reminders, src/scripts/send-reminders.ts) like the run-up emails do, rather than having a
// schedule of its own; the pure ./sales-report.ts decides whether today is a report day.
//
// The day is claimed before anything is sent, so a second run on the same morning sends nothing, and
// a failed send gives the day back rather than recording a report that never went.

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
  try {
    const inputs = await readSalesInputs(now, await lastScheduledSendAt());
    const email = renderReport(inputs, { today, eventDate: BALL_DAY, test: false });
    const to = settings.recipients.map((r) => r.email);
    await sendBallReport({ to, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...email });
    await markSendSent(claim, to, inputs);
    return { sent: true, recipients: to.length };
  } catch (err) {
    await releaseClaim(claim).catch(() => undefined);
    throw err;
  }
}
