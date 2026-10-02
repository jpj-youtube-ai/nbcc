import { createHash, randomBytes } from "node:crypto";

// TASK-493: the emailed link an organiser uses to change their fundraiser, the donor portal's
// pattern (src/portal/tokens.ts) with two differences the design asks for: it lasts 24 hours, and
// only the sha256 of the token is stored, so a copy of the table opens nothing. Pure apart from the
// random bytes: the clock is passed in. The writes are in src/db/fundraisers.ts.
//
// A link can be used more than once in its 24 hours (open the page, save, come back and look); each
// save replaces any change of theirs still waiting for staff, so nothing piles up.

export const MANAGE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export class ManageTokenError extends Error {
  constructor(public readonly reason: "not_found" | "expired") {
    super(`manage link cannot be used: ${reason}`);
    this.name = "ManageTokenError";
  }
}

/** 32 random bytes, base64url: 43 characters, safe in a URL as it is. */
export function newManageToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashManageToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueManageToken(input: { token: string; fundraiserId: number; now: Date; ttlMs?: number }): {
  tokenHash: string;
  fundraiserId: number;
  expiresAt: Date;
} {
  return {
    tokenHash: hashManageToken(input.token),
    fundraiserId: input.fundraiserId,
    expiresAt: new Date(input.now.getTime() + (input.ttlMs ?? MANAGE_TOKEN_TTL_MS)),
  };
}

export function verifyManageToken(
  row: { fundraiserId: number; expiresAt: Date } | null | undefined,
  now: Date,
): { fundraiserId: number } {
  if (!row) throw new ManageTokenError("not_found");
  if (row.expiresAt.getTime() <= now.getTime()) throw new ManageTokenError("expired");
  return { fundraiserId: row.fundraiserId };
}

/** The page reads ?token= and calls GET /api/fundraise/manage/:token. */
export function manageLink(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/fundraise/manage?token=${encodeURIComponent(token)}`;
}
