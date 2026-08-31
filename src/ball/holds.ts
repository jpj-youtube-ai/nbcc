import { z } from "zod";
import { SEATS_PER_TABLE } from "./capacity";

// TASK-324: what staff may put on hold, and when a hold stops counting. Pure — no pool, no
// clock of its own (the time is always passed in), unit-tested DB-free like ./capacity.ts.

export const holdCreateSchema = z.object({
  // Required, and required to be MEANINGFUL: the whole failure this replaces is a number
  // nobody can account for. A hold with no name is that number again, one row further on.
  name: z.string().trim().min(2, "say who the seats are for").max(200),
  kind: z.enum(["seat", "table"]),
  // Bounded at a whole room: a hold larger than the ball is a typo, and the damage it does
  // (everything off sale) looks exactly like a sold-out event.
  quantity: z.number().int().min(1).max(400),
  note: z
    .string()
    .max(500)
    .transform((v) => (v.trim().length === 0 ? null : v.trim()))
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  // NULL = held until someone releases it. A date = the seats come back on their own, which
  // is what an invoice hold actually wants: if it is never paid, nobody has to remember.
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});
export type HoldCreate = z.infer<typeof holdCreateSchema>;

// Seats a hold consumes. A table hold takes a whole table's worth, which is also what makes
// one fewer table sellable — availability counts held seats into the pool that breaks tables.
export function seatsForHold(kind: "seat" | "table", quantity: number): number {
  return kind === "table" ? quantity * SEATS_PER_TABLE : quantity;
}

export interface HoldRow {
  expiresAt: string | null;
  releasedAt: string | null;
  seats: number;
}

// Active = not handed back, and not past its own deadline.
//
// Expiry is decided HERE and in the SQL WHERE clause, never by a scheduled job. Nothing has to
// run for the seats to come back, so a hold cannot outlive its deadline because a sweeper
// failed at 3am in November.
export function isHoldActive(hold: HoldRow, now: Date): boolean {
  if (hold.releasedAt !== null) return false;
  if (hold.expiresAt === null) return true;
  const expires = new Date(hold.expiresAt).getTime();
  // An unreadable date counts as STILL HELD. The alternative is that a bad value silently
  // puts someone's invoiced tables back on sale.
  if (Number.isNaN(expires)) return true;
  return expires > now.getTime();
}

export function heldSeatsFrom(holds: HoldRow[], now: Date): number {
  return holds.reduce((total, h) => (isHoldActive(h, now) ? total + h.seats : total), 0);
}
