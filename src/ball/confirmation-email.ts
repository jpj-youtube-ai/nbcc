import type { BallBookingWrite } from "./booking";
import { escapeHtml } from "./page";
import { FOOTER_HTML, FOOTER_TEXT } from "../legal/registration";

// TASK-313: the booking confirmation for a Festive Ball ticket. Pure — no pool, no config, no
// network, no clock — so it is unit-tested DB-free, mirroring src/business/invite-email.ts.
// The thin send wrapper lives in src/clients/email.ts and the webhook calls it POST-commit.
//
// Someone has just paid up to £1,000. This email is the only thing they have to show for it
// until November, so it carries the reference, the money broken down, and every practical
// detail we actually know — and says plainly where we do not know yet, rather than leaving a
// gap they have to email us about.

export interface BallEventDetails {
  arrivalTime: string | null;
  includedNote: string | null;
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

export function buildBallConfirmationEmail(
  booking: BallBookingWrite,
  details: BallEventDetails,
): BallConfirmationEmail {
  const what = describe(booking);
  const name = escapeHtml(booking.buyerName);
  const arrival = details.arrivalTime
    ? escapeHtml(details.arrivalTime)
    : "Start time to be confirmed — we'll email you";
  const included = details.includedNote
    ? ` ${escapeHtml(details.includedNote)}`
    : " The menu and drinks are still being finalised with the venue; we'll email you as soon as they're confirmed.";

  // Only show a money line that exists. A "Donation: £0.00" row is noise on a receipt.
  const rows: Array<[string, string]> = [["Tickets", money(booking.ticketsPence)]];
  if (booking.donationPence > 0) rows.push(["Donation to NBCC", money(booking.donationPence)]);
  if (booking.feeCoverPence > 0) rows.push(["Card fee covered", money(booking.feeCoverPence)]);
  rows.push(["Total paid", money(booking.totalPence)]);

  const rowsHtml = rows
    .map(([label, value], i) => {
      const last = i === rows.length - 1;
      const weight = last ? "font-weight:600;" : "";
      const border = last ? "border-top:1px solid #E9DFD2;" : "";
      return (
        `<tr><td style="padding:8px 0;${border}${weight}color:#333333;">${label}</td>` +
        `<td style="padding:8px 0;${border}${weight}color:#333333;text-align:right;">${value}</td></tr>`
      );
    })
    .join("");

  const giftAidHtml = booking.giftAid
    ? `<p style="margin:0 0 16px;color:#333333;">Thank you for adding Gift Aid to your donation — it lets us claim an extra 25p for every pound, at no cost to you. Gift Aid can't be claimed on ticket sales, because you receive a meal and entertainment in return.</p>`
    : `<p style="margin:0 0 16px;color:#6F6A66;font-size:14px;">Gift Aid can't be claimed on ticket sales, because you receive a meal and entertainment in return. It can be claimed on a donation, if you'd like to add one.</p>`;

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#F8F5EE;">
  <p style="margin:0 0 4px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8A6A26;font-weight:600;">A Night to Remember</p>
  <h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:24px;font-weight:600;color:#800000;">You're coming to the Festive Ball</h1>

  <p style="margin:0 0 16px;color:#333333;">Thank you, ${name}. Your booking is confirmed.</p>

  <table role="presentation" style="width:100%;border-collapse:collapse;background:#FFFDFA;border:1px solid #E9DFD2;border-radius:8px;padding:16px;margin:0 0 20px;">
    <tr><td style="padding:12px 16px 4px;color:#6F6A66;font-size:13px;">Booking reference</td></tr>
    <tr><td style="padding:0 16px 12px;font-size:20px;font-weight:600;color:#800000;letter-spacing:.04em;">${booking.reference}</td></tr>
    <tr><td style="padding:0 16px 12px;color:#333333;">You have booked <b>${what}</b>.</td></tr>
  </table>

  <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 20px;">${rowsHtml}</table>

  ${giftAidHtml}

  <h2 style="margin:24px 0 10px;font-family:Georgia,serif;font-size:18px;color:#800000;">The night</h2>
  <p style="margin:0 0 6px;color:#333333;"><b>Saturday 7 November 2026</b><br />The Park Hotel, Rugby Park, Kilmarnock</p>
  <p style="margin:0 0 6px;color:#333333;">${arrival}</p>
  <p style="margin:0 0 6px;color:#333333;">Dress to impress. This is an over 18s event.</p>
  <p style="margin:0 0 16px;color:#333333;">Your ticket includes entry, a meal and the evening's entertainment.${included}</p>

  <p style="margin:0 0 16px;color:#333333;">Nearer the time we'll ask for your guests' names and any dietary or access requirements, so the venue can look after everyone properly.</p>

  <h2 style="margin:24px 0 10px;font-family:Georgia,serif;font-size:18px;color:#800000;">If your plans change</h2>
  <p style="margin:0 0 16px;color:#333333;">Tickets are non-refundable, but they are transferable — just tell us the new guest's name and we'll update the door list. If the event is cancelled and not rescheduled, you'll be refunded in full.</p>

  <p style="margin:0 0 20px;color:#333333;">Any questions, just reply to this email or call 01292 811 015, Monday to Friday.</p>

  <p style="margin:0 0 20px;color:#6F6A66;font-size:14px;">The ball is organised and sponsored by The Designer Rooms, who are covering the full cost of the evening, so your ticket funds NBCC's work rather than the party.</p>

  <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E9DFD2;color:#6F6A66;font-size:12px;line-height:1.6;">
    ${FOOTER_HTML}
  </div>
</div>`;

  const moneyText = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const text = `A NIGHT TO REMEMBER — FESTIVE BALL 2026

Thank you, ${booking.buyerName}. Your booking is confirmed.

Booking reference: ${booking.reference}
You have booked ${what}.

${moneyText}

THE NIGHT
Saturday 7 November 2026
The Park Hotel, Rugby Park, Kilmarnock
${details.arrivalTime ?? "Start time to be confirmed — we'll email you"}
Dress to impress. This is an over 18s event.
Your ticket includes entry, a meal and the evening's entertainment.${
    details.includedNote
      ? " " + details.includedNote
      : " The menu and drinks are still being finalised with the venue; we'll email you as soon as they're confirmed."
  }

Nearer the time we'll ask for your guests' names and any dietary or access
requirements, so the venue can look after everyone properly.

IF YOUR PLANS CHANGE
Tickets are non-refundable, but they are transferable — just tell us the new
guest's name and we'll update the door list. If the event is cancelled and not
rescheduled, you'll be refunded in full.

Gift Aid cannot be claimed on ticket sales, because you receive a meal and
entertainment in return. It can be claimed on a donation.

Any questions, just reply to this email or call 01292 811 015, Monday to Friday.

The ball is organised and sponsored by The Designer Rooms, who are covering the
full cost of the evening, so your ticket funds NBCC's work rather than the party.

${FOOTER_TEXT}`;

  return {
    subject: `Your Festive Ball booking, ${booking.reference}`,
    html,
    text,
  };
}
