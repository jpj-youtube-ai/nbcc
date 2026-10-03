import { describe, it, expect, vi, beforeEach } from "vitest";

// Fundraising categories in Admin > Fundraising: anyone who can see Fundraising sees the list (the
// sign up editor needs it to change a sign up's category); only an admin adds, renames or hides one.
// The database is mocked. Every name and address here is invented.

const db = vi.hoisted(() => ({
  listCategories: vi.fn(),
  addCategory: vi.fn(),
  updateCategory: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/fundraising-categories", () => {
  class CategoryError extends Error {
    constructor(
      public readonly reason: string,
      public readonly key?: string,
    ) {
      super(reason);
    }
  }
  return { ...db, CategoryError };
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

import * as routes from "../../src/routes/admin-fundraising-categories";
import { signAdminSession } from "../../src/admin/session";
import { CategoryError } from "../../src/db/fundraising-categories";

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

const cat = (key: string, label: string, active = true) => ({ key, label, active, used: 0 });

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  getUserAuthRowMock.mockReset();
  db.listCategories.mockResolvedValue([cat("quiz", "Quiz"), cat("run_walk", "Run or walk", false), cat("other", "Other")]);
  db.addCategory.mockImplementation(async (label: string) => cat("sponsored_silence", label));
  db.updateCategory.mockImplementation(async (key: string, change: { label?: string; active?: boolean }) => ({ ...cat(key, change.label ?? "Quiz"), active: change.active ?? true }));
});

const ADD: Opts = { body: { label: "Sponsored silence" } };
const CHANGE: Opts = { params: { key: "quiz" }, body: { label: "Quiz night" } };

describe("who may do what", () => {
  it.each([
    ["the list", routes.getAdminCategories, {}],
    ["adding", routes.postAdminCategory, ADD],
    ["changing", routes.patchAdminCategory, CHANGE],
  ] as Array<[string, Handler, Opts]>)("%s needs a session", async (_w, handler, o) => {
    expect((await run(handler, { ...o, token: null })).statusCode).toBe(401);
  });

  it.each(["viewer", "editor", "admin"])("a %s with Fundraising may see the list", async (role) => {
    const res = await run(routes.getAdminCategories, { token: tokenFor(role) });
    expect(res.statusCode).toBe(200);
    expect((res.body as { categories: Array<{ key: string }> }).categories.map((c) => c.key)).toEqual(["quiz", "run_walk", "other"]);
    // With how many sign ups have each: only this list counts them.
    expect(db.listCategories).toHaveBeenCalledWith({ used: true });
  });

  it("someone without Fundraising may not see it", async () => {
    expect((await run(routes.getAdminCategories, { token: tokenFor("editor", { fundraising: "none" }) })).statusCode).toBe(403);
  });

  it.each(["viewer", "editor"])("a %s may not add, rename or hide one", async (role) => {
    expect((await run(routes.postAdminCategory, { ...ADD, token: tokenFor(role) })).statusCode).toBe(403);
    expect((await run(routes.patchAdminCategory, { ...CHANGE, token: tokenFor(role) })).statusCode).toBe(403);
    expect((await run(routes.patchAdminCategory, { params: { key: "quiz" }, body: { active: false }, token: tokenFor(role) })).statusCode).toBe(403);
    expect(db.addCategory).not.toHaveBeenCalled();
    expect(db.updateCategory).not.toHaveBeenCalled();
  });
});

describe("an admin adding a category", () => {
  it("adds it, tidied, as the admin who did it", async () => {
    const res = await run(routes.postAdminCategory, { token: tokenFor("admin"), body: { label: "  sponsored   silence " } });
    expect(res.statusCode).toBe(201);
    expect(db.addCategory).toHaveBeenCalledWith("Sponsored silence", `admin:${EMAIL}`);
    expect(res.body).toEqual({ category: cat("sponsored_silence", "Sponsored silence") });
  });

  it.each([
    ["no name", {}],
    ["an empty name", { label: " " }],
    ["a name too long", { label: "a".repeat(41) }],
    ["something else besides", { label: "Abseil", key: "abseil" }],
  ])("refuses %s", async (_w, body) => {
    const res = await run(routes.postAdminCategory, { token: tokenFor("admin"), body });
    expect(res.statusCode).toBe(400);
    expect(db.addCategory).not.toHaveBeenCalled();
  });

  it("says so when the name is already there, hidden or not", async () => {
    db.addCategory.mockRejectedValue(new CategoryError("label_taken", "walk"));
    const res = await run(routes.postAdminCategory, { token: tokenFor("admin"), body: { label: "Walk" } });
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe("There is already a category called that. If it is hidden, bring it back instead.");
  });
});

describe("an admin changing a category", () => {
  it("renames it", async () => {
    const res = await run(routes.patchAdminCategory, { ...CHANGE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(200);
    expect(db.updateCategory).toHaveBeenCalledWith("quiz", { label: "Quiz night" }, `admin:${EMAIL}`);
  });

  it("hides it from the form, and brings it back", async () => {
    await run(routes.patchAdminCategory, { params: { key: "quiz" }, body: { active: false }, token: tokenFor("admin") });
    expect(db.updateCategory).toHaveBeenLastCalledWith("quiz", { active: false }, `admin:${EMAIL}`);
    await run(routes.patchAdminCategory, { params: { key: "run_walk" }, body: { active: true }, token: tokenFor("admin") });
    expect(db.updateCategory).toHaveBeenLastCalledWith("run_walk", { active: true }, `admin:${EMAIL}`);
  });

  it.each([
    ["nothing to change", { params: { key: "quiz" }, body: {} }],
    ["a key that is not a key", { params: { key: "Quiz Night!" }, body: { active: false } }],
    ["a deletion", { params: { key: "quiz" }, body: { deleted: true } }],
  ] as Array<[string, Opts]>)("refuses %s", async (_w, o) => {
    expect((await run(routes.patchAdminCategory, { ...o, token: tokenFor("admin") })).statusCode).toBe(400);
    expect(db.updateCategory).not.toHaveBeenCalled();
  });

  it("never hides Other", async () => {
    db.updateCategory.mockRejectedValue(new CategoryError("other_always_on"));
    const res = await run(routes.patchAdminCategory, { params: { key: "other" }, body: { active: false }, token: tokenFor("admin") });
    expect(res.statusCode).toBe(409);
    expect((res.body as { error: string }).error).toBe("Other is always on the form, so it cannot be hidden.");
  });

  it("says when it is not there", async () => {
    db.updateCategory.mockRejectedValue(new CategoryError("not_found"));
    expect((await run(routes.patchAdminCategory, { ...CHANGE, token: tokenFor("admin") })).statusCode).toBe(404);
  });

  it("answers a failure in plain words, without the details", async () => {
    db.updateCategory.mockRejectedValue(new Error("connection reset"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await run(routes.patchAdminCategory, { ...CHANGE, token: tokenFor("admin") });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
    err.mockRestore();
  });
});
