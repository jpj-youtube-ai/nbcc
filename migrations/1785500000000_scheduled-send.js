/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1785400000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-280 (letter J): send it later.
//
// Volunteers write when they have time — an evening, a weekend — but a newsletter lands best on a
// weekday morning. Until now the only options were "send now" or "remember to come back and press it
// yourself", which is how a newsletter ends up going out at 11pm on a Sunday.
//
// This is deliberately small because TASK-274 already built the machinery: sending is a background job
// that a worker picks up. Scheduling is therefore not a new mechanism, just an instruction not to pick
// this one up yet — `listRunnableJobs` skips a job whose scheduled_at is still in the future.
//
// NULL means "start immediately", so every existing job and every send that doesn't ask for a time
// behaves exactly as before.
//
// Additive: one nullable column.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("newsletter_send_jobs", {
    scheduled_at: { type: "timestamptz" }, // NULL = start now (every pre-existing job)
  });
  // The worker asks "which jobs may run now?" on every tick; this keeps that cheap as history grows.
  pgm.sql(
    `CREATE INDEX newsletter_send_jobs_runnable_idx
       ON newsletter_send_jobs (status, scheduled_at)`,
  );
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS newsletter_send_jobs_runnable_idx`);
  pgm.dropColumns("newsletter_send_jobs", ["scheduled_at"]);
};
