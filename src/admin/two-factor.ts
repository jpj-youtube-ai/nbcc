import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Phase 3 (TASK-188), Task 1: pure, DB-free crypto for mandatory email 2FA on admin login (REQ
// tracked in docs/superpowers/plans/2026-07-11-admin-phase-3-2fa.md). Two things live here:
//
// 1. Login codes: a 6-digit code is emailed to the admin and never stored in the clear — only a
//    keyed HMAC hash (so a DB leak of admin_login_codes can't be brute-forced offline without also
//    having ADMIN_SESSION_SECRET). Domain-prefixed ("admincode.v1:") so the same secret can't be
//    reused to forge anything else that happens to hash the same bytes.
// 2. Device tokens: a 30-day "remember this device" token with the identical
//    base64url(claims).base64url(hmac) shape as src/admin/session.ts, signed over a domain-prefixed
//    body ("admindevice.v1:") exactly like src/admin/tokens.ts's ACTION_TOKEN_DOMAIN pattern, so a
//    device token can never be replayed as a session token (or vice versa) even though both are
//    signed with ADMIN_SESSION_SECRET. verifyDeviceToken returns null (never throws) on any
//    failure — malformed, bad signature, or expired — since the login route only needs a yes/no.

const CODE_DOMAIN = "admincode.v1:";
const DEVICE_TOKEN_DOMAIN = "admindevice.v1:";

export const ADMIN_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AdminDeviceClaims {
  sub: number; // the user id
  purpose: "device";
  iat: number; // issued-at (ms since epoch)
  exp: number; // expiry (ms since epoch)
}

// A cryptographically random 6-digit numeric string (zero-padded), e.g. "004821". Not deterministic
// / not pure — callers must not rely on any particular value, only the shape.
export function generateLoginCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

// Keyed hash of a login code: HMAC-SHA256("admincode.v1:" + code) under `secret`, base64url. This
// is what's persisted (admin_login_codes.code_hash) instead of the code itself.
export function hashLoginCode(code: string, secret: string): string {
  return signBody(CODE_DOMAIN + code, secret);
}

// Constant-time check that `code` hashes to `hash` under `secret`. Guards the length first (
// timingSafeEqual throws on mismatched buffer lengths) so a malformed/short stored hash fails
// closed instead of throwing.
export function verifyLoginCode(code: string, hash: string, secret: string): boolean {
  const expected = hashLoginCode(code, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(hash ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

// Issue a signed "remember this device" token. Same base64url(claims).base64url(hmac) shape as
// signAdminSession, but the signed input is domain-prefixed (admindevice.v1:) so it can never
// validate as a session or an action token even under the same secret.
export function issueDeviceToken(input: { sub: number; now: Date; secret: string; ttlMs?: number }): string {
  const iat = input.now.getTime();
  const exp = iat + (input.ttlMs ?? ADMIN_DEVICE_TTL_MS);
  const claims: AdminDeviceClaims = { sub: input.sub, purpose: "device", iat, exp };
  const body = b64url(JSON.stringify(claims));
  return `${body}.${signBody(DEVICE_TOKEN_DOMAIN + body, input.secret)}`;
}

// Verify a device token at time `now`. Returns `{ sub }` on success or `null` (never throws) for
// any failure: malformed shape, bad/tampered signature (constant-time compare), or expiry.
export function verifyDeviceToken(token: string, secret: string, now: Date): { sub: number } | null {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;

  const expected = signBody(DEVICE_TOKEN_DOMAIN + body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let claims: AdminDeviceClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminDeviceClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp <= now.getTime()) return null;
  if (typeof claims.sub !== "number") return null;

  return { sub: claims.sub };
}
