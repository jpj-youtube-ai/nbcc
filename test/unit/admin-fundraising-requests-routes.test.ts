import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-505: the API behind the Requests part of each sign up in Admin > Fundraising. Viewers see
// where every request is up to; editors and admins move them on (or Undo). The database is mocked.
// Every name, place and number is invented.

const { getUserAuthRowMock, listAllFundraisers, listRequestRows, changeRequest } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  listAllFundraisers: vi.fn(),
  listRequestRows: vi.fn(),
  changeRequest: vi.fn(),
}));

vi.mock("../../src/db/fundraising-requests", () => {
  class RequestError extends Error {
    constructor(
      public readonly reason: string,
      message: string,
      public readonly field?: string,
    ) {
      super(message);
    }
  }
  return { listRequestRows, changeRequest, RequestError };
});
vi.mock("../../src/db/fundraisers", () => ({ listAllFundraisers }));
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

import * as routes from "../../src/routes/admin-fundraising-requests";
import { signAdminSession } from "../../src/admin/session";
import { RequestError } from "../../src/db/fundraising-requests";

const SECRET = "test-admin-secret";
const EMAIL = "fern@example.com";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: EMAIL, status: "active", role, permissions });
  return signAdminSession({ sub: 3, email: EMAIL, role, now: new Date(), secret: SECRET }).token;
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
type Opts = { token?: string | null; body?: unknown; params?: Record<string, string> };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: Opts = {}) {
  const res = mockRes();
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {} } as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
const fundraiser = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  status: "approved",
  eventDate: "2026-12-12",
  socialOk: true,
  wants: { ...NONE },
  ...over,
});

const SEND = { action: "send", from: "to_send", on: "2026-12-03", how: "post", by: "Fern", quantity: 10 };
const P = { id: "9", kind: "posters" };

beforeEach(() => {
  getUserAuthRowMock.mockReset();
  listAllFundraisers.mockReset().mockResolvedValue([]);
  listRequestRows.mockReset().mockResolvedValue([]);
  changeRequest.mockReset().mockResolvedValue({ row: { fundraiserId: 9, kind: "posters", status: "sent" }, words: "Posters: sent (by post)" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("who may do what", () => {
  it.each([
    ["seeing the requests", routes.getFundraisingRequests, {}],
    ["changing one", routes.postFundraiserRequest, { params: P, body: SEND }],
  ] as Array<[string, Handler, Opts]>)("%s needs a session", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: null })).statusCode).toBe(401);
  });

  for (const role of ["admin", "editor", "viewer"]) {
    it(`a${role === "admin" ? "n" : ""} ${role} may see where every request is up to`, async () => {
      expect((await run(routes.getFundraisingRequests, { token: tokenFor(role) })).statusCode).toBe(200);
    });
  }

  for (const role of ["admin", "editor"]) {
    it(`a${role === "admin" ? "n" : ""} ${role} may move a request on`, async () => {
      const res = await run(routes.postFundraiserRequest, { token: tokenFor(role), params: P, body: SEND });
      expect(res.statusCode).toBe(200);
      expect(changeRequest).toHaveBeenCalled();
    });
  }

  it("a viewer may not change anything", async () => {
    const res = await run(routes.postFundraiserRequest, { token: tokenFor("viewer"), params: P, body: SEND });
    expect(res.statusCode).toBe(403);
    expect(changeRequest).not.toHaveBeenCalled();
  });

  it("someone without fundraising access sees none of it", async () => {
    expect((await run(routes.getFundraisingRequests, { token: tokenFor("admin", { fundraising: "none" }) })).statusCode).toBe(403);
  });

  it("someone with fundraising view only may look but not change", async () => {
    expect((await run(routes.getFundraisingRequests, { token: tokenFor("editor", { fundraising: "view" }) })).statusCode).toBe(200);
    expect((await run(routes.postFundraiserRequest, { token: tokenFor("editor", { fundraising: "view" }), params: P, body: SEND })).statusCode).toBe(403);
  });
});

describe("seeing the requests", () => {
  it("gives each sign up's requests, which have some to do, and the totals the Monday summary uses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-07T10:00:00Z"));
    try {
      listAllFundraisers.mockResolvedValue([
        fundraiser(9, { wants: { ...NONE, posterCount: 10 } }),
        fundraiser(10, { wants: { ...NONE, bucketCount: 2 }, eventDate: "2026-11-20" }),
        fundraiser(11),
      ]);
      listRequestRows.mockResolvedValue([
        { fundraiserId: 10, kind: "buckets", status: "with_them", quantity: 2, quantityBack: null, how: null, sentOn: "2026-11-10", backOn: null, doneOn: null, handledBy: "Fern", going: null, note: null, backNote: null, link: null, updatedAt: null, updatedBy: null },
      ]);
      const res = await run(routes.getFundraisingRequests, { token: tokenFor("viewer") });
      const body = res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(body.today).toBe("2026-12-07");
      expect(Object.keys(body.requests).sort()).toEqual(["10", "9"]);
      expect(body.requests["9"][0]).toMatchObject({ kind: "posters", status: "to_send", asked: 10, actions: ["send"] });
      expect(body.requests["10"][0]).toMatchObject({ kind: "buckets", status: "with_them", dueOn: "2026-12-04", dueBack: true });
      expect(body.toDo).toEqual({ "9": true });
      expect(body.notBack).toEqual({ "10": true });
      expect(body.totals).toMatchObject({ toDoFundraisers: 1, notBack: 2, notBackDue: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("says it is unavailable when it cannot read", async () => {
    listRequestRows.mockRejectedValue(new Error("db down"));
    const res = await run(routes.getFundraisingRequests, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("changing a request", () => {
  it("passes what was entered, who did it, and today as a UK day", async () => {
    vi.useFakeTimers();
    // 23:30 UTC on 30 June is already 1 July in the UK (British Summer Time).
    vi.setSystemTime(new Date("2026-06-30T23:30:00Z"));
    try {
      const res = await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: P, body: { ...SEND, on: "2026-07-01" } });
      expect(res.statusCode).toBe(200);
      expect(changeRequest).toHaveBeenCalledWith(9, "posters", { ...SEND, on: "2026-07-01" }, "admin:fern@example.com", "2026-07-01");
      expect(res.body).toMatchObject({ words: "Posters: sent (by post)" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a kind it does not know, and an id that is not a number", async () => {
    expect((await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: { id: "9", kind: "pigeons" }, body: SEND })).statusCode).toBe(404);
    expect((await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: { id: "x", kind: "posters" }, body: SEND })).statusCode).toBe(400);
    expect(changeRequest).not.toHaveBeenCalled();
  });

  it("says which boxes need another look", async () => {
    const res = await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: P, body: { ...SEND, by: "", quantity: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: "Some of it needs another look", fields: { by: "Say who did it.", quantity: "Give how many, from 1 to 1,000." } });
    expect(changeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404, "That fundraiser no longer exists"],
    ["not_asked", 404, "They did not ask for that."],
    ["conflict", 409, "Someone else changed this a moment ago. It now shows how it stands."],
    ["not_allowed", 409, "That can't be done to this request now."],
  ])("answers %s with %i and its words", async (reason, status, message) => {
    changeRequest.mockRejectedValue(new RequestError(reason, message));
    const res = await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: P, body: SEND });
    expect(res.statusCode).toBe(status);
    expect(res.body).toEqual({ error: message });
  });

  it("gives a rule's field back as a field message", async () => {
    changeRequest.mockRejectedValue(new RequestError("invalid", "That date is still to come.", "on"));
    const res = await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: P, body: SEND });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Some of it needs another look", fields: { on: "That date is still to come." } });
  });

  it("says it is unavailable, never why, when the database fails", async () => {
    changeRequest.mockRejectedValue(new Error("connection reset"));
    const res = await run(routes.postFundraiserRequest, { token: tokenFor("editor"), params: P, body: SEND });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});
