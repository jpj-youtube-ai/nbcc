import { describe, it, expect, vi, beforeEach } from "vitest";

// The sign up tidy's routes: staff correct "Sporting event?" and the T shirt size (Fundraising edit),
// and send the organiser a private link to choose a size (never automatic); the organiser opens the
// link and chooses. The database and the email are mocked. Every name here is invented.

const db = vi.hoisted(() => ({
  setWelcomePack: vi.fn(),
  saveTshirtLink: vi.fn(),
  readTshirtLink: vi.fn(),
  chooseTshirtSize: vi.fn(),
}));
const { getFundraiser, sendTshirtAsk, getUserAuthRowMock } = vi.hoisted(() => ({
  getFundraiser: vi.fn(),
  sendTshirtAsk: vi.fn(),
  getUserAuthRowMock: vi.fn(),
}));
vi.mock("../../src/db/fundraiser-signup-tidy", () => db);
vi.mock("../../src/db/fundraisers", () => {
  class FundraiserError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { getFundraiser, FundraiserError, fundraisingIsOn: vi.fn(async () => true) };
});
vi.mock("../../src/fundraising/send", () => ({ sendTshirtAsk }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/fundraise-signup-tidy";
import { signAdminSession } from "../../src/admin/session";
import { FundraiserError } from "../../src/db/fundraisers";
import { hashTshirtToken, TSHIRT_SIZES } from "../../src/fundraising/signup-tidy";

const EMAIL = "kim@nbcc.test";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: EMAIL, role, now: new Date(), secret: "test-admin-secret" }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: { token?: string | null; body?: unknown; params?: Record<string, string>; ip?: string } = {}) {
  const res = { statusCode: 200, body: undefined as unknown } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  const headers: Record<string, string> = { host: "nbcc.test", "sec-fetch-site": "same-origin" };
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {}, ip: o.ip ?? "203.0.113.9" } as any, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const record = (over: Record<string, unknown> = {}) => ({
  id: 9, name: "Sam Sample", firstName: "Sam", email: "sam@example.com", title: "Sam's Walk", status: "new", isSporting: true, tshirtSize: null, ...over,
});
const LINK = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

beforeEach(() => {
  for (const fn of [...Object.values(db), getFundraiser, sendTshirtAsk, getUserAuthRowMock]) fn.mockReset();
  routes.tshirtLimiterReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db.setWelcomePack.mockImplementation(async (_id: number, c: Record<string, unknown>) => record(c));
  db.saveTshirtLink.mockResolvedValue(record());
  getFundraiser.mockResolvedValue(record());
  sendTshirtAsk.mockResolvedValue(undefined);
});

describe("staff correcting sport and the t-shirt", () => {
  it("needs Fundraising edit", async () => {
    const body = { isSporting: true, tshirtSize: "adult_m" };
    expect((await run(routes.putWelcomePack, { params: { id: "9" }, body })).statusCode).toBe(401);
    expect((await run(routes.putWelcomePack, { params: { id: "9" }, body, token: tokenFor("viewer") })).statusCode).toBe(403);
    expect(db.setWelcomePack).not.toHaveBeenCalled();
  });

  it.each(["editor", "admin"])("lets an %s save it, as who they are", async (role) => {
    const res = await run(routes.putWelcomePack, { params: { id: "9" }, body: { isSporting: true, tshirtSize: "adult_m" }, token: tokenFor(role) });
    expect(res.statusCode).toBe(200);
    expect(db.setWelcomePack).toHaveBeenCalledWith(9, { isSporting: true, tshirtSize: "adult_m" }, `admin:${EMAIL}`);
  });

  it("refuses a size not on the list", async () => {
    const res = await run(routes.putWelcomePack, { params: { id: "9" }, body: { isSporting: true, tshirtSize: "huge" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(db.setWelcomePack).not.toHaveBeenCalled();
  });

  it("says when the sign up is not there", async () => {
    db.setWelcomePack.mockRejectedValue(new FundraiserError("not_found"));
    expect((await run(routes.putWelcomePack, { params: { id: "9" }, body: { isSporting: false }, token: tokenFor("admin") })).statusCode).toBe(404);
  });
});

describe("asking them for their T shirt size", () => {
  it("needs Fundraising edit", async () => {
    expect((await run(routes.postTshirtAsk, { params: { id: "9" }, token: tokenFor("viewer") })).statusCode).toBe(403);
    expect(sendTshirtAsk).not.toHaveBeenCalled();
  });

  it("keeps only the link's hash, and emails them the link", async () => {
    const res = await run(routes.postTshirtAsk, { params: { id: "9" }, token: tokenFor("editor") });
    expect(res.statusCode).toBe(200);
    const [id, hash, actor] = db.saveTshirtLink.mock.calls[0];
    expect([id, actor]).toEqual([9, `admin:${EMAIL}`]);
    const token = sendTshirtAsk.mock.calls[0][1];
    expect(hash).toBe(hashTshirtToken(token));
    expect(JSON.stringify(res.body)).not.toContain(token);
  });

  it("is refused for one that is not a sporting event, or has a size", async () => {
    db.saveTshirtLink.mockRejectedValue(new FundraiserError("not_sporting"));
    expect((await run(routes.postTshirtAsk, { params: { id: "9" }, token: tokenFor("admin") })).statusCode).toBe(409);
    db.saveTshirtLink.mockRejectedValue(new FundraiserError("has_size"));
    expect((await run(routes.postTshirtAsk, { params: { id: "9" }, token: tokenFor("admin") })).statusCode).toBe(409);
    expect(sendTshirtAsk).not.toHaveBeenCalled();
  });

  it("says plainly when the email could not go", async () => {
    sendTshirtAsk.mockRejectedValue(new Error("SES down"));
    const res = await run(routes.postTshirtAsk, { params: { id: "9" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(502);
    expect((res.body as { error: string }).error).toBe("The email could not be sent just now. Please try again in a few minutes.");
  });
});

describe("the organiser's private link", () => {
  it("opens with their first name, the fundraiser and the sizes", async () => {
    db.readTshirtLink.mockResolvedValue(record({ tshirtAskedAt: new Date().toISOString() }));
    const res = await run(routes.postTshirtLook, { body: { token: LINK } });
    expect(res.statusCode).toBe(200);
    expect(db.readTshirtLink).toHaveBeenCalledWith(hashTshirtToken(LINK));
    expect(res.body).toEqual({ firstName: "Sam", title: "Sam's Walk", sizes: TSHIRT_SIZES });
  });

  it("gives one plain answer for a link that is not there, used or too old", async () => {
    db.readTshirtLink.mockResolvedValue(null);
    expect((await run(routes.postTshirtLook, { body: { token: LINK } })).statusCode).toBe(404);
    db.readTshirtLink.mockResolvedValue(record({ tshirtAskedAt: "2026-01-01T00:00:00Z" }));
    expect((await run(routes.postTshirtLook, { body: { token: LINK } })).statusCode).toBe(404);
    expect((await run(routes.postTshirtLook, { body: { token: "short" } })).statusCode).toBe(404);
  });

  it("saves the size they choose", async () => {
    db.chooseTshirtSize.mockResolvedValue(true);
    const res = await run(routes.postTshirtChoose, { body: { token: LINK, tshirtSize: "kids_9_10" } });
    expect(res.statusCode).toBe(200);
    expect(db.chooseTshirtSize).toHaveBeenCalledWith(hashTshirtToken(LINK), "kids_9_10", expect.any(Date));
  });

  it("asks for a size from the list", async () => {
    const res = await run(routes.postTshirtChoose, { body: { token: LINK, tshirtSize: "" } });
    expect(res.statusCode).toBe(400);
    expect((res.body as { fields: Record<string, string> }).fields.tshirtSize).toBe("Please choose a T shirt size.");
  });

  it("refuses a page on another website", async () => {
    const res = { statusCode: 200, body: undefined as unknown } as { statusCode: number; body: unknown; status: (c: number) => unknown; json: (b: unknown) => unknown };
    res.status = (c) => ((res.statusCode = c), res);
    res.json = (b) => ((res.body = b), res);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await routes.postTshirtChoose({ headers: { host: "nbcc.test", "sec-fetch-site": "cross-site" }, body: { token: LINK, tshirtSize: "adult_m" }, ip: "1" } as any, res as any);
    expect(res.statusCode).toBe(403);
  });

  it("limits tries from one address", async () => {
    db.readTshirtLink.mockResolvedValue(null);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await run(routes.postTshirtLook, { body: { token: LINK }, ip: "198.51.100.1" })).statusCode;
    expect(last).toBe(429);
  });
});
