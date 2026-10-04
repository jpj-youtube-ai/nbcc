import { describe, it, expect, vi, beforeEach } from "vitest";

// The API behind Admin > Fundraising > All emails. Anyone who can see Fundraising can read the list
// and any email; nothing here approves anything (the three existing endpoints still do that), so
// there is nothing to write. The database is mocked. Every name and address is invented.

const touch = vi.hoisted(() => ({ listWordingApprovals: vi.fn() }));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/fundraising-touch", () => touch);
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test/",
    BALL_FROM_EMAIL: "events@nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-fundraising-emails";
import { signAdminSession } from "../../src/admin/session";
import { CATALOGUE, CATALOGUE_GROUPS, findEmail } from "../../src/email/catalogue";

const SECRET = "test-admin-secret";
function tokenFor(role: string, permissions: Record<string, string> = {}) {
  getUserAuthRowMock.mockResolvedValue({ id: 3, email: "fern@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: SECRET }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
async function run(handler: Handler, o: { token?: string | null; params?: Record<string, string> } = {}) {
  const res = { statusCode: 200, body: undefined as any } as any;
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  const headers: Record<string, string> = {};
  if (o.token) headers.authorization = `Bearer ${o.token}`;
  await handler({ headers, body: {}, params: o.params ?? {}, query: {} } as any, res);
  return res;
}
const emailIn = (body: any, id: string) => body.groups.flatMap((g: any) => g.emails).find((e: any) => e.id === id);
/* eslint-enable @typescript-eslint/no-explicit-any */

const approved = (key: string) => ({ key, approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "admin:fern@example.com" });

beforeEach(() => {
  touch.listWordingApprovals.mockReset().mockResolvedValue([]);
  getUserAuthRowMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/admin/fundraising/emails", () => {
  it("refuses without a session, and without access to Fundraising", async () => {
    expect((await run(routes.getEmails)).statusCode).toBe(401);
    const none = tokenFor("viewer", { fundraising: "none" });
    expect((await run(routes.getEmails, { token: none })).statusCode).toBe(403);
  });

  it("lets a viewer read it", async () => {
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
  });

  it("lists every email in its group, in order, with the count taken from the catalogue", async () => {
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    expect(res.body.count).toBe(CATALOGUE.length);
    expect(res.body.groups.map((g: { name: string }) => g.name)).toEqual(CATALOGUE_GROUPS.map((g) => g.name));
    const ids = res.body.groups.flatMap((g: { emails: Array<{ id: string }> }) => g.emails.map((e) => e.id));
    expect(ids).toEqual(CATALOGUE.map((e) => e.id));
  });

  it("gives each row its name, its subject line, who gets it and when, and its versions", async () => {
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    const row = emailIn(res.body, "team-invite");
    expect(row.name).toBe("Team invite");
    expect(row.subject).toBeTruthy();
    expect(row.who).toMatch(/team organiser/);
    expect(row.audience).toBe("public");
    expect(row.state).toBeNull();
    expect(row.versions.map((v: { id: string }) => v.id)).toEqual(["usual", "no-date"]);
    expect(row.versions[0].approval).toBeNull();
  });

  it("never sends the emails themselves: the list stays small", async () => {
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/<table|<html|<p /i);
    expect(text.length).toBeLessThan(60000);
  });

  it("says what is waiting for sign off, which version, and how many emails in all", async () => {
    touch.listWordingApprovals.mockResolvedValue([approved("finished"), approved("pledge_pay")]);
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    const finished = emailIn(res.body, "touch-finished");
    expect(finished.state).toBe("waiting");
    expect(finished.waitingVersion).toBe("nothing-raised");
    expect(finished.versions.find((v: { id: string }) => v.id === "usual").approval).toEqual({
      key: "finished",
      path: "/api/admin/fundraising/touch/approvals/finished",
      approvedAt: "2026-10-03T11:00:00.000Z",
      approvedBy: "admin:fern@example.com",
    });
    expect(finished.versions.find((v: { id: string }) => v.id === "nothing-raised").approval).toEqual({
      key: "finished_zero",
      path: "/api/admin/fundraising/touch/approvals/finished_zero",
      approvedAt: null,
      approvedBy: null,
    });
    expect(emailIn(res.body, "pledge-pay").state).toBe("approved");
    expect(emailIn(res.body, "pledge-pay").waitingVersion).toBeNull();
    expect(emailIn(res.body, "invite-memory").state).toBe("waiting");
    // Nine emails are gated in some version; two of them are fully approved here.
    const gated = CATALOGUE.filter((e) => e.versions.some((v) => v.approval)).length;
    expect(gated).toBe(9);
    expect(res.body.waiting).toBe(gated - 1);
    expect(res.body.approvalsUnavailable).toBe(false);
  });

  it("counts nothing as waiting once everything is approved", async () => {
    const keys = new Set(CATALOGUE.flatMap((e) => e.versions.map((v) => v.approval?.key).filter(Boolean) as string[]));
    touch.listWordingApprovals.mockResolvedValue([...keys].map(approved));
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    expect(res.body.waiting).toBe(0);
  });

  it("treats everything gated as waiting, and says so, when the approvals cannot be read", async () => {
    touch.listWordingApprovals.mockRejectedValue(new Error("db down"));
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    expect(res.statusCode).toBe(200);
    expect(res.body.approvalsUnavailable).toBe(true);
    expect(emailIn(res.body, "pledge-pay").state).toBe("waiting");
  });

  it("still lists an email whose subject cannot be worked out", async () => {
    const e = findEmail("team-invite")!;
    const spy = vi.spyOn(e.versions[0], "render").mockImplementation(() => {
      throw new Error("boom");
    });
    const res = await run(routes.getEmails, { token: tokenFor("viewer") });
    spy.mockRestore();
    expect(res.statusCode).toBe(200);
    expect(emailIn(res.body, "team-invite").subject).toBeNull();
    expect(emailIn(res.body, "team-live").subject).toBeTruthy();
  });
});

describe("GET /api/admin/fundraising/emails/:id/:version", () => {
  const at = (id: string, version: string) => ({ params: { id, version } });

  it("refuses without a session, and without access to Fundraising", async () => {
    expect((await run(routes.getEmail, at("team-invite", "usual"))).statusCode).toBe(401);
    const none = tokenFor("viewer", { fundraising: "none" });
    expect((await run(routes.getEmail, { token: none, ...at("team-invite", "usual") })).statusCode).toBe(403);
  });

  it("renders one version with the real builder, with links on this site", async () => {
    const res = await run(routes.getEmail, { token: tokenFor("viewer"), ...at("team-invite", "usual") });
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe("team-invite");
    expect(res.body.version).toBe("usual");
    expect(res.body.subject).toBeTruthy();
    expect(res.body.html).toContain("https://nbcc.test/fundraise/the-example-runners/join");
    expect(res.body.html).not.toContain("nbcc.test//");
    expect(res.body.approval).toBeNull();
    expect(res.body).not.toHaveProperty("text");
  });

  it("says where a gated version is up to", async () => {
    touch.listWordingApprovals.mockResolvedValue([approved("pledge_pay")]);
    const viewer = tokenFor("viewer");
    const pay = await run(routes.getEmail, { token: viewer, ...at("pledge-pay", "gift-aid") });
    expect(pay.body.approval).toEqual({
      key: "pledge_pay",
      path: "/api/admin/fundraising/pledges/approvals/pledge_pay",
      approvedAt: "2026-10-03T11:00:00.000Z",
      approvedBy: "admin:fern@example.com",
    });
    const memory = await run(routes.getEmail, { token: viewer, ...at("invite-memory", "usual") });
    expect(memory.body.approval).toEqual({ key: "invite_memory", path: "/api/admin/fundraising/invite-wording/invite_memory/approval", approvedAt: null, approvedBy: null });
  });

  it("does not read the approvals for an email that has none", async () => {
    await run(routes.getEmail, { token: tokenFor("viewer"), ...at("team-invite", "usual") });
    expect(touch.listWordingApprovals).not.toHaveBeenCalled();
  });

  it("is a 404 for an email or a version that is not in the catalogue", async () => {
    const viewer = tokenFor("viewer");
    for (const [id, version] of [["nope", "usual"], ["team-invite", "nope"], ["__proto__", "usual"], ["team-invite", "constructor"]]) {
      const res = await run(routes.getEmail, { token: viewer, ...at(id, version) });
      expect(res.statusCode, `${id}/${version}`).toBe(404);
      expect(res.body.error).toBeTruthy();
    }
  });

  it("when one email cannot be built, says so for that email only", async () => {
    const e = findEmail("team-invite")!;
    const spy = vi.spyOn(e.versions[0], "render").mockImplementation(() => {
      throw new Error("boom");
    });
    const viewer = tokenFor("viewer");
    const bad = await run(routes.getEmail, { token: viewer, ...at("team-invite", "usual") });
    const good = await run(routes.getEmail, { token: viewer, ...at("team-invite", "no-date") });
    spy.mockRestore();
    expect(bad.statusCode).toBe(500);
    expect(bad.body.error).toBe("That email could not be shown just now. The others are not affected.");
    expect(good.statusCode).toBe(200);
  });
});

describe("the router", () => {
  it("only reads: there is nothing here to approve or change", () => {
    const stack = (routes.adminFundraisingEmailsRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
    const all = stack.filter((l) => l.route).map((l) => `${Object.keys(l.route!.methods).join(",")} ${l.route!.path}`);
    expect(all).toEqual(["get /api/admin/fundraising/emails", "get /api/admin/fundraising/emails/:id/:version"]);
  });
});
