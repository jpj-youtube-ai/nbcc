// TASK-613: the Elf Detective School item in the main menu, added to every page of the main site while
// Elf Detective School is switched on, from 10am on Friday 13 November 2026 (src/elf/links-at.ts; the
// pages ask both in src/routes/site.ts). Before then, and switched off, pages go out exactly as they
// would without it. Elf Detective School's own pages keep their own header (src/elf/pages/shell.ts), and
// Ball pages keep their old menu (src/ball/page-decor.ts).
//
// It goes straight after Get involved, so the menu reads Home, About, Get involved, Elf Detective
// School, Donate... With no Get involved (the events switch off) it goes straight after About, where
// Get involved would be, so the two land in the same order whichever is added first; with neither it
// goes last. The anchor is the nav LIST, never a link on its own: the first matching link in a file can
// be the footer's (src/events/nav-link.ts says how the Festive Ball item found that out).
//
// Its name is always in full (test/unit/elf-full-name.test.ts). Its fit, so the longest label the
// menu has carried still holds one line, is src/elf/menu-fit.ts.

export const ELF_NAV_ITEM = '<li><a href="/elf">Elf Detective School</a></li>';

const NAV_LIST = 'class="nav-links"';
/** The items it goes straight after, the first one the menu has. */
const AFTER = ['href="/get-involved"', 'href="/about-us"'];

/**
 * Add the item to the main menu. Returns the page UNCHANGED when there is no menu (hub.html,
 * set-password.html) or when the menu already offers /elf, so it is safe to run over any page and
 * safe to run twice.
 */
export function addElfNavLink(html: string): string {
  const listStart = html.indexOf(NAV_LIST);
  if (listStart === -1) return html;
  const listEnd = html.indexOf("</ul>", listStart);
  if (listEnd === -1) return html;

  const list = html.slice(listStart, listEnd);
  if (list.includes('href="/elf"')) return html;

  for (const anchor of AFTER) {
    const at = list.indexOf(anchor);
    const itemEnd = at === -1 ? -1 : list.indexOf("</li>", at);
    if (itemEnd === -1) continue;
    // Straight after that item's </li>, on a line of its own indented like it, ending the way the
    // file's own lines do (a Windows checkout has CRLF; the container's copy has LF).
    const insertAt = listStart + itemEnd + "</li>".length;
    const lineStart = html.lastIndexOf("\n", listStart + at) + 1;
    const indent = html.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "";
    const newline = html.startsWith("\r\n", insertAt) ? "\r\n" : "\n";
    return `${html.slice(0, insertAt)}${newline}${indent}${ELF_NAV_ITEM}${html.slice(insertAt)}`;
  }

  // Neither: last in the list, indented like the closing tag's line.
  const lineStart = html.lastIndexOf("\n", listEnd);
  const indent = html.slice(lineStart + 1, listEnd).match(/^[ \t]*/)?.[0] ?? "";
  return `${html.slice(0, listEnd)}${ELF_NAV_ITEM}\n${indent}${html.slice(listEnd)}`;
}
