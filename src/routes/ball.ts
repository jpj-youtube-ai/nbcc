import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { Router } from "express";
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
  getSettings,
  releaseReservation,
} from "../db/ball";
import {
  GATE_COOKIE,
  GATE_TTL_MS,
  isGateOpen,
  passwordMatches,
  readCookie,
  signGateToken,
  verifyGateToken,
} from "../ball/gate";
import { renderBallPage } from "../ball/page";
import { renderBallLockPage } from "../ball/lock-page";

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

// --- the page and its gate ---------------------------------------------------
//
// /ball is served by THIS router, never by the static site router, and there is deliberately
// no `_redirects` rule mapping /ball to ball.html: if there were, the file would be reachable
// directly and the gate would be decorative.

const SITE_ROOT = resolve(__dirname, "../..");

// Is this request allowed to see the page? Either the gate is open to everyone, or the caller
// is carrying a preview cookie they got by typing the password.
async function canView(req: express.Request): Promise<{ allowed: boolean; gateOpen: boolean }> {
  const settings = await getSettings();
  const gateOpen = isGateOpen(settings, new Date());
  if (gateOpen) return { allowed: true, gateOpen };
  const cookie = readCookie(req.headers.cookie, GATE_COOKIE);
  const allowed = cookie
    ? verifyGateToken(cookie, config.BALL_PREVIEW_PASSWORD, new Date())
    : false;
  return { allowed, gateOpen };
}

function servePage(res: express.Response, gateOpen: boolean, settings: {
  arrivalTime: string | null;
  includedNote: string | null;
  lineUpNote: string | null;
}): void {
  const file = join(SITE_ROOT, "ball.html");
  if (!existsSync(file)) {
    res.status(404).send("Not found");
    return;
  }
  const template = readFileSync(file, "utf8");
  res.type("html").send(renderBallPage(template, { settings, gateOpen }));
}

ballRouter.get("/ball", async (req, res, next) => {
  try {
    const settings = await getSettings();
    const gateOpen = isGateOpen(settings, new Date());
    if (!gateOpen) {
      const cookie = readCookie(req.headers.cookie, GATE_COOKIE);
      const unlocked = cookie
        ? verifyGateToken(cookie, config.BALL_PREVIEW_PASSWORD, new Date())
        : false;
      if (!unlocked) {
        // 401, not 200: this is an unauthenticated response, and it also stops any crawler
        // or link preview treating the lock screen as the page's content.
        res.status(401).type("html").send(renderBallLockPage());
        return;
      }
    }
    servePage(res, gateOpen, settings);
  } catch (err) {
    next(err);
  }
});

// The password post. Rate limiting is deliberately not added here: the gate protects an
// unfinished marketing page, not money or personal data, and the shared password is handed
// out freely to trustees and the sponsor.
ballRouter.post(
  "/ball/unlock",
  express.urlencoded({ extended: false }),
  (req, res) => {
    const attempt = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(config.BALL_PREVIEW_PASSWORD, attempt)) {
      res.status(401).type("html").send(renderBallLockPage({ error: true }));
      return;
    }
    res.cookie(GATE_COOKIE, signGateToken(config.BALL_PREVIEW_PASSWORD, new Date()), {
      httpOnly: true,
      sameSite: "lax",
      maxAge: GATE_TTL_MS,
      // Secure in production only, so local http development still works.
      secure: config.NODE_ENV === "production",
      path: "/",
    });
    res.redirect(303, "/ball");
  },
);

// The ticket terms. Gated alongside the page: while /ball is private there is nothing to
// agree to, and a public terms page would leak the event before the magazine lands.
ballRouter.get("/ball/terms", async (req, res, next) => {
  try {
    const { allowed } = await canView(req);
    if (!allowed) {
      res.status(401).type("html").send(renderBallLockPage());
      return;
    }
    const file = join(SITE_ROOT, "ball-terms.html");
    if (!existsSync(file)) {
      res.status(404).send("Not found");
      return;
    }
    res.sendFile(file);
  } catch (err) {
    next(err);
  }
});
