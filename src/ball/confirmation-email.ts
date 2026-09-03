import type { BallBookingWrite } from "./booking";
import { escapeHtml, lineUpSentence, TICKET_INCLUDES } from "./page";
import { ballEmailShell, contactPanel, factsCard, BALL_TEXT_FOOTER } from "./email-shell";
import { MAROON, SLATE, SLATE_SOFT, TAN_SOFT, HEAD, BODY_FONT, CRIMSON } from "../email/brand";

// TASK-313: the booking confirmation for a Festive Ball ticket. Pure — no pool, no config, no
// network, no clock — so it is unit-tested DB-free, mirroring src/business/invite-email.ts.
// The thin send wrapper lives in src/clients/email.ts and the webhook calls it POST-commit.
//
// Someone has just paid up to £1,000. This email is the only thing they have to show for it
// until November, so it carries the reference, the money broken down, and every practical
// detail we actually know — and says plainly where we do not know yet, rather than leaving a
// gap they have to email us about.
//
// It is also the first thing they receive after choosing to spend that money on a charity, so
// it opens by telling them they are coming to a party rather than filing a receipt at them.
// Three changes make that true, and each was asked for:
//
//  * The subject says "You're coming to the ball" and keeps the reference after it. The old one
//    ("Your Festive Ball booking, BALL-K7M2PQ") read like a filing label.
//  * It promises what the WEBSITE promises, by importing the website's own sentence. The page
//    said a three-course meal and a welcome drink; this email said "a meal", and the buyer had
//    no way to know which was right.
//  * It says nothing about Gift Aid unless Gift Aid was actually added. A paragraph explaining
//    a tax relief they did not claim and cannot claim on a ticket is exactly the form-letter
//    note that made the old email feel like a bank statement.

export interface BallEventDetails {
  arrivalTime: string | null;
  includedNote: string | null;
  /** Absolute link to the "tell us about your table" form, when a token has been minted. */
  guestLink?: string | null;
  /** Absolute link to the .ics file (TASK-337). Passed in, because this module stays pure. */
  calendarUrl?: string | null;
}

export interface BallConfirmationEmail {
  subject: string;
  html: string;
  text: string;
}

function money(pence: number): string {
  return "£" + (pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// "2 tickets" / "a table of 10" — what the buyer would say themselves.
function describe(booking: Pick<BallBookingWrite, "kind" | "quantity" | "seats">): string {
  if (booking.kind === "table") {
    return booking.quantity === 1
      ? "a table of 10"
      : `${booking.quantity} tables of 10 (${booking.seats} seats)`;
  }
  return booking.quantity === 1 ? "1 ticket" : `${booking.quantity} tickets`;
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const H2 = `style="color:${MAROON};font-family:${HEAD};font-size:18px;font-weight:700;margin:26px 0 10px"`;
const LINK = `style="color:${CRIMSON};font-weight:700"`;

export function buildBallConfirmationEmail(
  booking: BallBookingWrite,
  details: BallEventDetails,
): BallConfirmationEmail {
  const what = describe(booking);
  const name = escapeHtml(booking.buyerName);
  const arrival = details.arrivalTime
    ? escapeHtml(details.arrivalTime)
    : "From 7pm, to be confirmed. We'll email you";

  // The one sentence, imported rather than retyped, so the email cannot promise less than the
  // page that sold the ticket. Any menu note staff have added is APPENDED to it, never swapped
  // in, exactly as renderBallPage does it.
  const includes = details.includedNote
    ? `${TICKET_INCLUDES} ${escapeHtml(details.includedNote)}`
    : `${TICKET_INCLUDES} The menu and the running order are still being finalised with the venue; we'll email you as soon as they're confirmed.`;
  const includesText = details.includedNote
    ? `${TICKET_INCLUDES} ${details.includedNote}`
    : `${TICKET_INCLUDES} The menu and the running order are still being finalised with the venue; we'll email you as soon as they're confirmed.`;

  // Only show a money line that exists. A "Donation: £0.00" row is noise on a receipt.
  const rows: Array<[string, string]> = [["Tickets", money(booking.ticketsPence)]];
  if (booking.donationPence > 0) rows.push(["Donation to NBCC", money(booking.donationPence)]);
  if (booking.feeCoverPence > 0) rows.push(["Card fee covered", money(booking.feeCoverPence)]);
  rows.push(["Total paid", money(booking.totalPence)]);

  const rowsHtml = rows
    .map(([label, value], i) => {
      const last = i === rows.length - 1;
      const weight = last ? "font-weight:700;" : "";
      const border = last ? `border-top:1px solid ${TAN_SOFT};` : "";
      return (
        `<tr><td style="padding:8px 0;${border}${weight}color:${SLATE};font-family:${BODY_FONT};font-size:14px;">${label}</td>` +
        `<td style="padding:8px 0;${border}${weight}color:${SLATE};font-family:${BODY_FONT};font-size:14px;text-align:right;">${value}</td></tr>`
      );
    })
    .join("");

  // Only when they actually added it. HMRC does not allow Gift Aid on the ticket itself (the
  // buyer receives a dinner and a show in return), so the thank-you carries that limit with it
  // rather than leaving a donor to wonder why their ticket is not being claimed on.
  const giftAidHtml = booking.giftAid
    ? `<p ${P}>Thank you for adding Gift Aid to your donation. It lets us claim an extra 25p for every pound, at no cost to you. Gift Aid can't be claimed on ticket sales, because you receive a meal and entertainment in return.</p>`
    : "";

  const body = `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">A night to remember</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">You're coming to the ball!</h1>

  <p ${P}>Thank you, ${name}. Your booking is confirmed, and we're delighted you're joining us on Saturday 7th November.</p>

  ${factsCard(
    `<tr><td style="padding:14px 18px 4px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">Booking reference</td></tr>
    <tr><td style="padding:0 18px 12px;font-family:${HEAD};font-size:22px;font-weight:800;color:${MAROON};letter-spacing:.04em;">${escapeHtml(booking.reference)}</td></tr>
    <tr><td style="padding:0 18px 16px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;">You have booked <b>${what}</b>.</td></tr>`,
  )}

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 4px;">${rowsHtml}</table>

  ${giftAidHtml}

  <h2 ${H2}>The night</h2>
  <p ${P}><b>Saturday 7th November 2026</b><br />The Park Hotel, Rugby Park, Kilmarnock</p>
  <p ${P}>${arrival}</p>
  <p ${P}>${includes}</p>
  <p ${P}><b>Entertainment:</b> ${lineUpSentence()}</p>
  <p ${P}>Dress to impress. This is an over 18s event.</p>
  ${details.calendarUrl
    ? `<p ${P}><a href="${escapeHtml(details.calendarUrl)}" ${LINK}>Add it to your calendar</a></p>`
    : ""}

  ${details.guestLink
    ? `<h2 ${H2}>Next: tell us who's coming</h2>
  <p ${P}>Let us know who's coming and anything they can't eat, so the venue can look after everyone properly. You can save what you know and come back to it.</p>
  <p ${P}><a href="${escapeHtml(details.guestLink)}" ${LINK}>Add your guests</a></p>`
    : `<h2 ${H2}>Next: tell us who's coming</h2>
  <p ${P}>Nearer the time we'll ask for your guests' names and any dietary or access requirements, so the venue can look after everyone properly.</p>`}

  <h2 ${H2}>If your plans change</h2>
  <p ${P}>Tickets are non-refundable, but they are transferable. Just tell us the new guest's name and we'll update the door list. If the event is cancelled and not rescheduled, you'll be refunded in full.</p>

  ${contactPanel()}`;

  const moneyText = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const giftAidText = booking.giftAid
    ? `\nThank you for adding Gift Aid to your donation. It lets us claim an extra 25p
for every pound, at no cost to you. Gift Aid can't be claimed on ticket sales,
because you receive a meal and entertainment in return.\n`
    : "";

  const text = `YOU'RE COMING TO THE BALL

Thank you, ${booking.buyerName}. Your booking is confirmed, and we're delighted
you're joining us on Saturday 7th November.

Booking reference: ${booking.reference}
You have booked ${what}.

${moneyText}
${giftAidText}
THE NIGHT
Saturday 7th November 2026
The Park Hotel, Rugby Park, Kilmarnock
${details.arrivalTime ?? "From 7pm, to be confirmed. We'll email you"}
${includesText}
Entertainment: ${lineUpSentence()}
Dress to impress. This is an over 18s event.${details.calendarUrl ? `
Add it to your calendar: ${details.calendarUrl}` : ""}

${details.guestLink
    ? `NEXT: TELL US WHO'S COMING
Let us know who's coming and anything they can't eat, so the venue
can look after everyone properly. Save what you know and come back to it:
${details.guestLink}`
    : `NEXT: TELL US WHO'S COMING
Nearer the time we'll ask for your guests' names and any dietary or access
requirements, so the venue can look after everyone properly.`}

IF YOUR PLANS CHANGE
Tickets are non-refundable, but they are transferable. Just tell us the new
guest's name and we'll update the door list. If the event is cancelled and not
rescheduled, you'll be refunded in full.

${BALL_TEXT_FOOTER}`;

  return {
    subject: `You're coming to the ball! Booking ${booking.reference}`,
    html: ballEmailShell(body),
    text,
  };
}
