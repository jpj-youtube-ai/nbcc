import { describe, it, expect, vi, beforeEach } from "vitest";

// What gifts could do, in Admin > Fundraising: anyone who can see Fundraising sees the list; only an
// admin adds, changes, switches off or reorders one, as with the Categories (both change public
// pages). The words must say could, and never will buy or will pay for. The database is mocked.
// Every name and address here is invented.

const db = vi.hoisted(() => ({
  listImpactExamples: vi.fn(),
  addImpactExample: vi.fn(),
  updateImpactExample: vi.fn(),
  moveImpactExample: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/impact-examples", () => {
  class ImpactExampleError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...db, ImpactExampleError };
});
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

import * as routes from "../../src/routes/admin-impact-examples";
import { signAdminSession } from "../../src/admin/session";
import { ImpactExampleError } from "../../src/db/impact-examples";

const SECRET = "test-admin-secret";
const EMAIL = "kim.fundraising@nbcc.test";
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

const example = (id: number, amountPence: number, wording: string, over: Record<string, unknown> = {}) => ({
  id,
  amountPence,
  wording,
  active: true,
  sortOrder: id * 10,
  onGiveForm: true,
  meterLine: null,
  ...over,
});
const errorOf = (res: MockRes) => (res.body as { error: string }).error;

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  db.listImpactExamples.mockResolvedValue([example(1, 500, "could help put a cosy pair of pyjamas in a Red Bag")]);
  db.addImpactExample.mockImplementation(async (e: { amountPence: number; wording: string; onGiveForm: boolean }) => example(9, e.amountPence, e.wording, { onGiveForm: e.onGiveForm }));
  db.updateImpactExample.mockImplementation(async (id: number, change: Record<string, unknown>) => ({ ...example(id, 500, "could help buy a hat"), ...change }));
  db.moveImpactExample.mockResolvedValue(undefined);
});

const ADD: Opts = { body: { amountPence: 10000, wording: "could help buy a warm winter coat" } };
const CHANGE: Opts = { params: { id: "1" }, body: { active: false } };
const MOVE: Opts = { params: { id: "1" }, body: { direction: "down" } };

describe("who may do what", () => {
  it.each([
    ["the list", routes.getAdminImpactExamples, {}],
    ["adding", routes.postAdminImpactExample, ADD],
    ["changing", routes.patchAdminImpactExample, CHANGE],
    ["moving", routes.postMoveImpactExample, MOVE],
  ] as Array<[string, Handler, Opts]>)("%s needs a session", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: null })).statusCode).toBe(401);
  });

  it.each(["viewer", "editor", "admin"])("a %s with Fundraising may see the list", async (role) => {
    const res = await run(routes.getAdminImpactExamples, { token: tokenFor(role) });
    expect(res.statusCode).toBe(200);
    expect((res.body as { examples: Array<{ id: number }> }).examples.map((e) => e.id)).toEqual([1]);
  });

  it("someone without Fundraising may not see it", async () => {
    expect((await run(routes.getAdminImpactExamples, { token: tokenFor("editor", { fundraising: "none" }) })).statusCode).toBe(403);
  });

  it.each(["viewer", "editor"])("a %s may not add, change or move one", async (role) => {
    expect((await run(routes.postAdminImpactExample, { ...ADD, token: tokenFor(role) })).statusCode).toBe(403);
    expect((await run(routes.patchAdminImpactExample, { ...CHANGE, token: tokenFor(role) })).statusCode).toBe(403);
    expect((await run(routes.postMoveImpactExample, { ...MOVE, token: tokenFor(role) })).statusCode).toBe(403);
    expect(db.addImpactExample).not.toHaveBeenCalled();
    expect(db.updateImpactExample).not.toHaveBeenCalled();
    expect(db.moveImpactExample).not.toHaveBeenCalled();
  });
});

describe("adding one", () => {
  it("saves the amount and the tidied words, on the give form unless told otherwise, by the admin", async () => {
    const res = await run(routes.postAdminImpactExample, { body: { amountPence: 10000, wording: "  Could help buy  a warm winter coat " }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(201);
    expect(db.addImpactExample).toHaveBeenCalledWith({ amountPence: 10000, wording: "could help buy a warm winter coat", onGiveForm: true }, `admin:${EMAIL}`);
    expect((res.body as { example: { id: number } }).example.id).toBe(9);
  });

  it("can be for big totals only", async () => {
    await run(routes.postAdminImpactExample, { body: { ...(ADD.body as object), onGiveForm: false }, token: tokenFor("admin") });
    expect(db.addImpactExample.mock.calls[0][0]).toMatchObject({ onGiveForm: false });
  });

  it("refuses words without could", async () => {
    const res = await run(routes.postAdminImpactExample, { body: { amountPence: 2500, wording: "helps buy a pair of school shoes" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatch(/could/);
    expect(db.addImpactExample).not.toHaveBeenCalled();
  });

  it.each(["will buy a pair of school shoes, it could", "could help, and will pay for a coat"])("refuses %j", async (wording) => {
    const res = await run(routes.postAdminImpactExample, { body: { amountPence: 2500, wording }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatch(/will buy/);
    expect(db.addImpactExample).not.toHaveBeenCalled();
  });

  it("refuses an amount under £1, or not whole pence", async () => {
    for (const amountPence of [50, 25.5, "2500", null]) {
      const res = await run(routes.postAdminImpactExample, { body: { amountPence, wording: "could help buy a hat" }, token: tokenFor("admin") });
      expect(res.statusCode, String(amountPence)).toBe(400);
    }
    expect(db.addImpactExample).not.toHaveBeenCalled();
  });

  it("refuses anything it does not know, such as which meter line it is", async () => {
    const res = await run(routes.postAdminImpactExample, { body: { ...(ADD.body as object), meterLine: "red_bags" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
  });
});

describe("changing one", () => {
  it("saves what is sent, by the admin", async () => {
    const res = await run(routes.patchAdminImpactExample, {
      params: { id: "3" },
      body: { amountPence: 3000, wording: "could help buy school shoes that fit", onGiveForm: false, active: true },
      token: tokenFor("admin"),
    });
    expect(res.statusCode).toBe(200);
    expect(db.updateImpactExample).toHaveBeenCalledWith(
      3,
      { amountPence: 3000, wording: "could help buy school shoes that fit", onGiveForm: false, active: true },
      `admin:${EMAIL}`,
    );
  });

  it("refuses new words without could", async () => {
    const res = await run(routes.patchAdminImpactExample, { params: { id: "3" }, body: { wording: "pays for school shoes" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(db.updateImpactExample).not.toHaveBeenCalled();
  });

  it("needs something to change, and a real id", async () => {
    expect((await run(routes.patchAdminImpactExample, { params: { id: "3" }, body: {}, token: tokenFor("admin") })).statusCode).toBe(400);
    expect((await run(routes.patchAdminImpactExample, { params: { id: "x" }, body: { active: true }, token: tokenFor("admin") })).statusCode).toBe(400);
  });

  it("says when it is not there any more", async () => {
    db.updateImpactExample.mockRejectedValue(new ImpactExampleError("not_found"));
    const res = await run(routes.patchAdminImpactExample, { ...CHANGE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to change the amount or words of one the meter line counts with, plainly", async () => {
    db.updateImpactExample.mockRejectedValue(new ImpactExampleError("fixed"));
    const res = await run(routes.patchAdminImpactExample, { params: { id: "3" }, body: { amountPence: 6000 }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe("This example is used for the line under the meter, so its words and amount are fixed. You can switch it off or on.");
  });

  it("turns the table's own check on the words into a plain 400, not a 500", async () => {
    const check = Object.assign(new Error("new row violates check constraint"), { code: "23514" });
    db.addImpactExample.mockRejectedValue(check);
    const res = await run(routes.postAdminImpactExample, { ...ADD, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
    expect(errorOf(res)).toMatch(/Start with could/);
  });

  it("says the admin is unavailable when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.updateImpactExample.mockRejectedValue(new Error("database down"));
    const res = await run(routes.patchAdminImpactExample, { ...CHANGE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
  });
});

describe("moving one", () => {
  it("moves it up or down, and answers with the list as it is now", async () => {
    const res = await run(routes.postMoveImpactExample, { ...MOVE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(200);
    expect(db.moveImpactExample).toHaveBeenCalledWith(1, "down", `admin:${EMAIL}`);
    expect((res.body as { examples: unknown[] }).examples).toHaveLength(1);
  });

  it("refuses any other way", async () => {
    const res = await run(routes.postMoveImpactExample, { params: { id: "1" }, body: { direction: "sideways" }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(400);
  });

  it("says when it is not there any more", async () => {
    db.moveImpactExample.mockRejectedValue(new ImpactExampleError("not_found"));
    expect((await run(routes.postMoveImpactExample, { ...MOVE, token: tokenFor("admin") })).statusCode).toBe(404);
  });
});
