import { randomBytes } from "node:crypto";
import { Router } from "express";
import { config } from "../config";
import { stripe, stripeConfigured } from "../clients/stripe";
import { canFulfil, seatsFor } from "../ball/capacity";
import { makeReference, purchaseSchema } from "../ball/booking";
import { buildBallSessionParams } from "../ball/checkout";
import { orderTotalPence } from "../ball/pricing";
import {
  claimReservation,
  createPendingBooking,
  getAvailability,
  getCapacityState,
  releaseReservation,
} from "../db/ball";

// TASK-313: the public, read-only availability feed for the Festive Ball page.
// Deliberately returns ONLY counts — never a buyer name, email or booking reference — because
// it is unauthenticated. Mirrors the supporter ticker feed's shape (src/routes/ticker.ts).

export const ballRouter = Router();

ballRouter.get("/api/ball/availability", async (_req, res) => {
  try {
    const a = await getAvailability();
    res.json({
      totalSeats: a.totalSeats,
      seatsRemaining: a.seatsRemaining,
      tablesRemaining: a.tablesRemaining,
      soldOut: a.soldOut,
      salesOpen: a.salesOpen,
    });
  } catch (err) {
    console.error("ball availability failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Could not read availability" });
  }
});

// The reservation only has to cover the moments between "this order is possible" and "the
// pending booking exists". After that the booking holds the seats and Stripe's 30-minute
// session expiry releases them if the buyer walks away.
const RESERVATION_HOLD_MS = 2 * 60 * 1000;

ballRouter.post("/api/ball/checkout-session", async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid booking request", details: parsed.error.issues });
  }
  const purchase = parsed.data;

  let token: string | null = null;
  try {
    // 1. Are sales open at all? Checked before anything is held, so a closed ball never
    //    creates a reservation it would have to clean up.
    const avail = await getAvailability();
    if (!avail.salesOpen) {
      return res.status(409).json({ error: "Ticket sales are closed", soldOut: avail.soldOut });
    }

    // 2. Is there room for THIS order? Re-checked inside the lock below; this is the cheap
    //    early answer that gives the buyer a useful message.
    const state = await getCapacityState();
    if (!canFulfil(state, { kind: purchase.kind, quantity: purchase.quantity })) {
      return res.status(409).json({
        error:
          purchase.kind === "table"
            ? "There are not enough whole tables left for that booking"
            : "There are not enough seats left for that booking",
        seatsRemaining: avail.seatsRemaining,
        tablesRemaining: avail.tablesRemaining,
      });
    }

    // 3. Hold the seats. This is the serialised one: two people going for the last table at
    //    the same moment are ordered here, and the loser is refused rather than oversold.
    token = randomBytes(16).toString("hex");
    const held = await claimReservation(
      { kind: purchase.kind, quantity: purchase.quantity },
      token,
      RESERVATION_HOLD_MS,
    );
    if (!held) {
      token = null;
      return res.status(409).json({ error: "Those seats were taken while you were deciding" });
    }

    // 4. Mint the Stripe session.
    const seats = seatsFor({ kind: purchase.kind, quantity: purchase.quantity }, state.seatsPerTable);
    const reference = makeReference(randomBytes(8));
    const embedded = purchase.uiMode === "embedded" && Boolean(config.STRIPE_PUBLISHABLE_KEY);
    const params = buildBallSessionParams({
      purchase,
      reference,
      seats,
      baseUrl: config.BALL_BASE_URL,
      now: new Date(),
      embedded,
    });
    const session = await stripe.checkout.sessions.create(params);

    // 5. Record the pending booking, which takes over holding the seats, then drop the
    //    short-lived reservation so the two never double-count the same seats.
    const totals = orderTotalPence({
      order: { kind: purchase.kind, quantity: purchase.quantity },
      donationPence: purchase.donationPence,
      coverFee: purchase.coverFee,
    });
    await createPendingBooking({
      reference,
      kind: purchase.kind,
      quantity: purchase.quantity,
      seats,
      buyerName: purchase.buyerName,
      buyerEmail: purchase.buyerEmail,
      ticketsPence: totals.ticketsPence,
      donationPence: totals.donationPence,
      feeCoverPence: totals.feeCoverPence,
      totalPence: totals.totalPence,
      giftAid: purchase.giftAid,
      newsletterOptIn: purchase.newsletterOptIn,
      stripeSessionId: session.id,
    });
    await releaseReservation(token);
    token = null;

    const body: Record<string, unknown> = { reference, totalPence: totals.totalPence };
    if (embedded) {
      body.clientSecret = session.client_secret;
      body.publishableKey = config.STRIPE_PUBLISHABLE_KEY;
    } else {
      body.url = session.url;
    }
    return res.status(201).json(body);
  } catch (err) {
    console.error("ball checkout failed:", err instanceof Error ? err.message : err);
    return res.status(502).json({ error: "Could not start checkout" });
  } finally {
    // Any path that did not hand the seats over to a booking must give them back at once,
    // rather than leaving them held for the full window after a failure.
    if (token) await releaseReservation(token).catch(() => undefined);
  }
});

// Exported for the BDD stub-mode assertion: with no live Stripe key the client is a stub, so
// the endpoint still returns a well-formed session and the whole flow is exercised offline.
export const ballCheckoutUsesLiveStripe = (): boolean => stripeConfigured;
