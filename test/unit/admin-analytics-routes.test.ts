import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-482: the Admin > Analytics API.
//
//   GET /api/admin/analytics?days=7|30|90   analytics: view
//   GET /api/admin/analytics/settings        analytics: view
//   PUT /api/admin/analytics/settings        analytics: edit, { collecting }
//   GET /api/admin/analytics/now             analytics: view, just "right now" (the Check again button)
//
// The analytics section is admins only by role (TASK-479), so a plain editor or viewer is refused,
// and someone given view on Team > Manage access can look but not flip the switch. Changing the
// switch goes through setCollecting (which writes the audit row) and then makes POST /api/pulse
// forget the switch it remembered, so the change takes effect at once.

const { readReportMock, readNowMock, getSettingsMock, setCollectingMock, forgetMock, getUserAuthRowMock } = vi.hoisted(() => ({
  readReportMock: vi.fn(),
  readNowMock: vi.fn(),
  getSettingsMock: vi.fn(),
  setCollectingMock: vi.fn(),
  forgetMock: vi.fn(),
  getUserAuthRowMock: vi.fn(),
}));
vi.mock("../../src/db/analytics-report", () => ({ readAnalyticsReport: readReportMock, readRightNow: readNowMock }));
vi.mock("../../src/db/analytics", () => ({ getAnalyticsSettings: getSettingsMock, setCollecting: setCollectingMock }));
vi.mock("../../src/routes/pulse", () => ({ pulseSwitch: { forget: forgetMock } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { getAnalytics, getAnalyticsNow, getAnalyticsSettingsRoute, putAnalyticsSettings } from "../../src/routes/admin-analytics";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const EMAIL = "robin.analytics@nbcc.test";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
}

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
type Opts = { token?: string | null; body?: unknown; query?: Record<string, string> };
function req(o: Opts) {
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  return { headers, body: o.body ?? {}, query: o.query ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<void>;
async function run(handler: Handler, o: Opts) {
  const res = mockRes();
  await handler(req(o) as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const SETTINGS = { collecting: true, updatedAt: "2026-09-30T20:00:00.000Z", updatedBy: "admin:" + EMAIL };

beforeEach(() => {
  readReportMock.mockReset().mockResolvedValue({ days: 30, current: {}, previous: {}, rightNow: { collecting: true, people: 0 } });
  readNowMock.mockReset().mockResolvedValue({ collecting: true, people: 4 });
  getSettingsMock.mockReset().mockResolvedValue({ collecting: false, updatedAt: null, updatedBy: null });
  setCollectingMock.mockReset().mockResolvedValue(SETTINGS);
  forgetMock.mockReset();
  getUserAuthRowMock.mockReset();
});

describe("who may read the numbers", () => {
  it("needs a session", async () => {
    expect((await run(getAnalytics, { token: null })).statusCode).toBe(401);
    expect(readReportMock).not.toHaveBeenCalled();
  });

  it.each(["editor", "viewer"])("refuses a plain %s, since analytics is admins only by role", async (role) => {
    expect((await run(getAnalytics, { token: tokenFor(role) })).statusCode).toBe(403);
    expect((await run(getAnalyticsSettingsRoute, { token: tokenFor(role) })).statusCode).toBe(403);
  });

  it("lets an admin read them, for the last 30 days unless asked otherwise", async () => {
    const res = await run(getAnalytics, { token: tokenFor("admin") });
    expect(res.statusCode).toBe(200);
    expect(readReportMock).toHaveBeenCalledWith(30);
  });

  it("lets someone given analytics view read them", async () => {
    const token = tokenFor("viewer", { analytics: "view" });
    expect((await run(getAnalytics, { token, query: { days: "7" } })).statusCode).toBe(200);
    expect(readReportMock).toHaveBeenCalledWith(7);
    expect((await run(getAnalyticsSettingsRoute, { token })).body).toEqual({
      collecting: false,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it("accepts 7, 30 or 90 days and nothing else", async () => {
    const token = tokenFor("admin");
    expect((await run(getAnalytics, { token, query: { days: "90" } })).statusCode).toBe(200);
    for (const days of ["12", "abc", "-7"]) {
      expect((await run(getAnalytics, { token, query: { days } })).statusCode).toBe(400);
    }
    expect(readReportMock).toHaveBeenCalledTimes(1);
  });

  it("says it could not load when the database fails, without the details", async () => {
    readReportMock.mockRejectedValue(new Error("connection refused at 10.0.0.1"));
    const res = await run(getAnalytics, { token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("10.0.0.1");
  });
});

describe("right now on its own (Check again)", () => {
  it("needs analytics view, like the rest", async () => {
    expect((await run(getAnalyticsNow, { token: null })).statusCode).toBe(401);
    expect((await run(getAnalyticsNow, { token: tokenFor("editor") })).statusCode).toBe(403);
    expect(readNowMock).not.toHaveBeenCalled();
  });

  it("answers with just the people on the site and whether counting is on, without the whole report", async () => {
    const res = await run(getAnalyticsNow, { token: tokenFor("viewer", { analytics: "view" }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ collecting: true, people: 4 });
    expect(readReportMock).not.toHaveBeenCalled();
  });

  it("says it could not load when the database fails", async () => {
    readNowMock.mockRejectedValue(new Error("boom"));
    expect((await run(getAnalyticsNow, { token: tokenFor("admin") })).statusCode).toBe(500);
  });
});

describe("the collecting switch", () => {
  it("cannot be changed with view only", async () => {
    const res = await run(putAnalyticsSettings, { token: tokenFor("viewer", { analytics: "view" }), body: { collecting: true } });
    expect(res.statusCode).toBe(403);
    expect(setCollectingMock).not.toHaveBeenCalled();
    expect(forgetMock).not.toHaveBeenCalled();
  });

  it("is changed by someone with edit, recorded against them, and taken up by the counter at once", async () => {
    const res = await run(putAnalyticsSettings, { token: tokenFor("admin"), body: { collecting: true } });
    expect(res.statusCode).toBe(200);
    expect(setCollectingMock).toHaveBeenCalledWith(true, "admin:" + EMAIL);
    expect(forgetMock).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual(SETTINGS);
  });

  it.each([[{}], [{ collecting: "yes" }], [{ collecting: true, extra: 1 }]])("refuses a body that is not just on or off: %j", async (body) => {
    const res = await run(putAnalyticsSettings, { token: tokenFor("admin"), body });
    expect(res.statusCode).toBe(400);
    expect(setCollectingMock).not.toHaveBeenCalled();
  });

  it("says it could not be saved when the database fails", async () => {
    setCollectingMock.mockRejectedValue(new Error("boom"));
    const res = await run(putAnalyticsSettings, { token: tokenFor("admin"), body: { collecting: false } });
    expect(res.statusCode).toBe(500);
  });
});
