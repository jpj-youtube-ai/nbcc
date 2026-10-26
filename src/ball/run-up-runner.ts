import { config } from "../config";
import {
  listBookingsForRunUp,
  markRunUpSent,
  getSettings,
  listGuestsForBooking,
} from "../db/ball";
import { sendBallRunUp } from "../clients/email";
import { buildBallReminderEmail } from "./reminder-email";
import { daysToBall, runRunUpPass, type RunUpBooking, type RunUpStage, type RunUpPassResult } from "./run-up";

// TASK-338: the wiring for the daily run-up pass. The schedule itself is the pure ./run-up.ts;
// this file only connects it to the pool, the mailer and the config, the same split as
// src/business/reminders.ts and its script.

// The ball itself. A constant rather than a setting: the date is printed on an advert that is
// already in a magazine, so it is not a thing staff can change from a form.
export const BALL_EVENT_DATE = new Date("2026-11-07T19:00:00Z");

export const guestLink = (token: string) =>
  `${config.BALL_BASE_URL.replace(/\/+$/, "")}/ball/guests/${token}`;

export async function sendRunUpEmail(booking: RunUpBooking, stage: RunUpStage, now = new Date()): Promise<void> {
  // TASK-575: the guest list nudge and the last call are retired, and the planner never asks for
  // them. If one ever arrives here it is a mistake to hear about (the pass counts it as failed and
  // stamps nothing), not something to send as if it were the week-to-go email.
  if (stage !== "practical") throw new Error(`The ${stage} email is retired.`);

  const settings = await getSettings();

  // The practical email a few days out is the existing week-before template — same content, same
  // read-back of their guests. What changes in TASK-338 is only that it goes out on a schedule
  // rather than when somebody remembers to press a button.
  const mail = buildBallReminderEmail(
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
      // The true time to go on the day it is sent: "A week to go" a week before, otherwise
      // "4 days to go" or "Tomorrow" (a booking made in the last week).
      daysToGo: daysToBall(now, BALL_EVENT_DATE),
    },
  );

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
    send: (booking, stage) => sendRunUpEmail(booking, stage, now),
    markSent: markRunUpSent,
    window: {
      now,
      eventDate: BALL_EVENT_DATE,
      lockAt: settings.guestDetailsLockAt ? new Date(settings.guestDetailsLockAt) : null,
    },
  });
}
