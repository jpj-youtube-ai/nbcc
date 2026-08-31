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
import { guestSubmissionSchema, makeGuestToken } from "../ball/guests";
import { renderGuestNotFound, renderGuestPage } from "../ball/guest-page";
import { renderBallThankYou } from "../ball/thank-you-page";
import { getBookingByGuestToken, getBookingBySessionId, getPreviewPasswordHash, joinWaitingList, saveGuests } from "../db/ball";
import { verifyPassword } from "../admin/password";
import { checkboxValue, waitingListSchema } from "../ball/waiting-list";

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
      // So the "cover the card fee" checkbox quotes the live rate rather than a number
      // baked into the script at build time (TASK-317). Not sensitive: the page already
      // shows the resulting amount in pounds.
      cardFeePercentBp: a.cardFee.percentBp,
      cardFeeFixedPence: a.cardFee.fixedPence,
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
      cardFee: avail.cardFee,
    });
    const session = await stripe.checkout.sessions.create(params);

    // 5. Record the pending booking, which takes over holding the seats, then drop the
    //    short-lived reservation so the two never double-count the same seats.
    const totals = orderTotalPence({
      order: { kind: purchase.kind, quantity: purchase.quantity },
      donationPence: purchase.donationPence,
      coverFee: purchase.coverFee,
      cardFee: avail.cardFee,
    });
    await createPendingBooking({
      reference,
      kind: purchase.kind,
      quantity: purchase.quantity,
      seats,
      buyerName: purchase.buyerName,
      buyerFirstName: purchase.buyerFirstName,
      buyerSurname: purchase.buyerSurname,
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

// The gate's secret. Once staff set a password in the admin area we use its hash — for BOTH
// checking the password and signing the preview cookie. Signing with the hash means changing the
// password immediately invalidates every cookie issued under the old one, which is exactly what
// someone changing a shared password expects: it should lock out whoever they changed it because
// of. Falls back to the config value until a password has been set, so nothing breaks in between.
async function previewSecret(): Promise<{ hash: string | null; signingKey: string }> {
  const hash = await getPreviewPasswordHash();
  return { hash, signingKey: hash ?? config.BALL_PREVIEW_PASSWORD };
}

async function previewPasswordAccepted(attempt: string): Promise<string | null> {
  const { hash, signingKey } = await previewSecret();
  const ok = hash ? await verifyPassword(attempt, hash) : passwordMatches(config.BALL_PREVIEW_PASSWORD, attempt);
  return ok ? signingKey : null;
}

// Is this request allowed to see the page? Either the gate is open to everyone, or the caller
// is carrying a preview cookie they got by typing the password.
async function canView(req: express.Request): Promise<{ allowed: boolean; gateOpen: boolean }> {
  const settings = await getSettings();
  const gateOpen = isGateOpen(settings, new Date());
  if (gateOpen) return { allowed: true, gateOpen };
  const cookie = readCookie(req.headers.cookie, GATE_COOKIE);
  const { signingKey } = await previewSecret();
  const allowed = cookie ? verifyGateToken(cookie, signingKey, new Date()) : false;
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
      const { signingKey } = await previewSecret();
      const unlocked = cookie ? verifyGateToken(cookie, signingKey, new Date()) : false;
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
  async (req, res) => {
    const attempt = typeof req.body?.password === "string" ? req.body.password : "";
    const signingKey = await previewPasswordAccepted(attempt);
    if (!signingKey) {
      res.status(401).type("html").send(renderBallLockPage({ error: true }));
      return;
    }
    res.cookie(GATE_COOKIE, signGateToken(signingKey, new Date()), {
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

// --- guest details (plan 5) --------------------------------------------------
//
// Reached from a link in the booking email, on a phone, with no login. The token is the whole
// authorisation: 24 random bytes on a paid booking. That is a deliberate trade — requiring an
// account to report a nut allergy means nobody reports the nut allergy — and the blast radius
// of a leaked link is one table's names, not money or an account.
//
// NOT gated behind the launch gate: someone who has paid must be able to complete their table
// whatever the public page is doing.

// The form posts flat fields (fullName1, dietary1, …) because it is a plain HTML form with no
// JavaScript to build a nested body. Fold them back into the shape the schema expects, dropping
// any row the booker left entirely blank — a half-filled table is the expected case, not an error.
function guestsFromForm(body: Record<string, unknown>, seats: number) {
  const rows = [];
  for (let n = 1; n <= seats; n += 1) {
    const fullName = typeof body[`fullName${n}`] === "string" ? String(body[`fullName${n}`]).trim() : "";
    if (!fullName) continue;
    rows.push({
      fullName,
      dietary: typeof body[`dietary${n}`] === "string" ? String(body[`dietary${n}`]) : "",
      accessNeeds: typeof body[`accessNeeds${n}`] === "string" ? String(body[`accessNeeds${n}`]) : "",
    });
  }
  return rows;
}

ballRouter.get("/ball/guests/:token", async (req, res, next) => {
  try {
    const found = await getBookingByGuestToken(req.params.token);
    if (!found) {
      res.status(404).type("html").send(renderGuestNotFound());
      return;
    }
    res.type("html").send(
      renderGuestPage({
        booking: found.booking,
        guests: found.guests,
        token: req.params.token,
        saved: req.query.saved === "1",
      }),
    );
  } catch (err) {
    next(err);
  }
});

ballRouter.post(
  "/ball/guests/:token",
  express.urlencoded({ extended: false }),
  async (req, res, next) => {
    try {
      const found = await getBookingByGuestToken(req.params.token);
      if (!found) {
        res.status(404).type("html").send(renderGuestNotFound());
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const guests = guestsFromForm(body, found.booking.seats);

      // Clearing the table entirely is a legitimate action (a booker fixing a mistake), so an
      // empty list saves rather than erroring — the schema's min(1) guards the API, not this form.
      if (guests.length === 0) {
        await saveGuests(found.id, { tableName: null, guests: [] });
        res.redirect(303, `/ball/guests/${encodeURIComponent(req.params.token)}?saved=1`);
        return;
      }

      const parsed = guestSubmissionSchema.safeParse({
        tableName: typeof body.tableName === "string" ? body.tableName : "",
        guests,
      });
      if (!parsed.success) {
        res.status(400).type("html").send(
          renderGuestPage({
            booking: found.booking,
            guests: found.guests,
            token: req.params.token,
            error:
              "We couldn't save that. Check that every guest you've listed has a name, and that " +
              "the notes aren't too long.",
          }),
        );
        return;
      }

      await saveGuests(found.id, parsed.data);
      // Redirect after post, so a refresh does not resubmit the table.
      res.redirect(303, `/ball/guests/${encodeURIComponent(req.params.token)}?saved=1`);
    } catch (err) {
      next(err);
    }
  },
);

// Exported for the webhook: minted when a booking is paid so the confirmation email can carry
// the link.
export function newGuestToken(): string {
  return makeGuestToken(randomBytes(24));
}

// POST /api/ball/waiting-list — join the list when the ball is full. Public and unauthenticated,
// like the checkout. Deliberately NOT gated on availability: a race where the last seat sells
// between the page loading and the form submitting should still capture the person, not throw
// them away.
ballRouter.post("/api/ball/waiting-list", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = waitingListSchema.safeParse({
    firstName: body.firstName,
    surname: body.surname,
    email: body.email,
    seatsWanted: body.seatsWanted ?? 1,
    note: body.note ?? "",
    // Normalise the checkbox first: z.coerce.boolean() reads ANY non-empty string as true, so
    // an "off" value would silently opt someone into marketing.
    newsletterOptIn: checkboxValue(body.newsletterOptIn),
  });
  if (!parsed.success) {
    return res.status(400).json({ error: "Please check your name and email address." });
  }
  try {
    const { added } = await joinWaitingList(parsed.data);
    return res.status(added ? 201 : 200).json({
      added,
      message: added
        ? "You're on the list. We'll email you if a place comes up."
        : "You're already on the list — we've updated your details.",
    });
  } catch (err) {
    console.error("ball waiting list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Could not add you to the list. Please try again." });
  }
});

// Where Stripe returns a buyer the instant payment succeeds. Deliberately NOT behind the launch
// gate: someone who has just handed over £1,000 must see confirmation whatever the public page
// is doing. A missing or unknown session id still renders a success page — Stripe only redirects
// here on success, and telling a paying customer "something went wrong" because our own lookup
// came up short would be both wrong and alarming.
ballRouter.get("/ball/thank-you", async (req, res) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  let booking = null;
  try {
    if (sessionId) booking = await getBookingBySessionId(sessionId);
  } catch (err) {
    console.error("ball thank-you lookup failed:", err instanceof Error ? err.message : err);
  }
  res.type("html").send(renderBallThankYou(booking));
});
