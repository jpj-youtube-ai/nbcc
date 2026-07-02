import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-057 (REQ-037): the transactional claim-batch assignment helper. The pure
// invariant/decision logic (batchAssignmentBlock) is unit-tested DB-free in
// donations-model.test.ts; here we prove the HELPER's transaction shape without a
// real DB by mocking the pool — the same mock-the-boundary approach as
// test/unit/idempotency.test.ts and test/unit/checkout-session.test.ts. The real SQL
// is additionally exercised against the local DB (see the README note), mirroring how
// src/db/donations.ts is verified. Asserting the query SEQUENCE proves the audit row
// is written inside the SAME transaction (between BEGIN and COMMIT) and that a
// rejected assignment rolls BOTH the state and audit writes back (ROLLBACK, no COMMIT).

// Hoisted so the vi.mock factory can reference the shared mock client / connect fn.
const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

import { assignDonationToBatch, BatchAssignmentError } from "../../src/db/donations";

// The row the mocked `SELECT … FROM donations` returns (undefined = no such donation).
let selectRow: { claim_status: string; claim_batch_id: number | null } | undefined;

function installQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select .* from donations/i.test(sql))
      return { rows: selectRow ? [selectRow] : [], rowCount: selectRow ? 1 : 0 };
    if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
const has = (re: RegExp): boolean => sqls().some((s) => re.test(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callMatching = (re: RegExp): any[] | undefined =>
  queryMock.mock.calls.find((c) => re.test(String(c[0])));

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
  selectRow = undefined;
});

describe("assignDonationToBatch — happy path (REQ-037)", () => {
  it("sets claim_batch_id + claim_status='batched' and audits inside one BEGIN…COMMIT", async () => {
    selectRow = { claim_status: "eligible", claim_batch_id: null };

    const result = await assignDonationToBatch(42, 7);
    expect(result).toEqual({ donationId: 42, claimBatchId: 7 });

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(has(/rollback/i)).toBe(false);

    // The state write sets BOTH the FK and the batched status, keyed by the donation id.
    const update = callMatching(/update donations/i);
    expect(update?.[0]).toMatch(/claim_batch_id/i);
    expect(update?.[0]).toMatch(/claim_status\s*=\s*'batched'/i);
    expect(update?.[1]).toEqual([7, 42]);

    // The audit row mirrors recordDonation's shape and lands BEFORE COMMIT.
    const audit = callMatching(/insert into audit_log/i);
    expect(audit?.[1]).toEqual(["system", "donation.batched", "donation", 42, { claimBatchId: 7 }]);
    const auditIdx = seq.findIndex((s) => /insert into audit_log/i.test(s));
    const commitIdx = seq.findIndex((s) => /^commit/i.test(s));
    expect(auditIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeLessThan(commitIdx);

    // The state UPDATE happens before the audit INSERT, both inside the transaction.
    const updateIdx = seq.findIndex((s) => /update donations/i.test(s));
    expect(updateIdx).toBeGreaterThan(0);
    expect(updateIdx).toBeLessThan(auditIdx);
  });

  it("records the acting admin on the audit row when supplied", async () => {
    selectRow = { claim_status: "eligible", claim_batch_id: null };
    await assignDonationToBatch(42, 7, "kenny");
    expect(callMatching(/insert into audit_log/i)?.[1][0]).toBe("kenny");
  });
});

describe("assignDonationToBatch — rejections roll back both writes (REQ-037)", () => {
  it("rejects a donation already in a batch as already_batched, rolling back with no writes", async () => {
    selectRow = { claim_status: "batched", claim_batch_id: 5 };

    await expect(assignDonationToBatch(42, 7)).rejects.toBeInstanceOf(BatchAssignmentError);
    await expect(assignDonationToBatch(42, 7)).rejects.toMatchObject({ reason: "already_batched" });

    const seq = sqls();
    expect(has(/^begin/i)).toBe(true);
    expect(seq[seq.length - 1]).toMatch(/^rollback/i);
    // Neither the state nor the audit write is issued, and there is no COMMIT.
    expect(has(/update donations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
    expect(has(/^commit/i)).toBe(false);
  });

  it("rejects a not_eligible donation as not_eligible, rolling back with no writes", async () => {
    selectRow = { claim_status: "not_eligible", claim_batch_id: null };

    await expect(assignDonationToBatch(42, 7)).rejects.toMatchObject({ reason: "not_eligible" });

    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/update donations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
    expect(has(/^commit/i)).toBe(false);
  });

  it("rejects when the donation does not exist, rolling back", async () => {
    selectRow = undefined; // SELECT returns no rows

    await expect(assignDonationToBatch(999, 7)).rejects.toBeInstanceOf(BatchAssignmentError);
    expect(sqls().pop()).toMatch(/^rollback/i);
    expect(has(/update donations/i)).toBe(false);
  });
});
