import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-095 (REQ-063): refund/dispute webhook handling. A charge.refunded / charge.dispute.* event
// recomputes the donation's claim state via the pure recalculateClaimOnRefund (TASK-093): a
// not-yet-claimed gift re-derives claim_status from the retained amount; an already-claimed gift
// flags 'adjustment_due' + inserts a claim_adjustments row; a company gift leaves claim_status
// untouched and sends a void/correction receipt notice. DB-free per CLAUDE.md: pool + email +
// config mocked. A resent event id is a no-op via the idempotency ledger.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

const { sendCompanyReceipt, sendDonationConfirmation, sendDeclarationEmail, sendSubscriptionLapsedDonor, sendSubscriptionLapsedAdmin } =
  vi.hoisted(() => ({
    sendCompanyReceipt: vi.fn(),
    sendDonationConfirmation: vi.fn(),
    sendDeclarationEmail: vi.fn(),
    sendSubscriptionLapsedDonor: vi.fn(),
    sendSubscriptionLapsedAdmin: vi.fn(),
  }));
vi.mock("../../src/clients/email", () => ({
  sendCompanyReceipt,
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
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

const DONATION_ID = 99;
const ADJ_ID = 77;

// The donation the refund SELECT returns — mutated per test.
let target: Record<string, unknown> | undefined;
let claimed: Set<string>;

function installQuery() {
  claimed = new Set();
  queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) {
      const id = String(params?.[0]);
      if (claimed.has(id)) return { rowCount: 0, rows: [] };
      claimed.add(id);
      return { rowCount: 1, rows: [] };
    }
    if (/^\s*select[\s\S]*from donations[\s\S]*join\s+donors/i.test(sql)) {
      return { rows: target ? [target] : [], rowCount: target ? 1 : 0 };
    }
    if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into claim_adjustments/i.test(sql)) return { rows: [{ id: ADJ_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));
const has = (re: RegExp): boolean => sqls().some((s) => re.test(s));

const individual = (overrides: Record<string, unknown> = {}) => ({
  id: DONATION_ID,
  gift_aid: true,
  declaration_id: 55,
  amount_pence: 5000,
  currency: "GBP",
  created_at: new Date("2025-12-24T00:00:00Z"),
  claim_status: "eligible",
  claim_batch_id: null,
  donor_type: "individual",
  business_name: null,
  email: null,
  ...overrides,
});

const refundEvent = (amountRefunded: number, id = "evt_refund") =>
  ({
    id,
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_x",
        object: "charge",
        payment_intent: "pi_x",
        amount: 5000,
        amount_refunded: amountRefunded,
      },
    },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  sendCompanyReceipt.mockReset();
  sendCompanyReceipt.mockResolvedValue(undefined);
  target = individual();
  installQuery();
});

describe("charge.refunded — not-yet-claimed individual (REQ-063)", () => {
  it("updates refunded_amount_pence and re-derives claim_status in one transaction (full refund → not_eligible)", async () => {
    const result = await processWebhookEvent(refundEvent(5000));
    expect(result).toEqual({ processed: true, action: "donation.refunded" });

    const update = call(/update donations/i);
    expect(update?.[1][0]).toBe(5000); // refunded_amount_pence
    expect(update?.[1][1]).toBe("not_eligible"); // claim_status re-derived from retained (0)
    expect(update?.[1][2]).toBe(DONATION_ID);

    // No adjustment for a not-yet-claimed gift.
    expect(has(/insert into claim_adjustments/i)).toBe(false);
    const seq = sqls();
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);
  });

  it("keeps a partial refund eligible (re-derived from the retained amount)", async () => {
    const result = await processWebhookEvent(refundEvent(2000));
    expect(result.processed).toBe(true);
    expect(call(/update donations/i)?.[1][1]).toBe("eligible");
    expect(has(/insert into claim_adjustments/i)).toBe(false);
  });
});

describe("charge.refunded — already-batched donation (REQ-063)", () => {
  it("sets claim_status='adjustment_due' and inserts a claim_adjustments row tied to its claim batch, same tx", async () => {
    target = individual({ claim_status: "batched", claim_batch_id: 7 });
    const result = await processWebhookEvent(refundEvent(5000));
    expect(result.processed).toBe(true);

    expect(call(/update donations/i)?.[1][1]).toBe("adjustment_due");

    const adj = call(/insert into claim_adjustments/i);
    expect(adj).toBeTruthy();
    expect(adj?.[1][0]).toBe(DONATION_ID); // donation_id
    expect(adj?.[1][1]).toBe(7); // claim_batch_id
    expect(adj?.[1][2]).toBe(5000); // adjustment_pence = refunded portion of the claimed amount

    // The adjustment insert lands BEFORE COMMIT.
    const seq = sqls();
    const adjIdx = seq.findIndex((s) => /insert into claim_adjustments/i.test(s));
    const commitIdx = seq.findIndex((s) => /^commit/i.test(s));
    expect(adjIdx).toBeGreaterThan(-1);
    expect(adjIdx).toBeLessThan(commitIdx);
    expect(sendCompanyReceipt).not.toHaveBeenCalled();
  });
});

describe("charge.refunded — company donation (REQ-053)", () => {
  beforeEach(() => {
    target = individual({
      donor_type: "company",
      gift_aid: false,
      declaration_id: null,
      amount_pence: 100000,
      claim_status: "not_eligible",
      business_name: "Acme Ltd",
      email: "finance@acme.test",
    });
  });

  it("sends a void/correction receipt notice and leaves claim_status unchanged", async () => {
    const result = await processWebhookEvent(refundEventOfAmount(100000, 100000));
    expect(result.processed).toBe(true);

    // claim_status untouched (companies never claim).
    expect(call(/update donations/i)?.[1][1]).toBe("not_eligible");
    // The refund notice is sent post-commit to the billing contact.
    expect(sendCompanyReceipt).toHaveBeenCalledOnce();
    const msg = sendCompanyReceipt.mock.calls[0][0];
    expect(msg.email).toBe("finance@acme.test");
    expect(msg.text.toUpperCase()).toContain("VOID");
    // No adjustment for a company (never claimed).
    expect(has(/insert into claim_adjustments/i)).toBe(false);
  });

  it("sends a 'correct' notice on a partial company refund", async () => {
    await processWebhookEvent(refundEventOfAmount(100000, 40000));
    expect(sendCompanyReceipt).toHaveBeenCalledOnce();
    expect(sendCompanyReceipt.mock.calls[0][0].text.toUpperCase()).toContain("CORRECT");
  });
});

describe("refund idempotency (REQ-063)", () => {
  it("applies a resent event id no second time", async () => {
    const first = await processWebhookEvent(refundEvent(5000, "evt_dup"));
    expect(first.processed).toBe(true);

    queryMock.mockClear();
    const second = await processWebhookEvent(refundEvent(5000, "evt_dup"));
    expect(second).toEqual({ processed: false, action: "duplicate" });
    expect(has(/update donations/i)).toBe(false);
  });
});

// A charge.refunded event with an explicit charge amount (for the company case where amount is £1000).
function refundEventOfAmount(amount: number, amountRefunded: number, id = "evt_refund_co") {
  return {
    id,
    type: "charge.refunded",
    data: {
      object: { id: "ch_x", object: "charge", payment_intent: "pi_x", amount, amount_refunded: amountRefunded },
    },
  } as unknown as import("stripe").Event;
}
