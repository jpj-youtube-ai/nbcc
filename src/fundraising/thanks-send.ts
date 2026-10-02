import { config } from "../config";
import { sendFundraiseSupporterThanks } from "../clients/email";
import { suppressedAmong } from "../db/email-suppressions";
import {
  claimNextQueuedThanksGift,
  failStaleSending,
  finishThanksGift,
  markThanksDeliveredIfDone,
  undeliveredDoneThanks,
  type QueuedThanksGift,
} from "../db/fundraiser-thanks";
import { buildSupporterThanksEmail } from "./thanks-email";
import { recipientVerdict, type SkipReason } from "./thanks";

// TASK-507: sending the thank yous staff approved (email 20), in the background after the admin has
// their answer, like TASK-497's emails at the switch on (sendWaitingLiveEmails in ./send.ts).
//
//   - One gift at a time: each is claimed (made "sending") just before its email, so two runs never
//     take the same one, and a restart part way loses at most the one in flight (marked failed at
//     the next run, never sent twice).
//   - Before each email, the giver is checked as the newsletter checks: the suppression list at send
//     time (hard bounces, spam complaints, stopped by staff), an address at all, and whether they
//     turned thank you emails off. A list that cannot be read means no email. One person whose
//     several gifts were picked gets this thank you once.
//   - From and Reply-To are the events inbox (config.BALL_FROM_EMAIL), so a reply goes to NBCC, never
//     to the organiser; nothing about the giver goes back to them.
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
  if (g.alreadySent) return { send: false, reason: "duplicate" };
  let suppressed = false;
  if (g.email && g.email.trim() !== "") {
    try {
      suppressed = (await suppressedAmong([g.email])).has(g.email.trim().toLowerCase());
    } catch (err) {
      // Cannot tell whether we may email them: then we do not.
      logFailure("suppression check failed", err);
      return null;
    }
  }
  return recipientVerdict(g, suppressed);
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
      const mail = buildSupporterThanksEmail({ organiserName: g.organiserName, title: g.title, message: g.message });
      await sendFundraiseSupporterThanks(g.donorName, { email: g.email, from: config.BALL_FROM_EMAIL, replyTo: config.BALL_FROM_EMAIL, ...mail });
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
