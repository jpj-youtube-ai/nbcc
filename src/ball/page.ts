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
export const TICKET_INCLUDES =
  "Entry to the ball, a three-course meal, a drink on arrival, and entertainment " +
  "through the evening. Further drinks are not included.";

export interface BallPageInput {
  settings: BallPageSettings;
  gateOpen: boolean;
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
  // "Further drinks are not included" is doing real work. A drink on arrival reads to plenty of
  // people as "drinks are provided", and the difference is discovered at the bar on the night
  // — which is both an unhappy guest and, in an advert for a £100 ticket, a claim we could not
  // stand behind. Better said plainly here than argued about in November.
  if (settings.includedNote) {
    html = fillRegion(html, "included", TICKET_INCLUDES + " " + escapeHtml(settings.includedNote));
  }

  if (settings.lineUpNote) {
    html = fillRegion(html, "lineup", escapeHtml(settings.lineUpNote));
  }

  return html;
}
