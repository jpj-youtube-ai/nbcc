import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { authorizeSection, authorizeSectionAsAdmin, loadEffectivePermissions } from "./admin-authz";
import { can } from "../admin/permissions";
import type { AdminSessionClaims } from "../admin/session";
import { fundraisingIsOn, getFundraiser } from "../db/fundraisers";
import {
  TicketError,
  addTypeByStaff,
  auditEmailResent,
  availabilityOf,
  beginRefund,
  cancelFreeBooking,
  closeFields,
  declineProposedClose,
  setSalesClose,
  declineProposedLimit,
  declineRefundRequest,
  editType,
  failRefund,
  getOrder,
  getTicketState,
  listOrders,
  listRefundRequests,
  listRefunds,
  listTicketedEvents,
  reconcileOrderRefunds,
  releaseTickets,
  setSalesClosed,
  setSalesLimit,
  setTypeStatus,
  ticketMoneyFor,
} from "../db/event-tickets";
import { closeOf } from "./event-tickets-close";
import { adminRefundSchema, checkCloseChoice, checkTicketTypes, flagWords, moneySplit, readSalesLimit, salesState, ticketsCsv, ticketsWords, typeEditSchema } from "../tickets/model";
import { pool } from "../db/pool";
import { sendBookingCancelledEmail, sendTicketConfirmation, sendTicketsReleasedEmail, tellAfterReconcile } from "../tickets/send";
import { listStripeRefunds, refundLite, withRefund } from "../tickets/refunds";
import { sendGuestList } from "../tickets/guest-list";

// Event tickets in Admin > Fundraising (the Event tickets card, assets/js/admin/event-tickets.js).
// Section "fundraising": viewers look; editors approve ticket types (staff approve all public
// content), set the limit and close or open sales; only an ADMIN refunds or declines a refund.
//
//   GET    /api/admin/event-tickets                                     every ticketed event, soonest first
//   GET    /api/admin/event-tickets/:id                                 one event: types, sold and limit,
//                                                                       money (tickets apart from gifts),
//                                                                       bookings, refund requests, refunds
//   POST   /api/admin/event-tickets/:id/types                           { name, pricePence, quantity? } add one on sale
//   PATCH  /api/admin/event-tickets/:id/types/:typeId                   { name?, pricePence?, quantity? }
//   POST   /api/admin/event-tickets/:id/types/:typeId/approve           put a proposed (or withdrawn) type on sale
//   POST   /api/admin/event-tickets/:id/types/:typeId/withdraw          take a type off sale (or decline it)
//   PUT    /api/admin/event-tickets/:id/limit                           { limit: number | null }
//   POST   /api/admin/event-tickets/:id/limit/approve                   use the organiser's proposed limit
//   POST   /api/admin/event-tickets/:id/limit/decline                   decline it
//   POST   /api/admin/event-tickets/:id/sales                           { open: boolean }
//   PUT    /api/admin/event-tickets/:id/close                           { ticketClose: start | day_before | custom,
//                                                                       ticketCloseAt? } when sales close
//   POST   /api/admin/event-tickets/:id/close/approve, .../decline      the host's proposed closing time
//   POST   /api/admin/event-tickets/:id/orders/:orderId/cancel          cancel a FREE booking (edit): the places
//                                                                       go back on sale and the buyer is emailed
//   GET    /api/admin/event-tickets/:id/guest-list                      the guest list to print
//   GET    /api/admin/event-tickets/:id/orders.csv                      every booking, with the buyer's details
//   POST   /api/admin/event-tickets/:id/orders/:orderId/release         { lines: [{ lineId, quantity, refundedQuantity }],
//                                                                       refundedPence } (admins): release tickets with
//                                                                       no money moving (free ones, or ones whose money
//                                                                       was refunded in Stripe itself)
//   POST   /api/admin/event-tickets/:id/orders/:orderId/resend          send the buyer's tickets email again (edit)
//   POST   /api/admin/event-tickets/:id/orders/:orderId/refund          { lines: [{ lineId, quantity, refundedQuantity }],
//                                                                       refundedPence, requestId?, note? } (admins): the
//                                                                       booking as the admin saw it; 409 if it has changed
//   POST   /api/admin/event-tickets/:id/requests/:requestId/decline     { note? } (admins)
//
// Every change is audited (src/db/event-tickets.ts). A refund is written down first (an intent, with
// its own idempotency key), then asked of Stripe with that key, then finished; the buyer is emailed
// once it is. A buyer's email and phone are only shown to someone who can edit fundraising: a viewer
// sees names and tickets.

export const adminEventTicketsRouter = Router();

const UNAVAILABLE = { error: "Admin is temporarily unavailable" };
const actorOf = (claims: AdminSessionClaims): string => `admin:${claims.email}`;

function numberParam(req: Request, res: Response, name: string): number | null {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return n;
}

function failed(res: Response, what: string, err: unknown): Response {
  if (err instanceof TicketError) return res.status(err.reason === "not_found" ? 404 : 409).json({ error: err.message, ...(err.reason === "stale" ? { refresh: true } : {}) });
  console.error(`admin event tickets ${what} failed:`, err instanceof Error ? err.message : err);
  return res.status(500).json(UNAVAILABLE);
}

async function eventOf(req: Request, res: Response) {
  const id = numberParam(req, res, "id");
  if (id === null) return null;
  const f = await getFundraiser(id);
  if (!f || f.path !== "event") {
    res.status(404).json({ error: "That event no longer exists" });
    return null;
  }
  return f;
}

/** May they see a buyer's email and phone? Editors and admins; someone who may only look sees names and tickets. */
async function seesContact(claims: AdminSessionClaims): Promise<boolean> {
  const perms = await loadEffectivePermissions(claims.sub);
  return perms !== null && can(perms, "fundraising", "edit");
}

export async function getAdminTicketEvents(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    return res.status(200).json({ events: await listTicketedEvents() });
  } catch (err) {
    return failed(res, "list", err);
  }
}

export async function getAdminEventTickets(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  try {
    const f = await eventOf(req, res);
    if (!f) return;
    const contact = await seesContact(claims);
    const [state, orders, requests, refunds, ticketPence, on] = await Promise.all([
      getTicketState(f.id),
      listOrders(f.id),
      listRefundRequests(f.id),
      listRefunds(f.id),
      ticketMoneyFor(f.id),
      fundraisingIsOn(),
    ]);
    const a = availabilityOf(state);
    const sold = (id: number) =>
      orders.filter((o) => o.status === "paid").reduce((n, o) => n + o.lines.filter((l) => l.typeId === id).reduce((m, l) => m + l.quantity - l.refundedQuantity, 0), 0);
    return res.status(200).json({
      event: { id: f.id, title: f.title, slug: f.slug, status: f.status, public: f.public, booking: f.booking, eventDate: f.eventDate, startTime: f.startTime },
      state: salesState({ ...f, ...closeFields(state.settings) }, { fundraisingOn: on, now: new Date(), onSale: a.onSale, soldOut: a.soldOut }),
      types: state.types.map((t) => ({ ...t, taken: state.taken[t.id] ?? 0, sold: sold(t.id) })),
      salesLimit: state.settings.salesLimit,
      proposedSalesLimit: state.settings.proposedSalesLimit,
      salesClosedAt: state.settings.salesClosedAt,
      close: closeOf(state.settings.salesCloseMode, state.settings.salesCloseAt),
      proposedClose: state.settings.proposedCloseMode ? closeOf(state.settings.proposedCloseMode, state.settings.proposedCloseAt) : null,
      salesClosedBy: state.settings.salesClosedBy,
      overallRemaining: a.overallRemaining,
      money: moneySplit(ticketPence, f.meter.raisedPence),
      contact,
      orders: orders.map((o) => ({
        ...o,
        email: contact ? o.email : null,
        phone: contact ? o.phone : null,
        tickets: ticketsWords(o.lines),
        free: o.totalPence === 0,
        flagWords: flagWords(o.flags),
        emailSent: o.emailSent !== false,
      })),
      requests,
      refunds,
    });
  } catch (err) {
    return failed(res, "read", err);
  }
}

async function editing(req: Request, res: Response): Promise<AdminSessionClaims | null> {
  return authorizeSection(req, res, "fundraising", "edit");
}

function typeStatus(status: "approved" | "withdrawn") {
  return async (req: Request, res: Response): Promise<Response | void> => {
    const claims = await editing(req, res);
    if (!claims) return;
    const id = numberParam(req, res, "id");
    const typeId = id === null ? null : numberParam(req, res, "typeId");
    if (id === null || typeId === null) return;
    try {
      return res.status(200).json({ type: await setTypeStatus(id, typeId, status, actorOf(claims)) });
    } catch (err) {
      return failed(res, `type ${status}`, err);
    }
  };
}

export const postApproveType = typeStatus("approved");
export const postWithdrawType = typeStatus("withdrawn");

export async function patchType(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const typeId = id === null ? null : numberParam(req, res, "typeId");
  if (id === null || typeId === null) return;
  const parsed = typeEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Please check the ticket." });
  try {
    return res.status(200).json({ type: await editType(id, typeId, parsed.data, actorOf(claims)) });
  } catch (err) {
    return failed(res, "type change", err);
  }
}

export async function postAddType(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  const checked = checkTicketTypes([req.body ?? {}]);
  if (Object.keys(checked.fields).length > 0) return res.status(400).json({ error: String(checked.fields.ticketTypes).replace(/^Ticket 1: /, "") });
  try {
    await addTypeByStaff(id, checked.types[0], actorOf(claims));
    return res.status(200).json({ status: "added" });
  } catch (err) {
    return failed(res, "type add", err);
  }
}

export async function putSalesLimit(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  const limit = readSalesLimit(req.body?.limit);
  if (limit === "bad") return res.status(400).json({ error: "The limit needs to be a whole number from 1 to 5,000, or empty for no limit." });
  try {
    await setSalesLimit(id, limit, actorOf(claims));
    return res.status(200).json({ status: "saved" });
  } catch (err) {
    return failed(res, "limit", err);
  }
}

export async function postApproveLimit(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  try {
    const state = await getTicketState(id);
    if (state.settings.proposedSalesLimit === null) return res.status(409).json({ error: "There is no limit waiting to be approved." });
    await setSalesLimit(id, state.settings.proposedSalesLimit, actorOf(claims), true);
    return res.status(200).json({ status: "approved" });
  } catch (err) {
    return failed(res, "limit approve", err);
  }
}

export async function postDeclineLimit(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  try {
    await declineProposedLimit(id, actorOf(claims));
    return res.status(200).json({ status: "declined" });
  } catch (err) {
    return failed(res, "limit decline", err);
  }
}

export async function postSales(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  if (typeof req.body?.open !== "boolean") return res.status(400).json({ error: "Say whether sales are open." });
  try {
    await setSalesClosed(id, !req.body.open, actorOf(claims));
    return res.status(200).json({ status: req.body.open ? "open" : "closed" });
  } catch (err) {
    return failed(res, "sales", err);
  }
}

/** Staff set when sales close (for an NBCC run event, or to correct the host's choice). */
export async function putSalesClose(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  try {
    const f = await eventOf(req, res);
    if (!f) return;
    const checked = checkCloseChoice(req.body ?? {}, { eventDate: f.eventDate, startTime: f.startTime }, new Date());
    if ("error" in checked) return res.status(400).json({ error: checked.error });
    await setSalesClose(f.id, checked.close, actorOf(claims));
    return res.status(200).json({ status: "saved", close: closeOf(checked.close.mode, checked.close.at) });
  } catch (err) {
    return failed(res, "close", err);
  }
}

export async function postApproveClose(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  try {
    await setSalesClose(id, null, actorOf(claims), true);
    return res.status(200).json({ status: "approved" });
  } catch (err) {
    return failed(res, "close approve", err);
  }
}

export async function postDeclineClose(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  if (id === null) return;
  try {
    await declineProposedClose(id, actorOf(claims));
    return res.status(200).json({ status: "declined" });
  } catch (err) {
    return failed(res, "close decline", err);
  }
}

/** Staff cancel a FREE booking: its places go back on sale and the buyer is told. A paid one is refunded. */
export async function postCancelFreeBooking(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const orderId = id === null ? null : numberParam(req, res, "orderId");
  if (id === null || orderId === null) return;
  try {
    const order = await cancelFreeBooking(id, orderId, actorOf(claims));
    await sendBookingCancelledEmail(order);
    return res.status(200).json({ status: "cancelled" });
  } catch (err) {
    return failed(res, "cancel", err);
  }
}

export async function getAdminGuestList(req: Request, res: Response): Promise<Response | void> {
  if (!(await authorizeSection(req, res, "fundraising", "view"))) return;
  try {
    const f = await eventOf(req, res);
    if (!f) return;
    return sendGuestList(res, f, await listOrders(f.id, { paidOnly: true }));
  } catch (err) {
    return failed(res, "guest list", err);
  }
}

export async function getAdminTicketsCsv(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSection(req, res, "fundraising", "view");
  if (!claims) return;
  try {
    const f = await eventOf(req, res);
    if (!f) return;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="tickets-${f.slug}.csv"`);
    // A byte order mark, so Excel reads the pound signs and accents as they are.
    return res.type("text/csv; charset=utf-8").send(BOM + ticketsCsv(await listOrders(f.id), { contact: await seesContact(claims) }));
  } catch (err) {
    return failed(res, "csv", err);
  }
}

// A byte order mark, so Excel reads the pound signs and accents as they are.
const BOM = String.fromCharCode(0xfeff);

/** The tickets email did not go when the payment landed: staff send it again. */
export async function postResendTickets(req: Request, res: Response): Promise<Response | void> {
  const claims = await editing(req, res);
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const orderId = id === null ? null : numberParam(req, res, "orderId");
  if (id === null || orderId === null) return;
  try {
    const order = await getOrder(pool, orderId);
    if (!order || order.fundraiserId !== id || order.status !== "paid") return res.status(404).json({ error: "We could not find that booking." });
    const sent = await sendTicketConfirmation(orderId);
    await auditEmailResent(orderId, actorOf(claims), sent);
    if (!sent) return res.status(502).json({ error: "The email could not be sent just now. Please try again in a few minutes." });
    return res.status(200).json({ status: "sent" });
  } catch (err) {
    return failed(res, "resend", err);
  }
}

// Stripe's errors that mean "we do not know": the request may or may not have reached it. Anything
// else it says is a definite no.
const STRIPE_UNKNOWN = new Set(["StripeConnectionError", "StripeAPIError", "StripeRateLimitError", "StripeIdempotencyError"]);
const UNREACHED = "We could not reach Stripe, so we do not know if the refund was made. Make the same refund again to finish it: it will not be paid twice.";
const UNFINISHED =
  "Stripe made the refund, but it could not be finished here. It will finish by itself when Stripe confirms it, or make the same refund again: it will not be paid twice.";
const UNCHECKED = "We could not check this booking's refunds with Stripe. Please try again in a few minutes.";

/**
 * An admin refunds tickets on a booking. Stripe is the source of truth for refunded money
 * (src/db/event-tickets.ts reconcileRefunds), so:
 *
 *   1. the booking is first brought in line with what Stripe has refunded on it (an earlier refund
 *      finished or let go, one made in Stripe itself recorded). If Stripe cannot be asked, nothing
 *      new is started;
 *   2. the refund is written down and committed (an intent, with its own key) BEFORE Stripe is asked;
 *   3. Stripe is asked, with that key: the same refund asked again is never paid twice;
 *   4. the booking is brought in line again, which finishes the refund Stripe has just made.
 *
 * Whatever fails on the way, any of Stripe's refund events runs the same reconcile and finishes it.
 * The buyer is emailed by whichever finishes it, once.
 */
export async function postAdminRefund(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const orderId = id === null ? null : numberParam(req, res, "orderId");
  if (id === null || orderId === null) return;
  const parsed = adminRefundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose which tickets to refund, from the booking as it is now. Refresh and try again." });
  try {
    const before = await reconcileOrderRefunds(orderId, listStripeRefunds);
    await tellAfterReconcile(orderId, before);
  } catch (err) {
    console.error(`admin event tickets refund: could not check order ${orderId} with Stripe:`, err instanceof Error ? err.message : err);
    return res.status(502).json({ error: UNCHECKED });
  }
  let intent: Awaited<ReturnType<typeof beginRefund>>;
  try {
    intent = await beginRefund(
      id,
      orderId,
      parsed.data.lines,
      { refundedPence: parsed.data.refundedPence },
      { actor: actorOf(claims), requestId: parsed.data.requestId ?? null, note: parsed.data.note ? parsed.data.note : null },
    );
  } catch (err) {
    return failed(res, "refund", err);
  }
  let made: ReturnType<typeof refundLite>;
  try {
    const { stripe } = await import("../clients/stripe");
    const r = await stripe.refunds.create(
      {
        payment_intent: intent.paymentIntentId,
        amount: intent.amountPence,
        reason: "requested_by_customer",
        metadata: { product: "event_tickets", orderReference: intent.reference, refundIntent: String(intent.id) },
      },
      { idempotencyKey: intent.key },
    );
    // It is this intent's refund whatever its metadata says back.
    made = { ...refundLite(r), intentId: intent.id };
  } catch (err) {
    const type = typeof err === "object" && err !== null ? String((err as { type?: unknown }).type ?? "") : "";
    const message = err instanceof Error ? err.message : String(err);
    console.error(`admin event tickets refund ${intent.id} (${intent.reference}): Stripe failed:`, message);
    if (!type || STRIPE_UNKNOWN.has(type)) return res.status(502).json({ error: UNREACHED });
    try {
      await failRefund(intent.id, message);
    } catch (failErr) {
      console.error("admin event tickets refund could not be closed as failed:", failErr instanceof Error ? failErr.message : failErr);
    }
    return res.status(502).json({ error: `Stripe did not make the refund: ${message}` });
  }
  // Stripe has answered: bring the booking in line with it. A succeeded refund is finished; one that
  // came back failed is closed and flagged; one still on its way is left for Stripe's own event.
  try {
    const after = await reconcileOrderRefunds(orderId, withRefund(listStripeRefunds, made));
    await tellAfterReconcile(orderId, after);
    if (made.status === "failed" || made.status === "canceled") {
      return res.status(502).json({ error: `Stripe could not make the refund (it came back ${made.status}). The buyer has not been paid back and no tickets were released.` });
    }
    if (made.status !== null && made.status !== "succeeded") {
      return res.status(200).json({
        status: "processing",
        amountPence: intent.amountPence,
        refundId: made.id,
        message: "Stripe has taken the refund and is still processing it. The booking will update, and the buyer be emailed, when Stripe confirms it.",
      });
    }
    const full = after.order ? after.order.lines.every((l) => l.refundedQuantity >= l.quantity) : after.full;
    return res.status(200).json({ status: "refunded", amountPence: intent.amountPence, full, refundId: made.id });
  } catch (err) {
    console.error(`admin event tickets refund ${intent.id} (${intent.reference}): Stripe refund ${made.id} could not be finished:`, err instanceof Error ? err.message : err);
    return res.status(500).json({ error: UNFINISHED });
  }
}


const releaseSchema = adminRefundSchema.pick({ lines: true, refundedPence: true });

/**
 * An admin releases tickets with no money moving: free tickets on a paid booking, or tickets whose
 * money was refunded in Stripe itself. The places go back on sale and the buyer is told which
 * tickets are cancelled.
 */
export async function postReleaseTickets(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const orderId = id === null ? null : numberParam(req, res, "orderId");
  if (id === null || orderId === null) return;
  const parsed = releaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose which tickets to release, from the booking as it is now. Refresh and try again." });
  try {
    const done = await releaseTickets(id, orderId, parsed.data.lines, { refundedPence: parsed.data.refundedPence }, actorOf(claims));
    await sendTicketsReleasedEmail(done.order, done.tickets);
    return res.status(200).json({ status: "released", tickets: done.tickets });
  } catch (err) {
    return failed(res, "release", err);
  }
}

const declineSchema = z.object({ note: z.string().trim().max(500).optional() });

export async function postDeclineRequest(req: Request, res: Response): Promise<Response | void> {
  const claims = await authorizeSectionAsAdmin(req, res, "fundraising");
  if (!claims) return;
  const id = numberParam(req, res, "id");
  const requestId = id === null ? null : numberParam(req, res, "requestId");
  if (id === null || requestId === null) return;
  const parsed = declineSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Keep the note to 500 characters or fewer." });
  try {
    await declineRefundRequest(id, requestId, actorOf(claims), parsed.data.note || null);
    return res.status(200).json({ status: "declined" });
  } catch (err) {
    return failed(res, "decline", err);
  }
}

adminEventTicketsRouter.get("/api/admin/event-tickets", getAdminTicketEvents);
adminEventTicketsRouter.get("/api/admin/event-tickets/:id", getAdminEventTickets);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/types", postAddType);
adminEventTicketsRouter.patch("/api/admin/event-tickets/:id/types/:typeId", patchType);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/types/:typeId/approve", postApproveType);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/types/:typeId/withdraw", postWithdrawType);
adminEventTicketsRouter.put("/api/admin/event-tickets/:id/limit", putSalesLimit);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/limit/approve", postApproveLimit);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/limit/decline", postDeclineLimit);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/sales", postSales);
adminEventTicketsRouter.put("/api/admin/event-tickets/:id/close", putSalesClose);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/close/approve", postApproveClose);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/close/decline", postDeclineClose);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/orders/:orderId/cancel", postCancelFreeBooking);
adminEventTicketsRouter.get("/api/admin/event-tickets/:id/guest-list", getAdminGuestList);
adminEventTicketsRouter.get("/api/admin/event-tickets/:id/orders.csv", getAdminTicketsCsv);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/orders/:orderId/refund", postAdminRefund);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/orders/:orderId/resend", postResendTickets);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/orders/:orderId/release", postReleaseTickets);
adminEventTicketsRouter.post("/api/admin/event-tickets/:id/requests/:requestId/decline", postDeclineRequest);
