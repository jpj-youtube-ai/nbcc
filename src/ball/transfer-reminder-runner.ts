import { getTransferSettings, listTransfersForReminder, markTransferReminderSent } from "../db/ball-transfer";
import { londonDate } from "./sales-report";
import { runTransferReminderPass, type ReminderPassResult } from "./transfer-reminders";
import { sendTransferReminder } from "./transfer-send";

// TASK-485: the wiring for the daily transfer reminder pass (the pass itself is ./transfer-reminders.ts).
// Called from the 8am job, src/scripts/send-reminders.ts, in its own try/catch.
//
// The reminder repeats the bank details, so with none set it sends nothing at all. It does NOT check
// the on/off switch: switching bank transfer off stops new bookings, not reminders to people who
// have already booked and still owe the money.

export async function runTransferReminders(now = new Date()): Promise<ReminderPassResult> {
  const s = await getTransferSettings();
  if (!s.accountName || !s.sortCode || !s.accountNumber) return { considered: 0, sent: 0, failed: 0 };
  const bank = { accountName: s.accountName, sortCode: s.sortCode, accountNumber: s.accountNumber };
  return runTransferReminderPass({
    list: listTransfersForReminder,
    send: (b) => sendTransferReminder(b, bank, b.payBy),
    markSent: markTransferReminderSent,
    today: londonDate(now),
  });
}
