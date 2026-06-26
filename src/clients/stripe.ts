import Stripe from "stripe";
import { config } from "../config";

// Stripe SDK client (REQ-028/REQ-029). The secret key comes from src/config — an
// SSM SecureString in AWS, a Stripe TEST key locally — never process.env directly
// (golden rule 3). The checkout-session endpoint (REQ-029) imports this client;
// the per-plan recurring price IDs and the success/cancel redirect URLs likewise
// come from config. Mirrors the src/clients/exampleApi.ts shape: a thin wrapper
// that reads its credentials through the config module.
export const stripe = new Stripe(config.STRIPE_SECRET_KEY);

// The recurring monthly Stripe price IDs, keyed by donate plan (REQ-022/REQ-028).
// The checkout-session endpoint maps an incoming `plan` to its price ID here.
export const stripePriceByPlan: Record<string, string> = {
  bronze: config.STRIPE_PRICE_BRONZE,
  silver: config.STRIPE_PRICE_SILVER,
  gold: config.STRIPE_PRICE_GOLD,
  platinum: config.STRIPE_PRICE_PLATINUM,
};
