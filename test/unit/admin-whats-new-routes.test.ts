import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-478: GET /api/admin/whats-new (which sections are new to the person asking) and
// POST /api/admin/whats-new/seen (they have just opened one). The database is mocked; the real
// queries are covered by features/whats-new.feature, which runs against Postgres in CI.

const { getSeenMock, markSeenMock, getAccountCreatedAtMock, latestArrivalMock, getUserAuthRowMock } = vi.hoisted(() => ({
  getSeenMock: vi.fn(),
  markSeenMock: vi.fn(),
  getAccountCreatedAtMock: vi.fn(),
  latestArrivalMock: vi.fn(),
  getUserAuthRowMock: vi.fn(),
}));
vi.mock("../../src/db/whats-new", () => ({
  getSeen: getSeenMock,
  markSeen: markSeenMock,
  getAccountCreatedAt: getAccountCreatedAtMock,
  latestArrival: latestArrivalMock,
}));
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

import { getWhatsNew, postWhatsNewSeen } from "../../src/routes/admin-whats-new";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string, permissions: Record<string, string> = {}) => {
  getUserAuthRowMock.mockResolvedValue({ id: 7, email: "kenny@nbcc.test", status: "active", role, permissions });
  return signAdminSession({ sub: 7, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function req(token: string | undefined, body: unknown = {}) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return { headers, body, params: {}, query: {} };
}

// Mocked handlers take Express types; the stand-ins above carry only what the routes read.
const call = async (handler: (rq: never, rs: never) => Promise<void>, rq: unknown) => {
  const res = mockRes();
  await handler(rq as never, res as never);
  return res;
};

const areasOf = (res: MockRes) => (res.body as { areas: Array<{ area: string; new: boolean; since: string }> }).areas;

beforeEach(() => {
  vi.clearAllMocks();
  getSeenMock.mockResolvedValue(new Map());
  getAccountCreatedAtMock.mockResolvedValue(new Date("2025-01-01T00:00:00Z"));
  latestArrivalMock.mockResolvedValue(null);
});

describe("GET /api/admin/whats-new", () => {
  it("needs a signed-in person", async () => {
    const res = await call(getWhatsNew, req(undefined));
    expect(res.statusCode).toBe(401);
  });

  it("lists only the sections the person may open", async () => {
    const res = await call(getWhatsNew, req(tokenFor("viewer")));
    const areas = areasOf(res).map((a) => a.area);
    expect(areas).toContain("contact");
    expect(areas).not.toContain("fulfilments");
  });

  it("says a section is new when something arrived after the person last opened it", async () => {
    getSeenMock.mockResolvedValue(new Map([["contact", new Date("2026-10-05T09:00:00Z")]]));
    latestArrivalMock.mockImplementation(async (area: string) =>
      area === "contact" ? new Date("2026-10-05T10:00:00Z") : null,
    );
    const areas = areasOf(await call(getWhatsNew, req(tokenFor("admin"))));
    const contact = areas.find((a) => a.area === "contact")!;
    expect(contact).toEqual({ area: "contact", new: true, since: "2026-10-05T09:00:00.000Z" });
    expect(latestArrivalMock).toHaveBeenCalledWith("contact", new Date("2026-10-05T09:00:00Z"));
    // A section with no arrival and no new part: the Festive Ball (Donations has a new part now).
    expect(areas.find((a) => a.area === "ball")!.new).toBe(false);
  });

  // The Events page, Monthly givers and old stories were all added today, after this account.
  it("says a section is new when a new part of the admin was added there", async () => {
    const areas = areasOf(await call(getWhatsNew, req(tokenFor("admin"))));
    expect(areas.find((a) => a.area === "events")!.new).toBe(true);
    expect(areas.find((a) => a.area === "ball")!.new).toBe(false);
  });

  it("still answers for the rest when one section's source fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    latestArrivalMock.mockImplementation(async (area: string) => {
      if (area === "contact") throw new Error("contact database is down");
      return area === "ball" ? new Date("2026-12-01T00:00:00Z") : null;
    });
    const res = await call(getWhatsNew, req(tokenFor("admin")));
    expect(res.statusCode).toBe(200);
    const areas = areasOf(res);
    expect(areas.find((a) => a.area === "contact")!.new).toBe(false);
    expect(areas.find((a) => a.area === "ball")!.new).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// The menu asks on every change of section, so a database that is down must get an answer, not an
// unhandled rejection.
describe("when the main database fails", () => {
  it("answers the list with a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    getSeenMock.mockRejectedValue(new Error("connection refused"));
    const res = await call(getWhatsNew, req(tokenFor("admin")));
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });

  it("answers a visit with a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    markSeenMock.mockRejectedValue(new Error("connection refused"));
    const res = await call(postWhatsNewSeen, req(tokenFor("admin"), { area: "contact" }));
    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });
});

describe("POST /api/admin/whats-new/seen", () => {
  it("records the visit and says when", async () => {
    markSeenMock.mockResolvedValue(new Date("2026-10-06T08:00:00Z"));
    const res = await call(postWhatsNewSeen, req(tokenFor("admin"), { area: "contact" }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ area: "contact", seenAt: "2026-10-06T08:00:00.000Z" });
    expect(markSeenMock).toHaveBeenCalledWith(7, "contact");
  });

  it("refuses a section that does not exist", async () => {
    const res = await call(postWhatsNewSeen, req(tokenFor("admin"), { area: "nope" }));
    expect(res.statusCode).toBe(400);
    expect(markSeenMock).not.toHaveBeenCalled();
  });

  it("refuses a section the person may not open", async () => {
    const res = await call(postWhatsNewSeen, req(tokenFor("viewer"), { area: "fulfilments" }));
    expect(res.statusCode).toBe(403);
    expect(markSeenMock).not.toHaveBeenCalled();
  });
});
