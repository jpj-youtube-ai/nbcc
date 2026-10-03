import { config } from "../config";
import { sendEventTickets } from "../clients/email";
import { getFundraiser } from "../db/fundraisers";
import { claimUnsentConfirmations, deleteOldBuyerPhones, getOrder, markConfirmationSent, type OrderFull } from "../db/event-tickets";
import { pool } from "../db/pool";
import { pageUrlFor } from "../fundraising/page-url";
import type { FundraiserRecord } from "../fundraising/model";
import {
  buildBookingCancelledEmail,
  buildOrderFlagStaffEmail,
  buildRefundRequestStaffEmail,
  buildTicketConfirmationEmail,
  buildTicketRefundEmail,
  buildTicketsProposedStaffEmail,
  buildTicketsReleasedEmail,
  buildUnknownPaymentStaffEmail,
  type TicketEmailEvent,
} from "./emails";
import { closeWords, pounds, ticketsWords, type ProposedType } from "./model";

// Event tickets: sending the emails (built by ./emails.ts). Each is best effort and runs after its
// write has committed, like every other email on the site: a paid order, a refund or a request
// stands whether or not its email goes, and a failed send is logged, never thrown. From and
// Reply-To are the events inbox (config.BALL_FROM_EMAIL, events@nbcc.scot), the APEX domain; the
// staff emails go TO that inbox with Reply-To the organiser.

const base = () => config.PORTAL_BASE_URL.replace(/\/+$/, "");
const adminUrl = () => `${base()}/admin`;
const events = () => ({ from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL });

function logFailure(what: string, err: unknown): void {
  console.error(`event tickets ${what} email failed:`, err instanceof Error ? err.message : err);
}

/** Where, in full: the venue, then its address and postcode unless the address already says them. */
export function whereOf(f: Pick<FundraiserRecord, "venue" | "town" | "venueAddress" | "venuePostcode">): string {
  const address = (f.venueAddress ?? "").trim();
  const postcode = (f.venuePostcode ?? "").trim();
  const venue = (f.venue ?? "").trim();
  const parts = [venue, address || (f.town ?? "").trim()].filter(Boolean);
  if (venue && address.toLowerCase().includes(venue.toLowerCase())) parts.shift();
  let where = parts.join(", ");
  const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  if (postcode && !squash(where).includes(squash(postcode))) where = where ? `${where}, ${postcode}` : postcode;
  return where;
}

export function ticketEmailEvent(f: FundraiserRecord): TicketEmailEvent {
  return {
    title: f.title,
    eventDate: f.eventDate,
    startTime: f.startTime,
    endTime: f.endTime ?? null,
    timeTbc: f.timeTbc ?? false,
    where: whereOf(f),
    organisedBy: f.creditName || f.name.split(" ")[0] || "the organiser",
    pageUrl: pageUrlFor(f),
  };
}

/**
 * The buyer's tickets, once the webhook has committed the payment. Stamped when it goes
 * (confirmation_sent_at): an order left unstamped shows "Tickets email not sent" in the admin, where
 * staff can send it again, and the daily task sends it too (resendUnsentTicketEmails). True if it went.
 */
export async function sendTicketConfirmation(orderId: number): Promise<boolean> {
  try {
    const order = await getOrder(pool, orderId);
    if (!order || order.status !== "paid") return false;
    const f = await getFundraiser(order.fundraiserId);
    if (!f) return false;
    const mail = buildTicketConfirmationEmail(ticketEmailEvent(f), order);
    await sendEventTickets("eventTickets", `${order.firstName} ${order.surname}`, { email: order.email, ...events(), ...mail });
    await markConfirmationSent(orderId);
    return true;
  } catch (err) {
    logFailure("confirmation", err);
    return false;
  }
}

/** The daily task: every paid order whose tickets email never went, each claimed and sent once a run. */
export async function resendUnsentTicketEmails(): Promise<{ tried: number; sent: number }> {
  const ids = await claimUnsentConfirmations();
  let sent = 0;
  for (const id of ids) if (await sendTicketConfirmation(id)) sent += 1;
  return { tried: ids.length, sent };
}

/** The daily task: buyers' phone numbers go 90 days after their event. */
export async function deleteBuyerPhonesPastTheirTime(): Promise<number> {
  return deleteOldBuyerPhones();
}

/** To the events inbox: a booking that needs a look (paid late and over the limit, a wrong amount, a dispute). */
export async function sendOrderFlagStaffEmail(orderId: number, flags: string[]): Promise<void> {
  try {
    const order = await getOrder(pool, orderId);
    if (!order || flags.length === 0) return;
    const f = await getFundraiser(order.fundraiserId);
    if (!f) return;
    const mail = buildOrderFlagStaffEmail(
      { title: f.title },
      { reference: order.reference, buyerName: `${order.firstName} ${order.surname}`, tickets: ticketsWords(order.lines), paid: pounds(order.totalPence) },
      flags,
      { adminUrl: adminUrl() },
    );
    await sendEventTickets("eventTicketsToCheck", null, { email: config.BALL_FROM_EMAIL, ...events(), ...mail });
  } catch (err) {
    logFailure("booking to check", err);
  }
}

async function sendRefundEmail(order: OrderFull, amountPence: number, full: boolean): Promise<void> {
  const f = await getFundraiser(order.fundraiserId);
  if (!f) return;
  const mail = buildTicketRefundEmail(ticketEmailEvent(f), {
    reference: order.reference,
    firstName: order.firstName,
    amountPence,
    full,
    standing: ticketsWords(order.lines),
  });
  await sendEventTickets("eventTicketsRefund", `${order.firstName} ${order.surname}`, { email: order.email, ...events(), ...mail });
}

/** The buyer's refund email, once a refund is recorded here (reconcileRefunds found Stripe had made it). */
export async function sendRefundRecordedEmail(orderId: number, amountPence: number, full: boolean): Promise<void> {
  try {
    const order = await getOrder(pool, orderId);
    if (order) await sendRefundEmail(order, amountPence, full);
  } catch (err) {
    logFailure("refund", err);
  }
}

/**
 * After reconcileRefunds has committed: the buyer is told of money just refunded (once: a second run
 * finds nothing new), and staff of a refund that failed at the bank. The buyer is never emailed
 * about a failure: staff contact them.
 */
export async function tellAfterReconcile(orderId: number, r: { refundedNowPence: number; full: boolean; failedWords: string[] }): Promise<void> {
  if (r.refundedNowPence > 0) await sendRefundRecordedEmail(orderId, r.refundedNowPence, r.full);
  if (r.failedWords.length) await sendOrderFlagStaffEmail(orderId, r.failedWords);
}

/** The buyer's free booking was cancelled (by the organiser or staff): tell them. `order` is as it was before. */
export async function sendBookingCancelledEmail(order: OrderFull): Promise<void> {
  try {
    const f = await getFundraiser(order.fundraiserId);
    if (!f) return;
    const mail = buildBookingCancelledEmail({ title: f.title }, { reference: order.reference, firstName: order.firstName, tickets: ticketsWords(order.lines) });
    await sendEventTickets("eventTicketsCancelled", `${order.firstName} ${order.surname}`, { email: order.email, ...events(), ...mail });
  } catch (err) {
    logFailure("booking cancelled", err);
  }
}

/** To the events inbox: Stripe took a payment for a ticket order we have no record of. */
export async function sendUnknownPaymentStaffEmail(p: { reference: string; sessionId: string; amountTotal: number | null }): Promise<void> {
  try {
    const mail = buildUnknownPaymentStaffEmail(p, { adminUrl: adminUrl() });
    await sendEventTickets("eventTicketsToCheck", null, { email: config.BALL_FROM_EMAIL, ...events(), ...mail });
  } catch (err) {
    logFailure("unknown payment", err);
  }
}

/** The buyer: some tickets on their booking were released (cancelled) with no money moving. */
export async function sendTicketsReleasedEmail(order: OrderFull, released: string): Promise<void> {
  try {
    const f = await getFundraiser(order.fundraiserId);
    if (!f) return;
    const mail = buildTicketsReleasedEmail({ title: f.title }, { reference: order.reference, firstName: order.firstName, released, standing: ticketsWords(order.lines) });
    await sendEventTickets("eventTicketsCancelled", `${order.firstName} ${order.surname}`, { email: order.email, ...events(), ...mail });
  } catch (err) {
    logFailure("tickets released", err);
  }
}

/** To the events inbox: an organiser asked for a refund. Reply-To the organiser. */
export async function sendRefundRequestStaffEmail(f: FundraiserRecord, order: OrderFull, reason: string): Promise<void> {
  try {
    const mail = buildRefundRequestStaffEmail(
      { title: f.title, organiserName: f.name },
      { reference: order.reference, buyerName: `${order.firstName} ${order.surname}`, tickets: ticketsWords(order.lines), reason },
      { adminUrl: adminUrl() },
    );
    await sendEventTickets("eventTicketsRefundAsked", f.name, { email: config.BALL_FROM_EMAIL, from: config.BALL_FROM_EMAIL, replyTo: f.email, ...mail });
  } catch (err) {
    logFailure("refund request", err);
  }
}

/** To the events inbox: an organiser proposed tickets from their private area. Reply-To the organiser. */
export async function sendTicketsProposedStaffEmail(
  f: FundraiserRecord,
  types: ProposedType[],
  salesLimit: number | null | undefined,
  close?: { mode: string; at: string | null },
): Promise<void> {
  try {
    const mail = buildTicketsProposedStaffEmail({ title: f.title, organiserName: f.name }, { types, salesLimit, closeWords: close ? closeWords(close) : undefined }, { adminUrl: adminUrl() });
    await sendEventTickets("eventTicketsToApprove", f.name, { email: config.BALL_FROM_EMAIL, from: config.BALL_FROM_EMAIL, replyTo: f.email, ...mail });
  } catch (err) {
    logFailure("tickets to approve", err);
  }
}
