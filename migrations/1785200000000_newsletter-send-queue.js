/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1785100000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-274: sending becomes a background JOB with a queue, instead of a loop inside the web request.
//
// What was wrong with the loop: the send ran inside POST /api/admin/newsletters/:id/send, one
// sequential fetch per recipient, behind the ALB's 60-second default. A few hundred recipients would
// exceed that — the browser saw "Send failed" while the server was in fact still sending. And because
// the newsletter was flipped to `sent` BEFORE the first email left, a timeout or a task restart left
// a newsletter marked sent, partially delivered, with no record of who had been reached and no way to
// resume. There was also no pacing (the provider accepts ~2/second) and no retry.
//
//   newsletter_send_jobs  — one row per send. Carries the pacing knobs and the live progress, so the
//                           admin screen can show "412 of 2,000 sent" and offer pause/cancel.
//   newsletter_send_queue — one row per RECIPIENT. This is what makes the send resumable, reportable
//                           and retryable: each person's own state, attempts and error. It also
//                           finally answers "who exactly received this newsletter?", which the old
//                           aggregate-only design could not.
//
// Pacing lives on the job, not in code, so a send already in flight can be slowed down:
//   per_minute   — throttle (the provider's rate limit is the ceiling).
//   daily_cap    — 0 means "no cap". The GENTLE ROLLOUT sets this and doubles it each day, so a first
//                  big send from a young domain warms up instead of arriving as one suspicious spike.
//
// Additive: two new tables.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "newsletter_send_jobs",
    {
      id: "id",
      newsletter_id: { type: "integer", notNull: true, references: "newsletters", onDelete: "CASCADE" },
      list_id: { type: "integer", references: "subscriber_lists" },
      // queued -> running -> done. paused is admin-initiated and resumable; cancelled is terminal.
      status: {
        type: "text",
        notNull: true,
        default: "queued",
        check: "status IN ('queued', 'running', 'paused', 'done', 'cancelled')",
      },
      // 'immediate' sends as fast as the throttle allows; 'gentle' ramps the daily cap (warm-up).
      rollout: {
        type: "text",
        notNull: true,
        default: "immediate",
        check: "rollout IN ('immediate', 'gentle')",
      },
      per_minute: { type: "integer", notNull: true, default: 60 },
      daily_cap: { type: "integer", notNull: true, default: 0 }, // 0 = uncapped
      total: { type: "integer", notNull: true, default: 0 },
      created_by: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      started_at: { type: "timestamptz" },
      finished_at: { type: "timestamptz" },
    },
    { comment: "Background newsletter sends (TASK-274): pacing, progress, pause/cancel." },
  );

  pgm.createTable(
    "newsletter_send_queue",
    {
      id: "id",
      job_id: { type: "integer", notNull: true, references: "newsletter_send_jobs", onDelete: "CASCADE" },
      email: { type: "text", notNull: true },
      donor_id: { type: "integer" },
      subscriber_id: { type: "integer" },
      full_name: { type: "text" },
      status: {
        type: "text",
        notNull: true,
        default: "pending",
        check: "status IN ('pending', 'sent', 'failed')",
      },
      attempts: { type: "integer", notNull: true, default: 0 },
      last_error: { type: "text" },
      sent_at: { type: "timestamptz" },
    },
    { comment: "One row per recipient of a send (TASK-274): resumable, retryable, and auditable." },
  );

  // The worker's claim query filters on (job, status) and orders by id; the reporting queries read a
  // whole job. One index serves both.
  pgm.sql(`CREATE INDEX newsletter_send_queue_job_status_idx ON newsletter_send_queue (job_id, status, id)`);
  // Per-day counting for the gentle rollout, and "who received this and when" for the audit.
  pgm.sql(`CREATE INDEX newsletter_send_queue_sent_at_idx ON newsletter_send_queue (job_id, sent_at)`);
  // A newsletter has at most one job that is still going — the guard against a double send surviving
  // the move off the old atomic claim.
  pgm.sql(
    `CREATE UNIQUE INDEX newsletter_send_jobs_active_uniq ON newsletter_send_jobs (newsletter_id)
      WHERE status IN ('queued', 'running', 'paused')`,
  );
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_send_queue");
  pgm.dropTable("newsletter_send_jobs");
};
