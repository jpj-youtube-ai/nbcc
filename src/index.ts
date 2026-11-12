import { createApp } from "./app";
import { config } from "./config";
import { productionConfigProblems } from "./config/schema";
import { startSendWorker } from "./newsletter/send-worker";
import { startElfWorker } from "./elf/worker";
import { startPlaceLookups } from "./analytics/start";
import { startNotifyWorker } from "./admin/notify-runner";

// TASK-490: the same fail-fast as src/config, for what only the web server needs in production (the
// contact form's spam check keys). Checked here, not in src/config, so the scheduled jobs that share
// the config (the backup, the reminders) never refuse to start over a setting they do not use.
const productionProblems = productionConfigProblems(config);
if (productionProblems.length > 0) {
  console.error("Invalid environment configuration:", productionProblems);
  process.exit(1);
}

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`listening on :${config.PORT} (${config.NODE_ENV})`);
  // TASK-274: the background newsletter sender. Started HERE, not in createApp(), so that every test
  // and BDD run that builds an app does not also start a timer sending real email. It claims work
  // with FOR UPDATE SKIP LOCKED, so running on several ECS tasks at once is safe — each row goes to
  // exactly one of them.
  startSendWorker();
  // Elf Detective School wave 2: the elf worker, which sends December's emails, the alerts and the proud
  // moments on time and clears the photos away from 31 January (src/elf/worker.ts). Started HERE, not in
  // createApp(), for the same reason as the newsletter sender. Every send is claimed in elf_sends before it
  // goes, so several ECS tasks ticking at once never send anything twice.
  startElfWorker();
  // Site analytics: look visitors' towns up in the DB-IP file, when the image has it.
  startPlaceLookups();
  // TASK-619: push new arrivals to the staff phones that have asked for them. Started HERE for the
  // same reason as the two workers above. It does nothing at all until both VAPID keys are real,
  // and every notification is claimed in admin_notified before it goes, so several ECS tasks
  // ticking at once never buzz the same phone twice.
  startNotifyWorker();
});
