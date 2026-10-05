// TASK-562: removing an address from the Email audit's red band (Admin > Email audit). The rules
// that need no database live here.

// "stop": the address's problems leave the band and the address is blocked. "tidy": they leave the
// band and nothing else changes.
export type AuditRemovalKind = "stop" | "tidy";

const CHARITY_DOMAIN = "nbcc.scot";

/**
 * Could this be an email address? Only something that could be can be blocked. Deliberately the
 * same loose shape addresses are let into the site by (the donation form, the newsletter
 * spreadsheet, a sponsor's pledge), so that anything the log holds as an address passes: one
 * with a trailing full stop or two dots in it is refused by the provider every time, gets no
 * bounce to block it by itself, and is exactly what staff need to remove. What does not pass is
 * a row that no longer has an address: a cleared team invite reads "deleted team invitee".
 */
export function looksLikeAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * One of the charity's own addresses (nbcc.scot or a subdomain of it). Its problems can be tidied
 * away, but it is never blocked: that would stop the charity's own notes to itself (a fundraiser
 * has signed up, a pledge needs approving), which go to events@ and the like.
 */
export function isCharityAddress(email: string): boolean {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 1) return false;
  const domain = address.slice(at + 1);
  return domain === CHARITY_DOMAIN || domain.endsWith("." + CHARITY_DOMAIN);
}
