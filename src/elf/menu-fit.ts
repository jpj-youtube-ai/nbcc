import { MENU_FIT } from "../events/menu-fit";

// TASK-613: the main menu with Elf Detective School in it (src/elf/nav-link.ts), the longest label the
// menu has carried. Measured in a browser on contact.html's menu (Home, About, Get involved, Elf
// Detective School, Contact, Supporters and the Donate button): the tablet fit (MENU_FIT,
// src/events/menu-fit.ts) holds it on one line from about 740px, and below that three labels broke onto
// a second line. So above the burger (680px) no label may wrap, and from the burger to 760px the menu
// tightens a little more. Then every width from 681px up is one line, with Donate in view and no
// sideways scroll; at laptop widths the full size menu fits as it is; on a phone (360px, 390px) the
// burger's list is one item to a line, unchanged. Nothing here can scroll inside a box.
//
// Like MENU_FIT, it goes out with the item, not in styles.css: donate.html's page weight budget, and
// the Festive Ball's own pages keep their menu as it is. It comes after MENU_FIT, so its narrow band
// wins, and it brings MENU_FIT along when the menu has no Get involved to bring it.

export const ELF_MENU_FIT =
  "<style>@media(min-width:681px){.nav-links a{white-space:nowrap}}" +
  "@media(min-width:681px) and (max-width:760px){.nav .wrap{gap:6px}.nav-links a{padding:9px 5px;font-size:.8rem}.nav-cta{padding:10px 11px}}</style>";

const NAV_LIST = 'class="nav-links"';
const ELF = 'href="/elf"';

/** Add the fit, and the tablet fit if the page has not got it, to the head of a page whose menu has
 *  Elf Detective School. Safe to run twice. */
export function addElfMenuFit(html: string): string {
  if (html.includes(ELF_MENU_FIT)) return html;
  const listStart = html.indexOf(NAV_LIST);
  const listEnd = listStart === -1 ? -1 : html.indexOf("</ul>", listStart);
  if (listEnd === -1 || !html.slice(listStart, listEnd).includes(ELF)) return html;
  const headEnd = html.indexOf("</head>");
  if (headEnd === -1) return html;
  const styles = html.includes(MENU_FIT) ? ELF_MENU_FIT : `${MENU_FIT}${ELF_MENU_FIT}`;
  return `${html.slice(0, headEnd)}${styles}${html.slice(headEnd)}`;
}
