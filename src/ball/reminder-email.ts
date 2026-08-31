import { escapeHtml } from "./page";
import { FOOTER_HTML, FOOTER_TEXT } from "../legal/registration";
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

export function buildBallReminderEmail(
  booking: ReminderBooking,
  guests: GuestRow[],
  details: ReminderDetails,
): ReminderEmail {
  const named = guests.filter((g) => g.fullName.trim().length > 0);
  const missing = Math.max(0, booking.seats - named.length);
  const arrival = details.arrivalTime ?? "We'll confirm the start time shortly";

  const guestRowsHtml = named.length
    ? named
        .map((g) => {
          const notes = [g.dietary, g.accessNeeds]
            .filter((v): v is string => Boolean(v))
            .map(escapeHtml)
            .join(" · ");
          return (
            `<tr><td style="padding:6px 0;color:#333333;">${escapeHtml(g.fullName)}</td>` +
            `<td style="padding:6px 0;color:#6F6A66;text-align:right;">${notes || "None"}</td></tr>`
          );
        })
        .join("")
    : "";

  // Only nag about missing names when some are actually missing, and never make it the headline.
  const missingHtml =
    missing > 0 && details.guestLink
      ? `<p style="margin:0 0 16px;color:#333333;">There ${missing === 1 ? "is" : "are"} still ${missing} ${missing === 1 ? "place" : "places"} without a name. <a href="${escapeHtml(details.guestLink)}" style="color:#800000;font-weight:600;">Add them here</a> and we'll get the door list right.</p>`
      : "";

  const guestsHtml = named.length
    ? `<h2 style="margin:24px 0 10px;font-family:Georgia,serif;font-size:18px;color:#800000;">Your table</h2>
  <p style="margin:0 0 8px;color:#6F6A66;font-size:14px;">This is what we have. If anything's wrong, ${
    details.guestLink
      ? `<a href="${escapeHtml(details.guestLink)}" style="color:#800000;">change it here</a>`
      : "email us"
  }. It's not too late.</p>
  <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;">${guestRowsHtml}</table>`
    : "";

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#F8F5EE;">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8A6A26;font-weight:600;">A week to go</p>
  <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:24px;font-weight:600;color:#800000;">A Night to Remember is nearly here</h1>

  <p style="margin:0 0 16px;color:#333333;">Hello ${escapeHtml(greetingName(booking))}. Here's everything you need for Saturday.</p>

  <table role="presentation" style="width:100%;border-collapse:collapse;background:#FFFDFA;border:1px solid #E9DFD2;border-radius:8px;margin:0 0 20px;">
    <tr><td style="padding:14px 16px 4px;color:#6F6A66;font-size:13px;">When</td></tr>
    <tr><td style="padding:0 16px 10px;color:#333333;"><b>Saturday 7th November 2026</b><br />${escapeHtml(arrival)}</td></tr>
    <tr><td style="padding:0 16px 4px;color:#6F6A66;font-size:13px;">Where</td></tr>
    <tr><td style="padding:0 16px 10px;color:#333333;">The Park Hotel, Rugby Park, Kilmarnock</td></tr>
    <tr><td style="padding:0 16px 4px;color:#6F6A66;font-size:13px;">Booking</td></tr>
    <tr><td style="padding:0 16px 14px;color:#333333;"><b>${escapeHtml(booking.reference)}</b>${
      booking.tableName ? ` · ${escapeHtml(booking.tableName)}` : ""
    }</td></tr>
  </table>

  <p style="margin:0 0 16px;color:#333333;">Give your name at the welcome desk when you arrive. There's no ticket to print. Dress to impress. Over 18s only.${
    details.includedNote ? " " + escapeHtml(details.includedNote) : ""
  }</p>

  ${guestsHtml}
  ${missingHtml}

  <h2 style="margin:24px 0 10px;font-family:Georgia,serif;font-size:18px;color:#800000;">On the night</h2>
  <p style="margin:0 0 16px;color:#333333;">There'll be a charity auction and a raffle, with card machines on hand, so bring a little extra if you'd like to join in. Raffle tickets are sold on the night.</p>

  <p style="margin:0 0 20px;color:#333333;">Any questions, just reply to this email or call 01292 811 015, Monday to Friday. See you Saturday.</p>

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E9DFD2;color:#6F6A66;font-size:12px;line-height:1.6;">
    ${FOOTER_HTML}
  </div>
</div>`;

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

  const text = `A NIGHT TO REMEMBER: A WEEK TO GO

Hello ${greetingName(booking)}. Here's everything you need for Saturday.

WHEN   Saturday 7th November 2026
       ${arrival}
WHERE  The Park Hotel, Rugby Park, Kilmarnock
BOOKING ${booking.reference}${booking.tableName ? " · " + booking.tableName : ""}

Give your name at the welcome desk when you arrive. There's no ticket to
print. Dress to impress. Over 18s only.${details.includedNote ? " " + details.includedNote : ""}${guestsText}${missingText}

ON THE NIGHT
There'll be a charity auction and a raffle, with card machines on hand, so
bring a little extra if you'd like to join in. Raffle tickets are sold on the
night.

Any questions, just reply to this email or call 01292 811 015, Monday to
Friday. See you Saturday.

${FOOTER_TEXT}`;

  return {
    subject: `A week to go: your Festive Ball booking, ${booking.reference}`,
    html,
    text,
  };
}
