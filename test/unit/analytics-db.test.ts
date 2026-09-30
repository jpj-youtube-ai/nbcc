import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-479: the analytics tables' reads and writes, over a stand-in pool (no database here).

const { queryMock, clientQueryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const connect = vi.fn(async () => ({ query: clientQueryMock, release: vi.fn() }));
  return { queryMock, clientQueryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost/test" } }));

import {
  getCollecting,
  getAnalyticsSettings,
  setCollecting,
  saltFor,
  forgetSaltCache,
  insertView,
  recordLeave,
  insertClick,
  lastArrival,
  pruneAnalytics,
} from "../../src/db/analytics";

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  forgetSaltCache();
});

describe("the collecting switch", () => {
  it("reads it from the one settings row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ collecting: true }] });
    expect(await getCollecting()).toBe(true);
    expect(queryMock.mock.calls[0][0]).toMatch(/SELECT collecting FROM analytics_settings WHERE id = 1/);
  });

  it("reads as off when the row is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getCollecting()).toBe(false);
  });

  it("gives the admin page when and by whom it was last changed", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ collecting: true, updated_at: "2026-10-01T08:00:00.000Z", updated_by: "admin@example.com" }],
    });
    expect(await getAnalyticsSettings()).toEqual({
      collecting: true,
      updatedAt: "2026-10-01T08:00:00.000Z",
      updatedBy: "admin@example.com",
    });
  });

  it("changes it with an audit row, in one transaction", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/SELECT collecting/.test(sql) && /FOR UPDATE/.test(sql)) return { rows: [{ collecting: false }] };
      if (/SELECT collecting/.test(sql)) {
        return { rows: [{ collecting: true, updated_at: "2026-10-01T08:00:00.000Z", updated_by: "admin@example.com" }] };
      }
      return { rows: [] };
    });
    const result = await setCollecting(true, "admin@example.com");
    expect(result.collecting).toBe(true);
    const sqls = clientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toBe("BEGIN");
    expect(sqls.some((s) => /INSERT INTO audit_log/.test(s))).toBe(true);
    expect(sqls.at(-1)).toBe("COMMIT");
    const audit = clientQueryMock.mock.calls.find((c) => /INSERT INTO audit_log/.test(String(c[0])))!;
    expect(audit[1]).toContain("analytics.collecting_switched");
  });
});

describe("saltFor", () => {
  it("makes the day's salt once, then reuses it without asking again", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ salt: "abc" }] });
    expect(await saltFor("2026-10-01")).toBe("abc");
    expect(await saltFor("2026-10-01")).toBe("abc");
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO analytics_salts/);
    expect(sql).toMatch(/ON CONFLICT \(day\)/);
    expect(params[0]).toBe("2026-10-01");
    expect(params[1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks again on a new day", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ salt: "abc" }] }).mockResolvedValueOnce({ rows: [{ salt: "def" }] });
    await saltFor("2026-10-01");
    expect(await saltFor("2026-10-02")).toBe("def");
  });
});

describe("views and clicks", () => {
  const row = {
    viewId: "00112233445566ff",
    at: new Date("2026-10-01T09:15:00Z"),
    day: "2026-10-01",
    path: "/donate",
    visitor: "0123456789abcdef",
    channel: "direct" as const,
    source: null,
    campaign: null,
    country: null,
    region: null,
    city: null,
    device: "phone" as const,
    browser: "Safari",
    os: "iOS",
  };

  it("stores a view once, whatever the page sends twice", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await insertView(row);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO analytics_views/);
    expect(sql).toMatch(/ON CONFLICT \(view_id\) DO NOTHING/);
    expect(params).toContain("/donate");
    expect(params).toContain("0123456789abcdef");
  });

  it("only ever raises the time and scroll of a view", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await recordLeave("00112233445566ff", 30, 80);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/GREATEST\(COALESCE\(active_seconds, 0\), \$2\)/);
    expect(sql).toMatch(/GREATEST\(COALESCE\(max_scroll, 0\), \$3\)/);
    expect(params).toEqual(["00112233445566ff", 30, 80]);
  });

  it("stores a click only for a view that was counted", async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    await insertClick({ viewId: "00112233445566ff", at: row.at, day: row.day, kind: "donate", label: "Donate" });
    const [sql] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO analytics_clicks/);
    expect(sql).toMatch(/WHERE EXISTS \(SELECT 1 FROM analytics_views WHERE view_id = \$1\)/);
  });

  it("finds the channel of the visitor's latest view that day", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ channel: "social", source: "Facebook", campaign: null }] });
    expect(await lastArrival("2026-10-01", "0123456789abcdef")).toEqual({ channel: "social", source: "Facebook", campaign: null });
    expect(queryMock.mock.calls[0][0]).toMatch(/ORDER BY at DESC LIMIT 1/);
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await lastArrival("2026-10-01", "0123456789abcdef")).toBeNull();
  });
});

describe("pruneAnalytics", () => {
  it("deletes views and clicks older than 13 months and every salt older than today", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 3 })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rowCount: 1 });
    const result = await pruneAnalytics(new Date("2026-10-01T07:00:00Z"));
    expect(result).toEqual({ views: 3, clicks: 2, salts: 1 });
    const calls = queryMock.mock.calls.map((c) => [String(c[0]), c[1]]);
    expect(calls[0][0]).toMatch(/DELETE FROM analytics_views WHERE day < \$1/);
    expect(calls[0][1]).toEqual(["2025-09-01"]);
    expect(calls[1][0]).toMatch(/DELETE FROM analytics_clicks WHERE day < \$1/);
    expect(calls[1][1]).toEqual(["2025-09-01"]);
    expect(calls[2][0]).toMatch(/DELETE FROM analytics_salts WHERE day < \$1/);
    expect(calls[2][1]).toEqual(["2026-10-01"]);
  });
});
