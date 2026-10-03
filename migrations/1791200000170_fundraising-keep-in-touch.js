/* eslint-disable camelcase */

// TASK-515: keeping in touch with fundraisers, automatically, and the smart call prompts.
//
//   fundraiser_touchpoints        one row per automatic email a fundraiser has had (first gift,
//                                 halfway, target, a week before, a week after, finished, a year on,
//                                 need a hand, doing great), and when. Unique by fundraiser and
//                                 kind, so none can ever go twice: the row is claimed before the
//                                 email is sent, and given back only if the send fails. Cleared with
//                                 the fundraiser it belongs to.
//   fundraising_settings.touch_emails_on / _updated_at / _updated_by
//                                 the Automatic emails switch in Admin > Fundraising (admins only).
//                                 OFF by default: nothing is sent until Jaimie has read every email in
//                                 the admin's preview and switched it on.
//   fundraiser_again_tokens       "Do it again" (email 18, a year on): the one use link that opens the
//                                 sign up form filled in from last year's fundraiser. Only the sha256
//                                 of its token is kept (like TASK-503's invites), with when it runs
//                                 out (60 days) and when, and by which new sign up, it was used.
//                                 Cleared with the fundraiser it came from.
//   fundraiser_calls.prompt       TASK-503's calls, extended: a call about a smart call prompt is a
//                                 row with which = 'prompt' and the prompt it was about. The check on
//                                 which is widened to allow it.
//
// Additive only: two new tables, two nullable columns and one with a constant default, and a check that
// allows more than it did (a row the old code writes still passes it), so a code rollback is safe
// (golden rule 2). Numbered 1791200000170: above every migration on main (130) and the 160 the
// open fundraising categories change uses, so it sorts last whichever merges first.

exports.shorthands = undefined;

const KINDS = "'first_gift', 'halfway', 'target', 'week_before', 'week_after', 'finished', 'year_on', 'need_a_hand', 'on_track'";
const PROMPTS = "'behind', 'ahead', 'on_track', 'quiet', 'tin', 'sponsor_form', 'posters'";

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_touchpoints",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      kind: { type: "text", notNull: true, check: `kind IN (${KINDS})` },
      sent_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      sent_by: { type: "text", notNull: true, default: "system:schedule" },
    },
    {
      constraints: { unique: [["fundraiser_id", "kind"]] },
      comment: "Which automatic email each fundraiser has had, once each (TASK-515).",
    },
  );

  pgm.createTable(
    "fundraiser_again_tokens",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      token_hash: { type: "text", notNull: true, unique: true },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      expires_at: { type: "timestamptz", notNull: true },
      used_at: { type: "timestamptz" },
      // How many times the form has fetched last year's details with it: at most 3.
      lookups: { type: "integer", notNull: true, default: 0 },
      used_by_fundraiser_id: { type: "integer", references: "fundraisers", onDelete: "SET NULL" },
    },
    { comment: "Do it again links from the year on email; tokens kept only as sha256 (TASK-515)." },
  );

  pgm.addColumns("fundraising_settings", {
    touch_emails_on: { type: "boolean", notNull: true, default: false },
    touch_emails_updated_at: { type: "timestamptz" },
    touch_emails_updated_by: { type: "text" },
  });

  pgm.addColumns("fundraiser_calls", {
    prompt: { type: "text" },
  });
  pgm.dropConstraint("fundraiser_calls", "fundraiser_calls_which_check", { ifExists: true });
  pgm.addConstraint("fundraiser_calls", "fundraiser_calls_which_check", { check: "which IN ('before', 'after', 'prompt')" });
  pgm.addConstraint("fundraiser_calls", "fundraiser_calls_prompt_check", {
    check: `(which = 'prompt') = (prompt IS NOT NULL) AND (prompt IS NULL OR prompt IN (${PROMPTS}))`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("fundraiser_calls", "fundraiser_calls_prompt_check", { ifExists: true });
  pgm.sql("DELETE FROM fundraiser_calls WHERE which = 'prompt'");
  pgm.dropConstraint("fundraiser_calls", "fundraiser_calls_which_check", { ifExists: true });
  pgm.addConstraint("fundraiser_calls", "fundraiser_calls_which_check", { check: "which IN ('before', 'after')" });
  pgm.dropColumns("fundraiser_calls", ["prompt"]);
  pgm.dropColumns("fundraising_settings", ["touch_emails_on", "touch_emails_updated_at", "touch_emails_updated_by"]);
  pgm.dropTable("fundraiser_again_tokens");
  pgm.dropTable("fundraiser_touchpoints");
};
