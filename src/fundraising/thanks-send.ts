import { config } from "../config";
import { sendFundraiseSupporterThanks } from "../clients/email";
import { suppressedAmong } from "../db/email-suppressions";
import { optedOutAmong } from "../db/email-opt-outs";
import {
  claimNextQueuedThanksGift,
  failStaleSending,
  finishThanksGift,
  markThanksDeliveredIfDone,
  undeliveredDoneThanks,
  type QueuedThanksGift,
} from "../db/fundraiser-thanks";
import { buildSupporterThanksEmail } from "./thanks-email";
import { memorySender } from "./emails";
import { giftNoLongerThankable, recipientVerdict, type SkipReason } from "./thanks";

// TASK-507: sending the thank yous staff approved (email 20), in the background after the admin has
// their answer, like TASK-497's emails at the switch on (sendWaitingLiveEmails in ./send.ts).
//
//   - One gift at a time: each is claimed (made "sending") just before its email, so two runs never
//     take the same one, and a restart part way loses at most the one in flight (marked failed at
//     the next run, never sent twice).
//   - Before each email, the gift is checked again (not refunded in full, not money the organiser
//     paid in, its fundraiser still approved or finished), then the giver, by address, at that
//     moment: an address at all, the suppression list (hard bounces, spam complaints, stopped by
//     staff), and the opt out list (Stop all emails, or thank yous turned off). A list that cannot be
//     read means no email. One person whose several gifts were picked gets this thank you once, even
//     with two senders at work (an earlier claim for the same address counts as sent).
//   - From and Reply-To are the events inbox (config.BALL_FROM_EMAIL), or Jodie's address for a page
//     in memory of someone (memorySender in ./emails.ts), so a reply goes to NBCC, never to the
//     organiser; nothing about the giver goes back to them.
//   - A failed send is recorded and the run goes on. Nothing here ever throws: everything is logged.
//   - Each run ends by marking delivered any approved thank you with nothing left to send (one whose
//     mark failed, or whose gifts all went with their donations), so none says "Sending now" for good.
//   - Only one run at a time in this process. Asked again while one is going, it says so and returns;
//     the run going round again picks up whatever was approved meanwhile.

let running = false;
let again = false;

type Tally = { sent: number; skipped: number; failed: number };

function logFailure(what: string, err: unknown): void {
  console.error(`fundraising thank you ${what}:`, err instanceof Error ? err.message : err);
}

async function decide(g: QueuedThanksGift): Promise<{ send: true } | { send: false; reason: SkipReason } | null> {
  const gone = giftNoLongerThankable(g);
  if (gone) return { send: false, reason: gone };
  if (g.alreadySent) return { send: false, reason: "duplicate" };
  let suppressed = false;
  let optedOut = false;
  if (g.email && g.email.trim() !== "") {
    const address = g.email.trim().toLowerCase();
    try {
      const [blocked, stopped] = await Promise.all([suppressedAmong([g.email]), optedOutAmong([g.email])]);
      suppressed = blocked.has(address);
      optedOut = stopped.has(address);
    } catch (err) {
      // Cannot tell whether we may email them: then we do not.
      logFailure("suppression or opt out check failed", err);
      return null;
    }
  }
  return recipientVerdict(g, suppressed, optedOut);
}

async function sendOne(g: QueuedThanksGift, tally: Tally): Promise<void> {
  let outcome: "sent" | "skipped" | "failed" = "failed";
  let reason: SkipReason | null = null;
  try {
    const verdict = await decide(g);
    if (verdict && !verdict.send) {
      outcome = "skipped";
      reason = verdict.reason;
    } else if (verdict && verdict.send && g.email) {
      // The giver's name is only used to greet them on a page in memory of someone ("Dear Sam,").
      // The keep in touch links are built on PORTAL_BASE_URL, the public site address the other
      // fundraising emails use. They are the plain pages: nothing about the giver is in them.
      const mail = buildSupporterThanksEmail({ organiserName: g.organiserName, title: g.title, message: g.message, baseUrl: config.PORTAL_BASE_URL, inMemory: g.inMemory === true, giverName: g.donorName });
      // From a page in memory of someone, it comes from Jodie and replies go to Jodie.
      const sender = g.inMemory === true ? memorySender() : { from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL };
      await sendFundraiseSupporterThanks(g.donorName, { email: g.email, ...sender, ...mail });
      outcome = "sent";
    }
  } catch (err) {
    logFailure("email failed", err);
    outcome = "failed";
  }
  tally[outcome] += 1;
  try {
    await finishThanksGift(g.id, outcome, reason);
    await markThanksDeliveredIfDone(g.thanksId);
  } catch (err) {
    logFailure("could not record what happened", err);
  }
}

// Mark delivered every approved thank you with nothing left to send that never was: its last mark
// failed, or its gifts all went with their donations before staff approved it.
async function closeFinished(): Promise<void> {
  try {
    for (const thanksId of await undeliveredDoneThanks()) await markThanksDeliveredIfDone(thanksId);
  } catch (err) {
    logFailure("could not close finished thank yous", err);
  }
}

async function runOnce(tally: Tally): Promise<void> {
  try {
    await failStaleSending();
  } catch (err) {
    logFailure("could not tidy up after a restart", err);
  }
  for (;;) {
    let g: QueuedThanksGift | null;
    try {
      g = await claimNextQueuedThanksGift();
    } catch (err) {
      logFailure("run stopped", err);
      break;
    }
    if (!g) break;
    await sendOne(g, tally);
  }
  await closeFinished();
}

/** Send every queued thank you gift, one at a time. Never throws. */
export async function sendQueuedThanks(): Promise<Tally> {
  const tally: Tally = { sent: 0, skipped: 0, failed: 0 };
  if (running) {
    again = true;
    return tally;
  }
  running = true;
  try {
    do {
      again = false;
      await runOnce(tally);
    } while (again);
  } catch (err) {
    logFailure("run stopped", err);
  } finally {
    running = false;
  }
  return tally;
}
