import { config } from "../config";
import { listSupportersAwaitingPerks, markPerksSent, getFulfilmentByToken } from "../db/fulfilment";
import { runPerksDelivery, type PerksPassResult } from "./perks-delivery";
import { buildPerksDeliveryEmail } from "./perks-email";
import { sendBusinessCaptureConfirmation } from "../clients/email";

// TASK-441: wires the pure rule to the real database and mail client, and rides the daily 8am task
// that already exists (the same shape as auto-thank-you-runner.ts). No second EventBridge rule: the
// pass checks the weekday itself, which is cheaper than a schedule nobody would notice had stopped.
//
// It reuses sendBusinessCaptureConfirmation as the transport - the same from/reply-to and the same
// SES configuration set as the confirmation it follows - because this is the second half of that
// conversation, not a new kind of mail.

export async function runPerksDeliveryPass(now: Date = new Date()): Promise<PerksPassResult> {
  return runPerksDelivery({
    now,
    listAwaiting: listSupportersAwaitingPerks,
    markSent: markPerksSent,
    send: async (s) => {
      if (!s.email) return; // shouldSendPerksNow already excludes these; belt and braces.
      // certificate_delivery lives on the record rather than the list row, and it only changes the
      // wording ("your printed one is on its way as well"), so it is read here rather than widening
      // the queue. One extra read for a handful of supporters a week.
      const record = await getFulfilmentByToken(s.token);
      const content = buildPerksDeliveryEmail({
        businessName: s.name,
        wantBadge: s.wantBadge,
        wantCertificate: s.wantCertificate,
        certificateByPost: record?.certificate_delivery === "post",
        token: s.token,
        baseUrl: config.PORTAL_BASE_URL,
      });
      await sendBusinessCaptureConfirmation({
        email: s.email,
        from: config.GIVING_FROM_EMAIL,
        replyTo: config.GIVING_FROM_EMAIL,
        subject: content.subject,
        html: content.html,
        text: content.text,
      });
    },
  });
}
