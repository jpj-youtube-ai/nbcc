import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-076 (REQ-048/REQ-057): the token-scoped Gift Aid declaration completion. Proven
// DB-free by mocking the pool (the mock-the-boundary approach of donations-batch.test.ts /
// stripe-webhook-declaration.test.ts). The key invariant: a mere GET/render of a
// sent/undelivered link NEVER advances declaration_status — only a successful POST
// (completeDeclaration) inserts the immutable declaration, links it, and sets 'completed',
// all in ONE transaction.

const { queryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { connect, query: queryMock } }));

import { completeDeclaration, getGiftAidDeclarationContext } from "../../src/db/donations";
import type { DeclarationFields } from "../../src/declarations/fields";

const DONATION_ID = 42;
const DONOR_ID = 7;
const DECL_ID = 99;

// The donation the token resolves to; tests mutate its declaration_status.
let donation: Record<string, unknown> | null;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/from donations d join donors dn/i.test(sql)) {
      return { rows: donation ? [donation] : [], rowCount: donation ? 1 : 0 };
    }
    if (/insert into declarations/i.test(sql)) return { rows: [{ id: DECL_ID }], rowCount: 1 };
    if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const VALID_FIELDS: DeclarationFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  houseNameNumber: "12",
  address: "Analytical Avenue, London",
  postcode: "KA1 1AA",
  nonUk: false,
};

const call = (re: RegExp) => queryMock.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  queryMock.mockReset();
  connect.mockClear();
  donation = {
    id: DONATION_ID,
    donor_id: DONOR_ID,
    donor_type: "individual",
    mode: "once",
    amount_pence: 5000,
    currency: "GBP",
    declaration_status: "sent",
  };
  installQuery();
});

describe("getGiftAidDeclarationContext — GET render, no mutation", () => {
  it("returns the verbatim wording for a 'sent' token WITHOUT any write", async () => {
    const ctx = await getGiftAidDeclarationContext("tok_sent");

    expect(ctx.alreadyCompleted).toBe(false);
    expect(ctx.declarationStatus).toBe("sent");
    expect(ctx.wordingSnapshot).toMatch(/I want to Gift Aid my donation/);
    // A one-off records the single-donation template.
    expect(ctx.wordingVersion).toBe("hmrc-single-2024-01");
    // ONLY the lookup SELECT ran — no BEGIN/INSERT/UPDATE, so a GET can never complete it.
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(call(/begin/i)).toBeUndefined();
    expect(call(/insert into declarations/i)).toBeUndefined();
    expect(call(/update donations/i)).toBeUndefined();
  });

  it("reports alreadyCompleted for a 'completed' token, still without mutating", async () => {
    donation!.declaration_status = "completed";
    const ctx = await getGiftAidDeclarationContext("tok_done");
    expect(ctx.alreadyCompleted).toBe(true);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("throws not_found for an unknown token", async () => {
    donation = null;
    await expect(getGiftAidDeclarationContext("tok_missing")).rejects.toMatchObject({
      name: "GiftAidCompletionError",
      reason: "not_found",
    });
  });
});

describe("completeDeclaration — POST completes in one transaction", () => {
  it("inserts the immutable declaration, links it, sets gift_aid + claim_status + 'completed'", async () => {
    const result = await completeDeclaration("tok_sent", VALID_FIELDS);

    expect(result).toEqual({ donationId: DONATION_ID, donorId: DONOR_ID, declarationId: DECL_ID });
    // One transaction that inserts the declaration and links/flips the donation.
    expect(call(/begin/i)).toBeDefined();
    expect(call(/commit/i)).toBeDefined();
    expect(call(/rollback/i)).toBeUndefined();
    expect(call(/insert into declarations/i)).toBeDefined();

    const update = call(/update donations/i);
    expect(update).toBeDefined();
    // params: [declarationId, nextStatus, claimStatus, donationId]
    expect(update?.[1]).toEqual([DECL_ID, "completed", "eligible", DONATION_ID]);

    // Audited as declaration.completed.
    const audit = call(/insert into audit_log/i);
    expect(audit?.[1]).toContain("declaration.completed");
  });

  it("also completes from a bounced 'undelivered' link", async () => {
    donation!.declaration_status = "undelivered";
    const result = await completeDeclaration("tok_undelivered", VALID_FIELDS);
    expect(result.declarationId).toBe(DECL_ID);
    expect(call(/update donations/i)?.[1]?.[1]).toBe("completed");
  });

  it("REFUSES to re-complete an already 'completed' token (never read as completed twice)", async () => {
    donation!.declaration_status = "completed";
    await expect(completeDeclaration("tok_done", VALID_FIELDS)).rejects.toMatchObject({
      name: "GiftAidCompletionError",
      reason: "not_completable",
    });
    // Nothing written; the transaction rolled back.
    expect(call(/insert into declarations/i)).toBeUndefined();
    expect(call(/rollback/i)).toBeDefined();
  });

  it("refuses a 'pending' token (email not yet sent) and an unknown token", async () => {
    donation!.declaration_status = "pending";
    await expect(completeDeclaration("tok_pending", VALID_FIELDS)).rejects.toMatchObject({
      reason: "not_completable",
    });

    donation = null;
    await expect(completeDeclaration("tok_missing", VALID_FIELDS)).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});
