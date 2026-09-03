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
// EMAIL_PROVIDER, PORTAL_BASE_URL, GIVING_FROM_EMAIL) — no new config key.
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
  // TASK-338: the ball run-up rides the SAME daily task rather than getting infrastructure of its
  // own. It is one more read and a handful of sends on a schedule that already exists, and a
  // second EventBridge rule would be a second thing to notice had stopped.
  //
  // Run after the supporter pass and in its own try/catch: a failure in either must not stop the
  // other, because they have nothing to do with each other beyond sharing a clock.
  sendReminders()
    .then(async (result) => {
      // A single summary line (no recipient PII) so the ECS task log shows what the pass did.
      console.error(
        `business-supporter reminders: due=${result.due} sent=${result.sent} failed=${result.failed}`,
      );
      try {
        const { runBallRunUp } = await import("../ball/run-up-runner");
        const ball = await runBallRunUp();
        console.error(
          `ball run-up: considered=${ball.considered} sent=${ball.sent} failed=${ball.failed} ` +
            `chase=${ball.byStage.chase} finalCall=${ball.byStage["final-call"]} practical=${ball.byStage.practical}`,
        );
      } catch (err) {
        console.error("ball run-up failed:", err instanceof Error ? err.message : err);
      }
      // TASK-407: the automatic thank-you letter. A business that has signed up and told us how
      // it would like to be thanked gets its letter without anybody having to remember, and one
      // that never answered gets the standard letter after a fortnight rather than nothing at
      // all. Rides this task for the same reason as the two passes above, and in its own
      // try/catch so a failure here cannot stop the retention prune below.
      try {
        const { runAutoThankYou } = await import("../business/auto-thank-you-runner");
        const thanks = await runAutoThankYou();
        console.error(
          `automatic thank-you letters: due=${thanks.due} sent=${thanks.sent} failed=${thanks.failed}`,
        );
      } catch (err) {
        console.error("automatic thank-you failed:", err instanceof Error ? err.message : err);
      }
      // Email-audit retention: prune email_log rows past their six-tax-years window
      // (src/email/log-retention.ts). Rides this existing daily task for the same reason the
      // ball run-up does — one more statement on a schedule that already exists — and in its
      // own try/catch so a prune hiccup cannot stop the passes above (or vice versa).
      try {
        const { pruneEmailLog } = await import("../db/email-log");
        const pruned = await pruneEmailLog(new Date());
        console.error(`email log retention: pruned=${pruned}`);
      } catch (err) {
        console.error("email log prune failed:", err instanceof Error ? err.message : err);
      }
      await pool.end();
    })
    .catch(async (err: unknown) => {
      console.error("send-reminders failed:", err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
