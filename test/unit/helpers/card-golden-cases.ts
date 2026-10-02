import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventRecord } from "../../../src/events/model";
import { meter } from "../../../src/fundraising/model";
import { SEED_EVENTS, seedWith } from "./events-seed";

// TASK-499: the inputs behind test/unit/helpers/card-golden.json, the cards exactly as they were
// drawn BEFORE community event cards learned about prices, booking and access. NBCC's own events
// must still come out byte for byte the same, and a community event signed up before TASK-499 the
// same apart from the one line it should never have had ("No need to book. Just come along.").
// Every name here is invented.

export const ROOT = resolve(__dirname, "../../..");

/** NBCC's own events, as the events editor makes them, in every booking state. */
export function nbccCases(): Array<[string, EventRecord]> {
  return [
    ...SEED_EVENTS.map((ev): [string, EventRecord] => [`seed:${ev.slug}`, ev]),
    ["ball:none-with-a-leftover-note", seedWith("festive-ball-2026", { bookingHow: "none", bookingUrl: "", bookingNote: "A leftover note" })],
    ["empowher:none", seedWith("empowher-2026", { bookingHow: "none", bookingUrl: "" })],
    ["ball:tbc-end-access", seedWith("festive-ball-2026", { timeTbc: true, end: "23:30", access: ["step free entry", "a hearing loop"] })],
    [
      "empowher:away-partner",
      seedWith("empowher-2026", {
        runBy: "partner",
        partnerName: "Example Garage Ltd",
        bookingHow: "away",
        bookingUrl: "https://tickets.example.com/night",
        bookingLabel: "Get tickets",
        bookingNote: "",
      }),
    ],
    ["ball:site", seedWith("festive-ball-2026", { bookingHow: "site", bookingUrl: "/ball", bookingLabel: "Book" })],
  ];
}

/** A raising money fundraiser, for whole pages (it has no event card, so it never changes). */
export const RAISING = {
  id: 41,
  slug: "robins-santa-dash",
  path: "raising" as const,
  kind: "santa_dash" as const,
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit for NBCC.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 6000, cashPence: 1500, targetPence: 25000 }),
};

/** "Holding an event" sign ups made before TASK-499: none of the event questions answered. */
export const OLD_COMMUNITY = {
  short: {
    ...RAISING,
    id: 52,
    slug: "kims-bake-sale",
    path: "event" as const,
    kind: "bake_sale" as const,
    kindLabel: "A bake sale or coffee morning",
    title: "Kim's Bake Sale",
    description: "Cakes and coffee for NBCC.",
    eventDate: "2026-11-21",
    startTime: "10:00",
    venue: "Example Church Hall",
    town: "Exampleton",
    organisedBy: "Kim E.",
    url: null,
  },
  long: {
    ...RAISING,
    id: 53,
    slug: "the-office-quiz",
    path: "event" as const,
    kind: "quiz_party" as const,
    kindLabel: "A quiz or party",
    title: "The Office Quiz",
    description:
      "A quiz night in the back room, with eight rounds, a picture round and a music round. Teams of up to six. " +
      "There is a raffle at half time with prizes from local shops, and the bar is open all night. Bring your own pens.",
    eventDate: "2026-12-04",
    startTime: "19:30",
    venue: "",
    town: "Exampleton",
    organisedBy: "Sam P.",
    url: null,
  },
};

export const TEMPLATE = readFileSync(resolve(ROOT, "events.html"), "utf8");
export const TODAY = "2026-10-02";

// The words an old community card had, and should never have had: it may well be ticketed.
export const OLD_BOOKING_LINE =
  '<div class="ev-book-gap"></div><p class="ev-book-note ev-book-note--solo">No need to book. Just come along.</p>';
