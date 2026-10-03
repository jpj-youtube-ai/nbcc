import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// TASK-503: inviting someone to fundraise, from Admin > Fundraising. Pure apart from the random
// bytes, so every rule is unit tested (test/unit/fundraising-invite.test.ts). The SQL is in
// src/db/fundraising-team.ts and the routes in src/routes/admin-fundraising-team.ts (staff) and
// src/routes/fundraise-invite.ts (the sign up form).
//
//   - the email's button opens /fundraise?invite=<token>, a fresh 32 byte random token;
//   - only the sha256 of the token is kept (with its own domain prefix), so a copy of the table opens
//     nothing, and the token is never logged or shown to anyone but the person it was emailed to;
//   - it works for 60 days from when it was last sent (Resend makes a new token and starts again);
//   - it works once: when the sign up made from it arrives, the invite is marked used and linked;
//   - it fills in the name and the email on the form, and nothing else.

export const INVITE_TTL_DAYS = 60;
// Jaimie 2026-10-03: a personal note can be a proper letter (was 600).
export const INVITE_NOTE_MAX = 5000;
/** Invites (and resends) one member of staff may send in a day. */
export const INVITES_PER_DAY = 50;
/** An invite not taken up this many days after it was sent shows on the Monday summary. */
export const INVITE_NOT_TAKEN_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_DOMAIN = "fundraiseinvite.v1:";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, base64url: the token in the invite link. */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What is stored in place of the token. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(TOKEN_DOMAIN + token).digest("hex");
}

/** The token from what the page sent, or null when it is not one. */
export function readInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return TOKEN_SHAPE.test(t) ? t : null;
}

export function inviteUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/fundraise?invite=${encodeURIComponent(token)}`;
}

/** When the token in use was sent: the last resend, or the invite itself. */
export function inviteIssuedAt(row: { createdAt: Date; resentAt: Date | null }): Date {
  return row.resentAt ?? row.createdAt;
}

export type InviteVerdict = "ok" | "none" | "used" | "expired";

export function inviteVerdict(
  row: { createdAt: Date; resentAt: Date | null; usedAt: Date | null } | null,
  now: Date,
): InviteVerdict {
  if (!row) return "none";
  if (row.usedAt) return "used";
  if (inviteIssuedAt(row).getTime() + INVITE_TTL_DAYS * DAY_MS <= now.getTime()) return "expired";
  return "ok";
}

/** What the form is filled in with: the name and the email, never the note or who sent it. */
export function invitePrefill(row: { name: string; email: string }): { name: string; email: string } {
  return { name: row.name, email: row.email };
}

export const inviteSchema = z
  .object({
    name: z.string().trim().min(1, "Add their name.").max(100, "Keep the name to 100 characters or fewer."),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254, "That email is too long.")
      .email("That isn't a whole email address."),
    note: z
      .string()
      .trim()
      .max(INVITE_NOTE_MAX, `Keep the note to ${INVITE_NOTE_MAX.toLocaleString("en-GB")} characters or fewer.`)
      .nullish()
      .transform((v) => (v ? v : null)),
    signedBy: z.number({ invalid_type_error: "Choose who it is from." }).int().positive("Choose who it is from."),
  })
  .strict();

export type InviteInput = z.infer<typeof inviteSchema>;

const capital = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

/** The first name an invite is signed with: the first word of their name, or of their email. */
export function staffFirstName(fullName: string | null | undefined, email: string): string {
  const fromName = String(fullName ?? "").trim().split(/\s+/)[0];
  if (fromName) return capital(fromName);
  const local = String(email).split("@")[0].split(/[._+-]/)[0];
  return capital(local);
}
