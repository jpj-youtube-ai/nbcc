// TASK-562: removing an address from the Email audit's red band (Admin > Email audit). The rules
// that need no database live here.

// "stop": the address's problems leave the band and the address is blocked. "tidy": they leave the
// band and nothing else changes.
export type AuditRemovalKind = "stop" | "tidy";

const CHARITY_DOMAIN = "nbcc.scot";

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
