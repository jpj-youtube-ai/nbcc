import { describe, it, expect, vi, beforeEach } from "vitest";

// Sponsor pledges: Stripe's checkout.session.completed for a pledge's pay link. The ONE webhook
// records the donation with its Gift Aid declaration and links it to the fundraiser, as for any gift
// on the page, and in the SAME transaction marks the pledge paid with that donation and declaration.
// A second payment for the same pledge is still a donation, but carries no Gift Aid and is flagged
// for staff; an error marking the pledge never loses the donation; and a session with no pledge on
// it is processed exactly as before. The pool and the emails are mocked. Every name is invented.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));
const { sendDonationConfirmation, sendDoublePaidAlerts } = vi.hoisted(() => ({ sendDonationConfirmation: vi.fn(), sendDoublePaidAlerts: vi.fn() }));
vi.mock("../../src/clients/email", () => ({ sendDonationConfirmation, sendCompanyReceipt: vi.fn(), sendDeclarationEmail: vi.fn() }));
vi.mock("../../src/pledges/runner", () => ({ sendDoublePaidAlerts }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test", DECLARATION_FORM_BASE_URL: "https://nbcc.test" },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";
import { pledgeDeclarationWording } from "../../src/pledges/model";

const DONOR_ID = 10;
const DECLARATION_ID = 31;
const DONATION_ID = 99;
const wording = pledgeDeclarationWording(1000);

// What the pledge's row says when the webhook looks: its status, or null for a pledge that is gone.
function installQuery(status: string | null = "open", breakSettle = false) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback|savepoint|release)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into declarations/i.test(sql)) return { rows: [{ id: DECLARATION_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/select id, status from fundraisers/i.test(sql)) return { rows: [{ id: 7, status: "finished" }], rowCount: 1 };
    if (/select status[\s\S]*from sponsor_pledges/i.test(sql)) {
      if (breakSettle && /fundraiser_id/i.test(sql)) throw new Error("boom");
      return {
        rows: status
          ? [{ status, fundraiser_id: 7, gift_aid: true, ga_declared_at: new Date("2026-11-01T10:00:00Z"), ga_wording_version: wording.wording_version, ga_wording_snapshot: wording.wording_snapshot }]
          : [],
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const auditOf = (action: string): any[] | undefined => queryMock.mock.calls.find((c) => /insert into audit_log/i.test(String(c[0])) && c[1][1] === action);
const order = (re: RegExp) => queryMock.mock.calls.findIndex((c) => re.test(String(c[0])));

const pledgeMetadata = (): Record<string, string> => ({
  mode: "once",
  plan: "",
  giftAid: "true",
  feeCoverPence: "0",
  donorType: "individual",
  fullName: "Alex Example",
  email: "alex@example.com",
  emailConsent: "false",
  anonymous: "false",
  fundraiserId: "7",
  supporterMessage: "Go on Robin!",
  showName: "true",
  showAmount: "true",
  declarationScope: "this_donation",
  giftAidWordingVersion: wording.wording_version,
  giftAidWording: wording.wording_snapshot,
  declFirstName: "Alex",
  declLastName: "Example",
  declHouseNameNumber: "12",
  declAddress: "Example Street, Exampleton",
  declPostcode: "KA1 1AA",
  declNonUk: "false",
  pledgeId: "5",
  pledgeDeclaredAt: "2026-11-01T10:00:00.000Z",
});

const event = (metadata: Record<string, string>, id = "evt_pledge_1") =>
  ({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_pledge",
        object: "checkout.session",
        amount_total: 1000,
        currency: "gbp",
        mode: "payment",
        created: 1_796_500_000,
        payment_status: "paid",
        payment_intent: "pi_test_pledge",
        subscription: null,
        customer_details: { name: "Alex Example", email: "alex@example.com" },
        metadata,
      },
    },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  sendDonationConfirmation.mockReset().mockResolvedValue(undefined);
  sendDoublePaidAlerts.mockReset().mockResolvedValue(undefined);
  installQuery();
});

describe("a pledge paid through its pay link", () => {
  it("records the donation with the Gift Aid declaration made with the pledge, word for word", async () => {
    const result = await processWebhookEvent(event(pledgeMetadata()));
    expect(result.action).toBe("donation.created");
    const declaration = call(/insert into declarations/i)!;
    expect(declaration[1]).toContain(wording.wording_version);
    expect(declaration[1]).toContain(wording.wording_snapshot);
    expect(declaration[1]).toContain("KA1 1AA");
    const donation = call(/insert into donations/i)!;
    expect(donation[1]).toContain(DECLARATION_ID);
    expect(donation[1]).toContain(1000);
    // Gift aided and claimable now it is paid.
    expect(donation[1]).toContain("eligible");
  });

  it("links the donation to the fundraiser, so the meter and the wall have it", async () => {
    await processWebhookEvent(event(pledgeMetadata()));
    const link = call(/update donations set fundraiser_id/i)!;
    expect(link[1]).toEqual([7, "Go on Robin!", true, true, DONATION_ID]);
  });

  it("marks the pledge paid with that donation and declaration, inside the same transaction", async () => {
    await processWebhookEvent(event(pledgeMetadata()));
    const settle = call(/update sponsor_pledges set status = 'paid'/i)!;
    expect(settle[1]).toEqual([5, 1000, DONATION_ID, DECLARATION_ID]);
    expect(order(/update sponsor_pledges set status = 'paid'/i)).toBeGreaterThan(order(/insert into donations/i));
    expect(order(/update sponsor_pledges set status = 'paid'/i)).toBeLessThan(order(/^\s*commit/i));
    expect(auditOf("pledge.paid")![1][4]).toMatchObject({ donationId: DONATION_ID, declarationId: DECLARATION_ID, fundraiserId: 7, giftAidDeclaredAt: "2026-11-01T10:00:00.000Z" });
  });

  it("keeps when the declaration was made beside the donation, where deleting the pledge cannot reach it", async () => {
    await processWebhookEvent(event(pledgeMetadata()));
    const kept = call(/insert into sponsor_pledge_declarations/i)!;
    expect(kept[1]).toEqual([5, DONATION_ID, DECLARATION_ID, "2026-11-01T10:00:00.000Z", wording.wording_version, wording.wording_snapshot]);
  });

  it("sends the receipt as for any gift", async () => {
    await processWebhookEvent(event(pledgeMetadata()));
    expect(sendDonationConfirmation).toHaveBeenCalledTimes(1);
    expect(sendDonationConfirmation.mock.calls[0][0]).toMatchObject({ email: "alex@example.com" });
  });

  it("without Gift Aid, writes no declaration, and still marks the pledge paid", async () => {
    const rest = { ...pledgeMetadata(), giftAid: "false" };
    for (const key of ["giftAidWording", "giftAidWordingVersion", "declFirstName", "pledgeDeclaredAt"]) delete rest[key];
    await processWebhookEvent(event(rest, "evt_pledge_2"));
    expect(call(/insert into declarations/i)).toBeUndefined();
    expect(call(/update sponsor_pledges set status = 'paid'/i)![1]).toEqual([5, 1000, DONATION_ID, null]);
    expect(call(/insert into sponsor_pledge_declarations/i)).toBeUndefined();
  });
});

describe("a second payment for a pledge already paid", () => {
  beforeEach(() => installQuery("paid"));

  it("is still recorded as a donation on the page", async () => {
    await processWebhookEvent(event(pledgeMetadata(), "evt_pledge_3"));
    expect(call(/insert into donations/i)).toBeDefined();
    expect(call(/update donations set fundraiser_id/i)).toBeDefined();
  });

  it("writes NO second declaration: one declaration covers one donation", async () => {
    await processWebhookEvent(event(pledgeMetadata(), "evt_pledge_3"));
    expect(call(/insert into declarations/i)).toBeUndefined();
    expect(call(/insert into sponsor_pledge_declarations/i)).toBeUndefined();
    expect(call(/insert into donations/i)![1]).not.toContain("eligible");
  });

  it("is flagged for staff to check and refund, and the events inbox is told after commit", async () => {
    await processWebhookEvent(event(pledgeMetadata(), "evt_pledge_3"));
    expect(call(/update sponsor_pledges set double_paid_at = now\(\)/i)![1]).toEqual([5, DONATION_ID]);
    expect(auditOf("pledge.paid_again")).toBeDefined();
    expect(auditOf("pledge.paid")).toBeUndefined();
    expect(call(/update sponsor_pledges set status = 'paid'/i)).toBeUndefined();
    expect(sendDoublePaidAlerts).toHaveBeenCalledTimes(1);
  });
});

describe("when marking the pledge goes wrong", () => {
  it("keeps the donation: the pledge's part is rolled back alone, and the rest commits", async () => {
    installQuery("open", true);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await processWebhookEvent(event(pledgeMetadata(), "evt_pledge_4"));
    expect(result.action).toBe("donation.created");
    expect(call(/insert into donations/i)).toBeDefined();
    expect(call(/rollback to savepoint sponsor_pledge$/i)).toBeDefined();
    expect(call(/^\s*commit/i)).toBeDefined();
    expect(call(/^\s*rollback$/i)).toBeUndefined();
  });

  it("a payment for a pledge that is gone says so, not that it was paid again", async () => {
    installQuery(null);
    await processWebhookEvent(event(pledgeMetadata(), "evt_pledge_5"));
    expect(auditOf("pledge.paid_missing")).toBeDefined();
    expect(auditOf("pledge.paid_again")).toBeUndefined();
    // The declaration date still survives, from what the checkout stamped.
    expect(call(/insert into sponsor_pledge_declarations/i)![1]).toEqual([5, DONATION_ID, DECLARATION_ID, "2026-11-01T10:00:00.000Z", null, null]);
  });
});

describe("every other gift", () => {
  it("never touches a pledge", async () => {
    const gift = pledgeMetadata();
    for (const key of ["pledgeId", "pledgeDeclaredAt"]) delete gift[key];
    await processWebhookEvent(event(gift, "evt_gift_1"));
    expect(call(/sponsor_pledge/i)).toBeUndefined();
    expect(call(/insert into donations/i)).toBeDefined();
    expect(sendDoublePaidAlerts).not.toHaveBeenCalled();
  });
});
