import { z } from "zod";
import { MAX_SEATS_PER_ORDER } from "./capacity";

// TASK-313 (plan 5): the waiting list. Pure Zod, unit-tested DB-free.
//
// The shape is deliberately small. Someone joining a waiting list has not bought anything and
// may never do so, so we ask for the least that lets staff make a useful offer: who they are,
// where to reach them, and how many places they want. Anything more would be collecting personal
// data on the chance it becomes handy, which is the thing data-protection law is actually about.

export const waitingListSchema = z.object({
  // Split like the booking form and the rest of the site (TASK-318). `name` below is
  // DERIVED, so the row, the admin list and the export keep reading one field.
  firstName: z.string().trim().min(1, "please give your first name").max(60),
  surname: z.string().trim().min(1, "please give your surname").max(60),
  email: z.string().trim().toLowerCase().email("that does not look like an email address").max(254),
  // Capped at the per-order seat limit: a waiting-list entry for 40 seats is not a realistic
  // offer to fill from cancellations, and the same cap already governs buying.
  seatsWanted: z.coerce.number().int().min(1).max(MAX_SEATS_PER_ORDER).default(1),
  note: z
    .string()
    .max(500)
    .transform((v) => {
      const t = v.trim();
      return t.length === 0 ? null : t;
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // Unticked by default and its own affirmative act, per PECR. Joining a waiting list is not
  // consent to be marketed to.
  newsletterOptIn: z.coerce.boolean().default(false),
})
  .transform((e) => ({ ...e, name: `${e.firstName} ${e.surname}` }));
export type WaitingListEntry = z.infer<typeof waitingListSchema>;

// An HTML checkbox posts "on" when ticked and nothing at all when not, which z.coerce.boolean()
// would read as true for ANY non-empty string. Normalise before parsing.
export function checkboxValue(raw: unknown): boolean {
  return raw === "on" || raw === "true" || raw === true || raw === "1";
}
