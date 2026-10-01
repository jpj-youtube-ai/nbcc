import type { BallBookingWrite } from "./booking";
import type { BankDetails } from "./transfer";
import { escapeHtml } from "./page";
import { ballEmailShell, contactPanel, factsCard, BALL_TEXT_FOOTER } from "./email-shell";
import { money, describe } from "./confirmation-email";
import { MAROON, SLATE, SLATE_SOFT, TAN_SOFT, HEAD, BODY_FONT, CRIMSON } from "../email/brand";

// TASK-484: the emails a bank transfer buyer gets before their money arrives. Pure, like
// confirmation-email.ts: no pool, no config, no clock. The confirmation itself, once an admin marks
// the transfer arrived, is the ordinary "You're coming to the ball!" email with one line added.
//
// The bank details email is the only place, besides the screen straight after booking, that a buyer
// is given the account. It carries everything needed to pay without coming back to us: the exact
// amount, the account, the reference, and the date the seats are held until.

export type TransferEmailBooking = Pick<
  BallBookingWrite,
  "reference" | "kind" | "quantity" | "seats" | "buyerName" | "ticketsPence" | "donationPence" | "totalPence" | "giftAid"
>;

export interface TransferEmail {
  subject: string;
  html: string;
  text: string;
}

/** "2026-10-08" as "Thursday 8 October". Noon UTC, so no time zone can move it a day. */
export function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const H2 = `style="color:${MAROON};font-family:${HEAD};font-size:18px;font-weight:700;margin:26px 0 10px"`;

function factRow(label: string, value: string, big = false): string {
  const size = big ? "font-size:20px;font-weight:800;letter-spacing:.04em;" : "font-size:16px;font-weight:700;";
  return (
    `<tr><td style="padding:12px 18px 2px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">${label}</td></tr>` +
    `<tr><td style="padding:0 18px 10px;font-family:${HEAD};${size}color:${MAROON};">${value}</td></tr>`
  );
}

export function buildTransferDetailsEmail(
  booking: TransferEmailBooking,
  bank: BankDetails,
  payBy: string,
): TransferEmail {
  const name = escapeHtml(booking.buyerName);
  const what = describe(booking);
  const until = longDate(payBy);
  const amount = money(booking.totalPence);

  // The money as on the confirmation: only lines that exist, then the total.
  const rows: Array<[string, string]> = [["Tickets", money(booking.ticketsPence)]];
  if (booking.donationPence > 0) rows.push(["Donation to NBCC", money(booking.donationPence)]);
  rows.push(["Total to pay", amount]);
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

  const giftAidHtml = booking.giftAid
    ? `<p ${P}>Thank you for adding Gift Aid to your donation. It lets us claim an extra 25p for every pound, at no cost to you. Gift Aid can't be claimed on ticket sales, because you receive a meal and entertainment in return.</p>`
    : "";

  const body = `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">The Festive Ball</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:26px;font-weight:800;margin:0 0 14px;letter-spacing:-.01em">Thank you, ${name}. Your seats are held</h1>

  <p ${P}>You have booked <b>${what}</b>. Your seats are held for you until <b>${until}</b>. Please pay by bank transfer by then.</p>

  ${factsCard(
    factRow("Amount to pay", amount, true) +
      factRow("Account name", escapeHtml(bank.accountName)) +
      factRow("Sort code", escapeHtml(bank.sortCode)) +
      factRow("Account number", escapeHtml(bank.accountNumber)) +
      factRow("Payment reference", escapeHtml(booking.reference), true),
  )}

  <p ${P}>Please use the reference exactly as it is written, so we can match your payment to your booking.</p>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 4px;">${rowsHtml}</table>

  ${giftAidHtml}

  <h2 ${H2}>What happens next</h2>
  <p ${P}>As soon as your payment arrives we'll email to confirm your booking, with a link to tell us who's coming.</p>

  ${contactPanel()}`;

  const moneyText = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
  const giftAidText = booking.giftAid
    ? `\nThank you for adding Gift Aid to your donation. It lets us claim an extra 25p
for every pound, at no cost to you. Gift Aid can't be claimed on ticket sales,
because you receive a meal and entertainment in return.\n`
    : "";

  const text = `THANK YOU, ${booking.buyerName.toUpperCase()}. YOUR SEATS ARE HELD

You have booked ${what}. Your seats are held for you until ${until}.
Please pay by bank transfer by then.

Amount to pay: ${amount}
Account name: ${bank.accountName}
Sort code: ${bank.sortCode}
Account number: ${bank.accountNumber}
Payment reference: ${booking.reference}

Please use the reference exactly as it is written, so we can match your
payment to your booking.

${moneyText}
${giftAidText}
WHAT HAPPENS NEXT
As soon as your payment arrives we'll email to confirm your booking, with a
link to tell us who's coming.

${BALL_TEXT_FOOTER}`;

  return {
    subject: `How to pay for your Festive Ball booking ${booking.reference}`,
    html: ballEmailShell(body),
    text,
  };
}

export function buildTransferCancelledEmail(booking: TransferEmailBooking): TransferEmail {
  const name = escapeHtml(booking.buyerName);
  const ref = escapeHtml(booking.reference);

  const body = `<h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 14px">Your booking has been cancelled</h1>
  <p ${P}>Hello ${name}. We hadn't received payment for booking <b>${ref}</b>, so we've cancelled it and released the seats.</p>
  <p ${P}>If you have already paid, or would still like to come, reply to this email and we'll sort it out.</p>
  ${contactPanel()}`;

  const text = `YOUR BOOKING HAS BEEN CANCELLED

Hello ${booking.buyerName}. We hadn't received payment for booking ${booking.reference},
so we've cancelled it and released the seats.

If you have already paid, or would still like to come, reply to this email and
we'll sort it out.

${BALL_TEXT_FOOTER}`;

  return {
    subject: `Your Festive Ball booking ${booking.reference} has been cancelled`,
    html: ballEmailShell(body),
    text,
  };
}
