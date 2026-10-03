import { escapeHtml } from "../events/render";
import { MAX_TICKETS_PER_ORDER, moneySplit, pounds, type SalesState, type TypeAvailability, type GuestRow } from "./model";
import type { CardFeeRate } from "../ball/pricing";

// Event tickets on the event's page (/event/<short name>): the Get tickets section, the ticket money
// in the summary beside the gifts, the thank you after buying, and what the facts and the card on Get
// involved say. Plus the printable guest list for the door. Pure: no database, no config, no clock.
//
// Get tickets is its own section, apart from the give form and never mixed with it: tickets are a
// purchase, a gift is a gift. It never offers Gift Aid (tickets are not donations), and says so.
// The form is shipped hidden; assets/js/event-tickets.js shows it, adds up the total as the buyer
// chooses, and sends it to POST /api/event-tickets/:id/checkout. Everything typed is escaped.

/** How many left before the page says "Only N left". */
export const FEW_LEFT = 10;

export interface TicketsView {
  state: SalesState;
  fundraiserId: number;
  slug: string;
  title: string;
  types: TypeAvailability[];
  cardFee: CardFeeRate;
  /** The spam check's site key (Turnstile), when the check is on: the page's script shows the box. */
  captchaSiteKey?: string | null;
  /** When sales close, in words (src/tickets/model.ts closeWords); when the event starts if not given. */
  closeWords?: string;
}

const STYLES = '<link rel="stylesheet" href="/assets/css/event-tickets.css" />';
const SCRIPT = '<script defer src="/assets/js/event-tickets.js"></script>';

const NOT_A_GIFT = "Tickets are not donations, so Gift Aid does not apply.";
const WHO_SELLS = "Sold by NBCC: all the ticket money goes to NBCC.";

const STATE_WORDS: Partial<Record<SalesState, { badge?: string; line: string }>> = {
  soon: { line: "Tickets go on sale soon. Check back here." },
  sold_out: { badge: "Sold out", line: "Sorry, every ticket has gone. You can still give to the event below." },
  closed: { line: "Ticket sales have closed." },
  started: { line: "Ticket sales have closed." },
  finished: { line: "This event has finished. Thank you to everyone who came." },
};

function typeRow(t: TypeAvailability): string {
  const id = `etQty-${t.id}`;
  const name = escapeHtml(t.name);
  const few = !t.soldOut && t.remaining !== null && t.remaining <= FEW_LEFT ? `<span class="et-type__few">Only ${t.remaining} left</span>` : "";
  const max = Math.min(MAX_TICKETS_PER_ORDER, t.remaining ?? MAX_TICKETS_PER_ORDER);
  const control = t.soldOut
    ? '<span class="et-type__out">Sold out</span>'
    : '<div class="et-stepper">' +
      `<button class="et-stepper__btn" type="button" data-et-step="-1" aria-label="One fewer ${name} ticket" aria-controls="${id}">&minus;</button>` +
      `<input class="et-stepper__input" id="${id}" name="${id}" type="number" inputmode="numeric" min="0" max="${max}" step="1" value="0" ` +
      `data-et-qty data-type-id="${t.id}" data-price="${t.pricePence}" aria-label="How many ${name} tickets" />` +
      `<button class="et-stepper__btn" type="button" data-et-step="1" aria-label="One more ${name} ticket" aria-controls="${id}">+</button>` +
      "</div>";
  return (
    `<li class="et-type${t.soldOut ? " is-sold-out" : ""}" data-et-type="${t.id}">` +
    `<div class="et-type__about"><span class="et-type__name">${name}</span>` +
    `<span class="et-type__price">${t.pricePence === 0 ? "Free" : pounds(t.pricePence)}</span>${few}</div>` +
    control +
    "</li>"
  );
}

function form(v: TicketsView): string {
  return (
    `<form class="et-form" id="etForm" data-et-form data-fundraiser-id="${v.fundraiserId}" data-slug="${escapeHtml(v.slug)}" ` +
    `data-fee-bp="${v.cardFee.percentBp}" data-fee-fixed="${v.cardFee.fixedPence}"` +
    (v.captchaSiteKey ? ` data-captcha-key="${escapeHtml(v.captchaSiteKey)}"` : "") +
    " novalidate hidden data-needs-js>" +
    '<p class="form-error-summary" role="alert" data-et-error hidden></p>' +
    '<fieldset class="et-fieldset"><legend class="et-legend">How many would you like?</legend>' +
    `<ul class="et-types" role="list">${v.types.map(typeRow).join("")}</ul>` +
    "</fieldset>" +
    '<fieldset class="et-fieldset give-contact"><legend class="et-legend">Your details</legend>' +
    '<div class="give-name-row">' +
    '<div class="give-field"><label for="etFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="etFirstName" name="etFirstName" type="text" autocomplete="given-name" maxlength="50" required aria-required="true" /></div>' +
    '<div class="give-field"><label for="etSurname">Surname <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="etSurname" name="etSurname" type="text" autocomplete="family-name" maxlength="50" required aria-required="true" /></div>' +
    "</div>" +
    '<div class="give-field"><label for="etEmail">Email <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="etEmail" name="etEmail" type="email" autocomplete="email" maxlength="254" required aria-required="true" placeholder="you@example.com" aria-describedby="etEmailHelp" />' +
    '<p class="give-field-help" id="etEmailHelp">We email your tickets here.</p></div>' +
    '<div class="give-field"><label for="etPhone">Phone <span class="give-optional">(optional)</span></label>' +
    '<input class="give-field-input" id="etPhone" name="etPhone" type="tel" autocomplete="tel" maxlength="20" aria-describedby="etPhoneHelp" />' +
    '<p class="give-field-help" id="etPhoneHelp">Only in case we need to reach you about the event. We delete your phone number 90 days after the event.</p></div>' +
    // A box a person never sees or reaches: only a bot fills it, and its order is refused.
    '<div class="et-hp" aria-hidden="true"><label for="etCompany">Leave this empty</label>' +
    '<input id="etCompany" name="company" type="text" tabindex="-1" autocomplete="off" /></div>' +
    '<p class="give-field-help give-privacy">We handle your details as set out in our <a href="/privacy">Privacy notice</a>.</p>' +
    "</fieldset>" +
    '<label class="give-check et-cover" for="etCoverFee"><input class="give-check-box" id="etCoverFee" name="etCoverFee" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add <span data-et-fee>a little</span> to cover the card fee.</strong> ' +
    "Card payments cost NBCC a small fee. Cover it and all your ticket money funds our work rather than the card company.</span></label>" +
    '<div class="et-total" aria-live="polite"><span class="et-total__label">Total</span><span class="et-total__sum" data-et-total>£0</span></div>' +
    `<p class="et-note">${NOT_A_GIFT}</p>` +
    '<div class="fr-captcha et-captcha" data-et-captcha hidden></div>' +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta et-buy" type="submit" data-et-submit disabled>Buy tickets</button>' +
    '<p class="give-pay-note">Secure payment by Stripe. Card, Apple Pay and Google Pay.</p>' +
    "</div>" +
    '<p class="form-status" role="status" aria-live="polite" data-et-status></p>' +
    "</form>" +
    '<p class="et-nojs" data-nojs>Buying tickets needs JavaScript switched on. You can email <a href="mailto:events@nbcc.scot">events@nbcc.scot</a> instead, and we will gladly help.</p>'
  );
}

/** The Get tickets section, or nothing when the event does not sell tickets through NBCC. */
export function renderTicketsSection(v: TicketsView): string {
  if (v.state === "off") return "";
  const words = STATE_WORDS[v.state];
  const inner = v.state === "open"
    ? form(v)
    : `<div class="et-state et-state--${v.state}">` +
      (words?.badge ? `<p class="et-badge">${words.badge}</p>` : "") +
      `<p class="et-state__line">${escapeHtml(words?.line ?? "")}</p></div>`;
  return (
    STYLES +
    '<section class="et-tickets" id="tickets" aria-labelledby="et-heading" tabindex="-1">' +
    '<div class="card card-lg et-card">' +
    '<p class="et-eyebrow">Tickets</p>' +
    '<h2 class="et-title" id="et-heading">Get tickets</h2>' +
    `<p class="et-sub">${WHO_SELLS}${v.state === "open" || v.state === "soon" ? ` ${escapeHtml(v.closeWords ?? "Sales close when the event starts.")}` : ""}</p>` +
    inner +
    (v.state === "open" ? "" : `<p class="et-note">${NOT_A_GIFT}</p>`) +
    "</div>" +
    "</section>" +
    (v.state === "open" ? SCRIPT : "")
  );
}

/** Under the meter: the ticket money and the gifts, apart, and the way to the tickets while on sale. */
export function renderTicketsSummary(m: { ticketsPence: number; giftsPence: number }, state: SalesState): string {
  if (state === "off") return "";
  return (
    `<p class="et-split">${escapeHtml(moneySplit(m.ticketsPence, m.giftsPence).words)}</p>` +
    (state === "open" ? '<a class="btn btn-ghost et-summary-btn" href="#tickets">Get tickets</a>' : "")
  );
}

/** The thank you after buying (?tickets=thanks&ticket_session=), at the top of the page. */
export function renderTicketsThanks(t: { reference: string | null; paid: boolean }): string {
  const ref = t.reference ? ` Your booking reference is <strong>${escapeHtml(t.reference)}</strong>.` : "";
  const lead = t.paid
    ? `We’re emailing your tickets now.${ref} Show the email at the door.`
    : `Your payment is being confirmed. Your tickets email will follow in a minute or two.${ref} Show the email at the door.`;
  return (
    STYLES +
    '<div class="fr-thanks-panel et-thanks" role="status" tabindex="-1" data-et-thanks>' +
    "<h2>Thank you, you’re booked in!</h2>" +
    `<p>${lead}</p>` +
    "<p>Can’t see it? Check your junk folder, or email <a href=\"mailto:events@nbcc.scot\">events@nbcc.scot</a>.</p>" +
    "</div>"
  );
}

// --- the event card and its facts (hooks for src/fundraising/render.ts) --------------------------------

/** The card on Get involved: a Get tickets button to the page's own section. */
export function nbccCardBooking(url: string | null): { bookingHow: "site" | "none"; bookingUrl: string; bookingLabel: string; bookingNote: string; bookingSolo?: string } {
  if (!url) return { bookingHow: "none", bookingUrl: "", bookingLabel: "", bookingNote: "", bookingSolo: "Tickets are sold by NBCC." };
  return { bookingHow: "site", bookingUrl: `${url}#tickets`, bookingLabel: "Get tickets", bookingNote: "" };
}

/** The facts at the top of the page: who sells the tickets, and the way to them. */
export const NBCC_FACT_HTML = 'Tickets are sold here, by NBCC. <a href="#tickets">Get tickets</a>';

// --- the printable guest list ------------------------------------------------------------------------------

const PRINTED = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The guest list for the door, as a page of its own to print (from the admin and the organiser's
 * private area): a tick box, the name, the tickets and the reference, by surname. Nothing else
 * about a buyer: no email, phone or money. Never indexed, never kept.
 */
export function renderGuestListPage(g: {
  title: string;
  when: string;
  list: { rows: GuestRow[]; totalTickets: number; byType: Array<{ name: string; count: number }> };
  printedAt: string;
}): string {
  const bookings = g.list.rows.length;
  const rows = g.list.rows
    .map(
      (r) =>
        `<tr><td class="et-tick-cell"><span class="et-tick" aria-hidden="true"></span><span class="sr-only">Arrived</span></td>` +
        `<td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.tickets)}</td><td class="et-num">${r.count}</td><td class="et-ref">${escapeHtml(r.reference)}</td></tr>`,
    )
    .join("");
  const types = g.list.byType.map((t) => `${escapeHtml(t.name)}: ${t.count}`).join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Guest list: ${escapeHtml(g.title)}</title>
<style>
  :root { --maroon: #800000; --crimson: #C02238; --slate: #333333; --line: #E5D9D2; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px 40px; font: 15px/1.45 "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--slate); background: #fff; }
  .wrap { max-width: 860px; margin: 0 auto; }
  h1 { font-family: "Playfair Display", Georgia, serif; color: var(--maroon); font-size: 1.6rem; margin: 0 0 4px; overflow-wrap: anywhere; }
  .meta { margin: 0 0 4px; }
  .totals { margin: 12px 0 16px; font-weight: 600; }
  .actions { margin: 0 0 16px; }
  .actions button { font: inherit; font-weight: 600; background: var(--crimson); color: #fff; border: 0; border-radius: 999px; padding: 10px 22px; cursor: pointer; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
  th { font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; color: #6F6A66; }
  .et-tick-cell { width: 44px; }
  .et-tick { display: inline-block; width: 22px; height: 22px; border: 2px solid var(--slate); border-radius: 4px; }
  .et-num { width: 64px; text-align: right; }
  .et-ref { font-variant-numeric: tabular-nums; letter-spacing: .04em; white-space: nowrap; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .empty { padding: 16px 0; }
  .foot { margin-top: 18px; font-size: .85rem; color: #6F6A66; }
  @media (max-width: 560px) { .et-ref { white-space: normal; } th:nth-child(4), td:nth-child(4) { display: none; } }
  @media print { body { padding: 0; } .actions { display: none; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<div class="wrap">
<h1>Guest list: ${escapeHtml(g.title)}</h1>
${g.when ? `<p class="meta">${escapeHtml(g.when)}</p>` : ""}
<p class="totals">${plural(g.list.totalTickets, "ticket", "tickets")} in ${plural(bookings, "booking", "bookings")}${types ? ` (${types})` : ""}</p>
<p class="actions"><button type="button" onclick="window.print()">Print this list</button></p>
${bookings
    ? `<table><thead><tr><th scope="col"><span class="sr-only">Arrived</span></th><th scope="col">Name</th><th scope="col">Tickets</th><th scope="col">How many</th><th scope="col">Reference</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty">No tickets sold yet.</p>'}
<p class="foot">Printed ${escapeHtml(PRINTED.format(new Date(g.printedAt)))}. Anyone not on the list can show their tickets email: its reference matches the one here. Please shred or bin this list after the event.</p>
</div>
</body>
</html>`;
}
