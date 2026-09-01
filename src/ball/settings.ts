import { z } from "zod";

// TASK-313: what staff may change about the Festive Ball from the admin area. Pure Zod, no DB
// — unit-tested DB-free like src/ticker/model.ts, whose partial-update shape this follows.
//
// NOTE what is NOT here: the ticket price. £100 and £1,000 are printed in a magazine that
// cannot be recalled, so they live as constants in src/ball/pricing.ts. An editable price
// field is one somebody eventually changes by accident, and the blast radius is every buyer
// who has already paid.

// An ISO timestamp, or null to clear it. Rejects anything Date cannot parse so a typo becomes
// a 400 at the form rather than a NaN that silently disables a scheduled launch.
const nullableDate = z
  .string()
  .datetime({ offset: true })
  .nullable()
  .or(z.literal(null))
  .refine((v) => v === null || !Number.isNaN(new Date(v).getTime()), {
    message: "not a date we can read",
  });

// Free text staff type. Trimmed, and blank means "cleared" rather than an empty string on the
// page. Capped so a stray paste cannot push a wall of text into the layout.
const nullableText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .nullable();

export const ballSettingsUpdateSchema = z
  .object({
    // Capacity. Bounded on both sides: 0 tables would silently close the ball, and a fat
    // -fingered 4000 would let it oversell a room that holds 400.
    totalTables: z.number().int().min(1).max(200).optional(),
    seatsPerTable: z.number().int().min(1).max(20).optional(),
    heldSeats: z.number().int().min(0).max(2000).optional(),

    // Launch controls.
    gateOpen: z.boolean().optional(),
    gateOpensAt: nullableDate.optional(),

    // Sales window.
    salesCloseAt: nullableDate.optional(),
    salesClosed: z.boolean().optional(),

    // A new preview-gate password. Sent as plaintext over HTTPS and hashed by the route before
    // it reaches SQL — the plaintext never touches the database, the logs or the audit trail.
    // Eight characters is a floor, not a policy: this guards an unfinished marketing page that
    // staff hand round by text, and demanding a symbol and a digit would only mean it gets
    // written on a Post-it.
    previewPassword: z.string().min(8, "use at least 8 characters").max(200).optional(),

    // The card rate NBCC is charged, so the "cover the fee" checkbox quotes the truth
    // (TASK-317). Bounded to match the CHECK constraints on the columns: an accidental 1200
    // here would ask every buyer to cover 12%.
    cardFeePercentBp: z.number().int().min(0).max(1000).optional(),
    cardFeeFixedPence: z.number().int().min(0).max(500).optional(),

    // TASK-338: the date the venue needs final guest numbers by. NULL until NBCC agrees it,
    // and the run-up sends NOTHING while it is null - a chase with no date in it is nagging,
    // and it spends the one message people actually read before there is anything to say.
    guestDetailsLockAt: nullableDate.optional(),

    // Details that were not confirmed when the page was written.
    arrivalTime: nullableText(120).optional(),
    includedNote: nullableText(1000).optional(),
    lineUpNote: nullableText(1000).optional(),
    // TASK-345: the menu, one course per line. 4000 rather than 1000: a three-course menu with
    // options runs long, and a silently truncated menu is a guest choosing from half a list.
    menuOptions: nullableText(4000).optional(),
  })
  // .strict() is deliberately NOT used: an unknown key is stripped rather than rejected, so a
  // future admin form field cannot 400 the whole save before the server knows about it. The
  // price is protected by simply not existing here — anything extra never reaches the SQL.
  .refine((v) => Object.keys(v).length > 0, {
    message: "nothing to update",
  });

export type BallSettingsUpdate = z.infer<typeof ballSettingsUpdateSchema>;
