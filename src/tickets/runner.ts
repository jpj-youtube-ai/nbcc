import { deleteBuyerPhonesPastTheirTime, resendUnsentTicketEmails } from "./send";

// Event tickets on the daily task (src/scripts/send-reminders.ts, 8am):
//
//   - a tickets email that did not go when its payment landed (the email provider was down) is sent
//     again: every paid order still unstamped, each claimed so two runs never send it together, once
//     a run. Staff can also send one by hand from the admin ("Send tickets email again").
//   - a buyer's phone number is only for reaching them about the event, so it is deleted 90 days
//     after the event. Their name and email stay with the record of the payment.
//
// It never throws: each part has its own try, so one failing never stops the other.

export interface TicketDailyPass {
  emailsTried: number;
  emailsSent: number;
  phonesDeleted: number;
  failed: number;
}

export async function runTicketDailyPass(): Promise<TicketDailyPass> {
  const out: TicketDailyPass = { emailsTried: 0, emailsSent: 0, phonesDeleted: 0, failed: 0 };
  try {
    const r = await resendUnsentTicketEmails();
    out.emailsTried = r.tried;
    out.emailsSent = r.sent;
  } catch (err) {
    out.failed += 1;
    console.error("event tickets unsent emails failed:", err instanceof Error ? err.message : err);
  }
  try {
    out.phonesDeleted = await deleteBuyerPhonesPastTheirTime();
  } catch (err) {
    out.failed += 1;
    console.error("event tickets phone deletion failed:", err instanceof Error ? err.message : err);
  }
  return out;
}
