import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

// Joining the mailing list from the /newsletter page, with a confirm by email step.
//
// This only ADDS people to the newsletter's own list, the way the website's footer form already
// does (subscribeSelf, src/newsletter/self-signup.ts). Nothing about how newsletters are written,
// sent, tracked or unsubscribed is here or is changed. Pure: no database, no config, no clock.

/** How long the emailed link works, and after which a request nobody confirmed is deleted. */
export const LINK_DAYS = 7;
/** A second request for the same address sends a fresh link no more often than this. */
export const RESEND_MINUTES = 10;

// Who NBCC is, in the charity's own words (given 2026-10-05). Word for word: do not reword.
// The full sentence is on the /newsletter page; the short one is in the confirmation email.
export const WHO_WE_ARE =
  "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland, with school clothing and crisis support whenever it is needed, and every December a full bag for those who would otherwise wake up on Christmas morning with nothing to open.";
export const WHO_WE_ARE_SHORT = "NBCC is a volunteer led charity here all year for children, young people and vulnerable adults across South West Scotland.";

export const FIRST_NAME_MESSAGE = "Please enter your first name.";
export const EMAIL_MESSAGE = "Please enter a valid email address.";

// What the form may send. The address is lower cased here, so every check after it (the limits, the
// stop list, the list itself) compares like with like.
export const signupSchema = z.object({
  firstName: z.string({ required_error: FIRST_NAME_MESSAGE, invalid_type_error: FIRST_NAME_MESSAGE }).trim().min(1, FIRST_NAME_MESSAGE).max(60, FIRST_NAME_MESSAGE),
  email: z
    .string({ required_error: EMAIL_MESSAGE, invalid_type_error: EMAIL_MESSAGE })
    .trim()
    .max(254, EMAIL_MESSAGE)
    .email(EMAIL_MESSAGE)
    .transform((v) => v.toLowerCase()),
});
export type SignupInput = z.infer<typeof signupSchema>;

// The link in the email: 32 random bytes, which is 43 characters that are safe in an address. Only
// its SHA-256 hash is kept (newsletter_signup_requests.token_hash), so nothing in the database, a
// backup or a log can be turned back into a working link.
export function newSignupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSignupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Is this the shape of one of our tokens? Anything else is never looked up. */
export function looksLikeSignupToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
