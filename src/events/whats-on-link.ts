// What's on in the main menu, straight after Get involved, while an admin has the events switch on.
// Off, /whats-on is a 404 and no menu mentions it.
//
// A helper of its own, and not a part of addEventsNavLink, because decorateBallPage calls that one
// and Ball pages keep their old menu until after the Ball. So this runs only from src/routes/site.ts,
// where the other pages are decorated. It needs the Get involved item to find its place, so a page
// with no such item (a Ball page, a page with no menu) comes back exactly as it was.
//
// The anchor is the nav LIST, never a link on its own: see src/events/nav-link.ts.

export const WHATS_ON_NAV_ITEM = '<li><a href="/whats-on">What\'s on</a></li>';

const NAV_LIST = 'class="nav-links"';
const GET_INVOLVED = 'href="/get-involved"';

// What's on is one more item than the menu was drawn for. Between the burger (680px) and about 1040px
// the words would wrap onto two lines, and with the Festive Ball's item up as well Donate went off the
// edge of the screen. This tightens the menu at those widths. It goes out with the item, and not in
// styles.css, for two reasons: donate.html has 147 bytes of its page weight budget left, and Ball
// pages keep their old menu exactly as it is. It can move to styles.css in the weight review.
export const MENU_FIT =
  "<style>@media(min-width:681px) and (max-width:1040px){.nav .wrap{gap:10px}.brand{flex:none}.nav-links{gap:0}" +
  ".nav-links a{padding:9px 8px;font-size:.84rem}.nav-cta{padding:10px 14px;font-size:.84rem;white-space:nowrap}}</style>";

/** Add MENU_FIT to the head of a page whose menu has What's on. Safe to run twice. */
export function addMenuFit(html: string): string {
  if (!html.includes('href="/whats-on"') || html.includes(MENU_FIT)) return html;
  const listStart = html.indexOf(NAV_LIST);
  const listEnd = listStart === -1 ? -1 : html.indexOf("</ul>", listStart);
  if (listEnd === -1 || !html.slice(listStart, listEnd).includes('href="/whats-on"')) return html;
  const headEnd = html.indexOf("</head>");
  if (headEnd === -1) return html;
  return `${html.slice(0, headEnd)}${MENU_FIT}${html.slice(headEnd)}`;
}

/** Add the item after Get involved in the main nav. Safe to run over any page, and to run twice. */
export function addWhatsOnNavLink(html: string): string {
  const listStart = html.indexOf(NAV_LIST);
  if (listStart === -1) return html;
  const listEnd = html.indexOf("</ul>", listStart);
  if (listEnd === -1) return html;

  const list = html.slice(listStart, listEnd);
  if (list.includes('href="/whats-on"')) return html;

  const itemAt = list.indexOf(GET_INVOLVED);
  const itemEnd = itemAt === -1 ? -1 : list.indexOf("</li>", itemAt);
  if (itemEnd === -1) return html;

  // On a line of its own, indented like Get involved's, ending the way the file's own lines do.
  const insertAt = listStart + itemEnd + "</li>".length;
  const lineStart = html.lastIndexOf("\n", listStart + itemAt) + 1;
  const indent = html.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
  const newline = html.startsWith("\r\n", insertAt) ? "\r\n" : "\n";
  return `${html.slice(0, insertAt)}${newline}${indent}${WHATS_ON_NAV_ITEM}${html.slice(insertAt)}`;
}
