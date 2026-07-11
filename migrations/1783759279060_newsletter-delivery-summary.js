/* eslint-disable camelcase */

// Delivery summary for a sent newsletter (TASK-190). Additive, nullable columns (expand-contract,
// golden rule 2): after a send we record how many messages actually went out, how many failed, and
// which addresses failed — so the admin can see delivery health instead of losing failures to logs.
// recipient_count already exists (the size of the target list); these split the outcome.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("newsletters", {
    sent_count: { type: "integer" }, // messages the provider accepted
    failed_count: { type: "integer" }, // messages that failed to send
    failed_emails: { type: "jsonb" }, // the addresses that failed, for follow-up
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("newsletters", ["sent_count", "failed_count", "failed_emails"]);
};
