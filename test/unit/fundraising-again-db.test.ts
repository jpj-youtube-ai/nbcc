import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-515: the SQL behind "Do it again": a link stored only as its hash, found by its hash, and used
// once, only while in date, in one statement with its History row. Against a mocked pool.

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { createAgainToken, findAgainByHash, markAgainUsed } from "../../src/db/fundraiser-again";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
});

const HASH = "a".repeat(64);

describe("Do it again links", () => {
  it("stores only the hash, its fundraiser and when it runs out", async () => {
    await createAgainToken(7, HASH, new Date("2028-02-04T08:00:00Z"));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO fundraiser_again_tokens \(fundraiser_id, token_hash, expires_at\)/);
    expect(params).toEqual([7, HASH, new Date("2028-02-04T08:00:00Z")]);
  });

  it("finds one by its hash", async () => {
    query.mockResolvedValueOnce({ rows: [{ fundraiser_id: 7, expires_at: new Date("2028-02-04T08:00:00Z"), used_at: null }] });
    expect(await findAgainByHash(HASH)).toEqual({ fundraiserId: 7, expiresAt: new Date("2028-02-04T08:00:00Z"), usedAt: null });
    expect(query.mock.calls[0][0]).toMatch(/WHERE token_hash = \$1/);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await findAgainByHash(HASH)).toBeNull();
  });

  it("is used once, only while in date, with its History row in the same statement", async () => {
    query.mockResolvedValueOnce({ rows: [{ entity_id: 7 }] });
    expect(await markAgainUsed(HASH, 31)).toBe(7);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET used_at = now\(\), used_by_fundraiser_id = \$2/);
    expect(sql).toMatch(/used_at IS NULL AND expires_at > now\(\)/);
    expect(sql).toMatch(/INSERT INTO audit_log/);
    expect(sql).toMatch(/'fundraiser\.again_used'/);
    expect(params).toEqual([HASH, 31]);
    query.mockResolvedValueOnce({ rows: [] });
    expect(await markAgainUsed(HASH, 32)).toBeNull();
  });
});
