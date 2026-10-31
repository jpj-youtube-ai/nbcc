import { DECK_MARKER } from "../events/render";
import { FILM_HEAD, FILM_HEAD_MARKER, FILM_SECTION } from "./film";
import {
  CHIP_BUTTONS,
  CHIP_STATUS,
  CHIPS_MARKER,
  FUNDRAISING_STYLES,
  HINT_ALL,
  HINT_EVENTS,
  NO_FUNDRAISERS,
  STYLES_MARKER,
  deckCards,
  deckEnd,
  type GetInvolvedInput,
} from "./render";

// Get involved (/get-involved): what you can do for NBCC, fundraising first. The events and
// fundraisers are the first six of What's on's own cards, from the same list, so the two pages can
// never disagree. The events switch governs it as it governs What's on. While fundraising is switched
// off the Fundraise section and the film are left out and the page reads on from What's on.
//
// Pure, and drawn on the server, like the rest of src/fundraising/render.ts.

const FUNDRAISE_MARKER = "<!-- getinvolved:fundraise -->";
const EDGE_MARKER = "<!-- getinvolved:edge -->";
const CHIP_NOTES_MARKER = "<!-- getinvolved:chip-notes -->";
const FILL_STAGE_MARKER = "<!-- getinvolved:fill-stage -->";
const DECK_HEADING = "Upcoming events and fundraisers";

/** How many cards this page shows. The rest are on What's on. */
export const FIRST_CARDS = 6;

/** The snowy edge at the foot of the top section. */
const DRIFT =
  '<svg class="drift" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 62c90-34 170-44 262-20s150 44 252 26 176-58 292-44 168 54 276 50 170-40 358-34v60H0z"/></svg>';

const FUNDRAISE =
  '<section class="fund" id="fundraise" aria-labelledby="fundraise-heading"><div class="wrap fund-grid">' +
  '<div class="fund-words">' +
  '<span class="eyebrow on-dark">Fundraise for us</span>' +
  '<h2 id="fundraise-heading">Raise money your way, and we will help.</h2>' +
  '<p class="fund-lede">A sponsored walk, a bake sale, a quiz night or a birthday. Tell us your plans and we will be in touch.</p>' +
  '<ul class="fund-list">' +
  "<li>Your own page with a meter and a QR code, if you are raising money</li>" +
  "<li>Your event on our What&rsquo;s on page, if you would like it shown</li>" +
  "<li>Posters, leaflets and a collection bucket or tin</li>" +
  "<li>A shout out on our social media</li>" +
  "</ul>" +
  '<div class="fund-acts">' +
  '<a class="btn paper fund-cta" href="/fundraise">Fundraise for us</a>' +
  '<a class="tlink" href="/fundraise/manage">Already fundraising? Change your page</a>' +
  "</div>" +
  "</div>" +
  `<div class="fund-film"><span class="tape" aria-hidden="true"></span>${FILM_SECTION}</div>` +
  "</div></section>";

// What an empty view says when the first six leave a kind out. Every fundraiser can sit past the
// first six, so "No fundraisers" here could disagree with the page one click away; and with six
// fundraisers and no events the face down card has no room, so Events would be an empty table.
const FUNDRAISERS_ELSEWHERE =
  '<p class="gi-empty" data-chips-empty="fundraiser" hidden>Our fundraisers are further down the list. ' +
  '<a href="/whats-on">See everything that&rsquo;s on</a></p>';
const NO_EVENTS_HERE = '<p class="gi-empty" data-chips-empty="event" hidden>More dates on the way.</p>';

export function renderNewGetInvolvedPage(template: string, input: GetInvolvedInput & { fillStage?: string }): string {
  const on = input.fundraisingOn;
  const cards = deckCards(input);
  const shown = cards.slice(0, FIRST_CARDS);
  // The face down card ends the deck while there is room for it. See everything that's on does the
  // same job when there is not, and the deck never holds more than six.
  const deck = shown.map((c) => c.html).join("") + (shown.length < FIRST_CARDS ? deckEnd(on) : "");

  const fundraiserNote = cards.every((c) => c.kind !== "fundraiser") ? NO_FUNDRAISERS : shown.every((c) => c.kind !== "fundraiser") ? FUNDRAISERS_ELSEWHERE : "";
  const eventNote = shown.length === FIRST_CARDS && shown.every((c) => c.kind !== "event") ? NO_EVENTS_HERE : "";

  return template
    .replace(STYLES_MARKER, () => (on ? FUNDRAISING_STYLES : ""))
    .replace(FILM_HEAD_MARKER, () => (on ? FILM_HEAD : ""))
    .replace(EDGE_MARKER, () => (on ? `<div class="fund-edge">${DRIFT}</div>` : DRIFT))
    .replace(FUNDRAISE_MARKER, () => (on ? FUNDRAISE : ""))
    .replace(DECK_HEADING, () => (on ? DECK_HEADING : "Upcoming events"))
    .replace(CHIPS_MARKER, () => (on ? CHIP_BUTTONS : ""))
    .replace(CHIP_NOTES_MARKER, () => (on ? CHIP_STATUS + fundraiserNote + eventNote : ""))
    .replace(HINT_ALL, () => (on ? HINT_EVENTS : HINT_ALL))
    .replace(DECK_MARKER, () => deck)
    .replace(FILL_STAGE_MARKER, () => input.fillStage ?? "");
}
