// The unit suite runs with a placeholder STRIPE_SECRET_KEY and NODE_ENV=test, so `stripe`
// is the offline stub — no network. This pins the deterministic stub mapping the BDD depends on.
import { describe, it, expect } from "vitest";
import { findSubscriptionIdsByEmail } from "../../src/clients/stripe";

describe("findSubscriptionIdsByEmail (offline stub)", () => {
  it("maps an email to its deterministic stub subscription id", async () => {
    expect(await findSubscriptionIdsByEmail("donor@x")).toEqual(["sub_stub_donor@x"]);
  });
});
