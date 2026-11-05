import type Stripe from "stripe";

// How a gift was paid, for the Donations gift log (docs/superpowers/specs/2026-11-05-donations-screen-design.md),
// read from the Stripe charge that took the money. PURE: no pool, no config, no network.
//
// Only these are ever kept: the payment method's type, and for a card (online or at the card reader)
// its brand, last four digits, issuing country and the wallet it was paid with. Nothing else Stripe
// knows about the payment (a Direct Debit's bank details, a card's expiry, fingerprints) is read.

export type PayMethod = "card" | "bacs_debit" | "card_present" | "other";
export type PayWallet = "apple_pay" | "google_pay" | "link" | "samsung_pay" | "other";

export interface PayDetails {
  method: PayMethod;
  wallet: PayWallet | null;
  brand: string | null;
  last4: string | null;
  country: string | null;
}

const NAMED_WALLETS: readonly PayWallet[] = ["apple_pay", "google_pay", "link", "samsung_pay"];

// A wallet Stripe names: one of ours by name, any other kind as "other"; null when there is none.
function walletOf(wallet: unknown): PayWallet | null {
  if (typeof wallet !== "object" || wallet === null) return null;
  const type = (wallet as { type?: unknown }).type;
  if (typeof type !== "string" || type === "") return null;
  return NAMED_WALLETS.find((w) => w === type) ?? "other";
}

// Each value only when it is the shape it should be, so nothing longer or stranger is ever stored.
const brandOf = (v: unknown): string | null => (typeof v === "string" && /^[a-z0-9_]{1,30}$/.test(v) ? v : null);
const last4Of = (v: unknown): string | null => (typeof v === "string" && /^\d{4}$/.test(v) ? v : null);
const countryOf = (v: unknown): string | null => (typeof v === "string" && /^[A-Z]{2}$/.test(v) ? v : null);

interface CardLike {
  brand?: unknown;
  last4?: unknown;
  country?: unknown;
  wallet?: unknown;
}

function fromCard(method: "card" | "card_present", card: CardLike | null | undefined): PayDetails {
  return {
    method,
    wallet: walletOf(card?.wallet),
    brand: brandOf(card?.brand),
    last4: last4Of(card?.last4),
    country: countryOf(card?.country),
  };
}

const NOTHING = { wallet: null, brand: null, last4: null, country: null } as const;

/** The charge's payment method, as the gift log keeps it. Null when there is no charge or no method on it. */
export function payDetailsFromCharge(charge: Stripe.Charge | null | undefined): PayDetails | null {
  const details = charge?.payment_method_details;
  if (typeof details !== "object" || details === null) return null;
  const type: unknown = details.type;
  if (typeof type !== "string" || type === "") return null;
  if (type === "card") return fromCard("card", details.card);
  if (type === "card_present") return fromCard("card_present", details.card_present);
  if (type === "bacs_debit") return { method: "bacs_debit", ...NOTHING };
  // Link as a payment method of its own (not a card paid through Link, which is a card above).
  if (type === "link") return { method: "other", ...NOTHING, wallet: "link" };
  return { method: "other", ...NOTHING };
}
