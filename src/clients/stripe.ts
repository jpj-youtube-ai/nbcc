import Stripe from "stripe";
import { config } from "../config";

// Stripe SDK client (REQ-028/REQ-029). The secret key comes from src/config — an
// SSM SecureString in AWS, a Stripe TEST key locally — never process.env directly
// (golden rule 3). The checkout-session endpoint (REQ-029) imports this client;
// the per-plan recurring price IDs likewise come from config. Mirrors the
// src/clients/exampleApi.ts shape: a thin wrapper reading its credentials through
// the config module.
//
// A real Stripe API key is `sk_test_`/`sk_live_` (standard) or `rk_test_`/`rk_live_`
// (restricted), followed by a long token. Local dev and CI use short placeholder
// keys, and fresh SSM params start as REPLACE_ME, so there is no live Stripe to
// call. OUTSIDE production, when the key is not a real key, we expose a thin STUB
// whose checkout.sessions.create returns a deterministic preview URL (no network),
// so the /api/checkout-session flow can be exercised end to end — locally and in
// CI — without a Stripe account. With a real key the real SDK is used in any
// environment, and production NEVER stubs, so a missing real key there surfaces as
// a loud Stripe error rather than a silent fake checkout.
const REAL_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{20,}$/;
export const stripeConfigured = REAL_KEY.test(config.STRIPE_SECRET_KEY);
const useStub = !stripeConfigured && config.NODE_ENV !== "production";

function stubStripe(): Stripe {
  let n = 0;
  return {
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => ({
          id: `cs_preview_${(n += 1)}`,
          // An obviously-fake but well-formed Checkout URL; no network call.
          url: `https://checkout.stripe.com/c/pay/preview_${params.mode ?? "session"}`,
        }),
      },
    },
  } as unknown as Stripe;
}

export const stripe: Stripe = useStub ? stubStripe() : new Stripe(config.STRIPE_SECRET_KEY);

// The recurring monthly Stripe price IDs, keyed by donate plan (REQ-022/REQ-028).
// The checkout-session endpoint maps an incoming `plan` to its price ID here.
export const stripePriceByPlan: Record<string, string> = {
  bronze: config.STRIPE_PRICE_BRONZE,
  silver: config.STRIPE_PRICE_SILVER,
  gold: config.STRIPE_PRICE_GOLD,
  platinum: config.STRIPE_PRICE_PLATINUM,
};
