import { describe, it, expect, vi } from "vitest";

// Chore: the Stripe API version is pinned explicitly (src/clients/stripe.ts) rather
// than relying on the SDK's implicit default, which shifts on every `stripe` bump.
// This guards that (a) the pinned constant is the expected version and (b) the real
// SDK client is actually constructed with it. DB-free / offline: config is mocked
// with a real-shaped TEST key so the client takes the real-SDK path (not the stub),
// and constructing `new Stripe(...)` makes no network call.

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(24), // matches the REAL_KEY shape → real SDK, not the stub
    STRIPE_WEBHOOK_SECRET: "whsec_dummy",
    STRIPE_PRICE_BRONZE: "price_bronze",
    STRIPE_PRICE_SILVER: "price_silver",
    STRIPE_PRICE_GOLD: "price_gold",
    STRIPE_PRICE_PLATINUM: "price_platinum",
  },
}));

import { STRIPE_API_VERSION, stripe, stripeConfigured } from "../../src/clients/stripe";

describe("Stripe API version pin", () => {
  it("pins the expected API version", () => {
    expect(STRIPE_API_VERSION).toBe("2026-06-24.dahlia");
  });

  it("constructs the real SDK client with the pinned version", () => {
    // With a real-shaped key the client is the real Stripe SDK (not the offline stub).
    expect(stripeConfigured).toBe(true);
    const version = (stripe as unknown as { getApiField(k: string): string }).getApiField(
      "version",
    );
    expect(version).toBe(STRIPE_API_VERSION);
  });
});
