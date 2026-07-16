import { createHmac, timingSafeEqual } from "node:crypto";

// The stateless newsletter unsubscribe token (TASK-161/REQ-069). A donor's newsletter email carries
// `${PORTAL_BASE_URL}/unsubscribe/<token>`; the token is `donorId.hmacSha256(donorId)` — self-
// describing, no DB row — signed with the caller-supplied secret (config.ADMIN_SESSION_SECRET is
// reused; the key never appears in code). Pure and DB-free, mirroring src/admin/session.ts, so it is
// unit-tested without a database.

export class UnsubscribeTokenError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature") {
    super(`unsubscribe token invalid: ${reason}`);
    this.name = "UnsubscribeTokenError";
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signUnsubscribeToken(donorId: number, secret: string): string {
  const body = String(donorId);
  return `${body}.${sign(body, secret)}`;
}

// TASK-255: v2 also carries WHICH newsletter the link was printed in, so an unsubscribe can be
// attributed on the stats dashboard. The signature covers BOTH ids (the joined body), so neither can
// be swapped without invalidating the token.
export function signUnsubscribeTokenV2(donorId: number, newsletterId: number, secret: string): string {
  const body = `${donorId}.${newsletterId}`;
  return `${body}.${sign(body, secret)}`;
}

// TASK-259: audience lists mean a recipient is not always a donor — volunteers/partners/referrers are
// list_subscribers rows. Their token's first segment is "s<id>", and the prefix sits INSIDE the
// signed body, so a donor-signed "7.41" can never be replayed as subscriber "s7.41".
export function signSubscriberUnsubscribeToken(subscriberId: number, newsletterId: number, secret: string): string {
  const body = `s${subscriberId}.${newsletterId}`;
  return `${body}.${sign(body, secret)}`;
}

export interface UnsubscribeClaims {
  kind: "donor" | "subscriber";
  id: number;
  newsletterId: number | null; // null on a legacy (pre-TASK-255) donor token
}

// Accepts ALL issued shapes forever — an unsubscribe link that stops unsubscribing is a compliance
// failure, so old formats are permanent, not deprecation windows:
//   `donorId.sig`                      legacy donor (every email sent before TASK-255)
//   `donorId.newsletterId.sig`         donor v2 (TASK-255)
//   `s<subscriberId>.newsletterId.sig` list subscriber (TASK-259)
export function verifyUnsubscribeToken(token: string, secret: string): UnsubscribeClaims {
  const parts = (token ?? "").split(".");
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((p) => !p)) {
    throw new UnsubscribeTokenError("malformed");
  }
  const sig = parts[parts.length - 1];
  const body = parts.slice(0, -1).join(".");

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnsubscribeTokenError("bad_signature");

  const subscriber = parts.length === 3 && /^s\d+$/.test(parts[0]);
  const id = Number(subscriber ? parts[0].slice(1) : parts[0]);
  if (!Number.isInteger(id) || id <= 0) throw new UnsubscribeTokenError("malformed");
  if (parts.length === 2) return { kind: "donor", id, newsletterId: null };

  const newsletterId = Number(parts[1]);
  if (!Number.isInteger(newsletterId) || newsletterId <= 0) throw new UnsubscribeTokenError("malformed");
  return { kind: subscriber ? "subscriber" : "donor", id, newsletterId };
}
