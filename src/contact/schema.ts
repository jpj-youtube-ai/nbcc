import { z } from "zod";
import { normalisePhone, PHONE_MAX } from "../business/call-due";

// Zod schema for a public contact-form submission (2026-07-10 contact-inbox spec). Length caps
// bound the payload the public endpoint will INSERT into the isolated contact DB — the app-layer
// analogue of the stories submission schema's caps (src/stories/schema.ts).
export const CONTACT_MESSAGE_MAX = 5000;

export const CONTACT_PHONE_INVALID = "Please check your phone number. Use digits and spaces, for example 07700 900123.";

// Optional (Jaimie, 5 October 2026: for anyone who would rather be called back). Checked by the one
// phone rule the site has (normalisePhone: digits, spaces, + ( ) and -, at least 7 digits, up to
// 40 characters), so a number is the same shape here as on the Ball and in the admin. Empty, blank
// or missing is "" and is stored as no number.
const optionalPhone = z
  .string()
  .trim()
  .max(PHONE_MAX, CONTACT_PHONE_INVALID)
  .refine((v) => normalisePhone(v).ok, CONTACT_PHONE_INVALID)
  .optional()
  .default("");

export const contactEnquirySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional().default(""),
  email: z.string().email().max(254),
  phone: optionalPhone,
  message: z.string().min(1).max(CONTACT_MESSAGE_MAX),
});

export type ContactEnquiry = z.infer<typeof contactEnquirySchema>;
