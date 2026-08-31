// TASK-326: the "Festive Ball" item in the main nav, added to EVERY page at launch.
//
// It used to go into the home page only, because that is the page the printed advert's QR code
// points at. That left the nav saying different things depending on which page you were on,
// which is what staff noticed.
//
// The anchor is the nav LIST, not a link inside it. The obvious approach — find
// `<li><a href="/supporters">Supporters</a></li>` and insert after it — silently puts the item
// in the FOOTER on supporters.html, where the nav's own copy of that link carries
// `class="active" aria-current="page"` and so does not match, leaving the footer's Explore list
// as the first hit. Matching the list itself cannot pick the wrong one.

export const BALL_NAV_ITEM = '<li><a href="/ball">Festive Ball</a></li>';

const NAV_LIST = 'class="nav-links"';

// Add the item as the last entry of the main nav. Returns the page UNCHANGED when there is no
// nav (hub.html and set-password.html have none) or when it is already there, so this is safe
// to run over any page and safe to run twice.
export function addBallNavLink(html: string): string {
  const listStart = html.indexOf(NAV_LIST);
  if (listStart === -1) return html;

  const listEnd = html.indexOf("</ul>", listStart);
  if (listEnd === -1) return html;

  // Idempotent, and scoped to the nav: /ball links elsewhere on the page (the ball page's own
  // terms link, the home promo's buttons) must not make this think the job is done.
  if (html.slice(listStart, listEnd).includes('href="/ball"')) return html;

  // Match the indentation of the line the closing tag sits on, so the markup stays readable.
  const lineStart = html.lastIndexOf("\n", listEnd);
  const indent = html.slice(lineStart + 1, listEnd).match(/^[ \t]*/)?.[0] ?? "";
  return html.slice(0, listEnd) + BALL_NAV_ITEM + "\n" + indent + html.slice(listEnd);
}
