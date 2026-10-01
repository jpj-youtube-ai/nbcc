import { config } from "../config";
import { sendBallConfirmation, sendBallTransfer } from "../clients/email";
import { getSettings } from "../db/ball";
import { buildBallConfirmationEmail } from "./confirmation-email";
import {
  buildTransferDetailsEmail,
  buildTransferCancelledEmail,
  buildTransferReminderEmail,
  type TransferEmailBooking,
} from "./transfer-email";
import type { BallBookingWrite } from "./booking";
import type { BankDetails } from "./transfer";

// TASK-484: sending the bank transfer emails. Each is best effort and runs after the booking is
// committed, like the card confirmation in src/db/stripe-webhook.ts: the booking stands whether or
// not the email goes, and a failed send is logged, never turned into an error for the buyer or the
// admin who pressed the button.

const base = () => config.BALL_BASE_URL.replace(/\/+$/, "");

function logFailure(what: string, err: unknown): void {
  console.error(`ball ${what} email failed:`, err instanceof Error ? err.message : err);
}

/** How to pay: the bank details, the amount, the reference and the date. */
export async function sendTransferDetails(
  booking: TransferEmailBooking & { buyerEmail: string },
  bank: BankDetails,
  payBy: string,
): Promise<void> {
  try {
    const mail = buildTransferDetailsEmail(booking, bank, payBy);
    await sendBallTransfer({
      email: booking.buyerEmail,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer details", err);
  }
}

/**
 * TASK-485: the reminder two days before the date. Unlike the others this one THROWS on failure, so
 * the daily pass leaves it unmarked and tomorrow's run tries again.
 */
export async function sendTransferReminder(
  booking: TransferEmailBooking & { buyerEmail: string },
  bank: BankDetails,
  payBy: string,
): Promise<void> {
  const mail = buildTransferReminderEmail(booking, bank, payBy);
  await sendBallTransfer({
    email: booking.buyerEmail,
    from: config.BALL_FROM_EMAIL,
    replyTo: config.BALL_FROM_EMAIL,
    ...mail,
  });
}

/** Their unpaid booking was cancelled by staff. */
export async function sendTransferCancelled(booking: TransferEmailBooking & { buyerEmail: string }): Promise<void> {
  try {
    const mail = buildTransferCancelledEmail(booking);
    await sendBallTransfer({
      email: booking.buyerEmail,
      from: config.BALL_FROM_EMAIL,
      replyTo: config.BALL_FROM_EMAIL,
      ...mail,
    });
  } catch (err) {
    logFailure("transfer cancelled", err);
  }
}

/** An admin marked the money arrived: the ordinary confirmation, with its guest link, and one line more. */
export async function sendTransferArrived(booking: BallBookingWrite, guestToken: string): Promise<void> {
  try {
    const settings = await getSettings();
    const mail = buildBallConfirmationEmail(booking, {
      arrivalTime: settings.arrivalTime,
      includedNote: settings.includedNote,
      guestLink: `${base()}/ball/guests/${guestToken}`,
      calendarUrl: `${base()}/ball/calendar.ics`,
      transferArrived: true,
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
}
