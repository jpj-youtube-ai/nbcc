import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// TASK-070 (single donation-confirmation email): a checkout.session.completed event
// triggers EXACTLY ONE confirmation-email send when the donor gave us an email AND
// email_consent=true, and NO send when the email is absent or consent is false.
// DB-free per CLAUDE.md: the email client and config are mocked, so no
// SDK/network/env is touched. Mirrors test/unit/contact-endpoint.test.ts.

const { sendDonationConfirmation } = vi.hoisted(() => ({ sendDonationConfirmation: vi.fn() }));

vi.mock("../../src/clients/email", () => ({ sendDonationConfirmation }));

// stripe-webhook imports ./pool (which reads config.DATABASE_URL at module load) and
// the email client; mock config so the real one never validates process.env and exits.
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { sendConfirmation } from "../../src/db/stripe-webhook";
import { confirmationEmailFromCheckoutSession } from "../../src/db/stripe-webhook-model";

const session = (metadata: Record<string, string>): Stripe.Checkout.Session =>
  ({
    id: "cs_test_1",
    object: "checkout.session",
    amount_total: 5000,
    currency: "gbp",
    mode: "payment",
    payment_intent: "pi_test_1",
    subscription: null,
    customer_details: { name: "Ada Lovelace", email: "stripe@example.com" },
    metadata: { mode: "once", plan: "", giftAid: "false", fullName: "Ada Lovelace", ...metadata },
  }) as unknown as Stripe.Checkout.Session;

// The trigger the webhook processor runs after the donation commits: map the event to
// a payload, then send. This is exactly what handleCheckoutCompleted → sendConfirmation
// do, minus the DB write.
const trigger = (metadata: Record<string, string>) =>
  sendConfirmation(confirmationEmailFromCheckoutSession(session(metadata)));

beforeEach(() => {
  sendDonationConfirmation.mockReset();
  sendDonationConfirmation.mockResolvedValue(undefined);
});

describe("donation-confirmation email trigger (TASK-070)", () => {
  it("sends exactly one email when the donor gave an email AND email_consent=true", async () => {
    await trigger({ email: "ada@example.com", emailConsent: "true" });
    expect(sendDonationConfirmation).toHaveBeenCalledOnce();
    expect(sendDonationConfirmation).toHaveBeenCalledWith({
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      amountPence: 5000,
      currency: "GBP",
    });
  });

  it("sends NOTHING when email_consent is false (even though an email is present)", async () => {
    await trigger({ email: "ada@example.com", emailConsent: "false" });
    expect(sendDonationConfirmation).not.toHaveBeenCalled();
  });

  it("sends NOTHING when no email was captured", async () => {
    await trigger({ emailConsent: "true" });
    expect(sendDonationConfirmation).not.toHaveBeenCalled();
  });

  it("swallows a provider failure — the committed donation is not affected", async () => {
    sendDonationConfirmation.mockRejectedValueOnce(new Error("provider down"));
    await expect(trigger({ email: "ada@example.com", emailConsent: "true" })).resolves.toBeUndefined();
    expect(sendDonationConfirmation).toHaveBeenCalledOnce();
  });
});

describe("confirmationEmailFromCheckoutSession — pure event→payload mapping", () => {
  it("returns null when consent was withheld (platform sends nothing)", () => {
    expect(
      confirmationEmailFromCheckoutSession(session({ email: "ada@example.com", emailConsent: "false" })),
    ).toBeNull();
  });

  it("returns the payload for a consenting donor", () => {
    expect(
      confirmationEmailFromCheckoutSession(session({ email: "ada@example.com", emailConsent: "true" })),
    ).toEqual({ email: "ada@example.com", fullName: "Ada Lovelace", amountPence: 5000, currency: "GBP" });
  });
});
