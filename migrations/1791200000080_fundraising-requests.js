/* eslint-disable camelcase */

// TASK-505: what organisers asked us for on the sign up form (fundraisers.wants), tracked to done in
// Admin > Fundraising. The rules are in src/fundraising/requests.ts.
//
//   fundraiser_requests   one row per fundraiser and kind of request, made the first time staff act
//                         on it. With no row a request is at its first step (To send, To do or To
//                         arrange), so sign ups from before this need no backfill.
//
//     kind          posters, leaflets, leaflets_or_posters (the old combined ask), buckets, tins,
//                   buckets_or_tins (likewise), shout_out, attend
//     status        to_send, sent (posters, leaflets); to_send, with_them, back (buckets, tins);
//                   to_do, done (a shout out); to_arrange, arranged, done (someone to come along)
//     quantity      how many were sent, or went out; quantity_back how many came back
//     how           post or dropped_off
//     sent_on       the day they were sent or went out; back_on the day they came back; done_on the
//                   day a shout out was posted or someone came along
//     handled_by    who did it, as staff typed it; going who is going along
//     note          a note on sending, lending or arranging; back_note on what came back (the money
//                   inside, any missing); link the shout out's post
//     updated_by    "admin:<email>" of whoever last changed it. Every change also writes audit_log.
//
// Additive only: one new table, cleared with its fundraiser, so a code rollback is safe (golden
// rule 2). Numbered 1791200000080, above 1791200000070 (the highest on main).

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable(
    "fundraiser_requests",
    {
      id: "id",
      fundraiser_id: { type: "integer", notNull: true, references: "fundraisers", onDelete: "CASCADE" },
      kind: {
        type: "text",
        notNull: true,
        check:
          "kind IN ('posters', 'leaflets', 'leaflets_or_posters', 'buckets', 'tins', 'buckets_or_tins', 'shout_out', 'attend')",
      },
      status: {
        type: "text",
        notNull: true,
        check: "status IN ('to_send', 'sent', 'with_them', 'back', 'to_do', 'done', 'to_arrange', 'arranged')",
      },
      quantity: { type: "integer", check: "quantity IS NULL OR quantity BETWEEN 0 AND 1000" },
      quantity_back: { type: "integer", check: "quantity_back IS NULL OR quantity_back BETWEEN 0 AND 1000" },
      how: { type: "text", check: "how IS NULL OR how IN ('post', 'dropped_off')" },
      sent_on: { type: "date" },
      back_on: { type: "date" },
      done_on: { type: "date" },
      handled_by: { type: "text" },
      going: { type: "text" },
      note: { type: "text" },
      back_note: { type: "text" },
      link: { type: "text" },
      created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
      updated_by: { type: "text" },
    },
    {
      constraints: {
        unique: [["fundraiser_id", "kind"]],
        check: [
          "note IS NULL OR char_length(note) <= 500",
          "back_note IS NULL OR char_length(back_note) <= 500",
          "link IS NULL OR char_length(link) <= 500",
          "handled_by IS NULL OR char_length(handled_by) <= 100",
          "going IS NULL OR char_length(going) <= 200",
        ],
      },
      comment: "What organisers asked us for (posters, leaflets, buckets and tins, shout outs, someone to come along), tracked to done (TASK-505).",
    },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("fundraiser_requests");
};
