import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-213: processing a checkout.session.completed webhook for a NEW business monthly supporter
// emails them their private thank-you INVITE (the link to /business/thank-you?token=…), post-commit
// and best-effort. DB-free per CLAUDE.md: the pool + email client are mocked (same mock-the-boundary
// approach as company-receipt-webhook.test.ts). The invite is sent ONCE, only on the newly-created
// fulfilment record (ensureFulfilmentRecord `created`), only when the business has an email, and a
// failed send never fails the webhook. The invite content is built by the REAL pure builder
// (src/business/invite-email.ts — not mocked), so we also prove the env-correct tokenised link.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));

const {
  sendBusinessSupporterInvite,
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendCompanyReceipt,
  sendRefundConfirmation,
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
} = vi.hoisted(() => ({
  sendBusinessSupporterInvite: vi.fn(),
  sendDonationConfirmation: vi.fn(),
  sendDeclarationEmail: vi.fn(),
  sendCompanyReceipt: vi.fn(),
  sendRefundConfirmation: vi.fn(),
  sendSubscriptionLapsedDonor: vi.fn(),
  sendSubscriptionLapsedAdmin: vi.fn(),
}));
vi.mock("../../src/clients/email", () => ({
  sendBusinessSupporterInvite,
  sendDonationConfirmation,
  sendDeclarationEmail,
  sendCompanyReceipt,
  sendRefundConfirmation,
  sendSubscriptionLapsedDonor,
  sendSubscriptionLapsedAdmin,
}));

vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    DECLARATION_FORM_BASE_URL: "https://nbcc.test",
    PORTAL_BASE_URL: "https://nbcc.test",
    GIVING_FROM_EMAIL: "giving@nbcc.scot",
  },
}));

import { processWebhookEvent } from "../../src/db/stripe-webhook";

const DONOR_ID = 10;
const DONATION_ID = 99;
const FULFILMENT_ID = 500;

// The default happy path: every insert succeeds, and the fulfilment INSERT actually CREATES the row
// (RETURNING yields an id). `fulfilmentCreated=false` simulates the ON CONFLICT (donor_id) DO NOTHING
// path (INSERT returns no row; the follow-up SELECT re-reads the existing id).
function installQuery(fulfilmentCreated = true) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
    if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
    if (/insert into business_supporter_fulfilment/i.test(sql)) {
      return fulfilmentCreated
        ? { rows: [{ id: FULFILMENT_ID }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/select id from business_supporter_fulfilment/i.test(sql)) {
      return { rows: [{ id: FULFILMENT_ID }], rowCount: 1 };
    }
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));
const auditActions = (): string[] =>
  queryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0]))).map((c) => c[1][1]);

// A BUSINESS MONTHLY checkout session: a sole trader / partnership donating monthly under a business
// name (donorType individual WITH a businessName). £50/month → the gold band. Overridable metadata.
const businessSession = (metadata: Record<string, string | undefined> = {}) =>
  ({
    id: "cs_test_biz",
    object: "checkout.session",
    amount_total: 5000,
    currency: "gbp",
    mode: "subscription",
    created: 1_766_620_800,
    payment_intent: "pi_test_biz",
    subscription: "sub_test_biz",
    customer_details: { name: "Jo Trader", email: null },
    metadata: {
      mode: "monthly",
      plan: "gold",
      giftAid: "false",
      donorType: "individual",
      businessName: "Bean There Coffee",
      fullName: "Jo Trader",
      email: "hello@beanthere.test",
      emailConsent: "false",
      ...metadata,
    },
  }) as unknown as import("stripe").Checkout.Session;

const checkoutEvent = (session: import("stripe").Checkout.Session, id = "evt_biz_1") =>
  ({ id, type: "checkout.session.completed", data: { object: session } }) as unknown as import("stripe").Event;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  for (const fn of [
    sendBusinessSupporterInvite,
    sendDonationConfirmation,
    sendDeclarationEmail,
    sendCompanyReceipt,
    sendRefundConfirmation,
    sendSubscriptionLapsedDonor,
    sendSubscriptionLapsedAdmin,
  ]) {
    fn.mockReset();
    fn.mockResolvedValue(undefined);
  }
  installQuery();
});

describe("business supporter invite — NEW qualifying business monthly gift (TASK-213)", () => {
  it("creates the fulfilment record and emails the tokenised thank-you invite once, post-commit", async () => {
    const result = await processWebhookEvent(checkoutEvent(businessSession()));
    expect(result).toEqual({ processed: true, action: "donation.created" });

    // The fulfilment record was created with the band + a minted token, and audited exactly once.
    const insertCall = call(/insert into business_supporter_fulfilment/i);
    expect(insertCall?.[1][0]).toBe(DONOR_ID); // donor_id
    expect(insertCall?.[1][1]).toBe("gold"); // band (£50/mo)
    const token = insertCall?.[1][2] as string; // the minted token
    expect(token).toMatch(/[0-9a-f-]{36}/i);
    expect(auditActions().filter((a) => a === "fulfilment.created")).toHaveLength(1);

    // The invite is sent ONCE, to the business email, repliable From/Reply-To the giving inbox.
    expect(sendBusinessSupporterInvite).toHaveBeenCalledOnce();
    const msg = sendBusinessSupporterInvite.mock.calls[0][0];
    expect(msg.email).toBe("hello@beanthere.test");
    expect(msg.from).toBe("giving@nbcc.scot");
    expect(msg.replyTo).toBe("giving@nbcc.scot");
    expect(msg.subject).toContain("Bean There Coffee");
    // The link uses the env-correct PORTAL_BASE_URL and carries the record's own token.
    expect(msg.html).toContain(`href="https://nbcc.test/business/thank-you?token=${token}"`);
    expect(msg.text).toContain(`https://nbcc.test/business/thank-you?token=${token}`);

    // TASK-214: after the successful send, the record is stamped invited (invited_at = now()) by its
    // id, so the admin catch-up backfill never re-emails it. It is a post-commit stamp on the module
    // pool, guarded by invited_at IS NULL.
    const markCall = call(/update business_supporter_fulfilment\s+set\s+invited_at/i);
    expect(markCall?.[0]).toMatch(/invited_at\s+is\s+null/i);
    expect(markCall?.[1]).toEqual([FULFILMENT_ID]);
  });

  it("bands a company monthly gift and sends the invite to the company contact email", async () => {
    const companyMonthly = () =>
      ({
        id: "cs_test_cobiz",
        object: "checkout.session",
        amount_total: 10000,
        currency: "gbp",
        mode: "subscription",
        created: 1_766_620_800,
        subscription: "sub_test_cobiz",
        customer_details: { name: "Card Holder", email: null },
        metadata: {
          mode: "monthly",
          plan: "platinum",
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

    const result = await processWebhookEvent(checkoutEvent(companyMonthly(), "evt_cobiz_1"));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(sendBusinessSupporterInvite).toHaveBeenCalledOnce();
    const msg = sendBusinessSupporterInvite.mock.calls[0][0];
    expect(msg.email).toBe("finance@acme.test");
    expect(msg.subject).toContain("Acme Ltd");
    expect(call(/insert into business_supporter_fulfilment/i)?.[1][1]).toBe("platinum");
  });
});

describe("business supporter invite — NOT sent when it should not be (TASK-213)", () => {
  it("does NOT create/audit/send for a one-off business gift (not monthly)", async () => {
    await processWebhookEvent(checkoutEvent(businessSession({ mode: "once" })));
    expect(call(/insert into business_supporter_fulfilment/i)).toBeUndefined();
    expect(auditActions()).not.toContain("fulfilment.created");
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
  });

  it("does NOT create/audit/send for an individual monthly gift with no business name", async () => {
    await processWebhookEvent(checkoutEvent(businessSession({ businessName: undefined })));
    expect(call(/insert into business_supporter_fulfilment/i)).toBeUndefined();
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
  });

  it("does NOT create/audit/send for a business monthly gift below the £10/mo minimum", async () => {
    await processWebhookEvent(
      checkoutEvent({ ...businessSession(), amount_total: 500 } as import("stripe").Checkout.Session),
    );
    expect(call(/insert into business_supporter_fulfilment/i)).toBeUndefined();
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
  });

  it("does NOT re-audit or re-send when the fulfilment record already exists (conflict → created:false)", async () => {
    installQuery(false); // ON CONFLICT DO NOTHING — the record already exists
    const result = await processWebhookEvent(checkoutEvent(businessSession()));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    // The insert was attempted (and conflicted), but no fulfilment.created audit and no invite.
    expect(call(/insert into business_supporter_fulfilment/i)).toBeDefined();
    expect(auditActions()).not.toContain("fulfilment.created");
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
  });

  it("creates + audits the record but sends NO invite when the business gave us no email", async () => {
    const result = await processWebhookEvent(checkoutEvent(businessSession({ email: undefined })));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    // The record is still created and audited (recognition is earned regardless of email)…
    expect(call(/insert into business_supporter_fulfilment/i)).toBeDefined();
    expect(auditActions().filter((a) => a === "fulfilment.created")).toHaveLength(1);
    // …but with no address to send to, no invite goes out.
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
  });
});

describe("business supporter invite — a subsequent recurring charge does not re-invite (TASK-213)", () => {
  it("does NOT send an invite on a recurring invoice.payment_succeeded (only the first checkout invites)", async () => {
    // A later monthly charge arrives as invoice.payment_succeeded → handleRecurring, which records the
    // donation but NEVER touches the fulfilment record, so no invite is ever sent for it.
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/sd\.id as dunning_id/i.test(sql)) return { rows: [], rowCount: 0 }; // no open dunning
      if (/d\.gift_aid/i.test(sql)) {
        // the parent donation on the subscription
        return {
          rows: [
            {
              donor_id: DONOR_ID,
              gift_aid: false,
              declaration_id: null,
              plan: "gold",
              donor_type: "individual",
              full_name: "Jo Trader",
              email: "hello@beanthere.test",
              email_consent: false,
            },
          ],
          rowCount: 1,
        };
      }
      if (/select 1 from donations where stripe_payment_intent_id/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into donations/i.test(sql)) return { rows: [{ id: 123 }], rowCount: 1 };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      void params;
      return { rows: [], rowCount: 0 };
    });

    const invoice = {
      id: "in_recur_1",
      object: "invoice",
      billing_reason: "subscription_cycle",
      subscription: "sub_test_biz",
      amount_paid: 5000,
      currency: "gbp",
      payment_intent: "pi_recur_1",
    } as unknown as import("stripe").Invoice;
    const event = {
      id: "evt_recur_1",
      type: "invoice.payment_succeeded",
      created: 1_766_620_800,
      data: { object: invoice },
    } as unknown as import("stripe").Event;

    const result = await processWebhookEvent(event);
    expect(result.processed).toBe(true);
    expect(sendBusinessSupporterInvite).not.toHaveBeenCalled();
    expect(call(/insert into business_supporter_fulfilment/i)).toBeUndefined();
  });
});

describe("business supporter invite — best-effort (never fails the webhook) (TASK-213)", () => {
  it("still returns processed when the invite send throws (the committed record stands)", async () => {
    sendBusinessSupporterInvite.mockRejectedValueOnce(new Error("relay 500"));
    const result = await processWebhookEvent(checkoutEvent(businessSession()));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(sendBusinessSupporterInvite).toHaveBeenCalledOnce();
    // The transaction still committed (no rollback) — the send failure is swallowed post-commit.
    expect(queryMock.mock.calls.some((c) => /rollback/i.test(String(c[0])))).toBe(false);
    expect(queryMock.mock.calls.some((c) => /^commit/i.test(String(c[0]).trim()))).toBe(true);
  });
});

describe("business supporter invite — invited tracking (TASK-214)", () => {
  it("does NOT stamp invited_at when the invite send fails (so the backfill can catch it later)", async () => {
    sendBusinessSupporterInvite.mockRejectedValueOnce(new Error("relay 500"));
    const result = await processWebhookEvent(checkoutEvent(businessSession()));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    // The send threw before the stamp, so invited_at stays NULL (no UPDATE ... SET invited_at).
    expect(call(/update business_supporter_fulfilment\s+set\s+invited_at/i)).toBeUndefined();
  });

  it("still returns processed when the invited_at stamp itself fails (marking never affects the webhook)", async () => {
    // The send succeeds but the post-commit stamp UPDATE throws — its best-effort try/catch swallows it.
    queryMock.mockImplementation(async (sql: string) => {
      if (/update business_supporter_fulfilment\s+set\s+invited_at/i.test(sql)) throw new Error("db down");
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/insert into stripe_webhook_events/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/insert into donors/i.test(sql)) return { rows: [{ id: DONOR_ID }], rowCount: 1 };
      if (/insert into donations/i.test(sql)) return { rows: [{ id: DONATION_ID }], rowCount: 1 };
      if (/insert into business_supporter_fulfilment/i.test(sql)) return { rows: [{ id: FULFILMENT_ID }], rowCount: 1 };
      if (/select id from business_supporter_fulfilment/i.test(sql)) return { rows: [{ id: FULFILMENT_ID }], rowCount: 1 };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 0 };
    });

    const result = await processWebhookEvent(checkoutEvent(businessSession()));
    expect(result).toEqual({ processed: true, action: "donation.created" });
    expect(sendBusinessSupporterInvite).toHaveBeenCalledOnce();
    // The stamp was attempted (and threw) but the webhook still committed cleanly.
    expect(call(/update business_supporter_fulfilment\s+set\s+invited_at/i)).toBeDefined();
    expect(queryMock.mock.calls.some((c) => /rollback/i.test(String(c[0])))).toBe(false);
  });
});
