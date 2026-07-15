// TASK-222: the daily business-supporter reminder runner. It reads the fulfilment records due a
// thank-you reminder (a 5-day nudge, then a 14-day last note — listSupportersDueForReminder) and, for
// each, best-effort sends the stage-appropriate branded email and, only on success, advances the
// record's reminder_count (markReminderSent) so a re-run never double-sends the same stage. The
// orchestration is the pure runReminderPass (src/business/reminders.ts); this script only WIRES the
// real seams (the pool-backed reads/writes, the relay send) and the env-correct config, then logs a
// one-line summary of the counts.
//
// It lives under src/ so `tsc` compiles it into dist/ (shipped in the runtime image), letting it run
// with plain `node dist/scripts/send-reminders.js` — no tsx / devDeps needed (the runtime image is
// `npm ci --omit=dev` and copies only dist/, so a tsx-on-src invocation would fail there). `npm run
// reminders` is exactly that command. In production the DB is only reachable from inside the VPC, so a
// daily EventBridge schedule runs it as a one-off ECS task reusing the app task definition with a
// `["sh","-c","npm run reminders"]` command override (infra/modules/app/scheduler.tf) — the same
// one-off-task pattern the deploy uses for migrations. Reuses existing config (DATABASE_URL,
// EMAIL_SEND_URL, PORTAL_BASE_URL, GIVING_FROM_EMAIL) — no new config key.
import { pool } from "../db/pool";
import { config } from "../config";
import { listSupportersDueForReminder, markReminderSent } from "../db/fulfilment";
import { sendBusinessSupporterReminder } from "../clients/email";
import { runReminderPass, type ReminderPassResult } from "../business/reminders";

// Run one reminder pass over the current due-list. Exported (and pool-injected only at the call site
// below) so the wiring is importable; the orchestration itself is unit-tested via runReminderPass.
export async function sendReminders(): Promise<ReminderPassResult> {
  return runReminderPass({
    // The clock is captured HERE (new Date()), so the "5 days / 14 days since invite" thresholds are
    // evaluated against the moment the pass runs.
    listDue: () => listSupportersDueForReminder(new Date()),
    sendReminder: sendBusinessSupporterReminder,
    markSent: markReminderSent,
    baseUrl: config.PORTAL_BASE_URL,
    from: config.GIVING_FROM_EMAIL,
  });
}

// Only run when invoked directly (node dist/scripts/send-reminders.js), not when imported by a test.
if (require.main === module) {
  sendReminders()
    .then(async (result) => {
      // A single summary line (no recipient PII) so the ECS task log shows what the pass did.
      console.error(
        `business-supporter reminders: due=${result.due} sent=${result.sent} failed=${result.failed}`,
      );
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error("send-reminders failed:", err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
