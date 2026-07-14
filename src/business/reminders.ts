// TASK-222: the pure orchestration for one daily business-supporter reminder pass. When a supporter
// has not yet chosen how they would like to be thanked, we nudge them twice: a warm 5-day reminder
// (stage 1) and a gentle 14-day last note (stage 2). This core is pure over injected seams (the
// due-list read, the send, the reminder-count stamp, plus the env-correct base + from), so it is
// fully DB-free and config-free — the runner script (src/scripts/send-reminders.ts) wires the real
// implementations, the unit test passes plain stubs. Mirrors runBusinessInviteBackfill (src/business/
// backfill.ts) exactly in structure, placement and best-effort error handling, and reuses the SAME
// pure branded builder the daily job needs (buildBusinessSupporterReminderEmail).
//
// SAFETY (no double-send): the due-list is gated on reminder_count (0 → the 5-day stage is due once
// invited ≥ 5 days ago; 1 → the 14-day stage is due once invited ≥ 14 days ago), and each supporter is
// stamped (markSent) to the stage that was just sent ONLY after its send SUCCEEDS. So a second run
// finds them advanced past that stage and sends 0, while a supporter whose send FAILED stays at the
// old count and is retried next run. markSent itself carries an idempotency guard (WHERE reminder_count
// = stage - 1), so even a racing double-run cannot advance the same stage twice. Sends run
// SEQUENTIALLY (a small population; sequential respects the email relay's rate limits), and each is
// best-effort: one failed send is counted and never aborts the rest of the run.

import { buildBusinessSupporterReminderEmail } from "./reminder-email";
import type { BusinessSupporterReminderEmail } from "../clients/email";
import type { SupporterDueForReminder } from "../db/fulfilment";

// The run outcome. due = how many supporters were due a reminder this pass; sent = how many were
// emailed AND stamped on this run; failed = how many sends failed (left at the old reminder_count,
// catchable on a later run). due === sent + failed.
export interface ReminderPassResult {
  due: number;
  sent: number;
  failed: number;
}

// The injected seams. The runner supplies the real implementations (listSupportersDueForReminder,
// sendBusinessSupporterReminder, markReminderSent) plus config.PORTAL_BASE_URL /
// config.GIVING_FROM_EMAIL; the unit test supplies stubs.
export interface ReminderPassDeps {
  listDue: () => Promise<SupporterDueForReminder[]>;
  sendReminder: (message: BusinessSupporterReminderEmail) => Promise<void>;
  // Returns unknown (not void) so the real markReminderSent — which returns whether it newly stamped a
  // row — is assignable directly; the pass ignores the return.
  markSent: (fulfilmentId: number, stage: 1 | 2) => Promise<unknown>;
  baseUrl: string; // config.PORTAL_BASE_URL — the env-correct public base for the tokenised link
  from: string; // config.GIVING_FROM_EMAIL — the repliable From/Reply-To (verified giving inbox)
}

export async function runReminderPass(deps: ReminderPassDeps): Promise<ReminderPassResult> {
  const due = await deps.listDue();
  let sent = 0;
  let failed = 0;

  for (const supporter of due) {
    try {
      // Build the branded reminder for this supporter's due stage, on the env-correct base + their own
      // token (same page the invite linked to), then send it repliable From/Reply-To the giving inbox.
      const email = buildBusinessSupporterReminderEmail({
        businessName: supporter.name,
        baseUrl: deps.baseUrl,
        token: supporter.token,
        stage: supporter.stage,
      });
      await deps.sendReminder({
        email: supporter.email,
        from: deps.from,
        replyTo: deps.from,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      // Advance the reminder_count to the stage just sent ONLY after the send succeeded, so a failed
      // send above (which threw) never advances the count and the next run retries the same stage. A
      // stamp failure here is swallowed by the catch, same best-effort contract as the invite backfill.
      await deps.markSent(supporter.fulfilmentId, supporter.stage);
      sent += 1;
    } catch {
      // Best-effort: one failed send (or stamp) is counted and must not abort the rest of the run.
      failed += 1;
    }
  }

  return { due: due.length, sent, failed };
}
