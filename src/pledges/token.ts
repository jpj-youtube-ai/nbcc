import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Sponsor pledges: the secure link in the pay email (/pledge/pay?t=<token>, and /pledge/cancel).
// Stateless and signed, like the Festive Ball's invoice link (src/ball/invoice-token.ts):
// "<pledge id>.<hmac>", signed with config.ADMIN_SESSION_SECRET. The signature covers
// "pledge.v1:<id>:<nonce>", where the nonce is a random value kept with the pledge
// (sponsor_pledges.token_nonce): so a token made for another purpose with the same secret can never
// open a pledge, a pledge's id cannot be guessed into a link, and changing the nonce makes every link
// already sent for it useless (it is changed when a pledge is paid, cancelled or un-marked as cash).
// Rotating ADMIN_SESSION_SECRET makes every link already emailed useless too: staff then send new
// pay links from Admin > Fundraising (see the README). The caller looks the nonce up by the id the token names; nothing about
// the pledge is trusted until the signature matches.

/**
 * What a link is for. A pay link (which also opens "I can't pay this after all") is in the pay email
 * and its reminder; a confirm link is in the one email sent when someone pledges. Each is signed
 * over its own label, so a link made to confirm a pledge can never pay or cancel one.
 */
export type PledgeLinkPurpose = "pay" | "confirm";

// "pay" keeps the first label, so nothing about a pay link changed when confirming was added.
const label = (purpose: PledgeLinkPurpose) => (purpose === "confirm" ? "pledge.confirm.v1" : "pledge.v1");

const sign = (id: number, nonce: string, secret: string, purpose: PledgeLinkPurpose): string =>
  createHmac("sha256", secret).update(`${label(purpose)}:${id}:${nonce}`).digest("base64url");

export function newPledgeNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function signPledgeToken(pledgeId: number, nonce: string, secret: string, purpose: PledgeLinkPurpose = "pay"): string {
  return `${pledgeId}.${sign(pledgeId, nonce, secret, purpose)}`;
}

/** The pledge id a token names, before its signature is checked; null when it is not shaped like one. */
export function pledgeIdOfToken(token: unknown): number | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 2 || !/^[1-9]\d{0,9}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{20,100}$/.test(parts[1])) return null;
  const id = Number(parts[0]);
  return id <= 2147483647 ? id : null;
}

/** The pledge id, when the token is genuine for that pledge's nonce today; null otherwise. */
export function verifyPledgeToken(
  token: unknown,
  nonceFor: (pledgeId: number) => string | null,
  secret: string,
  purpose: PledgeLinkPurpose = "pay",
): number | null {
  const id = pledgeIdOfToken(token);
  if (id === null) return null;
  const nonce = nonceFor(id);
  if (!nonce) return null;
  const given = Buffer.from(String(token).split(".")[1]);
  const real = Buffer.from(sign(id, nonce, secret, purpose));
  return given.length === real.length && timingSafeEqual(given, real) ? id : null;
}
