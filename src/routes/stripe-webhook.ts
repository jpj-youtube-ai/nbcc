import express, { Router, type Request, type Response } from "express";
import type Stripe from "stripe";
import { constructEvent } from "../clients/stripe";
import { processWebhookEvent } from "../db/stripe-webhook";

// The ONE Stripe webhook endpoint for the unified platform (REQ-036/TASK-046). No
// other route handles donor/donation events. The raw request body is required for
// signature verification, so this path parses application/json as a Buffer via
// express.raw (NOT the global express.json) — it must be mounted BEFORE
// express.json in src/app.ts so the raw body survives.
export const stripeWebhookRouter = Router();

export async function postStripeWebhook(req: Request, res: Response): Promise<Response> {
  const signature = req.header("stripe-signature");
  if (!signature) {
    return res.status(400).json({ error: "Missing Stripe-Signature header" });
  }

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw), exactly what constructEvent needs.
    event = constructEvent(req.body as Buffer, signature);
  } catch (err) {
    // A bad/forged signature (or a body that was re-parsed) fails verification.
    console.error(
      "stripe webhook signature verification failed:",
      err instanceof Error ? err.message : err,
    );
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    const result = await processWebhookEvent(event);
    // 2xx tells Stripe the event is handled and must not be retried.
    return res.status(200).json({ received: true, ...result });
  } catch (err) {
    // A processing failure returns 5xx so Stripe retries later; idempotency by
    // event id makes the retry safe.
    console.error(
      "stripe webhook processing failed:",
      err instanceof Error ? err.message : err,
    );
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

stripeWebhookRouter.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  postStripeWebhook,
);
