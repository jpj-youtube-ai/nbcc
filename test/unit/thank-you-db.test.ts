import { describe, it, expect, vi, beforeEach } from "vitest";

// The SQL behind Admin > Thank you, against a mocked pool (no database). Two things are pinned here
// (admin refresh, 2026-11-14):
//
//   1. A letter is only kept when its email went. recordThankYouSent takes the send as a step run
//      INSIDE its transaction, after the row is written and before the audit entry and the commit,
//      so a send that fails rolls the row back: no letter in the history, no audit entry saying one
//      was sent, and the donor not marked thanked.
//   2. The list of donors to thank says what each has given since they were last thanked.
//
// Every name, address and amount is invented.

const { query, connect } = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { recordThankYouSent, listThankYouEligible } from "../../src/db/thank-you";

function useClient() {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      if (sql.includes("INSERT INTO thank_you_sent")) return { rows: [{ id: 41 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  connect.mockResolvedValue(client);
  return { calls, client };
}
const ran = (calls: Array<[string, unknown[]]>, needle: string) => calls.some((c) => c[0].includes(needle));

const letter = {
  donorId: 7,
  thankYouName: "Rowan Example",
  addressedTo: "Rowan",
  recipientEmail: "rowan@example.com",
  giftType: "money" as const,
  giftAmountPence: 150000,
  giftInKind: null,
  giftAided: true,
  personalMessage: null,
  signedByName: "Fern Example",
  signedByRole: "Trustee",
  sentBy: "fern@example.com",
  ccEmail: null,
};

beforeEach(() => {
  query.mockReset();
  connect.mockReset();
});

describe("recordThankYouSent", () => {
  it("writes the letter and its audit entry together, as before, when no send is handed in", async () => {
    const { calls, client } = useClient();
    await expect(recordThankYouSent(letter)).resolves.toBe(41);
    expect(ran(calls, "BEGIN")).toBe(true);
    expect(ran(calls, "INSERT INTO thank_you_sent")).toBe(true);
    expect(ran(calls, "INSERT INTO audit_log")).toBe(true);
    expect(ran(calls, "COMMIT")).toBe(true);
    expect(ran(calls, "ROLLBACK")).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });

  it("runs the send after the row is written and before anything is committed, with the new letter's id", async () => {
    const { calls } = useClient();
    const seen: string[] = [];
    const send = vi.fn(async (id: number) => {
      seen.push("send " + id + " after insert: " + ran(calls, "INSERT INTO thank_you_sent") + ", committed: " + ran(calls, "COMMIT"));
    });
    await expect(recordThankYouSent(letter, send)).resolves.toBe(41);
    expect(seen).toEqual(["send 41 after insert: true, committed: false"]);
    expect(ran(calls, "INSERT INTO audit_log")).toBe(true);
    expect(ran(calls, "COMMIT")).toBe(true);
  });

  it("keeps nothing when the send fails: the row is rolled back and no audit entry says a letter was sent", async () => {
    const { calls, client } = useClient();
    const failure = new Error("the mail service said no");
    await expect(recordThankYouSent(letter, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(ran(calls, "ROLLBACK")).toBe(true);
    expect(ran(calls, "COMMIT")).toBe(false);
    expect(ran(calls, "INSERT INTO audit_log")).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

describe("listThankYouEligible", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    donor_id: 7,
    full_name: "Rowan Example",
    business_name: null,
    donor_type: "individual",
    email: "rowan@example.com",
    thankyou_consent: true,
    anonymous: false,
    max_amount: "150000",
    gift_aided: true,
    last_thanked_at: null,
    since_thanked_pence: "0",
    since_thanked_gifts: "0",
    ...over,
  });

  it("asks the database for what each donor has given since their last letter", async () => {
    query.mockResolvedValue({ rows: [] });
    await listThankYouEligible(100000);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("since_thanked_pence");
    expect(sql).toContain("since_thanked_gifts");
    // Only gifts made after the last letter, and only what was kept of each after any refund.
    expect(sql).toContain("d.created_at > lt.last_thanked_at");
    expect(sql).toContain("d.amount_pence - d.refunded_amount_pence");
    expect(query.mock.calls[0][1]).toEqual([100000]);
  });

  it("gives nothing for since they were thanked when they never have been", async () => {
    query.mockResolvedValue({ rows: [row()] });
    const [donor] = await listThankYouEligible(100000);
    expect(donor.alreadyThanked).toBe(false);
    expect(donor.givenSinceThankedPence).toBe(null);
    expect(donor.giftsSinceThanked).toBe(null);
  });

  it("gives the amount and the number of gifts since the last letter, as numbers", async () => {
    query.mockResolvedValue({
      rows: [row({ last_thanked_at: new Date("2026-10-01T10:00:00Z"), since_thanked_pence: "27500", since_thanked_gifts: "2" })],
    });
    const [donor] = await listThankYouEligible(100000);
    expect(donor.alreadyThanked).toBe(true);
    expect(donor.lastThankedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(donor.givenSinceThankedPence).toBe(27500);
    expect(donor.giftsSinceThanked).toBe(2);
  });

  it("gives a plain nought when they have been thanked and have not given since", async () => {
    query.mockResolvedValue({ rows: [row({ last_thanked_at: new Date("2026-10-01T10:00:00Z") })] });
    const [donor] = await listThankYouEligible(100000);
    expect(donor.givenSinceThankedPence).toBe(0);
    expect(donor.giftsSinceThanked).toBe(0);
  });

  it("keeps everything the list already gave", async () => {
    query.mockResolvedValue({ rows: [row({ anonymous: true, email: null })] });
    const [donor] = await listThankYouEligible(100000);
    expect(donor).toMatchObject({
      donorId: 7,
      name: "Rowan Example",
      email: null,
      maxGiftPence: 150000,
      giftAided: true,
      anonymous: true,
      sendState: "no_email",
    });
  });
});
