import { config } from "../config";
import { listSupportersDueForThankYou, recordAutoThankYou } from "../db/fulfilment";
import { sendThankYou } from "../clients/email";
import {
  buildThankYouEmailHtml,
  buildThankYouEmailText,
  thankYouSubject,
} from "../thank-you/letter";
import { runAutoThankYouPass, type AutoThankYouPassResult } from "./auto-thank-you";
import { recordAudit } from "../db/donations";

// TASK-407: the wiring for the automatic thank-you letter.
//
// Same split as the business-supporter reminders (src/scripts/send-reminders.ts +
// src/business/reminders.ts): everything that decides ANYTHING is pure and lives in
// auto-thank-you.ts, and this file only connects it to the pool, the mail client and the clock.
// It exists as its own module so the daily script can import it lazily, in its own try/catch,
// beside the two passes that already ride that schedule.

export async function runAutoThankYou(): Promise<AutoThankYouPassResult> {
  const now = new Date();
  return runAutoThankYouPass({
    now,
    listDue: () => listSupportersDueForThankYou(now),

    sendLetter: async (supporter, view) => {
      await sendThankYou({
        // shouldThankNow has already refused anybody without an address, so this cannot be null
        // by the time the pass calls us.
        email: supporter.email as string,
        from: config.GIVING_FROM_EMAIL,
        replyTo: config.GIVING_FROM_EMAIL,
        subject: thankYouSubject(view),
        html: buildThankYouEmailHtml(view),
        text: buildThankYouEmailText(view),
      });
    },

    markSent: async (supporter, view, reason) => {
      await recordAutoThankYou(supporter.donorId, view, supporter.email as string);
      // The Sent history shows a letter with nobody's name against it, so the audit trail is where
      // "why did this go today?" is answered - because they filled the form in, or because the
      // fortnight ran out.
      await recordAudit({
        actor: "automatic",
        action: "thank_you.sent_automatically",
        entity: "donor",
        entityId: supporter.donorId,
        data: { reason, band: supporter.band, fulfilmentId: supporter.fulfilmentId },
      });
    },
  });
}
