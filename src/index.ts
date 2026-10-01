import { createApp } from "./app";
import { config } from "./config";
import { productionConfigProblems } from "./config/schema";
import { startSendWorker } from "./newsletter/send-worker";
import { startPlaceLookups } from "./analytics/start";

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
  // Site analytics: look visitors' towns up in the DB-IP file, when the image has it.
  startPlaceLookups();
});
