import { describe, it, expect, vi, afterEach } from "vitest";
import Stripe from "stripe";

// Go-live safety switch (REQ-028/REQ-029). src/clients/stripe.ts decides at import time whether to
// use the REAL Stripe SDK or an offline STUB, from two facts: is STRIPE_SECRET_KEY a real key
// (`(sk|rk)_(test|live)_` + a 20+ char token), and is NODE_ENV production. The rule that protects a
// live launch is: production NEVER stubs — a placeholder/misconfigured key there yields the real SDK
// (a loud Stripe error) rather than a silent fake checkout. This locks the regex + the production
// rule, which were previously only exercised on the positive (real-key) path.
//
// Each case re-imports the module against a freshly-mocked config so the module-level
// `stripeConfigured` / `useStub` constants recompute. `stripe instanceof Stripe` distinguishes the
// real SDK from the plain-object stub.

const BASE_CONFIG = {
  DATABASE_URL: "postgres://localhost:5432/test",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_SUCCESS_URL: "https://nbcc.test/donate/thank-you",
  STRIPE_CANCEL_URL: "https://nbcc.test/donate",
  STRIPE_PRICE_BRONZE: "price_bronze",
  STRIPE_PRICE_SILVER: "price_silver",
  STRIPE_PRICE_GOLD: "price_gold",
  STRIPE_PRICE_PLATINUM: "price_platinum",
};

async function loadStripe(overrides: { STRIPE_SECRET_KEY: string; NODE_ENV: string }) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({ config: { ...BASE_CONFIG, ...overrides } }));
  return import("../../src/clients/stripe");
}

// A well-formed but non-live key of each shape (20+ token chars, so it satisfies the regex without
// ever being a real account credential — `new Stripe(...)` does no network at construction).
const REAL_SHAPED = {
  sk_test: "sk_test_" + "a".repeat(24),
  sk_live: "sk_live_" + "b".repeat(24),
  rk_test: "rk_test_" + "c".repeat(24),
  rk_live: "rk_live_" + "d".repeat(24),
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../../src/config");
});

describe("stripeConfigured — real-key classification (REQ-029)", () => {
  it.each(Object.entries(REAL_SHAPED))("classifies a %s-shaped key as a real key", async (_name, key) => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: key, NODE_ENV: "development" });
    expect(mod.stripeConfigured).toBe(true);
    // A real key ⇒ the real SDK in ANY environment (never the stub).
    expect(mod.stripe).toBeInstanceOf(Stripe);
  });

  it.each([
    ["a REPLACE_ME placeholder", "REPLACE_ME"],
    ["a short dev placeholder", "sk_test_123"],
    ["a 19-char token (one short of the 20 minimum)", "sk_test_" + "a".repeat(19)],
    ["an empty-ish junk value", "not-a-key"],
    ["a pk_ publishable key (never a secret)", "pk_live_" + "a".repeat(24)],
  ])("does NOT classify %s as a real key", async (_name, key) => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: key, NODE_ENV: "development" });
    expect(mod.stripeConfigured).toBe(false);
  });

  it("accepts exactly 20 token chars and rejects 19 (regex boundary)", async () => {
    const ok = await loadStripe({ STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(20), NODE_ENV: "development" });
    expect(ok.stripeConfigured).toBe(true);
    const short = await loadStripe({ STRIPE_SECRET_KEY: "sk_test_" + "a".repeat(19), NODE_ENV: "development" });
    expect(short.stripeConfigured).toBe(false);
  });
});

describe("stub-vs-live selection — production never stubs (REQ-029)", () => {
  it("uses the offline stub for a placeholder key OUTSIDE production", async () => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: "REPLACE_ME", NODE_ENV: "development" });
    expect(mod.stripeConfigured).toBe(false);
    // The stub is a plain object, not a Stripe instance, and returns a deterministic preview URL.
    expect(mod.stripe).not.toBeInstanceOf(Stripe);
    const session = await mod.stripe.checkout.sessions.create({ mode: "payment" } as never);
    expect(session.url).toMatch(/preview/);
  });

  it("NEVER stubs in production, even with a placeholder key (loud failure, not a silent fake)", async () => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: "REPLACE_ME", NODE_ENV: "production" });
    expect(mod.stripeConfigured).toBe(false);
    // The critical go-live invariant: production wires the REAL SDK regardless, so a misconfigured
    // key surfaces as a real Stripe error rather than a fake checkout URL.
    expect(mod.stripe).toBeInstanceOf(Stripe);
  });

  it("uses the real SDK in production with a real key", async () => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: REAL_SHAPED.sk_live, NODE_ENV: "production" });
    expect(mod.stripeConfigured).toBe(true);
    expect(mod.stripe).toBeInstanceOf(Stripe);
  });

  it("uses the real SDK for a real key even in test/development", async () => {
    const mod = await loadStripe({ STRIPE_SECRET_KEY: REAL_SHAPED.sk_test, NODE_ENV: "test" });
    expect(mod.stripe).toBeInstanceOf(Stripe);
  });
});
