import type { EventRecord } from "../events/model";
import { londonToday, sortForPage } from "../events/model";
import {
  type CardRecord,
  DECK_MARKER,
  dateParts,
  escapeHtml,
  renderCard,
  renderIndex,
  renderMoreCard,
  time12,
  timeText,
} from "../events/render";
import { SINGLE_DONATION_WORDING } from "../declarations/wording";
import { ALL_TO_NBCC, type Meter, type PublicCard, type PublicPage, type WallEntry } from "./model";
import { countdownFor, type NewsEntry } from "./news";
import { safeFirstName } from "./emails";
import { entryLine, safeTicketUrl } from "./entry";
import { NONE as NO_IMPACT, impactParts, type ImpactParts } from "./impact-render";
import type { ImpactExample } from "../impact/examples";
import { avatarHtml, isProfilePhotoSrc } from "./pictures";
import { NBCC_FACT_HTML, nbccCardBooking } from "../tickets/render";

// TASK-494: the public fundraising pages, drawn on the server.
//
//   - Get involved (/get-involved): the Events page widened. NBCC's events as before, and while
//     fundraising is switched on, every approved public fundraiser as a card with its meter, the
//     "holding an event" sign ups as ordinary event cards, the All / Events / Fundraisers chips and
//     the Fundraise for us panel.
//   - A fundraiser's own page (/fundraise/<slug>): the story, the meter, the give form, the
//     supporter wall and the share links. (TASK-501 moved its QR code to the organiser's private
//     area; /fundraise/<slug>/qr.svg still answers, it is just not shown or linked here.)
//     TASK-502: Gift Aid shown beside a gift and under the meter (never counted); the message and
//     the wall choices moved from the give form to an optional step on the thank you after paying;
//     and a finished fundraiser keeps its page, saying so, with "You can still give".
//     TASK-506: a countdown under the date while it is still to come ("12 days to go", "Tomorrow!"),
//     a banner wishing the organiser luck on the day with the share links, and a News section of
//     the updates staff approved, newest first, each photo in a small cropped frame.
//   - The sign up page (/fundraise): the form, or a gentle "not open yet" while switched off.
//
// Pure: no database, no config, no clock (the time is passed in). Everything a person typed is
// escaped on the way out. Drawn on the server rather than in the browser so the pages are complete
// without JavaScript, a shared link shows the fundraiser's own name, and nothing waits on a fetch.
// The words are plain, friendly English with no dashes, as everywhere on the site.

// --- small pieces --------------------------------------------------------------------------------

/** £60, £25.50, £1,234.56: pence only when there are some. */
export function formatPounds(pence: number): string {
  const p = Math.max(0, Math.round(pence));
  const pounds = Math.floor(p / 100);
  const rest = p % 100;
  const whole = pounds.toLocaleString("en-GB");
  return rest ? `£${whole}.${String(rest).padStart(2, "0")}` : `£${whole}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** How long ago, the way people say it: "just now", "5 minutes ago", "yesterday", "2 weeks ago". */
export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(seconds / 3600);
  const days = Math.floor(seconds / 86400);
  if (minutes < 1) return "just now";
  if (hours < 1) return `${plural(minutes, "minute")} ago`;
  if (days < 1) return `${plural(hours, "hour")} ago`;
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 56) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${plural(Math.floor(days / 30), "month")} ago`;
  return "over a year ago";
}

/** A short version of a description for a card: whole words, ending with an ellipsis if cut. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const atSpace = cut.lastIndexOf(" ");
  return `${(atSpace > max * 0.6 ? cut.slice(0, atSpace) : flat.slice(0, max)).replace(/[\s,.;:]+$/, "")}…`;
}

/** "Saturday 5 December 2026". */
function longDate(iso: string): string {
  const p = dateParts(iso);
  return `${p.dayName} ${p.day} ${p.month} ${p.year}`;
}

const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON = {
  clock: `<svg width="18" height="18" ${SVG}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  pin: `<svg width="18" height="18" ${SVG}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`,
  person: `<svg width="18" height="18" ${SVG}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  // Event pages: the events cards' own ticket, for the cost and how people get in.
  ticket: `<svg width="18" height="18" ${SVG}><path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z"/><path d="M15 6v12" stroke-dasharray="1.5 2.5"/></svg>`,
  link: `<svg width="18" height="18" ${SVG}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`,
  facebook: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H7v3h3v6h3v-6h3l1-3h-4v-2c0-.6.4-1 1-1z"/></svg>',
  whatsapp: `<svg width="18" height="18" ${SVG}><path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z"/><path d="M9 8.5c0 3.5 2.6 6.5 6.5 6.5l1-1.6-2-1-1 .9c-1.2-.5-2.3-1.6-2.8-2.8l.9-1-1-2z"/></svg>`,
};

// --- the meter -----------------------------------------------------------------------------------

/**
 * Raised so far, the target and the percentage, as an accessible progress bar with the same thing
 * in words. Past the target the bar is held full and the words carry the real figure. With no
 * target there is no bar at all: just "£X raised".
 */
export function renderMeter(m: Meter, opts: { large?: boolean } = {}): string {
  const raised = formatPounds(m.raisedPence);
  const size = opts.large ? " fr-meter--large" : "";
  // TASK-502: the Gift Aid on the gifts, under the total. Shown only: never in the raised figure, the
  // target or the percentage. No line at all when there is none.
  const giftAid = m.giftAidPence > 0 ? `<p class="fr-meter__giftaid">+ ${formatPounds(m.giftAidPence)} Gift Aid</p>` : "";
  if (m.targetPence === null || m.percent === null || m.barPercent === null) {
    return (
      `<div class="fr-meter fr-meter--open${size}">` +
      `<p class="fr-meter__figures"><span class="fr-meter__raised">${raised}</span> raised</p>` +
      giftAid +
      "</div>"
    );
  }
  const target = formatPounds(m.targetPence);
  const words = `${raised} raised of the ${target} target, ${m.percent}%`;
  const after = m.overTarget ? `${m.percent}% of the target, and still going` : `${m.percent}% of the target`;
  return (
    `<div class="fr-meter${m.overTarget ? " is-over" : ""}${size}">` +
    `<p class="fr-meter__figures"><span class="fr-meter__raised">${raised}</span> raised` +
    `<span class="fr-meter__target"> of ${target}</span></p>` +
    giftAid +
    `<div class="fr-meter__bar" role="progressbar" aria-label="Money raised" aria-valuemin="0" aria-valuemax="100"` +
    ` aria-valuenow="${m.barPercent}" aria-valuetext="${escapeHtml(words)}">` +
    `<span class="fr-meter__fill" style="width:${m.barPercent}%"></span></div>` +
    `<p class="fr-meter__percent">${after}</p>` +
    "</div>"
  );
}

// --- Get involved ----------------------------------------------------------------------------------

function cardArt(c: PublicCard): string {
  if (c.imageSrc) {
    return (
      '<div class="ev-art">' +
      `<img src="${escapeHtml(c.imageSrc)}" alt="${escapeHtml(`A picture for ${c.title}`)}" loading="lazy" decoding="async" />` +
      "</div>"
    );
  }
  // In memory, no photo: a soft cream cover with their name and dates, nothing festive.
  if (c.memory) {
    return (
      '<div class="ev-art ev-art--type ev-art--memory" aria-hidden="true"><div>' +
      '<p class="ev-art__place">In memory of</p>' +
      `<p class="ev-art__name">${escapeHtml(c.memory.name)}</p>` +
      (c.memory.dates ? `<p class="ev-art__place">${escapeHtml(c.memory.dates)}</p>` : "") +
      "</div></div>"
    );
  }
  // No photo: the card sets its own cover from the name, in holly so it reads as a community
  // fundraiser beside NBCC's crimson events.
  return (
    '<div class="ev-art ev-art--type ev-art--holly" aria-hidden="true"><div>' +
    `<p class="ev-art__name">${escapeHtml(c.title)}</p>` +
    '<div class="rule on-dark"><i></i></div>' +
    `<p class="ev-art__place">${escapeHtml(c.town || "For NBCC")}</p>` +
    "</div></div>"
  );
}

/**
 * One raising money fundraiser as a deck card: the picture, the gist, the meter and the way in. Its
 * date goes in the corner only while it is still to come (a fundraiser stays listed after its day,
 * and an old date there would read as out of date). `today` is YYYY-MM-DD in UK time.
 */
export function renderFundraiserCard(c: PublicCard, today?: string): string {
  const id = escapeHtml(`fundraiser-${c.slug}`);
  const href = escapeHtml(c.url ?? `/fundraise/${c.slug}`);
  // In memory of someone (Jaimie, 2026-10-03): quieter. Who it remembers, no Fundraiser flag and no
  // date in the corner; the meter keeps the target hidden unless the family chose to show it.
  const memory = c.memory ?? null;
  return (
    `<li class="ev-card ev-card--fundraiser${memory ? " ev-card--memory" : ""}" id="${id}" data-kind="fundraiser"><div class="ev-card__inner">` +
    `<article class="ev-face ev-front" aria-labelledby="${id}-title">` +
    cardArt(c) +
    (!memory && c.eventDate && (!today || c.eventDate >= today) ? renderIndex({ date: c.eventDate }) : "") +
    (memory ? "" : '<p class="ev-flag fr-flag">Fundraiser</p>') +
    '<div class="ev-body">' +
    `<p class="ev-host">${escapeHtml(memory ? "In memory" : c.kindLabel)}</p>` +
    `<h2 class="ev-title" id="${id}-title">${escapeHtml(memory ? `In memory of ${memory.name}` : c.title)}</h2>` +
    `<p class="fr-card__by">Organised by ${escapeHtml(c.organisedBy)}</p>` +
    (c.description ? `<p class="ev-tldr">${escapeHtml(shorten(c.description, 150))}</p>` : "") +
    renderMeter(c.meter) +
    // Jaimie, 2026-10-03: shared with another cause, the statement beside the way in.
    // Clarity audit: and that gifts on the page are all NBCC's. A card in memory of someone is as it was.
    (c.split ? `<p class="fr-card__split">${escapeHtml(c.split.statement)}</p>${memory ? "" : `<p class="fr-card__split fr-card__split-note">${ALL_TO_NBCC}</p>`}` : "") +
    '<div class="ev-book-gap"></div>' +
    `<a class="btn btn-primary fr-card__go" href="${href}">See the page and give<span class="sr-only">: ${escapeHtml(c.title)}</span></a>` +
    "</div></article></div></li>"
  );
}

/** "Age limit: 18 and over." A sentence for the card's note, with a full stop if it needs one. */
function noteSentence(label: string, value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v ? `${label}: ${v}${/[.!?]$/.test(v) ? "" : "."}` : "";
}

/** The full address for the back, with the venue postcode added unless it already says it. */
function fullAddress(c: PublicCard): string {
  const address = (c.venueAddress ?? "").trim();
  const postcode = (c.venuePostcode ?? "").trim();
  if (!postcode) return address;
  const says = (text: string) => text.replace(/\s+/g, "").toUpperCase().includes(postcode.replace(/\s+/g, "").toUpperCase());
  const base = address || [c.venue, c.town].filter(Boolean).join(", ");
  if (says(base)) return base;
  if (!base) return postcode;
  return /[.!?]$/.test(base) ? `${base} ${postcode}` : `${base}, ${postcode}`;
}

/**
 * How people get in, for the card (TASK-499). Tickets on another website get the events page's own
 * button and the line under it; the door and free get a line of their own. A sign up from before
 * the question was asked gets no booking line at all: it may well be ticketed, so it must never
 * promise there is no need to book.
 */
function bookingFor(c: PublicCard): Pick<CardRecord, "bookingHow" | "bookingUrl" | "bookingLabel" | "bookingNote" | "bookingSolo"> {
  const none = { bookingHow: "none" as const, bookingUrl: "", bookingLabel: "", bookingNote: "" };
  // Event tickets: NBCC sells them, on the event's own page.
  if (c.booking === "nbcc") return nbccCardBooking(c.url);
  if (c.booking === "away" && c.ticketUrl) {
    return { bookingHow: "away", bookingUrl: c.ticketUrl, bookingLabel: "Book tickets", bookingNote: "Tickets are sold on another website" };
  }
  if (c.booking === "away") return { ...none, bookingSolo: "Tickets are sold on another website." };
  if (c.booking === "door") return { ...none, bookingSolo: "Pay on the door. No need to book." };
  if (c.booking === "free") return none; // the events page's own "No need to book. Just come along."
  // The sign up tidy: free to come, with a bucket for donations.
  if (c.booking === "donations") return { ...none, bookingSolo: "Free entry, donations welcome." };
  return { ...none, bookingSolo: null };
}

/**
 * A "holding an event" sign up as an ordinary event card, credited to its organiser (or the name
 * they gave to credit it to). Event pages: it has a page of its own now too, at /event/<short name>,
 * linked from the back of the card (pageHref). No date, no card: there would be nothing
 * to put in the corner, and Get involved is a list of dates.
 *
 * TASK-499: drawn from the event questions: the line for the front, the finish time and "to be
 * confirmed", the full address, the access ticks, the price, how people get in, and the age limit,
 * dress code and what is included in the note on the back. A sign up from before those questions
 * has none of them, and is drawn exactly as before, less the booking line.
 */
export function fundraiserEventRecord(c: PublicCard): CardRecord | null {
  if (!c.eventDate) return null;
  const description = c.description.replace(/\s+/g, " ").trim();
  const gist = c.cardLine ? c.cardLine : shorten(c.description, 200);
  const story = gist === description ? "" : c.description;
  const extras = [noteSentence("Age limit", c.ageLimit), noteSentence("Dress code", c.dressCode), noteSentence("Included", c.included)];
  return {
    id: -c.id,
    slug: `community-${c.slug}`,
    name: c.title,
    subtitle: c.kindLabel,
    gist,
    date: c.eventDate,
    start: c.startTime,
    end: c.endTime ?? null,
    timeTbc: c.timeTbc ?? false,
    venue: c.venue,
    town: c.town,
    address: fullAddress(c),
    access: c.access ?? [],
    imageSrc: c.imageSrc,
    imageFit: "cover",
    imageGround: "night",
    imageAlt: `A picture for ${c.title}`,
    cover: "holly",
    costFront: c.price ?? "",
    costBack: "",
    flag: "",
    listHeading: "",
    whatsOn: "",
    note: [story, ...extras].filter(Boolean).join(" "),
    runBy: "partner",
    partnerName: c.organisedBy,
    partnerFront: "Organised by",
    partnerCredit: "Organised by",
    partnerLogoSrc: null,
    // Jaimie, 2026-10-03: shared with another cause, the card says how, in the 2009 regulations' words.
    partnerLine: c.split ? `${c.split.statement} ${ALL_TO_NBCC}` : "A community event raising money for NBCC.",
    ...bookingFor(c),
    status: "live",
    showFrom: null,
    // Event pages: its own page, linked from the back of its card.
    ...(c.url ? { pageHref: c.url } : {}),
  };
}

export const CHIPS_MARKER = "<!-- getinvolved:chips -->";
export const STYLES_MARKER = "<!-- getinvolved:styles -->";
const FUNDRAISING_STYLES = '<link rel="stylesheet" href="/assets/css/fundraising.css" />';
// The hint above the deck: fundraiser cards have one face, so once they are among the cards only
// the event cards are promised to turn over.
const HINT_ALL = "Turn any card over for the full details.";
const HINT_EVENTS = "Turn any event card over for the full details.";
export const PANEL_MARKER = "<!-- getinvolved:panel -->";
const INTRO_BLOCK = /<!-- getinvolved:intro -->([\s\S]*?)<!-- \/getinvolved:intro -->/;

const CHIPS =
  '<div class="gi-chips" role="group" aria-label="Show on the page" data-chips hidden>' +
  '<button class="gi-chip" type="button" aria-pressed="true" data-show="all">All</button>' +
  '<button class="gi-chip" type="button" aria-pressed="false" data-show="event">Events</button>' +
  '<button class="gi-chip" type="button" aria-pressed="false" data-show="fundraiser">Fundraisers</button>' +
  "</div>" +
  '<p class="sr-only" role="status" aria-live="polite" data-chips-status></p>' +
  '<p class="gi-empty" data-chips-empty="fundraiser" hidden>No fundraisers on the page just now. Could yours be the first? ' +
  '<a href="/fundraise">Fundraise for us</a></p>';

const INTRO_ON =
  '<span class="eyebrow">Get involved</span>' +
  '<h1 id="events-heading">Join in, or raise money your way.</h1>' +
  '<div class="rule"><i></i></div>' +
  '<p class="lede">Nights out, workshops and gatherings for NBCC, and local people raising money in their own way. Come along, give to a fundraiser, or start your own.</p>' +
  '<p class="gi-hero-cta"><a class="btn btn-primary" href="/fundraise">Fundraise for us</a></p>';

const PANEL =
  '<section class="section gi-fundraise" id="fundraise-panel" aria-labelledby="fundraise-panel-heading">' +
  '<div class="wrap"><div class="gi-panel">' +
  '<div class="gi-panel__words">' +
  '<span class="eyebrow">Fundraise for us</span>' +
  '<h2 id="fundraise-panel-heading">Raise money your way, and we will help.</h2>' +
  '<div class="rule"><i></i></div>' +
  "<p>A sponsored walk, a bake sale, a quiz night or a birthday. Tell us your plans and we will be in touch.</p>" +
  '<ul class="gi-panel__list">' +
  "<li>Your own page with a meter and a QR code, if you are raising money</li>" +
  "<li>Your event on this page, if you would like it shown</li>" +
  "<li>Posters, leaflets and a collection bucket or tin</li>" +
  "<li>A shout out on our social media</li>" +
  "</ul>" +
  "</div>" +
  '<div class="gi-panel__actions">' +
  '<a class="btn btn-primary" href="/fundraise">Fundraise for us</a>' +
  '<a class="gi-panel__link" href="/fundraise/manage">Already fundraising? Change your page</a>' +
  "</div>" +
  "</div></div></section>";

export interface GetInvolvedInput {
  events: EventRecord[];
  /** Approved, public and listed (the caller applies isListed), both paths. */
  fundraisers: PublicCard[];
  fundraisingOn: boolean;
  /** Today in UK time, YYYY-MM-DD: a community event already over never shows. */
  today: string;
}

/**
 * The Get involved page. With fundraising switched off it is the Events page exactly as it was (the
 * deck of events and the face down card), with nothing about fundraising anywhere in it.
 */
export function renderGetInvolvedPage(template: string, input: GetInvolvedInput): string {
  const on = input.fundraisingOn;
  let deck: string;
  if (!on) {
    deck = input.events.map((ev) => renderCard(ev)).join("") + renderMoreCard();
  } else {
    const community = input.fundraisers
      .filter((f) => f.path === "event")
      .map(fundraiserEventRecord)
      .filter((ev): ev is CardRecord => ev !== null && ev.date >= input.today);
    const raising = input.fundraisers.filter((f) => f.path === "raising");
    deck =
      sortForPage([...input.events, ...community]).map((ev) => renderCard(ev)).join("") +
      raising.map((f) => renderFundraiserCard(f, input.today)).join("") +
      renderMoreCard("", "/fundraise");
  }
  return template
    .replace(INTRO_BLOCK, (_all, inner: string) => (on ? INTRO_ON : inner))
    .replace(STYLES_MARKER, () => (on ? FUNDRAISING_STYLES : ""))
    .replace(HINT_ALL, () => (on ? HINT_EVENTS : HINT_ALL))
    .replace(CHIPS_MARKER, () => (on ? CHIPS : ""))
    .replace(PANEL_MARKER, () => (on ? PANEL : ""))
    .replace(DECK_MARKER, () => deck);
}

// --- a fundraiser's own page ---------------------------------------------------------------------

/** How many supporters show before Show all. */
export const WALL_FIRST = 10;
const PRESETS_PENCE = [500, 1000, 2000, 5000];

export function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * Event pages: what an event's page says at the top. When, from and to (and "to be confirmed"), where
 * in full, what it costs, how people get in, and who is running it. Tickets are not sold here: how
 * people get in is words, as on its card, with the seller's link when they sell them elsewhere. A
 * sign up from before the event questions has none of those answers, and promises nothing.
 */
function renderEventFacts(p: PublicPage, photo?: string | null): string {
  const items: string[] = [];
  if (p.eventDate) {
    const datetime = p.startTime ? `${p.eventDate}T${p.startTime}` : p.eventDate;
    const time = timeText({ start: p.startTime, end: p.endTime ?? null, timeTbc: p.timeTbc ?? false }, true);
    items.push(
      `<li>${ICON.clock}<span><span class="sr-only">When: </span><time datetime="${escapeHtml(datetime)}">${longDate(p.eventDate)}</time>` +
        `${time ? `, ${escapeHtml(time)}` : ""}</span></li>`,
    );
  }
  // The full address as the card's back has it, led by the venue's name when the address leaves it out.
  const place = fullAddress(p);
  const where = !p.venue || place.includes(p.venue) ? place : [p.venue, place].filter(Boolean).join(", ");
  if (where) items.push(`<li>${ICON.pin}<span><span class="sr-only">Where: </span>${escapeHtml(where)}</span></li>`);
  if (p.price) items.push(`<li>${ICON.ticket}<span><span class="sr-only">Cost: </span>${escapeHtml(p.price)}</span></li>`);
  const getIn = bookingFor(p);
  if (p.booking === "nbcc") {
    // Event tickets: sold here, in the page's own Get tickets section.
    items.push(`<li>${ICON.ticket}<span>${NBCC_FACT_HTML}</span></li>`);
  } else if (getIn.bookingHow === "away") {
    items.push(
      `<li>${ICON.ticket}<span>${escapeHtml(getIn.bookingNote)}. ` +
        `<a href="${escapeHtml(getIn.bookingUrl)}" target="_blank" rel="noopener">Get tickets<span class="sr-only">, opens in a new tab</span></a></span></li>`,
    );
  } else if (getIn.bookingSolo) {
    items.push(`<li>${ICON.ticket}<span>${escapeHtml(getIn.bookingSolo)}</span></li>`);
  } else if (p.booking === "free") {
    items.push(`<li>${ICON.ticket}<span>No need to book. Just come along.</span></li>`);
  }
  items.push(organiserItem(`Organised by ${p.organisedBy}`, p.organisedBy, photo));
  return `<ul class="fr-facts">${items.join("")}</ul>`;
}

/** Event pages: the good to know notes and the access, under an event's story, as its card has them. */
function renderEventNotes(p: PublicPage): string {
  const notes = [noteSentence("Age limit", p.ageLimit), noteSentence("Dress code", p.dressCode), noteSentence("Included", p.included)];
  const access = p.access ?? [];
  if (access.length) notes.push(`Access: ${listPhrase(access)}.`);
  return notes
    .filter(Boolean)
    .map((n) => `<p>${escapeHtml(n)}</p>`)
    .join("");
}

/** "a", "a and b", "a, b and c". */
function listPhrase(items: readonly string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Profile pictures: "Organised by Robin O." with their round photo once staff have approved it, or
 * the person icon as before.
 */
function organiserItem(words: string, name: string, photo?: string | null): string {
  if (isProfilePhotoSrc(photo)) return `<li class="fr-facts__by">${avatarHtml(photo, name)}<span>${escapeHtml(words)}</span></li>`;
  return `<li>${ICON.person}<span>${escapeHtml(words)}</span></li>`;
}

function renderFacts(p: PublicPage, photo?: string | null): string {
  if (p.path === "event") return renderEventFacts(p, photo);
  const items: string[] = [];
  if (p.eventDate) {
    const datetime = p.startTime ? `${p.eventDate}T${p.startTime}` : p.eventDate;
    items.push(
      `<li>${ICON.clock}<span><span class="sr-only">When: </span><time datetime="${escapeHtml(datetime)}">${longDate(p.eventDate)}</time>` +
        `${p.startTime ? `, ${time12(p.startTime)}` : ""}</span></li>`,
    );
  }
  const place = [p.venue, p.town].filter(Boolean).join(", ");
  if (place) items.push(`<li>${ICON.pin}<span><span class="sr-only">Where: </span>${escapeHtml(place)}</span></li>`);
  // Team pages: a team page names its organiser as the team organiser.
  items.push(organiserItem(`${p.teamName ? "Team organiser: " : "Organised by "}${p.organisedBy}`, p.organisedBy, photo));
  return `<ul class="fr-facts">${items.join("")}</ul>`;
}

export function renderWallItem(w: WallEntry, i: number, now: Date): string {
  const more = i >= WALL_FIRST ? " data-wall-more" : "";
  return (
    `<li class="fr-wall__item"${more}${i === WALL_FIRST ? ' tabindex="-1"' : ""}>` +
    '<p class="fr-wall__head">' +
    `<span class="fr-wall__who">${escapeHtml(w.name)}</span>` +
    (w.amountPence !== null
      ? `<span class="fr-wall__amount">${formatPounds(w.amountPence)}` +
        (w.giftAidPence ? ` <span class="fr-wall__giftaid">+ ${formatPounds(w.giftAidPence)} Gift Aid</span>` : "") +
        "</span>"
      : "") +
    "</p>" +
    (w.message ? `<p class="fr-wall__msg">${escapeHtml(w.message)}</p>` : "") +
    `<p class="fr-wall__when"><time datetime="${escapeHtml(w.createdAt)}">${timeAgo(w.createdAt, now)}</time></p>` +
    "</li>"
  );
}

function renderWall(p: PublicPage, now: Date): string {
  const count = p.wall.length;
  const body = count
    ? `<ol class="fr-wall__list" role="list" data-wall>${p.wall.map((w, i) => renderWallItem(w, i, now)).join("")}</ol>` +
      (count > WALL_FIRST
        ? `<button class="fr-wall__more" type="button" data-wall-show-all hidden>Show all ${count} supporters</button>`
        : "")
    : '<p class="fr-wall__empty">No donations yet. Yours could be the first.</p>';
  return (
    '<section class="fr-wall" aria-labelledby="fr-wall-heading">' +
    '<h2 id="fr-wall-heading">Supporters</h2>' +
    (count ? `<p class="fr-wall__count">${count === 1 ? "1 person has" : `${count} people have`} given on this page, newest first.</p>` : "") +
    body +
    "</section>"
  );
}

/** Copy the link, Facebook and WhatsApp: plain links, no script from anyone else. */
export function shareLinks(p: PublicPage, pageUrl: string, text?: string): string {
  const shareText = text ?? `${p.title}, raising money for NBCC: ${pageUrl}`;
  return (
    '<div class="fr-share__links">' +
    `<button class="fr-share__btn fr-share__copy" type="button" data-copy-link="${escapeHtml(pageUrl)}" hidden>${ICON.link}Copy the link</button>` +
    `<a class="fr-share__btn fr-share__facebook" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">${ICON.facebook}Facebook<span class="sr-only">, opens in a new tab</span></a>` +
    `<a class="fr-share__btn fr-share__whatsapp" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">${ICON.whatsapp}WhatsApp<span class="sr-only">, opens in a new tab</span></a>` +
    "</div>"
  );
}

function renderShare(p: PublicPage, pageUrl: string): string {
  const shown = pageUrl.replace(/^https?:\/\//, "");
  return (
    '<section class="card fr-card fr-share" aria-labelledby="fr-share-heading" data-copy-scope>' +
    '<h2 id="fr-share-heading">Share this page</h2>' +
    `<p>Every share helps ${sharer(p)} reach more people.</p>` +
    shareLinks(p, pageUrl) +
    `<p class="fr-share__url"><span class="sr-only">The page address: </span>${escapeHtml(shown)}</p>` +
    '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
    "</section>"
  );
}

/**
 * The organiser's first name, for "Robin's total" and "Robin's wall". Team pages: a team page speaks
 * of the team instead ("Exampleton Juniors' total"); a member page keeps its own name.
 */
const firstName = (p: PublicCard & { teamName?: string | null }) => escapeHtml(p.teamName || p.organisedBy.split(" ")[0]);
/** "Robin's", "Exampleton Juniors'": a name ending in s takes just the apostrophe. Escaped. */
const whose = (p: PublicCard & { teamName?: string | null }) => {
  const name = p.teamName || p.organisedBy.split(" ")[0];
  return `${escapeHtml(name)}${/s$/i.test(name) ? "'" : "'s"}`;
};

// Jaimie, 2026-10-03: shared with another cause. Money given on the page is NBCC's share; the
// statement the 2009 regulations ask for sits beside the Give button (renderSplit).
// Clarity audit: the statement reads as if each gift were split, so the give box says plainly that
// every gift here is NBCC's, and who to ask about giving to the other cause.
/**
 * Who a giver would ask or hand money to, in the middle of a sentence: the organiser's first name,
 * the team's name on a team page, or "the organiser" when the first word is no one's first name (a
 * group's "The ...", "Anonymous", anything that is not a plain word of letters). Not escaped.
 */
function askWho(p: PublicPage): string {
  if (p.teamName) return p.teamName;
  const word = p.organisedBy.trim().split(/\s+/)[0] ?? "";
  const first = /^(the|anonymous)$/i.test(word) ? null : safeFirstName(word);
  return first ?? "the organiser";
}
const possessive = (name: string): string => `${name}${/s$/i.test(name) ? "'" : "'s"}`;
/**
 * Whose total a gift counts towards: "Robin's", "Exampleton Juniors'", or "this page's" when the
 * organiser's first word is no one's first name, so one give box never says both "The's" and "the
 * organiser". Escaped.
 */
const totalOf = (p: PublicPage): string => (askWho(p) === "the organiser" ? "this page's" : whose(p));
const sentenceStart = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

function shareLine(p: PublicPage): string {
  if (!p.split) return "";
  const who = escapeHtml(askWho(p));
  const other = p.split.otherCauseName;
  return (
    // No possessive of the other cause's name: it reads badly after "Ltd." or a name ending in s.
    `<p class="give-step-sub fr-give-share">Everything you give on this page goes to NBCC. ${sentenceStart(who)} is collecting ` +
    `the share for ${escapeHtml(other)} separately, so if you'd like to support them too, please ask ${who} how.</p>`
  );
}

/**
 * Clarity audit: a sponsor already on the paper sponsor form who also gives online is counted twice,
 * and Gift Aid could be claimed twice. Only on a page raising money that is still going (never an
 * event's, never one in memory of someone, which have their own words; a finished page is as it was).
 */
function paperLine(p: PublicPage): string {
  if (p.teamName) {
    return `<p class="give-step-sub fr-give-paper">Giving here is sponsoring the team. Already on a paper sponsor form for the team? Then please just hand the money to whoever has the form, so it isn't counted twice.</p>`;
  }
  const who = escapeHtml(askWho(p));
  return `<p class="give-step-sub fr-give-paper">Giving here is sponsoring ${who}. Already on ${escapeHtml(possessive(askWho(p)))} paper sponsor form? Then please just hand ${who} the money, so it isn't counted twice.</p>`;
}

/** What the give box needs to know of a team: a member page still on its team, or a team's member count. */
export interface GiveTeam {
  member?: boolean;
  members?: number;
}

/** Clarity audit: whose total a gift counts towards, on a team page and on a team member's page. */
function countsTowards(p: PublicPage, team: GiveTeam): string {
  if (p.teamName) {
    // With nobody on the team yet, there is no one to find under The team.
    const one = team.members ? " To sponsor one person, give on their own page: you'll find everyone under The team." : "";
    return `Your donation goes to NBCC and counts towards the team's total.${one}`;
  }
  return `Your donation goes to NBCC and counts towards ${totalOf(p)} total${team.member ? ", and the team's total too" : ""}.`;
}
/** Jaimie, 2026-10-03 (event clarity): an event's give box says it as a line of its own instead. */
const EVENT_SHARE_LINE = (p: PublicPage): string => (p.split ? '<p class="give-step-sub fr-give-share">Everything you give on this page goes to NBCC.</p>' : "");

/** The split statement, beside the Give button; nothing when it is not shared. */
function renderSplit(p: PublicPage): string {
  return p.split ? `<p class="fr-split">${escapeHtml(p.split.statement)}</p>` : "";
}

// Event pages: an event is often credited to a group or a business ("The Red Lion"), whose first word
// is no one's first name, so an event's page speaks of the event instead. A fundraiser's is unchanged.
const isEvent = (p: PublicCard) => p.path === "event";
/** Who a share helps: "Robin", or "this event". */
const sharer = (p: PublicCard) => (isEvent(p) ? "this event" : firstName(p));
/** Whose wall: "Robin's wall", or "the wall". */
const wallOf = (p: PublicCard & { teamName?: string | null }) => (isEvent(p) ? "the wall" : `${whose(p)} wall`);

/**
 * Jaimie, 2026-10-03: the line under an event's "Make a donation", by how people get in. Giving on
 * an event's page is a donation, never a ticket, and Gift Aid must never go on entry or ticket money.
 */
function eventGiveSub(p: PublicPage): string {
  const counts = "Every gift here counts towards this event's total.";
  if (p.booking === "free") return "Entry is free, so giving is entirely up to you. Every gift here goes to NBCC and counts towards this event's total.";
  const notTicket = "This is a donation to NBCC, not a ticket.";
  if (p.booking === "door") return `${notTicket} Entry is paid on the door on the day. ${counts}`;
  if (p.booking === "away") {
    const url = safeTicketUrl(p.ticketUrl);
    const seller = url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">the seller's website<span class="sr-only">, opens in a new tab</span></a>`
      : "the seller's website";
    return `${notTicket} To get in, please get your ticket from ${seller}. ${counts}`;
  }
  return `${notTicket} ${counts}`;
}

/** Event pages: how to get in, directly above "Make a donation"; nothing when it was never asked. */
function renderEntryLine(p: PublicPage): string {
  const line = entryLine(p);
  if (!line) return "";
  const seller = line.url
    ? `<a href="${escapeHtml(line.url)}" target="_blank" rel="noopener">${escapeHtml(line.seller)}<span class="sr-only">, opens in a new tab</span></a>`
    : "";
  return `<p class="fr-summary__entry">${escapeHtml(line.lead)}${seller}</p>`;
}

/** After giving on an event's page: a reminder that it was a donation, not a ticket. Free events need none. */
function eventThanksNote(p: PublicPage, now: Date): string {
  if (!isEvent(p) || p.booking === "free") return "";
  // Once it has finished or its day has passed, there is no door to pay on or ticket to get.
  const over = p.finished || (p.eventDate ? p.eventDate < londonToday(now) : false);
  const clause = over
    ? ""
    : p.booking === "door" ? ", so please still pay on the door as usual" : p.booking === "away" ? ", so please still get your ticket as usual" : "";
  return `<p class="fr-thanks__entry">Just so you know, this was a donation rather than a ticket${clause}.</p>`;
}

/** In memory (./memory-render.ts): the give form's heading and line in its own words. */
export interface GiveWords {
  heading: string;
  sub: string;
}

/** impact: what gifts could do (./impact-render.ts); none unless the page's own renderer passes it. */
export function renderGiveForm(p: PublicPage, words?: GiveWords, impact: ImpactParts = NO_IMPACT, team: GiveTeam = {}): string {
  const event = isEvent(p);
  const presets = PRESETS_PENCE.map(
    (pence) =>
      `<label class="fr-amount"><input type="radio" name="frAmount" value="${pence}" />` +
      `<span class="fr-amount__face">${formatPounds(pence)}</span>${impact.preset(pence)}</label>`,
  ).join("");
  const min = formatPounds(p.giving.minimumPence);
  return (
    '<section class="fr-give" id="give" aria-labelledby="fr-give-heading" tabindex="-1">' +
    '<div class="card card-lg give-card fr-give-card"><div class="give-main">' +
    (words
      ? `<h2 class="give-step-title" id="fr-give-heading">${escapeHtml(words.heading)}</h2>` +
        `<p class="give-step-sub">${escapeHtml(words.sub)}</p>`
      : p.finished
      ? '<h2 class="give-step-title" id="fr-give-heading">You can still give</h2>' +
        (event
          ? `<p class="give-step-sub">Your donation goes to NBCC and still counts towards this event's total.</p>${EVENT_SHARE_LINE(p)}`
          : `<p class="give-step-sub">Your donation goes to NBCC and still counts towards ${totalOf(p)} total${p.teamName || askWho(p) === "the organiser" ? "" : ` for ${escapeHtml(p.title)}`}.</p>${shareLine(p)}`)
      : event
        ? '<h2 class="give-step-title" id="fr-give-heading">Make a donation</h2>' + `<p class="give-step-sub">${eventGiveSub(p)}</p>${EVENT_SHARE_LINE(p)}`
        : `<h2 class="give-step-title" id="fr-give-heading">Give to ${escapeHtml(p.title)}</h2>` +
          `<p class="give-step-sub">${countsTowards(p, team)}</p>${shareLine(p)}${paperLine(p)}`) +
    // Shipped hidden: without JavaScript the browser would send it as a web address, names and all.
    '<p class="fr-noscript" data-nojs>Giving on this page needs JavaScript switched on. You can still donate on our <a href="/donate">donate page</a>.</p>' +
    `<form id="frGiveForm" class="fr-give-form" data-fundraiser-id="${p.giving.fundraiserId}" data-minimum-pence="${p.giving.minimumPence}"${impact.formAttr} novalidate hidden data-needs-js>` +
    '<p class="form-error-summary" role="alert" data-give-error hidden></p>' +
    // 1. how much
    '<div class="give-question">' +
    '<fieldset class="fr-fieldset" id="frAmountGroup"><legend class="give-scope-legend">How much would you like to give?</legend>' +
    `<div class="fr-amounts">${presets}</div>` +
    '<div class="give-field fr-own">' +
    `<label class="give-custom-label" for="frOwnAmount">Or choose your own amount, ${min} or more</label>` +
    '<div class="give-custom-field"><span class="give-custom-currency" aria-hidden="true">£</span>' +
    `<input class="give-custom-input" id="frOwnAmount" name="frOwnAmount" type="number" inputmode="decimal" min="${p.giving.minimumPence / 100}" step="0.01" placeholder="Amount"${impact.ownAttr} />` +
    "</div></div>" +
    impact.afterOwn +
    "</fieldset></div>" +
    // 2. who
    '<div class="give-question">' +
    '<fieldset class="give-contact fr-fieldset"><legend class="give-contact-legend">Your details</legend>' +
    '<div class="give-name-row">' +
    '<div class="give-field"><label for="frFirstName">First name <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frFirstName" name="frFirstName" type="text" autocomplete="given-name" required aria-required="true" data-invalid-message="Please tell us your first name" /></div>' +
    '<div class="give-field"><label for="frSurname">Surname <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frSurname" name="frSurname" type="text" autocomplete="family-name" required aria-required="true" data-invalid-message="Please tell us your surname" /></div>' +
    "</div>" +
    '<div class="give-field"><label for="frEmail">Email <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frEmail" name="frEmail" type="email" autocomplete="email" required aria-required="true" placeholder="you@example.com" />' +
    '<p class="give-field-help">We only use this to send your receipt and a thank you. We never share it.</p></div>' +
    '<div class="give-newsletter"><label class="give-check give-newsletter-check" for="frEmailConsent">' +
    '<input class="give-check-box" id="frEmailConsent" name="frEmailConsent" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add me to our donor newsletter.</strong> A warm little update from NBCC on the difference your support helps make. Unsubscribe anytime.</span>' +
    "</label></div>" +
    '<p class="give-field-help give-privacy">We handle your details as set out in our <a href="/privacy">Privacy notice</a>.</p>' +
    "</fieldset></div>" +
    // (TASK-502: the message and the two wall choices moved to the thank you after paying.)
    // 3. Gift Aid, the donate page's callout and declaration, one off wording
    '<div class="give-question">' +
    '<div class="giftaid">' +
    '<div class="giftaid-head">' +
    // An event's headline never echoes the amount: it can match the entry price (fundraiser.js).
    `<strong class="giftaid-headline" data-giftaid-headline${event ? " data-giftaid-fixed" : ""}>Make your donation worth 25% more</strong>` +
    '<span class="giftaid-logo" aria-hidden="true">gift aid it</span></div>' +
    '<p class="giftaid-intro">If you are a UK taxpayer, NBCC can turn every £1 you give into £1.25 on eligible donations, at no cost to you. That is 25% more for the people NBCC helps.</p>' +
    (event ? '<p class="giftaid-intro giftaid-entry">Gift Aid is only for donations, never for entry or ticket money.</p>' : "") +
    '<div class="giftaid-check-row">' +
    '<input class="giftaid-check" id="frGiftAid" name="frGiftAid" type="checkbox" />' +
    '<label class="giftaid-label" for="frGiftAid"><strong>Yes, add Gift Aid. I am a UK taxpayer.</strong>' +
    `<span class="giftaid-statement">${escapeHtml(SINGLE_DONATION_WORDING.wording_snapshot)}</span></label>` +
    "</div></div>" +
    '<fieldset class="give-declaration fr-declaration" id="frDeclaration" hidden>' +
    '<legend class="give-declaration-legend">Your home address for Gift Aid</legend>' +
    '<p class="give-declaration-help">HMRC needs these to match your donation to your tax record.</p>' +
    '<div class="give-field"><label for="frHouse">House name or number <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frHouse" name="frHouse" type="text" required aria-required="true" placeholder="e.g. 12 or Rose Cottage" data-invalid-message="Please give your house name or number" /></div>' +
    '<div class="give-field"><label for="frAddress">Home address <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frAddress" name="frAddress" type="text" autocomplete="street-address" required aria-required="true" placeholder="Street and town" data-invalid-message="Please give your street and town" /></div>' +
    '<div class="give-field" id="frPostcodeField"><label for="frPostcode">Postcode <span class="give-req" aria-hidden="true">*</span></label>' +
    '<input class="give-field-input" id="frPostcode" name="frPostcode" type="text" autocomplete="postal-code" required aria-required="true" placeholder="e.g. KA1 1AA" ' +
    'pattern="[A-Za-z]{1,2}[0-9][A-Za-z0-9]? ?[0-9][A-Za-z]{2}" data-invalid-message="Please give a UK postcode, like KA1 1AA" /></div>' +
    '<label class="give-check" for="frNonUk"><input class="give-check-box" id="frNonUk" name="frNonUk" type="checkbox" />' +
    '<span class="give-check-text">My home address is outside the UK</span></label>' +
    "</fieldset>" +
    "</div>" +
    // 4. the card fee
    '<div class="give-question">' +
    '<label class="give-check" for="frCoverFee"><input class="give-check-box" id="frCoverFee" name="frCoverFee" type="checkbox" />' +
    '<span class="give-check-text"><strong>Add <span data-cover-fee-amount>a little</span> to cover the card fee.</strong> Card payments cost NBCC a small fee. Cover it and your donation funds our work rather than the card company. Gift Aid still applies to your donation only.</span></label>' +
    "</div>" +
    '<div class="give-cta-row">' +
    '<button class="btn btn-primary give-cta" type="submit" data-give-submit data-give-pay>Give now</button>' +
    '<p class="give-pay-note">Secure payment by Stripe. Card, Apple Pay and Direct Debit.</p>' +
    "</div>" +
    "</form>" +
    "</div></div>" +
    "</section>"
  );
}

// Stripe's own checkout opens on the page in this panel, exactly as on the donate page; main.js is
// not what drives it here (assets/js/fundraiser.js is), but the markup and styles are the donate
// page's, so it looks the same.
export const EMBEDDED_CHECKOUT =
  '<div class="give-embedded-modal" id="embeddedCheckoutModal" role="dialog" aria-modal="true" aria-label="Secure payment" aria-hidden="true" hidden>' +
  '<div class="give-embedded-panel"><div class="give-embedded-bar">' +
  '<button class="give-embedded-close" id="embeddedCheckoutClose" type="button">Close</button></div>' +
  '<div class="give-embedded-mount" id="frEmbeddedCheckout"></div></div></div>';

export const PAGE_MARKER = "<!-- fundraiser:page -->";
export const INTRO_MARKER = "<!-- fundraiser:intro -->";
export const CHECKOUT_MARKER = "<!-- fundraiser:checkout -->";

export interface FundraiserPageOptions {
  /** The page's own full address, for sharing and the canonical link. */
  pageUrl: string;
  now: Date;
  /**
   * A giver coming back from paying (?thanks=1, the return address the server gave Stripe): a thank
   * you at the top. TASK-502: with the paid checkout session's id (?session_id=, which Stripe fills
   * in), when the route has checked it may still add to the wall, it offers the optional step;
   * `added` is the thank you after that step. `message` is for a gift made before TASK-502, whose
   * message was left on the give form (?message=1).
   */
  thanks?: { message: boolean; sessionId?: string | null; added?: boolean };
  /**
   * Team pages (src/fundraising/team-render.ts): a team's "Join this team" under the give button and
   * its members after the story; a member page's team under its facts. Nothing for any other page.
   */
  team?: { summaryHtml?: string; mainHtml?: string; factsHtml?: string; memberCount?: number };
  /**
   * What gifts could do (src/fundraising/impact-render.ts): the examples switched on, for the lines
   * under the give amounts and the meter. None (a page in memory of someone): no lines at all.
   */
  impact?: readonly ImpactExample[];
  /**
   * Profile pictures: the organiser's round photo (its /media/fundraiser-profile/ address), once staff
   * have approved it. A page in memory of someone is given none: it shows the photo of the person
   * remembered instead.
   */
  organiserPhotoSrc?: string | null;
  /**
   * Event tickets (src/tickets/page.ts): the thank you after buying at the top, the ticket money
   * beside the gifts in the summary, and the Get tickets section, apart from and above the give form.
   */
  tickets?: { introHtml?: string; summaryHtml?: string; mainHtml?: string };
}

/**
 * TASK-502: the optional step after paying: a message for the wall, and the name and amount choices
 * that were on the give form. Tied to the paid checkout session by its id; the server checks it all
 * again when it is sent (POST /api/fundraisers/:slug/wall-message). Shipped hidden: the script that
 * can send it shows it, so without JavaScript the thank you is simply the plain one.
 */
function renderWallStep(p: PublicPage, sessionId: string): string {
  return (
    // Event pages: an event's page says where to come back to (fundraiser.js goes to /fundraise/<slug>
    // without it, as a fundraiser's page always has).
    `<section class="fr-after" data-wall-step data-slug="${escapeHtml(p.slug)}"${p.path === "event" && p.url ? ` data-page="${escapeHtml(p.url)}"` : ""} data-session-id="${escapeHtml(sessionId)}" aria-labelledby="fr-after-heading" hidden>` +
    `<h3 class="fr-after__title" id="fr-after-heading">Add a message to ${wallOf(p)} <span class="give-optional">(optional)</span></h3>` +
    "<p>Only if you would like to. Your donation already counts, with or without one.</p>" +
    '<form id="frWallForm" class="fr-after__form" novalidate>' +
    '<p class="form-error-summary" role="alert" data-wall-error hidden></p>' +
    '<div class="give-field"><label for="frMessage">Your message <span class="give-optional">(optional)</span></label>' +
    '<textarea class="give-field-input fr-message" id="frMessage" name="frMessage" rows="3" maxlength="200" aria-describedby="frMessageCount"></textarea>' +
    '<p class="give-field-help" id="frMessageCount" data-message-count>Up to 200 characters.</p></div>' +
    '<div class="give-donor-options fr-choice" role="radiogroup" aria-label="Your name on the wall">' +
    // The whole pill is the label, so a tap anywhere on it chooses (the donate page's look).
    '<label class="give-donor-option" for="frShowNameYes"><input id="frShowNameYes" name="frShowName" type="radio" value="yes" checked />Show my name</label>' +
    '<label class="give-donor-option" for="frShowNameNo"><input id="frShowNameNo" name="frShowName" type="radio" value="no" />Stay anonymous</label>' +
    "</div>" +
    '<p class="give-field-help">We show your first name and the first letter of your surname, like Robin T.</p>' +
    '<label class="give-check" for="frShowAmount"><input class="give-check-box" id="frShowAmount" name="frShowAmount" type="checkbox" checked />' +
    '<span class="give-check-text">Show how much I gave</span></label>' +
    '<div class="fr-after__actions">' +
    '<button class="btn btn-primary" type="submit" data-wall-submit>Add to the wall</button>' +
    '<button class="btn btn-ghost fr-after__skip" type="button" data-wall-skip>No thanks</button>' +
    "</div>" +
    "</form>" +
    "</section>"
  );
}

/** The thank you a giver sees on coming back from paying, with the share links. */
function renderThanks(p: PublicPage, pageUrl: string, thanks: NonNullable<FundraiserPageOptions["thanks"]>, now: Date): string {
  const lead = thanks.added
    ? `<p>We have added that to ${wallOf(p)}. <a href="#fr-wall-heading">See the wall</a></p>`
    : `<p>${thanks.message ? "Your message will appear on the wall shortly. " : ""}Your donation will show on the meter shortly.</p>`;
  return (
    '<div class="fr-thanks-panel" data-thanks-panel data-copy-scope tabindex="-1">' +
    `<h2>Thank you for supporting ${escapeHtml(p.title)}.</h2>` +
    lead +
    eventThanksNote(p, now) +
    (thanks.sessionId && !thanks.added ? renderWallStep(p, thanks.sessionId) : "") +
    `<p>Could you share the page too? Every share helps ${sharer(p)} reach more people.</p>` +
    shareLinks(p, pageUrl) +
    '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
    "</div>"
  );
}

/**
 * TASK-502: a finished fundraiser keeps its page. It says so, with what was raised, and the give
 * form stays below under "You can still give": the link on a poster or a post works for good.
 */
function renderFinished(p: PublicPage): string {
  return (
    '<div class="fr-finished">' +
    '<h2 class="fr-finished__title">Finished, thank you</h2>' +
    `<p>${isEvent(p) ? "This event has finished" : `${firstName(p)} has finished fundraising`}, and together supporters raised <strong>${formatPounds(p.meter.raisedPence)}</strong> for NBCC. ` +
    'Thank you to everyone who gave. <a href="#give">You can still give</a>.</p>' +
    "</div>"
  );
}

// --- the countdown and the day itself (TASK-506) ---------------------------------------------------

const STAR = '<svg class="fr-today__star" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.3 6.8.6-5.2 4.5 1.6 6.6L12 16.6 6.2 20l1.6-6.6L2.6 8.9l6.8-.6z"/></svg>';

/**
 * Under the date while it is still to come: "12 days to go", or "Tomorrow!". On the day: a banner
 * wishing the organiser luck, with the page's own share links, as the day is when a share helps
 * most. Nothing after the date, or once finished. The first name is only ever one plain word of
 * letters (safeFirstName, as the emails greet people); anything else and the banner has no name.
 * Drawn on the server, so it is right as the page opens: the page is revalidated on every view.
 */
function renderCountdown(p: PublicPage, now: Date, pageUrl: string): string {
  const c = countdownFor({ eventDate: p.eventDate, finished: p.finished }, now);
  if (!c) return "";
  if (c.kind === "days") {
    return c.days === 1
      ? '<p class="fr-countdown fr-countdown--soon">Tomorrow!</p>'
      : `<p class="fr-countdown"><span class="fr-countdown__num">${c.days}</span> days to go</p>`;
  }
  const word = p.organisedBy.trim().split(/\s+/)[0] ?? "";
  // Team pages: a team page wishes the team luck, by its name.
  const first = p.teamName ? p.teamName : word.toLowerCase() === "anonymous" ? null : safeFirstName(word);
  // Event pages: an event's name is often a group's or a business's, so on its day it has no name.
  const today = isEvent(p)
    ? "<h2 class=\"fr-today__title\">Today's the day!</h2><p>A share today goes a long way.</p>"
    : `<h2 class="fr-today__title">Today's the day! Good luck${first ? `, ${escapeHtml(first)}!` : "!"}</h2>` +
      `<p>Cheer ${first ? escapeHtml(first) : "them"} on: a share today goes a long way.</p>`;
  return (
    '<div class="fr-today" data-copy-scope>' +
    STAR +
    today +
    shareLinks(p, pageUrl) +
    '<p class="fr-share__status" role="status" aria-live="polite" data-copy-status></p>' +
    "</div>"
  );
}

// --- the news updates (TASK-506) ---------------------------------------------------------------------

/** How many updates show before Show all. */
export const NEWS_FIRST = 3;

const NEWS_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" });

/**
 * One update: its date, the organiser's words, and the photo if it has one. The photo sits in a
 * small frame of one shape (4 by 3, cropped to fill it), never across the page: a whole poster or
 * flyer there looked bad on a card live, so a picture here is only ever a modest one beside the
 * words. Its alt is the start of the update, as that is what the picture is about.
 */
function renderNewsItem(n: NewsEntry, i: number): string {
  const more = i >= NEWS_FIRST ? " data-news-more" : "";
  const alt = `A photo with the update: ${shorten(n.text, 110)}`;
  return (
    `<li class="fr-news__item${n.photoSrc ? " has-photo" : ""}"${more}${i === NEWS_FIRST ? ' tabindex="-1"' : ""}>` +
    (n.photoSrc
      ? '<figure class="fr-news__photo">' +
        `<img src="${escapeHtml(n.photoSrc)}" alt="${escapeHtml(alt)}" width="400" height="300" loading="lazy" decoding="async" />` +
        "</figure>"
      : "") +
    '<div class="fr-news__words">' +
    `<p class="fr-news__when"><time datetime="${escapeHtml(n.createdAt)}">${NEWS_DATE.format(new Date(n.createdAt))}</time></p>` +
    `<p class="fr-news__text">${escapeHtml(n.text).replace(/\r?\n/g, "<br />")}</p>` +
    "</div>" +
    "</li>"
  );
}

export function renderNews(p: PublicPage): string {
  const items = p.news ?? [];
  if (!items.length) return "";
  return (
    '<section class="fr-news" aria-labelledby="fr-news-heading">' +
    '<h2 id="fr-news-heading">News</h2>' +
    `<ol class="fr-news__list" role="list" data-news>${items.map(renderNewsItem).join("")}</ol>` +
    (items.length > NEWS_FIRST
      ? `<button class="fr-wall__more" type="button" data-news-show-all hidden>Show all ${items.length} updates</button>`
      : "") +
    "</section>"
  );
}

/** One fundraiser's page: the template's head filled in, and the page where its markers are. */
export function renderFundraiserPage(template: string, p: PublicPage, opts: FundraiserPageOptions): string {
  const origin = (() => {
    try {
      return new URL(opts.pageUrl).origin;
    } catch {
      return "";
    }
  })();
  const event = p.path === "event";
  const impact = impactParts(opts.impact, p.meter.raisedPence);
  const description = event
    ? `A community event raising money for NBCC, organised by ${p.organisedBy}. ${shorten(p.description, 140)}`
    : `${p.teamName || p.organisedBy} is raising money for NBCC. ${shorten(p.description, 140)}`;
  const image = p.imageSrc ? `${origin}${p.imageSrc}` : "https://nbcc.scot/assets/img/og-image.png";
  const intro =
    `<span class="eyebrow">${escapeHtml(p.kindLabel)}</span>` +
    `<h1 id="fr-title">${escapeHtml(p.title)}</h1>` +
    '<div class="rule"><i></i></div>' +
    renderFacts(p, opts.organiserPhotoSrc) +
    (opts.team?.factsHtml ?? "") +
    renderCountdown(p, opts.now, opts.pageUrl) +
    (p.finished ? renderFinished(p) : "") +
    (opts.thanks ? renderThanks(p, opts.pageUrl, opts.thanks, opts.now) : "") +
    (opts.tickets?.introHtml ?? ""); // event tickets
  const body =
    '<div class="card card-lg fr-summary">' +
    '<h2 class="sr-only">Money raised so far</h2>' +
    renderMeter(p.meter, { large: true }) +
    (event ? '<p class="fr-meter__paidin">Includes any money the organiser has paid in.</p>' : "") +
    (p.teamName ? '<p class="fr-meter__paidin">Includes everything the team members have raised.</p>' : "") +
    impact.afterMeter +
    renderSplit(p) +
    (opts.tickets?.summaryHtml ?? "") + // event tickets
    (event && !p.finished ? renderEntryLine(p) : "") +
    `<a class="btn btn-primary fr-summary__give" href="#give">${p.finished ? "You can still give" : event ? "Make a donation" : "Give to this fundraiser"}</a>` +
    (opts.team?.summaryHtml ?? "") +
    "</div>" +
    '<div class="fr-main">' +
    (p.imageSrc
      ? `<figure class="fr-photo"><img src="${escapeHtml(p.imageSrc)}" alt="${escapeHtml(`A picture for ${p.title}`)}" decoding="async" /></figure>`
      : "") +
    '<section class="fr-story" aria-labelledby="fr-story-heading">' +
    `<h2 id="fr-story-heading">${event ? "About this event" : p.teamName ? "About the team" : "About this fundraiser"}</h2>` +
    paragraphs(p.description) +
    (event ? renderEventNotes(p) : "") +
    "</section>" +
    (opts.team?.mainHtml ?? "") +
    renderNews(p) +
    (opts.tickets?.mainHtml ?? "") + // event tickets: its own section, never inside the give form
    // A member page still on its team is the one handed the team's line for under its facts.
    renderGiveForm(p, undefined, impact, { member: Boolean(opts.team?.factsHtml), members: opts.team?.memberCount }) +
    renderWall(p, opts.now) +
    "</div>" +
    `<div class="fr-extras">${renderShare(p, opts.pageUrl)}</div>`;

  const fill: Record<string, string> = {
    __TITLE__: escapeHtml(p.title),
    __DESCRIPTION__: escapeHtml(description),
    __PAGE_URL__: escapeHtml(opts.pageUrl),
    __OG_IMAGE__: escapeHtml(image),
  };
  return template
    .replace(/__(TITLE|DESCRIPTION|PAGE_URL|OG_IMAGE)__/g, (token) => fill[token])
    .replace(INTRO_MARKER, () => intro)
    .replace(PAGE_MARKER, () => body)
    .replace(CHECKOUT_MARKER, () => EMBEDDED_CHECKOUT);
}

// --- the sign up page ----------------------------------------------------------------------------

// The category radios sit between these, so the server can draw them from the database's list.
const KINDS_BLOCK = /<!-- kinds -->[\s\S]*?<!-- \/kinds -->/;
const INDENT = "\n                    ";
const KINDS_ROWS = /data-kind-options style="--rows: \d+"/;

/** The rows the categories take at two columns, read down each column: half the list, rounded up. */
export function kindRows(count: number): number {
  return Math.max(1, Math.ceil(count / 2));
}

/**
 * The category radios, in the order given (formCategories: A to Z, Other last). The first
 * carries the form's "choose one" messages, worded for each path (fundraise.js swaps them in).
 * fundraise.html is written with exactly this for the starting list (a unit test holds them together).
 */
export function kindOptionsHtml(categories: ReadonlyArray<{ key: string; label: string; sporty?: boolean }>): string {
  return categories
    .map((c, i) => {
      const key = escapeHtml(c.key);
      const say =
        i === 0
          ? // The sign up tidy: a warm, short prompt, worded for each path.
            ` data-invalid-message="Almost! Just choose what you're doing." data-invalid-raising="Almost! Just choose what you're doing to raise money." data-invalid-event="Almost! Just choose what kind of event it is."`
          : "";
      return (
        // The sign up tidy: a sporting category is marked, so the form can offer only those (or only
        // the rest) once they say whether it is a sporting event. Other is never marked: it is in both.
        `<label class="fr-option fr-option--small" for="kind-${key}"${c.sporty ? " data-sporty" : ""}><input id="kind-${key}" name="kind" type="radio" value="${key}" ` +
        `required aria-required="true"${say} /><span>${escapeHtml(c.label)}</span></label>`
      );
    })
    .join(INDENT);
}

// The sign up tidy: the in memory ways of giving (memoryCategories) sit between these.
const MEMORY_KINDS_BLOCK = /<!-- memory-kinds -->[\s\S]*?<!-- \/memory-kinds -->/;

/**
 * The sign up tidy: "How will people be giving?", in memory of someone. The in memory ways of giving,
 * then Other as "Something else" (its own id, as the main list has kind-other too). fundraise.html is
 * written with exactly this for the starting list (a unit test holds them together).
 */
export function memoryKindOptionsHtml(categories: ReadonlyArray<{ key: string; label: string }>): string {
  return categories
    .map((c) => {
      const other = c.key === "other";
      const id = other ? "kind-memory-other" : `kind-${escapeHtml(c.key)}`;
      return (
        `<label class="fr-option fr-option--small" for="${id}"><input id="${id}" name="kind" type="radio" value="${escapeHtml(c.key)}" ` +
        `required aria-required="true" /><span>${other ? "Something else" : escapeHtml(c.label)}</span></label>`
      );
    })
    .join(INDENT);
}

/**
 * The sign up page: the form while fundraising is on, a gentle "not open yet" while it is off. With
 * the categories on offer (formCategories), the form offers exactly those; without, it stays as written.
 * The sign up tidy: likewise the in memory ways of giving (memoryCategories).
 */
export function renderFundraiseSignUp(
  template: string,
  open: boolean,
  categories?: ReadonlyArray<{ key: string; label: string; sporty?: boolean }>,
  memoryCategories?: ReadonlyArray<{ key: string; label: string }>,
): string {
  const withMemory =
    memoryCategories && memoryCategories.length > 0
      ? template.replace(MEMORY_KINDS_BLOCK, () => `<!-- memory-kinds -->${INDENT}${memoryKindOptionsHtml(memoryCategories)}${INDENT}<!-- /memory-kinds -->`)
      : template;
  const page =
    categories && categories.length > 0
      ? withMemory
          .replace(KINDS_BLOCK, () => `<!-- kinds -->${INDENT}${kindOptionsHtml(categories)}${INDENT}<!-- /kinds -->`)
          // At two columns the list reads down the left column, then the right: half as many rows.
          .replace(KINDS_ROWS, () => `data-kind-options style="--rows: ${kindRows(categories.length)}"`)
      : withMemory;
  if (open) return page;
  return page
    .replace("data-fundraise-open>", "data-fundraise-open hidden>")
    .replace("data-fundraise-closed hidden>", "data-fundraise-closed>");
}
