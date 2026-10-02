/* eslint-disable camelcase */

// TASK-502: the message after paying.
//
//   donations.wall_added_at   when a giver added their message and wall choices (show my name, show
//                             the amount) from the optional step on the thank you after paying. It
//                             makes that step once only: a gift with it set, or with a message left
//                             on the give form before TASK-502, takes no more. Staff can still hide
//                             the message as before (message_hidden).
//
// Additive only: one nullable column, so every gift already there reads as never added and a code
// rollback is safe (golden rule 2).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("donations", {
    wall_added_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("donations", ["wall_added_at"]);
};
