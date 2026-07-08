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

export function verifyUnsubscribeToken(token: string, secret: string): number {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new UnsubscribeTokenError("malformed");
  const [body, sig] = parts;

  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnsubscribeTokenError("bad_signature");

  const donorId = Number(body);
  if (!Number.isInteger(donorId) || donorId <= 0) throw new UnsubscribeTokenError("malformed");
  return donorId;
}
