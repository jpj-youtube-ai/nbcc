// The pure, DB-free portal magic-link token logic (REQ-061). The self-serve donor portal is entered
// via a one-time, expiring token emailed to the donor. This module owns ONLY the token rules —
// building the record to persist, verifying expiry + one-time use, and building the link URL. NO
// pool/config and no ambient clock (the timestamp is INJECTED), so it is unit-tested DB-free like
// src/declarations/status.ts and src/webhooks/idempotency.ts. The audited issue/consume writes live
// in src/db/portal.ts; the send lives in src/clients/email.ts.

// The default lifetime of a magic link. Kept short — a passwordless link is a bearer credential.
export const PORTAL_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// The persisted token row this module reasons about (matching portal_access_tokens columns).
export interface PortalTokenRecord {
  token: string;
  donor_id: number;
  expires_at: Date;
  used_at: Date | null;
}

// Why a token cannot be verified: it matched no row, it has expired, or it was already consumed
// (one-time use). A typed error like DeclarationRevisionError so a caller/route can branch on it.
export class PortalTokenError extends Error {
  constructor(public readonly reason: "not_found" | "expired" | "already_used") {
    super(`portal token cannot be used: ${reason}`);
    this.name = "PortalTokenError";
  }
}

// Build the token record to persist: the donor it grants, and its expiry = now + ttl. Pure — the
// caller supplies the (random) token string, the clock (`now`) and the ttl.
export function issuePortalToken(input: {
  token: string;
  donorId: number;
  now: Date;
  ttlMs?: number;
}): { token: string; donor_id: number; expires_at: Date } {
  const ttl = input.ttlMs ?? PORTAL_TOKEN_TTL_MS;
  return {
    token: input.token,
    donor_id: input.donorId,
    expires_at: new Date(input.now.getTime() + ttl),
  };
}

// Verify a fetched token row at time `now`: throws PortalTokenError for a missing row, an
// already-consumed one (used_at set — the one-time-use guard), or an expired one; otherwise returns
// the donor id it grants. The persistence layer marks used_at AFTER a successful verify, so a
// replay finds used_at set and this throws 'already_used'.
export function verifyPortalToken(
  record: PortalTokenRecord | null | undefined,
  now: Date,
): { donorId: number } {
  if (!record) throw new PortalTokenError("not_found");
  if (record.used_at != null) throw new PortalTokenError("already_used");
  if (record.expires_at.getTime() <= now.getTime()) throw new PortalTokenError("expired");
  return { donorId: record.donor_id };
}

// Build the magic-link URL from the portal base + the token. Pure — trailing slashes on the base are
// trimmed so the path never doubles up (mirrors declarationLinks in src/db/stripe-webhook-model.ts).
export function portalMagicLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/portal/access?token=${encodeURIComponent(token)}`;
}
