/* eslint-disable camelcase */

// TASK-499: the fundraising sign up asks more.
//
//   post_line1, post_line2,   where to post posters, leaflets, buckets and tins, in separate boxes.
//   post_town, post_postcode  The old single box (post_address) stays, and stays readable, for the
//                             sign ups made before; a new sign up leaves it empty.
//
//   card_line ... credit_name the event questions, asked only of someone holding an event, worded
//                             like the admin's events editor: the line for the front of the card,
//                             the finish time and "the time is still to be confirmed", the full
//                             address and postcode, the access ticks, the price, how people get in
//                             (a ticket link on another website, pay on the door, or free), the age
//                             limit, dress code, what is included, and the name to credit it to.
//                             Their community event card on Get involved is drawn from these.
//
// Posters, leaflets, buckets and tins each with their own number need no column: they are new keys
// in the existing wants jsonb (posterCount, leafletCount, bucketCount, tinCount), and the old
// combined keys (leaflets, buckets) are still read.
//
// Additive only: every new column is nullable or has a constant default, so every existing row
// reads "not answered" and a code rollback is safe (golden rule 2). The two CHECKs hold the way in
// and the access ticks to the lists in src/fundraising/model.ts and src/events/model.ts, and every
// existing row passes them (NULL and the empty list).

exports.shorthands = undefined;

const BOOKINGS = ["away", "door", "free"];
const ACCESS = ["step free entry", "accessible toilets", "a hearing loop", "blue badge parking"];
const quoted = (list) => list.map((v) => `'${v}'`).join(", ");

exports.up = (pgm) => {
  pgm.addColumns("fundraisers", {
    post_line1: { type: "text" },
    post_line2: { type: "text" },
    post_town: { type: "text" },
    post_postcode: { type: "text" },
    card_line: { type: "text" },
    end_time: { type: "time" },
    time_tbc: { type: "boolean", notNull: true, default: false },
    venue_address: { type: "text" },
    venue_postcode: { type: "text" },
    access: { type: "text[]", notNull: true, default: pgm.func("'{}'::text[]") },
    price: { type: "text" },
    booking: { type: "text" },
    ticket_url: { type: "text" },
    age_limit: { type: "text" },
    dress_code: { type: "text" },
    included: { type: "text" },
    credit_name: { type: "text" },
  });
  pgm.addConstraint("fundraisers", "fundraisers_booking_check", {
    check: `booking IS NULL OR booking IN (${quoted(BOOKINGS)})`,
  });
  pgm.addConstraint("fundraisers", "fundraisers_access_check", {
    check: `access <@ ARRAY[${quoted(ACCESS)}]::text[]`,
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("fundraisers", "fundraisers_access_check", { ifExists: true });
  pgm.dropConstraint("fundraisers", "fundraisers_booking_check", { ifExists: true });
  pgm.dropColumns("fundraisers", [
    "post_line1",
    "post_line2",
    "post_town",
    "post_postcode",
    "card_line",
    "end_time",
    "time_tbc",
    "venue_address",
    "venue_postcode",
    "access",
    "price",
    "booking",
    "ticket_url",
    "age_limit",
    "dress_code",
    "included",
    "credit_name",
  ]);
};
