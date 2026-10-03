/* eslint-disable camelcase */

// Jaimie, 2026-10-03: the sign up form asks two more things, on both paths.
//
//   over_18             "Are you 18 or over?" A sign up is refused without Yes, so every new row is
//                       true; a sign up from before was never asked and stays null (the admin then
//                       shows nothing).
//   shares_with_other   "Are you sharing what you raise with another cause?" Null on a sign up from
//                       before (never asked), true or false since.
//   nbcc_share_percent  When sharing: the whole percentage that comes to NBCC, 1 to 99.
//   other_cause_name    When sharing: the other cause's name, for the statement the Charities and
//                       Benevolent Fundraising (Scotland) Regulations 2009 ask for on the page and on
//                       every material ("50% of what we raise goes to ... The rest goes to ...").
//
// The checks hold the split together: when sharing, both the percentage and a name; when not (or
// never asked), neither. Organisers can never change the split; staff may correct it only while the
// fundraiser has no gifts (src/db/fundraisers.ts setFundraiserSplit).
//
// Additive only: four nullable columns with no default, and checks every row already there passes
// (all four are null on them), so a code rollback is safe (golden rule 2). Numbered 1791200000180:
// after keep in touch (170), the highest on main, and after the 175 another change is adding.

exports.shorthands = undefined;

const COLUMNS = ["over_18", "shares_with_other", "nbcc_share_percent", "other_cause_name"];

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    over_18: { type: "boolean" },
    shares_with_other: { type: "boolean" },
    nbcc_share_percent: { type: "integer" },
    other_cause_name: { type: "text" },
  });
  pgm.addConstraint("fundraisers", "fundraisers_nbcc_share_percent_range", {
    check: "nbcc_share_percent IS NULL OR nbcc_share_percent BETWEEN 1 AND 99",
  });
  pgm.addConstraint("fundraisers", "fundraisers_other_cause_name_length", {
    check: "other_cause_name IS NULL OR char_length(other_cause_name) <= 120",
  });
  pgm.addConstraint("fundraisers", "fundraisers_split_complete", {
    check:
      "(shares_with_other IS TRUE AND nbcc_share_percent IS NOT NULL AND other_cause_name IS NOT NULL AND btrim(other_cause_name) <> '')" +
      " OR (shares_with_other IS NOT TRUE AND nbcc_share_percent IS NULL AND other_cause_name IS NULL)",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("fundraisers", "fundraisers_split_complete", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_other_cause_name_length", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_nbcc_share_percent_range", { ifExists: true });
  pgm.dropColumns("fundraisers", COLUMNS);
};
