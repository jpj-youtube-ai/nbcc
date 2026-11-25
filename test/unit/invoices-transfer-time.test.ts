import { describe, it, expect, vi } from "vitest";

// A bank transfer marked paid is dated noon on the day the money arrived. Marked paid that same
// morning, noon is still to come, and a gift dated in the future is newer than every visit to
// Donations: its New pill came back on every refresh until noon (25 November 2026). So the date is
// noon, or the moment it was marked paid if that is earlier. The database decides "now", so this
// checks the statement; features/admin-invoices.feature checks it against a real database.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: {} }));
vi.mock("../../src/db/donations", () => ({
  insertAudit: vi.fn(),
  writeWithAudit: vi.fn(),
  insertDonorAndDonation: vi.fn(async () => ({ donationId: 77, donorId: 5 })),
}));

import { settleInvoice } from "../../src/db/invoices";

const ROW = {
  id: 12,
  status: "sent",
  payer_kind: "person",
  org_name: null,
  title: null,
  first_name: "Invented",
  last_name: "Person",
  email: "someone@example.com",
  address: "1 Made Up Street",
  postcode: "KA1 1AA",
  amount_pence: 4000,
  consideration_given: false,
  issued_on: "2026-11-20",
  due_on: "2026-12-04",
  paid_on: null,
  paid_by: null,
  donation_id: null,
  cancelled_at: null,
  paid_twice_at: null,
  gift_aid: false,
  declaration: null,
};

describe("a bank transfer marked paid", () => {
  it("is dated noon on the day the money arrived, but never later than the moment it was marked paid", async () => {
    const sql: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        sql.push(text);
        return { rows: [ROW] };
      }),
    };
    await settleInvoice(client as never, 12, {
      by: "transfer",
      paidOn: "2026-11-25",
      sessionId: null,
      paymentIntentId: null,
      actor: "admin:staff@example.com",
    }).catch(() => undefined); // only the dating statement matters here
    const dating = sql.find((s) => s.includes("UPDATE donations SET source = 'invoice'"));
    expect(dating).toBeDefined();
    expect(dating!.replace(/\s+/g, " ")).toContain(
      "LEAST(($4::date + time '12:00') AT TIME ZONE 'Europe/London', now())",
    );
  });
});
