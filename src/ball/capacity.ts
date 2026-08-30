import { z } from "zod";

// TASK-313: pure, DB-free availability arithmetic for the Festive Ball (7 Nov 2026).
// NO pool, NO config, NO clock — importing this file touches nothing external, so it is
// unit-tested DB-free like src/benefits/caps.ts. The transactional layer that reads these
// numbers out of Postgres lives in src/db/ball.ts.
//
// The room is 40 tables of 10. Two things can be bought:
//   - a whole TABLE, which must come from a table nobody has broken into; and
//   - individual SEATS, which are pooled onto shared tables.
// Held-back seats (comps, sponsor guests) sit in the same shared pool and never go on sale.
//
// The subtle rule the client agreed: we sell down to the very last individual seat, so a
// shared table may go out with 7 people on it. That means seats and tables run out at
// DIFFERENT times — 9 free seats spread across a broken table is not a sellable table, and
// a caller asking for a table is refused while the page still sells seats.

export const SEATS_PER_TABLE = 10;
export const MAX_SEATS_PER_ORDER = 9;
export const MAX_TABLES_PER_ORDER = 4;

export const capacityStateSchema = z.object({
  totalTables: z.number().int().nonnegative(),
  seatsPerTable: z.number().int().positive(),
  heldSeats: z.number().int().nonnegative(),
  tablesSold: z.number().int().nonnegative(),
  looseSeatsSold: z.number().int().nonnegative(),
  reservedSeats: z.number().int().nonnegative(),
});
export type CapacityState = z.infer<typeof capacityStateSchema>;

export interface Availability {
  totalSeats: number;
  seatsRemaining: number;
  tablesRemaining: number;
  soldOut: boolean;
}

// Seats that are pooled rather than sold as whole tables: individual sales, live checkout
// reservations, and the comps held back. Together they decide how many tables are BROKEN.
function pooledSeats(s: CapacityState): number {
  return s.looseSeatsSold + s.reservedSeats + s.heldSeats;
}

export function availability(state: CapacityState): Availability {
  const s = capacityStateSchema.parse(state);
  const totalSeats = s.totalTables * s.seatsPerTable;
  const committed = s.tablesSold * s.seatsPerTable + pooledSeats(s);
  // Clamp: bad data must never produce a negative that reads as "space available".
  const seatsRemaining = Math.max(0, totalSeats - committed);

  // A whole table is only sellable if no pooled seat has broken into it.
  const tablesBrokenByPool = Math.ceil(pooledSeats(s) / s.seatsPerTable);
  const tablesRemaining = Math.max(0, s.totalTables - s.tablesSold - tablesBrokenByPool);

  return { totalSeats, seatsRemaining, tablesRemaining, soldOut: seatsRemaining === 0 };
}

export const orderSchema = z.object({
  kind: z.enum(["seat", "table"]),
  quantity: z.number().int(),
});
export type Order = z.infer<typeof orderSchema>;

// Can this order be met right now? Checks the per-order cap first (a policy limit, so a
// fat-fingered 40 never becomes a £4,000 charge), then real availability.
export function canFulfil(state: CapacityState, order: Order): boolean {
  const o = orderSchema.parse(order);
  if (o.quantity < 1) return false;

  const a = availability(state);
  if (o.kind === "table") {
    if (o.quantity > MAX_TABLES_PER_ORDER) return false;
    return a.tablesRemaining >= o.quantity;
  }
  if (o.quantity > MAX_SEATS_PER_ORDER) return false;
  return a.seatsRemaining >= o.quantity;
}

// How many seats an order consumes — the single place that conversion lives, so the
// reservation writer and the booking writer can never disagree about it.
export function seatsFor(order: Order, seatsPerTable = SEATS_PER_TABLE): number {
  const o = orderSchema.parse(order);
  return o.kind === "table" ? o.quantity * seatsPerTable : o.quantity;
}
