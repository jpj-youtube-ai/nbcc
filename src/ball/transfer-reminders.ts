import { reminderDue } from "./transfer";

// TASK-485: the daily pass that reminds a bank transfer buyer two days before their pay-by date.
// Pure: the list, the send, the claim and the release are passed in, and the wiring is
// ./transfer-reminder-runner.ts, the same split as the run-up (./run-up.ts and ./run-up-runner.ts).
//
// Each booking is CLAIMED before it is sent: the claim marks it reminded only if nothing has yet,
// so two runs at once (a manual run during the 8am one) cannot both email the same person. A send
// that fails gives its claim back, so the next morning's run tries again. One failure, of a claim or
// a send, never stops the rest. Nothing is reminded once its date has passed: an overdue booking is
// flagged for staff, who decide.

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
  /** Mark it reminded if nothing has yet; true when this run won it. */
  claim: (id: number) => Promise<boolean>;
  /** Undo a claim whose send failed. */
  release: (id: number) => Promise<void>;
  today: string;
}): Promise<ReminderPassResult> {
  const bookings = await deps.list();
  const result: ReminderPassResult = { considered: bookings.length, sent: 0, failed: 0 };
  for (const b of bookings) {
    if (!reminderDue(b, deps.today)) continue;
    try {
      if (!(await deps.claim(b.id))) continue;
    } catch (err) {
      result.failed += 1;
      console.error(`ball transfer reminder: could not claim booking ${b.id}:`, err instanceof Error ? err.message : err);
      continue;
    }
    try {
      await deps.send(b);
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      console.error(`ball transfer reminder failed for booking ${b.id}:`, err instanceof Error ? err.message : err);
      await deps.release(b.id).catch((e) =>
        console.error(`ball transfer reminder: could not release booking ${b.id}:`, e instanceof Error ? e.message : e),
      );
    }
  }
  return result;
}
