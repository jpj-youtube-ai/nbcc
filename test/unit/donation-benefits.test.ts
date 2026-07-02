import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-067 (REQ-045): the transactional benefit-recording helper. The pure cap/tier logic
// is unit-tested DB-free in benefit-caps.test.ts; here we prove the HELPER's transaction
// shape without a real DB by mocking the pool — the same mock-the-boundary approach as
// test/unit/donations-batch.test.ts. Asserting the query SEQUENCE proves each
// donation_benefits row and the audit row are written inside ONE transaction (between
// BEGIN and COMMIT), that a throwing write rolls BOTH back (ROLLBACK, no COMMIT), that a
// named recognition perk is stored at £0, and that donations.benefit_cap_breached is set
// from the annualised donation vs benefit total.

const { queryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const mockClient = { query: queryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, mockClient, connect };
});

vi.mock("../../src/db/pool", () => ({ pool: { connect } }));

import { recordDonationBenefits } from "../../src/db/donations";

// The donations row the mocked `SELECT … FOR UPDATE` returns (undefined = no such donation).
let donationRow: { amount_pence: number; mode: "once" | "monthly" } | undefined;

function installQuery() {
  let nextBenefitId = 500;
  queryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select .* from donations/i.test(sql))
      return { rows: donationRow ? [donationRow] : [], rowCount: donationRow ? 1 : 0 };
    if (/insert into donation_benefits/i.test(sql))
      return { rows: [{ id: nextBenefitId++ }], rowCount: 1 };
    if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

const sqls = (): string[] => queryMock.mock.calls.map((c) => String(c[0]).trim());
const has = (re: RegExp): boolean => sqls().some((s) => re.test(s));
const idx = (re: RegExp): number => sqls().findIndex((s) => re.test(s));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calls = (re: RegExp): any[][] => queryMock.mock.calls.filter((c) => re.test(String(c[0])));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (re: RegExp): any[] | undefined => queryMock.mock.calls.find((c) => re.test(String(c[0])));

const pounds = (p: number) => p * 100;

beforeEach(() => {
  queryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  installQuery();
  donationRow = { amount_pence: pounds(2_000), mode: "once" }; // £2,000 → cap £100
});

describe("recordDonationBenefits — one row per benefit + audit in one BEGIN…COMMIT (REQ-045)", () => {
  it("inserts a donation_benefits row per benefit and audits inside the transaction", async () => {
    const result = await recordDonationBenefits(42, 10, [
      { benefitTypeId: 1, name: "gala dinner", valuePence: pounds(30) },
      { benefitTypeId: 2, name: "event ticket", valuePence: pounds(20) },
    ]);
    expect(result).toMatchObject({ donationId: 42, donorId: 10, capBreached: false });
    expect(result.benefitIds).toHaveLength(2);

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(has(/rollback/i)).toBe(false);

    // One INSERT per benefit, each keyed to the donation + its benefit_type FK.
    const inserts = calls(/insert into donation_benefits/i);
    expect(inserts).toHaveLength(2);
    expect(inserts[0][1]).toEqual([42, 1, pounds(30)]);
    expect(inserts[1][1]).toEqual([42, 2, pounds(20)]);

    // Ordering inside the one transaction: lock donation → insert benefits → update flag → audit → commit.
    const selectIdx = idx(/select .* from donations/i);
    const firstInsertIdx = idx(/insert into donation_benefits/i);
    const updateIdx = idx(/update donations/i);
    const auditIdx = idx(/insert into audit_log/i);
    const commitIdx = idx(/^commit/i);
    expect(selectIdx).toBe(1);
    expect(firstInsertIdx).toBeGreaterThan(selectIdx);
    expect(updateIdx).toBeGreaterThan(firstInsertIdx);
    expect(auditIdx).toBeGreaterThan(updateIdx);
    expect(commitIdx).toBeGreaterThan(auditIdx);

    // The audit row mirrors the other helpers' shape.
    const audit = call(/insert into audit_log/i);
    expect(audit?.[1][0]).toBe("system");
    expect(audit?.[1][1]).toBe("donation.benefits_recorded");
    expect(audit?.[1][2]).toBe("donation");
    expect(audit?.[1][3]).toBe(42);
    expect(audit?.[1][4]).toMatchObject({ donorId: 10, capBreached: false });
  });

  it("records the acting admin on the audit row when supplied", async () => {
    await recordDonationBenefits(42, 10, [{ benefitTypeId: 1, name: "gala dinner", valuePence: pounds(10) }], "kenny");
    expect(call(/insert into audit_log/i)?.[1][0]).toBe("kenny");
  });
});

describe("recordDonationBenefits — named recognition perks are recorded at £0 (REQ-045)", () => {
  it("forces every named recognition perk's value to 0 regardless of admin input", async () => {
    await recordDonationBenefits(42, 10, [
      { benefitTypeId: 3, name: "digital badge", valuePence: pounds(50) },
      { benefitTypeId: 4, name: "certificate", valuePence: 999 },
      { benefitTypeId: 5, name: "gala dinner", valuePence: pounds(40) }, // not a perk → kept
    ]);
    const inserts = calls(/insert into donation_benefits/i);
    expect(inserts[0][1]).toEqual([42, 3, 0]); // digital badge → £0
    expect(inserts[1][1]).toEqual([42, 4, 0]); // certificate → £0
    expect(inserts[2][1]).toEqual([42, 5, pounds(40)]); // real benefit kept
  });

  it("does not breach the cap when the only benefits are (zeroed) recognition perks", async () => {
    donationRow = { amount_pence: pounds(40), mode: "once" }; // cap = £10
    const result = await recordDonationBenefits(42, 10, [
      { benefitTypeId: 3, name: "digital badge", valuePence: pounds(50) },
    ]);
    expect(result.capBreached).toBe(false);
    expect(call(/update donations/i)?.[1]).toEqual([false, 42]);
  });
});

describe("recordDonationBenefits — sets benefit_cap_breached from the annualised totals (REQ-045)", () => {
  it("flags a breach (true) when the benefit total exceeds the cap", async () => {
    donationRow = { amount_pence: pounds(2_000), mode: "once" }; // cap = 5% = £100
    const result = await recordDonationBenefits(42, 10, [
      { benefitTypeId: 1, name: "gala dinner", valuePence: pounds(101) },
    ]);
    expect(result.capBreached).toBe(true);
    expect(call(/update donations/i)?.[1]).toEqual([true, 42]);
  });

  it("does not flag a breach (false) when the benefit total is within the cap", async () => {
    donationRow = { amount_pence: pounds(2_000), mode: "once" }; // cap = £100
    const result = await recordDonationBenefits(42, 10, [
      { benefitTypeId: 1, name: "gala dinner", valuePence: pounds(100) },
    ]);
    expect(result.capBreached).toBe(false);
    expect(call(/update donations/i)?.[1]).toEqual([false, 42]);
  });

  it("annualises a monthly gift ×12 for BOTH the donation and the benefit total", async () => {
    // £10/mo → £120/yr donation → tier 2 flat £25 cap. A £3/mo benefit → £36/yr > £25 ⇒ breach.
    donationRow = { amount_pence: pounds(10), mode: "monthly" };
    const result = await recordDonationBenefits(42, 10, [
      { benefitTypeId: 1, name: "monthly newsletter perk", valuePence: pounds(3) },
    ]);
    expect(result.capBreached).toBe(true);
    expect(call(/update donations/i)?.[1]).toEqual([true, 42]);
  });
});

describe("recordDonationBenefits — a throwing write rolls back both (REQ-045)", () => {
  it("rolls back with no benefit, flag or audit write when the donation does not exist", async () => {
    donationRow = undefined; // SELECT returns no rows → helper throws

    await expect(
      recordDonationBenefits(999, 10, [{ benefitTypeId: 1, name: "gala dinner", valuePence: pounds(10) }]),
    ).rejects.toThrow(/not found/i);

    const seq = sqls();
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^rollback/i);
    expect(has(/insert into donation_benefits/i)).toBe(false);
    expect(has(/update donations/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
    expect(has(/^commit/i)).toBe(false);
  });

  it("rolls back both writes when a benefit INSERT fails", async () => {
    donationRow = { amount_pence: pounds(2_000), mode: "once" };
    queryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select .* from donations/i.test(sql)) return { rows: [donationRow], rowCount: 1 };
      if (/insert into donation_benefits/i.test(sql)) throw new Error("insert boom");
      return { rows: [], rowCount: 0 };
    });

    await expect(
      recordDonationBenefits(42, 10, [{ benefitTypeId: 1, name: "gala dinner", valuePence: pounds(10) }]),
    ).rejects.toThrow(/insert boom/);

    const seq = sqls();
    expect(seq[seq.length - 1]).toMatch(/^rollback/i);
    expect(has(/^commit/i)).toBe(false);
    expect(has(/insert into audit_log/i)).toBe(false);
  });
});
