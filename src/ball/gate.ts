import { createHmac, timingSafeEqual } from "node:crypto";

// TASK-313: the password gate that keeps /ball private until launch. Pure and DB-free —
// the clock and the secret are INJECTED — mirroring src/admin/session.ts, whose token shape
// this deliberately follows so there is one signing idiom in the codebase rather than two.
//
// The gate is NOT a security boundary for money: it hides an unfinished page from the public
// while staff show it to trustees and the sponsor. Anything that must actually be protected
// (admin, donor data) keeps its own real authentication.

export const GATE_COOKIE = "nbcc_ball_preview";
export const GATE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // a fortnight

export interface GateSettings {
  gateOpen: boolean;
  gateOpensAt: string | null;
}

// Two ways in, deliberately: staff flip the toggle, OR a scheduled time passes. The schedule
// is the safety net — if nobody is at a keyboard on launch morning the page still opens on
// its own. A future schedule can never re-close a gate staff have already opened.
export function isGateOpen(settings: GateSettings, now: Date): boolean {
  if (settings.gateOpen) return true;
  if (!settings.gateOpensAt) return false;
  const at = new Date(settings.gateOpensAt);
  if (Number.isNaN(at.getTime())) return false; // a bad value must not throw on a live page
  return at.getTime() <= now.getTime();
}

// Constant-time comparison so the response time cannot be used to guess the password one
// character at a time. An empty configured password never matches anything: that would turn a
// missing config value into an open door.
export function passwordMatches(configured: string, attempt: string): boolean {
  if (!configured || !attempt) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(attempt);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

// `<expiry>.<hmac>` — a self-describing, stateless pass. No DB row: this only says "someone
// typed the password recently", which needs no server-side record.
export function signGateToken(secret: string, now: Date, ttlMs: number = GATE_TTL_MS): string {
  const expires = String(now.getTime() + ttlMs);
  return `${expires}.${sign(expires, secret)}`;
}

export function verifyGateToken(token: string, secret: string, now: Date): boolean {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [expires, signature] = parts;

  const expected = sign(expires, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const at = Number(expires);
  return Number.isFinite(at) && at > now.getTime();
}

// Minimal cookie read — the app has no cookie-parser dependency and this needs exactly one
// value. Matches on the whole name so `not_nbcc_ball_preview` cannot impersonate it.
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}
