import { z } from "zod";
import { MAX_SEATS_PER_ORDER, MAX_TABLES_PER_ORDER, seatsFor } from "./capacity";
import { orderTotalPence, DEFAULT_CARD_FEE, type CardFeeRate } from "./pricing";

// TASK-313: pure booking model for the Festive Ball — the request a buyer submits, the
// reference they are given, and the mapping back out of a Stripe session. NO pool, NO
// network, NO clock: randomness and the session object are INJECTED, so this is unit-tested
// DB-free like src/db/stripe-webhook-model.ts, whose shape it deliberately mirrors.

// What the checkout endpoint accepts. The per-order caps live here as well as in
// capacity.canFulfil: this one rejects a nonsense request before any database work, that one
// re-checks against live availability inside the reservation lock. Both must agree, so both
// import the same constants.
export const purchaseSchema = z
  .object({
    kind: z.enum(["seat", "table"]),
    quantity: z.number().int().positive(),
    buyerName: z.string().trim().min(1).max(120),
    buyerEmail: z.string().trim().toLowerCase().email().max(254),
    // A voluntary donation on top of the ticket. This is the ONLY Gift Aid-able money in the
    // event: HMRC does not allow Gift Aid on ticket sales, because the buyer receives a dinner
    // and a show in return. Ceiling of £1,000,000 guards against a fat-fingered amount.
    donationPence: z.number().int().nonnegative().max(100_000_000).default(0),
    coverFee: z.boolean().default(false),
    giftAid: z.boolean().default(false),
    newsletterOptIn: z.boolean().default(false),
    uiMode: z.enum(["hosted", "embedded"]).default("hosted"),
  })
  .refine((p) => (p.kind === "seat" ? p.quantity <= MAX_SEATS_PER_ORDER : p.quantity <= MAX_TABLES_PER_ORDER), {
    message: "quantity above the per-order limit",
    path: ["quantity"],
  })
  // Gift Aid is a declaration about a DONATION. Claiming it with nothing donated would put an
  // unclaimable declaration on the record, so refuse it at the door.
  .refine((p) => !p.giftAid || p.donationPence > 0, {
    message: "Gift Aid needs a donation",
    path: ["giftAid"],
  });
export type Purchase = z.infer<typeof purchaseSchema>;

// Ambiguous characters removed (no O/0, I/1, L) so a reference read down the phone or copied
// off a printed door list cannot be transcribed wrongly. 31 symbols.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const REFERENCE_LENGTH = 6;

// Pure: the caller supplies the random bytes (crypto.randomBytes at the call site), so the
// same bytes always give the same reference and the test needs no clock or entropy.
export function makeReference(bytes: Buffer): string {
  let out = "";
  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    out += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  }
  return `BALL-${out}`;
}

// The discriminator that keeps ball purchases OUT of the donation path. The site has exactly
// one Stripe webhook endpoint, shared with donations, so every handler must be able to tell
// whose event this is. A donation session never carries product=ball.
export function isBallSession(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.product === "ball";
}

// Everything the webhook needs stamped onto the Stripe session, as strings (Stripe metadata
// values are always strings). The money is recorded here rather than recalculated later, so
// what we charged and what we record can never drift.
//
// That promise is why cardFee is a PARAMETER (TASK-317). The line items are priced at the
// live rate from ball_settings; if this stamped the compiled-in default instead, then the
// moment anyone edited the rate in admin, Stripe would charge one figure and the booking row
// would record another — with only the metadata surviving into the database.
export function ballMetadata(
  purchase: Purchase,
  reference: string,
  seats: number,
  cardFee: CardFeeRate = DEFAULT_CARD_FEE,
): Record<string, string> {
  const total = orderTotalPence({
    order: { kind: purchase.kind, quantity: purchase.quantity },
    donationPence: purchase.donationPence,
    coverFee: purchase.coverFee,
    cardFee,
  });
  return {
    product: "ball",
    reference,
    kind: purchase.kind,
    quantity: String(purchase.quantity),
    seats: String(seats),
    buyerName: purchase.buyerName,
    ticketsPence: String(total.ticketsPence),
    donationPence: String(total.donationPence),
    feeCoverPence: String(total.feeCoverPence),
    totalPence: String(total.totalPence),
    giftAid: String(purchase.giftAid),
    newsletterOptIn: String(purchase.newsletterOptIn),
  };
}

export interface BallBookingWrite {
  reference: string;
  kind: "seat" | "table";
  quantity: number;
  seats: number;
  buyerName: string;
  buyerEmail: string;
  ticketsPence: number;
  donationPence: number;
  feeCoverPence: number;
  totalPence: number;
  giftAid: boolean;
  newsletterOptIn: boolean;
  stripeSessionId: string;
}

// The minimum shape of a Stripe Checkout Session this mapping reads. Declared structurally
// rather than importing Stripe's type so the unit test can hand it a plain object.
export interface SessionLike {
  id: string;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null } | null;
  customer_email?: string | null;
}

// checkout.session.completed -> the booking row. Returns null for anything that is not a ball
// purchase, so the shared webhook can fall straight through to the donation handler.
export function bookingFromSession(session: SessionLike): BallBookingWrite | null {
  const md = session.metadata ?? {};
  if (!isBallSession(md)) return null;

  const num = (key: string): number => {
    const n = Number(md[key]);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    reference: md.reference ?? "",
    kind: md.kind === "table" ? "table" : "seat",
    quantity: num("quantity"),
    seats: num("seats"),
    buyerName: md.buyerName ?? "",
    buyerEmail: session.customer_details?.email ?? session.customer_email ?? "",
    ticketsPence: num("ticketsPence"),
    donationPence: num("donationPence"),
    feeCoverPence: num("feeCoverPence"),
    totalPence: num("totalPence"),
    giftAid: md.giftAid === "true",
    newsletterOptIn: md.newsletterOptIn === "true",
    stripeSessionId: session.id,
  };
}

// Re-exported so the checkout endpoint has one import for the seat conversion it must stamp.
export { seatsFor };
