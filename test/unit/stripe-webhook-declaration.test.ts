import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-063 (REQ-043): processing a checkout.session.completed webhook with a Gift Aid
// declaration. Proven DB-free by mocking the pool (the same mock-the-boundary approach
// as test/unit/donations-batch.test.ts): on a gift-aided individual session, the
// processor inserts a declarations row from the stamped metadata, then inserts the
// donation with declaration_id referencing it — all between one BEGIN…COMMIT, so the
// declaration + donation commit together. Asserting the query SEQUENCE + params proves
// the FK wiring and the single transaction without a real DB.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));
// The processor sends post-commit confirmation + declaration emails (TASK-070/075); mock
// the client so importing it never hits the network.
vi.mock("../../src/clients/email", () => ({
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
}));
// The processor reads config directly (DECLARATION_FORM_BASE_URL, TASK-075); mock config so
// the real one never validates process.env and exits.
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

const DECL_ID = 55;
const SHARE_ID = 77;
const DONOR_ID = 10;
const DONATION_ID = 99;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] }; // claimed (not a duplicate)
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into declarations/i.test(sql)) return { rows: [{ id: DECL_ID }], rowCount: 1 };
    if (/insert into donation_partner_shares/i.test(sql)) return { rows: [{ id: SHARE_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));
const idx = (re: RegExp): number => sqls().findIndex((s) => re.test(s));

// A gift-aided individual checkout session carrying the declaration metadata the
// REQ-063 checkout endpoint stamps.
const session = () =>
  ({
    id: "cs_test_decl",
    object: "checkout.session",
    amount_total: 5000,
    currency: "gbp",
    mode: "payment",
    payment_intent: "pi_test_decl",
    subscription: null,
    customer_details: { name: "Ada Lovelace", email: "ada@example.com" },
    metadata: {
      mode: "once",
      plan: "",
      giftAid: "true",
      donorType: "individual",
      declarationScope: "this_donation",
      giftAidWordingVersion: "hmrc-single-2024-01",
      giftAidWording: "I want to Gift Aid my donation. I am a UK taxpayer ...",
      declTitle: "Dr",
      declFirstName: "Ada",
      declLastName: "Lovelace",
      declHouseNameNumber: "12",
      declAddress: "Analytical Avenue, London",
      declPostcode: "SW1A 1AA",
      declNonUk: "false",
    },
  }) as unknown as import("stripe").Checkout.Session;

const event = () =>
  ({
    id: "evt_decl_1",
    type: "checkout.session.completed",
    data: { object: session() },
  }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
});

describe("processWebhookEvent — checkout.session.completed with a Gift Aid declaration (REQ-043)", () => {
  it("inserts a declarations row from the metadata and links the donation's declaration_id, in one transaction", async () => {
    const result = await processWebhookEvent(event());
    expect(result).toEqual({ processed: true, action: "donation.created" });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);

    // A declarations row is built from the captured fields.
    const declCall = call(/insert into declarations/i);
    expect(declCall).toBeTruthy();
    expect(declCall?.[1]).toEqual([
      DONOR_ID, // donor_id
      "Dr", // title
      "Ada", // first_name
      "Lovelace", // last_name
      "12", // house_name_number
      "Analytical Avenue, London", // address
      "SW1A 1AA", // postcode
      false, // non_uk
      "this_donation", // scope
      "hmrc-single-2024-01", // wording_version
      "I want to Gift Aid my donation. I am a UK taxpayer ...", // wording_snapshot
      true, // confirmed_taxpayer
    ]);

    // The donation references that declaration and is therefore claimable (eligible).
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBe(DECL_ID); // declaration_id (2nd param)
    expect(donationCall?.[1][6]).toBe(true); // gift_aid (7th param)
    expect(donationCall?.[1][7]).toBe(false); // gasds_eligible (8th param — a Gift Aid gift is never GASDS)
    expect(donationCall?.[1][9]).toBe("eligible"); // claim_status (10th param)

    // Ordering inside the one transaction: donor → declaration → donation, all committed.
    const declIdx = idx(/insert into declarations/i);
    const donationIdx = idx(/insert into donations/i);
    const donorIdx = idx(/insert into donors/i);
    const commitIdx = idx(/^commit/i);
    expect(donorIdx).toBeGreaterThan(0);
    expect(declIdx).toBeGreaterThan(donorIdx);
    expect(donationIdx).toBeGreaterThan(declIdx);
    expect(commitIdx).toBeGreaterThan(donationIdx);
  });

  it("persists the donor-overridden scope='all_donations' from metadata (REQ-044 / TASK-065)", async () => {
    const overridden = event();
    // The checkout endpoint stamps the donor's explicit choice on a one-off gift, overriding
    // the once→this_donation default (metadata.declarationScope='all_donations').
    (overridden.data.object as unknown as { metadata: Record<string, string> }).metadata.declarationScope =
      "all_donations";
    await processWebhookEvent(overridden);
    const declCall = call(/insert into declarations/i);
    expect(declCall?.[1][8]).toBe("all_donations"); // scope (9th param)
  });

  it("audits the declaration inside the same transaction", async () => {
    await processWebhookEvent(event());
    const auditCalls = queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    const actions = auditCalls.map((c) => c[1][1]); // the `action` param
    expect(actions).toContain("declaration.created");
    expect(actions).toContain("donation.created");
  });
});

// A gift-aided PARTNERSHIP checkout session (REQ-051 / TASK-081): the checkout endpoint stamps
// a `partners` JSON array (one declaration + share per partner) INSTEAD of a single decl* set,
// so the webhook inserts one declarations row + one donation_partner_shares row per partner
// alongside the donation, all in the one BEGIN…COMMIT.
const partner = (firstName: string, sharePence: number) => ({
  title: "",
  firstName,
  lastName: "Partner",
  houseNameNumber: "1",
  address: "Partnership House, London",
  postcode: "SW1A 1AA",
  nonUk: false,
  sharePence,
});

const partnershipSession = () =>
  ({
    id: "cs_test_partners",
    object: "checkout.session",
    amount_total: 10000,
    currency: "gbp",
    mode: "payment",
    payment_intent: "pi_test_partners",
    subscription: null,
    customer_details: { name: "Acme Partnership", email: null },
    metadata: {
      mode: "once",
      plan: "",
      giftAid: "true",
      donorType: "partnership",
      declarationScope: "this_donation",
      giftAidWordingVersion: "hmrc-single-2024-01",
      giftAidWording: "I want to Gift Aid my donation. I am a UK taxpayer ...",
      partners: JSON.stringify([partner("Ada", 6000), partner("Grace", 4000)]),
    },
  }) as unknown as import("stripe").Checkout.Session;

const partnershipEvent = () =>
  ({
    id: "evt_partners_1",
    type: "checkout.session.completed",
    data: { object: partnershipSession() },
  }) as unknown as import("stripe").Event;

describe("processWebhookEvent — partnership checkout.session.completed (REQ-051 / TASK-081)", () => {
  it("inserts one declarations row and one donation_partner_shares row per partner alongside the donation, in one transaction", async () => {
    const result = await processWebhookEvent(partnershipEvent());
    expect(result).toEqual({ processed: true, action: "donation.created" });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);

    // Two partners → two declarations rows + two donation_partner_shares rows.
    const declInserts = queryMock.mock.calls.filter((c) => /insert into declarations/i.test(String(c[0])));
    const shareInserts = queryMock.mock.calls.filter((c) =>
      /insert into donation_partner_shares/i.test(String(c[0])),
    );
    expect(declInserts).toHaveLength(2);
    expect(shareInserts).toHaveLength(2);

    // Each partner-share row references the donation + the just-inserted declaration + the share.
    expect(shareInserts[0][1]).toEqual([DONATION_ID, DECL_ID, 6000]);
    expect(shareInserts[1][1]).toEqual([DONATION_ID, DECL_ID, 4000]);

    // The donation itself carries NO single declaration_id (the shares hold the declarations)
    // but is still a gift-aided gift.
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBeNull(); // declaration_id (2nd param)
    expect(donationCall?.[1][6]).toBe(true); // gift_aid (7th param)

    // Ordering: donor → donation → (declaration → partner share) per partner, all committed.
    const donorIdx = idx(/insert into donors/i);
    const donationIdx = idx(/insert into donations/i);
    const firstDeclIdx = idx(/insert into declarations/i);
    const firstShareIdx = idx(/insert into donation_partner_shares/i);
    expect(donationIdx).toBeGreaterThan(donorIdx);
    expect(firstDeclIdx).toBeGreaterThan(donationIdx);
    expect(firstShareIdx).toBeGreaterThan(firstDeclIdx);
  });

  it("rolls back the declarations + partner-share rows together with the donation when the transaction throws", async () => {
    // Force the SECOND partner-share insert to throw, mid-transaction.
    let shareInserts = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
      if (/insert into declarations/i.test(sql)) return { rows: [{ id: DECL_ID }], rowCount: 1 };
      if (/insert into donation_partner_shares/i.test(sql)) {
        shareInserts += 1;
        if (shareInserts === 2) throw new Error("insert failed");
        return { rows: [{ id: SHARE_ID }], rowCount: 1 };
      }
      if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 0 };
    });

    await expect(processWebhookEvent(partnershipEvent())).rejects.toThrow("insert failed");

    const seq = sqls();
    expect(seq.some((s) => /rollback/i.test(s))).toBe(true);
    expect(seq.some((s) => /^commit/i.test(s))).toBe(false);
  });
});

// A COMPANY checkout session (REQ-038 / TASK-085): the checkout endpoint stamps the validated
// company* fields on metadata; the webhook maps them onto the donor row (business_name /
// company_number / full_name / email / billing_address / billing_postcode) and persists a
// not-eligible donation with NO declaration.
const companySession = () =>
  ({
    id: "cs_test_company",
    object: "checkout.session",
    amount_total: 5000,
    currency: "gbp",
    mode: "payment",
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
      companyConsiderationGiven: "false",
    },
  }) as unknown as import("stripe").Checkout.Session;

const companyEvent = () =>
  ({
    id: "evt_company_1",
    type: "checkout.session.completed",
    data: { object: companySession() },
  }) as unknown as import("stripe").Event;

describe("processWebhookEvent — company checkout.session.completed (REQ-038 / TASK-085)", () => {
  it("persists the company donor (billing/contact fields) and a not-eligible donation with no declaration", async () => {
    const result = await processWebhookEvent(companyEvent());
    expect(result).toEqual({ processed: true, action: "donation.created" });

    // The donor row carries the mapped company fields. INSERT params order:
    // donor_type, full_name, business_name, company_number, email, email_consent, anonymous,
    // billing_address, billing_postcode.
    const donorCall = call(/insert into donors/i);
    expect(donorCall?.[1][0]).toBe("company"); // donor_type
    expect(donorCall?.[1][1]).toBe("Ada Lovelace"); // full_name = contact name
    expect(donorCall?.[1][2]).toBe("Acme Ltd"); // business_name = legal name
    expect(donorCall?.[1][3]).toBe("SC123456"); // company_number = registration number
    expect(donorCall?.[1][4]).toBe("finance@acme.test"); // email = contact email
    expect(donorCall?.[1][5]).toBe(false); // email_consent (operational email, not marketing)
    expect(donorCall?.[1][7]).toBe("1 Office Park, London"); // billing_address
    expect(donorCall?.[1][8]).toBe("SW1A 1AA"); // billing_postcode

    // The donation is not claimable and has no declaration.
    const donationCall = call(/insert into donations/i);
    expect(donationCall?.[1][1]).toBeNull(); // declaration_id
    expect(donationCall?.[1][6]).toBe(false); // gift_aid
    expect(donationCall?.[1][9]).toBe("not_eligible"); // claim_status

    // No declarations row is inserted for a company.
    expect(queryMock.mock.calls.some((c) => /insert into declarations/i.test(String(c[0])))).toBe(false);
    // Committed in one transaction.
    const seq = sqls();
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /rollback/i.test(s))).toBe(false);
  });
});
