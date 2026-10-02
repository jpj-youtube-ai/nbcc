// TASK-492: a spare address (src/db/site-pages.ts) or an old address (_redirects) sends its visitor
// on WITH the query string they arrived with, so the tags saying where a visit came from survive the
// hop: a QR code's utm_medium=qr, a newsletter's utm_source. Without this a QR code made for a spare
// address counted its scans as Direct. The target is always one of our own paths, so the query can
// never change where the visitor goes. Pure, so it is tested without a server.

/** `target`, with the query string from `originalUrl` (req.originalUrl) carried across. */
export function keepQuery(target: string, originalUrl: string): string {
  const at = originalUrl.indexOf("?");
  if (at === -1) return target;
  const query = originalUrl.slice(at + 1).split("#")[0];
  if (!query) return target;
  return target + (target.includes("?") ? "&" : "?") + query;
}
