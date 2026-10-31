import { redBagIsLive } from "./switch";

// The links to Fill a Red Bag that appear at the Ball's moment (src/site/after-ball.ts), added as a
// page goes out, the way the footer's fundraising link is (src/fundraising/footer-link.ts). They are
// not in the page files: partials/footer.html is copied to every page, Ball pages included, and Ball
// pages keep their old footer. So these never run over a Ball page (src/ball/page-decor.ts), and while
// Fill a Red Bag is switched off (src/red-bag/switch.ts) /fill is a 404, so they add nothing.

export const FILL_FOOTER_ITEM = '<li><a href="/fill">Fill a Red Bag</a></li>';

const WAYS_TO_GIVE = "<h4>Ways to give</h4>";

// Each on one line of the file, so this finds them whichever line endings a checkout has.
const DROP_OFF_WORDS = "<p>You can still make a donation.</p>";
const DROP_OFF_BUTTON = '<div class="row"><a class="btn paper" href="/donate">Donate</a></div>';

/**
 * The footer's "Ways to give", with Fill a Red Bag straight after its first link. Only inside the
 * footer; safe to run twice; no footer, or no such list, no change.
 */
export function addFillFooterLink(html: string): string {
  if (!redBagIsLive()) return html;
  const start = html.indexOf("<footer");
  const end = start === -1 ? -1 : html.indexOf("</footer>", start);
  if (end === -1) return html;
  const footer = html.slice(start, end);
  if (footer.includes(FILL_FOOTER_ITEM)) return html;
  const heading = footer.indexOf(WAYS_TO_GIVE);
  const firstItem = heading === -1 ? -1 : footer.indexOf("</li>", heading);
  if (firstItem === -1) return html;
  const at = firstItem + "</li>".length;
  // Match the indentation of the line it follows, so the markup stays readable.
  const lineStart = footer.lastIndexOf("\n", at);
  const indent = footer.slice(lineStart + 1).match(/^[ \t]*/)?.[0] ?? "";
  return html.slice(0, start) + footer.slice(0, at) + "\n" + indent + FILL_FOOTER_ITEM + footer.slice(at) + html.slice(end);
}

/** "Can't get to a drop-off point?" on the Drop-off points page, offering Fill a Red Bag as well. */
export function addFillToDropOff(html: string): string {
  if (!redBagIsLive()) return html;
  return html
    .replace(DROP_OFF_WORDS, () => "<p>You can still fill a Red Bag online, or make a donation.</p>")
    .replace(DROP_OFF_BUTTON, () => '<div class="row"><a class="btn paper" href="/fill">Fill a Red Bag</a><a class="btn on-dark" href="/donate">Donate</a></div>');
}
