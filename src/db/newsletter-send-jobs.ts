import { pool } from "./pool";
import type { ListRecipient } from "./newsletters";

// TASK-274: the send queue. A send is now a background JOB with one row per recipient, replacing a
// loop that ran inside the HTTP request behind a 60-second ALB timeout — which meant a few hundred
// recipients showed the admin "Send failed" while the server was still sending, and a restart left a
// newsletter marked sent, partly delivered, with no record of who had been reached.
//
// One row per recipient is what buys resumability, retry, honest progress, and the answer to "who
// exactly received this?" that the old aggregate-only design could not give.

export type JobStatus = "queued" | "running" | "paused" | "done" | "cancelled";
export type Rollout = "immediate" | "gentle";

export interface SendJob {
  id: number;
  newsletterId: number;
  listId: number | null;
  status: JobStatus;
  rollout: Rollout;
  perMinute: number;
  dailyCap: number;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  createdBy: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface QueuedRecipient {
  id: number;
  email: string;
  donorId: number | null;
  subscriberId: number | null;
  fullName: string | null;
  attempts: number;
}

// Create the job and queue every recipient in ONE transaction: a half-written queue would send to
// some people and silently forget the rest, which is precisely the failure this replaces.
export async function createSendJob(input: {
  newsletterId: number;
  listId: number | null;
  recipients: ListRecipient[];
  rollout: Rollout;
  perMinute: number;
  createdBy: string;
}): Promise<SendJob> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const job = (
      await client.query(
        `INSERT INTO newsletter_send_jobs (newsletter_id, list_id, rollout, per_minute, total, created_by, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued') RETURNING id`,
        [input.newsletterId, input.listId, input.rollout, input.perMinute, input.recipients.length, input.createdBy],
      )
    ).rows[0];
    for (const r of input.recipients) {
      await client.query(
        `INSERT INTO newsletter_send_queue (job_id, email, donor_id, subscriber_id, full_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [job.id, r.email, r.donorId, r.subscriberId, r.fullName],
      );
    }
    await client.query("COMMIT");
    return (await getSendJob(job.id)) as SendJob;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const JOB_COLUMNS = `j.id, j.newsletter_id, j.list_id, j.status, j.rollout, j.per_minute, j.daily_cap,
        j.total, j.created_by, j.started_at, j.finished_at,
        (SELECT count(*) FROM newsletter_send_queue q WHERE q.job_id = j.id AND q.status = 'sent') AS sent,
        (SELECT count(*) FROM newsletter_send_queue q WHERE q.job_id = j.id AND q.status = 'failed') AS failed,
        (SELECT count(*) FROM newsletter_send_queue q WHERE q.job_id = j.id AND q.status IN ('pending', 'sending')) AS pending`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function toJob(r: any): SendJob {
  return {
    id: r.id,
    newsletterId: r.newsletter_id,
    listId: r.list_id,
    status: r.status,
    rollout: r.rollout,
    perMinute: r.per_minute,
    dailyCap: r.daily_cap,
    total: r.total,
    sent: Number(r.sent),
    failed: Number(r.failed),
    pending: Number(r.pending),
    createdBy: r.created_by,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getSendJob(id: number): Promise<SendJob | null> {
  const { rows } = await pool.query(`SELECT ${JOB_COLUMNS} FROM newsletter_send_jobs j WHERE j.id = $1`, [id]);
  return rows[0] ? toJob(rows[0]) : null;
}

export async function getJobForNewsletter(newsletterId: number): Promise<SendJob | null> {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM newsletter_send_jobs j
      WHERE j.newsletter_id = $1 ORDER BY j.id DESC LIMIT 1`,
    [newsletterId],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

// Jobs the worker should look at. 'paused' is excluded on purpose — a pause must actually stop work.
export async function listRunnableJobs(): Promise<SendJob[]> {
  const { rows } = await pool.query(
    `SELECT ${JOB_COLUMNS} FROM newsletter_send_jobs j
      WHERE j.status IN ('queued', 'running') ORDER BY j.id`,
  );
  return rows.map(toJob);
}

export async function markJobRunning(id: number): Promise<void> {
  await pool.query(
    `UPDATE newsletter_send_jobs SET status = 'running', started_at = COALESCE(started_at, now())
      WHERE id = $1 AND status IN ('queued', 'running')`,
    [id],
  );
}

// Finish a job only when nothing is left pending — a tick that merely ran out of today's allowance
// must NOT look finished, or a gentle rollout would stop on day one.
export async function finishJobIfDrained(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE newsletter_send_jobs SET status = 'done', finished_at = now()
      WHERE id = $1 AND status = 'running'
        AND NOT EXISTS (SELECT 1 FROM newsletter_send_queue q
                         WHERE q.job_id = $1 AND q.status IN ('pending', 'sending'))`,
    [id],
  );
  return (rowCount ?? 0) > 0;
}

export async function setJobStatus(id: number, status: "paused" | "running" | "cancelled"): Promise<boolean> {
  // Only a live job can change state; a finished or cancelled one is terminal.
  const { rowCount } = await pool.query(
    `UPDATE newsletter_send_jobs
        SET status = $2, finished_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE finished_at END
      WHERE id = $1 AND status IN ('queued', 'running', 'paused')`,
    [id, status],
  );
  return (rowCount ?? 0) > 0;
}

// Claim the next few recipients for this job. FOR UPDATE SKIP LOCKED is what makes it safe for more
// than one ECS task to run the worker at once: each row is handed to exactly one of them.
export async function claimRecipients(jobId: number, limit: number): Promise<QueuedRecipient[]> {
  if (limit <= 0) return [];
  // TASK-276: one statement that SELECTs and MARKS. FOR UPDATE SKIP LOCKED hands each row to exactly
  // one claimer, and moving it to 'sending' makes that durable past the commit — previously the row
  // went back to being plain 'pending', so an overlapping tick could claim it again and email the
  // same person twice.
  const { rows } = await pool.query(
    `UPDATE newsletter_send_queue q
        SET status = 'sending', attempts = q.attempts + 1, claimed_at = now()
      WHERE q.id IN (
        SELECT id FROM newsletter_send_queue
         WHERE job_id = $1 AND status = 'pending'
         ORDER BY id
         LIMIT $2
         FOR UPDATE SKIP LOCKED
      )
      RETURNING q.id, q.email, q.donor_id, q.subscriber_id, q.full_name, q.attempts`,
    [jobId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    donorId: r.donor_id,
    subscriberId: r.subscriber_id,
    fullName: r.full_name,
    attempts: r.attempts,
  }));
}

// A task killed mid-batch leaves rows stuck in 'sending'. Sweep them back so the queue stays
// resumable — otherwise closing a duplicate-send hole would just open a lost-recipient one. The grace
// period is generous: a slow provider must not have its in-flight rows stolen and re-sent.
export async function reclaimStalledRecipients(graceMinutes = 15): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE newsletter_send_queue
        SET status = 'pending'
      WHERE status = 'sending' AND claimed_at < now() - ($1 || ' minutes')::interval`,
    [String(graceMinutes)],
  );
  return rowCount ?? 0;
}

export async function markRecipientSent(queueId: number): Promise<void> {
  await pool.query(`UPDATE newsletter_send_queue SET status = 'sent', sent_at = now() WHERE id = $1`, [queueId]);
}

// A failure goes back to 'pending' for another go, up to maxAttempts — a provider rejecting a burst
// is temporary, and the old code dropped those people permanently.
export async function markRecipientFailed(queueId: number, error: string, maxAttempts: number): Promise<void> {
  await pool.query(
    `UPDATE newsletter_send_queue
        SET status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
            last_error = $2
      WHERE id = $1`,
    [queueId, error.slice(0, 500), maxAttempts],
  );
}

// How many went out today (UTC), for the daily cap / gentle rollout.
export async function sentTodayCount(jobId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*) AS n FROM newsletter_send_queue
      WHERE job_id = $1 AND status = 'sent' AND sent_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
    [jobId],
  );
  return Number(rows[0]?.n ?? 0);
}

// The per-send audit: exactly who this reached, and who did not get it and why.
export async function listJobRecipients(
  jobId: number,
  limit = 5000,
): Promise<{ email: string; status: string; sentAt: string | null; lastError: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT email, status, sent_at, last_error FROM newsletter_send_queue
      WHERE job_id = $1 ORDER BY email LIMIT $2`,
    [jobId, limit],
  );
  return rows.map((r) => ({ email: r.email, status: r.status, sentAt: r.sent_at, lastError: r.last_error }));
}

// The final tally for a drained job, written back onto the newsletter so the history shows what
// actually happened rather than the zeroes stamped when the job was queued.
export async function jobOutcome(jobId: number): Promise<{ sent: number; failed: number; failedEmails: string[] }> {
  const { rows } = await pool.query(
    `SELECT status, email FROM newsletter_send_queue WHERE job_id = $1`,
    [jobId],
  );
  const failedEmails = rows.filter((r) => r.status === "failed").map((r) => r.email as string);
  return {
    sent: rows.filter((r) => r.status === "sent").length,
    failed: failedEmails.length,
    failedEmails,
  };
}
