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
  /**
   * Who we know that knows them (TASK-404). Separate from `note` on purpose: the note is why the
   * business is worth approaching, this is the person who can open the door, and it has to be
   * findable on its own so a chase list can say "ask Sarah first".
   */
  warmIntro: optionalText(400),
  // Where the volunteer got the details, which the email then states (TASK-403, Article 14).
  detailsSource: z
    .enum(["website_or_listing", "given_to_us", "referred", "social"])
    .default("website_or_listing"),
  /**
   * How an individual subscriber agreed to hear from us (TASK-403). Meaningless for a company;
   * required before a sole trader can be emailed - see src/outreach/lawful-basis.ts. Captured on
   * the add form rather than at send time, because the volunteer remembers on the day they met
   * them, not three weeks later.
   */
  consentBasis: optionalText(400),
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
