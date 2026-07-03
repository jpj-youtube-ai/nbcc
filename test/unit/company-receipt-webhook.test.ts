import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-088 (REQ-053): processing a checkout.session.completed webhook for a COMPANY donation
// sends a Corporation Tax receipt (no consideration given) OR flags the gift for the trustees
// (consideration given) — never both. DB-free per CLAUDE.md: the pool and email client are
// mocked (same mock-the-boundary approach as stripe-webhook-declaration.test.ts). The donation
// persists non-claimable (donor_type='company') with no declaration either way; the receipt is
// sent AFTER commit (best-effort), while the trustee flag is an audit row INSIDE the transaction.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

const { sendCompanyReceipt, sendDonationConfirmation, sendDeclarationEmail } = vi.hoisted(() => ({
  sendCompanyReceipt: vi.fn(),
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
}));
vi.mock("../../src/clients/email", () => ({
  sendCompanyReceipt,
  sendDonationConfirmation,
  sendDeclarationEmail,
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

const DONOR_ID = 10;
const DONATION_ID = 99;

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

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

const companySession = (considerationGiven: boolean) =>
  ({
    id: "cs_test_company",
    object: "checkout.session",
    amount_total: 100000,
    currency: "gbp",
    mode: "payment",
    created: 1_766_620_800, // 2025-12-25T00:00:00Z
    payment_intent: "pi_test_company",
    subscription: null,
    customer_details: { name: "Card Holder", email: null },
    metadata: {
      mode: "once",
      plan: "",
      giftAid: "false",
      donorType: "company",
      businessName: "Acme Ltd",
      companyLegalName: "Acme Ltd",
      companyRegistrationNumber: "SC123456",
      companyContactName: "Ada Lovelace",
      companyContactEmail: "finance@acme.test",
      companyBillingAddress: "1 Office Park, London",
      companyBillingPostcode: "SW1A 1AA",
      companyConsiderationGiven: String(considerationGiven),
    },
  }) as unknown as import("stripe").Checkout.Session;

const event = (considerationGiven: boolean) =>
  ({
    id: `evt_company_${considerationGiven}`,
    type: "checkout.session.completed",
    data: { object: companySession(considerationGiven) },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  sendCompanyReceipt.mockReset();
  sendCompanyReceipt.mockResolvedValue(undefined);
  installQuery();
});

describe("company webhook — no consideration given → Corporation Tax receipt (REQ-053)", () => {
  it("sends the receipt to the contact email and persists a not-eligible donation with no declaration", async () => {
    const result = await processWebhookEvent(event(false));
    expect(result).toEqual({ processed: true, action: "donation.created" });

    // The receipt email is sent to the company's billing contact, with the verbatim content.
    expect(sendCompanyReceipt).toHaveBeenCalledOnce();
    const msg = sendCompanyReceipt.mock.calls[0][0];
    expect(msg.email).toBe("finance@acme.test");
    expect(msg.text).toContain("NBCC");
    expect(msg.text).toContain("SC047995");
    expect(msg.text).toContain("nothing of value in return");
    expect(msg.text).toContain("25/12/2025"); // the session date

    // The donation persists non-claimable with no declaration (as before).
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBeNull(); // declaration_id
    expect(donationCall?.[1][9]).toBe("not_eligible"); // claim_status
    expect(sqls().some((s) => /insert into declarations/i.test(s))).toBe(false);

    // No trustee flag for a clean gift.
    const audits = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits.some((c) => c[1][1] === "donation.flagged_for_trustees")).toBe(false);
  });
});

describe("company webhook — consideration given → flagged for trustees, no receipt (REQ-053)", () => {
  it("appends a donation.flagged_for_trustees audit row in the same transaction and sends NO receipt", async () => {
    const result = await processWebhookEvent(event(true));
    expect(result).toEqual({ processed: true, action: "donation.created" });

    // No receipt email.
    expect(sendCompanyReceipt).not.toHaveBeenCalled();

    // The trustee-flag audit row is written BEFORE COMMIT (inside the transaction).
    const seq = sqls();
    const flagIdx = queryMock.mock.calls.findIndex(
      (c) => /insert into audit_log/i.test(String(c[0])) && c[1][1] === "donation.flagged_for_trustees",
    );
    expect(flagIdx).toBeGreaterThan(-1);
    const flagCall = queryMock.mock.calls[flagIdx];
    expect(flagCall[1][3]).toBe(DONATION_ID); // entity_id = donation id
    const commitIdx = seq.findIndex((s) => /^commit/i.test(s));
    const flagSqlIdx = seq.findIndex(
      (s, i) => /insert into audit_log/i.test(s) && queryMock.mock.calls[i][1][1] === "donation.flagged_for_trustees",
    );
    expect(flagSqlIdx).toBeLessThan(commitIdx);

    // The donation still persists non-claimable with no declaration.
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBeNull(); // declaration_id
    expect(donationCall?.[1][9]).toBe("not_eligible"); // claim_status
    expect(seq.some((s) => /insert into declarations/i.test(s))).toBe(false);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
  });
});
