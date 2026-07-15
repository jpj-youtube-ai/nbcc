import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-222: the DB layer behind the daily reminder runner — listSupportersDueForReminder (who is due
// the next thank-you nudge) and markReminderSent (advance reminder_count after a successful send).
// DB-free: the module pool is mocked, so we assert the SQL predicates + params these build and how the
// rows are mapped, exactly like the other db/fulfilment unit tests. The pool/config are mocked only so
// importing the module never boots the real DB.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listSupportersDueForReminder, markReminderSent } from "../../src/db/fulfilment";

beforeEach(() => {
  queryMock.mockReset();
});

describe("listSupportersDueForReminder — the due-gate SQL + row mapping", () => {
  const now = new Date("2026-07-14T09:00:00Z");

  it("selects on the full due-gate (not captured, invited, has email+token, 5-day@0 / 14-day@1) and passes the clock", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listSupportersDueForReminder(now);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    const text = String(sql);
    // Eligibility: only supporters who have not chosen yet but were invited, with somewhere to send.
    expect(text).toMatch(/captured_at is null/i);
    expect(text).toMatch(/invited_at is not null/i);
    expect(text).toMatch(/token is not null/i);
    expect(text).toMatch(/email is not null/i);
    // The two due windows keyed off reminder_count + the invite age.
    expect(text).toMatch(/reminder_count = 0/i);
    expect(text).toMatch(/reminder_count = 1/i);
    expect(text).toMatch(/interval '5 days'/i);
    expect(text).toMatch(/interval '14 days'/i);
    // The clock is passed in (deterministic), not now().
    expect(params).toEqual([now]);
    expect(text).not.toMatch(/\bnow\(\)/i);
  });

  it("maps each row: greeting name (business_name, trimmed, else full_name) and the due stage", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { id: 1, token: "t1", band: "gold", email: "a@biz.test", business_name: "Bean There", full_name: "Jo Trader", stage: 1 },
        { id: 2, token: "t2", band: "bronze", email: "b@biz.test", business_name: null, full_name: "Sam Sole", stage: 2 },
        { id: 3, token: "t3", band: "silver", email: "c@biz.test", business_name: "   ", full_name: "Pat Blank", stage: 1 },
      ],
      rowCount: 3,
    });

    const due = await listSupportersDueForReminder(now);
    expect(due).toEqual([
      { fulfilmentId: 1, token: "t1", band: "gold", email: "a@biz.test", name: "Bean There", stage: 1 },
      { fulfilmentId: 2, token: "t2", band: "bronze", email: "b@biz.test", name: "Sam Sole", stage: 2 },
      { fulfilmentId: 3, token: "t3", band: "silver", email: "c@biz.test", name: "Pat Blank", stage: 1 },
    ]);
  });

  it("orders oldest-first and bounds the read", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await listSupportersDueForReminder(now);
    const text = String(queryMock.mock.calls[0][0]);
    expect(text).toMatch(/order by f\.id asc/i);
    expect(text).toMatch(/limit\s+\d+/i);
  });
});

describe("markReminderSent — idempotent advance under a stage guard", () => {
  it("advances reminder_count to the sent stage only from the previous stage, and reports it stamped", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const stamped = await markReminderSent(7, 1);

    expect(stamped).toBe(true);
    const [sql, params] = queryMock.mock.calls[0];
    const text = String(sql);
    expect(text).toMatch(/update business_supporter_fulfilment/i);
    expect(text).toMatch(/set reminder_count = \$2/i);
    // The idempotency guard: only fire when the row is at exactly the previous stage.
    expect(text).toMatch(/where id = \$1 and reminder_count = \$2 - 1/i);
    expect(params).toEqual([7, 1]);
  });

  it("reports NOT stamped (false) when zero rows matched — the guard already advanced it (a re-run)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await markReminderSent(7, 1)).toBe(false);
  });

  it("advances to stage 2 (14-day) only from reminder_count 1", async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await markReminderSent(9, 2);
    expect(queryMock.mock.calls[0][1]).toEqual([9, 2]);
  });
});
