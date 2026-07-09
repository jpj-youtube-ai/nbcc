import { z } from "zod";

// Zod schema for a public contact-form submission (2026-07-10 contact-inbox spec). Length caps
// bound the payload the public endpoint will INSERT into the isolated contact DB — the app-layer
// analogue of the stories submission schema's caps (src/stories/schema.ts).
export const CONTACT_MESSAGE_MAX = 5000;

export const contactEnquirySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional().default(""),
  email: z.string().email().max(254),
  message: z.string().min(1).max(CONTACT_MESSAGE_MAX),
});

export type ContactEnquiry = z.infer<typeof contactEnquirySchema>;
