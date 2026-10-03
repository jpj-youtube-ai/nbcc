import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import type { ZodIssue } from "zod";
import { createRateLimiter } from "../portal/request-limiter";
import { captchaEnabled, verifyCaptcha } from "../clients/turnstile";
import { config } from "../config";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import {
  TicketError,
  attachSession,
  availabilityOf,
  cancelFreeBooking,
  cancelPendingOrder,
  closeFields,
  confirmFreeOrder,
  createRefundRequest,
  getTicketState,
  listOrders,
  openOrdersOfBuyer,
  supersedeOrder,
  listRefundRequests,
  proposeTickets,
  reserveOrder,
  ticketMoneyFor,
} from "../db/event-tickets";
import { getCardFeeRate } from "../db/ball";
import { DEFAULT_CARD_FEE, type CardFeeRate } from "../ball/pricing";
import { hasPage, type FundraiserRecord } from "../fundraising/model";
import {
  TICKETS_BOOKING,
  checkTicketProposal,
  checkoutSchema,
  isFreeOrder,
  guestList,
  makeTicketReference,
  moneySplit,
  refundRequestSchema,
  salesState,
  ticketsWords,
} from "../tickets/model";
import { buildTicketSessionParams } from "../tickets/checkout";
import { closeOf } from "./event-tickets-close";
import { whenWords } from "../tickets/emails";
import { sendGuestList } from "../tickets/guest-list";
import { sendBookingCancelledEmail, sendRefundRequestStaffEmail, sendTicketConfirmation, sendTicketsProposedStaffEmail } from "../tickets/send";
import { fromOurOwnPage, ownFundraiser, signedIn } from "./fundraise";

// Event tickets (Jaimie, points 23 and 24): buying, and the organiser's part of their private area.
//
//   GET  /api/event-tickets/:id                  what is left, for the page to refresh after a refusal
//   POST /api/event-tickets/:id/checkout         { lines: [{ typeId, quantity }], firstName, lastName,
//                                                email, phone?, coverFee }: reserves the places (an
//                                                hour) and opens a Stripe checkout; { url }
//
// The private area (signed in with an emailed code, src/routes/fundraise.ts), for an event selling
// tickets through NBCC:
//   GET  /api/fundraise/manage/fundraisers/:id/tickets               the types, where each is up to, the
//                                                                    money (tickets apart from gifts),
//                                                                    the bookings (names and tickets
//                                                                    only) and the refund requests
//   POST /api/fundraise/manage/fundraisers/:id/tickets/propose       { ticketTypes?, ticketLimit? }: new
//                                                                    types and a limit, for staff to approve
//   POST /api/fundraise/manage/fundraisers/:id/tickets/bookings/:orderId/cancel  cancel a FREE booking:
//                                                                    its places go back on sale and
//                                                                    the buyer is emailed
//   POST /api/fundraise/manage/fundraisers/:id/tickets/refund-request  { orderId, reason }: staff are
//                                                                    told; only an admin can refund
//   GET  /api/fundraise/manage/fundraisers/:id/tickets/guest-list    the guest list to print
//
// Every POST is refused unless it comes from our own page. A buyer's email and phone never reach
// the organiser: names, tickets and references only.

export const eventTicketsRouter = Router();

const NOT_FOUND = { error: "Not found" };
const TOO_MANY = { error: "Too many tries. Please wait a few minutes and try again." };
const CHECK = "Some of the form needs another look";

// Opening a checkout: 10 in 10 minutes from one address. Proposals and requests: 20 in 15 for one organiser.
const checkoutLimiter = createRateLimiter({ max: 10, windowMs: 10 * 60_000 });
const organiserLimiter = createRateLimiter({ max: 20, windowMs: 15 * 60_000 });

/** As the sign up and private area: only the box itself (local development, the BDD suite) is exempt. */
function isLoopbackRequest(req: Request): boolean {
  const ip = req.ip ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function fieldErrors(issues: ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

function idOf(req: Request): number | null {
  const raw = String(req.params.id ?? "");
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

async function cardFee(): Promise<CardFeeRate> {
  try {
    return await getCardFeeRate();
  } catch (err) {
    console.error("card fee rate read failed, using default:", err instanceof Error ? err.message : err);
    return DEFAULT_CARD_FEE;
  }
}

/** An event selling tickets through NBCC with a public page, or null (it reads as not there). */
async function sellingEvent(id: number | null): Promise<(FundraiserRecord & { meter: { raisedPence: number } }) | null> {
  if (id === null || !(await fundraisingIsOn())) return null;
  const f = await getFundraiser(id);
  if (!f || !hasPage(f) || f.path !== "event" || f.booking !== TICKETS_BOOKING || f.inMemory) return null;
  // All the ticket money must come to NBCC: never for an event that shares with another cause.
  if (f.sharesWithOther === true) return null;
  return f;
}

const NO_BOOKINGS = { error: "We can't take bookings just now. Please try again in a few minutes." };

/**
 * Close and cancel the same buyer's older open checkouts for this event. Best effort, one by one.
 * Each is closed at Stripe FIRST, then cancelled only if that checkout is still the one it has: an
 * order is never cancelled here while a checkout nobody closed could still be paid on it.
 */
async function supersedeOlder(fundraiserId: number, email: string, ipHash: string | null): Promise<void> {
  const older = await openOrdersOfBuyer(fundraiserId, email, ipHash);
  if (older.length === 0) return;
  const { stripe } = await import("../clients/stripe");
  for (const o of older) {
    try {
      if (o.sessionId) await stripe.checkout.sessions.expire(o.sessionId);
      await supersedeOrder(o.id, o.sessionId);
    } catch (err) {
      // Stripe will not close it (it has just been paid, or is being): it stands, and counts.
      console.error("event tickets could not close an older checkout:", err instanceof Error ? err.message : err);
    }
  }
}

// --- buying --------------------------------------------------------------------------------------------

export async function getTicketAvailability(req: Request, res: Response): Promise<Response> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const f = await sellingEvent(idOf(req));
    if (!f) return res.status(404).json(NOT_FOUND);
    const state = await getTicketState(f.id);
    const a = availabilityOf(state);
    const sales = salesState({ ...f, ...closeFields(state.settings) }, { fundraisingOn: true, now: new Date(), onSale: a.onSale, soldOut: a.soldOut });
    return res.status(200).json({ state: sales, types: a.types, overallRemaining: a.overallRemaining });
  } catch (err) {
    console.error("event tickets availability failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Tickets are temporarily unavailable" });
  }
}

export async function postTicketCheckout(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  res.setHeader("Cache-Control", "no-store");
  // Honeypot: a real browser never fills the hidden `company` box. Nothing is reserved.
  if (typeof req.body?.company === "string" && req.body.company.trim() !== "") return res.status(400).json({ error: CHECK, fields: {} });
  if (!isLoopbackRequest(req) && !checkoutLimiter.allow(req.ip ?? "unknown", Date.now())) return res.status(429).json(TOO_MANY);
  const parsed = checkoutSchema.safeParse(req.body);
  const fields = parsed.success ? {} : fieldErrors(parsed.error.issues);
  if (parsed.success && parsed.data.lines.length === 0) fields.lines = "Choose how many tickets you would like.";
  if (!parsed.success || Object.keys(fields).length > 0) {
    if (!fields.lines && Array.isArray(req.body?.lines) && !req.body.lines.some((l: { quantity?: unknown }) => Number(l?.quantity) > 0)) {
      fields.lines = "Choose how many tickets you would like.";
    }
    return res.status(400).json({ error: CHECK, fields });
  }
  const body = parsed.data;
  let reserved: Awaited<ReturnType<typeof reserveOrder>>;
  let f: Awaited<ReturnType<typeof sellingEvent>>;
  try {
    f = await sellingEvent(idOf(req));
    if (!f) return res.status(404).json(NOT_FOUND);
    // Is there nothing to pay? Read from the stored prices, never the ones the page sent.
    const prices = new Map((await getTicketState(f.id)).types.map((t) => [t.id, t.pricePence]));
    const allFree = body.lines.every((l) => prices.get(l.typeId) === 0);
    // The spam check (Turnstile). For a paid order, as on the sign up form: a refused pass reserves
    // nothing; a check that cannot answer lets the buyer through and logs why (paying is its own
    // brake). A FREE booking costs nothing to make, so there the check must be on and must pass: if
    // it cannot be reached, or is not set up in production, the booking is refused (it fails closed).
    if (captchaEnabled()) {
      const verdict = await verifyCaptcha(req.body?.captchaToken, req.ip);
      if (verdict.outcome === "refused") return res.status(400).json({ error: "captcha" });
      if (verdict.outcome === "unavailable") {
        if (allFree) return res.status(503).json(NO_BOOKINGS);
        console.error("event tickets captcha unavailable, checkout allowed:", verdict.reason);
      }
    } else if (allFree && config.NODE_ENV === "production") {
      console.error("event tickets: a free booking was refused because the spam check is not set up");
      return res.status(503).json(NO_BOOKINGS);
    }
    // A hash, never the address itself. The box itself is not capped (as it is not rate limited).
    const ipHash = isLoopbackRequest(req) || !req.ip ? null : createHash("sha256").update(`event-tickets:${req.ip}`).digest("hex");
    // An honest buyer who went back and started again (the same email from the same address): their
    // older open checkouts for this event are closed at Stripe and cancelled, so they are never
    // refused for their own. One Stripe will not close may be paying this second: it is left alone.
    await supersedeOlder(f.id, body.email, ipHash);
    reserved = await reserveOrder({
      fundraiserId: f.id,
      fundraisingOn: true,
      lines: body.lines,
      buyer: { firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone },
      coverFee: body.coverFee,
      cardFee: await cardFee(),
      newReference: () => makeTicketReference(randomBytes(6)),
      ipHash,
      now: new Date(),
    });
  } catch (err) {
    console.error("event tickets reserve failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not start your booking just now. Please try again in a few minutes." });
  }
  if (!reserved.ok) return res.status(reserved.tooMany ? 429 : 409).json({ error: reserved.problem, refresh: true });
  const order = reserved.order;
  // A free booking (every ticket £0): nothing to pay, so it never goes to Stripe. It was reserved
  // under the same lock, limits and caps; it is booked at once, emailed, and sent to the thank you.
  if (isFreeOrder(order.money)) {
    try {
      const token = `cs_free_${randomBytes(16).toString("hex")}`;
      if (!(await confirmFreeOrder(order.id, token))) throw new Error("the free order was not pending");
      await sendTicketConfirmation(order.id);
      return res.status(200).json({ url: `/event/${f.slug}?tickets=thanks&ticket_session=${token}`, free: true });
    } catch (err) {
      console.error("event tickets free booking failed:", err instanceof Error ? err.message : err);
      try {
        await cancelPendingOrder(order.id);
      } catch {
        // The five minute hold gives the places back anyway.
      }
      return res.status(500).json({ error: "We could not make your booking just now. Please try again in a few minutes." });
    }
  }
  try {
    const { stripe } = await import("../clients/stripe");
    const params = buildTicketSessionParams({
      order,
      event: { id: f.id, title: f.title, slug: f.slug, when: whenWords({ eventDate: f.eventDate, startTime: f.startTime, endTime: f.endTime ?? null, timeTbc: f.timeTbc ?? false }) },
      buyerEmail: body.email,
      baseUrl: config.PORTAL_BASE_URL,
      now: new Date(),
    });
    // One checkout per order, whatever happens to this request.
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `event-tickets-${order.reference}` });
    // A hold that ran out while Stripe was being asked is never brought back: its places may be
    // someone else's by now. The checkout just opened is closed, and the buyer starts again.
    if (!(await attachSession(order.id, session.id))) {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error("event tickets could not close a late checkout:", expireErr instanceof Error ? expireErr.message : expireErr);
      }
      await cancelPendingOrder(order.id);
      return res.status(409).json({ error: "Sorry, that took too long and your tickets were released. Please try again.", refresh: true });
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("event tickets checkout failed:", err instanceof Error ? err.message : err);
    try {
      await cancelPendingOrder(order.id);
    } catch (cancelErr) {
      // The hour's hold gives the places back anyway.
      console.error("event tickets cancel after failed checkout failed:", cancelErr instanceof Error ? cancelErr.message : cancelErr);
    }
    return res.status(502).json({ error: "Card payments are not working just now. Please try again in a few minutes." });
  }
}

// --- the organiser's private area ----------------------------------------------------------------------

async function organiserEvent(req: Request, res: Response) {
  const s = await signedIn(req, res);
  if (!s) return null;
  const f = await ownFundraiser(req, res, s);
  if (!f) return null;
  if (f.path !== "event") {
    res.status(404).json(NOT_FOUND);
    return null;
  }
  return { s, f };
}

const TYPE_WORDS: Record<string, string> = { proposed: "Waiting for us to approve", approved: "On sale", withdrawn: "Not on sale" };

export async function getManageTickets(req: Request, res: Response): Promise<Response | void> {
  res.setHeader("Cache-Control", "no-store");
  try {
    const own = await organiserEvent(req, res);
    if (!own) return;
    const { f } = own;
    const [state, orders, requests, ticketPence] = await Promise.all([getTicketState(f.id), listOrders(f.id, { paidOnly: true }), listRefundRequests(f.id), ticketMoneyFor(f.id)]);
    if (f.booking !== TICKETS_BOOKING && state.types.length === 0 && orders.length === 0) return res.status(404).json(NOT_FOUND);
    const a = availabilityOf(state);
    const sales = salesState({ ...f, ...closeFields(state.settings) }, { fundraisingOn: true, now: new Date(), onSale: a.onSale, soldOut: a.soldOut });
    const open = new Set(requests.filter((r) => r.status === "open").map((r) => r.orderId));
    return res.status(200).json({
      selling: f.booking === TICKETS_BOOKING,
      state: sales,
      types: state.types.map((t) => ({
        id: t.id,
        name: t.name,
        pricePence: t.pricePence,
        quantity: t.quantity,
        status: t.status,
        statusWords: TYPE_WORDS[t.status],
        taken: state.taken[t.id] ?? 0,
      })),
      salesLimit: state.settings.salesLimit,
      proposedSalesLimit: state.settings.proposedSalesLimit,
      // When sales close, as approved, and the organiser's choice still waiting for us.
      close: closeOf(state.settings.salesCloseMode, state.settings.salesCloseAt),
      proposedClose: state.settings.proposedCloseMode ? closeOf(state.settings.proposedCloseMode, state.settings.proposedCloseAt) : null,
      money: moneySplit(ticketPence, f.meter.raisedPence),
      sold: guestList(orders).totalTickets,
      bookings: orders.map((o) => ({
        id: o.id,
        reference: o.reference,
        name: `${o.firstName} ${o.surname}`,
        tickets: ticketsWords(o.lines),
        count: o.lines.reduce((n, l) => n + Math.max(0, l.quantity - l.refundedQuantity), 0),
        refunded: o.totalPence > 0 && o.refundedPence >= o.totalPence,
        requested: open.has(o.id),
        // Nothing was paid: the organiser can cancel it themselves (a paid one is refunded by NBCC).
        ...(o.totalPence === 0 ? { free: true } : {}),
      })),
      requests: requests.map((r) => ({ id: r.id, reference: r.reference, buyerName: r.buyerName, reason: r.reason, status: r.status, requestedAt: r.requestedAt })),
      guestListUrl: `/api/fundraise/manage/fundraisers/${f.id}/tickets/guest-list`,
    });
  } catch (err) {
    console.error("event tickets private area read failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "Your tickets are temporarily unavailable" });
  }
}

export async function postManageTicketProposal(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  try {
    const own = await organiserEvent(req, res);
    if (!own) return;
    const { s, f } = own;
    if (f.status === "finished") return res.status(410).json({ error: "Your event is finished. To change anything, get in touch." });
    if (f.booking !== TICKETS_BOOKING) {
      return res.status(409).json({ error: "First ask us to change How do people get in? to NBCC sells the tickets for me, under Change your page." });
    }
    if (!isLoopbackRequest(req) && !organiserLimiter.allow(s.email, Date.now())) return res.status(429).json(TOO_MANY);
    const state = await getTicketState(f.id);
    const checked = checkTicketProposal(
      req.body,
      state.types.filter((t) => t.status !== "withdrawn").map((t) => t.name),
      { eventDate: f.eventDate, startTime: f.startTime },
      new Date(),
    );
    if (Object.keys(checked.fields).length > 0) return res.status(400).json({ error: CHECK, fields: checked.fields });
    await proposeTickets(f.id, checked.types, checked.salesLimit, s.email, checked.close);
    await sendTicketsProposedStaffEmail(f, checked.types, checked.salesLimit, checked.close);
    return res.status(202).json({ status: "waiting", message: "Thank you. We will check your tickets and put them on sale, usually within a few days." });
  } catch (err) {
    console.error("event tickets proposal failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not send that just now. Please try again in a few minutes." });
  }
}

export async function postManageRefundRequest(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  try {
    const own = await organiserEvent(req, res);
    if (!own) return;
    const { s, f } = own;
    const parsed = refundRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: CHECK, fields: fieldErrors(parsed.error.issues) });
    if (!isLoopbackRequest(req) && !organiserLimiter.allow(s.email, Date.now())) return res.status(429).json(TOO_MANY);
    const made = await createRefundRequest(f.id, parsed.data.orderId, parsed.data.reason, s.email);
    await sendRefundRequestStaffEmail(f, made.order, parsed.data.reason);
    return res.status(202).json({
      status: "asked",
      message: "Thank you. We have asked our team to look at this refund. Only NBCC can make it, and we will let the buyer know.",
    });
  } catch (err) {
    if (err instanceof TicketError) return res.status(err.reason === "not_found" ? 404 : 409).json({ error: err.message });
    console.error("event tickets refund request failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not send that just now. Please try again in a few minutes." });
  }
}

/** The organiser cancels a FREE booking: its places go back on sale and the buyer is told. */
export async function postManageCancelBooking(req: Request, res: Response): Promise<Response | void> {
  if (!fromOurOwnPage(req, res)) return;
  try {
    const own = await organiserEvent(req, res);
    if (!own) return;
    const raw = String(req.params.orderId ?? "");
    const orderId = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(orderId)) return res.status(404).json(NOT_FOUND);
    if (!isLoopbackRequest(req) && !organiserLimiter.allow(own.s.email, Date.now())) return res.status(429).json(TOO_MANY);
    const order = await cancelFreeBooking(own.f.id, orderId, `organiser:${own.s.email}`);
    await sendBookingCancelledEmail(order);
    return res.status(200).json({ status: "cancelled", message: "That booking is cancelled. We have emailed them, and the tickets are back on sale." });
  } catch (err) {
    if (err instanceof TicketError) return res.status(err.reason === "not_found" ? 404 : 409).json({ error: err.message });
    console.error("event tickets cancel booking failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "We could not cancel that just now. Please try again in a few minutes." });
  }
}

export async function getManageGuestList(req: Request, res: Response): Promise<Response | void> {
  try {
    const own = await organiserEvent(req, res);
    if (!own) return;
    return sendGuestList(res, own.f, await listOrders(own.f.id, { paidOnly: true }));
  } catch (err) {
    console.error("event tickets guest list failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ error: "The guest list is temporarily unavailable" });
  }
}

eventTicketsRouter.get("/api/event-tickets/:id", getTicketAvailability);
eventTicketsRouter.post("/api/event-tickets/:id/checkout", postTicketCheckout);
eventTicketsRouter.get("/api/fundraise/manage/fundraisers/:id/tickets", getManageTickets);
eventTicketsRouter.post("/api/fundraise/manage/fundraisers/:id/tickets/propose", postManageTicketProposal);
eventTicketsRouter.post("/api/fundraise/manage/fundraisers/:id/tickets/refund-request", postManageRefundRequest);
eventTicketsRouter.get("/api/fundraise/manage/fundraisers/:id/tickets/guest-list", getManageGuestList);
eventTicketsRouter.post("/api/fundraise/manage/fundraisers/:id/tickets/bookings/:orderId/cancel", postManageCancelBooking);
