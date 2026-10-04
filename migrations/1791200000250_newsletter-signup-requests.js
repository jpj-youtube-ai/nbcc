/* eslint-disable camelcase */

// Joining the mailing list from the /newsletter page: the requests waiting to be confirmed by email.
//
// Someone types a first name and an email address, and we email that address one link. Nobody is on
// the mailing list until the button behind that link is pressed. This table holds only what is
// needed in between, and nothing here is the mailing list itself (that stays list_subscribers,
// untouched):
//
//   email        the address, lower case. One waiting request for an address: asking again replaces
//                the link, it never adds a second row.
//   first_name   as typed, for the greeting and for the list once they confirm.
//   token_hash   a SHA-256 hash of the link's token. The token itself is only ever in the email.
//   created_at   when the address first asked.
//   sent_at      when the latest link was emailed: a fresh one is sent no more than every ten minutes.
//   expires_at   the link stops working, and the daily tidy up deletes the row, after 7 days.
//
// A row is deleted the moment its link is used, so a link works once.
//
// Additive only: one new table, which old code never reads, so a code rollback is safe (golden
// rule 2). Numbered 1791200000250: after the 240 on main.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("newsletter_signup_requests", {
    id: "id",
    email: { type: "text", notNull: true, unique: true },
    first_name: { type: "text", notNull: true },
    token_hash: { type: "text", notNull: true, unique: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    sent_at: { type: "timestamptz", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
  });
  // The daily tidy up deletes by this.
  pgm.createIndex("newsletter_signup_requests", "expires_at");
};

exports.down = (pgm) => {
  pgm.dropTable("newsletter_signup_requests");
};
