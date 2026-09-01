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

// NBCC's Stripe card rate, confirmed against the account: 1.2% + 20p on the UK charity
// pricing. Held in BASIS POINTS so the arithmetic stays in integers — 120 bp = 1.20%.
//
// These are DEFAULTS. The live rate is a column on ball_settings and editable in admin
// (TASK-317), because a hardcoded rate quietly over-collects the day Stripe changes it: the
// page asks buyers to cover this exact number, so a stale rate takes money for a fee that
// was never charged. These values are the fallback when the settings row cannot be read.
export const DEFAULT_CARD_FEE_BP = 120;
export const DEFAULT_CARD_FEE_FIXED_PENCE = 20;

export interface CardFeeRate {
  percentBp: number;
  fixedPence: number;
}

export const DEFAULT_CARD_FEE: CardFeeRate = {
  percentBp: DEFAULT_CARD_FEE_BP,
  fixedPence: DEFAULT_CARD_FEE_FIXED_PENCE,
};

export const cardFeeRateSchema = z.object({
  percentBp: z.number().int().min(0).max(1000),
  fixedPence: z.number().int().min(0).max(500),
});

export function lineTotalPence(order: Order): number {
  const o = orderSchema.parse(order);
  return o.kind === "table" ? o.quantity * TABLE_PRICE_PENCE : o.quantity * SEAT_PRICE_PENCE;
}

// Rounded UP: the buyer is offering to cover the fee, and a rounded-down penny would leave
// the charity fractionally short on every single order.
//
// The fixed part is added ONCE, because Stripe charges per TRANSACTION, not per ticket. A
// table of ten is a single £1,000 payment and costs one 20p, not ten — charging per ticket
// would collect ~£1.80 more than Stripe actually takes and make the "cover the fee" claim
// untrue. It also means the fee per ticket falls as the order grows, which is worth showing.
export function stripeFeePence(amountPence: number, rate: CardFeeRate = DEFAULT_CARD_FEE): number {
  const amount = z.number().int().nonnegative().parse(amountPence);
  const { percentBp, fixedPence } = cardFeeRateSchema.parse(rate);
  return Math.ceil((amount * percentBp) / 10_000) + fixedPence;
}

// TASK-348: the fee to ADD so that the charity actually nets `targetPence`.
//
// stripeFeePence above answers "what does Stripe take on this amount", which is the right
// question for a charge that has already happened and the WRONG one for the cover-the-fee
// option. Stripe's percentage applies to the TOTAL it processes, and once the fee is added the
// total is bigger than the ticket price — so covering stripeFeePence(tickets) leaves the charity
// a penny or two short of the ticket price on every order, and more as the order grows:
//
//   1 seat  £100    fee £1.40   charged £101.40   Stripe takes £1.42   NBCC nets  £99.98
//   1 table £1,000  fee £12.20  charged £1,012.20 Stripe takes £12.35  NBCC nets £999.85
//
// Small, but the page promised the full ticket price would reach NBCC, and that was not
// quite true. This grosses up instead: charge C such that C minus Stripe's cut on C is exactly
// the target.
//
// Closed form first — C = ceil((target + fixed) / (1 - rate)) in integer pence — then verified
// against stripeFeePence itself and nudged up if the rounding leaves it a penny short. The
// verification is what makes this exact rather than approximately right: the two functions round
// independently, and a formula that agrees with the rounding today can stop agreeing when the
// rate changes.
export function grossedUpFeePence(
  targetPence: number,
  rate: CardFeeRate = DEFAULT_CARD_FEE,
): number {
  const target = z.number().int().nonnegative().parse(targetPence);
  const { percentBp, fixedPence } = cardFeeRateSchema.parse(rate);
  if (target === 0) return 0;

  // percentBp is capped at 1000 (10%) by the schema, so this denominator cannot reach zero.
  const denominator = 10_000 - percentBp;
  let charged = Math.ceil(((target + fixedPence) * 10_000) / denominator);

  // At most a penny or two of correction; bounded so a pathological rate cannot spin here.
  for (let i = 0; i < 4 && charged - stripeFeePence(charged, rate) < target; i += 1) {
    charged += 1;
  }
  return charged - target;
}

export const orderTotalInputSchema = z.object({
  order: orderSchema,
  donationPence: z.number().int().nonnegative().default(0),
  coverFee: z.boolean().default(false),
  cardFee: cardFeeRateSchema.default(DEFAULT_CARD_FEE),
});
export type OrderTotalInput = z.input<typeof orderTotalInputSchema>;

export interface OrderTotal {
  ticketsPence: number;
  donationPence: number;
  feeCoverPence: number;
  totalPence: number;
}

// The single place an order's money is decided, so the checkout page, the Stripe session and
// the booking row can never disagree about what was charged.
//
// The fee cover is calculated on the TICKETS ONLY, not tickets + donation. Stripe does charge
// its percentage on the whole payment, so NBCC absorbs roughly 1.2% of any donation added
// here — about 30p on £25. That is deliberate and matches the rest of the site, which has
// never asked donors to cover fees on a gift. The ticket is a fixed price where the fee eats
// into event income; the donation is a gift, and the fee on it is ordinary cost of
// fundraising.
export function orderTotalPence(input: OrderTotalInput): OrderTotal {
  const { order, donationPence, coverFee, cardFee } = orderTotalInputSchema.parse(input);
  const ticketsPence = lineTotalPence(order);
  const feeCoverPence = coverFee ? grossedUpFeePence(ticketsPence, cardFee) : 0;
  return {
    ticketsPence,
    donationPence,
    feeCoverPence,
    totalPence: ticketsPence + donationPence + feeCoverPence,
  };
}
