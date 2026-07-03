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
