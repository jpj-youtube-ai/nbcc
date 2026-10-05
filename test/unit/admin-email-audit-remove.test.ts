import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-562: the two routes behind the Email audit's "Remove and stop emails", "Just tidy away"
// and "Put back". Both need edit on the Email audit, which only admins carry by role. The
// database modules are mocked, as admin-stories-api.test.ts does, so these pin who may, what is
// refused, and what each press writes. Every address here is invented.

const { recordMock, putBackMock, blockedReasonMock, hasProblemMock, suppressMock, unsuppressMock, getUserAuthRowMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  putBackMock: vi.fn(),
  blockedReasonMock: vi.fn(),
  hasProblemMock: vi.fn(),
  suppressMock: vi.fn(),
  unsuppressMock: vi.fn(),
  getUserAuthRowMock: vi.fn(), // authorizeSection's fresh row for each request
}));
vi.mock("../../src/db/email-audit-removals", () => ({
  recordAuditRemoval: recordMock,
  putBackAuditRemovals: putBackMock,
  blockedReason: blockedReasonMock,
  hasEmailProblem: hasProblemMock,
}));
vi.mock("../../src/db/email-suppressions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  suppressEmail: suppressMock,
  unsuppressEmail: unsuppressMock,
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
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { postAdminEmailLogRemove, postAdminEmailLogPutBack, postAdminSuppressionLift } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const ACTOR = "kenny@nbcc.test";
type Who = { role: string; permissions?: Record<string, string> };
const tokenFor = (who: Who) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: ACTOR, status: "active", role: who.role, permissions: who.permissions ?? {} });
  return signAdminSession({ sub: 1, email: ACTOR, role: who.role, now: new Date(), secret: SECRET }).token;
};

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function req(opts: { who?: Who; token?: string; body?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.who ? tokenFor(opts.who) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: {}, headers, body: opts.body ?? {}, query: {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const remove = async (o: any) => { const res = mockRes(); await postAdminEmailLogRemove(req(o) as any, res as any); return res; };
const putBack = async (o: any) => { const res = mockRes(); await postAdminEmailLogPutBack(req(o) as any, res as any); return res; };
const lift = async (o: any) => { const res = mockRes(); await postAdminSuppressionLift(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

const ADMIN: Who = { role: "admin" };
const EDITOR: Who = { role: "editor" }; // no access to the Email audit at all
const VIEW_ONLY: Who = { role: "viewer", permissions: { "email-audit": "view" } };
const EDIT_ONLY: Who = { role: "viewer", permissions: { "email-audit": "edit" } };
const nothingWritten = () => {
  expect(recordMock).not.toHaveBeenCalled();
  expect(putBackMock).not.toHaveBeenCalled();
  expect(suppressMock).not.toHaveBeenCalled();
  expect(unsuppressMock).not.toHaveBeenCalled();
};

beforeEach(() => {
  for (const m of [recordMock, putBackMock, blockedReasonMock, hasProblemMock, suppressMock, unsuppressMock, getUserAuthRowMock]) m.mockReset();
  hasProblemMock.mockResolvedValue(true);
  recordMock.mockResolvedValue(undefined);
  putBackMock.mockResolvedValue({ putBack: 1, blocked: false });
  blockedReasonMock.mockResolvedValue(null);
  suppressMock.mockResolvedValue(true);
  unsuppressMock.mockResolvedValue(true);
});

describe("POST /api/admin/email-log/remove", () => {
  it("401s with no token", async () => {
    const res = await remove({ token: "", body: { email: "ada@example.org", stop: false } });
    expect(res.statusCode).toBe(401);
    nothingWritten();
  });

  it("403s an editor, who has no access to the Email audit, and writes nothing", async () => {
    const res = await remove({ who: EDITOR, body: { email: "ada@example.org", stop: true } });
    expect(res.statusCode).toBe(403);
    nothingWritten();
  });

  it("403s someone who may only view the Email audit, and writes nothing", async () => {
    const res = await remove({ who: VIEW_ONLY, body: { email: "ada@example.org", stop: true } });
    expect(res.statusCode).toBe(403);
    nothingWritten();
  });

  it("lets someone given edit on the Email audit, and nothing else, remove", async () => {
    const res = await remove({ who: EDIT_ONLY, body: { email: "ada@example.org", stop: false } });
    expect(res.statusCode).toBe(200);
    expect(recordMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no address", { stop: false }],
    ["an empty one", { email: "   ", stop: false }],
    ["one far too long to be one", { email: "a".repeat(310) + "@example.org", stop: false }],
    ["no word on whether to stop", { email: "ada@example.org" }],
    ["a stop that is not yes or no", { email: "ada@example.org", stop: "yes" }],
    ["anything more than the two", { email: "ada@example.org", stop: false, kind: "stop" }],
  ])("400s %s, and writes nothing", async (_what, body) => {
    const res = await remove({ who: ADMIN, body });
    expect(res.statusCode).toBe(400);
    nothingWritten();
  });

  // Addresses come in through a loose check, so the log holds some a strict one would refuse. A
  // send that the provider refuses outright gets no bounce, so nothing ever blocks it by itself
  // and it comes back to the band on every send: these are the ones most in need of removing.
  it.each(["ada@example.org.", "ada..b@example.org", "<ada@example.org>"])(
    "removes and stops %s, which a stricter check would have refused",
    async (email) => {
      const res = await remove({ who: ADMIN, body: { email, stop: true } });
      expect(res.statusCode).toBe(200);
      expect(suppressMock).toHaveBeenCalledWith(email, "manual", `Removed from the Email audit by ${ACTOR}`);
      expect(recordMock).toHaveBeenCalledWith(email, "stop", ACTOR, true);
    },
  );

  // A cleared team invite's rows read "deleted team invitee" where the address was. They can be
  // tidied out of the band; there is nothing there to block.
  it("tidies away rows that no longer have an address", async () => {
    const res = await remove({ who: ADMIN, body: { email: "deleted team invitee", stop: false } });
    expect(res.statusCode).toBe(200);
    expect(recordMock).toHaveBeenCalledWith("deleted team invitee", "tidy", ACTOR, false);
  });

  it("refuses to block something that is not an address, and writes nothing", async () => {
    const res = await remove({ who: ADMIN, body: { email: "deleted team invitee", stop: true } });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Only an email address can be blocked" });
    nothingWritten();
  });

  // What the band offers is an address with a problem. Without this, the route would block any
  // address handed to it.
  it.each([true, false])("404s an address the log has no problem for (stop %s), and writes nothing", async (stop) => {
    hasProblemMock.mockResolvedValueOnce(false);
    const res = await remove({ who: ADMIN, body: { email: "calum@example.com", stop } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "That address has no problem in the Email audit" });
    expect(hasProblemMock).toHaveBeenCalledWith("calum@example.com");
    nothingWritten();
  });

  it("tidies away: one removal, not blocked, and the block list is not touched", async () => {
    const res = await remove({ who: ADMIN, body: { email: "Ada@Example.org", stop: false } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ removed: true, stopped: false, blockedNow: false });
    expect(recordMock).toHaveBeenCalledWith("Ada@Example.org", "tidy", ACTOR, false);
    expect(suppressMock).not.toHaveBeenCalled();
  });

  it("removes and stops: blocks the address as staff first, then records the removal as the one that blocked it", async () => {
    const res = await remove({ who: ADMIN, body: { email: "ada@example.org", stop: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ removed: true, stopped: true, blockedNow: true });
    expect(suppressMock).toHaveBeenCalledWith("ada@example.org", "manual", `Removed from the Email audit by ${ACTOR}`);
    expect(recordMock).toHaveBeenCalledWith("ada@example.org", "stop", ACTOR, true);
    // Blocked before it is hidden: if the second write fails, the address is blocked and its
    // problems still show, which staff can see and try again. The other way round would hide the
    // problems of an address that is still being emailed.
    expect(suppressMock.mock.invocationCallOrder[0]).toBeLessThan(recordMock.mock.invocationCallOrder[0]);
  });

  // The block list allows one block an address and keeps the first reason. An address already
  // blocked because its mail bounced stays "bounced": this removal did not block it, so putting it
  // back must not unblock it.
  it("records that the block was not its own when the address was already blocked", async () => {
    suppressMock.mockResolvedValueOnce(false);
    const res = await remove({ who: ADMIN, body: { email: "ada@example.org", stop: true } });
    expect(res.body).toEqual({ removed: true, stopped: true, blockedNow: false });
    expect(recordMock).toHaveBeenCalledWith("ada@example.org", "stop", ACTOR, false);
  });

  it.each(["events@nbcc.scot", "Giving@NBCC.scot", "newsletter@news.nbcc.scot"])(
    "never blocks one of the charity's own addresses (%s): stop is refused, and nothing is written",
    async (email) => {
      const res = await remove({ who: ADMIN, body: { email, stop: true } });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: "The charity's own addresses are never blocked" });
      nothingWritten();
    },
  );

  it("tidies one of the charity's own addresses away like any other", async () => {
    const res = await remove({ who: ADMIN, body: { email: "events@nbcc.scot", stop: false } });
    expect(res.statusCode).toBe(200);
    expect(recordMock).toHaveBeenCalledWith("events@nbcc.scot", "tidy", ACTOR, false);
  });

  it("500s when it could not be saved, without saying why", async () => {
    recordMock.mockRejectedValueOnce(new Error("connection refused at 10.0.0.7"));
    const res = await remove({ who: ADMIN, body: { email: "ada@example.org", stop: false } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("POST /api/admin/email-log/put-back", () => {
  it("401s with no token", async () => {
    const res = await putBack({ token: "", body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(401);
    nothingWritten();
  });

  it("403s someone who may only view the Email audit, and writes nothing", async () => {
    const res = await putBack({ who: VIEW_ONLY, body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(403);
    nothingWritten();
  });

  it.each([{}, { email: "   " }, { email: "ada@example.org", stop: true }])("400s %j, and writes nothing", async (body) => {
    const res = await putBack({ who: ADMIN, body });
    expect(res.statusCode).toBe(400);
    nothingWritten();
  });

  it("404s when the address had not been removed, and touches no block", async () => {
    putBackMock.mockResolvedValueOnce({ putBack: 0, blocked: false });
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "That address has not been removed" });
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  it("puts back a tidy and touches no block", async () => {
    const res = await putBack({ who: ADMIN, body: { email: "Ada@Example.org" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ putBack: true, unblocked: false, blockedBecause: null });
    expect(putBackMock).toHaveBeenCalledWith("Ada@Example.org", ACTOR);
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  it("unblocks an address that Remove and stop emails blocked", async () => {
    putBackMock.mockResolvedValueOnce({ putBack: 1, blocked: true });
    blockedReasonMock.mockResolvedValueOnce("manual");
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.body).toEqual({ putBack: true, unblocked: true, blockedBecause: null });
    expect(unsuppressMock).toHaveBeenCalledWith("ada@example.org", ACTOR);
  });

  it("leaves a block that was there for its own reason, and says why the address is still blocked", async () => {
    putBackMock.mockResolvedValueOnce({ putBack: 1, blocked: false });
    blockedReasonMock.mockResolvedValueOnce("bounced");
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.body).toEqual({ putBack: true, unblocked: false, blockedBecause: "bounced" });
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  // A staff block this removal did not make (the block was written and the removal then failed,
  // and the second try found the address blocked already). It is left, and the answer says it is
  // staff's, so the screen does not put it down to a bounce.
  it("leaves a staff block that it did not make, and says it is staff's", async () => {
    putBackMock.mockResolvedValueOnce({ putBack: 1, blocked: false });
    blockedReasonMock.mockResolvedValueOnce("manual");
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.body).toEqual({ putBack: true, unblocked: false, blockedBecause: "manual" });
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  // Blocked by staff, unblocked under Newsletter, then the mailbox marked us as spam: the block
  // there now is the mailbox's, not this removal's, whatever the removal remembers.
  it("leaves a block that has since become somebody else's", async () => {
    putBackMock.mockResolvedValueOnce({ putBack: 1, blocked: true });
    blockedReasonMock.mockResolvedValueOnce("complained");
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.body).toEqual({ putBack: true, unblocked: false, blockedBecause: "complained" });
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  it("500s when it could not be saved, without saying why", async () => {
    putBackMock.mockRejectedValueOnce(new Error("connection refused at 10.0.0.7"));
    const res = await putBack({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

// Newsletter, Blocked addresses, Unblock: the older route that lifts a block. Staff can now block,
// from the Email audit, an address a strict check refuses. Whatever is on the block list has to be
// able to come off it here, or it would sit under Blocked addresses with an Unblock that never works.
describe("POST /api/admin/newsletters/suppressions/lift", () => {
  it.each(["ada@example.org.", "ada..b@example.org", "<ada@example.org>"])(
    "unblocks %s, which a stricter check would have refused",
    async (email) => {
      const res = await lift({ who: ADMIN, body: { email } });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ lifted: true });
      expect(unsuppressMock).toHaveBeenCalledWith(email, ACTOR);
    },
  );

  it("unblocks an ordinary address as it always did", async () => {
    const res = await lift({ who: ADMIN, body: { email: "  ada@example.org " } });
    expect(res.statusCode).toBe(200);
    expect(unsuppressMock).toHaveBeenCalledWith("ada@example.org", ACTOR);
  });

  it.each([{}, { email: "   " }, { email: "a".repeat(310) + "@example.org" }])("400s %j, and lifts nothing", async (body) => {
    const res = await lift({ who: ADMIN, body });
    expect(res.statusCode).toBe(400);
    expect(unsuppressMock).not.toHaveBeenCalled();
  });

  it("404s an address that is not blocked", async () => {
    unsuppressMock.mockResolvedValueOnce(false);
    const res = await lift({ who: ADMIN, body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "That address is not blocked" });
  });

  it("403s someone who may change the Email audit but not the Newsletter, and lifts nothing", async () => {
    const res = await lift({ who: EDIT_ONLY, body: { email: "ada@example.org" } });
    expect(res.statusCode).toBe(403);
    expect(unsuppressMock).not.toHaveBeenCalled();
  });
});
