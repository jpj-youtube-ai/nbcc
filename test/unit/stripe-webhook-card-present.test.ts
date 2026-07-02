import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// TASK-073 (REQ-054): the processor's charge.succeeded branch ingests a Stripe Terminal /
// card_present charge as an in-person walk-in donation. Proven DB-free by mocking the pool
// (the mock-the-boundary approach of stripe-webhook-declaration.test.ts): assert the query
// sequence — a card_present charge inserts donor + donation + a donation.created audit row
// in one transaction; a non-card-present ('card', already captured at checkout) inserts
// nothing. The true DB-backed idempotency path is exercised by features/stripe-webhook.feature.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));
// The processor sends post-commit confirmation + declaration emails; mock the client.
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
}));
// The processor reads config directly (DECLARATION_FORM_BASE_URL); mock config so the real
// one never validates process.env and exits.
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

const DONOR_ID = 21;
const DONATION_ID = 88;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] }; // claimed
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]));
const call = (re: RegExp) => queryMock.mock.calls.find((c) => re.test(String(c[0])));

const chargeEvent = (type: string) =>
  ({
    id: "evt_cp_1",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_cp_1",
        object: "charge",
        amount: 5000,
        currency: "gbp",
        payment_intent: "pi_cp_1",
        payment_method_details: { type },
      },
    },
  }) as unknown as Stripe.Event;

beforeEach(() => {
  queryMock.mockReset();
  connect.mockClear();
  installQuery();
});

describe("processWebhookEvent — charge.succeeded (card_present, REQ-054)", () => {
  it("books a walk-in donor + in-person donation + donation.created audit in one transaction", async () => {
    const result = await processWebhookEvent(chargeEvent("card_present"));

    expect(result).toEqual({ processed: true, action: "donation.created" });
    // One transaction that inserts donor, donation, and the audit row.
    expect(sqls().some((s) => /BEGIN/i.test(s))).toBe(true);
    expect(sqls().some((s) => /COMMIT/i.test(s))).toBe(true);
    expect(call(/insert into donors/i)).toBeDefined();

    const donationInsert = call(/insert into donations/i);
    expect(donationInsert).toBeDefined();
    // payment_channel is the 8th donations column (index 7 in the params array).
    expect(donationInsert?.[1]).toContain("in_person");

    const auditInsert = call(/insert into audit_log/i);
    expect(auditInsert?.[1]).toContain("donation.created");
    expect(auditInsert?.[1]).toContain("donation");
  });

  it("ignores a non-card-present ('card') charge — never double-mapping an online gift", async () => {
    const result = await processWebhookEvent(chargeEvent("card"));

    expect(result).toEqual({ processed: true, action: "ignored.not_card_present" });
    // The event id is still claimed, but NO donor/donation/audit rows are written.
    expect(call(/insert into donors/i)).toBeUndefined();
    expect(call(/insert into donations/i)).toBeUndefined();
    expect(call(/insert into audit_log/i)).toBeUndefined();
  });

  it("treats a redelivered event id as a no-op (idempotent)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 0, rows: [] }; // duplicate
      return { rows: [], rowCount: 0 };
    });

    const result = await processWebhookEvent(chargeEvent("card_present"));

    expect(result).toEqual({ processed: false, action: "duplicate" });
    expect(call(/insert into donors/i)).toBeUndefined();
    expect(call(/insert into donations/i)).toBeUndefined();
  });
});
