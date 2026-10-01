import { reminderDue } from "./transfer";

// TASK-485: the daily pass that reminds a bank transfer buyer two days before their pay-by date.
// Pure: the list, the send and the mark are passed in, and the wiring is ./transfer-reminder-runner.ts,
// the same split as the run-up (./run-up.ts and ./run-up-runner.ts).
//
// A send that fails is not marked, so tomorrow's run tries again; one failure never stops the rest.
// Nothing is reminded once its date has passed: an overdue booking is flagged for staff, who decide.

export interface ReminderBooking {
  id: number;
  payBy: string;
  createdDay: string;
  remindedAt: string | null;
}

export interface ReminderPassResult {
  considered: number;
  sent: number;
  failed: number;
}

export async function runTransferReminderPass<B extends ReminderBooking>(deps: {
  list: () => Promise<B[]>;
  send: (booking: B) => Promise<void>;
  markSent: (id: number) => Promise<void>;
  today: string;
}): Promise<ReminderPassResult> {
  const bookings = await deps.list();
  const result: ReminderPassResult = { considered: bookings.length, sent: 0, failed: 0 };
  for (const b of bookings) {
    if (!reminderDue(b, deps.today)) continue;
    try {
      await deps.send(b);
    } catch (err) {
      result.failed += 1;
      console.error(`ball transfer reminder failed for booking ${b.id}:`, err instanceof Error ? err.message : err);
      continue;
    }
    await deps.markSent(b.id);
    result.sent += 1;
  }
  return result;
}
