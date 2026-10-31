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
