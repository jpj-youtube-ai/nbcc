import express from "express";
import { resolve } from "node:path";
import { healthRouter } from "./routes/health";
import { apiRouter, rejectOversizedMyStoryJson } from "./routes/api";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { adminUsersRouter } from "./routes/admin-users";
import { adminEventsRouter } from "./routes/admin-events";
import { adminBallReportRouter } from "./routes/admin-ball-report";
import { adminStoriesImportRouter, STORIES_IMPORT_BODY_LIMIT, STORIES_IMPORT_PATH } from "./routes/admin-stories-import";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { sesWebhookRouter } from "./routes/ses-webhook";
import { preferencesRouter } from "./routes/preferences";
import { subscribeRouter } from "./routes/subscribe";
import { unsubscribeRouter } from "./routes/unsubscribe";
import { thankYouLetterRouter } from "./routes/thank-you";
import { businessRouter } from "./routes/business";
import { newsletterImagesRouter } from "./routes/newsletter-images";
import { eventImagesRouter } from "./routes/event-images";
import { IMAGE_JSON_BODY_LIMIT } from "./newsletter/image-validation";
import { newsletterDocumentsRouter } from "./routes/newsletter-documents";
import { tickerRouter } from "./routes/ticker";
import { ballRouter } from "./routes/ball";
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
  // The SES delivery webhook (TASK-255 lineage; Resend→SES migration) reads its SNS envelope
  // from the raw bytes (SNS posts JSON as text/plain), so it is mounted before express.json for
  // the same reason as Stripe's.
  app.use(sesWebhookRouter);
  app.use(preferencesRouter);
  // Reject an oversized JSON submission to the public, unauthenticated /api/my-story
  // endpoint by its Content-Length BEFORE the global express.json() parses it, so the
  // 32kb cap is real (mounted after the parser it would be a no-op, since body-parser
  // skips a body already parsed at the 100kb default). Scoped to the one path; it only
  // reads a header, never the body, so it is safe ahead of the parser.
  app.use("/api/my-story", rejectOversizedMyStoryJson);
  // The newsletter image upload carries a base64 payload up to ~2 MB (×1.37 encoded), which exceeds
  // the global express.json 100kb cap. Give just this path a larger parser BEFORE the global one;
  // body-parser then sees the body already parsed and skips it. Mirrors the /api/my-story guard.
  app.use("/api/admin/newsletter-images", express.json({ limit: IMAGE_JSON_BODY_LIMIT }));
  // TASK-453: event pictures and organiser logos arrive the same way, so the same limit.
  app.use("/api/admin/event-images", express.json({ limit: IMAGE_JSON_BODY_LIMIT }));
  // Hosted-document uploads (TASK-265): same problem, bigger files — the 10 MB document cap is
  // ~13.7 MB base64-encoded, so without this the parser 413s a real certificate BEFORE auth runs
  // and the composer shows a bare "Upload failed". Scoped to exactly the attachments path (the
  // :id segment matches, it is not read here); every other newsletter route keeps the 100kb cap.
  app.use("/api/admin/newsletters/:id/attachments", express.json({ limit: "15mb" }));
  // TASK-461: the old website's My Story export arrives as CSV text, a few KB, up to a 2 MB file.
  app.use(STORIES_IMPORT_PATH, express.json({ limit: STORIES_IMPORT_BODY_LIMIT }));
  app.use(express.json());
  app.use(apiRouter);
  // Public supporter-ticker feed (TASK-178/REQ-003): GET /api/supporters/ticker.
  app.use(tickerRouter);
  // Public Festive Ball availability feed (TASK-313): GET /api/ball/availability.
  app.use(ballRouter);
  app.use(portalRouter);
  app.use(adminRouter);
  // Admin user management + forgot/set-password (admin-management Phase 1, Task 5).
  app.use(adminUsersRouter);
  // The admin's Events section (TASK-453): events, the page switch, previews, picture uploads.
  app.use(adminEventsRouter);
  // The Festive Ball ticket report, set up from the Events page (TASK-464).
  app.use(adminBallReportRouter);
  // Stories from the old website's My Story form, from its CSV export (TASK-461).
  app.use(adminStoriesImportRouter);
  app.use(healthRouter);
  // Public newsletter unsubscribe (TASK-161/REQ-069). Must be mounted before the site
  // catch-all router below, otherwise its wildcard route would shadow /unsubscribe/:token.
  app.use(unsubscribeRouter);
  // Public footer signup (TASK-261) — JSON POST, rate-limited + honeypotted in the route.
  app.use(subscribeRouter);
  // Public printable thank-you letter page (TASK-165/REQ-069). Also before the site catch-all so its
  // wildcard doesn't shadow /thank-you/letter/:token.
  app.use(thankYouLetterRouter);
  // Public per-business Platinum certificate (TASK-211): GET /business/certificate/:token. Before the
  // site catch-all so its wildcard doesn't shadow the token route.
  app.use(businessRouter);
  // Public newsletter image serve — before the site catch-all so /media/* isn't shadowed.
  app.use(newsletterImagesRouter);
  // Public event picture serve (TASK-453) — before the site catch-all, like the one above.
  app.use(eventImagesRouter);
  // Public hosted newsletter documents (viewer page + file) — before the site catch-all so
  // /newsletter/document/* isn't shadowed.
  app.use(newsletterDocumentsRouter);
  // Static marketing site: the four pages, their clean URLs, and /assets.
  // siteRoot resolves relative to this module — the repo root locally and under
  // tsx, /app in the container (where the Dockerfile copies the site files).
  app.use(createSiteRouter(resolve(__dirname, "..")));
  // Add feature routers here.
  return app;
}
