import type { BallSettings } from "../db/ball";

// TASK-313: server-side fill for the Festive Ball page. Pure string transform — no pool, no
// config, no clock — exactly like renderSupportersPage in src/routes/site.ts, which this
// mirrors. The static ball.html stays the template (and the fallback if the DB read fails),
// so its structure tests keep holding.
//
// Two jobs:
//   1. Flip the robots directive. The page is noindex while it is password-gated and
//      indexable the moment staff open the gate — one switch, not a second thing to remember.
//   2. Fill the details that were not confirmed when the page was written (arrival time, menu
//      detail, line-up). Staff set these in admin; until they do, the page keeps its honest
//      "to be confirmed" wording rather than inventing anything about a £100 ticket.

export type BallPageSettings = Pick<BallSettings, "arrivalTime" | "includedNote" | "lineUpNote">;

// The one copy of this sentence. ball.html carries it as the fallback shown before the venue
// confirms a menu; this constant is what the menu note gets appended to afterwards. Two hand
// copies would drift, and the page would then say different things depending on whether a note
// happened to be set. test/unit/ball-page.test.ts pins them together.
// TASK-335: the line-up, announced by The Designer Rooms on 31 August 2026.
//
// Named here rather than typed wherever it is needed. It already appears twice in ball.html (the
// hero strip and the "Who's playing" column) and now in the confirmation email too, and the way
// a third hand-typed copy goes wrong is not a spelling mistake - it is one place still saying
// three acts after a fourth is added. ball.html is a static file and cannot import this, so a
// unit test ties the page to these values instead.
export const BALL_HOST = "Michelle McManus";
export const BALL_LINE_UP = ["Clanadonia", "The MacDonald Brothers", "The Kilted DJ"];

// The sentence both the email and any future page copy should use, built once.
export const lineUpSentence = (): string =>
  `${BALL_HOST} hosts, with ${BALL_LINE_UP.slice(0, -1).join(", ")} and ${BALL_LINE_UP[BALL_LINE_UP.length - 1]}.`;

export const TICKET_INCLUDES =
  "Entry to the ball, a three-course meal, a welcome drink on arrival, and entertainment " +
  "through the evening.";

export interface BallPageInput {
  settings: BallPageSettings;
  gateOpen: boolean;
  /**
   * Ticket sales have closed (by the admin's switch or its closing time) and the Ball is not sold
   * out. The booking form gives way to the closed note and the Book tickets buttons come off
   * (Jaimie, 5 November 2026). Sold out keeps the waiting list, as ball.js shows it.
   */
  salesClosed?: boolean;
}

// The page's two Book tickets buttons, word for word, and the pieces the closed page changes.
const HERO_BOOK = '<a class="btn btn-gold" href="#tickets">Book tickets</a>';
const CLOSING_BOOK = '<a class="btn btn-primary" href="#tickets">Book tickets</a>';
const TICKETS_HEADING = '<h2 id="tickets-heading">Book your seat, or take a table for ten.</h2>';
const BOOKING_FORM = '<form class="ball-form reveal" id="ballForm" novalidate>';
const CLOSED_NOTE = 'id="ballClosed" hidden>';
const INVOICE_BOX = '<aside class="ball-invoice reveal" aria-labelledby="ball-invoice-heading">';

/** The page once ticket sales have closed: the details stay, the ways to buy come down. */
function closeSales(html: string): string {
  return html
    .replace(new RegExp(`[ \\t]*${HERO_BOOK}\\r?\\n`), "")
    .replace(new RegExp(`[ \\t]*${CLOSING_BOOK}\\r?\\n`), "")
    .replace(TICKETS_HEADING, '<h2 id="tickets-heading">Ticket sales have now closed.</h2>')
    .replace(BOOKING_FORM, '<form class="ball-form reveal" id="ballForm" novalidate hidden>')
    // Left out rather than hidden: the Ball stylesheet gives the box a display of its own.
    .replace(new RegExp(`${INVOICE_BOX}[\\s\\S]*?</aside>\\s*`), "")
    .replace(CLOSED_NOTE, 'id="ballClosed">');
}

// Staff-entered free text goes into HTML, so it is escaped here. Nothing on this page needs
// markup from the admin form, and allowing it would be a stored-XSS hole for the sake of a
// bold tag.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Swap the INNER html of the element carrying data-region="<name>", leaving its tag and every
// attribute untouched. The closing tag is matched by backreference so a nested element cannot
// end the match early.
function fillRegion(html: string, region: string, inner: string): string {
  const pattern = new RegExp(
    "(<([a-z0-9]+)[^>]*\\sdata-region=\"" + region + "\"[^>]*>)([\\s\\S]*?)(<\\/\\2>)",
    "i",
  );
  return html.replace(pattern, (_match, open: string, _tag: string, _old: string, close: string) => {
    return open + inner + close;
  });
}

export function renderBallPage(template: string, input: BallPageInput): string {
  const { settings, gateOpen } = input;
  let html = template;

  // 1. robots — a void element, so replace the whole tag rather than its inner html.
  const robots = gateOpen ? "index, follow" : "noindex, nofollow";
  html = html.replace(
    /<meta\s+name="robots"[^>]*data-region="robots"[^>]*\/?>/i,
    '<meta name="robots" content="' + robots + '" data-region="robots" />',
  );

  // 2. arrival time, in both the hero fact and the details list.
  if (settings.arrivalTime) {
    const arrival = escapeHtml(settings.arrivalTime);
    html = fillRegion(html, "arrival", arrival);
    html = fillRegion(html, "arrival-2", arrival);
  }

  // The confirmed inclusions are fixed copy; the menu detail is APPENDED once the venue
  // confirms it, never substituted for them.
  //
  // TASK-336: this used to close with "Further drinks are not included", because "a drink on
  // arrival" reads to plenty of people as "drinks are provided" and the difference gets
  // discovered at the bar on the night. NBCC's answer was better than the caveat: "a WELCOME
  // drink on arrival" already says one drink, at the start, without the page telling a buyer
  // what they are not getting. Same protection, and it stops the sentence ending on a negative
  // in an advert for a £100 ticket.
  if (settings.includedNote) {
    html = fillRegion(html, "included", TICKET_INCLUDES + " " + escapeHtml(settings.includedNote));
  }

  if (settings.lineUpNote) {
    html = fillRegion(html, "lineup", escapeHtml(settings.lineUpNote));
  }

  if (input.salesClosed) html = closeSales(html);

  return html;
}
