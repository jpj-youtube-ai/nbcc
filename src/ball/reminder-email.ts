import { escapeHtml, lineUpSentence, TICKET_INCLUDES } from "./page";
import { ballEmailShell, contactPanel, factsCard, BALL_TEXT_FOOTER } from "./email-shell";
import { MAROON, SLATE, SLATE_SOFT, TAN_SOFT, HEAD, BODY_FONT, CRIMSON } from "../email/brand";
import type { GuestRow } from "./guest-page";

// TASK-313 (plan 5): the "a week to go" reminder. Pure — no pool, no config, no clock — so it is
// unit-tested DB-free like the confirmation.
//
// Two jobs, and the second is the one that matters. It carries the practical details, yes. But it
// also reads back WHAT THE BOOKER TOLD US — the guest names, the allergies, the access needs — so
// that a mistake is caught a week out rather than at the table. A guest whose coeliac note never
// saved finds out now, while there is still time, instead of being handed a bread roll.

export interface ReminderBooking {
  reference: string;
  buyerName: string;
  /** NULL on bookings taken before TASK-318, when the form asked for one name. */
  buyerFirstName?: string | null;
  seats: number;
  tableName: string | null;
}

// "Hello Jo" is what a person writes; "Hello Jo Smith" is what a system writes, and this is an
// invitation to a party. Falls back to the whole name rather than splitting it here — guessing
// where a name divides is exactly what storing the two halves was meant to stop.
function greetingName(booking: ReminderBooking): string {
  return booking.buyerFirstName?.trim() || booking.buyerName;
}

export interface ReminderDetails {
  arrivalTime: string | null;
  includedNote: string | null;
  guestLink: string | null;
}

export interface ReminderEmail {
  subject: string;
  html: string;
  text: string;
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const H2 = `style="color:${MAROON};font-family:${HEAD};font-size:18px;font-weight:700;margin:26px 0 10px"`;
const LINK = `style="color:${CRIMSON};font-weight:700"`;
const SMALL = `style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:0 0 10px"`;

export function buildBallReminderEmail(
  booking: ReminderBooking,
  guests: GuestRow[],
  details: ReminderDetails,
): ReminderEmail {
  const named = guests.filter((g) => g.fullName.trim().length > 0);
  const missing = Math.max(0, booking.seats - named.length);
  const arrival = details.arrivalTime ?? "We'll confirm the start time shortly";

  // The same sentence the website and the confirmation use, so a guest reading this a week out
  // is told exactly what they were told when they bought.
  const includes = details.includedNote
    ? `${TICKET_INCLUDES} ${escapeHtml(details.includedNote)}`
    : TICKET_INCLUDES;
  const includesText = details.includedNote
    ? `${TICKET_INCLUDES} ${details.includedNote}`
    : TICKET_INCLUDES;

  const guestRowsHtml = named.length
    ? named
        .map((g) => {
          const notes = [g.dietary, g.accessNeeds]
            .filter((v): v is string => Boolean(v))
            .map(escapeHtml)
            .join(" · ");
          return (
            `<tr><td style="padding:7px 0;border-bottom:1px solid ${TAN_SOFT};color:${SLATE};font-family:${BODY_FONT};font-size:14px;">${escapeHtml(g.fullName)}</td>` +
            `<td style="padding:7px 0;border-bottom:1px solid ${TAN_SOFT};color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:14px;text-align:right;">${notes || "None"}</td></tr>`
          );
        })
        .join("")
    : "";

  // Only nag about missing names when some are actually missing, and never make it the headline.
  const missingHtml =
    missing > 0 && details.guestLink
      ? `<p ${P}>There ${missing === 1 ? "is" : "are"} still ${missing} ${missing === 1 ? "place" : "places"} without a name. <a href="${escapeHtml(details.guestLink)}" ${LINK}>Add them here</a> and we'll get the door list right.</p>`
      : "";

  const guestsHtml = named.length
    ? `<h2 ${H2}>Your table</h2>
  <p ${SMALL}>This is what we have. If anything's wrong, ${
    details.guestLink
      ? `<a href="${escapeHtml(details.guestLink)}" ${LINK}>change it here</a>`
      : "email us"
  }. It's not too late.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;">${guestRowsHtml}</table>`
    : "";

  const body = `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">A week to go</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">It's nearly here!</h1>

  <p ${P}>Hello ${escapeHtml(greetingName(booking))}. A week on Saturday you'll be with us at The Park Hotel. Here's everything you need.</p>

  ${factsCard(
    `<tr><td style="padding:14px 18px 4px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">When</td></tr>
    <tr><td style="padding:0 18px 10px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;"><b>Saturday 7th November 2026</b><br />${escapeHtml(arrival)}</td></tr>
    <tr><td style="padding:0 18px 4px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">Where</td></tr>
    <tr><td style="padding:0 18px 10px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;">The Park Hotel, Rugby Park, Kilmarnock</td></tr>
    <tr><td style="padding:0 18px 4px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">Booking</td></tr>
    <tr><td style="padding:0 18px 16px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;"><b>${escapeHtml(booking.reference)}</b>${
      booking.tableName ? ` · ${escapeHtml(booking.tableName)}` : ""
    }</td></tr>`,
  )}

  <p ${P}>Give your name at the welcome desk when you arrive. There's no ticket to print. Dress to impress. Over 18s only.</p>
  <p ${P}>${includes}</p>
  <p ${P}><b>Entertainment:</b> ${lineUpSentence()}</p>

  ${guestsHtml}
  ${missingHtml}

  <h2 ${H2}>On the night</h2>
  <p ${P}>There'll be a charity auction and a raffle, with card machines on hand, so bring a little extra if you'd like to join in. Raffle tickets are sold on the night.</p>

  <p ${P}>See you Saturday.</p>

  ${contactPanel("Anything you need before the night?")}`;

  const guestsText = named.length
    ? "\n\nYOUR TABLE\n" +
      named
        .map((g) => {
          const notes = [g.dietary, g.accessNeeds].filter((v): v is string => Boolean(v)).join(" · ");
          return `- ${g.fullName}${notes ? ": " + notes : ""}`;
        })
        .join("\n") +
      "\nIf anything's wrong, it's not too late. Change it here:" +
      (details.guestLink ? "\n" + details.guestLink : " email events@nbcc.scot")
    : "";

  const missingText =
    missing > 0 && details.guestLink
      ? `\n\nThere ${missing === 1 ? "is" : "are"} still ${missing} ${missing === 1 ? "place" : "places"} without a name:\n${details.guestLink}`
      : "";

  const text = `IT'S NEARLY HERE: A WEEK TO GO

Hello ${greetingName(booking)}. A week on Saturday you'll be with us at
The Park Hotel. Here's everything you need.

WHEN   Saturday 7th November 2026
       ${arrival}
WHERE  The Park Hotel, Rugby Park, Kilmarnock
BOOKING ${booking.reference}${booking.tableName ? " · " + booking.tableName : ""}

Give your name at the welcome desk when you arrive. There's no ticket to
print. Dress to impress. Over 18s only.
${includesText}
Entertainment: ${lineUpSentence()}${guestsText}${missingText}

ON THE NIGHT
There'll be a charity auction and a raffle, with card machines on hand, so
bring a little extra if you'd like to join in. Raffle tickets are sold on the
night.

See you Saturday.

${BALL_TEXT_FOOTER}`;

  return {
    subject: `A week to go: you're coming to the ball, ${booking.reference}`,
    html: ballEmailShell(body),
    text,
  };
}
