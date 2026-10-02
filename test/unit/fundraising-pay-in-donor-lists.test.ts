import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-501 review: money an organiser collected and paid in (donations.paid_in_by_organiser) is the
// supporters' money, not a gift of theirs. It must never make the organiser look like a donor:
// not on the thank you letter list, not in their donor portal's giving or total, and their pay in
// donor row never becomes their main portal record. Checked against a mocked pool; every name and
// address here is invented.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { listThankYouEligible } from "../../src/db/thank-you";
import { getDonorDonationHistory, findNewestDonorByEmail } from "../../src/db/portal";
import { listOutreachForReports, listBusinessDonors } from "../../src/db/outreach";
import { listPublicSupporters } from "../../src/db/donations";

const sqlOf = (re: RegExp) => query.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
});

describe("the thank you letter list", () => {
  it("only counts gifts of their own, so a £500 pay in never puts an organiser on it", async () => {
    await listThankYouEligible(50000);
    const sql = sqlOf(/FROM donors dn/);
    expect(sql).toMatch(/JOIN donations d ON d\.donor_id = dn\.id AND d\.payment_status = 'paid' AND NOT d\.paid_in_by_organiser/);
  });
});

describe("the donor portal", () => {
  const row = (amount: number, paidIn: boolean, day: string) => ({
    created_at: new Date(`2026-10-${day}T12:00:00Z`),
    amount_pence: amount,
    mode: "once",
    gift_aid: false,
    payment_status: "paid",
    paid_in_by_organiser: paidIn,
  });

  it("leaves a £500 pay in out of their giving and their total", async () => {
    query.mockResolvedValueOnce({ rows: [row(50000, true, "02"), row(2500, false, "01")] });
    const history = await getDonorDonationHistory("sam@example.com");
    expect(history.totalPence).toBe(2500);
    expect(history.count).toBe(1);
    expect(history.donations.map((d) => d.amountPence)).toEqual([2500]);
    expect(sqlOf(/FROM donations d/)).toMatch(/d\.paid_in_by_organiser/);
  });

  it("never takes a donor row that only holds pay ins as their main record", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 30, full_name: "Sam Sample", pay_in_only: true },
        { id: 12, full_name: "Sam Sample", pay_in_only: false },
      ],
    });
    expect(await findNewestDonorByEmail("sam@example.com")).toEqual({ donorId: 12, fullName: "Sam Sample" });
  });

  it("keeps the newest row as it always did otherwise", async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 31, full_name: "Kim Newest", pay_in_only: false },
        { id: 12, full_name: "Kim Older", pay_in_only: false },
      ],
    });
    expect(await findNewestDonorByEmail("kim@example.com")).toEqual({ donorId: 31, fullName: "Kim Newest" });
  });

  it("falls back to the newest row when every row only holds pay ins", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 40, full_name: "Lee Sample", pay_in_only: true }] });
    expect(await findNewestDonorByEmail("lee@example.com")).toEqual({ donorId: 40, fullName: "Lee Sample" });
  });
});

describe("other places that add up what someone gave", () => {
  it("leaves pay ins out of the outreach reports and the business donor picker", async () => {
    await listOutreachForReports();
    expect(sqlOf(/FROM business_outreach b/)).toMatch(/d\.payment_status = 'paid' AND NOT d\.paid_in_by_organiser/);
    query.mockClear();
    await listBusinessDonors();
    expect(sqlOf(/FROM donors dn/)).toMatch(/d\.payment_status = 'paid' AND NOT d\.paid_in_by_organiser/);
  });

  it("leaves pay ins out of the supporters wall's figures", async () => {
    await listPublicSupporters();
    expect(sqlOf(/FROM donors dn/)).toMatch(/ON d\.donor_id = dn\.id AND d\.payment_status = 'paid' AND NOT d\.paid_in_by_organiser/);
  });
});
