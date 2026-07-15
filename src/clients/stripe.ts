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

// Pin the Stripe API version explicitly rather than relying on the SDK's implicit
// default, which silently shifts whenever the `stripe` package is bumped. Pinning
// makes the request version deterministic and keeps it aligned with the TypeScript
// types shipped by this SDK release. Matches the version the installed SDK targets
// (node_modules/stripe apiVersion); bump this in lockstep when upgrading `stripe`,
// and align the webhook endpoint's API version in the Stripe dashboard so delivered
// events match these types. Passed to `new Stripe(...)` below, where it is
// type-checked against the SDK's LatestApiVersion, so an out-of-date pin fails the
// build at the call site (an intentional tripwire when `stripe` is upgraded).
export const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

function stubStripe(): Stripe {
  let n = 0;
  return {
    checkout: {
      sessions: {
        create: async (params: Stripe.Checkout.SessionCreateParams) => ({
          id: `cs_preview_${(n += 1)}`,
          // An obviously-fake but well-formed Checkout URL; no network call. The offline
          // preview URL reflects the session's key attributes — its mode and whether Gift
          // Aid was opted in (the verbatim wording is bound in metadata, TASK-053) — so the
          // gift-aided checkout flow is observable end to end without a live account.
          url: `https://checkout.stripe.com/c/pay/preview_${params.mode ?? "session"}${
            params.metadata?.giftAid === "true" ? "_giftaid" : ""
          }`,
          // Embedded Checkout (TASK-215): the stub also hands back a deterministic client_secret so
          // the inline (ui_mode: embedded_page) flow is observable end to end without a live account.
          // Real Stripe populates exactly ONE of url / client_secret per ui_mode; the checkout-session
          // endpoint reads only the field for the requested mode, so returning both here is harmless.
          client_secret: `cs_preview_secret_${params.mode ?? "session"}${
            params.metadata?.giftAid === "true" ? "_giftaid" : ""
          }`,
        }),
      },
    },
    // Subscription tier changes (REQ-055) exercised end to end without a Stripe
    // account. The retrieved sub carries a single item on an obviously-fake price
    // that never matches a real STRIPE_PRICE_*, so a plan change through the stub
    // always proceeds (never a no-op SamePlanError); update echoes the new price.
    subscriptions: {
      retrieve: async (id: string) => ({
        id,
        object: "subscription",
        status: "active",
        items: { data: [{ id: "si_preview", price: { id: "price_preview_current" } }] },
      }),
      update: async (id: string, params: Stripe.SubscriptionUpdateParams) => ({
        id,
        object: "subscription",
        status: "active",
        items: {
          data: [
            { id: "si_preview", price: { id: params.items?.[0]?.price ?? "price_preview_current" } },
          ],
        },
      }),
      // Cancel (REQ-055/TASK-102): echoes the subscription with status 'canceled', so the
      // reduce-instead-then-cancel flow runs end to end without a live Stripe account.
      cancel: async (id: string) => ({
        id,
        object: "subscription",
        status: "canceled",
        items: { data: [{ id: "si_preview", price: { id: "price_preview_current" } }] },
      }),
    },
  } as unknown as Stripe;
}

export const stripe: Stripe = useStub
  ? stubStripe()
  : new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

// Webhook signature verification (REQ-036/TASK-046). constructEvent is pure
// HMAC-SHA256 over the raw body — NO network — so it uses a real Stripe instance
// even when the checkout client above is the stub (placeholder key, no live
// account). Tests and the BDD sign events with STRIPE_WEBHOOK_SECRET via
// stripe.webhooks.generateTestHeaderString, so the whole verify path runs offline.
const webhookVerifier = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });

export function constructEvent(payload: Buffer | string, signature: string): Stripe.Event {
  return webhookVerifier.webhooks.constructEvent(payload, signature, config.STRIPE_WEBHOOK_SECRET);
}

// (TASK-238) The change-plan feature was removed as dead code: it had no front-end caller and no
// auth. Its plan->price map (`stripePriceByPlan`), `SamePlanError`, and `changeSubscriptionPlan`
// wrapper are gone. Monthly checkout builds an inline recurring price (TASK-231), so no fixed
// STRIPE_PRICE_* map is needed here; those SSM/config values are now unused (infra cleanup follows).

// Cancel a monthly subscription (REQ-055/TASK-102) — the "cancel" end of the reduce-instead-then-
// cancel flow. A thin wrapper over the SDK, mirroring changeSubscriptionPlan; the offline stub
// implements subscriptions.cancel so the portal cancel route runs offline. Returns the cancelled
// subscription (status 'canceled').
export async function cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.cancel(subscriptionId);
}
