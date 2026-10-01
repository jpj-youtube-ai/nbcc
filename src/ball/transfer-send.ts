import { config } from "../config";
import { sendBallConfirmation, sendBallTransfer, sendBallTransferStaff } from "../clients/email";
import { buildTransferStaffEmail } from "./transfer-staff-email";
import { getSettings } from "../db/ball";
import type { InvoiceContact } from "../db/ball-transfer";
import { buildBallConfirmationEmail } from "./confirmation-email";
import {
  buildTransferDetailsEmail,
  buildTransferCancelledEmail,
  buildTransferReminderEmail,
  buildInvoicePaidEmail,
  type TransferEmailBooking,
} from "./transfer-email";
import type { BallBookingWrite } from "./booking";
import { invoiceCc, type BankDetails } from "./transfer";
import { signInvoiceToken } from "./invoice-token";

// TASK-484: sending the bank transfer emails. Each is best effort and runs after the booking is
// committed, like the card confirmation in src/db/stripe-webhook.ts: the booking stands whether or
// not the email goes, and a failed send is logged, never turned into an error for the buyer or the
// admin who pressed the button.
//
// TASK-486: a booking with an invoice links it from every one of these. The bank details, reminder
// and cancelled emails copy the company's accounts team when the buyer gave an address for them;
// once paid, the accounts team gets an email of its own instead (TASK-489).

const base = () => config.BALL_BASE_URL.replace(/\/+$/, "");

type Recipient = TransferEmailBooking & { buyerEmail: string; invoice?: InvoiceContact | null };

/** The private link to a booking's invoice page. */
export function invoiceUrl(bookingId: number): string {
  return `${base()}/ball/invoice/${signInvoiceToken(bookingId, config.ADMIN_SESSION_SECRET)}`;
}

function invoiceParts(invoice: InvoiceContact | null | undefined, buyerEmail: string) {
  if (!invoice) return { invoiceUrl: null, cc: undefined };
  return { invoiceUrl: invoiceUrl(invoice.bookingId), cc: invoiceCc(invoice.accountsEmail, buyerEmail) };
}

function logFailure(what: string, err: unknown): void {
  console.error(`ball ${what} email failed:`, err instanceof Error ? err.message : err);
}

/** How to pay: the bank details, the amount, the reference and the date. */
export async function sendTransferDetails(booking: Recipient, bank: BankDetails, payBy: string): Promise<void> {
  try {
    const { invoiceUrl: url, cc } = invoiceParts(booking.invoice, booking.buyerEmail);
    const mail = buildTransferDetailsEmail(booking, bank, payBy, { invoiceUrl: url });
    await sendBallTransfer({
      email: booking.buyerEmail,
      cc,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer details", err);
  }
}

/**
 * TASK-487: tell the team at events@ about a new booking, so they know a payment is on its way.
 * Reply-To is the buyer, so answering it reaches them.
 */
export async function sendTransferStaffNotice(
  booking: TransferEmailBooking & { buyerEmail: string; invoice: { bookingId: number; company: string } | null },
  payBy: string,
  addedBy: string | null = null,
): Promise<void> {
  try {
    const mail = buildTransferStaffEmail(booking, {
      payBy,
      addedBy,
      adminUrl: `${base()}/admin`,
      invoice: booking.invoice ? { company: booking.invoice.company, url: invoiceUrl(booking.invoice.bookingId) } : null,
    });
    await sendBallTransferStaff({
      email: config.BALL_FROM_EMAIL,
      from: config.BALL_FROM_EMAIL,
      replyTo: booking.buyerEmail,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer staff notice", err);
  }
}

/**
 * TASK-485: the reminder two days before the date. Unlike the others this one THROWS on failure, so
 * the daily pass leaves it unmarked and tomorrow's run tries again.
 */
export async function sendTransferReminder(booking: Recipient, bank: BankDetails, payBy: string): Promise<void> {
  const { invoiceUrl: url, cc } = invoiceParts(booking.invoice, booking.buyerEmail);
  const mail = buildTransferReminderEmail(booking, bank, payBy, { invoiceUrl: url });
  await sendBallTransfer({
    email: booking.buyerEmail,
    cc,
    from: config.BALL_FROM_EMAIL,
    replyTo: config.BALL_FROM_EMAIL,
    ...mail,
  });
}

/** Their unpaid booking was cancelled by staff. */
export async function sendTransferCancelled(booking: Recipient): Promise<void> {
  try {
    const { invoiceUrl: url, cc } = invoiceParts(booking.invoice, booking.buyerEmail);
    const mail = buildTransferCancelledEmail(booking, { invoiceUrl: url });
    await sendBallTransfer({
      email: booking.buyerEmail,
      cc,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer cancelled", err);
  }
}

/** An admin marked the money arrived: the ordinary confirmation, with its guest link, and one line more. */
export async function sendTransferArrived(
  booking: BallBookingWrite,
  guestToken: string,
  invoice: InvoiceContact | null = null,
): Promise<void> {
  // TASK-489: Jaimie's choice. The confirmation carries the private link to add the guests, so it
  // goes to the buyer alone; the accounts team gets an email of its own, sent apart so that one
  // failing never stops the other.
  let url: string | null = null;
  let accountsEmail: string | undefined;
  try {
    ({ invoiceUrl: url, cc: accountsEmail } = invoiceParts(invoice, booking.buyerEmail));
  } catch (err) {
    logFailure("invoice link", err);
  }
  try {
    const settings = await getSettings();
    const mail = buildBallConfirmationEmail(booking, {
      arrivalTime: settings.arrivalTime,
      includedNote: settings.includedNote,
      guestLink: `${base()}/ball/guests/${guestToken}`,
      calendarUrl: `${base()}/ball/calendar.ics`,
      transferArrived: true,
      invoiceUrl: url,
    });
    await sendBallConfirmation({
      email: booking.buyerEmail,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer arrived", err);
  }
  if (!url || !accountsEmail) return;
  try {
    await sendBallTransfer({
      email: accountsEmail,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...buildInvoicePaidEmail(booking, { invoiceUrl: url }),
    });
  } catch (err) {
    logFailure("invoice paid", err);
  }
}
