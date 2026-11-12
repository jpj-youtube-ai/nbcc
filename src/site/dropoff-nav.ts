// "Drop-off points" in the main menu (Jaimie, 12 November 2026), to /get-involved/drop-off-points,
// while the Red Bag collection is on: shown now, and taken off after Sunday 20 December 2026 (the
// drop-off points take gifts until Thursday 17 December). Every page of the main site gains it as it
// goes out (src/routes/site.ts), and those built in code too (src/site/chrome.ts). Not the Festive
// Ball's own pages (Jaimie: the Ball is over). After the date, pages go out exactly as they would
// without it.
// For next year, change DROPOFF_NAV_LAST_DAY.
//
// It goes straight after Get involved, so the menu reads Home, About, Get involved, Drop-off points,
// Elf Detective School, Donate... With no Get involved it goes after About, and with neither, last.
// It is added after Elf Detective School's item, which also goes straight after Get involved, so the
// two always land in that order. The anchor is the nav LIST, never a link on its own: the first
// matching link in a file can be the footer's (src/events/nav-link.ts says how that was found out).
//
// Pure: the time is always handed in.

export const DROPOFF_PATH = "/get-involved/drop-off-points";
export const DROPOFF_NAV_ITEM = `<li><a href="${DROPOFF_PATH}">Drop-off points</a></li>`;

/** The last UK day the item shows. */
export const DROPOFF_NAV_LAST_DAY = "2026-12-20";

const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** Does the menu carry the item at `now`? A time that makes no sense does not. */
export function dropOffNavShown(now: Date): boolean {
  if (Number.isNaN(now.getTime())) return false;
  return UK_DAY.format(now) <= DROPOFF_NAV_LAST_DAY;
}

const NAV_LIST = 'class="nav-links"';
/** The items it goes straight after, the first one the menu has. */
const AFTER = ['href="/get-involved"', 'href="/about-us"'];

/**
 * Add the item to the main menu. Returns the page UNCHANGED when there is no menu or the menu already
 * offers the drop-off points page, so it is safe to run over any page and safe to run twice.
 */
export function addDropOffNavLink(html: string): string {
  const listStart = html.indexOf(NAV_LIST);
  if (listStart === -1) return html;
  const listEnd = html.indexOf("</ul>", listStart);
  if (listEnd === -1) return html;

  const list = html.slice(listStart, listEnd);
  if (list.includes(`href="${DROPOFF_PATH}"`)) return html;

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
    return `${html.slice(0, insertAt)}${newline}${indent}${DROPOFF_NAV_ITEM}${html.slice(insertAt)}`;
  }

  // Neither: last in the list, indented like the closing tag's line.
  const lineStart = html.lastIndexOf("\n", listEnd);
  const indent = html.slice(lineStart + 1, listEnd).match(/^[ \t]*/)?.[0] ?? "";
  return `${html.slice(0, listEnd)}${DROPOFF_NAV_ITEM}\n${indent}${html.slice(listEnd)}`;
}

// The menu's fit with one more item, measured in a browser on contact.html's menu with Get involved,
// Drop-off points and Elf Detective School in it, every 10px from 681px to 900px and every 40px to
// 1320px: one line, Donate in view and nothing scrolling sideways, as the menu is today. The words step
// down only as far as each band needs (.8rem to 1180px, .78rem to 900px, .74rem to 760px, the last
// because at .78rem Donate went past the edge below 760px). Above 1180px the menu is as it always was;
// on a phone the burger's list is one item to a line, unchanged.
// Like the other fits it goes out with the item, not in styles.css (donate.html's page weight budget),
// and it comes after them, so its bands win.
export const DROPOFF_MENU_FIT =
  "<style>@media(min-width:681px){.nav-links a{white-space:nowrap}}" +
  "@media(min-width:681px) and (max-width:1180px){.nav .wrap{gap:6px}.nav-links{gap:0}.nav-links a{padding:9px 5px;font-size:.8rem}.nav-cta{padding:10px 11px;font-size:.8rem}}" +
  "@media(min-width:761px) and (max-width:900px){.nav-links a{padding:8px 4px;font-size:.78rem}.nav-cta{padding:9px 10px;font-size:.78rem}}" +
  "@media(min-width:681px) and (max-width:760px){.brand img{width:40px;height:40px}.nav-links a{padding:8px 3px;font-size:.74rem}.nav-cta{padding:9px 9px;font-size:.74rem}}</style>";

/** Add the fit to the head of a page whose menu has the item. Safe to run twice. */
export function addDropOffMenuFit(html: string): string {
  if (html.includes(DROPOFF_MENU_FIT)) return html;
  const listStart = html.indexOf(NAV_LIST);
  const listEnd = listStart === -1 ? -1 : html.indexOf("</ul>", listStart);
  if (listEnd === -1 || !html.slice(listStart, listEnd).includes(`href="${DROPOFF_PATH}"`)) return html;
  const headEnd = html.indexOf("</head>");
  if (headEnd === -1) return html;
  return `${html.slice(0, headEnd)}${DROPOFF_MENU_FIT}${html.slice(headEnd)}`;
}

/** On the drop-off points page itself, the item is marked as the page you are on. */
export function markDropOffHere(html: string): string {
  return html.replace(DROPOFF_NAV_ITEM, `<li><a href="${DROPOFF_PATH}" class="active" aria-current="page">Drop-off points</a></li>`);
}
