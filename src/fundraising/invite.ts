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
//   - it fills in the first name, surname and email on the form, and nothing else.
//
// Jaimie 2026-10-03: staff type the first name and surname in two boxes (it was one "Their name"
// box, split at its first space, so "Mary Jane Smith" became Mary / Jane Smith). Both are kept
// (first_name, last_name, migration 1791200000175) and filled in on the form exactly. The old
// `name` column is still written, as the two joined, for the admin list and the email log; an
// invite sent before the two boxes has only `name`, and falls back to the old split.

export const INVITE_TTL_DAYS = 60;
// Jaimie 2026-10-03: a personal note can be a proper letter (was 600).
export const INVITE_NOTE_MAX = 5000;
/** The most each of the first name and surname boxes takes: the sign up form's own limit. */
export const INVITE_NAME_PART_MAX = 50;
/** The most the table's `name` column takes (its check from 1791200000070). */
const INVITE_NAME_MAX = 100;
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

/** The first name, a space and the surname: what the `name` column keeps, within its 100. */
export function inviteFullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.slice(0, INVITE_NAME_MAX).trim();
}

/**
 * An invite's first name and surname: the two boxes when they were kept, or, for an invite sent
 * before there were two boxes, its one name split at the first space (the surname may be empty).
 */
export function inviteNameParts(row: { name: string; firstName?: string | null; lastName?: string | null }): {
  firstName: string;
  lastName: string;
} {
  if (row.firstName) return { firstName: row.firstName, lastName: row.lastName ?? "" };
  const words = String(row.name ?? "").trim().split(/\s+/);
  return { firstName: words[0] ?? "", lastName: words.slice(1).join(" ") };
}

/** What the form is filled in with: the first name, surname and email, never the note or who sent it. */
export function invitePrefill(row: { name: string; firstName?: string | null; lastName?: string | null; email: string }): {
  firstName: string;
  lastName: string;
  email: string;
} {
  return { ...inviteNameParts(row), email: row.email };
}

const WHOLE_EMAIL = z.string().email();

/**
 * Who is copied in on an invite (Jaimie 2026-10-03): the member of staff who sends it, from the
 * admin session, so they have a copy. Not whoever it is signed by, unless that is them. Nobody when
 * their email is missing or not one whole address, or is the person invited, so the invite always
 * goes.
 */
export function inviteCc(senderEmail: string | null | undefined, recipient: string): string | undefined {
  const cc = String(senderEmail ?? "").trim().toLowerCase();
  if (!cc || !WHOLE_EMAIL.safeParse(cc).success) return undefined;
  if (cc === String(recipient).trim().toLowerCase()) return undefined;
  return cc;
}

export const inviteSchema = z
  .object({
    firstName: z
      .string({ required_error: "Add their first name.", invalid_type_error: "Add their first name." })
      .trim()
      .min(1, "Add their first name.")
      .max(INVITE_NAME_PART_MAX, `Keep the first name to ${INVITE_NAME_PART_MAX} characters or fewer.`),
    lastName: z
      .string({ required_error: "Add their surname.", invalid_type_error: "Add their surname." })
      .trim()
      .min(1, "Add their surname.")
      .max(INVITE_NAME_PART_MAX, `Keep the surname to ${INVITE_NAME_PART_MAX} characters or fewer.`),
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
