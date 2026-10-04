/* eslint-disable camelcase */

// Invite types (Jaimie, B1 + I1): when staff invite someone from Admin > Fundraising they say what
// they are inviting them to do, so the invite's link opens the sign up form at the right place and
// its email has the right words.
//
//   fundraiser_invites.invite_type   'raising' (raising money), 'team' (a team), 'event' (hosting an
//                                    event) or 'memory' (a page in memory of someone). Null on every
//                                    invite sent before, and on one sent from an admin page loaded
//                                    before the drop-down: those behave exactly as they always did.
//
// The in memory invite has new wording, which is only sent once an admin approves it (key
// "invite_memory" in touch_wording_approvals, src/fundraising/invite.ts). Nothing is seeded as
// approved here: it waits for sign off.
//
// Additive only: one nullable column with no default, so a code rollback is safe (golden rule 2).
// Numbered 1791200000235: after 215 on main and the 220 and 230 that open changes use.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("fundraiser_invites", {
    invite_type: { type: "text", check: "invite_type IN ('raising', 'team', 'event', 'memory')" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("fundraiser_invites", ["invite_type"]);
};
