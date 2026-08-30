/* eslint-disable camelcase */

// TASK-313: the event details that are not yet confirmed on 30 Aug 2026 — the arrival time, the
// menu detail (courses, wine, whether there is a drinks reception) and the line-up note.
//
// These are columns rather than hard-coded page copy for one reason: the client should not have
// to come back to a developer to publish a start time. Everything here is NULL until confirmed,
// and the page renders an honest "to be confirmed" in its place rather than inventing detail
// about a £100 ticket.
//
// EXPAND ONLY: three nullable columns on an existing table, no backfill, no constraint.

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    arrival_time: {
      type: "text",
      comment:
        "TASK-313: free text, e.g. '7pm for 7.30pm'. NULL until the organiser confirms; the " +
        "page then shows 'to be confirmed' rather than guessing.",
    },
    included_note: {
      type: "text",
      comment:
        "TASK-313: the menu/drinks detail on top of the confirmed entry + meal + entertainment. " +
        "NULL until the venue confirms courses, wine and whether there is a drinks reception.",
    },
    line_up_note: {
      type: "text",
      comment: "TASK-313: added when the 'special guests still to be announced' are announced.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["arrival_time", "included_note", "line_up_note"]);
};
