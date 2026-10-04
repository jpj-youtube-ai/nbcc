import { createHash, randomBytes } from "node:crypto";
import { londonToday } from "../events/model";
import type { FundraiserRecord } from "./model";
import { isQuietFundraiser } from "./touch-rules";

// TASK-515: "Do it again", from email 18 (a year on). Jaimie asked for its button to open the sign up
// form filled in from last year's fundraiser in one click, so the approved line "We've kept your page
// details, so it takes one click to make a new one" is true. The same shape as TASK-503's invites
// (src/fundraising/invite.ts):
//
//   - the email's button opens /fundraise?again=<token>, a fresh 32 byte random token;
//   - only its sha256 (with its own prefix, so an invite's token can never open one) is kept, in
//     fundraiser_again_tokens, so a copy of the table opens nothing;
//   - it works for 60 days, and once: the sign up made from it marks it used;
//   - it fills in only the safe details of last year's fundraiser (againPrefill), never its date,
//     its address, what it asked us for, anything staff noted, or anything about anyone who gave.
//
// A page in memory of someone never gets email 18, so a family should never hold one of these links.
// If one ever opens such a page all the same (a category changed since, a link made by hand), the
// form opens on the gentle in memory path with who it remembers, never the raising money one.
//
// The new sign up goes to staff to approve like any other. Pure apart from the random bytes, so
// every rule is unit tested (test/unit/fundraising-again.test.ts).

export const AGAIN_TTL_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_DOMAIN = "fundraiseagain.v1:";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newAgainToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAgainToken(token: string): string {
  return createHash("sha256").update(TOKEN_DOMAIN + token).digest("hex");
}

/** The token from what the page sent, or null when it is not one. */
export function readAgainToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return TOKEN_SHAPE.test(t) ? t : null;
}

export function againUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, "")}/fundraise?again=${encodeURIComponent(token)}`;
}

export function againExpiresAt(madeAt: Date): Date {
  return new Date(madeAt.getTime() + AGAIN_TTL_DAYS * DAY_MS);
}

export type AgainVerdict = "ok" | "none" | "used" | "expired";

export function againVerdict(row: { expiresAt: Date; usedAt: Date | null } | null, now: Date): AgainVerdict {
  if (!row) return "none";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";
  return "ok";
}

export interface AgainPrefill {
  /** The choice on the form: "memory" is the gentle path, sent as raising money with inMemory. */
  path: FundraiserRecord["path"] | "memory";
  kind: string;
  kindOther: string | null;
  title: string;
  description: string;
  targetPence: number | null;
  venue: string;
  town: string;
  instagram: string | null;
  facebook: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Only for a page in memory of someone: who it remembers, and their dates in the family's words. */
  memoryName?: string | null;
  memoryDates?: string | null;
}

/** A year in the name (2000 to 2099) earlier than this year becomes this year (UK). */
function thisYearIn(title: string, now: Date): string {
  const year = Number(londonToday(now).slice(0, 4));
  return title.replace(/\b(20\d\d)\b/g, (y) => (Number(y) < year ? String(year) : y));
}

/** What the form is filled in with. Built field by field, so nothing else can ever reach the page. */
export function againPrefill(
  f: Pick<FundraiserRecord, "path" | "kind" | "title" | "description" | "targetPence" | "venue" | "town" | "name" | "email" | "phone"> & {
    kindOther?: string | null;
    instagram?: string | null;
    facebook?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    inMemory?: boolean | null;
    memoryName?: string | null;
    memoryDates?: string | null;
  },
  now: Date,
): AgainPrefill {
  const words = String(f.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = f.firstName && f.firstName.trim() ? f.firstName.trim() : words[0] ?? "";
  const lastName = f.lastName && f.lastName.trim() ? f.lastName.trim() : words.slice(1).join(" ");
  const memory = isQuietFundraiser(f);
  return {
    path: memory ? "memory" : f.path,
    kind: String(f.kind),
    kindOther: f.kindOther ?? null,
    // In memory, a year in the name may be a year of their life: it is left as the family wrote it.
    title: memory ? f.title : thisYearIn(f.title, now),
    description: f.description,
    targetPence: f.path === "raising" ? f.targetPence : null,
    venue: f.venue,
    town: f.town,
    instagram: f.instagram ?? null,
    facebook: f.facebook ?? null,
    firstName,
    lastName,
    email: f.email,
    phone: f.phone,
    ...(memory ? { memoryName: f.memoryName ?? null, memoryDates: f.memoryDates ?? null } : {}),
  };
}
