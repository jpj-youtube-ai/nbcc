/* eslint-disable */
// NOTE ON THE FILENAME: numbered above the highest existing migration (1785200000000), NOT the
// wall-clock stamp `node-pg-migrate create` gives you — see the TASK-250 note in CLAUDE.md.
//
// TASK-276: a 'sending' state for a queued recipient, closing a DOUBLE-SEND hole in TASK-274.
//
// The worker claimed rows with SELECT ... FOR UPDATE SKIP LOCKED, which hands a row to exactly one
// claimer *for the life of that transaction*. But the claim only bumped `attempts` — the row stayed
// 'pending' after the COMMIT. So between committing the claim and marking the row sent, a second tick
// could select the very same row and email that person AGAIN.
//
// That is not hypothetical: the send route fires a tick immediately (so a send starts at once) while
// the interval worker is also running, and production may run more than one ECS task. Overlapping
// ticks were reachable in normal operation.
//
// A distinct 'sending' state makes the claim durable rather than transaction-scoped: a claimed row is
// no longer 'pending', so nothing else can pick it up. Rows stuck in 'sending' — a task killed
// mid-batch — are swept back to 'pending' by the worker after a grace period, which is what keeps the
// queue resumable rather than trading a duplicate-send bug for a lost-recipient one.
//
// Widening a CHECK constraint is additive: every existing row still satisfies it.
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE newsletter_send_queue DROP CONSTRAINT IF EXISTS newsletter_send_queue_status_check`);
  pgm.sql(
    `ALTER TABLE newsletter_send_queue
       ADD CONSTRAINT newsletter_send_queue_status_check
       CHECK (status IN ('pending', 'sending', 'sent', 'failed'))`,
  );
  // When a row was claimed, so a crashed batch can be identified and swept back.
  pgm.addColumns("newsletter_send_queue", { claimed_at: { type: "timestamptz" } });
};

exports.down = (pgm) => {
  pgm.sql(`UPDATE newsletter_send_queue SET status = 'pending' WHERE status = 'sending'`);
  pgm.dropColumns("newsletter_send_queue", ["claimed_at"]);
  pgm.sql(`ALTER TABLE newsletter_send_queue DROP CONSTRAINT IF EXISTS newsletter_send_queue_status_check`);
  pgm.sql(
    `ALTER TABLE newsletter_send_queue
       ADD CONSTRAINT newsletter_send_queue_status_check
       CHECK (status IN ('pending', 'sent', 'failed'))`,
  );
};
