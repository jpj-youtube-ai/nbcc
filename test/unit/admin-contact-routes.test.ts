import { describe, it, expect, vi, beforeEach } from "vitest";

// Task 7 (2026-07-10 contact-inbox spec) + Admin management Phase 2 (TASK-186): GET /api/admin/contact
// (list), GET /api/admin/contact/:id (detail), PATCH /api/admin/contact/:id (status new/replied),
// DELETE /api/admin/contact/:id — all behind authorizeSection's "contact" section (view for reads,
// edit for writes), all via src/db/contact (contactPool), NEVER src/db/pool.ts / the charity DB.
// Mirrors admin-stories-api.test.ts's mock/req/res style, but mocks ../../src/db/contact directly.

const {
  listEnquiriesMock,
  getEnquiryMock,
  markRepliedMock,
  deleteEnquiryMock,
  countUnansweredMock,
  getUserAuthRowMock,
} = vi.hoisted(() => ({
  listEnquiriesMock: vi.fn(),
  getEnquiryMock: vi.fn(),
  markRepliedMock: vi.fn(),
  deleteEnquiryMock: vi.fn(),
  countUnansweredMock: vi.fn(), // TASK-425: the notice-bar count
  getUserAuthRowMock: vi.fn(), // authorizeSection's fresh per-request DB row (Admin Phase 2)
}));
vi.mock("../../src/db/contact", () => ({
  listEnquiries: listEnquiriesMock,
  getEnquiry: getEnquiryMock,
  markReplied: markRepliedMock,
  deleteEnquiry: deleteEnquiryMock,
  countUnanswered: countUnansweredMock,
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

import {
  getAdminContact,
  getAdminContactItem,
  patchAdminContact,
  deleteAdminContact,
  getAdminContactUnanswered,
  adminRouter,
} from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
// authorizeSection re-loads the caller's row fresh (getUserAuthRowMock) rather than trusting the
// token's role claim; tokenFor keeps that row's role in sync (role->permissions fallback).
const tokenFor = (role: string, email = "kenny@nbcc.test") => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email, status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email, role, now: new Date(), secret: SECRET }).token;
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
function req(opts: { id?: string; role?: string; token?: string; body?: unknown; query?: unknown; email?: string }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role, opts.email) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "7" }, headers, body: opts.body ?? {}, query: opts.query ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runList = async (o: any) => { const res = mockRes(); await getAdminContact(req(o) as any, res as any); return res; };
const runGet = async (o: any) => { const res = mockRes(); await getAdminContactItem(req(o) as any, res as any); return res; };
const runPatch = async (o: any) => { const res = mockRes(); await patchAdminContact(req(o) as any, res as any); return res; };
const runDelete = async (o: any) => { const res = mockRes(); await deleteAdminContact(req(o) as any, res as any); return res; };
const runCount = async (o: any) => { const res = mockRes(); await getAdminContactUnanswered(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  listEnquiriesMock.mockReset();
  getEnquiryMock.mockReset();
  markRepliedMock.mockReset();
  deleteEnquiryMock.mockReset();
  countUnansweredMock.mockReset();
  getUserAuthRowMock.mockReset();
});

describe("GET /api/admin/contact (list)", () => {
  it("401s with no token", async () => {
    const res = await runList({ token: "" });
    expect(res.statusCode).toBe(401);
    expect(listEnquiriesMock).not.toHaveBeenCalled();
  });

  it("200s for a Viewer and returns the list", async () => {
    listEnquiriesMock.mockResolvedValueOnce([{ id: 1, status: "new" }]);
    const res = await runList({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ results: [{ id: 1, status: "new" }] });
    expect(listEnquiriesMock).toHaveBeenCalledWith(undefined);
  });

  it("passes ?status= through to listEnquiries", async () => {
    listEnquiriesMock.mockResolvedValueOnce([]);
    await runList({ role: "viewer", query: { status: "new" } });
    expect(listEnquiriesMock).toHaveBeenCalledWith("new");
  });
});

describe("GET /api/admin/contact/:id (detail)", () => {
  it("401s with no token", async () => {
    const res = await runGet({ token: "" });
    expect(res.statusCode).toBe(401);
  });

  it("200s with the full record for a Viewer", async () => {
    getEnquiryMock.mockResolvedValueOnce({ id: 7, message: "hello", status: "new" });
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ id: 7, message: "hello" });
    expect(getEnquiryMock).toHaveBeenCalledWith(7);
  });

  it("404s when the enquiry does not exist", async () => {
    getEnquiryMock.mockResolvedValueOnce(null);
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id", async () => {
    const res = await runGet({ role: "viewer", id: "abc" });
    expect(res.statusCode).toBe(400);
    expect(getEnquiryMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/contact/:id (editor+ gate, records who replied)", () => {
  it("401s with no token", async () => {
    const res = await runPatch({ token: "", body: { status: "replied" } });
    expect(res.statusCode).toBe(401);
  });

  it("403s a Viewer", async () => {
    const res = await runPatch({ role: "viewer", body: { status: "replied" } });
    expect(res.statusCode).toBe(403);
    expect(markRepliedMock).not.toHaveBeenCalled();
  });

  it("marks replied via PATCH and records the logged-in admin's email", async () => {
    markRepliedMock.mockResolvedValueOnce({ id: 1, status: "replied", replied_by: "tester@nbcc.scot" });
    const res = await runPatch({ role: "editor", email: "tester@nbcc.scot", id: "1", body: { status: "replied" } });
    expect(res.statusCode).toBe(200);
    expect(markRepliedMock).toHaveBeenCalledWith(1, true, "tester@nbcc.scot");
  });

  it("unmarks (status=new) clearing replied_by", async () => {
    markRepliedMock.mockResolvedValueOnce({ id: 1, status: "new", replied_by: null });
    const res = await runPatch({ role: "editor", email: "tester@nbcc.scot", id: "1", body: { status: "new" } });
    expect(res.statusCode).toBe(200);
    expect(markRepliedMock).toHaveBeenCalledWith(1, false, null);
  });

  it("rejects a bad PATCH status with 400", async () => {
    const res = await runPatch({ role: "editor", body: { status: "bogus" } });
    expect(res.statusCode).toBe(400);
    expect(markRepliedMock).not.toHaveBeenCalled();
  });

  it("404s when the enquiry does not exist", async () => {
    markRepliedMock.mockResolvedValueOnce(null);
    const res = await runPatch({ role: "editor", body: { status: "replied" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id", async () => {
    const res = await runPatch({ role: "editor", id: "abc", body: { status: "replied" } });
    expect(res.statusCode).toBe(400);
    expect(markRepliedMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/contact/:id (editor+ gate)", () => {
  it("401s with no token", async () => {
    const res = await runDelete({ token: "", body: { reason: "x" } });
    expect(res.statusCode).toBe(401);
    expect(deleteEnquiryMock).not.toHaveBeenCalled();
  });

  it("403s a Viewer", async () => {
    const res = await runDelete({ role: "viewer", body: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(deleteEnquiryMock).not.toHaveBeenCalled();
  });

  // TASK-311: erasing a message from a real person now needs it ARCHIVED first and a reason given,
  // exactly as a story does. The everyday action is Archive, which is reversible.
  const archivedEnquiry = { id: 3, first_name: "A", status: "new", archived_at: "2026-08-28T10:00:00Z" };

  it("409s when the enquiry has not been archived first", async () => {
    getEnquiryMock.mockResolvedValueOnce({ id: 3, status: "new", archived_at: null });
    const res = await runDelete({ role: "editor", body: { reason: "tidying up" } });
    expect(res.statusCode).toBe(409);
    expect(deleteEnquiryMock).not.toHaveBeenCalled();
  });

  it("400s without a reason, and erases nothing", async () => {
    const res = await runDelete({ role: "editor", body: {} });
    expect(res.statusCode).toBe(400);
    expect(deleteEnquiryMock).not.toHaveBeenCalled();
  });

  it.each(["editor", "admin"])("%s can erase an ARCHIVED enquiry with a reason (200)", async (role) => {
    getEnquiryMock.mockResolvedValueOnce(archivedEnquiry);
    deleteEnquiryMock.mockResolvedValueOnce(true);
    const res = await runDelete({ role, body: { reason: "spam" } });
    expect(res.statusCode).toBe(200);
    expect(deleteEnquiryMock).toHaveBeenCalledWith(7);
  });

  it("404s when the enquiry does not exist", async () => {
    getEnquiryMock.mockResolvedValueOnce(null);
    const res = await runDelete({ role: "editor", body: { reason: "gone already" } });
    expect(res.statusCode).toBe(404);
  });

  it("400s a non-numeric id and never calls deleteEnquiry", async () => {
    const res = await runDelete({ role: "editor", id: "abc" });
    expect(res.statusCode).toBe(400);
    expect(deleteEnquiryMock).not.toHaveBeenCalled();
  });
});

// Admin management Phase 2 (TASK-186): authorizeSection re-loads the caller's live row per request
// and gates by the "contact" section specifically, not just the token's role claim.
describe("Admin Phase 2: per-section permission gating on /api/admin/contact", () => {
  it("401s (generic) a disabled user's otherwise-valid token", async () => {
    const token = tokenFor("admin");
    getUserAuthRowMock.mockResolvedValueOnce({ id: 1, email: "kenny@nbcc.test", status: "disabled", role: "admin", permissions: {} });
    const res = await runList({ token });
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired admin session" });
  });

  it("403s a write when stored permissions restrict an editor to contact:view only, overriding the role default", async () => {
    // Build the token directly (bypassing tokenFor) so the explicit permissions override below
    // isn't clobbered by tokenFor's own default (permissions: {}, i.e. the role fallback) — an
    // "editor" role normally gets contact:edit by default, so this proves the STORED per-section
    // map, not the role, is what authorizeSection actually checks.
    const token = signAdminSession({ sub: 1, email: "kenny@nbcc.test", role: "editor", now: new Date(), secret: SECRET }).token;
    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "kenny@nbcc.test", status: "active", role: "editor", permissions: { contact: "view" } });
    const readRes = await runList({ token });
    expect(readRes.statusCode).toBe(200);
    const writeRes = await runPatch({ token, body: { status: "replied" } });
    expect(writeRes.statusCode).toBe(403);
    expect(markRepliedMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/contact/unanswered (TASK-425, the notice-bar count)", () => {
  it("401s with no token", async () => {
    const res = await runCount({ token: "" });
    expect(res.statusCode).toBe(401);
    expect(countUnansweredMock).not.toHaveBeenCalled();
  });

  it("200s with the count for a Viewer", async () => {
    countUnansweredMock.mockResolvedValueOnce(3);
    const res = await runCount({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ count: 3 });
  });

  it("returns zero happily when the inbox is clear", async () => {
    countUnansweredMock.mockResolvedValueOnce(0);
    const res = await runCount({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ count: 0 });
  });

  // The important one. If a broken query reported zero, the bar would show a confident all-clear
  // while enquiries sat unanswered, which is worse than the bar never appearing. It has to fail
  // loudly enough that the page can tell "none" apart from "do not know".
  it("500s when the count fails rather than reporting an all-clear", async () => {
    countUnansweredMock.mockRejectedValueOnce(new Error("contact db is down"));
    const res = await runCount({ role: "viewer" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toMatchObject({ count: 0 });
  });
});

describe("route ordering: the literal path must beat /:id", () => {
  // Express matches in registration order, so /api/admin/contact/:id declared first would capture
  // "unanswered" as an id and 400 it as non-numeric. This repo has hit that trap before, which is
  // why the newsletter templates and archived-audiences routes carry the same warning. The handler
  // tests above call functions directly and so cannot catch it; this inspects the real stack.
  it("registers /api/admin/contact/unanswered before /api/admin/contact/:id", () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const paths = (adminRouter as any).stack
      .filter((layer: any) => layer.route)
      .map((layer: any) => layer.route.path);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const literal = paths.indexOf("/api/admin/contact/unanswered");
    const byId = paths.indexOf("/api/admin/contact/:id");

    expect(literal, "the unanswered route is not registered at all").toBeGreaterThan(-1);
    expect(byId, "the :id route is not registered at all").toBeGreaterThan(-1);
    expect(literal).toBeLessThan(byId);
  });
});
