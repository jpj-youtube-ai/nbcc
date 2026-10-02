import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// TASK-501: signing in to the fundraising private area (/fundraise/manage) with an emailed code.
// Pure apart from the random bytes: the clock and the secret are passed in, so every rule is unit
// tested (test/unit/fundraising-sign-in.test.ts). The SQL is in src/db/fundraiser-sign-in.ts and
// the routes in src/routes/fundraise.ts.
//
// The approach is the admin's email code (src/admin/two-factor.ts), with its own domain prefix so
// a hash made here can never stand for anything made there under the same secret:
//
//   - a 6 digit code, from the crypto random source, emailed to the organiser;
//   - stored only as a keyed hash (HMAC-SHA256 under ADMIN_SESSION_SECRET), bound to the email it
//     was sent to, so a copy of the table cannot be tried offline without the secret;
//   - it works for 10 minutes and allows 5 tries; every try counts (the right one too), counted
//     in the database BEFORE the code is compared, so tries sent at once cannot share a count;
//   - a right code starts a session: a fresh 32 byte random id (never one the browser offers, so
//     nobody can fix a session on someone else) in an http only, SameSite Lax cookie, Secure in
//     production, scoped to the private area's API. Only the sha256 of the id is stored. It lasts
//     two hours and is scoped to the email, so the organiser sees every fundraiser of theirs.
//
// Codes and session ids are never logged.

export const SIGN_IN_CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
export const SESSION_COOKIE = "nbcc_fr_session";
export const SESSION_COOKIE_PATH = "/api/fundraise/manage";

const CODE_DOMAIN = "fundraisecode.v1:";

/** A cryptographically random 6 digit code, zero padded, e.g. "004821". */
export function newSignInCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** The code from what was typed: "482 915" and "482-915" are "482915"; anything else is null. */
export function readCode(typed: unknown): string | null {
  if (typeof typed !== "string" || typed.length > 20) return null;
  const digits = typed.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** "482915" -> "482 915", for the subject line. */
export function spacedCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

const normEmail = (email: string) => email.trim().toLowerCase();

/** The keyed hash stored in place of the code, bound to the email it was sent to. */
export function hashSignInCode(email: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${CODE_DOMAIN}${normEmail(email)}:${code}`).digest("base64url");
}

/** Constant time: does this code, for this email, hash to the stored hash? */
export function signInCodeMatches(email: string, code: string, storedHash: string, secret: string): boolean {
  const a = Buffer.from(hashSignInCode(email, code, secret));
  const b = Buffer.from(storedHash ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type CodeVerdict = "ok" | "wrong" | "none" | "expired" | "dead";

/**
 * One try at a code. `row` is the stored code as it is AFTER this try was counted (attempts
 * includes it), or null when there is none. The route answers every refusal the same way.
 */
export function codeVerdict(
  row: { codeHash: string; expiresAt: Date; attempts: number } | null,
  email: string,
  code: string,
  secret: string,
  now: Date,
): CodeVerdict {
  if (!row) return "none";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.attempts > MAX_CODE_ATTEMPTS) return "dead";
  return signInCodeMatches(email, code, row.codeHash, secret) ? "ok" : "wrong";
}

/** 32 random bytes, base64url: the id in the session cookie. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export function sessionCookieOptions(production: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  // Secure in production only, so local http development still works (as the ball's cookie).
  return { httpOnly: true, secure: production, sameSite: "lax", path: SESSION_COOKIE_PATH, maxAge: SESSION_TTL_MS };
}

const OWN_HOSTS = ["nbcc.scot", "www.nbcc.scot"];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Was this change sent by one of our own pages? The cookie is SameSite Lax, so another website's
 * page cannot send it with a POST; this is the second lock. A browser that says where it came from
 * (Sec-Fetch-Site) must say same-origin; one that only sends Origin must name one of our own
 * hosts. Something that sends neither is not a browser (every browser sends at least one with a
 * POST), so there is no visitor to trick and it is let through to the session check.
 */
export function sentFromOurOwnPage(headers: { secFetchSite?: string; origin?: string }, host: string): boolean {
  if (headers.secFetchSite) return headers.secFetchSite === "same-origin";
  if (headers.origin === undefined) return true;
  const from = hostOf(headers.origin);
  if (!from) return false;
  return [...OWN_HOSTS, host.toLowerCase()].includes(from);
}
