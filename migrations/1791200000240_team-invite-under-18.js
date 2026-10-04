/* eslint-disable camelcase */

// Two small things, both additive.
//
// A tick beside each person a team organiser adds at sign up: "This person is under 18". The email
// box in that row is then their parent's or guardian's, and the invite (and its one reminder)
// speaks to the parent.
//
//   team_invites.under_18    the team organiser ticked it for this person. False for everyone added
//                            before the tick was there, who are invited in the words they always were.
//
// And welcome packs (review): a request the pack changes is now marked "pack:" before the staff
// member in fundraiser_requests.updated_by ("pack:admin:fern@example.com"), so a request staff
// changed by hand afterwards is told apart and left alone (src/fundraising/welcome-pack.ts). Requests
// the pack changed BEFORE this have no mark, and would be treated as changed by hand for ever: an
// untick would no longer open them again, nor a re-tick put their count right. So they are marked
// here, once.
//
//   Which ones: a pack's press writes its own History line (audit_log, 'fundraiser.pack_updated') and
//   changes the request in ONE transaction (src/db/welcome-packs.ts, changePack), and both times are
//   the database's now(), which is the transaction's start: the two are exactly equal. A change by
//   hand in Requests is its own transaction and writes no pack line. So a request was last changed by
//   the pack when a pack line for its fundraiser carries the very time the request was last changed.
//   (A thing's own row would not do: an untick deletes it, and Undo of Pack sent moves the pack's time.)
//
//   Safe on an empty table, and run again it changes nothing (a marked row is skipped). It never
//   moves updated_at, so the match stays true.
//
// Down takes the column away and takes the mark off again (every "pack:" mark, also those written
// since: the code that goes with down writes none and reads none), so up can mark them again.
//
// Additive only: one column with a constant default, and a mark old code never reads, so a code
// rollback is safe (golden rule 2). Numbered 1791200000240: after the 235 on main.

exports.shorthands = undefined;

const BACKFILL_SQL = `
    UPDATE fundraiser_requests r
       SET updated_by = 'pack:' || r.updated_by
     WHERE r.updated_by IS NOT NULL
       AND r.updated_by NOT LIKE 'pack:%'
       AND EXISTS (
         SELECT 1 FROM audit_log a
          WHERE a.entity = 'fundraiser'
            AND a.entity_id = r.fundraiser_id
            AND a.action = 'fundraiser.pack_updated'
            AND a.created_at = r.updated_at
       )`;
/** The same statement, for the tests that run it against a database. */
exports.BACKFILL_SQL = BACKFILL_SQL;

exports.up = (pgm) => {
  pgm.addColumns("team_invites", {
    under_18: { type: "boolean", notNull: true, default: false },
  });
  pgm.sql(BACKFILL_SQL);
};

exports.down = (pgm) => {
  pgm.sql("UPDATE fundraiser_requests SET updated_by = substr(updated_by, 6) WHERE updated_by LIKE 'pack:%'");
  pgm.dropColumns("team_invites", ["under_18"]);
};
