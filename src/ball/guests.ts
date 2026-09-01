import { z } from "zod";

// TASK-313 (plan 5): guest details for the Festive Ball — names for the door list, plus
// dietary and access needs for the venue. Pure: no pool, no clock, no crypto source (the
// random bytes are injected), so it is unit-tested DB-free.
//
// Dietary and access notes are SPECIAL CATEGORY data under UK GDPR: an allergy is health
// information, an access need can reveal a disability. Two consequences live in this file —
// a tight length cap (this is a note for the caterer, not a medical history) and the retention
// rule, which is stated here in code rather than only in a policy document.

export const GUEST_RETENTION_DAYS = 90;
export const EVENT_DATE = new Date("2026-11-07T00:00:00Z");

// The biggest bookable order is 4 tables = 40 seats, so no honest submission exceeds it.
const MAX_GUESTS = 40;

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const guestSchema = z.object({
  fullName: z.string().trim().min(1, "every guest needs a name").max(120),
  // 500 is deliberate: enough for "coeliac, and no shellfish", far short of somewhere to paste
  // a medical record into a charity's door list.
  dietary: optionalText(500),
  accessNeeds: optionalText(500),
  // TASK-345: "Course: choice" lines, built by the route from the menu itself. 500 covers a
  // three-course menu with long dish names and nothing more - this is a selection, not free text.
  menuChoice: optionalText(500),
});
export type GuestInput = z.infer<typeof guestSchema>;

export const guestSubmissionSchema = z.object({
  tableName: optionalText(120),
  guests: z.array(guestSchema).min(1, "list at least one guest").max(MAX_GUESTS),
});
export type GuestSubmission = z.infer<typeof guestSubmissionSchema>;

// The token in the "tell us about your table" email link. 24 random bytes, url-safe — long
// enough that guessing is not a route in, which matters because the link needs no password:
// asking a guest to make an account to tell us about a nut allergy would simply mean we never
// learn about the nut allergy.
export function makeGuestToken(bytes: Buffer): string {
  return bytes.toString("base64url");
}

// Has this row passed its retention date? Deliberately fails CLOSED (returns false) on an
// unreadable date: the cost of keeping a row slightly too long is a tidiness problem, while
// deleting a guest's access needs early could mean someone arrives to a venue that cannot
// accommodate them.
export function isExpired(expiresAt: Date, now: Date): boolean {
  const at = expiresAt.getTime();
  if (Number.isNaN(at)) return false;
  return at <= now.getTime();
}

// The retention date for a row collected now — 90 days after the event, not 90 days after
// collection, so every guest's details disappear on the same day regardless of when they were
// given.
export function retentionDate(): Date {
  return new Date(EVENT_DATE.getTime() + GUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
