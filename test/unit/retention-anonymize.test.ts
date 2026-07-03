import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-112 (REQ-064): the audited retention-expiry anonymisation helper. It reuses the pure
// computeRetentionExpiry calculator verbatim to classify a declaration, and ONLY when its retention
// window has CLOSED ('expired') does it null/redact the donor's name + contact fields and the
// declaration's captured personal fields, appending exactly one audit_log row — all in one
// transaction. An 'expiring' or indefinitely-retained (live enduring) declaration is left completely
// untouched: no write, no audit. DB-free: pool (the read + the writeWithAudit transaction) is mocked.

const { queryMock, clientQueryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn(); // pool.query — the declaration retention-inputs read
  const clientQueryMock = vi.fn(); // client.query — the writeWithAudit transaction
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, clientQueryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import { anonymizeDonorPersonalData } from "../../src/db/admin";

const NOW = new Date("2026-07-03T00:00:00.000Z");

// The retention-inputs row the helper reads for a declaration. Defaults to an EXPIRED declaration:
// a this-donation declaration whose final claimed charge is >6 years before NOW.
let inputRow:
  | { id: number; donor_id: number; scope: string; revoked_at: Date | null; last_claimed_at: Date | null }
  | undefined;

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();

  queryMock.mockImplementation(async () => ({ rows: inputRow ? [inputRow] : [], rowCount: inputRow ? 1 : 0 }));
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    return { rows: [], rowCount: 1 };
  });

  inputRow = {
    id: 77,
    donor_id: 42,
    scope: "this_donation",
    revoked_at: new Date("2019-01-01T00:00:00Z"),
    last_claimed_at: new Date("2018-01-01T00:00:00Z"), // +6y = 2024-01-01, before NOW → expired
  };
});

const seq = () => clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
const call = (re: RegExp) => clientQueryMock.mock.calls.find((c) => re.test(String(c[0])));
const audits = () => clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));

describe("anonymizeDonorPersonalData — expired declaration (REQ-064)", () => {
  it("nulls/redacts the donor + declaration personal fields and appends ONE audit row in one transaction", async () => {
    const result = await anonymizeDonorPersonalData(77, { now: NOW });
    expect(result).toMatchObject({ anonymized: true, declarationId: 77, donorId: 42 });

    const s = seq();
    expect(s[0]).toMatch(/^begin/i);
    expect(s[s.length - 1]).toMatch(/^commit/i);
    expect(s.some((x) => /rollback/i.test(x))).toBe(false);

    // Donor: name redacted, contact/business fields nulled.
    const donorUpd = call(/update donors/i);
    expect(donorUpd?.[0]).toMatch(/full_name\s*=\s*\$1/i);
    expect(donorUpd?.[0]).toMatch(/email\s*=\s*NULL/i);
    expect(donorUpd?.[0]).toMatch(/business_name\s*=\s*NULL/i);
    expect(donorUpd?.[1]?.[0]).toBe("Redacted");
    expect(donorUpd?.[1]?.[1]).toBe(42);

    // Declaration: captured personal fields redacted/nulled.
    const declUpd = call(/update declarations/i);
    expect(declUpd?.[0]).toMatch(/first_name\s*=\s*\$1/i);
    expect(declUpd?.[0]).toMatch(/last_name\s*=\s*\$1/i);
    expect(declUpd?.[0]).toMatch(/address\s*=\s*\$1/i);
    expect(declUpd?.[0]).toMatch(/house_name_number\s*=\s*\$1/i);
    expect(declUpd?.[0]).toMatch(/postcode\s*=\s*NULL/i);
    expect(declUpd?.[0]).toMatch(/title\s*=\s*NULL/i);
    expect(declUpd?.[1]?.[1]).toBe(77);

    // Exactly ONE audit row, of the anonymisation action.
    expect(audits()).toHaveLength(1);
    expect(audits()[0][1][1]).toBe("donor.personal_data_anonymized");
  });
});

describe("anonymizeDonorPersonalData — leaves non-expired declarations untouched", () => {
  it("does nothing for an 'expiring' declaration (window closes in the future)", async () => {
    // Final claimed charge 2021-01-01 → +6y = 2027-01-01, after NOW → not yet expired (expiring).
    inputRow = { id: 77, donor_id: 42, scope: "this_donation", revoked_at: new Date("2021-06-01T00:00:00Z"), last_claimed_at: new Date("2021-01-01T00:00:00Z") };
    const result = await anonymizeDonorPersonalData(77, { now: NOW });
    expect(result).toMatchObject({ anonymized: false, declarationId: 77 });
    // No transaction was opened at all — nothing written, no audit.
    expect(connect).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("does nothing for an indefinitely-retained declaration (live enduring)", async () => {
    // Enduring + not revoked → computeRetentionExpiry returns null (retain indefinitely).
    inputRow = { id: 77, donor_id: 42, scope: "all_donations", revoked_at: null, last_claimed_at: new Date("2018-01-01T00:00:00Z") };
    const result = await anonymizeDonorPersonalData(77, { now: NOW });
    expect(result).toMatchObject({ anonymized: false });
    expect(connect).not.toHaveBeenCalled();
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it("does nothing when the declaration id is unknown", async () => {
    inputRow = undefined;
    const result = await anonymizeDonorPersonalData(999, { now: NOW });
    expect(result).toEqual({ anonymized: false, declarationId: 999 });
    expect(connect).not.toHaveBeenCalled();
  });
});
