// TASK-453: the "Events" item in the main menu, added to every page while an admin has the Events
// page switched on. Switched off, pages are served exactly as they are on disk.
//
// It goes straight after About, so the menu reads Home, About, Events, Donate... The anchor is the
// nav LIST, never a link on its own: the Festive Ball item (src/ball/nav-link.ts) found out that
// the first `href="/about-us"` in a file can be the FOOTER's, because the nav's own copy carries
// class="active" on the About page and a plain match skips it.

export const EVENTS_NAV_ITEM = '<li><a href="/events">Events</a></li>';

const NAV_LIST = 'class="nav-links"';
const ABOUT = 'href="/about-us"';

/**
 * Add the item after About in the main nav. Returns the page UNCHANGED when there is no nav
 * (hub.html, set-password.html) or when the nav already offers /events (events.html itself), so
 * it is safe to run over any page and safe to run twice. With no About item it goes last.
 */
export function addEventsNavLink(html: string): string {
  const listStart = html.indexOf(NAV_LIST);
  if (listStart === -1) return html;
  const listEnd = html.indexOf("</ul>", listStart);
  if (listEnd === -1) return html;

  const list = html.slice(listStart, listEnd);
  if (list.includes('href="/events"')) return html;

  const aboutAt = list.indexOf(ABOUT);
  const aboutItemEnd = aboutAt === -1 ? -1 : list.indexOf("</li>", aboutAt);
  if (aboutItemEnd === -1) {
    // No About item: last in the list, indented like the closing tag's line.
    const lineStart = html.lastIndexOf("\n", listEnd);
    const indent = html.slice(lineStart + 1, listEnd).match(/^[ \t]*/)?.[0] ?? "";
    return `${html.slice(0, listEnd)}${EVENTS_NAV_ITEM}\n${indent}${html.slice(listEnd)}`;
  }

  // Straight after About's </li>, on a line of its own indented like About's, ending the way the
  // file's own lines do (a Windows checkout has CRLF; the container's copy has LF).
  const insertAt = listStart + aboutItemEnd + "</li>".length;
  const aboutLineStart = html.lastIndexOf("\n", listStart + aboutAt) + 1;
  const indent = html.slice(aboutLineStart).match(/^[ \t]*/)?.[0] ?? "";
  const newline = html.startsWith("\r\n", insertAt) ? "\r\n" : "\n";
  return `${html.slice(0, insertAt)}${newline}${indent}${EVENTS_NAV_ITEM}${html.slice(insertAt)}`;
}
