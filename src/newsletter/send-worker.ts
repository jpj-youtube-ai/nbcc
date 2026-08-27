import { config } from "../config";
import { getNewsletter, setNewsletterDeliverySummary } from "../db/newsletters";
import { recordNewsletterSends } from "../db/newsletter-events";
import {
  listRunnableJobs,
  markJobRunning,
  finishJobIfDrained,
  claimRecipients,
  markRecipientSent,
  deferRecipient,
  listGivenUpRecipients,
  reviveRecipients,
  markRecipientFailed,
  sentTodayCount,
  jobOutcome,
  reclaimStalledRecipients,
  type SendJob,
} from "../db/newsletter-send-jobs";
import { sendNewsletter } from "../clients/email";
import { signUnsubscribeTokenV2 } from "../donors/unsubscribe-token";
import { signSubscriberUnsubscribeToken } from "../donors/unsubscribe-token";
import { newsletterDocSchema, renderNewsletter } from "./blocks";
import { mergeSubject, newsletterSender, firstNameOf } from "./theme";
import { buildNewsletterHtml } from "../donors/newsletter";
import { tickAllowance, TICK_SECONDS } from "./send-pacing";
import { dispositionFor } from "./send-failure";
import { htmlToPlainText } from "./plain-text";

// TASK-274: the background sender. It replaces a loop that ran inside the HTTP request, where a few
// hundred recipients outran the ALB's 60-second timeout — the admin saw "Send failed" while sending
// was in fact still going, and a restart left a newsletter marked sent, partly delivered, with no
// record of who had been reached and no way to continue.
//
// Shape: wake every TICK_SECONDS, ask each live job how many it may send right now (the throttle,
// limited by today's cap — see send-pacing), claim exactly that many rows, send them, record each
// outcome. Everything about "how far did it get" lives in the queue table, so a crash mid-send loses
// nothing: the next tick picks up the pending rows.
//
// A tick that sends nothing is normal — it means today's gentle-rollout allowance is spent, and
// tomorrow's larger one applies without anything needing to be rescheduled.

// A send that keeps failing for one address stops after this many tries, so a single bad recipient
// cannot hold up the queue forever.
const MAX_ATTEMPTS = 3;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runSendTick(now: Date = new Date()): Promise<void> {
  // Sweep rows left 'sending' by a task that died mid-batch back to 'pending', so a crash costs a
  // delay rather than a lost recipient. Runs first, so this tick can pick them straight back up.
  try {
    await reclaimStalledRecipients();
  } catch (err) {
    console.error("reclaiming stalled sends failed:", err instanceof Error ? err.message : err);
  }
  const jobs = await listRunnableJobs();
  for (const job of jobs) {
    try {
      await runJobTick(job, now);
    } catch (err) {
      // One bad job must not stop the others; the rows stay pending and the next tick retries.
      console.error(`newsletter send job ${job.id} tick failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function runJobTick(job: SendJob, now: Date): Promise<void> {
  if (job.pending === 0) {
    await finishJobIfDrained(job.id);
    return;
  }
  await markJobRunning(job.id);

  const allowance = tickAllowance(
    {
      rollout: job.rollout,
      perMinute: job.perMinute,
      dailyCap: job.dailyCap,
      // TASK-302: read fresh every tick, so raising or lowering the ceiling reaches a send that is
      // already running - no restart, no rescheduling, no reconfiguring the job.
      ceiling: config.NEWSLETTER_DAILY_SEND_CAP,
      startedAt: job.startedAt ? new Date(job.startedAt) : null,
    },
    await sentTodayCount(job.id),
    now,
  );
  if (allowance <= 0) return; // today's allowance is spent — the ramp resumes tomorrow

  const newsletter = await getNewsletter(job.newsletterId);
  if (!newsletter) return; // deleted mid-send; the queue rows go nowhere and the job drains

  const parsedDoc = newsletterDocSchema.safeParse(newsletter.bodyJson);
  const batch = await claimRecipients(job.id, allowance);
  if (batch.length === 0) {
    await finishJobIfDrained(job.id);
    return;
  }

  // TASK-302: before sending anything, put back anyone this job gave up on for a reason that was
  // never about them. Until now a capacity refusal spent one of a recipient's three attempts, so
  // three unlucky turns during a busy day dropped them from the newsletter permanently and silently.
  // Judged by the same classifier the live send uses, so there is one rule, not two. The set empties
  // itself: once revived and sent they are 'sent', and capacity refusals no longer count against
  // anyone, so nothing can land back here for that reason again.
  try {
    const givenUp = await listGivenUpRecipients(job.id);
    const putBack = givenUp.filter((r) => dispositionFor(r.lastError ?? "") === "defer").map((r) => r.id);
    if (putBack.length) {
      const revived = await reviveRecipients(putBack);
      console.log(`newsletter send job ${job.id}: put ${revived} unreached recipients back in the queue`);
    }
  } catch (err) {
    // Best-effort: a repair that fails must not stop the send it was meant to help.
    console.error("reviving unreached recipients failed:", err instanceof Error ? err.message : err);
  }

  // Pace WITHIN the tick too: claiming 20 and firing them in the same millisecond would trip the
  // provider's per-second limit exactly as the old loop did. The gap comes from the THROTTLE (60/min
  // -> one per second), not from dividing the tick by the batch size — that stretched a single
  // recipient into a full tick of sleeping, so a one-person send took 20 seconds.
  const gapMs = Math.max(0, Math.floor(60_000 / Math.max(1, job.perMinute)));
  const accepted: { donorId: number | null; email: string }[] = [];
  // Set when the provider turns us away, so the rest of this tick is abandoned rather than spent
  // collecting identical refusals. The queue is untouched; the next tick simply tries again.
  let deferred = false;

  for (const r of batch) {
    const token =
      r.donorId != null
        ? signUnsubscribeTokenV2(r.donorId, job.newsletterId, config.ADMIN_SESSION_SECRET)
        : signSubscriberUnsubscribeToken(r.subscriberId as number, job.newsletterId, config.ADMIN_SESSION_SECRET);
    const unsubscribeUrl = `${config.PORTAL_BASE_URL}/unsubscribe/${token}`;
    const firstName = firstNameOf(r.fullName);
    const html = parsedDoc.success
      ? renderNewsletter(parsedDoc.data, { firstName, unsubscribeUrl })
      : buildNewsletterHtml(newsletter.bodyHtml, unsubscribeUrl);

    try {
      await sendNewsletter({
        email: r.email,
        from: newsletterSender(config.NEWSLETTER_FROM_EMAIL),
        replyTo: config.NEWSLETTER_REPLY_TO_EMAIL,
        // TASK-292: the doc's own nameFallback decides what a missing name becomes in the subject.
        // The BODY gets it via renderNewsletter, which reads the same doc — one setting, both places.
        subject: mergeSubject(
          newsletter.subject,
          firstName,
          parsedDoc.success ? (parsedDoc.data.merge?.nameFallback ?? "") : "",
        ),
        html,
        // TASK-275: derived from the very html we are sending, so the two can never disagree.
        text: htmlToPlainText(html),
        unsubscribeUrl,
      });
      await markRecipientSent(r.id);
      accepted.push({ donorId: r.donorId, email: r.email });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (dispositionFor(message) === "defer") {
        // TASK-302: the provider is full, or briefly unreachable. That says nothing about this
        // person, so the attempt is refunded and they keep their place in the queue. Then STOP the
        // tick: the next recipient would meet the same wall, and hammering it only spends the
        // remaining allowance on refusals and makes us look worse to the provider.
        await deferRecipient(r.id, message);
        deferred = true;
        break;
      }
      // Back to pending for another go (up to MAX_ATTEMPTS) — a provider rejecting a burst is
      // temporary, and the old code dropped those people permanently.
      await markRecipientFailed(r.id, message, MAX_ATTEMPTS);
    }
    // No pause after the LAST one — sleeping when there is nothing left to pace just makes every
    // send finish a gap later than it needed to.
    if (gapMs > 0 && r !== batch[batch.length - 1]) await sleep(gapMs);
  }

  if (accepted.length) {
    try {
      await recordNewsletterSends(job.newsletterId, accepted);
    } catch (err) {
      console.error("recording newsletter sends failed:", err instanceof Error ? err.message : err);
    }
  }
  // TASK-302: a deferred tick left people in the queue by definition, so the job cannot be drained.
  // Skipping the check keeps a provider outage from looking, for one query, like a completed send.
  if (deferred) return;
  // When the queue empties, write the real outcome onto the newsletter. The send stamped zeroes at
  // queue time (the counts were not knowable yet); leaving them there would have the history claim
  // every send delivered nothing.
  if (await finishJobIfDrained(job.id)) {
    const outcome = await jobOutcome(job.id);
    await setNewsletterDeliverySummary(job.newsletterId, {
      recipientCount: job.total,
      sentCount: outcome.sent,
      failedCount: outcome.failed,
      failedEmails: outcome.failedEmails,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Started from src/app.ts. Guarded so overlapping ticks can't stack up if one runs long — the DB
// claim is already safe across ECS tasks (FOR UPDATE SKIP LOCKED); this just keeps one task tidy.
export function startSendWorker(intervalMs = TICK_SECONDS * 1000): NodeJS.Timeout {
  timer = setInterval(() => {
    if (running) return;
    running = true;
    runSendTick()
      .catch((err) => console.error("newsletter send tick failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  // Never hold the process open for a timer — the container should still exit cleanly.
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

export function stopSendWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
