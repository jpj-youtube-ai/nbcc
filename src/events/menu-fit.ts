// The main menu between the burger (680px) and about 1040px. Get involved is one more item than the
// menu was drawn for, and with the Festive Ball's item up as well Donate went off the edge of the
// screen. This tightens the menu at those widths. It goes out with the Get involved item, and not in
// styles.css, for two reasons: donate.html has 147 bytes of its page weight budget left, and Ball
// pages keep their old menu exactly as it is. It can move to styles.css in the weight review.
//
// It runs only from src/routes/site.ts, where the other pages are decorated, never on a Ball page.
// What's on is not in the menu (Jaimie, 31 October 2026): Get involved shows the same cards, and links
// to What's on when there are more than it holds. The anchor is the nav LIST: see src/events/nav-link.ts.

const NAV_LIST = 'class="nav-links"';
const GET_INVOLVED = 'href="/get-involved"';

export const MENU_FIT =
  "<style>@media(min-width:681px) and (max-width:1040px){.nav .wrap{gap:10px}.brand{flex:none}.nav-links{gap:0}" +
  ".nav-links a{padding:9px 8px;font-size:.84rem}.nav-cta{padding:10px 14px;font-size:.84rem;white-space:nowrap}}</style>";

/** Add MENU_FIT to the head of a page whose menu has Get involved. Safe to run twice. */
export function addMenuFit(html: string): string {
  if (html.includes(MENU_FIT)) return html;
  const listStart = html.indexOf(NAV_LIST);
  const listEnd = listStart === -1 ? -1 : html.indexOf("</ul>", listStart);
  if (listEnd === -1 || !html.slice(listStart, listEnd).includes(GET_INVOLVED)) return html;
  const headEnd = html.indexOf("</head>");
  if (headEnd === -1) return html;
  return `${html.slice(0, headEnd)}${MENU_FIT}${html.slice(headEnd)}`;
}
