/* eslint-disable camelcase */

// TASK-417: The Park Hotel confirmed the menu, and taking choices against it needs two things
// the schema did not have.
//
// 1. `ball_guests.is_vegetarian` — WHY a guest picked the vegetarian dish.
//
//    Both alternative dishes on the confirmed menu are vegetarian, and the plate that reaches a
//    vegetarian looks identical to the plate that reaches someone who simply fancied the
//    wellington. The difference only matters when it matters: a requirement has to be exactly
//    right and cannot be swapped if the numbers move, a preference can. Nobody but the guest can
//    tell the two apart, so the form asks.
//
//    NULLABLE, and null is meaningful: rows saved before this were never asked. An unticked box
//    on a form that DID ask is `false`, which is a different fact from "we never asked you", and
//    flattening the two would tell the caterer a guest had answered when they had not.
//
// 2. `ball_settings.menu_note` — the venue's dietary key, verbatim.
//
//    Every dish on the confirmed sheet carries codes: (V)(VV)(DF). The menu sheet explains them
//    in a key at the foot. Showing the codes without the key is showing a guest jargon, and
//    inventing our own key risks contradicting the venue's. Kept as its own column rather than
//    appended to menu_options, because the parser reads that field line by line as courses and a
//    key pasted into it would render as a course called "Dietaries key".
//
// EXPAND ONLY: two nullable columns, nothing dropped, nothing rewritten. Every existing reader
// keeps working untouched.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_guests", {
    is_vegetarian: {
      type: "boolean",
      comment:
        "TASK-417: the guest is vegetarian, so the vegetarian dish is a requirement rather than " +
        "a preference. NULL means they were never asked (saved before TASK-417); false means " +
        "they were asked and said no.",
    },
  });

  pgm.addColumns("ball_settings", {
    menu_note: {
      type: "text",
      comment:
        "TASK-417: the venue's dietary key, verbatim, e.g. 'V = Vegetarian, VV = Vegan, ...'. " +
        "Shown under the menu on the guest form. NULL until staff paste it.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["menu_note"]);
  pgm.dropColumns("ball_guests", ["is_vegetarian"]);
};
