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

    // Details that were not confirmed when the page was written.
    arrivalTime: nullableText(120).optional(),
    includedNote: nullableText(1000).optional(),
    lineUpNote: nullableText(1000).optional(),
  })
  // .strict() is deliberately NOT used: an unknown key is stripped rather than rejected, so a
  // future admin form field cannot 400 the whole save before the server knows about it. The
  // price is protected by simply not existing here — anything extra never reaches the SQL.
  .refine((v) => Object.keys(v).length > 0, {
    message: "nothing to update",
  });

export type BallSettingsUpdate = z.infer<typeof ballSettingsUpdateSchema>;
