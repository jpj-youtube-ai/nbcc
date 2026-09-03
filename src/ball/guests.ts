import { z } from "zod";
import { choosableCourses, formatChoice, type MenuCourse } from "./menu";

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
  // TASK-409: the halves, kept as typed. Optional because rows saved before the split have only
  // the joined name, and because the API accepts a full name on its own.
  firstName: optionalText(60),
  surname: optionalText(60),
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

// --- folding the posted form back into guests ---------------------------------------------
//
// The form posts flat fields (firstName1, surname1, dietary1, …) because it is a plain HTML
// form with no JavaScript to build a nested body. This lives here rather than in the route so
// it is unit-testable without standing up config, a pool or an HTTP server.

/** "Jo" + "Smith" -> "Jo Smith". Either half may be missing; both being missing means no guest. */
export function composeName(firstName: string, surname: string): string {
  return [firstName.trim(), surname.trim()].filter((p) => p.length > 0).join(" ");
}

export interface GuestFormRow {
  firstName: string;
  surname: string;
  fullName: string;
  dietary: string;
  accessNeeds: string;
  menuChoice: string | null;
}

const field = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? String(body[key]) : "";

// TASK-345: the menu selects, read back per guest.
//
// Keyed off the MENU rather than the form, so a select somebody added by hand cannot introduce a
// course the venue never offered, and a course dropped from the menu stops being collected the
// moment staff edit it.
export function menuChoiceFromForm(
  body: Record<string, unknown>,
  n: number,
  menu: MenuCourse[],
): string | null {
  const asked = choosableCourses(menu);
  if (asked.length === 0) return null;
  const pairs: Array<[string, string]> = asked.map((course, c) => {
    const value = field(body, `menu${n}_${c}`);
    // Only an option the menu actually offers. Anything else is discarded rather than stored,
    // so the kitchen never receives a dish nobody is cooking.
    return [course.name, course.options.includes(value) ? value : ""];
  });
  const formatted = formatChoice(pairs);
  return formatted.length > 0 ? formatted : null;
}

/**
 * Read every seat's row out of the posted body, dropping any the booker left entirely blank.
 * A half-filled table is the expected case, not an error.
 *
 * A row survives on EITHER half of a name. Someone who knows a guest only as "Sam" should not be
 * blocked from telling us about the allergy attached to Sam.
 */
export function guestsFromForm(
  body: Record<string, unknown>,
  seats: number,
  menu: MenuCourse[],
): GuestFormRow[] {
  const rows: GuestFormRow[] = [];
  for (let n = 1; n <= seats; n += 1) {
    const firstName = field(body, `firstName${n}`).trim();
    const surname = field(body, `surname${n}`).trim();
    const fullName = composeName(firstName, surname);
    if (!fullName) continue;
    rows.push({
      firstName,
      surname,
      fullName,
      dietary: field(body, `dietary${n}`),
      accessNeeds: field(body, `accessNeeds${n}`),
      menuChoice: menuChoiceFromForm(body, n, menu),
    });
  }
  return rows;
}

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
