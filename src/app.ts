import express from "express";
import { resolve } from "node:path";
import { healthRouter } from "./routes/health";
import { apiRouter } from "./routes/api";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { createSiteRouter } from "./routes/site";

export function createApp() {
  const app = express();
  // Behind the ALB, trust exactly ONE hop of proxy so req.ip / rate-limiting see the
  // real client IP (the first X-Forwarded-For entry) rather than the load balancer's
  // address. `true` would trust the WHOLE X-Forwarded-For chain, letting a client spoof
  // its own IP (and so its own rate-limit bucket) by sending a fake header; `1` trusts
  // only the ALB's own hop, which is the only proxy in front of this service.
  app.set("trust proxy", 1);
  // The Stripe webhook (REQ-036) needs the RAW body for signature verification, so
  // it is mounted BEFORE express.json — its route applies express.raw itself; all
  // other routes still get parsed JSON below.
  app.use(stripeWebhookRouter);
  app.use(express.json());
  app.use(apiRouter);
  app.use(portalRouter);
  app.use(adminRouter);
  app.use(healthRouter);
  // Static marketing site: the four pages, their clean URLs, and /assets.
  // siteRoot resolves relative to this module — the repo root locally and under
  // tsx, /app in the container (where the Dockerfile copies the site files).
  app.use(createSiteRouter(resolve(__dirname, "..")));
  // Add feature routers here.
  return app;
}
