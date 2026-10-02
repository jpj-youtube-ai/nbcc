// TASK-494: the footer's "Fundraise for us" link. Every page's footer (in its file) sends it to the
// contact page; while fundraising is switched on the server points it at the sign up instead, the
// way the menu items are added (src/events/nav-link.ts). Switched off, pages go out as they are.

const FROM = '<a href="/contact">Fundraise for us</a>';
const TO = '<a href="/fundraise">Fundraise for us</a>';

/** The footer's link to the sign up. Only inside the footer; safe to run twice; no footer, no change. */
export function addFundraiseFooterLink(html: string): string {
  const start = html.indexOf("<footer");
  if (start === -1) return html;
  const end = html.indexOf("</footer>", start);
  if (end === -1) return html;
  const footer = html.slice(start, end);
  if (!footer.includes(FROM)) return html;
  return html.slice(0, start) + footer.split(FROM).join(TO) + html.slice(end);
}
