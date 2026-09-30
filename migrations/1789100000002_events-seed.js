/* eslint-disable camelcase */

// TASK-453: the first two events on the /events page.
//
// Both are real and already public: EmpowHer '26 from AD Autocare's own Facebook post, the
// Festive Ball from /ball. They go in as live events so the page is ready the moment an admin
// switches it on. The page switch itself stays OFF (events_settings.page_on defaults to false),
// so nothing here reaches the public on deploy.
//
// SEED is exported so the unit tests render exactly what production will hold, rather than a copy
// that could drift from it. Idempotent: ON CONFLICT (slug) DO NOTHING, so an event staff have
// since edited is never overwritten, and one they deleted is not resurrected by a re-run.

const SEED = [
  {
    slug: "empowher-2026",
    name: "EmpowHer ’26",
    subtitle: "",
    gist: "A free evening of car care workshops, stalls from women in business across Ayrshire, and a raffle for NBCC.",
    date: "2026-11-04",
    start: "18:00",
    end: "22:00",
    timeTbc: false,
    venue: "AD Autocare",
    town: "Heathfield, Ayr",
    address: "AD Autocare, Heathfield, Ayr",
    access: [],
    imageSrc: null,
    imageFit: "cover",
    imageGround: "night",
    imageAlt: "",
    cover: "holly",
    costFront: "Free, but please book",
    costBack: "Free. Spaces are limited, so please book your place.",
    flag: "Spaces limited",
    listHeading: "What’s on",
    whatsOn: [
      "*Car care workshops* with Andrew and the team: change a tyre, check your oil",
      "*Stalls* from women running businesses across Ayrshire",
      "*Ali Wright* from Now Ayrshire Radio",
      "Mocktails and nibbles",
      "A *raffle* on the night for NBCC",
    ].join("\n"),
    note: "",
    runBy: "partner",
    partnerName: "AD Autocare",
    partnerFront: "Hosted by",
    partnerCredit: "Organised and paid for by",
    partnerLogoSrc: null,
    partnerLine: "With NBCC as their chosen charity for the night. Thank you to Andrew, CarolAnne and the whole team.",
    bookingHow: "away",
    bookingUrl: "https://adautocare.co.uk/empowher",
    bookingLabel: "Book your free place",
    bookingNote: "Booking is on the AD Autocare website.",
    status: "live",
    showFrom: null,
  },
  {
    slug: "festive-ball-2026",
    name: "Festive Ball 2026",
    subtitle: "A Night to Remember",
    gist: "An elegant evening at The Park Hotel, with dinner, live music and Michelle McManus as your host.",
    date: "2026-11-07",
    start: "19:00",
    end: null,
    timeTbc: true,
    venue: "The Park Hotel",
    town: "Kilmarnock",
    address: "The Park Hotel, Rugby Park, Kilmarnock. Parking at the venue.",
    access: [],
    imageSrc: "/assets/img/ball-lockup.svg",
    imageFit: "whole",
    imageGround: "night",
    imageAlt: "",
    cover: "crimson",
    costFront: "£100 each, tables of ten £1,000",
    costBack: "£100 each, or £1,000 for a table of ten. Over 18s only.",
    flag: "",
    listHeading: "On the night",
    whatsOn: [
      "*Michelle McManus*, your host for the evening",
      "*Clanadonia*",
      "*The MacDonald Brothers*",
      "*The Kilted DJ*",
    ].join("\n"),
    note: "Your ticket includes a three course meal, a welcome drink and the entertainment. Dress to impress.",
    runBy: "partner",
    partnerName: "The Designer Rooms",
    partnerFront: "Organised by",
    partnerCredit: "Organised and sponsored by",
    partnerLogoSrc: "/assets/img/the-designer-rooms.png",
    partnerLine: "They are covering the cost of the night, so your ticket funds NBCC’s work.",
    bookingHow: "site",
    bookingUrl: "/ball#tickets",
    bookingLabel: "Book tickets",
    bookingNote: "",
    status: "live",
    showFrom: null,
  },
];

// Field -> column. Written out rather than derived, the same way src/db/events.ts does it.
const COLUMNS = {
  slug: "slug",
  name: "name",
  subtitle: "subtitle",
  gist: "gist",
  date: "event_date",
  start: "start_time",
  end: "end_time",
  timeTbc: "time_tbc",
  venue: "venue",
  town: "town",
  address: "address",
  access: "access",
  imageSrc: "image_src",
  imageFit: "image_fit",
  imageGround: "image_ground",
  imageAlt: "image_alt",
  cover: "cover",
  costFront: "cost_front",
  costBack: "cost_back",
  flag: "flag",
  listHeading: "list_heading",
  whatsOn: "whats_on",
  note: "note",
  runBy: "run_by",
  partnerName: "partner_name",
  partnerFront: "partner_front",
  partnerCredit: "partner_credit",
  partnerLogoSrc: "partner_logo_src",
  partnerLine: "partner_line",
  bookingHow: "booking_how",
  bookingUrl: "booking_url",
  bookingLabel: "booking_label",
  bookingNote: "booking_note",
  status: "status",
  showFrom: "show_from",
};

// A literal for the SQL, quoted by the same rule Postgres uses: single quotes doubled.
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return value.length === 0 ? "'{}'::text[]" : `ARRAY[${value.map(literal).join(", ")}]::text[]`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

exports.SEED = SEED;

exports.up = (pgm) => {
  const keys = Object.keys(COLUMNS);
  for (const event of SEED) {
    pgm.sql(`
      INSERT INTO events (${keys.map((k) => COLUMNS[k]).join(", ")}, created_by, updated_by)
      VALUES (${keys.map((k) => literal(event[k])).join(", ")}, 'system:seed', 'system:seed')
      ON CONFLICT (slug) DO NOTHING
    `);
  }
};

// Removes only the rows this migration added and nobody has touched since.
exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM events
     WHERE slug IN (${SEED.map((e) => literal(e.slug)).join(", ")})
       AND updated_by = 'system:seed'
  `);
};
