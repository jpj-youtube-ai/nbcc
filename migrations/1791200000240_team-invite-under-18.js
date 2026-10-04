/* eslint-disable camelcase */

// A tick beside each person a team organiser adds at sign up: "This person is under 18". The email
// box in that row is then their parent's or guardian's, and the invite (and its one reminder)
// speaks to the parent.
//
//   team_invites.under_18    the team organiser ticked it for this person. False for everyone added
//                            before the tick was there, who are invited in the words they always were.
//
// Additive only: one column with a constant default, so a code rollback is safe (golden rule 2).
// Numbered 1791200000240: after the 230 on main and the 235 an open change uses.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("team_invites", {
    under_18: { type: "boolean", notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("team_invites", ["under_18"]);
};
