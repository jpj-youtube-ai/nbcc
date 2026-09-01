import { config } from "../config";
import {
  listBookingsForRunUp,
  markRunUpSent,
  getSettings,
  listGuestsForBooking,
} from "../db/ball";
import { sendBallRunUp } from "../clients/email";
import { buildGuestChaseEmail } from "./run-up-email";
import { buildBallReminderEmail } from "./reminder-email";
import { runRunUpPass, type RunUpBooking, type RunUpStage, type RunUpPassResult } from "./run-up";

// TASK-338: the wiring for the daily run-up pass. The schedule itself is the pure ./run-up.ts;
// this file only connects it to the pool, the mailer and the config, the same split as
// src/business/reminders.ts and its script.

// The ball itself. A constant rather than a setting: the date is printed on an advert that is
// already in a magazine, so it is not a thing staff can change from a form.
export const BALL_EVENT_DATE = new Date("2026-11-07T19:00:00Z");

const guestLink = (token: string) =>
  `${config.BALL_BASE_URL.replace(/\/+$/, "")}/ball/guests/${token}`;

export async function sendRunUpEmail(booking: RunUpBooking, stage: RunUpStage): Promise<void> {
  const settings = await getSettings();

  // The practical email a few days out is the existing week-before template — same content, same
  // read-back of their guests. What changes in TASK-338 is only that it goes out on a schedule
  // rather than when somebody remembers to press a button.
  const mail =
    stage === "practical"
      ? buildBallReminderEmail(
          {
            reference: booking.reference,
            buyerName: booking.buyerName,
            buyerFirstName: booking.buyerFirstName,
            seats: booking.seats,
            tableName: booking.tableName,
          },
          // Read back to them what we hold, so somebody whose allergy was taken down wrongly
          // finds out now rather than being handed a bread roll on the night.
          await listGuestsForBooking(booking.id),
          {
            arrivalTime: settings.arrivalTime,
            includedNote: settings.includedNote,
            guestLink: booking.guestToken ? guestLink(booking.guestToken) : null,
          },
        )
      : buildGuestChaseEmail({
          buyerFirstName: booking.buyerFirstName || "there",
          reference: booking.reference,
          seats: booking.seats,
          guestsNamed: booking.guestsNamed,
          guestLink: guestLink(booking.guestToken as string),
          // Only reachable with a lock date set: stageFor returns null without one.
          lockAt: new Date(settings.guestDetailsLockAt as string),
          finalCall: stage === "final-call",
        });

  await sendBallRunUp({
    email: booking.buyerEmail,
    from: config.BALL_FROM_EMAIL,
    replyTo: config.BALL_FROM_EMAIL,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
}

export async function runBallRunUp(now = new Date()): Promise<RunUpPassResult> {
  const settings = await getSettings();
  return runRunUpPass({
    listBookings: listBookingsForRunUp,
    send: sendRunUpEmail,
    markSent: markRunUpSent,
    window: {
      now,
      eventDate: BALL_EVENT_DATE,
      lockAt: settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : null,
    },
  });
}
