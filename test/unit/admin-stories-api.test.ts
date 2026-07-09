import { describe, it, expect, vi, beforeEach } from "vitest";

// Task C (REQ intent: "Admin panel can view, tag and manage submitted stories, incl.
// withdrawal."). GET /api/admin/stories (list), GET /api/admin/stories/:id (detail) and
// PATCH /api/admin/stories/:id (status/admin_tags/admin_notes) — all behind authorizeAdmin,
// all via src/db/stories (storiesPool), NEVER src/db/pool.ts / the charity DB. Mirrors the
// donor admin-api.test.ts mock/req/res style, but mocks ../../src/db/stories directly
// instead of the pool, since that module is Task C's only access to story data.

const { listStoriesMock, getStoryMock, updateStoryMock } = vi.hoisted(() => ({
  listStoriesMock: vi.fn(),
  getStoryMock: vi.fn(),
  updateStoryMock: vi.fn(),
}));
vi.mock("../../src/db/stories", () => ({
  listStories: listStoriesMock,
  getStory: getStoryMock,
  updateStory: updateStoryMock,
}));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
// admin.ts also imports these from ../db/admin and ../db/portal etc. at module load time;
// stub them minimally so importing the router doesn't require a real pool/DB.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { getAdminStories, getAdminStory, patchAdminStory } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string) =>
  signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
};
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function req(opts: { id?: string; role?: string; token?: string; body?: unknown; query?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "7" }, headers, body: opts.body ?? {}, query: opts.query ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runList = async (o: any) => { const res = mockRes(); await getAdminStories(req(o) as any, res as any); return res; };
const runGet = async (o: any) => { const res = mockRes(); await getAdminStory(req(o) as any, res as any); return res; };
const runPatch = async (o: any) => { const res = mockRes(); await patchAdminStory(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  listStoriesMock.mockReset();
  getStoryMock.mockReset();
  updateStoryMock.mockReset();
});

describe("GET /api/admin/stories (list)", () => {
  it("401s with no token", async () => {
    const res = await runList({ token: "" });
    expect(res.statusCode).toBe(401);
    expect(listStoriesMock).not.toHaveBeenCalled();
  });

  it("200s for a Viewer and returns the list", async () => {
    listStoriesMock.mockResolvedValueOnce([{ id: 1, status: "new" }]);
    const res = await runList({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: [{ id: 1, status: "new" }] });
    expect(listStoriesMock).toHaveBeenCalledWith({ status: undefined, useScope: undefined });
  });

  it("passes ?status= and ?use_scope= through to listStories", async () => {
    listStoriesMock.mockResolvedValueOnce([]);
    await runList({ role: "viewer", query: { status: "withdrawn", use_scope: "public" } });
    expect(listStoriesMock).toHaveBeenCalledWith({ status: "withdrawn", useScope: "public" });
  });
});

describe("GET /api/admin/stories/:id (detail)", () => {
  it("401s with no token", async () => {
    const res = await runGet({ token: "" });
    expect(res.statusCode).toBe(401);
  });

  it("200s with the full record for a Viewer", async () => {
    getStoryMock.mockResolvedValueOnce({ id: 7, story_text: "hello", status: "new" });
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 7, story_text: "hello" });
    expect(getStoryMock).toHaveBeenCalledWith(7);
  });

  it("404s when the story does not exist", async () => {
    getStoryMock.mockResolvedValueOnce(null);
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id", async () => {
    const res = await runGet({ role: "viewer", id: "abc" });
    expect(res.statusCode).toBe(400);
    expect(getStoryMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/stories/:id (editor+ gate)", () => {
  it("401s with no token", async () => {
    const res = await runPatch({ token: "", body: { status: "reviewed" } });
    expect(res.statusCode).toBe(401);
  });

  it("403s a Viewer", async () => {
    const res = await runPatch({ role: "viewer", body: { status: "reviewed" } });
    expect(res.statusCode).toBe(403);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it.each(["editor", "admin"])("%s can update status", async (role) => {
    updateStoryMock.mockResolvedValueOnce({ id: 7, status: "reviewed" });
    const res = await runPatch({ role, body: { status: "reviewed" } });
    expect(res.statusCode).toBe(200);
    expect(updateStoryMock).toHaveBeenCalledWith(7, { status: "reviewed" });
  });

  it("recognises withdrawn as a valid status", async () => {
    updateStoryMock.mockResolvedValueOnce({ id: 7, status: "withdrawn" });
    const res = await runPatch({ role: "editor", body: { status: "withdrawn" } });
    expect(res.statusCode).toBe(200);
    expect(updateStoryMock).toHaveBeenCalledWith(7, { status: "withdrawn" });
  });

  it("rejects an invalid status (400) and does not call updateStory", async () => {
    const res = await runPatch({ role: "editor", body: { status: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("accepts admin_tags (text[]) and admin_notes together", async () => {
    updateStoryMock.mockResolvedValueOnce({ id: 7, admin_tags: ["a", "b"], admin_notes: "note" });
    const res = await runPatch({
      role: "editor",
      body: { adminTags: ["a", "b"], adminNotes: "note" },
    });
    expect(res.statusCode).toBe(200);
    expect(updateStoryMock).toHaveBeenCalledWith(7, { adminTags: ["a", "b"], adminNotes: "note" });
  });

  it("rejects a non-array admin_tags (400)", async () => {
    const res = await runPatch({ role: "editor", body: { adminTags: "not-an-array" } });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("rejects a non-string admin_notes (400)", async () => {
    const res = await runPatch({ role: "editor", body: { adminNotes: 12345 } });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("rejects an empty body with no fields to update (400)", async () => {
    const res = await runPatch({ role: "editor", body: {} });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("404s when the story does not exist", async () => {
    updateStoryMock.mockResolvedValueOnce(null);
    const res = await runPatch({ role: "editor", body: { status: "reviewed" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id", async () => {
    const res = await runPatch({ role: "editor", id: "abc", body: { status: "reviewed" } });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });
});
