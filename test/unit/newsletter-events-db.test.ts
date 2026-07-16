import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-255: the delivery-facts store. The pool is mocked at the boundary (the established approach —
// newsletter-templates.test.ts, charities-online-query.test.ts) to pin the SQL contracts that carry
// the feature's promises:
//   - correlation picks the NEWEST send for an address, bounded by a window (webhook events arrive
//     keyed by address, not newsletter);
//   - inserts are idempotent on the Svix id (Resend retries until acknowledged);
//   - stats count DISTINCT addresses, so a duplicate event can never inflate a rate;
//   - an unmatched event is NOT stored (receipts/login codes: acknowledged and dropped).

const { queryMock, connect } = vi.hoisted(() => ({ queryMock: vi.fn(), connect: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));

import {
  recordNewsletterSends,
  recordResendEvent,
  recordUnsubscribeEvent,
  getNewsletterStats,
} from "../../src/db/newsletter-events";

const allSql = (): string => queryMock.mock.calls.map((c) => String(c[0])).join("\n---\n");
const sqlOf = (re: RegExp): string => queryMock.mock.calls.map((c) => String(c[0])).find((s) => re.test(s)) ?? "";
const paramsOf = (re: RegExp): unknown[] => (queryMock.mock.calls.find((c) => re.test(String(c[0]))) || [])[1] as unknown[];

const parsed = {
  eventType: "delivered" as const,
  email: "dora@example.com",
  occurredAt: new Date("2026-07-16T12:00:00.000Z"),
  detail: null,
};

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("recordNewsletterSends", () => {
  it("batch-inserts every accepted recipient in ONE statement (hundreds of donors, one round trip)", async () => {
    await recordNewsletterSends(41, [
      { donorId: 1, email: "A@example.com" },
      { donorId: 2, email: "b@example.com" },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const sql = sqlOf(/insert\s+into\s+newsletter_sends/i);
    expect(sql).toMatch(/unnest/i);
    // Addresses are stored lowercased — correlation later compares lowercased.
    const params = paramsOf(/insert\s+into\s+newsletter_sends/i);
    expect(params[0]).toBe(41);
    expect(params[2]).toEqual(["a@example.com", "b@example.com"]);
  });

  it("is a no-op for an empty recipient list rather than issuing a degenerate insert", async () => {
    await recordNewsletterSends(41, []);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("recordResendEvent (webhook ingestion)", () => {
  it("correlates to the NEWEST send for that address within the window, then inserts", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ newsletter_id: 41 }], rowCount: 1 }) // the match
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // the insert
    const outcome = await recordResendEvent("msg_1", parsed);
    expect(outcome).toBe("recorded");
    const match = sqlOf(/from\s+newsletter_sends/i);
    expect(match).toMatch(/order\s+by\s+sent_at\s+desc/i);
    expect(match).toMatch(/limit\s+1/i);
    expect(match).toMatch(/interval/i); // windowed, not forever
    expect(paramsOf(/from\s+newsletter_sends/i)[0]).toBe("dora@example.com");
  });

  it("DROPS an event for an address we never sent a newsletter to — no warehousing receipts", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no send matches
    const outcome = await recordResendEvent("msg_1", parsed);
    expect(outcome).toBe("unmatched");
    expect(allSql()).not.toMatch(/insert\s+into\s+newsletter_email_events/i);
  });

  it("is idempotent on the Svix id — a retry reports duplicate, never a second row", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ newsletter_id: 41 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ON CONFLICT DO NOTHING swallowed it
    const outcome = await recordResendEvent("msg_1", parsed);
    expect(outcome).toBe("duplicate");
    expect(sqlOf(/insert\s+into\s+newsletter_email_events/i)).toMatch(/on\s+conflict/i);
  });
});

describe("recordUnsubscribeEvent", () => {
  it("stores our own event with NO svix id, resolving the donor's address in the same statement", async () => {
    await recordUnsubscribeEvent(41, 7);
    const sql = sqlOf(/insert\s+into\s+newsletter_email_events/i);
    expect(sql).toMatch(/from\s+donors/i); // email comes from the donor row, not the caller
    expect(sql).toMatch(/'unsubscribed'/i);
    expect(paramsOf(/insert\s+into\s+newsletter_email_events/i)).toEqual([41, 7]);
  });
});

describe("getNewsletterStats", () => {
  it("counts DISTINCT addresses per type and returns the bounced addresses for list cleaning", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ sends: "142" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { event_type: "delivered", n: "139", emails: null },
          { event_type: "bounced", n: "3", emails: ["dead@example.com"] },
        ],
        rowCount: 2,
      });
    const stats = await getNewsletterStats(41);
    expect(stats).toEqual({
      sends: 142,
      delivered: 139,
      bounced: 3,
      complained: 0,
      unsubscribed: 0,
      bouncedEmails: ["dead@example.com"],
    });
    expect(sqlOf(/from\s+newsletter_email_events/i)).toMatch(/distinct/i);
  });

  it("returns zeros (not nulls) for a newsletter with no events yet", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ sends: "0" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const stats = await getNewsletterStats(99);
    expect(stats).toEqual({ sends: 0, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0, bouncedEmails: [] });
  });
});
