import { createHmac, timingSafeEqual } from "node:crypto";

// The stateless printable-thank-you-letter token (TASK-165/REQ-069). A thank-you email carries
// `${PORTAL_BASE_URL}/thank-you/letter/<token>`; the token is `sentId.hmacSha256(sentId)` — self-
// describing, no DB row — signed with config.ADMIN_SESSION_SECRET (the key never appears in code).
// It gates the public print page so a letter (which contains a donor's name, gift and personal
// message) can't be enumerated by guessing sequential ids. Pure and DB-free, mirroring
// src/donors/unsubscribe-token.ts, so it is unit-tested without a database.

export class LetterTokenError extends Error {
  constructor(public readonly reason: "malformed" | "bad_signature") {
    super(`thank-you letter token invalid: ${reason}`);
    this.name = "LetterTokenError";
  }
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signThankYouLetterToken(sentId: number, secret: string): string {
  const body = String(sentId);
  return `${body}.${sign(body, secret)}`;
}

export function verifyThankYouLetterToken(token: string, secret: string): number {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new LetterTokenError("malformed");
  const [body, sig] = parts;

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new LetterTokenError("bad_signature");

  const sentId = Number(body);
  if (!Number.isInteger(sentId) || sentId <= 0) throw new LetterTokenError("malformed");
  return sentId;
}
