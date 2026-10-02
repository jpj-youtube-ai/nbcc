import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-507: the address level opt out list, against a mocked pool. "Stop all emails" (and turning
// thank yous off) in the preference centre adds the address; turning thank yous back on lifts it.
// Lifting is a tombstone, never a delete, as for the suppression list and unsubscribes. Every address
// here is invented.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { addOptOut, liftOptOut, optedOutAmong } from "../../src/db/email-opt-outs";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("the opt out list", () => {
  it("adds an address, lower cased, once, safe against two at once (the live row's unique index)", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await addOptOut("  Robin@Example.COM ", "all", "preferences")).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO email_opt_outs \(email, kind, source\)/);
    expect(sql).toMatch(/ON CONFLICT \(email\) WHERE removed_at IS NULL/);
    expect(params).toEqual(["robin@example.com", "all", "preferences"]);
  });

  it("turns a thank yous only opt out into Stop all emails, and never the other way", async () => {
    await addOptOut("robin@example.com", "all", "preferences");
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/DO UPDATE SET kind = 'all'/);
    expect(sql).toMatch(/WHERE email_opt_outs\.kind = 'thank_you' AND EXCLUDED\.kind = 'all'/);
  });

  it("reads a clash with a row added a moment ago (a double submit) as already opted out", async () => {
    query.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }));
    expect(await addOptOut("robin@example.com", "all", "preferences")).toBe(false);
  });

  it("still throws anything else, for the caller to log", async () => {
    query.mockRejectedValue(new Error("db down"));
    await expect(addOptOut("robin@example.com", "all", "preferences")).rejects.toThrow("db down");
  });

  it("adds nothing for an empty address", async () => {
    expect(await addOptOut("  ", "all", "preferences")).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it("lifts it by tombstoning, never deleting", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 });
    expect(await liftOptOut("Robin@Example.com", "preferences")).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE email_opt_outs SET removed_at = now\(\), removed_by = \$2/);
    expect(sql).not.toMatch(/DELETE/);
    expect(params).toEqual(["robin@example.com", "preferences"]);
  });

  it("finds which of some addresses are opted out, in one query, by lower case address", async () => {
    query.mockResolvedValue({ rows: [{ email: "robin@example.com" }] });
    expect(await optedOutAmong(["Robin@Example.com", "jo@example.com"])).toEqual(new Set(["robin@example.com"]));
    expect(query.mock.calls[0][1]).toEqual([["robin@example.com", "jo@example.com"]]);
    expect(query.mock.calls[0][0]).toMatch(/removed_at IS NULL/);
    expect(await optedOutAmong([])).toEqual(new Set());
    expect(query).toHaveBeenCalledTimes(1);
  });
});
