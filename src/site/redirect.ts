// TASK-492: a spare address (src/db/site-pages.ts) or an old address (_redirects) sends its visitor
// on WITH the query string they arrived with, so the tags saying where a visit came from survive the
// hop: a QR code's utm_medium=qr, a newsletter's utm_source. Without this a QR code made for a spare
// address counted its scans as Direct. The target is always one of our own paths, so the query can
// never change where the visitor goes. Pure, so it is tested without a server.
// TASK-568: or one of NBCC's own subdomains, chosen by staff (forwardTarget in ./pages); the query is
// only ever added after that address, so it still cannot change where the visitor goes.

/** `target`, with the query string from `originalUrl` (req.originalUrl) carried across. */
export function keepQuery(target: string, originalUrl: string): string {
  const at = originalUrl.indexOf("?");
  if (at === -1) return target;
  const query = originalUrl.slice(at + 1).split("#")[0];
  if (!query) return target;
  return target + (target.includes("?") ? "&" : "?") + query;
}

/**
 * TASK-568: the kind of forward a spare address gives. A subdomain is one staff can change or
 * remove, so it is temporary (302): a browser keeps a permanent one (301) for good, and a visitor
 * who had used it would go on reaching the old place. One of our own pages keeps the 301 it always
 * had, so the spare address never becomes a second home for the same content.
 */
export function forwardStatus(target: string): 301 | 302 {
  return target.startsWith("https://") ? 302 : 301;
}
