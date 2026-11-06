import { describe, it, expect, vi, beforeEach } from "vitest";

// A gift's details for the Donations gift log's click down (docs/superpowers/plans/2026-11-05-donations-screen.md,
// Task 3): GET /api/admin/donations/:kind/:id/details. DB-free: the pool answers by the SQL it is
// asked, and Stripe's look up (fillPayDetails) is a stand in. Every name, address and id is invented.

const m = vi.hoisted(() => ({ query: vi.fn(), fill: vi.fn(), getUserAuthRow: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: m.query, connect: vi.fn() } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/donation-pay-details", () => ({ fillPayDetails: m.fill }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    PORTAL_BASE_URL: "https://nbcc.example.com",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));

import { getDonationDetails, stripeDashboardUrl, PAY_FILL_LIMIT_MS } from "../../src/db/donation-details";
import { getAdminDonationDetails } from "../../src/routes/admin-donation-details";
import { signAdminSession } from "../../src/admin/session";

const GIFT = {
  id: 321,
  donor_id: 44,
  mode: "once",
  plan: null,
  amount_pence: 1000,
  fee_cover_pence: 50,
  currency: "GBP",
  gift_aid: true,
  claim_status: "batched",
  payment_status: "paid",
  payment_channel: "online",
  refunded_amount_pence: 0,
  declaration_status: "not_required",
  gasds_eligible: false,
  created_at: new Date("2026-11-05T14:34:00Z"),
  source: null,
  invoice_id: null,
  fundraiser_id: null,
  claim_batch_id: 3,
  declaration_id: 9,
  stripe_session_id: "cs_test_a1",
  stripe_payment_intent_id: "pi_test_a1",
  stripe_subscription_id: null,
  stripe_charge_id: null,
  arrival_channel: "qr",
  arrival_source: null,
  arrival_campaign: "c12",
  given_on: "/donate",
  pay_method: "card",
  pay_wallet: "apple_pay",
  card_brand: "visa",
  card_last4: "4242",
  card_country: "GB",
  pay_checked_at: new Date("2026-11-05T14:35:00Z"),
  donor_name: "Sophie Example",
  donor_email: "sophie@example.com",
  email_consent: true,
  donor_type: "individual",
  business_name: null,
  billing_address: null,
  billing_postcode: null,
  fundraiser_title: null,
  fundraiser_slug: null,
  fundraiser_path: null,
  fundraiser_status: null,
  fundraiser_public: null,
  pledge_id: null,
  declaration_scope: "all_donations",
  declaration_revoked_at: null,
  declaration_made_at: new Date("2026-11-05T14:33:00Z"),
  batch_status: "open",
  batch_submitted_at: null,
};

const ELF = {
  id: 7,
  reference: "EDS-K4F9Q2",
  family_id: 15,
  entry_pence: 500,
  donation_pence: 300,
  fee_cover_pence: 20,
  gift_aid: true,
  stripe_session_id: "cs_test_e1",
  paid_at: new Date("2026-11-05T10:00:00Z"),
  detectives: 2,
  grown_up_name: "Jo Example",
  email: "jo@example.com",
  declaration_id: 10,
  declaration_scope: "this_donation",
  declaration_revoked_at: null,
  declaration_made_at: new Date("2026-11-05T09:59:00Z"),
};

type Answers = {
  gift?: Record<string, unknown> | null;
  reread?: Record<string, unknown>;
  refunds?: Record<string, unknown>[];
  others?: Record<string, unknown>;
  qrNames?: Record<string, unknown>[];
  fundraisers?: Record<string, unknown>[];
  elf?: Record<string, unknown> | null;
};
function answer(a: Answers = {}) {
  m.query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM elf_orders o")) return { rows: a.elf === null ? [] : [a.elf ?? ELF] };
    if (s.includes("FROM audit_log")) return { rows: a.refunds ?? [] };
    if (s.includes("FROM qr_codes")) return { rows: a.qrNames ?? [{ id: 12, name: "Donate billboard, High Street" }] };
    if (s.includes("FROM fundraisers WHERE id = ANY")) return { rows: a.fundraisers ?? [] };
    if (s.includes("d.id <> $2")) return { rows: [a.others ?? { gifts: 3, pence: "4500" }] };
    if (s.includes("SELECT pay_method")) return { rows: [a.reread ?? {}] };
    if (s.includes("FROM donations d")) return { rows: a.gift === null ? [] : [a.gift ?? GIFT] };
    throw new Error(`unexpected SQL: ${s}`);
  });
}
const sqlCalls = () => m.query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
  vi.clearAllMocks();
  m.fill.mockResolvedValue(null);
  answer();
});

describe("a gift's details", () => {
  it("gives everything the click down shows, in its groups", async () => {
    const d = await getDonationDetails("donation", 321);
    expect(d).toMatchObject({
      kind: "donation",
      id: 321,
      reference: "NBCC-000321",
      createdAt: GIFT.created_at,
      gift: { amountPence: 1000, feeCoverPence: 50, totalChargedPence: 1050, currency: "GBP", mode: "once", plan: null, paymentStatus: "paid", paymentChannel: "online", source: null },
      payment: {
        method: "card",
        wallet: "apple_pay",
        cardBrand: "visa",
        cardLast4: "4242",
        cardCountry: "GB",
        checkedAt: GIFT.pay_checked_at,
        stripe: { paymentIntentId: "pi_test_a1", chargeId: null, sessionId: "cs_test_a1", subscriptionId: null, dashboardUrl: "https://dashboard.stripe.com/test/payments/pi_test_a1" },
      },
      arrival: { channel: "qr", source: null, campaign: "c12", givenOn: "/donate" },
      giftAid: {
        giftAid: true,
        claimStatus: "batched",
        declarationStatus: "not_required",
        gasdsEligible: false,
        declaration: { id: 9, scope: "all_donations", madeAt: GIFT.declaration_made_at, revoked: false, revokedAt: null },
        batch: { id: 3, status: "open", submittedAt: null },
      },
      refunds: { refundedPence: 0, events: [] },
      donor: { id: 44, name: "Sophie Example", email: "sophie@example.com", emailConsent: true, donorType: "individual", businessName: null, billingAddress: null, billingPostcode: null, otherGifts: { count: 3, totalPence: 4500 } },
      links: { fundraiser: null, pledgeId: null, invoice: null, elfFamilyId: null },
      labels: { givenOnLabel: "Donate page", arrivalLabel: "QR code: Donate billboard, High Street", paidByLabel: "Apple Pay (Visa ending 4242)" },
    });
  });

  it("is null for an id that is no gift", async () => {
    answer({ gift: null });
    expect(await getDonationDetails("donation", 999)).toBeNull();
  });

  it("is null, without asking, for a kind it does not know", async () => {
    expect(await getDonationDetails("ticket", 1)).toBeNull();
    expect(m.query).not.toHaveBeenCalled();
  });

  it("reads the gift with its donor, fundraiser, pledge, declaration and claim batch, by one parameter", async () => {
    await getDonationDetails("donation", 321);
    const [sql, params] = m.query.mock.calls[0];
    const s = String(sql).replace(/\s+/g, " ");
    for (const part of [
      "FROM donations d JOIN donors dn ON dn.id = d.donor_id",
      "LEFT JOIN fundraisers fr ON fr.id = d.fundraiser_id",
      "LEFT JOIN declarations dc ON dc.id = d.declaration_id",
      "LEFT JOIN claim_batches cb ON cb.id = d.claim_batch_id",
      "(SELECT sp.id FROM sponsor_pledges sp WHERE sp.donation_id = d.id ORDER BY sp.id LIMIT 1) AS pledge_id",
      "WHERE d.id = $1",
    ]) {
      expect(s, part).toContain(part);
    }
    expect(params).toEqual([321]);
  });

  it("counts the donor's other paid gifts by the same email address, any case, not this one", async () => {
    await getDonationDetails("donation", 321);
    const i = sqlCalls().findIndex((s) => s.includes("d.id <> $2"));
    expect(sqlCalls()[i]).toContain("lower(dn.email) = lower($1)");
    expect(sqlCalls()[i]).toContain("d.payment_status = 'paid'");
    expect(m.query.mock.calls[i][1]).toEqual(["sophie@example.com", 321]);
  });

  it("does not look for other gifts when the donor gave no email address", async () => {
    answer({ gift: { ...GIFT, donor_email: null } });
    const d = await getDonationDetails("donation", 321);
    expect(d?.kind === "donation" && d.donor.otherGifts).toBeNull();
    expect(sqlCalls().some((s) => s.includes("d.id <> $2"))).toBe(false);
  });

  it("gives a company's billing address, and never an individual's", async () => {
    answer({ gift: { ...GIFT, donor_type: "company", business_name: "Example Joinery Ltd", billing_address: "1 Example Street", billing_postcode: "EX1 1AA" } });
    const d = await getDonationDetails("donation", 321);
    expect(d).toMatchObject({ donor: { donorType: "company", businessName: "Example Joinery Ltd", billingAddress: "1 Example Street", billingPostcode: "EX1 1AA" } });
    answer({ gift: { ...GIFT, billing_address: "2 Example Road", billing_postcode: "EX2 2BB" } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ donor: { billingAddress: null, billingPostcode: null } });
  });

  it("lists refunds from the audit trail the refund code writes, disputes marked", async () => {
    answer({
      gift: { ...GIFT, refunded_amount_pence: 1000, payment_status: "paid" },
      refunds: [
        { created_at: new Date("2026-11-06T09:00:00Z"), data: { refundedPence: 400, eventType: "charge.refunded" } },
        { created_at: new Date("2026-11-07T09:00:00Z"), data: { refundedPence: 1000, eventType: "charge.dispute.created" } },
      ],
    });
    const d = await getDonationDetails("donation", 321);
    expect(d).toMatchObject({
      refunds: {
        refundedPence: 1000,
        events: [
          { at: new Date("2026-11-06T09:00:00Z"), totalRefundedPence: 400, dispute: false },
          { at: new Date("2026-11-07T09:00:00Z"), totalRefundedPence: 1000, dispute: true },
        ],
      },
    });
    const refundSql = sqlCalls().find((s) => s.includes("FROM audit_log"));
    expect(refundSql).toContain("entity = 'donation'");
    expect(refundSql).toContain("action = 'donation.refunded'");
    expect(refundSql).toContain("entity_id = $1");
  });

  it("links an invoice by its number and its private page", async () => {
    answer({ gift: { ...GIFT, source: "invoice", invoice_id: 12 } });
    const d = await getDonationDetails("donation", 321);
    expect(d).toMatchObject({ links: { invoice: { id: 12, number: "INV-0012" } }, labels: { givenOnLabel: "Invoice INV-0012" } });
    expect(d?.kind === "donation" && d.links.invoice?.url).toMatch(/^https:\/\/nbcc\.example\.com\//);
  });

  // fundraisers.path is the KIND ('raising' | 'event'), not an address (migration 1791200000000).
  const FR = { fundraiser_id: 5, fundraiser_title: "Sam's Santa Dash", fundraiser_slug: "sams-santa-dash", fundraiser_path: "raising", fundraiser_status: "approved", fundraiser_public: true };

  it("links a fundraiser's page and a sponsor pledge", async () => {
    answer({ gift: { ...GIFT, ...FR, pledge_id: 8 } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({
      links: { fundraiser: { id: 5, title: "Sam's Santa Dash", slug: "sams-santa-dash", pagePath: "/fundraise/sams-santa-dash" }, pledgeId: 8 },
      labels: { givenOnLabel: "Sponsor pledge for Sam's Santa Dash" },
    });
  });

  it("links an event's page at its event address", async () => {
    answer({ gift: { ...GIFT, ...FR, fundraiser_path: "event", fundraiser_slug: "winter-quiz", fundraiser_status: "finished" } });
    const d = await getDonationDetails("donation", 321);
    expect(d?.kind === "donation" && d.links.fundraiser?.pagePath).toBe("/event/winter-quiz");
  });

  it("gives no page link for a fundraiser with no public page", async () => {
    for (const over of [{ fundraiser_status: "pending" }, { fundraiser_status: "declined" }, { fundraiser_public: false }]) {
      answer({ gift: { ...GIFT, ...FR, ...over } });
      const d = await getDonationDetails("donation", 321);
      expect(d?.kind === "donation" && d.links.fundraiser).toMatchObject({ id: 5, title: "Sam's Santa Dash", pagePath: null });
    }
  });

  it("says a revoked declaration is revoked", async () => {
    const at = new Date("2026-11-06T00:00:00Z");
    answer({ gift: { ...GIFT, declaration_revoked_at: at } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ giftAid: { declaration: { revoked: true, revokedAt: at } } });
  });

  it("has no declaration or batch when the gift has none", async () => {
    answer({ gift: { ...GIFT, declaration_id: null, declaration_scope: null, declaration_made_at: null, claim_batch_id: null, batch_status: null } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ giftAid: { declaration: null, batch: null } });
  });
});

describe("naming the QR code that brought them", () => {
  it("names a page's own code by its page, with no look up", async () => {
    answer({ gift: { ...GIFT, arrival_campaign: "donate" } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { arrivalLabel: "QR code for the Donate page" } });
    expect(sqlCalls().some((s) => s.includes("qr_codes"))).toBe(false);
  });

  it("names a fundraiser's printed piece", async () => {
    answer({ gift: { ...GIFT, arrival_campaign: "f5-a4" }, fundraisers: [{ id: 5, title: "Sam's Santa Dash" }] });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { arrivalLabel: "QR code: Sam's Santa Dash, A4 poster" } });
  });

  it("says just QR code when a named code has gone or its look up fails, and still answers", async () => {
    answer({ gift: { ...GIFT, arrival_campaign: "c99" }, qrNames: [] });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { arrivalLabel: "QR code" } });
    m.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("qr_codes")) throw new Error("down");
      if (String(sql).includes("FROM audit_log")) return { rows: [] };
      if (String(sql).includes("d.id <> $2")) return { rows: [{ gifts: 0, pence: 0 }] };
      return { rows: [GIFT] };
    });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { arrivalLabel: "QR code" } });
  });

  it("names other arrivals by the shared rules, and nothing when nothing was noted", async () => {
    answer({ gift: { ...GIFT, arrival_channel: "search", arrival_source: "Google", arrival_campaign: null } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { arrivalLabel: "Search: Google" } });
    answer({ gift: { ...GIFT, arrival_channel: null, arrival_campaign: null, given_on: null } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ arrival: { channel: null, givenOn: null }, labels: { arrivalLabel: null } });
  });
});

describe("asking Stripe how an older gift was paid, the first time it is opened", () => {
  const unchecked = { ...GIFT, pay_method: null, pay_wallet: null, card_brand: null, card_last4: null, card_country: null, pay_checked_at: null };

  it("asks, then reads what was kept", async () => {
    const checked = new Date("2026-11-05T15:00:00Z");
    answer({ gift: unchecked, reread: { pay_method: "bacs_debit", pay_wallet: null, card_brand: null, card_last4: null, card_country: null, pay_checked_at: checked } });
    const d = await getDonationDetails("donation", 321);
    expect(m.fill).toHaveBeenCalledWith(321);
    expect(d).toMatchObject({ payment: { method: "bacs_debit", checkedAt: checked }, labels: { paidByLabel: "Direct Debit" } });
    expect(sqlCalls().find((s) => s.includes("SELECT pay_method"))).toContain("FROM donations WHERE id = $1");
  });

  it("does not ask for a gift already checked", async () => {
    await getDonationDetails("donation", 321);
    expect(m.fill).not.toHaveBeenCalled();
  });

  it("does not ask for a gift whose payment is already noted, such as a bank transfer", async () => {
    answer({ gift: { ...unchecked, pay_method: "bank_transfer" } });
    expect(await getDonationDetails("donation", 321)).toMatchObject({ labels: { paidByLabel: "Bank transfer" } });
    expect(m.fill).not.toHaveBeenCalled();
  });

  it("waits at most three seconds, then answers with what it has", async () => {
    expect(PAY_FILL_LIMIT_MS).toBe(3000);
    answer({ gift: unchecked });
    m.fill.mockReturnValue(new Promise(() => {}));
    const d = await getDonationDetails("donation", 321, { payFillLimitMs: 5 });
    expect(d).toMatchObject({ payment: { method: null, checkedAt: null }, labels: { paidByLabel: null } });
  });

  it("answers even if the look up fails", async () => {
    answer({ gift: unchecked });
    m.fill.mockRejectedValue(new Error("stripe down"));
    expect(await getDonationDetails("donation", 321)).toMatchObject({ id: 321, payment: { method: null } });
  });
});

describe("the Stripe dashboard link", () => {
  it("goes to the payment intent, else the charge, else nowhere", () => {
    expect(stripeDashboardUrl({ paymentIntentId: "pi_1", chargeId: "ch_1" }, false)).toBe("https://dashboard.stripe.com/payments/pi_1");
    expect(stripeDashboardUrl({ paymentIntentId: null, chargeId: "ch_1" }, false)).toBe("https://dashboard.stripe.com/payments/ch_1");
    expect(stripeDashboardUrl({ paymentIntentId: null, chargeId: null }, false)).toBeNull();
  });

  it("goes to Stripe's test side with a test key", () => {
    expect(stripeDashboardUrl({ paymentIntentId: "pi_1", chargeId: null }, true)).toBe("https://dashboard.stripe.com/test/payments/pi_1");
  });
});

describe("an Elf Detective School payment's details", () => {
  it("gives the payment, the family for Head Elf HQ, and its words", async () => {
    const d = await getDonationDetails("elf", 7);
    expect(d).toEqual({
      kind: "elf",
      id: 7,
      reference: "EDS-K4F9Q2",
      createdAt: ELF.paid_at,
      gift: { amountPence: 800, entryPence: 500, giftPence: 300, feeCoverPence: 20, totalChargedPence: 820, currency: "GBP", mode: "once", paymentStatus: "paid", paymentChannel: "online", detectives: 2 },
      payment: { stripe: { sessionId: "cs_test_e1" } },
      giftAid: { giftAid: true, declaration: { id: 10, scope: "this_donation", madeAt: ELF.declaration_made_at, revoked: false, revokedAt: null } },
      family: { id: 15, name: "Jo Example", email: "jo@example.com" },
      links: { elfFamilyId: 15 },
      labels: { givenOnLabel: "Elf Detective School", arrivalLabel: null, paidByLabel: null },
    });
  });

  it("reads only a paid payment of a family not removed, as the list shows", async () => {
    await getDonationDetails("elf", 7);
    const [sql, params] = m.query.mock.calls[0];
    const s = String(sql).replace(/\s+/g, " ");
    expect(s).toContain("FROM elf_orders o JOIN elf_families f ON f.id = o.family_id");
    expect(s).toContain("o.id = $1 AND o.status = 'paid' AND f.active AND f.removed_at IS NULL");
    expect(params).toEqual([7]);
  });

  it("has no Gift Aid on an entry with no gift", async () => {
    answer({ elf: { ...ELF, donation_pence: 0 } });
    expect(await getDonationDetails("elf", 7)).toMatchObject({ giftAid: { giftAid: false } });
  });

  it("is null for an id that is no paid payment", async () => {
    answer({ elf: null });
    expect(await getDonationDetails("elf", 70)).toBeNull();
  });

  it("never asks Stripe", async () => {
    await getDonationDetails("elf", 7);
    expect(m.fill).not.toHaveBeenCalled();
  });
});

// --- The route -----------------------------------------------------------------------------------

const tokenFor = (role: string, permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "sam@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "sam@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
};
type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  set: (k: string, v: string) => MockRes;
};
const get = async (token: string | null, params: Record<string, string>) => {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  await getAdminDonationDetails({ headers: token ? { authorization: `Bearer ${token}` } : {}, params, query: {} } as never, res as never);
  return res;
};

describe("GET /api/admin/donations/:kind/:id/details", () => {
  it("refuses a request with no session, without touching the gift", async () => {
    expect((await get(null, { kind: "donation", id: "321" })).statusCode).toBe(401);
    expect(m.query).not.toHaveBeenCalled();
  });

  it("refuses someone whose access leaves Donations out, and never asks Stripe", async () => {
    answer({ gift: { ...GIFT, pay_checked_at: null, pay_method: null } });
    const res = await get(tokenFor("editor", { contact: "edit" }), { kind: "donation", id: "321" });
    expect(res.statusCode).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
    expect(m.fill).not.toHaveBeenCalled();
  });

  it("answers a Viewer with the details, never kept in a cache", async () => {
    const res = await get(tokenFor("viewer"), { kind: "donation", id: "321" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ kind: "donation", id: 321, reference: "NBCC-000321" });
  });

  it("answers an elf payment", async () => {
    const res = await get(tokenFor("viewer"), { kind: "elf", id: "7" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ kind: "elf", links: { elfFamilyId: 15 } });
  });

  it.each([
    ["an unknown kind", { kind: "ticket", id: "1" }],
    ["an id that is not a whole number", { kind: "donation", id: "abc" }],
    ["a zero id", { kind: "donation", id: "0" }],
    ["a negative id", { kind: "donation", id: "-3" }],
    ["a fractional id", { kind: "donation", id: "1.5" }],
    ["an id too big for the table", { kind: "donation", id: "99999999999" }],
  ])("is not found for %s, without asking", async (_name, params) => {
    const res = await get(tokenFor("viewer"), params);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
    expect(m.query).not.toHaveBeenCalled();
  });

  it("is not found for a gift that does not exist", async () => {
    answer({ gift: null });
    const res = await get(tokenFor("viewer"), { kind: "donation", id: "999" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("answers a failure as a failure", async () => {
    m.query.mockRejectedValue(new Error("down"));
    const res = await get(tokenFor("viewer"), { kind: "donation", id: "321" });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});
