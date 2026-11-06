import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// A monthly gift's renewal is recorded once (TASK-596). Stripe sends two events for every paid
// renewal, invoice.paid and invoice.payment_succeeded, each with its own event id, so the event claim
// lets both through. On the API version we are pinned to (src/clients/stripe.ts) the invoice no longer
// carries payment_intent or charge, so the old check by payment intent never ran, and each event
// recorded the same payment as a gift of its own, with its own NBCC reference and its own thank you.
// The renewal is now known by its invoice id: kept on the donation, looked for under a lock.
// DB-free: the pool and the email client are stand-ins with a little memory. Invented ids throughout.

const { queryMock, mockClient, connect, sendDonationConfirmation } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const sendDonationConfirmation = vi.fn(async () => undefined);
  return { queryMock, mockClient, connect, sendDonationConfirmation };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect, query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));
vi.mock("../../src/db/donation-pay-details", () => ({ payDetailsLater: vi.fn() }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation,
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
}));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

let claimed: Set<string>;
let invoiceIds: Map<string, number>;
let inserted: number;
let steps: string[];

function installQuery() {
  claimed = new Set();
  invoiceIds = new Map();
  inserted = 0;
  steps = [];
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/pg_advisory_xact_lock/i.test(sql)) {
      steps.push(`lock ${String(params?.[0])}`);
      return { rows: [], rowCount: 1 };
    }
    if (/from donations where stripe_invoice_id/i.test(sql)) {
      steps.push("look");
      const id = invoiceIds.get(String(params?.[0]));
      return id ? { rows: [{ id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/update donations set stripe_invoice_id/i.test(sql)) {
      invoiceIds.set(String(params?.[1]), Number(params?.[0]));
      return { rows: [], rowCount: 1 };
    }
    if (/insert into donations/i.test(sql)) {
      inserted += 1;
      return { rows: [{ id: 500 + inserted }], rowCount: 1 };
    }
    if (/select 1 from donations where stripe_payment_intent_id/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/^\s*select[\s\S]*from donations d join donors/i.test(sql)) {
      return {
        rows: [{ donor_id: 10, gift_aid: true, declaration_id: 7, plan: "silver", donor_type: "individual", full_name: "Sam Example", email: "sam@example.com", email_consent: true }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

// A renewal as the pinned API version sends it: the subscription under parent, no payment_intent or charge.
const renewal = (eventId: string, type: "invoice.paid" | "invoice.payment_succeeded", invoiceId = "in_test_once"): Stripe.Event =>
  ({
    id: eventId,
    type,
    created: 1793600000,
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        amount_paid: 1000,
        currency: "gbp",
        parent: { subscription_details: { subscription: "sub_test_once" } },
        billing_reason: "subscription_cycle",
      },
    },
  }) as unknown as Stripe.Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  sendDonationConfirmation.mockClear();
  installQuery();
});

describe("a monthly renewal is recorded once", () => {
  it("records one gift and sends one thank you when Stripe sends both invoice.paid and invoice.payment_succeeded", async () => {
    const first = await processWebhookEvent(renewal("evt_test_paid", "invoice.paid"));
    const second = await processWebhookEvent(renewal("evt_test_succeeded", "invoice.payment_succeeded"));
    expect(first.action).toBe("donation.recurring");
    expect(second.action).toBe("ignored.duplicate_invoice");
    expect(inserted).toBe(1);
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
  });

  it("keeps the invoice id on the gift it records", async () => {
    await processWebhookEvent(renewal("evt_test_keep", "invoice.paid"));
    expect(invoiceIds.get("in_test_once")).toBe(501);
  });

  it("takes a lock on the invoice before looking, so two events arriving together cannot both record it", async () => {
    await processWebhookEvent(renewal("evt_test_lock", "invoice.paid"));
    expect(steps[0]).toBe("lock donation-invoice:in_test_once");
    expect(steps[1]).toBe("look");
  });

  it("records next month's renewal, which is a different invoice", async () => {
    await processWebhookEvent(renewal("evt_test_m1", "invoice.paid", "in_test_month1"));
    const next = await processWebhookEvent(renewal("evt_test_m2", "invoice.paid", "in_test_month2"));
    expect(next.action).toBe("donation.recurring");
    expect(inserted).toBe(2);
  });
});
