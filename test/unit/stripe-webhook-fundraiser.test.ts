import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { fundraiserGiftFromCheckoutSession, donationFromCheckoutSession } from "../../src/db/stripe-webhook-model";

// TASK-493: the webhook reads a fundraiser gift off the checkout session's metadata. Whether the
// fundraiser is approved is checked in the transaction (linkFundraiserGift); this is only the
// reading, and it must leave every donation without a fundraiserId exactly as it was.

const session = (metadata: Record<string, string>): Stripe.Checkout.Session =>
  ({
    id: "cs_test_fr",
    object: "checkout.session",
    amount_total: 2500,
    currency: "gbp",
    payment_status: "paid",
    payment_intent: "pi_test_fr",
    subscription: null,
    customer_details: { name: "Alex Example", email: "alex@example.com" },
    metadata: { mode: "once", plan: "", giftAid: "false", donorType: "individual", fullName: "Alex Example", email: "alex@example.com", ...metadata },
  }) as unknown as Stripe.Checkout.Session;

describe("a fundraiser gift on the session", () => {
  it("is read with its message and choices", () => {
    expect(
      fundraiserGiftFromCheckoutSession(session({ fundraiserId: "7", supporterMessage: " Go Robin! ", showName: "false", showAmount: "true" })),
    ).toEqual({ fundraiserId: 7, message: "Go Robin!", showName: false, showAmount: true });
  });

  it("shows the name and the amount unless the metadata says not to, and keeps no empty message", () => {
    expect(fundraiserGiftFromCheckoutSession(session({ fundraiserId: "7", supporterMessage: "" }))).toEqual({
      fundraiserId: 7,
      message: null,
      showName: true,
      showAmount: true,
    });
  });

  it.each([
    ["no fundraiser", {}],
    ["an empty one", { fundraiserId: "" }],
    ["one that is not a number", { fundraiserId: "7; DROP TABLE donations" }],
    ["zero", { fundraiserId: "0" }],
    ["a monthly gift", { fundraiserId: "7", mode: "monthly" }],
  ])("is nothing for %s", (_what, md) => {
    expect(fundraiserGiftFromCheckoutSession(session(md as Record<string, string>))).toBeNull();
  });

  it("holds a message to 200 characters whatever arrives", () => {
    const gift = fundraiserGiftFromCheckoutSession(session({ fundraiserId: "7", supporterMessage: "a".repeat(450) }));
    expect(gift?.message).toHaveLength(200);
  });

  it("leaves the donation record itself exactly as it would be without a fundraiser", () => {
    expect(donationFromCheckoutSession(session({ fundraiserId: "7", supporterMessage: "Hi", showName: "false" }))).toEqual(
      donationFromCheckoutSession(session({})),
    );
  });
});
