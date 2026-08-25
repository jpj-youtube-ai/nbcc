/* eslint-disable camelcase */

// TASK-291: mark an audience private or public.
//
//   private — staff add people to it; nobody outside ever sees it exists. Volunteers, Referrers,
//             anything internal. This is the DEFAULT, because a list that quietly became joinable
//             would be a disclosure we never chose to make.
//   public  — we are happy for people to opt into it themselves from the email preferences page.
//
// EXPAND ONLY: a new column with a safe default. The backfill flips only the `everyone` audience
// (the Newsletter) to public, because that one is ALREADY publicly joinable through the website
// footer — recording it as private would make the column lie about what the site does.
//
// The `donors` audience is deliberately not touched: it follows donor consent and cannot be joined
// by hand at all, so its visibility is meaningless and the code never offers it either way.

exports.up = (pgm) => {
  pgm.addColumn("subscriber_lists", {
    visibility: {
      type: "text",
      notNull: true,
      default: "private",
      comment:
        "TASK-291: 'private' (staff add only, never shown to the public) or 'public' (people may " +
        "opt in from the email preferences page). Defaults to private so nothing becomes joinable " +
        "by accident.",
    },
  });
  pgm.addConstraint("subscriber_lists", "subscriber_lists_visibility_check", {
    check: "visibility IN ('private', 'public')",
  });
  // The Newsletter audience is already joinable from the website footer; say so.
  pgm.sql("UPDATE subscriber_lists SET visibility = 'public' WHERE kind = 'everyone'");
};

exports.down = (pgm) => {
  pgm.dropConstraint("subscriber_lists", "subscriber_lists_visibility_check");
  pgm.dropColumn("subscriber_lists", "visibility");
};
