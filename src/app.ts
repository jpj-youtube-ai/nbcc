import express from "express";
import { resolve } from "node:path";
import { healthRouter } from "./routes/health";
import { apiRouter, rejectOversizedMyStoryJson } from "./routes/api";
import { portalRouter } from "./routes/portal";
import { adminRouter } from "./routes/admin";
import { adminUsersRouter } from "./routes/admin-users";
import { adminEventsRouter } from "./routes/admin-events";
import { adminFundraisingRouter } from "./routes/admin-fundraising";
import { adminFundraisingCategoriesRouter } from "./routes/admin-fundraising-categories";
import { adminImpactExamplesRouter } from "./routes/admin-impact-examples";
import { adminFundraisingTeamRouter } from "./routes/admin-fundraising-team";
import { adminFundraisingRequestsRouter } from "./routes/admin-fundraising-requests";
import { adminWelcomePacksRouter } from "./routes/admin-welcome-packs";
import { adminFundraisingTouchRouter } from "./routes/admin-fundraising-touch";
import { adminFundraisingEmailsRouter } from "./routes/admin-fundraising-emails";
import { fundraiserThanksRouter } from "./routes/fundraiser-thanks";
import { fundraiseInviteRouter } from "./routes/fundraise-invite";
import { fundraiseAgainRouter } from "./routes/fundraise-again";
import { fundraiseRouter } from "./routes/fundraise";
import { fundraiseSignupTidyRouter } from "./routes/fundraise-signup-tidy";
import { fundraiseTeamsRouter } from "./routes/fundraise-teams";
import { adminFundraisingTeamsRouter } from "./routes/admin-fundraising-teams";
import { fundraiserNewsRouter, newsBodyGuard, NEWS_JSON_BODY_LIMIT, NEWS_POST_PATH } from "./routes/fundraiser-news";
import { fundraiserPicturesRouter, PICTURE_JSON_BODY_LIMIT, PICTURE_POST_PATH } from "./routes/fundraiser-pictures";
import { fundraiseMaterialsRouter } from "./routes/fundraise-materials";
import { fundraiseMemoryRouter } from "./routes/fundraise-memory";
import { eventTicketsRouter } from "./routes/event-tickets";
import { adminEventTicketsRouter } from "./routes/admin-event-tickets";
import { pledgesRouter } from "./routes/pledges";
import { adminBallReportRouter } from "./routes/admin-ball-report";
import { adminAnalyticsRouter } from "./routes/admin-analytics";
import { adminStoriesImportRouter, STORIES_IMPORT_BODY_LIMIT, STORIES_IMPORT_PATH } from "./routes/admin-stories-import";
import { adminWhatsNewRouter } from "./routes/admin-whats-new";
import { stripeWebhookRouter } from "./routes/stripe-webhook";
import { sesWebhookRouter } from "./routes/ses-webhook";
import { pulseRouter } from "./routes/pulse";
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
import { ballTransferRouter } from "./routes/ball-transfer";
import { adminBallTransferRouter } from "./routes/admin-ball-transfer";
import { adminQrRouter } from "./routes/admin-qr";
import { adminOverviewRouter } from "./routes/admin-overview";
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
  // Site analytics (TASK-479): POST /api/pulse reads its own small text body (2 KB at most) and
  // always answers 204, so it goes before express.json, which would answer some bodies with an error.
  app.use(pulseRouter);
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
  // TASK-493: a fundraiser's photo, stored like an event picture, so the same limit.
  app.use("/api/admin/fundraiser-images", express.json({ limit: IMAGE_JSON_BODY_LIMIT }));
  // TASK-506: a news update from an organiser's private area may carry a photo (2 MB at most, shrunk
  // in the browser first). Read only with a session cookie (newsBodyGuard), and only on that path.
  app.use(NEWS_POST_PATH, newsBodyGuard, express.json({ limit: NEWS_JSON_BODY_LIMIT }));
  // Profile pictures: the page photo and round profile photo an organiser sends, the same way.
  app.use(PICTURE_POST_PATH, newsBodyGuard, express.json({ limit: PICTURE_JSON_BODY_LIMIT }));
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
  // Booking the Festive Ball to pay by bank transfer (TASK-484). Refused until an admin switches it on.
  app.use(ballTransferRouter);
  app.use(portalRouter);
  app.use(adminRouter);
  // Admin user management + forgot/set-password (admin-management Phase 1, Task 5).
  app.use(adminUsersRouter);
  // The admin's Events section (TASK-453): events, the page switch, previews, picture uploads.
  app.use(adminEventsRouter);
  // TASK-507: "Thank your supporters" (the organiser's, and staff's checks). Before fundraiseRouter,
  // whose retired link route (GET /api/fundraise/manage/:token) would otherwise take "thanks".
  app.use(fundraiserThanksRouter);
  // Community fundraising (TASK-493): the public sign up, Get involved's list, each fundraiser's page,
  // the emailed manage links, and Admin > Fundraising. All of it off until an admin switches it on.
  // TASK-506: news updates (the organiser's, staff's and the public photo). Before fundraiseRouter,
  // whose retired link route (GET /api/fundraise/manage/:token) would otherwise take "news".
  app.use(fundraiserNewsRouter);
  // Profile pictures (the organiser's, staff's and the public profile photo). Before fundraiseRouter
  // for the same reason as news: its retired link route would otherwise take "pictures".
  app.use(fundraiserPicturesRouter);
  // Team pages: joining a team, an invite's link, the team organiser's own team and confirming a
  // handover; and Admin > Fundraising's team view and handover. Before fundraiseRouter, whose
  // retired link route (POST /api/fundraise/manage/:token) would otherwise take "handover".
  app.use(fundraiseTeamsRouter);
  app.use(adminFundraisingTeamsRouter);
  // In memory pages (Jaimie, 2026-10-03): envelopes, message checks and the year on reminder. Before
  // fundraiseMaterialsRouter, whose /materials/:piece would read "envelopes" as a piece it does not know.
  app.use(fundraiseMemoryRouter);
  // Sponsor pledges ("Sponsor now, pay after"): a sponsor pledging, the organiser's list, and staff's.
  // Before fundraiseRouter, whose retired link route (GET /api/fundraise/manage/:token) would
  // otherwise take "pledges". Its pay and cancel pages are on the site router (src/routes/site.ts).
  app.use(pledgesRouter);
  app.use(fundraiseRouter);
  app.use(adminFundraisingRouter);
  // Fundraising categories: the list the sign up form offers, A to Z; admins add, rename and hide them.
  app.use(adminFundraisingCategoriesRouter);
  // What gifts could do: the shared "could" examples on fundraiser, event and team pages; admins edit them.
  app.use(adminImpactExamplesRouter);
  // TASK-503: the fundraising team's tools (invite, calls, Get involved, the Monday summary), and
  // the sign up form's invite lookup.
  app.use(adminFundraisingTeamRouter);
  app.use(fundraiseInviteRouter);
  // TASK-515: the sign up form's Do it again lookup, from the year on email.
  app.use(fundraiseAgainRouter);
  // The sign up tidy: staff correct sport and the t-shirt, and ask for a size by a private link.
  app.use(fundraiseSignupTidyRouter);
  // TASK-505: what organisers asked us for (posters, leaflets, buckets and tins, shout outs, someone
  // to come along), tracked to done.
  app.use(adminFundraisingRequestsRouter);
  app.use(adminWelcomePacksRouter);
  // TASK-515: keeping in touch: the automatic emails (preview and switch) and the call prompts.
  app.use(adminFundraisingTouchRouter);
  // All emails: every fundraising, pledge, ticket and Festive Ball email, to read in Admin > Fundraising.
  app.use(adminFundraisingEmailsRouter);
  // TASK-504: a fundraiser's poster, pictures, sponsor form and certificate, for its organiser
  // (signed in) and for staff.
  app.use(fundraiseMaterialsRouter);
  // Event tickets (Jaimie, points 23 and 24): buying, the organiser's tickets, and Admin > Fundraising's
  // Event tickets card.
  app.use(eventTicketsRouter);
  app.use(adminEventTicketsRouter);
  // The Festive Ball ticket report, set up from the Events page (TASK-464).
  app.use(adminBallReportRouter);
  // Admin > Analytics (TASK-482): the numbers and the collecting switch.
  app.use(adminAnalyticsRouter);
  // The admin side of paying for the Ball by bank transfer (TASK-484).
  app.use(adminBallTransferRouter);
  // Stories from the old website's My Story form, from its CSV export (TASK-461).
  app.use(adminStoriesImportRouter);
  // The New pills in the admin, per person (TASK-478).
  app.use(adminWhatsNewRouter);
  // QR codes for every page of the site, in the admin (TASK-492).
  app.use(adminQrRouter);
  // The admin Overview's "Needs you" (TASK-508).
  app.use(adminOverviewRouter);
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
