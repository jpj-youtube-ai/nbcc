import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";

// TASK-075 (REQ-048): after a card_present donation with no Gift Aid is recorded, the
// processor sends EXACTLY ONE declaration email to the charge's receipt_email carrying a
// unique, token-addressed declaration link + a QR-encodable short link, then flips
// declaration_status to 'sent'. When the send throws, it flips to 'undelivered' instead —
// and in NEITHER case is the committed donation rolled back. DB-free: pool + email client
// are mocked (the mock-the-boundary approach), so no DB/network is touched.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, connect };
});
const { sendDeclarationEmail, sendDonationConfirmation } = vi.hoisted(() => ({
  sendDeclarationEmail: vi.fn(),
  sendDonationConfirmation: vi.fn(),
}));

// pool.query serves BOTH the in-transaction client.query and the post-commit status UPDATE.
vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));
vi.mock("../../src/clients/email", () => ({ sendDeclarationEmail, sendDonationConfirmation }));
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
    if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const cardPresentEvent = (over: Record<string, unknown> = {}) =>
  ({
    id: "evt_cp_email_1",
    type: "charge.succeeded",
    data: {
      object: {
        id: "ch_cp_1",
        object: "charge",
        amount: 5000,
        currency: "gbp",
        payment_intent: "pi_cp_1",
        receipt_email: "walkin@example.com",
        payment_method_details: { type: "card_present" },
        ...over,
      },
    },
  }) as unknown as Stripe.Event;

const call = (re: RegExp) => queryMock.mock.calls.find((c) => re.test(String(c[0])));
// The token written in the in-transaction UPDATE ... SET declaration_token = $1.
const writtenToken = (): string => String(call(/set declaration_status = 'pending', declaration_token/i)?.[1]?.[0]);
// The status written in the post-commit UPDATE ... SET declaration_status = $1 WHERE id = $2.
const writtenStatus = (): string => String(call(/set declaration_status = \$1 where id/i)?.[1]?.[0]);

beforeEach(() => {
  queryMock.mockReset();
  sendDeclarationEmail.mockReset();
  sendDonationConfirmation.mockReset();
  sendDeclarationEmail.mockResolvedValue(undefined);
  sendDonationConfirmation.mockResolvedValue(undefined);
  installQuery();
});

describe("in-person declaration email (TASK-075)", () => {
  it("sends exactly one email to receipt_email with a unique link + QR short link, and sets 'sent'", async () => {
    const result = await processWebhookEvent(cardPresentEvent());

    expect(result).toEqual({ processed: true, action: "donation.created" });

    // The donation write committed (not rolled back): donor + donation inserted, COMMIT ran.
    expect(call(/insert into donors/i)).toBeDefined();
    expect(call(/insert into donations/i)).toBeDefined();
    expect(queryMock.mock.calls.some((c) => /COMMIT/i.test(String(c[0])))).toBe(true);
    expect(queryMock.mock.calls.some((c) => /ROLLBACK/i.test(String(c[0])))).toBe(false);

    // Exactly one declaration email, to the charge's receipt_email, carrying BOTH links,
    // each built on the unique token stamped on the donation.
    expect(sendDeclarationEmail).toHaveBeenCalledOnce();
    const msg = sendDeclarationEmail.mock.calls[0][0];
    const token = writtenToken();
    expect(token.length).toBeGreaterThan(0);
    expect(msg.email).toBe("walkin@example.com");
    expect(msg.declarationLink).toBe(`https://nbcc.test/gift-aid/declare?token=${token}`);
    expect(msg.shortLink).toBe(`https://nbcc.test/g/${token}`);

    // declaration_status flipped to 'sent' post-commit.
    expect(writtenStatus()).toBe("sent");
  });

  it("sets declaration_status='undelivered' when the send throws, WITHOUT rolling back the donation", async () => {
    sendDeclarationEmail.mockRejectedValueOnce(new Error("provider down"));

    const result = await processWebhookEvent(cardPresentEvent());

    // The webhook still succeeds and the donation is still committed (no rollback).
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(call(/insert into donations/i)).toBeDefined();
    expect(queryMock.mock.calls.some((c) => /COMMIT/i.test(String(c[0])))).toBe(true);
    expect(queryMock.mock.calls.some((c) => /ROLLBACK/i.test(String(c[0])))).toBe(false);

    expect(sendDeclarationEmail).toHaveBeenCalledOnce();
    expect(writtenStatus()).toBe("undelivered");
  });

  it("sends no declaration email when the charge carried no receipt_email (stays pending)", async () => {
    await processWebhookEvent(cardPresentEvent({ receipt_email: null }));

    expect(sendDeclarationEmail).not.toHaveBeenCalled();
    // No post-commit status UPDATE — the donation stays 'pending' (still token-stamped).
    expect(call(/set declaration_status = \$1 where id/i)).toBeUndefined();
    expect(call(/set declaration_status = 'pending', declaration_token/i)).toBeDefined();
  });
});
