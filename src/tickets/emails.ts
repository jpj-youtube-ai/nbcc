import { emailShell, heading, subheading, eyebrow, bodyP, bodyList, note, button, card, signOff, signOffText, questionsBox, questionsText } from "../email/brand";
import { CHARITY_NAME, FOOTER_TEXT, OSCR_NUMBER, POSTAL_ADDRESS } from "../legal/registration";
import { dateParts, timeText } from "../events/render";
import { emailDate, raiseOrdinals } from "../email/dates";
import { safeFirstName } from "../fundraising/emails";
import { closeWords, pounds, ticketsWords, type OrderLine, type ProposedType } from "./model";

// Event tickets: the emails, built here and sent by src/tickets/send.ts, From and Reply-To the events
// inbox (events@nbcc.scot), like every fundraising email. Pure: no pool, no config, no clock.
//
//   tickets        to the buyer, once Stripe confirms the payment: the tickets, the reference, the
//                  money, when and where, and "Show this email at the door"
//   refund         to the buyer, when an admin refunds (or a refund is made in Stripe itself)
//   cancelled      to the buyer, when a free booking is cancelled by the organiser or staff
//   refund asked   to the events inbox, when an organiser asks for a refund (Reply-To the organiser)
//   to approve     to the events inbox, when an organiser proposes tickets from their private area
//   to check       to the events inbox, when a booking needs a look: paid late with the event now
//                  over its limit, the wrong amount, or disputed with the bank
//
// Plain friendly English with no dashes, and every stored value escaped.

export const TICKETS_EMAIL = "events@nbcc.scot";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Every date in the body has its ending raised ("7th" as 7<sup>th</sup>): ../email/dates.ts.
const shell = (body: string) => emailShell(raiseOrdinals(body), { contactEmail: TICKETS_EMAIL, registration: true, postalAddress: POSTAL_ADDRESS });

function toBuyer(subject: string, bodyHtml: string, textLines: string[], line: string): BuiltEmail {
  const html = shell(bodyHtml + signOff(line) + questionsBox(TICKETS_EMAIL));
  const text = [...textLines, "", signOffText(line), "", questionsText(TICKETS_EMAIL), "", FOOTER_TEXT].join("\n");
  return { subject, html, text };
}

const hi = (typed: string) => {
  const first = safeFirstName(typed);
  return first ? `Hi ${first},` : "Hi there,";
};

export interface TicketEmailEvent {
  title: string;
  eventDate: string | null;
  startTime: string | null;
  endTime: string | null;
  timeTbc: boolean;
  /** The venue and its full address, as the event's page shows it. */
  where: string;
  organisedBy: string;
  pageUrl: string;
}

/** "Saturday 5 December 2026, 7.30pm to 10.30pm". */
export function whenWords(e: Pick<TicketEmailEvent, "eventDate" | "startTime" | "endTime" | "timeTbc">): string {
  if (!e.eventDate) return "";
  const p = dateParts(e.eventDate);
  const time = timeText({ start: e.startTime, end: e.endTime, timeTbc: e.timeTbc }, true);
  return `${p.dayName} ${p.day} ${p.month} ${p.year}${time ? `, ${time}` : ""}`;
}

/** The same in an email: "Saturday 5th December 2026, 7.30pm to 10.30pm" (../email/dates.ts). */
function emailWhenWords(e: Pick<TicketEmailEvent, "eventDate" | "startTime" | "endTime" | "timeTbc">): string {
  if (!e.eventDate) return "";
  const time = timeText({ start: e.startTime, end: e.endTime, timeTbc: e.timeTbc }, true);
  return `${emailDate(e.eventDate, { year: true })}${time ? `, ${time}` : ""}`;
}

const lineWords = (l: OrderLine) => (l.unitPence === 0 ? `${l.quantity} × ${l.typeName}, free` : `${l.quantity} × ${l.typeName} at ${pounds(l.unitPence)} each`);

const NOT_A_GIFT = "Tickets are not donations, so Gift Aid does not apply to them.";
const WHERE_IT_GOES = `Every penny of your ticket money goes to the ${CHARITY_NAME} (Scottish Charity ${OSCR_NUMBER}), helping the children, young people and vulnerable adults we support.`;

function factRow(label: string, valueHtml: string): string {
  return (
    `<tr><td style="padding:10px 16px;border-bottom:1px solid #F3E4DD;font-family:Poppins,Arial,sans-serif;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6F6A66;font-weight:700;width:34%;vertical-align:top">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 16px;border-bottom:1px solid #F3E4DD;font-family:Poppins,Arial,sans-serif;font-size:14px;color:#333333;vertical-align:top">${valueHtml}</td></tr>`
  );
}

/** The buyer's tickets, once the payment is confirmed. */
export function buildTicketConfirmationEmail(
  e: TicketEmailEvent,
  o: { reference: string; firstName: string; lines: OrderLine[]; ticketsPence: number; feeCoverPence: number; totalPence: number },
): BuiltEmail {
  const when = emailWhenWords(e);
  const lines = o.lines.filter((l) => l.quantity > 0);
  // A free booking (every ticket £0) paid nothing, so it says so, and says nothing about ticket money.
  const free = o.totalPence === 0;
  const paid = free ? "Nothing to pay" : o.feeCoverPence > 0 ? `${pounds(o.totalPence)} (including ${pounds(o.feeCoverPence)} to cover the card fee)` : pounds(o.totalPence);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const doorLine = `Show this email at the door. Your booking reference is ${o.reference}, for ${count} ${count === 1 ? "ticket" : "tickets"}.`;
  const body =
    eyebrow("Your tickets") +
    heading("You're booked in!") +
    bodyP(`${escapeHtml(hi(o.firstName))} thank you for booking <b>${escapeHtml(e.title)}</b>. Your tickets are below.`) +
    card(
      factRow("Reference", `<b style="font-size:18px;letter-spacing:.06em;color:#800000">${escapeHtml(o.reference)}</b>`) +
        factRow("Tickets", lines.map((l) => escapeHtml(lineWords(l))).join("<br>")) +
        factRow("Paid", escapeHtml(paid)) +
        (when ? factRow("When", escapeHtml(when)) : "") +
        (e.where ? factRow("Where", escapeHtml(e.where)) : "") +
        factRow("Organised by", escapeHtml(e.organisedBy)),
    ) +
    bodyP(`<b>${escapeHtml(doorLine)}</b> On your phone or printed, either is fine.`) +
    (free ? "" : bodyP(escapeHtml(WHERE_IT_GOES)) + note(escapeHtml(NOT_A_GIFT))) +
    button(e.pageUrl, "See the event page") +
    bodyP("Can't come after all? Reply to this email and we'll help.");
  const text = [
    hi(o.firstName),
    "",
    `Thank you for booking ${e.title}. Your tickets are below.`,
    "",
    `Reference: ${o.reference}`,
    "Tickets:",
    ...lines.map((l) => `* ${lineWords(l)}`),
    `Paid: ${paid}`,
    ...(when ? [`When: ${when}`] : []),
    ...(e.where ? [`Where: ${e.where}`] : []),
    `Organised by: ${e.organisedBy}`,
    "",
    `${doorLine} On your phone or printed, either is fine.`,
    "",
    ...(free ? [] : [WHERE_IT_GOES, NOT_A_GIFT, ""]),
    `See the event page: ${e.pageUrl}`,
    "",
    "Can't come after all? Reply to this email and we'll help.",
  ];
  return toBuyer(`Your tickets for ${e.title}`, body, text, "See you there!");
}

/** The buyer's refund: how much, and what still stands. */
export function buildTicketRefundEmail(
  e: Pick<TicketEmailEvent, "title">,
  r: { reference: string; firstName: string; amountPence: number; full: boolean; standing: string },
): BuiltEmail {
  const money = `We have refunded ${pounds(r.amountPence)} to the card you paid with. It can take 5 to 10 working days to show.`;
  const after = r.full
    ? `Your booking ${r.reference} is now cancelled.`
    : `You still have ${r.standing} on booking ${r.reference}. Show your tickets email at the door as before.`;
  const body =
    eyebrow("Your tickets") +
    heading("Your refund") +
    bodyP(`${escapeHtml(hi(r.firstName))} this is about your booking for <b>${escapeHtml(e.title)}</b>.`) +
    bodyP(escapeHtml(money)) +
    bodyP(escapeHtml(after));
  const text = [hi(r.firstName), "", `This is about your booking for ${e.title}.`, "", money, "", after];
  return toBuyer(`Your refund for ${e.title}`, body, text, "Thank you for supporting NBCC.");
}

/** The buyer's free booking has been cancelled by the organiser or staff. */
export function buildBookingCancelledEmail(e: Pick<TicketEmailEvent, "title">, b: { reference: string; firstName: string; tickets: string }): BuiltEmail {
  const what = `Your booking ${b.reference} (${b.tickets}) for ${e.title} has been cancelled, so please do not come along on these tickets.`;
  const why = "If you were not expecting this, reply to this email and we'll look into it.";
  const body = eyebrow("Your tickets") + heading("Your booking is cancelled") + bodyP(escapeHtml(hi(b.firstName))) + bodyP(escapeHtml(what)) + bodyP(escapeHtml(why));
  const text = [hi(b.firstName), "", "Your booking is cancelled", "", what, "", why];
  return toBuyer(`Your booking is cancelled: ${e.title}`, body, text, "Thank you.");
}

/** The buyer: some of their tickets were cancelled by staff, with no money moving (they were free, or already refunded). */
export function buildTicketsReleasedEmail(e: Pick<TicketEmailEvent, "title">, b: { reference: string; firstName: string; released: string; standing: string }): BuiltEmail {
  const what = `These tickets on your booking ${b.reference} for ${e.title} have been cancelled: ${b.released}.`;
  const after = b.standing ? `You still have ${b.standing}. Show your tickets email at the door as before.` : "There are no tickets left on this booking, so it is now cancelled.";
  const why = "If you were not expecting this, reply to this email and we'll look into it.";
  const body = eyebrow("Your tickets") + heading("Some of your tickets are cancelled") + bodyP(escapeHtml(hi(b.firstName))) + bodyP(escapeHtml(what)) + bodyP(escapeHtml(after)) + bodyP(escapeHtml(why));
  const text = [hi(b.firstName), "", what, "", after, "", why];
  return toBuyer(`Tickets cancelled: ${e.title}`, body, text, "Thank you.");
}

/** To the events inbox: Stripe took a payment marked as tickets, for an order we have no record of. */
export function buildUnknownPaymentStaffEmail(p: { reference: string; sessionId: string; amountTotal: number | null }, o: { adminUrl: string }): BuiltEmail {
  const what = `Stripe took a ticket payment${p.amountTotal !== null ? ` of ${pounds(p.amountTotal)}` : ""} for booking ${p.reference}, but there is no booking with that reference here.`;
  const steps = [
    `Find the payment in Stripe (checkout ${p.sessionId}) and see who paid.`,
    "No tickets were issued and no email went to the buyer. Refund it in Stripe, or get in touch with them.",
    "Tell the developer: this should never happen.",
  ];
  const line = "Thank you!";
  const body = eyebrow("For the team") + heading("A ticket payment with no booking") + bodyP(escapeHtml(what)) + subheading("Next steps") + bodyList(steps.map(escapeHtml)) + button(o.adminUrl, "Open the admin") + signOff(line);
  const text = ["A TICKET PAYMENT WITH NO BOOKING", "", what, "", "NEXT STEPS", ...steps.map((x) => `* ${x}`), "", `Open the admin: ${o.adminUrl}`, "", signOffText(line)].join("\n");
  return { subject: `Ticket payment with no booking: ${p.reference}`, html: shell(body), text };
}

/** To the events inbox: an organiser asked for a refund. Only an admin can make it. */
export function buildRefundRequestStaffEmail(
  e: { title: string; organiserName: string },
  r: { reference: string; buyerName: string; tickets: string; reason: string },
  o: { adminUrl: string },
): BuiltEmail {
  const what = `${e.organiserName} has asked for a refund of booking ${r.reference} (${r.buyerName}, ${r.tickets}).`;
  const steps = [
    "Only an admin can make the refund, in Admin > Fundraising > Event tickets.",
    "Pick the tickets to refund there: the money goes back to the buyer's card and they are emailed.",
    "If it should not be refunded, decline the request there and let the organiser know.",
    `Replying to this email replies to ${e.organiserName}.`,
  ];
  const line = "Thank you!";
  const body =
    eyebrow("For the team") +
    heading("A refund has been asked for") +
    bodyP(escapeHtml(what)) +
    subheading("Why") +
    bodyP(escapeHtml(r.reason)) +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = [
    "A REFUND HAS BEEN ASKED FOR",
    "",
    what,
    "",
    "WHY",
    r.reason,
    "",
    "NEXT STEPS",
    ...steps.map((s) => `* ${s}`),
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    signOffText(line),
  ].join("\n");
  return { subject: `Refund asked for: ${r.reference}, ${e.title}`, html: shell(body), text };
}

const typeWords = (t: ProposedType) => `${t.name} ${t.pricePence === 0 ? "free" : `at ${pounds(t.pricePence)}`}${t.quantity ? `, ${t.quantity} on sale` : ""}`;

/** To the events inbox: an organiser proposed tickets from their private area. */
export function buildTicketsProposedStaffEmail(
  e: { title: string; organiserName: string },
  /** `close`: when sales close, as the organiser chose it; its date is written the emails' way. */
  p: { types: ProposedType[]; salesLimit: number | null | undefined; close?: { mode: string; at: string | null } },
  o: { adminUrl: string },
): BuiltEmail {
  const items = [
    ...p.types.map(typeWords),
    ...(p.salesLimit === undefined ? [] : [p.salesLimit === null ? "No limit on tickets in all" : `At most ${p.salesLimit} tickets in all`]),
    ...(p.close ? [closeWords(p.close, (at) => emailDate(at, { year: true }))].filter(Boolean) : []),
  ];
  const line = "Thank you!";
  const lead = `${e.organiserName} would like these for ${e.title}. Nothing goes on sale until you approve it.`;
  const body =
    eyebrow("For the team") +
    heading("Tickets to approve") +
    bodyP(escapeHtml(lead)) +
    bodyList(items.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = ["TICKETS TO APPROVE", "", lead, "", ...items.map((i) => `* ${i}`), "", `Open the admin: ${o.adminUrl}`, "", signOffText(line)].join("\n");
  return { subject: `Tickets to approve: ${e.title}`, html: shell(body), text };
}

/** To the events inbox: a booking that needs a look (src/tickets/model.ts flagWords). */
export function buildOrderFlagStaffEmail(
  e: { title: string },
  b: { reference: string; buyerName: string; tickets: string; paid: string },
  flags: string[],
  /** `refundFailed`: it is about a refund that failed at the bank (the booking may be cancelled). */
  o: { adminUrl: string; refundFailed?: boolean },
): BuiltEmail {
  const what = `Booking ${b.reference} for ${e.title} needs a look (${b.buyerName}, ${b.tickets || "no tickets left"}, paid ${b.paid}).`;
  const steps = [
    // A failed refund: their tickets may be cancelled, so never "the buyer has their tickets email".
    // The buyer is never emailed about a failure (./send.ts tellAfterReconcile): staff contact them.
    o.refundFailed
      ? "The refund did not go through, and the buyer has not been told. Please get in touch with them."
      : "The payment is recorded and the buyer has their tickets email.",
    "Open the booking in Admin > Fundraising > Event tickets and check it against Stripe.",
    "If the event is over its limit, speak to the organiser: you can refund this booking there, or raise the limit.",
  ];
  const line = "Thank you!";
  const body =
    eyebrow("For the team") +
    heading("A ticket booking to check") +
    bodyP(escapeHtml(what)) +
    bodyList(flags.map(escapeHtml)) +
    subheading("Next steps") +
    bodyList(steps.map(escapeHtml)) +
    button(o.adminUrl, "Open the admin") +
    signOff(line);
  const text = [
    "A TICKET BOOKING TO CHECK",
    "",
    what,
    "",
    ...flags.map((f) => `* ${f}`),
    "",
    "NEXT STEPS",
    ...steps.map((s) => `* ${s}`),
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    signOffText(line),
  ].join("\n");
  return { subject: `Check this ticket booking: ${b.reference}, ${e.title}`, html: shell(body), text };
}

export { ticketsWords };
