/* eslint-disable camelcase */

// In memory pages (Jaimie, 2026-10-03). A page raising money in memory of someone, set up by the
// family, a friend or a funeral director with the family's permission, and checked by staff before
// it goes live like every page.
//
// fundraisers
//   in_memory                 Yes to "Is this in memory of someone?" on the sign up. False on every
//                             row before, and on every other sign up.
//   memory_name               who it remembers, as typed ("Margaret Exampleton"), up to 100
//   memory_dates              optional, free text ("1948 to 2026"), up to 60
//   memory_setup_by           family, friend or funeral_director
//   memory_permission         they ticked "I have the family's permission" (always, for one in memory)
//   memory_show_target        the family's answer to showing the target and how close it is. Null
//                             when there is no target, or not in memory. Never chosen for them.
//   memory_reminder_done_at   a year on, staff are reminded to decide whether to get in touch; when
//   memory_reminder_done_by   someone has, and who (there is no automatic anniversary email)
//
// donations
//   family_notify             the giver ticked "Let the family know I gave" (unticked by default);
//                             the organiser then sees their name and message, never the amount or
//                             their email
//   message_approved_at       on an in memory page every message waits for staff before it shows;
//   message_approved_by       when one was approved, and by whom
//
// Additive only: new columns, nullable or with a constant default, and checks every row already
// there passes (in_memory is false on all of them), so a code rollback is safe (golden rule 2).
// Numbered 1791200000195: after the team pages migration (190), which merges first.

exports.shorthands = undefined;

const FUNDRAISER_COLUMNS = [
  "in_memory",
  "memory_name",
  "memory_dates",
  "memory_setup_by",
  "memory_permission",
  "memory_show_target",
  "memory_reminder_done_at",
  "memory_reminder_done_by",
];
const DONATION_COLUMNS = ["family_notify", "message_approved_at", "message_approved_by"];

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    in_memory: { type: "boolean", notNull: true, default: false },
    memory_name: { type: "text" },
    memory_dates: { type: "text" },
    memory_setup_by: { type: "text" },
    memory_permission: { type: "boolean" },
    memory_show_target: { type: "boolean" },
    memory_reminder_done_at: { type: "timestamptz" },
    memory_reminder_done_by: { type: "text" },
  });
  pgm.addConstraint("fundraisers", "fundraisers_memory_name_length", {
    check: "memory_name IS NULL OR char_length(memory_name) <= 100",
  });
  pgm.addConstraint("fundraisers", "fundraisers_memory_dates_length", {
    check: "memory_dates IS NULL OR char_length(memory_dates) <= 60",
  });
  pgm.addConstraint("fundraisers", "fundraisers_memory_setup_by_known", {
    check: "memory_setup_by IS NULL OR memory_setup_by IN ('family', 'friend', 'funeral_director')",
  });
  pgm.addConstraint("fundraisers", "fundraisers_memory_complete", {
    check:
      "in_memory IS NOT TRUE OR (memory_name IS NOT NULL AND btrim(memory_name) <> '' AND memory_setup_by IS NOT NULL AND memory_permission IS TRUE)",
  });

  pgm.addColumns("donations", {
    family_notify: { type: "boolean", notNull: true, default: false },
    message_approved_at: { type: "timestamptz" },
    message_approved_by: { type: "text" },
  });
  // The staff check: messages on a page still to look at, found by the page.
  pgm.createIndex("donations", "fundraiser_id", {
    name: "donations_message_unchecked_idx",
    where: "message_approved_at IS NULL AND supporter_message IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("donations", "fundraiser_id", { name: "donations_message_unchecked_idx", ifExists: true });
  pgm.dropColumns("donations", DONATION_COLUMNS);
  pgm.dropConstraint("fundraisers", "fundraisers_memory_complete", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_memory_setup_by_known", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_memory_dates_length", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_memory_name_length", { ifExists: true });
  pgm.dropColumns("fundraisers", FUNDRAISER_COLUMNS);
};
