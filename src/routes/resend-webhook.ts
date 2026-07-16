import express, { Router, type Request, type Response } from "express";
import { verifySvixSignature, parseResendEvent } from "../newsletter/resend-events";
import { recordResendEvent } from "../db/newsletter-events";
import { config } from "../config";

// TASK-255: the Resend delivery webhook (email stats Phase 1 — see
// docs/superpowers/specs/2026-07-16-newsletter-email-stats-design.md). Resend POSTs a signed event
// here for every email on the domain; we keep only the ones that match a newsletter send.
//
// Trust boundary: this URL is public, and these events are the ONLY writer of delivery facts — the
// Svix signature check is everything, exactly as constructEvent is for the Stripe webhook. Like that
// route, it takes the RAW body (express.raw on this route, mounted before the global express.json),
// because the signature covers the exact bytes.
//
// Response discipline (Svix retries anything non-2xx):
//   503 — secret not configured yet (deploy precedes the user's Resend dashboard setup; a retry later
//         may genuinely succeed, so retrying is CORRECT);
//   401 — bad signature: not Resend, go away;
//   200 — everything else, INCLUDING events we drop (unconsumed types, receipts/login codes that
//         match no newsletter send, duplicates). Anything but a 2xx would make Svix hammer us with
//         retries for data we never wanted.
export const resendWebhookRouter = Router();

async function postResendWebhook(req: Request, res: Response): Promise<Response> {
  if (!config.RESEND_WEBHOOK_SECRET.startsWith("whsec_")) {
    return res.status(503).json({ error: "Webhook not configured" });
  }

  const rawBody = (req.body as Buffer).toString("utf8");
  const headers = {
    "svix-id": req.header("svix-id") ?? undefined,
    "svix-timestamp": req.header("svix-timestamp") ?? undefined,
    "svix-signature": req.header("svix-signature") ?? undefined,
  };
  if (!verifySvixSignature(config.RESEND_WEBHOOK_SECRET, headers, rawBody, Date.now())) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const parsed = parseResendEvent(rawBody);
  if (!parsed) return res.status(200).json({ outcome: "ignored" });

  try {
    const outcome = await recordResendEvent(String(headers["svix-id"]), parsed);
    return res.status(200).json({ outcome });
  } catch (err) {
    // A DB hiccup is worth a retry from Svix's side — this is the one path where 500 is right.
    console.error("resend webhook recording failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Event recording failed" });
  }
}

resendWebhookRouter.post(
  "/api/webhooks/resend",
  express.raw({ type: "application/json" }),
  postResendWebhook,
);
