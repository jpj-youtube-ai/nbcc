import { createHash, randomBytes } from "node:crypto";

// NBCC Elf Detective School: the two cookies (wave 1 plan, Tasks 4 and 6).
//
//   nbcc_elf_pending  set on the browser that starts a payment: a random token whose sha256 is kept
//                     on the order. When Stripe sends that browser back, /elf/welcome may turn it
//                     into a session, but only when the payment opened the family's account.
//   nbcc_elf_session  a signed in family: a random id whose sha256 is kept in elf_sessions.
//
// Both are httpOnly, SameSite lax, and Secure in production (so local http development works).
// Neither holds anything but a random value, so a copied table opens nothing.

export const ELF_PENDING_COOKIE = "nbcc_elf_pending";
export const ELF_SESSION_COOKIE = "nbcc_elf_session";
export const ELF_SESSION_DAYS = 30;
const PENDING_MS = 60 * 60_000;

type CookieOptions = { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number };

export function elfPendingCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: PENDING_MS };
}

export function elfSessionCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: ELF_SESSION_DAYS * 24 * 60 * 60_000 };
}

/** A new random token for a cookie, as hex. */
export function newElfToken(): string {
  return randomBytes(32).toString("hex");
}

/** What is kept of a cookie's token: its sha256, as hex. */
export function hashElfToken(token: string): string {
  return createHash("sha256").update(`elf:${token}`).digest("hex");
}

// --- the private preview link (Jaimie, 3 November 2026) ---------------------------------------------
// /elf/preview/<code> puts the code in this cookie; while the school is switched off, a browser
// holding the code whose sha256 matches elf_settings.preview_hash sees it anyway.

export const ELF_PREVIEW_COOKIE = "nbcc_elf_preview";

export function elfPreviewCookieOptions(production: boolean): CookieOptions {
  return { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: 14 * 24 * 60 * 60_000 };
}

/** May this browser see the school while it is switched off? */
export function previewAllowed(settings: { previewHash?: string | null }, token: string | null | undefined): boolean {
  if (!settings.previewHash || !token || !/^[0-9a-f]{64}$/.test(token)) return false;
  return hashElfToken(token) === settings.previewHash;
}
