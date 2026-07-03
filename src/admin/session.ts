import { createHmac, timingSafeEqual } from "node:crypto";

// The pure, DB-free admin session token (TASK-105/REQ-062). After a successful admin login, the
// endpoint issues a short-lived bearer token — the signed analogue of the donor portal's magic link
// (src/portal/tokens.ts) — that later admin routes (TASK-106) verify to authorise a request. The
// token is `base64url(claimsJson).base64url(hmacSha256(claimsJson))`: a self-describing, stateless
// session (no DB row), tamper-proof via an HMAC over the claims with ADMIN_SESSION_SECRET. NO
// pool/config and no ambient clock (the timestamp is INJECTED, `now`), so it stays deterministic and
// unit-tested DB-free. The signing key is supplied by the caller (from config.ADMIN_SESSION_SECRET).

export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export interface AdminSessionClaims {
  sub: number; // the user id
  email: string;
  role: string; // viewer | editor | admin — RBAC enforcement is TASK-106
  iat: number; // issued-at (ms since epoch)
  exp: number; // expiry (ms since epoch)
}

// Why a token cannot be verified: it did not parse, its signature did not match (tampered payload or
// wrong key), or it has expired. A typed error like PortalTokenError so a route can branch on it.
export class AdminSessionError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature" | "expired") {
    super(`admin session token invalid: ${reason}`);
    this.name = "AdminSessionError";
  }
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

// Sign a session token for a user. Pure — the caller injects the clock (`now`), the ttl and the
// secret. Returns the token and the claims it carries (so the caller can surface the expiry).
export function signAdminSession(input: {
  sub: number;
  email: string;
  role: string;
  now: Date;
  ttlMs?: number;
  secret: string;
}): { token: string; claims: AdminSessionClaims } {
  const iat = input.now.getTime();
  const exp = iat + (input.ttlMs ?? ADMIN_SESSION_TTL_MS);
  const claims: AdminSessionClaims = { sub: input.sub, email: input.email, role: input.role, iat, exp };
  const body = b64url(JSON.stringify(claims));
  const token = `${body}.${signBody(body, input.secret)}`;
  return { token, claims };
}

// Verify a token at time `now`: throws AdminSessionError for a malformed token, a signature that does
// not match `secret` (constant-time compare), or an expired one; otherwise returns its claims.
export function verifyAdminSession(token: string, secret: string, now: Date): AdminSessionClaims {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new AdminSessionError("malformed");
  const [body, sig] = parts;

  const expected = signBody(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AdminSessionError("bad_signature");

  let claims: AdminSessionClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionClaims;
  } catch {
    throw new AdminSessionError("malformed");
  }
  if (typeof claims.exp !== "number" || claims.exp <= now.getTime()) {
    throw new AdminSessionError("expired");
  }
  return claims;
}
