import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-090 (REQ-065): BACS Direct Debit settles asynchronously, so a BACS gift is PENDING until
// Stripe confirms it. DB-free per CLAUDE.md: the pool + email client are mocked (same approach as
// stripe-webhook-declaration.test.ts). A checkout.session.completed with payment_status='unpaid'
// persists payment_status='pending' and claim_status='not_eligible' even with Gift Aid + a
// declaration; checkout.session.async_payment_succeeded flips it to 'paid' and re-derives
// claim_status; async_payment_failed sets 'failed' (permanently non-claimable). A resent event id
// is a no-op via the idempotency ledger.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(),
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

const DECL_ID = 55;
const DONOR_ID = 10;
const DONATION_ID = 99;
const SESSION_ID = "cs_test_bacs";

// A row the async SELECT (JOIN donations→donors by session id) returns: a gift-aided individual
// with a declaration, not refunded — so once paid it re-derives to 'eligible'.
let selectRow: Record<string, unknown> | undefined;
let claimed: Set<string>;

function installQuery() {
  claimed = new Set();
  selectRow = {
    id: DONATION_ID,
    gift_aid: true,
    declaration_id: DECL_ID,
    amount_pence: 5000,
    refunded_amount_pence: 0,
    donor_type: "individual",
  };
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] }; // redelivery
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into declarations/i.test(sql)) return { rows: [{ id: DECL_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/^\s*select[\s\S]*from donations/i.test(sql)) return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

// A gift-aided individual BACS session: payment_status 'unpaid' (mandate pending), declaration
// metadata stamped (so a declaration row is inserted), giftAid true.
const completedUnpaid = () =>
  ({
    id: "evt_bacs_completed",
    type: "checkout.session.completed",
    data: {
      object: {
        id: SESSION_ID,
        object: "checkout.session",
        amount_total: 5000,
        currency: "gbp",
        mode: "payment",
        payment_status: "unpaid",
        payment_intent: "pi_bacs",
        subscription: null,
        customer_details: { name: "Ada Lovelace", email: "ada@example.com" },
        metadata: {
          mode: "once",
          plan: "",
          giftAid: "true",
          donorType: "individual",
          declarationScope: "this_donation",
          giftAidWordingVersion: "hmrc-single-2024-01",
          giftAidWording: "I want to Gift Aid ...",
          declFirstName: "Ada",
          declLastName: "Lovelace",
          declHouseNameNumber: "12",
          declAddress: "Analytical Avenue, London",
          declPostcode: "SW1A 1AA",
          declNonUk: "false",
        },
      },
    },
  }) as unknown as import("stripe").Event;

const asyncEvent = (type: string, id: string) =>
  ({
    id,
    type,
    data: { object: { id: SESSION_ID, object: "checkout.session" } },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
});

describe("BACS checkout.session.completed (payment_status unpaid) — REQ-065", () => {
  it("persists payment_status='pending' and claim_status='not_eligible' even with Gift Aid + a declaration", async () => {
    const result = await processWebhookEvent(completedUnpaid());
    expect(result).toEqual({ processed: true, action: "donation.created" });

    // A declaration row IS inserted (gift-aided), but the pending payment blocks claimability.
    expect(sqls().some((s) => /insert into declarations/i.test(s))).toBe(true);
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBe(DECL_ID); // declaration_id linked
    expect(donationCall?.[1][6]).toBe(true); // gift_aid
    expect(donationCall?.[1][9]).toBe("not_eligible"); // claim_status — pending payment
    expect(donationCall?.[1][14]).toBe("pending"); // payment_status
  });
});

describe("checkout.session.async_payment_succeeded — REQ-065", () => {
  it("flips payment_status='paid' and re-derives claim_status to 'eligible'", async () => {
    const result = await processWebhookEvent(asyncEvent("checkout.session.async_payment_succeeded", "evt_ok"));
    expect(result.action).toBe("donation.payment_succeeded");

    const update = call(/update donations set payment_status/i);
    expect(update?.[1][0]).toBe("paid");
    expect(update?.[1][1]).toBe("eligible"); // individual + gift aid + declaration + not refunded
    expect(update?.[1][2]).toBe(DONATION_ID);
    // No new donation row.
    expect(sqls().some((s) => /insert into donations/i.test(s))).toBe(false);
  });

  it("does nothing when no donation matches the session id", async () => {
    selectRow = undefined;
    const result = await processWebhookEvent(asyncEvent("checkout.session.async_payment_succeeded", "evt_nomatch"));
    expect(result.action).toBe("ignored.no_donation");
    expect(sqls().some((s) => /update donations/i.test(s))).toBe(false);
  });
});

describe("checkout.session.async_payment_failed — REQ-065", () => {
  it("sets payment_status='failed' and keeps the donation permanently non-claimable", async () => {
    const result = await processWebhookEvent(asyncEvent("checkout.session.async_payment_failed", "evt_fail"));
    expect(result.action).toBe("donation.payment_failed");

    const update = call(/update donations set payment_status/i);
    expect(update?.[1][0]).toBe("failed");
    expect(update?.[1][1]).toBe("not_eligible"); // failed payment is never claimable
  });
});

describe("idempotency — REQ-065", () => {
  it("applies a resent async event id no second time", async () => {
    const first = await processWebhookEvent(asyncEvent("checkout.session.async_payment_succeeded", "evt_dup"));
    expect(first.processed).toBe(true);

    queryMock.mockClear();
    const second = await processWebhookEvent(asyncEvent("checkout.session.async_payment_succeeded", "evt_dup"));
    expect(second).toEqual({ processed: false, action: "duplicate" });
    // The redelivery does no state write.
    expect(sqls().some((s) => /update donations/i.test(s))).toBe(false);
  });
});
