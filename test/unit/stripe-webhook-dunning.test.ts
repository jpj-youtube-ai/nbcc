import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-092 (REQ-065): dunning webhook handling. A monthly subscription whose Smart Retries are
// exhausted lapses: the subscription_dunning row flips to 'lapsed' with a subscription.lapsed
// audit row in the SAME transaction, and post-commit the platform emails the admin (always) and
// the donor (only with email + consent). DB-free per CLAUDE.md: the pool + email client + config
// are mocked (same approach as company-receipt-webhook.test.ts). A resent event id applies the
// transition and sends the emails at most once (idempotency ledger).

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

const { sendSubscriptionLapsedDonor, sendSubscriptionLapsedAdmin, sendDonationConfirmation, sendDeclarationEmail, sendCompanyReceipt } =
  vi.hoisted(() => ({
    sendSubscriptionLapsedDonor: vi.fn(),
    sendSubscriptionLapsedAdmin: vi.fn(),
    sendDonationConfirmation: vi.fn(),
    sendDeclarationEmail: vi.fn(),
    sendCompanyReceipt: vi.fn(),
  }));
vi.mock("../../src/clients/email", () => ({
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendCompanyReceipt,
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
    ADMIN_NOTIFICATION_EMAIL: "admin@nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";
import { dunningFromStripeEvent } from "../../src/db/stripe-webhook-model";

const SUB_ID = "sub_bdd_dunning";
const DUNNING_ID = 5;
const DONOR_ID = 10;

// The dunning target row the JOIN returns: an in-flight past_due subscription for donor Ada.
let target: Record<string, unknown> | undefined;
let claimed: Set<string>;

function installQuery() {
  claimed = new Set();
  target = {
    dunning_id: DUNNING_ID,
    status: "past_due",
    failed_attempts: 3,
    donor_id: DONOR_ID,
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    email_consent: true,
  };
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/from\s+donations[\s\S]*subscription_dunning/i.test(sql)) {
      return { rows: target ? [target] : [], rowCount: target ? 1 : 0 };
    }
    if (/update subscription_dunning/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into subscription_dunning/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

// A customer.subscription.deleted event lapses a past_due subscription (retries exhausted).
const lapseEvent = (id = "evt_lapse") =>
  ({
    id,
    type: "customer.subscription.deleted",
    data: { object: { id: SUB_ID, object: "subscription", status: "canceled" } },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  sendSubscriptionLapsedDonor.mockReset();
  sendSubscriptionLapsedAdmin.mockReset();
  sendSubscriptionLapsedDonor.mockResolvedValue(undefined);
  sendSubscriptionLapsedAdmin.mockResolvedValue(undefined);
  installQuery();
});

describe("dunning lapse — subscription_dunning + audit + notifications (REQ-065)", () => {
  it("marks the row lapsed and appends one subscription.lapsed audit row in the same transaction", async () => {
    const result = await processWebhookEvent(lapseEvent());
    expect(result).toEqual({ processed: true, action: "subscription.lapsed" });

    // The dunning row is updated to lapsed BEFORE COMMIT.
    const update = call(/update subscription_dunning/i);
    expect(update?.[1][0]).toBe("lapsed"); // status
    expect(update?.[1][2]).toBe(DUNNING_ID);
    expect(update?.[0]).toMatch(/lapsed_at = now\(\)/i);

    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    const lapseAudits = audits.filter((c) => c[1][1] === "subscription.lapsed");
    expect(lapseAudits).toHaveLength(1);

    const seq = sqls();
    const commitIdx = seq.findIndex((s) => /^commit/i.test(s));
    const updateIdx = seq.findIndex((s) => /update subscription_dunning/i.test(s));
    expect(updateIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(commitIdx);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);
  });

  it("always sends the admin notification and the donor notification when email_consent is true", async () => {
    await processWebhookEvent(lapseEvent());
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedAdmin.mock.calls[0][0].email).toBe("admin@nbcc.test");
    expect(sendSubscriptionLapsedDonor).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedDonor.mock.calls[0][0].email).toBe("ada@example.com");
  });

  it("sends the admin notification but NOT the donor notification when consent is false", async () => {
    target = { ...target, email_consent: false };
    await processWebhookEvent(lapseEvent());
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedDonor).not.toHaveBeenCalled();
  });

  it("sends the admin notification but NOT the donor notification when the donor has no email", async () => {
    target = { ...target, email: null };
    await processWebhookEvent(lapseEvent());
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedDonor).not.toHaveBeenCalled();
  });
});

// An invoice.payment_failed event carrying the subscription (flat field) and Stripe's
// next_payment_attempt: a number while a retry is still scheduled, null once retries are exhausted.
const invoiceFailedEvent = (nextAttempt: number | null, id = "evt_inv_fail") =>
  ({
    id,
    type: "invoice.payment_failed",
    data: { object: { object: "invoice", subscription: SUB_ID, next_payment_attempt: nextAttempt } },
  }) as unknown as import("stripe").Event;

// A customer.subscription.updated event whose status decides whether the sub has lapsed.
const subUpdatedEvent = (status: string, id = "evt_sub_upd") =>
  ({
    id,
    type: "customer.subscription.updated",
    data: { object: { id: SUB_ID, object: "subscription", status } },
  }) as unknown as import("stripe").Event;

describe("dunning renewal-failure lifecycle end-to-end (REQ-057/REQ-065)", () => {
  it("invoice.payment_failed with a retry still due moves active → past_due (no lapse, no email)", async () => {
    // A first failure on a healthy subscription: no dunning row yet, so it is INSERTed as past_due.
    target = {
      dunning_id: null, status: null, failed_attempts: null,
      donor_id: DONOR_ID, full_name: "Ada Lovelace", email: "ada@example.com", email_consent: true,
    };
    const result = await processWebhookEvent(invoiceFailedEvent(1893456000));
    expect(result).toEqual({ processed: true, action: "subscription.payment_failed" });

    const insert = call(/insert into subscription_dunning/i);
    expect(insert?.[1][2]).toBe("past_due"); // status
    expect(insert?.[1][3]).toBe(1); // failed_attempts incremented from 0
    expect(insert?.[0]).toMatch(/lapsed_at[\s\S]*NULL/i); // not lapsed
    // No lapse ⇒ no notifications.
    expect(sendSubscriptionLapsedAdmin).not.toHaveBeenCalled();
    expect(sendSubscriptionLapsedDonor).not.toHaveBeenCalled();
    expect(sqls().some((s) => /rollback/i.test(s))).toBe(false);
  });

  it("a further invoice.payment_failed (retry due) stays past_due and bumps the attempt count", async () => {
    // Existing past_due row (failed_attempts 3) → another failure with a retry still due stays past_due.
    const result = await processWebhookEvent(invoiceFailedEvent(1893456000));
    expect(result).toEqual({ processed: true, action: "subscription.payment_failed" });
    const update = call(/update subscription_dunning/i);
    expect(update?.[1][0]).toBe("past_due");
    expect(update?.[1][1]).toBe(4); // 3 → 4
    expect(update?.[0]).not.toMatch(/lapsed_at = now\(\)/i);
    expect(sendSubscriptionLapsedAdmin).not.toHaveBeenCalled();
  });

  it("invoice.payment_failed with retries EXHAUSTED (next_payment_attempt null) lapses past_due → lapsed + notifies", async () => {
    const result = await processWebhookEvent(invoiceFailedEvent(null));
    expect(result).toEqual({ processed: true, action: "subscription.lapsed" });
    const update = call(/update subscription_dunning/i);
    expect(update?.[1][0]).toBe("lapsed");
    expect(update?.[0]).toMatch(/lapsed_at = now\(\)/i);
    // Retries exhausted preserves the final attempt count (not incremented).
    expect(update?.[1][1]).toBe(3);
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedDonor).toHaveBeenCalledOnce();
  });

  it("customer.subscription.updated to unpaid lapses a past_due subscription", async () => {
    const result = await processWebhookEvent(subUpdatedEvent("unpaid"));
    expect(result).toEqual({ processed: true, action: "subscription.lapsed" });
    expect(call(/update subscription_dunning/i)?.[1][0]).toBe("lapsed");
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
  });

  it("customer.subscription.updated to a healthy active status is ignored (not a dunning event)", async () => {
    const result = await processWebhookEvent(subUpdatedEvent("active"));
    expect(result).toEqual({ processed: true, action: "ignored.not_dunning" });
    expect(call(/update subscription_dunning/i)).toBeUndefined();
  });

  it("an event type the handler does not subscribe to is ignored (default branch)", async () => {
    // payment_intent.succeeded is not in the dispatch switch → the default `ignored` no-op, never
    // reaching handleDunning. Confirms unhandled Stripe events cannot mutate donation state.
    const evt = { id: "evt_pi", type: "payment_intent.succeeded", data: { object: { object: "payment_intent" } } } as unknown as import("stripe").Event;
    const result = await processWebhookEvent(evt);
    expect(result).toEqual({ processed: true, action: "ignored" });
  });

  it("a dunning failure for a subscription with no donation on file is ignored", async () => {
    target = undefined; // the JOIN returns no row
    const result = await processWebhookEvent(invoiceFailedEvent(null));
    expect(result).toEqual({ processed: true, action: "ignored.no_subscription" });
  });

  it("a successful invoice recovers an open past_due dunning row to active (in the same transaction)", async () => {
    // invoice.paid routes to handleRecurring (records the renewal) AND handleDunning (recovery); the
    // returned action is the recurring one, so we assert the dunning row was reset to active directly.
    const result = await processWebhookEvent(
      { id: "evt_paid", type: "invoice.paid", data: { object: { object: "invoice", subscription: SUB_ID } } } as unknown as import("stripe").Event,
    );
    expect(result.processed).toBe(true);
    const update = call(/update subscription_dunning/i);
    expect(update?.[1][0]).toBe("active"); // past_due → active
    expect(update?.[1][1]).toBe(0); // failed_attempts reset
    expect(update?.[0]).not.toMatch(/lapsed_at = now\(\)/i);
    expect(sqls().some((s) => /rollback/i.test(s))).toBe(false);
  });
});

// TASK-240 (supporters-wall accuracy): a VOLUNTARY cancel — customer.subscription.deleted on a
// still-ACTIVE subscription (no open dunning) — was previously ignored (retries_exhausted is illegal
// from active). It is now recorded as a cancellation (cancelled_at) so listPublicSupporters can drop
// the donor after the grace period. It is NOT a payment lapse, so no lapse emails fire and no dunning
// row flips to 'lapsed'.
describe("voluntary cancellation recording (TASK-240)", () => {
  it("records cancelled_at + a subscription.cancelled audit for a deleted-while-active subscription (no dunning row)", async () => {
    target = {
      dunning_id: null, status: null, failed_attempts: null,
      donor_id: DONOR_ID, full_name: "Ada Lovelace", email: "ada@example.com", email_consent: true,
    };
    const result = await processWebhookEvent(lapseEvent("evt_cancel"));
    expect(result).toEqual({ processed: true, action: "subscription.cancelled" });

    // Upserts the dunning row with cancelled_at set — NOT a lapse (lapsed_at is not stamped).
    const insert = call(/insert into subscription_dunning/i);
    expect(insert).toBeDefined();
    expect(insert?.[0]).toMatch(/cancelled_at/i);
    expect(insert?.[0]).not.toMatch(/lapsed_at = now\(\)/i);

    // Exactly one subscription.cancelled audit; a voluntary cancel sends no lapse emails.
    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits.filter((c) => c[1][1] === "subscription.cancelled")).toHaveLength(1);
    expect(sendSubscriptionLapsedAdmin).not.toHaveBeenCalled();
    expect(sendSubscriptionLapsedDonor).not.toHaveBeenCalled();
    expect(sqls().some((s) => /rollback/i.test(s))).toBe(false);
  });

  it("stamps cancelled_at on an EXISTING active dunning row (recovered-then-cancelled), not a lapse", async () => {
    target = {
      dunning_id: DUNNING_ID, status: "active", failed_attempts: 0,
      donor_id: DONOR_ID, full_name: "Ada", email: "ada@example.com", email_consent: true,
    };
    const result = await processWebhookEvent(lapseEvent("evt_cancel_existing"));
    expect(result).toEqual({ processed: true, action: "subscription.cancelled" });
    const update = call(/update subscription_dunning/i);
    expect(update?.[0]).toMatch(/cancelled_at = /i);
    expect(update?.[0]).not.toMatch(/lapsed_at = now\(\)/i);
    expect(sendSubscriptionLapsedAdmin).not.toHaveBeenCalled();
  });

  it("does NOT record a cancellation for an already-lapsed subscription (its end is already stamped)", async () => {
    target = {
      dunning_id: DUNNING_ID, status: "lapsed", failed_attempts: 3,
      donor_id: DONOR_ID, full_name: "Ada", email: "ada@example.com", email_consent: true,
    };
    const result = await processWebhookEvent(lapseEvent("evt_cancel_lapsed"));
    expect(result).toEqual({ processed: true, action: "ignored.dunning_noop" });
    expect(call(/insert into subscription_dunning/i)).toBeUndefined();
    expect(call(/update subscription_dunning/i)).toBeUndefined();
  });
});

describe("dunningFromStripeEvent mapper — Stripe event → dunning event (REQ-057/REQ-065)", () => {
  const ev = (type: string, object: Record<string, unknown>) =>
    ({ id: "e", type, data: { object } }) as unknown as import("stripe").Event;

  it("invoice.payment_failed with a retry still due → payment_failed", () => {
    expect(dunningFromStripeEvent(ev("invoice.payment_failed", { subscription: SUB_ID, next_payment_attempt: 123 })))
      .toEqual({ subscriptionId: SUB_ID, dunningEvent: "payment_failed" });
  });

  it("invoice.payment_failed with next_payment_attempt null → retries_exhausted", () => {
    expect(dunningFromStripeEvent(ev("invoice.payment_failed", { subscription: SUB_ID, next_payment_attempt: null })))
      .toEqual({ subscriptionId: SUB_ID, dunningEvent: "retries_exhausted" });
  });

  it("invoice.payment_failed with next_payment_attempt ABSENT is treated as exhausted", () => {
    // A payload that omits the field entirely (== null) must not be read as a live retry.
    expect(dunningFromStripeEvent(ev("invoice.payment_failed", { subscription: SUB_ID })))
      .toEqual({ subscriptionId: SUB_ID, dunningEvent: "retries_exhausted" });
  });

  it("invoice.paid / invoice.payment_succeeded → payment_succeeded", () => {
    for (const t of ["invoice.paid", "invoice.payment_succeeded"]) {
      expect(dunningFromStripeEvent(ev(t, { subscription: SUB_ID })))
        .toEqual({ subscriptionId: SUB_ID, dunningEvent: "payment_succeeded" });
    }
  });

  it("customer.subscription.deleted → retries_exhausted", () => {
    expect(dunningFromStripeEvent(ev("customer.subscription.deleted", { id: SUB_ID })))
      .toEqual({ subscriptionId: SUB_ID, dunningEvent: "retries_exhausted" });
  });

  it.each(["unpaid", "canceled", "incomplete_expired"])(
    "customer.subscription.updated to %s → retries_exhausted",
    (status) => {
      expect(dunningFromStripeEvent(ev("customer.subscription.updated", { id: SUB_ID, status })))
        .toEqual({ subscriptionId: SUB_ID, dunningEvent: "retries_exhausted" });
    },
  );

  it("customer.subscription.updated to a non-terminal status → null", () => {
    expect(dunningFromStripeEvent(ev("customer.subscription.updated", { id: SUB_ID, status: "active" }))).toBeNull();
    expect(dunningFromStripeEvent(ev("customer.subscription.updated", { id: SUB_ID, status: "past_due" }))).toBeNull();
  });

  it("resolves the subscription id from the newer nested parent.subscription_details shape", () => {
    const nested = { parent: { subscription_details: { subscription: SUB_ID } }, next_payment_attempt: null };
    expect(dunningFromStripeEvent(ev("invoice.payment_failed", nested)))
      .toEqual({ subscriptionId: SUB_ID, dunningEvent: "retries_exhausted" });
  });

  it("an invoice with no subscription, and an unrelated event type, map to null", () => {
    expect(dunningFromStripeEvent(ev("invoice.payment_failed", { next_payment_attempt: 1 }))).toBeNull();
    expect(dunningFromStripeEvent(ev("payment_intent.succeeded", {}))).toBeNull();
  });
});

describe("dunning idempotency — a resent event applies + notifies at most once (REQ-065)", () => {
  it("applies the lapse and sends the emails once across two deliveries of the same event id", async () => {
    const first = await processWebhookEvent(lapseEvent("evt_dup"));
    expect(first).toEqual({ processed: true, action: "subscription.lapsed" });

    const second = await processWebhookEvent(lapseEvent("evt_dup"));
    expect(second).toEqual({ processed: false, action: "duplicate" });

    // Exactly one lapse update, one lapse audit, and one of each email across both deliveries.
    expect(queryMock.mock.calls.filter((c) => /update subscription_dunning/i.test(String(c[0])))).toHaveLength(1);
    expect(sendSubscriptionLapsedAdmin).toHaveBeenCalledOnce();
    expect(sendSubscriptionLapsedDonor).toHaveBeenCalledOnce();
  });
});
