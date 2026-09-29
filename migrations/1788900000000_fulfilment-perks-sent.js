/* eslint-disable camelcase */

// TASK-441: record WHEN a business supporter's badge and certificate were actually sent.
//
// Until now both rode the confirmation email that goes out the instant they submit the thank-you
// form, and nothing recorded that it had happened — so the admin page could only infer it from
// captured_at, and "did that actually go?" had no answer. They now arrive as their own email on the
// next weekday morning, and this column is what stops the daily pass sending it twice and what the
// admin page reads to say when it went.
//
// Additive and nullable (expand-contract, golden rule 2): existing rows stay NULL, which reads
// correctly as "their perks were sent the old way, with their confirmation" rather than as an error.
// No existing column is dropped, renamed or made NOT NULL, so a code-level rollback stays safe.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("business_supporter_fulfilment", {
    perks_sent_at: { type: "timestamptz" },
  });
  // The daily pass asks "who is captured, wants something, and has not had it yet?" every morning,
  // so the NULL half of that is the half worth indexing.
  pgm.createIndex("business_supporter_fulfilment", "perks_sent_at", {
    name: "bsf_perks_unsent_idx",
    where: "perks_sent_at IS NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("business_supporter_fulfilment", "perks_sent_at", { name: "bsf_perks_unsent_idx" });
  pgm.dropColumns("business_supporter_fulfilment", ["perks_sent_at"]);
};
