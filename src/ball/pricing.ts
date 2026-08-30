import { z } from "zod";
import { orderSchema, type Order, SEATS_PER_TABLE } from "./capacity";

// TASK-313: pure money arithmetic for the Festive Ball, in integer pence throughout —
// matching src/benefits/caps.ts and the donations columns. No floats reach the database.
//
// The £100 seat price is PRINTED in a magazine, so it is a constant here rather than an
// admin-editable setting: a price field is one somebody eventually changes by accident,
// and the leaflet cannot be recalled.

export const SEAT_PRICE_PENCE = 10_000; // £100
export const TABLE_PRICE_PENCE = SEAT_PRICE_PENCE * SEATS_PER_TABLE; // £1,000, no discount

// Stripe UK standard card pricing. If NBCC is granted the nonprofit rate (1.2% + 20p) this
// is the one place to change — but note ticket sales do NOT count towards that scheme's
// donation-volume test, so the standard rate is the safe assumption.
export const STRIPE_PERCENT = 0.015;
export const STRIPE_FIXED_PENCE = 20;

export function lineTotalPence(order: Order): number {
  const o = orderSchema.parse(order);
  return o.kind === "table" ? o.quantity * TABLE_PRICE_PENCE : o.quantity * SEAT_PRICE_PENCE;
}

// Rounded UP: the buyer is offering to cover the fee, and a rounded-down penny would leave
// the charity fractionally short on every single order.
export function stripeFeePence(amountPence: number): number {
  const amount = z.number().int().nonnegative().parse(amountPence);
  return Math.ceil(amount * STRIPE_PERCENT) + STRIPE_FIXED_PENCE;
}

export const orderTotalInputSchema = z.object({
  order: orderSchema,
  donationPence: z.number().int().nonnegative().default(0),
  coverFee: z.boolean().default(false),
});
export type OrderTotalInput = z.input<typeof orderTotalInputSchema>;

export interface OrderTotal {
  ticketsPence: number;
  donationPence: number;
  feeCoverPence: number;
  totalPence: number;
}

// The single place an order's money is decided, so the checkout page, the Stripe session and
// the booking row can never disagree about what was charged. The fee cover is calculated on
// tickets PLUS donation, because that is the amount Stripe actually charges a percentage of.
export function orderTotalPence(input: OrderTotalInput): OrderTotal {
  const { order, donationPence, coverFee } = orderTotalInputSchema.parse(input);
  const ticketsPence = lineTotalPence(order);
  const subtotal = ticketsPence + donationPence;
  const feeCoverPence = coverFee ? stripeFeePence(subtotal) : 0;
  return { ticketsPence, donationPence, feeCoverPence, totalPence: subtotal + feeCoverPence };
}
