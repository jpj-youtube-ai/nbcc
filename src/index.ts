import { createApp } from "./app";
import { config } from "./config";
import { startSendWorker } from "./newsletter/send-worker";
import { startPlaceLookups } from "./analytics/start";

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
