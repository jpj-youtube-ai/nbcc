import { describe, it, expect, vi, beforeEach } from "vitest";

// Task C (REQ intent: "Admin panel can view, tag and manage submitted stories, incl.
// withdrawal.") + Admin management Phase 2 (TASK-186). GET /api/admin/stories (list),
// GET /api/admin/stories/:id (detail) and PATCH /api/admin/stories/:id (status/admin_tags/
// admin_notes) — all behind authorizeSection's "stories" section (view for reads, edit for
// writes), all via src/db/stories (storiesPool), NEVER src/db/pool.ts / the charity DB. Mirrors the
// donor admin-api.test.ts mock/req/res style, but mocks ../../src/db/stories directly
// instead of the pool, since that module is Task C's only access to story data.

const { listStoriesMock, getStoryMock, updateStoryMock, deleteStoryMock, getUserAuthRowMock, recordErasureMock } = vi.hoisted(() => ({
  recordErasureMock: vi.fn(),
  listStoriesMock: vi.fn(),
  getStoryMock: vi.fn(),
  updateStoryMock: vi.fn(),
  deleteStoryMock: vi.fn(),
  getUserAuthRowMock: vi.fn(), // authorizeSection's fresh per-request DB row (Admin Phase 2)
}));
vi.mock("../../src/db/stories", () => ({
  listStories: listStoriesMock,
  getStory: getStoryMock,
  updateStory: updateStoryMock,
  deleteStory: deleteStoryMock,
  archiveStory: vi.fn(),
  restoreStory: vi.fn(),
}));
// TASK-311: erasure writes a tombstone before destroying the row. Mocked so these tests exercise the
// route's gates without a database - and so the assertion below can prove the tombstone is written.
vi.mock("../../src/db/erasure-log", () => ({
  recordErasure: recordErasureMock,
  listErasures: vi.fn(),
}));
vi.mock("../../src/db/contact", () => ({
  listEnquiries: vi.fn(),
  getEnquiry: vi.fn(),
  markReplied: vi.fn(),
  deleteEnquiry: vi.fn(),
  archiveEnquiry: vi.fn(),
  restoreEnquiry: vi.fn(),
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
// admin.ts also imports these from ../db/admin and ../db/portal etc. at module load time;
// stub them minimally so importing the router doesn't require a real pool/DB.
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { getAdminStories, getAdminStory, patchAdminStory, deleteAdminStory } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
// authorizeSection re-loads the caller's row fresh (getUserAuthRowMock) rather than trusting the
// token's role claim; tokenFor keeps that row's role in sync (role->permissions fallback).
const tokenFor = (role: string) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kenny@nbcc.test", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;
};

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
const runDelete = async (o: any) => { const res = mockRes(); await deleteAdminStory(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  listStoriesMock.mockReset();
  getStoryMock.mockReset();
  updateStoryMock.mockReset();
  deleteStoryMock.mockReset();
  getUserAuthRowMock.mockReset();
  recordErasureMock.mockReset();
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
    expect(listStoriesMock).toHaveBeenCalledWith({ status: undefined, useScope: undefined, view: "live" });
  });

  it("passes ?status= and ?use_scope= through to listStories", async () => {
    listStoriesMock.mockResolvedValueOnce([]);
    await runList({ role: "viewer", query: { status: "withdrawn", use_scope: "public" } });
    expect(listStoriesMock).toHaveBeenCalledWith({ status: "withdrawn", useScope: "public", view: "live" });
  });

  // TASK-311: the archive view travels separately from the workflow status - a story can be both
  // "withdrawn" and archived, and the two filters must not be conflated.
  it("asks for the archived view only when it is requested by name", async () => {
    listStoriesMock.mockResolvedValueOnce([]);
    await runList({ role: "viewer", query: { view: "archived" } });
    expect(listStoriesMock).toHaveBeenCalledWith({ status: undefined, useScope: undefined, view: "archived" });
  });

  it("falls back to the live view when the view is nonsense, never showing archived by accident", async () => {
    listStoriesMock.mockResolvedValueOnce([]);
    await runList({ role: "viewer", query: { view: "everything" } });
    expect(listStoriesMock).toHaveBeenCalledWith({ status: undefined, useScope: undefined, view: "live" });
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

  it("rejects adminNotes over the 2000 char cap (400)", async () => {
    const res = await runPatch({ role: "editor", body: { adminNotes: "x".repeat(2001) } });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("accepts adminNotes at exactly the 2000 char cap", async () => {
    updateStoryMock.mockResolvedValueOnce({ id: 7, admin_notes: "x".repeat(2000) });
    const res = await runPatch({ role: "editor", body: { adminNotes: "x".repeat(2000) } });
    expect(res.statusCode).toBe(200);
  });

  it("rejects more than 50 adminTags (400)", async () => {
    const res = await runPatch({
      role: "editor",
      body: { adminTags: Array.from({ length: 51 }, (_, i) => `tag${i}`) },
    });
    expect(res.statusCode).toBe(400);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });

  it("rejects a single adminTag over the 100 char cap (400)", async () => {
    const res = await runPatch({ role: "editor", body: { adminTags: ["x".repeat(101)] } });
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

// G2 item 6: DELETE /api/admin/stories/:id — real hard-delete (erasure), distinct from the
// PATCH status='withdrawn' path above. Gated identically to PATCH (Editor/Admin only, mirrors
// patchAdminDonor/patchAdminStory).
describe("DELETE /api/admin/stories/:id (editor+ gate, permanent erasure)", () => {
  it("401s with no token", async () => {
    const res = await runDelete({ token: "", body: { reason: "x" } });
    expect(res.statusCode).toBe(401);
    expect(deleteStoryMock).not.toHaveBeenCalled();
  });

  it("403s a Viewer", async () => {
    const res = await runDelete({ role: "viewer", body: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(deleteStoryMock).not.toHaveBeenCalled();
  });

  // TASK-311: erasure now needs the story ARCHIVED and a reason given. Three stories were erased
  // from production and nothing could say what had gone - so neither gate is optional.
  const archived = { id: 7, story_text: "hello", status: "new", archived_at: "2026-08-28T10:00:00Z" };

  it.each(["editor", "admin"])("%s can erase an ARCHIVED story with a reason (200)", async (role) => {
    getStoryMock.mockResolvedValueOnce(archived);
    deleteStoryMock.mockResolvedValueOnce(true);
    const res = await runDelete({ role, body: { reason: "duplicate submission" } });
    expect(res.statusCode).toBe(200);
    expect(deleteStoryMock).toHaveBeenCalledWith(7);
  });

  it("writes the tombstone BEFORE destroying the row", async () => {
    // Ordering is the point: a crash between the two must leave a record of an erasure that did not
    // happen, which is noticed - not an erasure with no record, which is the silence being fixed.
    const order: string[] = [];
    getStoryMock.mockResolvedValueOnce(archived);
    recordErasureMock.mockImplementationOnce(async () => { order.push("log"); });
    deleteStoryMock.mockImplementationOnce(async () => { order.push("delete"); return true; });
    await runDelete({ role: "editor", body: { reason: "consent withdrawn" } });
    expect(order).toEqual(["log", "delete"]);
    expect(recordErasureMock).toHaveBeenCalledWith(
      expect.objectContaining({ recordKind: "story", recordId: 7, reason: "consent withdrawn" }),
    );
  });

  it("409s when the story has not been archived first", async () => {
    getStoryMock.mockResolvedValueOnce({ id: 7, status: "new", archived_at: null });
    const res = await runDelete({ role: "editor", body: { reason: "tidying up" } });
    expect(res.statusCode).toBe(409);
    expect(deleteStoryMock).not.toHaveBeenCalled();
    expect(recordErasureMock).not.toHaveBeenCalled();
  });

  it("400s without a reason, and erases nothing", async () => {
    const res = await runDelete({ role: "editor", body: {} });
    expect(res.statusCode).toBe(400);
    expect(deleteStoryMock).not.toHaveBeenCalled();
    expect(recordErasureMock).not.toHaveBeenCalled();
  });

  it("400s on a blank reason, so whitespace cannot pass for one", async () => {
    const res = await runDelete({ role: "editor", body: { reason: "   " } });
    expect(res.statusCode).toBe(400);
    expect(deleteStoryMock).not.toHaveBeenCalled();
  });

  it("404s when the story does not exist", async () => {
    getStoryMock.mockResolvedValueOnce(null);
    const res = await runDelete({ role: "editor", body: { reason: "gone already" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id and never calls deleteStory", async () => {
    const res = await runDelete({ role: "editor", id: "abc", body: { reason: "x" } });
    expect(res.statusCode).toBe(400);
    expect(deleteStoryMock).not.toHaveBeenCalled();
  });
});

// Admin management Phase 2 (TASK-186): authorizeSection re-loads the caller's live row per request
// and gates by the "stories" section specifically, not just the token's role claim.
describe("Admin Phase 2: per-section permission gating on /api/admin/stories", () => {
  it("401s (generic) a disabled user's otherwise-valid token", async () => {
    const token = tokenFor("admin");
    getUserAuthRowMock.mockResolvedValueOnce({ id: 1, email: "kenny@nbcc.test", status: "disabled", role: "admin", permissions: {} });
    const res = await runList({ token });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });

  it("403s a write when stored permissions restrict an editor to stories:view only, overriding the role default", async () => {
    // Build the token directly (bypassing tokenFor) so the explicit permissions override below
    // isn't clobbered by tokenFor's own default (permissions: {}, i.e. the role fallback) — an
    // "editor" role normally gets stories:edit by default, so this proves the STORED per-section
    // map, not the role, is what authorizeSection actually checks.
    const token = signAdminSession({ sub: 1, email: "kenny@nbcc.test", role: "editor", now: new Date(), secret: SECRET }).token;
    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kenny@nbcc.test", status: "active", role: "editor", permissions: { stories: "view" } });
    const readRes = await runList({ token });
    expect(readRes.statusCode).toBe(200);
    const writeRes = await runPatch({ token, body: { status: "reviewed" } });
    expect(writeRes.statusCode).toBe(403);
    expect(updateStoryMock).not.toHaveBeenCalled();
  });
});
