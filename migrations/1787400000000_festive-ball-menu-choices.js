/* eslint-disable camelcase */

// TASK-345: menu choices, built before the menu exists.
//
// The venue has not confirmed a menu and may not for weeks. That does NOT block the launch,
// because choices are never asked for at the point of sale - they are collected later, on the
// guest page a buyer already has a link to. This migration puts the two columns in place so the
// only thing left to do on the day the menu lands is paste it in.
//
// Both nullable, and the FORM stays invisible while ball_settings.menu_options is NULL. A
// half-built menu picker showing "choose your main course" above an empty list is worse than no
// picker at all.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    // Free text, one course per line, options separated by "|". Deliberately not a table of
    // courses and options: nobody knows yet whether this hotel offers three mains or a set menu
    // with two swaps, and a schema guessed now is a migration to undo later. Staff paste what
    // the venue sends.
    menu_options: {
      type: "text",
      comment:
        'The menu, one course per line: "Main: Beef | Salmon | Risotto". NULL until the venue ' +
        "confirms it, and while NULL the guest form shows no menu section at all.",
    },
  });

  pgm.addColumns("ball_guests", {
    // What this guest picked, stored as the course/choice pairs they selected. Text for the same
    // reason as above: it has to survive the menu being edited after some people have answered.
    menu_choice: {
      type: "text",
      comment:
        "This guest's menu selections. NULL means not asked yet or not answered - the two are " +
        "told apart by whether ball_settings.menu_options is set.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["menu_options"]);
  pgm.dropColumns("ball_guests", ["menu_choice"]);
};
