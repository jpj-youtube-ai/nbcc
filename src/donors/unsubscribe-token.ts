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

export interface UnsubscribeClaims {
  donorId: number;
  newsletterId: number | null; // null on a legacy (pre-TASK-255) token
}

// Accepts BOTH shapes forever: `donorId.sig` (legacy — printed in every email sent before TASK-255)
// and `donorId.newsletterId.sig` (v2). An unsubscribe link that stops unsubscribing is a compliance
// failure, so the legacy path is permanent, not a deprecation window.
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

  const donorId = Number(parts[0]);
  if (!Number.isInteger(donorId) || donorId <= 0) throw new UnsubscribeTokenError("malformed");
  if (parts.length === 2) return { donorId, newsletterId: null };

  const newsletterId = Number(parts[1]);
  if (!Number.isInteger(newsletterId) || newsletterId <= 0) throw new UnsubscribeTokenError("malformed");
  return { donorId, newsletterId };
}
