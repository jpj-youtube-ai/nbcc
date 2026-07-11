import { createHmac, timingSafeEqual } from "node:crypto";

// Purpose-scoped, short-lived, stateless HMAC token for the admin invite + password-reset links
// (Phase 1). Same shape as src/admin/session.ts: base64url(claims).base64url(hmacSha256(claims)),
// signed with ADMIN_SESSION_SECRET. The `purpose` claim means an invite token can never be replayed
// as a session or a reset. `bind` is the user's password_hash at issue time; the caller re-checks it
// against the live row so a link stops working once the password has been set/changed (single-use).
//
// Security review FIX #2: session.ts signs `hmacSha256(body)` with the SAME secret — an
// otherwise byte-identical HMAC scheme separated only incidentally by claim shape. To make an
// action-token signature cryptographically incapable of ever validating as a session token (or
// vice versa), the signed input here is prefixed with a fixed domain string
// (ACTION_TOKEN_DOMAIN + body) instead of signing the bare body. session.ts is deliberately left
// unchanged — giving IT a domain too would invalidate every live admin session on deploy.

export const ADMIN_INVITE_TTL_MS = 48 * 60 * 60 * 1000;
export const ADMIN_RESET_TTL_MS = 60 * 60 * 1000;

const ACTION_TOKEN_DOMAIN = "adminaction.v1:";

export interface AdminActionClaims {
  sub: number;
  purpose: "invite" | "reset";
  bind: string;
  iat: number;
  exp: number;
}

export class AdminActionTokenError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature" | "expired") {
    super(`admin action token invalid: ${reason}`);
    this.name = "AdminActionTokenError";
  }
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function issueAdminActionToken(input: {
  sub: number;
  purpose: "invite" | "reset";
  bind: string;
  now: Date;
  ttlMs?: number;
  secret: string;
}): string {
  const iat = input.now.getTime();
  const ttl = input.ttlMs ?? (input.purpose === "invite" ? ADMIN_INVITE_TTL_MS : ADMIN_RESET_TTL_MS);
  const claims: AdminActionClaims = { sub: input.sub, purpose: input.purpose, bind: input.bind, iat, exp: iat + ttl };
  const body = b64url(JSON.stringify(claims));
  return `${body}.${signBody(ACTION_TOKEN_DOMAIN + body, input.secret)}`;
}

export function verifyAdminActionToken(
  token: string,
  secret: string,
  now: Date,
): { sub: number; purpose: "invite" | "reset"; bind: string } {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AdminActionTokenError("malformed");
  const [body, sig] = parts;
  const expected = signBody(ACTION_TOKEN_DOMAIN + body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AdminActionTokenError("bad_signature");
  let claims: AdminActionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminActionClaims;
  } catch {
    throw new AdminActionTokenError("malformed");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now.getTime()) throw new AdminActionTokenError("expired");
  return { sub: claims.sub, purpose: claims.purpose, bind: claims.bind };
}

export function adminActionLink(baseUrl: string, path: "/invite" | "/reset", token: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;
}
