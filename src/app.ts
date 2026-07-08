import express from "express";
import { resolve } from "node:path";
import { healthRouter } from "./routes/health";
import { apiRouter } from "./routes/api";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { unsubscribeRouter } from "./routes/unsubscribe";
import { createSiteRouter } from "./routes/site";

export function createApp() {
  const app = express();
  // Behind the ALB, trust the proxy so req.ip / rate-limiting see the real client IP
  // (taken from X-Forwarded-For) rather than the load balancer's address.
  app.set("trust proxy", true);
  // The Stripe webhook (REQ-036) needs the RAW body for signature verification, so
  // it is mounted BEFORE express.json — its route applies express.raw itself; all
  // other routes still get parsed JSON below.
  app.use(stripeWebhookRouter);
  app.use(express.json());
  app.use(apiRouter);
  app.use(portalRouter);
  app.use(adminRouter);
  app.use(healthRouter);
  // Public newsletter unsubscribe (TASK-161/REQ-069). Must be mounted before the site
  // catch-all router below, otherwise its wildcard route would shadow /unsubscribe/:token.
  app.use(unsubscribeRouter);
  // Static marketing site: the four pages, their clean URLs, and /assets.
  // siteRoot resolves relative to this module — the repo root locally and under
  // tsx, /app in the container (where the Dockerfile copies the site files).
  app.use(createSiteRouter(resolve(__dirname, "..")));
  // Add feature routers here.
  return app;
}
