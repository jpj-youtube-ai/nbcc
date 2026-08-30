/* eslint-disable camelcase */

// TASK-313: let staff change the preview password from the admin area.
//
// It started life as an SSM parameter, which meant changing it needed an AWS login — a barrier
// that has nothing to do with the job. Storing a HASH here lets Jaimie and Jon change it
// themselves, and means the plaintext is never in the database, the logs or the audit trail
// (golden rule 4).
//
// The stored hash also becomes the signing key for the preview cookie, so changing the password
// immediately invalidates every cookie issued under the old one. That is the behaviour anyone
// changing a shared password expects: it should lock out whoever you changed it because of.
//
// NULL means "not set here" and the app falls back to the BALL_PREVIEW_PASSWORD parameter, so
// nothing breaks between deploying this and staff setting one.
//
// EXPAND ONLY: one nullable column.

exports.up = (pgm) => {
  pgm.addColumns("ball_settings", {
    preview_password_hash: {
      type: "text",
      comment:
        "TASK-313: scrypt hash (scrypt$salt$key, same format as users.password_hash) of the " +
        "preview gate password. NULL = fall back to the BALL_PREVIEW_PASSWORD config value. " +
        "Never store or log the plaintext.",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns("ball_settings", ["preview_password_hash"]);
};
