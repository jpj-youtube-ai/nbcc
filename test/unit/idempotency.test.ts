import { describe, it, expect, vi } from "vitest";
import { claimWebhookEvent, markWebhookEventProcessed } from "../../src/webhooks/idempotency";

// TASK-048 (REQ-036): the webhook idempotency helper's dedup DECISION logic, tested
// DB-free against a mocked client — the same mock-the-dependency approach as
// test/unit/checkout-session.test.ts (no pool, no config, no network). The real
// ON CONFLICT behaviour against Postgres is exercised by the migration + the
// webhook BDD; here we prove the helper reads a claim correctly.

// A minimal client whose query() returns a canned pg result (only rowCount matters
// for the dedup decision). Records calls so we can assert the SQL/params.
function mockClient(rowCount: number) {
  return { query: vi.fn().mockResolvedValue({ rowCount, rows: [] }) };
}

describe("claimWebhookEvent (REQ-036 idempotency)", () => {
  it("treats a first-seen event id as NEW (claimed, alreadyProcessed=false)", async () => {
    const client = mockClient(1); // the INSERT inserted a row
    const result = await claimWebhookEvent(client, "evt_first", "charge.refunded");

    expect(result.alreadyProcessed).toBe(false);
    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    // an INSERT … ON CONFLICT DO NOTHING claim on the ledger, keyed by the event id
    expect(sql).toMatch(/insert into webhook_events/i);
    expect(sql).toMatch(/on conflict\s*\(stripe_event_id\)\s*do nothing/i);
    expect(params).toEqual(["evt_first", "charge.refunded"]);
  });

  it("reports a REPEAT event id as already-processed (no second write)", async () => {
    const client = mockClient(0); // ON CONFLICT DO NOTHING inserted nothing
    const result = await claimWebhookEvent(client, "evt_repeat", "charge.refunded");

    expect(result.alreadyProcessed).toBe(true);
    // the caller uses this to SKIP the donation state write, so the only query the
    // helper itself runs is the single idempotent claim.
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("treats a null rowCount defensively as already-processed (no accidental re-write)", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: null, rows: [] }) };
    const result = await claimWebhookEvent(client, "evt_x", "invoice.paid");
    expect(result.alreadyProcessed).toBe(true);
  });
});

describe("markWebhookEventProcessed", () => {
  it("stamps processed_at for the given event id", async () => {
    const client = mockClient(1);
    await markWebhookEventProcessed(client, "evt_first");

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/update webhook_events set processed_at = now\(\)/i);
    expect(sql).toMatch(/where stripe_event_id = \$1/i);
    expect(params).toEqual(["evt_first"]);
  });
});
