import { z } from "zod";

/**
 * The outcomes a volunteer can record. Declared HERE, in the pure module, rather than beside the
 * queries: importing them from src/db/outreach.ts pulled the connection pool into a unit test,
 * which then exits on missing config. Pure things must not depend on the pool (golden rule 5).
 *
 * Richer than a yes/no because the middle states carry most of the value: "wrong person, passed
 * on internally" is a live lead, not a failure.
 */
export const OUTCOMES = [
  "signed_up",
  "interested",
  "asked_for_info",
  "passed_on",
  "not_this_year",
  "declined",
  "no_reply",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

// TASK-354: what the admin form is allowed to send. Pure schema, unit-tested DB-free.

/** Trim, and treat an empty box as absent rather than as an empty string. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .transform((v) => v ?? null);

export const outreachCreateSchema = z.object({
  businessName: z.string().trim().min(2, "the business needs a name").max(200),
  contactName: optionalText(120),
  // Optional on purpose: a volunteer often has a name and a phone number from a conversation
  // before they have an address, and making the email mandatory would mean that business never
  // gets recorded at all.
  contactEmail: z.string().trim().toLowerCase().email().max(200).nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: optionalText(40),
  // Drives the PECR warning. Defaults to company because that is both the common case and the
  // safe one: a sole trader wrongly marked as a company gets a warning nobody needed, while the
  // reverse would suppress a warning somebody did.
  businessType: z.enum(["company", "sole_trader"]).default("company"),
  note: optionalText(2000),
  owner: optionalText(120),
  /**
   * Set only when a volunteer has SEEN the matches and said they are a different business.
   * Without it, a match against a decline is refused server-side. Named for what it means rather
   * than "force", because the volunteer is asserting something, not overriding something.
   */
  acknowledgedMatches: z.boolean().optional(),
});

export type OutreachCreateInput = z.infer<typeof outreachCreateSchema>;

export const outreachOutcomeSchema = z.object({
  outcome: z.enum(OUTCOMES),
  // Only meaningful with "not this year", which is the outcome worth more than a decline - but
  // only if something remembers the date.
  askAgainOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "use a date like 2027-03-01")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export const outreachNoteSchema = z.object({
  body: z.string().trim().min(1, "the note needs something in it").max(2000),
});
