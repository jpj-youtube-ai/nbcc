import { escapeHtml } from "./page";
import { ballEmailShell, factsCard } from "./email-shell";
import { money, describe } from "./confirmation-email";
import { longDate, type TransferEmail, type TransferEmailBooking } from "./transfer-email";
import { MAROON, SLATE, SLATE_SOFT, HEAD, BODY_FONT, CRIMSON } from "../email/brand";

// TASK-487: the email to events@nbcc.scot for each new bank transfer booking, so the team knows a
// payment is on its way and what it will look like in the bank. Pure, like the buyer's emails: the
// sender (src/ball/transfer-send.ts) passes in the links. It goes to NBCC's own inbox only, so it
// carries the buyer's name and email, and Reply-To is the buyer.

export interface TransferStaffEmailOptions {
  payBy: string;
  /** The admin, where an admin marks the money arrived. */
  adminUrl: string;
  /** The company and its invoice, when the buyer asked for one. */
  invoice: { company: string; url: string } | null;
  /** TASK-488: the member of staff who added it for a phone or email order; absent from the website. */
  addedBy?: string | null;
}

const P = `style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px"`;
const LINK = `style="color:${CRIMSON};font-weight:700"`;

function factRow(label: string, value: string): string {
  return (
    `<tr><td style="padding:12px 18px 2px;color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;">${label}</td></tr>` +
    `<tr><td style="padding:0 18px 10px;font-family:${HEAD};font-size:16px;font-weight:700;color:${MAROON};">${value}</td></tr>`
  );
}

const addedByLine = (who: string) => `Added by ${who} in the admin, for a phone or email order.`;

export function buildTransferStaffEmail(
  booking: TransferEmailBooking & { buyerEmail: string },
  o: TransferStaffEmailOptions,
): TransferEmail {
  const what = describe(booking);
  const amount = money(booking.totalPence);
  const until = longDate(o.payBy);
  const name = escapeHtml(booking.buyerName);
  const adminUrl = escapeHtml(o.adminUrl);

  const rows =
    factRow("Payment reference", escapeHtml(booking.reference)) +
    factRow("Amount to arrive", amount) +
    factRow("To be paid by", until) +
    factRow("Buyer", `${name}<br />${escapeHtml(booking.buyerEmail)}`) +
    (o.invoice
      ? factRow(
          "Invoice to",
          `${escapeHtml(o.invoice.company)}<br /><a href="${escapeHtml(o.invoice.url)}" ${LINK}>View the invoice</a>`,
        )
      : "");

  const body = `<p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${SLATE_SOFT};font-weight:700">For the team</p>
  <h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 14px">New bank transfer booking</h1>
  <p ${P}>${name} has booked <b>${what}</b> to pay by bank transfer. Their seats are held until the money arrives or the booking is cancelled.</p>
  ${o.addedBy ? `<p ${P}>${escapeHtml(addedByLine(o.addedBy))}</p>` : ""}
  ${factsCard(rows)}
  <p ${P}>When the money arrives, an admin marks it paid under Festive Ball, Awaiting transfer. That sends ${name} their confirmation and the link to add their guests.</p>
  <p ${P}><a href="${adminUrl}" ${LINK}>Open the admin</a></p>
  <p ${P}>Replying to this email replies to ${name}.</p>`;

  const text = [
    "NEW BANK TRANSFER BOOKING",
    "",
    `${booking.buyerName} has booked ${what} to pay by bank transfer. Their seats are held until`,
    "the money arrives or the booking is cancelled.",
    ...(o.addedBy ? ["", addedByLine(o.addedBy)] : []),
    "",
    `Payment reference: ${booking.reference}`,
    `Amount to arrive: ${amount}`,
    `To be paid by: ${until}`,
    `Buyer: ${booking.buyerName}, ${booking.buyerEmail}`,
    ...(o.invoice ? [`Invoice to: ${o.invoice.company}`, `View the invoice: ${o.invoice.url}`] : []),
    "",
    "When the money arrives, an admin marks it paid under Festive Ball, Awaiting transfer. That sends",
    "them their confirmation and the link to add their guests.",
    "",
    `Open the admin: ${o.adminUrl}`,
    "",
    `Replying to this email replies to ${booking.buyerName}.`,
  ].join("\n");

  return {
    // One line, whatever was typed into the name box.
    subject: `New bank transfer booking: ${booking.reference}, ${amount}, ${booking.buyerName.replace(/\s+/g, " ").trim()}`,
    html: ballEmailShell(body),
    text,
  };
}
