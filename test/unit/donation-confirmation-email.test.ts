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
import {
  buildDonationConfirmation,
  GIFT_AID_CONFIRMATION_LINE,
  MANAGE_CANCEL_LINE,
} from "../../src/donors/confirmation";

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
    expect(sendDonationConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        amountPence: 5000,
        currency: "GBP",
        text: expect.any(String),
        html: expect.any(String),
      }),
    );
  });

  it("sends the confirmation when an email is present even if consent is false (transactional thank-you)", async () => {
    await trigger({ email: "ada@example.com", emailConsent: "false" });
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
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
  it("returns the payload even when consent was withheld (transactional thank-you, REQ-039 revised)", () => {
    expect(
      confirmationEmailFromCheckoutSession(session({ email: "ada@example.com", emailConsent: "false" })),
    ).toEqual({
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      amountPence: 5000,
      currency: "GBP",
      giftAid: false,
      mode: "once",
    });
  });

  it("returns the payload for a consenting donor", () => {
    expect(
      confirmationEmailFromCheckoutSession(session({ email: "ada@example.com", emailConsent: "true" })),
    ).toEqual({
      email: "ada@example.com",
      fullName: "Ada Lovelace",
      amountPence: 5000,
      currency: "GBP",
      giftAid: false,
      mode: "once",
    });
  });

  it("still maps a payload for a company session (this pure mapper is consent-independent, not company-aware)", () => {
    // confirmationEmailFor/confirmationEmailFromCheckoutSession stay consent-independent and
    // company-agnostic — they return a payload whenever an email is present. The actual
    // suppression for a COMPANY donation (no donor thank-you alongside its Corporation Tax
    // receipt, TASK-088/REQ-053) is applied at the stripe-webhook.ts call site, which nulls the
    // email when a companyRow is present — see company-receipt-webhook.test.ts for that assertion.
    expect(
      confirmationEmailFromCheckoutSession(
        session({
          donorType: "company",
          companyLegalName: "Acme Ltd",
          companyContactName: "Ada Lovelace",
          companyContactEmail: "finance@acme.test",
          companyBillingAddress: "1 Office Park",
          companyBillingPostcode: "SW1A 1AA",
          companyConsiderationGiven: "false",
        }),
      ),
    ).toEqual({
      email: "finance@acme.test",
      fullName: "Ada Lovelace",
      amountPence: 5000,
      currency: "GBP",
      giftAid: false,
      mode: "once",
    });
  });
});

describe("buildDonationConfirmation (pure content) — REQ-060 · TASK-098", () => {
  const base = { fullName: "Ada Lovelace", amountPence: 5000, currency: "GBP" } as const;

  it("includes a Gift Aid confirmation line for a gift-aided donation, and manage/cancel copy for a monthly gift", () => {
    const content = buildDonationConfirmation({ ...base, giftAid: true, mode: "monthly" });
    expect(content.text).toContain(GIFT_AID_CONFIRMATION_LINE);
    expect(content.text).toContain("Jaimie Wakefield"); // the REQ-026 manage/cancel contact
    expect(content.text.toLowerCase()).toContain("cancel");
    expect(content.html).toContain("Gift Aid");
    expect(content.text).toContain("£50.00");
  });

  it("includes the Gift Aid line but NO manage/cancel copy for a one-off gift-aided donation", () => {
    const content = buildDonationConfirmation({ ...base, giftAid: true, mode: "once" });
    expect(content.text).toContain(GIFT_AID_CONFIRMATION_LINE);
    expect(content.text).not.toContain(MANAGE_CANCEL_LINE);
  });

  it("omits the Gift Aid line for a non-Gift-Aid donation", () => {
    const once = buildDonationConfirmation({ ...base, giftAid: false, mode: "once" });
    expect(once.text).not.toContain("Gift Aid");
    expect(once.text).not.toContain(MANAGE_CANCEL_LINE);
    // A non-Gift-Aid MONTHLY gift still gets manage/cancel copy but no Gift Aid line.
    const monthly = buildDonationConfirmation({ ...base, giftAid: false, mode: "monthly" });
    expect(monthly.text).not.toContain("Gift Aid");
    expect(monthly.text).toContain(MANAGE_CANCEL_LINE);
  });
});
