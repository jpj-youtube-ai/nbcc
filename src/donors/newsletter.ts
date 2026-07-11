// Pure newsletter HTML assembly (TASK-161/REQ-069). Takes the staff-authored body HTML and the
// recipient's unsubscribe URL and returns the full email HTML with a required unsubscribe footer
// (PECR/UK GDPR: every marketing email must offer an unsubscribe). No I/O — unit-tested directly.
export function buildNewsletterHtml(bodyHtml: string, unsubscribeUrl: string): string {
  const footer =
    `<hr>\n<p style="font-size:12px;color:#666">` +
    `You're receiving this because you opted in to updates when you donated to the ` +
    `Night Before Christmas Campaign. <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>`;
  return `${bodyHtml}\n${footer}`;
}
