import type { EventRecord } from "./model";

// TASK-453: event rows to the card markup of the approved events page.
//
// ONE renderer, used by the public /events route AND by the admin's previews, so what staff see
// while building an event is exactly what the public will get. The markup is the prototype's,
// class for class: assets/css/events.css and assets/js/events.js depend on every name here, and
// test/unit/events-render.test.ts pins them.
//
// Pure: no DB, no config, no fs. Everything a volunteer typed is escaped on the way out, and
// *stars* become bold only AFTER escaping, so no markup ever arrives through the admin form.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SVG = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON = {
  clock: `<svg width="18" height="18" ${SVG}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  pin: `<svg width="18" height="18" ${SVG}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`,
  ticket: `<svg width="18" height="18" ${SVG}><path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z"/><path d="M15 6v12" stroke-dasharray="1.5 2.5"/></svg>`,
  turn: `<svg width="18" height="18" ${SVG}><path d="M20 12a8 8 0 0 0-14.2-5"/><path d="M5 3v4h4"/><path d="M4 12a8 8 0 0 0 14.2 5"/><path d="M19 21v-4h-4"/></svg>`,
};

export const DECK_MARKER = "<!-- events:deck -->";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** *Stars* for bold, the way WhatsApp does it, applied after escaping so it can only ever add <b>. */
export function bolds(value: string): string {
  return escapeHtml(value).replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
}

function dateParts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    dow: DOW[dt.getUTCDay()],
    dayName: DAYS[dt.getUTCDay()],
    day: dt.getUTCDate(),
    mon: MON[dt.getUTCMonth()],
    month: MONTHS[dt.getUTCMonth()],
    year: dt.getUTCFullYear(),
  };
}

/** "18:00" as people say it: 6pm, 7.30pm, 12 noon. */
export function time12(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  if (h === 12 && m === 0) return "12 noon";
  const suffix = h >= 12 ? "pm" : "am";
  return `${h % 12 || 12}${m ? `.${String(m).padStart(2, "0")}` : ""}${suffix}`;
}

/** The time in words. "To be confirmed" goes on the back only: the front has no room to hedge. */
export function timeText(ev: Pick<EventRecord, "start" | "end" | "timeTbc">, long: boolean): string {
  const tbc = long && ev.timeTbc ? " (to be confirmed)" : "";
  if (!ev.start) return long && ev.timeTbc ? "time to be confirmed" : "";
  if (ev.end) return `${time12(ev.start)} to ${time12(ev.end)}${tbc}`;
  return `from ${time12(ev.start)}${tbc}`;
}

function whenShort(ev: EventRecord): string {
  const p = dateParts(ev.date);
  const time = timeText(ev, false);
  return `${p.dow} ${p.day} ${p.mon}${time ? `, ${time}` : ""}`;
}

function joinPlace(...parts: string[]): string {
  return parts.filter(Boolean).join(", ");
}

function hostLine(ev: EventRecord): string {
  return ev.runBy === "partner" ? `${ev.partnerFront} ${ev.partnerName}`.trim() : "Run by NBCC";
}

function listPhrase(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function renderIndex(ev: EventRecord): string {
  const p = dateParts(ev.date);
  return (
    '<p class="ev-index" aria-hidden="true">' +
    `<span class="ev-index__dow">${p.dow}</span><span class="ev-index__day">${p.day}</span><span class="ev-index__mon">${p.mon}</span>` +
    "</p>"
  );
}

// A trailing year or 'NN travels as one piece on the cover, set in the lighter colour.
function coverName(name: string): string {
  const escaped = escapeHtml(name);
  const m = escaped.match(/^(.*?)\s*((?:&#39;|’)\d{2}|\d{4})$/);
  if (!m || !m[1]) return escaped;
  const glue = /^\d{4}$/.test(m[2]) ? " " : "";
  return `${m[1]}${glue}<span>${m[2]}</span>`;
}

// "AD Autocare · Heathfield". The town is dropped when the venue already says it
// ("Annbank Village Hall · Annbank" would say it twice).
function coverPlace(ev: EventRecord): string {
  let town = ev.town.split(",")[0].trim();
  const who = ev.venue || (ev.runBy === "partner" ? ev.partnerName : "");
  if (who && town && who.toLowerCase().includes(town.toLowerCase())) town = "";
  return [who, town].filter(Boolean).join(" · ");
}

function renderArt(ev: EventRecord): string {
  if (ev.imageSrc) {
    const whole = ev.imageFit === "whole";
    const classes = ["ev-art"];
    if (whole) classes.push("ev-art--whole", ev.imageGround === "night" ? "ev-art--night" : `ev-art--ground-${ev.imageGround}`);
    return (
      `<div class="${classes.join(" ")}">` +
      `<img src="${escapeHtml(ev.imageSrc)}" alt="${escapeHtml(ev.imageAlt)}" loading="lazy" decoding="async" />` +
      "</div>"
    );
  }
  const ground = ev.cover === "crimson" ? "" : ` ev-art--${ev.cover}`;
  return (
    `<div class="ev-art ev-art--type${ground}" aria-hidden="true"><div>` +
    `<p class="ev-art__name">${coverName(ev.name)}</p>` +
    '<div class="rule on-dark"><i></i></div>' +
    `<p class="ev-art__place">${escapeHtml(coverPlace(ev))}</p>` +
    "</div></div>"
  );
}

function fact(icon: string, label: string, html: string): string {
  return `<li>${icon}<span><span class="sr-only">${label}: </span>${html}</span></li>`;
}

function renderBooking(ev: EventRecord): string {
  const gap = '<div class="ev-book-gap"></div>';
  if (ev.bookingHow === "none") {
    return `${gap}<p class="ev-book-note ev-book-note--solo">No need to book. Just come along.</p>`;
  }
  const href = escapeHtml(ev.bookingUrl || "#");
  const label = escapeHtml(ev.bookingLabel || "Book");
  if (ev.bookingHow === "away") {
    return (
      gap +
      `<a class="btn btn-primary ev-book ev-book--away" href="${href}" target="_blank" rel="noopener">${label}<span class="sr-only">, opens in a new tab</span></a>` +
      `<p class="ev-book-note">${escapeHtml(ev.bookingNote || "Booking is on another website.")}</p>`
    );
  }
  return `${gap}<a class="btn btn-primary ev-book" href="${href}">${label}</a>`;
}

/** One event as a card: the picture and the gist on the front, everything else on the back. */
export function renderCard(ev: EventRecord, idPrefix = ""): string {
  const id = escapeHtml(`${idPrefix}${ev.slug}`);
  const p = dateParts(ev.date);
  const time = timeText(ev, true);
  const datetime = ev.start ? `${ev.date}T${ev.start}` : ev.date;
  const items = ev.whatsOn
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const placeShort = joinPlace(ev.venue, ev.town);
  const placeLong = ev.address || placeShort;
  const costLong = ev.costBack || ev.costFront;

  const front =
    `<article class="ev-face ev-front" aria-labelledby="${id}-title">` +
    renderArt(ev) +
    renderIndex(ev) +
    '<div class="ev-body">' +
    `<p class="ev-host">${escapeHtml(hostLine(ev))}</p>` +
    `<h2 class="ev-title" id="${id}-title">${escapeHtml(ev.name)}</h2>` +
    (ev.flag ? `<p class="ev-flag">${escapeHtml(ev.flag)}</p>` : "") +
    (ev.gist ? `<p class="ev-tldr">${escapeHtml(ev.gist)}</p>` : "") +
    '<ul class="ev-facts">' +
    fact(ICON.clock, "When", escapeHtml(whenShort(ev))) +
    (placeShort ? fact(ICON.pin, "Where", escapeHtml(placeShort)) : "") +
    (ev.costFront ? fact(ICON.ticket, "Cost", escapeHtml(ev.costFront)) : "") +
    "</ul>" +
    `<button class="ev-turn" type="button" aria-controls="${id}-back">See the full details${ICON.turn}</button>` +
    "</div></article>";

  const back =
    `<article class="ev-face ev-back" id="${id}-back" aria-labelledby="${id}-back-title">` +
    '<div class="ev-back__head">' +
    renderIndex(ev) +
    '<div class="ev-back__titles">' +
    `<h2 class="ev-title" id="${id}-back-title" tabindex="-1">${escapeHtml(ev.name)}</h2>` +
    `<p class="ev-host">${escapeHtml(ev.subtitle || hostLine(ev))}</p>` +
    "</div>" +
    `<button class="ev-turn ev-turn--icon" type="button" aria-label="Turn back to the front">${ICON.turn}</button>` +
    "</div>" +
    '<ul class="ev-facts">' +
    fact(
      ICON.clock,
      "When",
      `<strong><time datetime="${escapeHtml(datetime)}">${p.dayName} ${p.day} ${p.month} ${p.year}</time></strong>${time ? `, ${escapeHtml(time)}` : ""}`,
    ) +
    (placeLong ? fact(ICON.pin, "Where", escapeHtml(placeLong)) : "") +
    (costLong ? fact(ICON.ticket, "Cost", escapeHtml(costLong)) : "") +
    "</ul>" +
    (items.length
      ? `<h3 class="ev-label">${escapeHtml(ev.listHeading || "What’s on")}</h3>` +
        `<ul class="ev-list">${items.map((item) => `<li>${bolds(item)}</li>`).join("")}</ul>`
      : "") +
    (ev.note ? `<p class="ev-note">${bolds(ev.note)}</p>` : "") +
    (ev.access.length ? `<p class="ev-note"><b>Access:</b> ${escapeHtml(listPhrase(ev.access))}.</p>` : "") +
    (ev.runBy === "partner"
      ? '<div class="ev-organiser">' +
        `<p class="ev-organiser__by">${escapeHtml(ev.partnerCredit)} ` +
        (ev.partnerLogoSrc
          ? `<img src="${escapeHtml(ev.partnerLogoSrc)}" alt="${escapeHtml(ev.partnerName)}" loading="lazy" decoding="async" />`
          : `<b>${escapeHtml(ev.partnerName)}</b>`) +
        "</p>" +
        (ev.partnerLine ? `<p>${bolds(ev.partnerLine)}</p>` : "") +
        "</div>"
      : "") +
    renderBooking(ev) +
    "</article>";

  return `<li class="ev-card" id="${id}"><div class="ev-card__inner">${front}${back}</div></li>`;
}

/** The face down card that always ends the deck: more on the way, and an invitation on its back. */
export function renderMoreCard(idPrefix = ""): string {
  const id = escapeHtml(`${idPrefix}more-events`);
  return (
    `<li class="ev-card ev-card--more" id="${id}"><div class="ev-card__inner">` +
    `<article class="ev-face ev-front" aria-labelledby="${id}-title"><div class="ev-cardback"><div class="ev-cardback__plate">` +
    '<img class="ev-cardback__elf" src="/assets/img/nbcc-elf.png" alt="" width="560" height="560" loading="lazy" decoding="async" />' +
    `<h2 id="${id}-title">More dates on the way</h2>` +
    "<p>Follow us on Facebook and you’ll hear about them first.</p>" +
    `<button class="ev-turn" type="button" aria-controls="${id}-back">Planning your own?${ICON.turn}</button>` +
    "</div></div></article>" +
    `<article class="ev-face ev-back ev-back--invite" id="${id}-back" aria-labelledby="${id}-back-title">` +
    `<button class="ev-turn ev-turn--icon ev-turn--corner" type="button" aria-label="Turn back to the front">${ICON.turn}</button>` +
    '<div class="ev-invite">' +
    `<h2 class="ev-title" id="${id}-back-title" tabindex="-1">Planning something for NBCC?</h2>` +
    '<div class="rule center"><i></i></div>' +
    "<p class=\"ev-note\">A coffee morning, a quiz night, a sponsored walk with your work. Whatever you have in mind, tell us about it and we’ll help where we can.</p>" +
    '<a class="btn btn-primary ev-book" href="/contact">Tell us about it</a>' +
    '<a class="ev-link" href="https://www.facebook.com/nbcc.scot" target="_blank" rel="noopener">Follow NBCC on Facebook<span class="sr-only">, opens in a new tab</span></a>' +
    "</div></article></div></li>"
  );
}

/** Every card in the order given, then the face down card. With no events it is the whole deck. */
export function renderDeck(events: EventRecord[], idPrefix = ""): string {
  return events.map((ev) => renderCard(ev, idPrefix)).join("") + renderMoreCard(idPrefix);
}

/**
 * The page: the template with the deck where its marker is. A function replacement, because a
 * string one would treat "$&" typed into an event as a pattern. A template with no marker comes
 * back untouched rather than with the deck bolted on somewhere.
 */
export function renderEventsPage(template: string, events: EventRecord[]): string {
  if (!template.includes(DECK_MARKER)) return template;
  return template.replace(DECK_MARKER, () => renderDeck(events));
}

/**
 * A small whole document for the admin's preview frames: the site's own stylesheets and card script
 * around a deck, so the preview is the real thing rather than an imitation. Links open in a new tab
 * so following one never swaps the preview for another page, and the deal-in is off because the
 * preview redraws as staff type.
 */
export function renderPreviewDocument(cardsHtml: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<base target="_blank" />' +
    '<link rel="stylesheet" href="/assets/css/styles.css" />' +
    '<link rel="stylesheet" href="/assets/css/events.css" />' +
    "<style>html,body{background:transparent}body{margin:0;padding:18px 18px 30px}</style>" +
    "</head><body>" +
    `<div class="events-deck"><ol class="deck" role="list" data-deck data-no-deal>${cardsHtml}</ol></div>` +
    '<script src="/assets/js/events.js"></script>' +
    "</body></html>"
  );
}
