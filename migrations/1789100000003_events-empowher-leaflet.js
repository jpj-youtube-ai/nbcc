/* eslint-disable camelcase */

// TASK-456: EmpowHer '26 gets its leaflet, and the card says what the leaflet says.
//
// The leaflet (assets/img/empowher-2026-leaflet.webp: the organiser's own, cropped out of the dark
// frame of the screenshot it came in) goes on the front of the card whole, on cream, the way the
// admin shows a poster with words on it. Three details on the card came from our Facebook post, and
// the leaflet has them more exactly, so the card now agrees with it:
//   - Ali Wright is the evening's host, from Now Radio's Ali and Michael in the Morning;
//   - the address has its street, Wallacetown Drive;
//   - the front credits AD Autocare as the organiser, so the card never names two hosts.
//
// Compare and swap, field by field. A word changes only if it is still exactly the seed's, and the
// picture goes on only if the event has none. Anything staff have changed in the admin since, a
// picture they uploaded included, is theirs and stays. updated_by is left as it is, so the seed
// migration's down still only ever removes a row no person has touched.
//
// LEAFLET is exported for test/unit/events-leaflet.test.ts and the tests' seed helper, so the tests
// render what production will hold.

const SLUG = "empowher-2026";
const LEAFLET_SRC = "/assets/img/empowher-2026-leaflet.webp";

// The picture moves as one: all three settings, and only onto an event with no picture.
const PICTURE = [
  { field: "imageSrc", column: "image_src", from: null, to: LEAFLET_SRC },
  { field: "imageFit", column: "image_fit", from: "cover", to: "whole" },
  { field: "imageGround", column: "image_ground", from: "night", to: "cream" },
];

// Each of these moves on its own, and only from exactly the seed's words.
const WORDS = [
  {
    field: "address",
    column: "address",
    from: "AD Autocare, Heathfield, Ayr",
    to: "AD Autocare, Wallacetown Drive, Heathfield, Ayr",
  },
  {
    field: "whatsOn",
    column: "whats_on",
    from: [
      "*Car care workshops* with Andrew and the team: change a tyre, check your oil",
      "*Stalls* from women running businesses across Ayrshire",
      "*Ali Wright* from Now Ayrshire Radio",
      "Mocktails and nibbles",
      "A *raffle* on the night for NBCC",
    ].join("\n"),
    to: [
      "*Ali Wright* from Now Radio’s Ali and Michael in the Morning, your host for the evening",
      "*Car care workshops* with Andrew Dodds and his team: change a tyre, check your oil",
      "*Stalls* from women running businesses across Ayrshire",
      "Mocktails and nibbles",
      "A *raffle* on the night for NBCC",
    ].join("\n"),
  },
  { field: "partnerFront", column: "partner_front", from: "Hosted by", to: "Organised by" },
];

// A literal for the SQL, quoted by the same rule Postgres uses: single quotes doubled.
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

// One UPDATE that swaps `from` for `to` wherever `from` is still there. `picture` is the condition
// that says the event's picture is still the one being replaced.
function swap(pgm, picture, from, to) {
  const sets = [
    ...PICTURE.map((p) => `${p.column} = CASE WHEN ${picture} THEN ${literal(p[to])} ELSE ${p.column} END`),
    ...WORDS.map(
      (w) => `${w.column} = CASE WHEN ${w.column} = ${literal(w[from])} THEN ${literal(w[to])} ELSE ${w.column} END`,
    ),
    "updated_at = now()",
  ];
  const somethingToDo = [picture, ...WORDS.map((w) => `${w.column} = ${literal(w[from])}`)].join(" OR ");
  pgm.sql(`
    UPDATE events SET
      ${sets.join(",\n      ")}
     WHERE slug = ${literal(SLUG)} AND (${somethingToDo})
  `);
}

exports.LEAFLET = { slug: SLUG, picture: PICTURE, words: WORDS };

exports.up = (pgm) => swap(pgm, "image_src IS NULL", "from", "to");

// Back to the seed's words and no picture, wherever what this put there is still there.
exports.down = (pgm) => swap(pgm, `image_src = ${literal(LEAFLET_SRC)}`, "to", "from");
