import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-431: the admin endpoint that sends ONE business supporter their catch-up invite —
// POST /api/admin/business-supporters/:id/send-invite. Same gate as the bulk backfill
// (business-supporters:edit): an unauthenticated or Viewer-level request is rejected and touches
// nothing. An Editor+ call drives the REAL wiring end to end (route → getUninvitedBusinessSupporter
// → runBusinessInviteBackfill → the real build/send/mark/audit) over a mocked pool and the stubbed
// email client, and appends exactly one `fulfilment.send_invite` audit row against that supporter.
//
// The point of this endpoint is that it reaches one supporter WITHOUT emailing everybody else who
// happens to be un-invited. So the test that matters most is the one asserting the read is
// addressed by id, and that a supporter who has already been invited gets nothing.

const { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const getUserAuthRowMock = vi.fn();
  return { queryMock, clientQueryMock, mockClient, connect, getUserAuthRowMock };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
    GIVING_FROM_EMAIL: "giving@nbcc.scot",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { postAdminSendBusinessInvite } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";

let authRow: { id: number; email: string; status: string; role: string; permissions: PermissionMap } = {
  id: 1,
  email: "kenny@nbcc.test",
  status: "active",
  role: "viewer",
  permissions: {},
};
const tokenFor = (role: string) => {
  authRow = { ...authRow, role };
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
function req(opts: { role?: string; token?: string; id?: string }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "12" }, headers, body: {}, query: {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const send = async (o: any) => {
  const res = mockRes();
  await postAdminSendBusinessInvite(req(o) as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// The one supporter the addressed read returns. Modelled on the business that prompted this:
// paying every month since May, never written to, and invisible on the supporters list.
const rmc = {
  id: 12,
  token: "tok-rmc",
  band: "platinum",
  email: "stephanie@rmc.test",
  business_name: "RMC Double Glazing (Ayr) Ltd",
  full_name: "Stephanie",
};

const isAddressedRead = (sql: string) =>
  /from business_supporter_fulfilment/i.test(sql) && /invited_at is null/i.test(sql);

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  authRow = { id: 1, email: "kenny@nbcc.test", status: "active", role: "viewer", permissions: {} };
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);

  queryMock.mockImplementation(async (sql: string) => {
    if (isAddressedRead(sql)) return { rows: [rmc], rowCount: 1 };
    if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const auditInserts = () => clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
const stamps = () => queryMock.mock.calls.filter((c) => /update business_supporter_fulfilment/i.test(String(c[0])));

describe("it is gated exactly like the bulk backfill", () => {
  it("401s with no session, reading and writing nothing", async () => {
    expect((await send({ token: "" })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("401s on a token signed with the wrong key", async () => {
    const forged = signAdminSession({ sub: 1, email: "x@y.co", role: "admin", now: new Date(), secret: "wrong-key" }).token;
    expect((await send({ token: forged })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  // It puts mail in somebody's inbox, so read-only access is not enough.
  it("403s a Viewer, sending nothing and auditing nothing", async () => {
    expect((await send({ role: "viewer" })).statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
    expect(auditInserts()).toHaveLength(0);
  });

  it("400s a nonsense id rather than guessing which supporter was meant", async () => {
    expect((await send({ role: "admin", id: "not-a-number" })).statusCode).toBe(400);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("sending to one supporter", () => {
  it("reads that supporter by id — not the whole un-invited list", async () => {
    await send({ role: "admin" });
    const read = queryMock.mock.calls.find((c) => isAddressedRead(String(c[0])));
    expect(read).toBeDefined();
    // THE assertion for this endpoint. Without the id in the WHERE clause this would email every
    // un-invited supporter on the system, which is the exact thing it exists to avoid.
    expect(String(read?.[0])).toMatch(/f\.id\s*=\s*\$1/i);
    expect(read?.[1]).toEqual([12]);
  });

  it("sends, stamps them invited, and reports it", async () => {
    const res = await send({ role: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pending: 1, sent: 1, failed: 0, alreadyInvited: false });
    expect(stamps()).toHaveLength(1);
  });

  it("audits the send against that supporter, under its own action", async () => {
    await send({ role: "admin" });
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1][0]).toBe("admin:kenny@nbcc.test"); // actor
    // Not "backfill_invites" — otherwise the log reads as though somebody emailed everyone.
    expect(audits[0][1][1]).toBe("fulfilment.send_invite"); // action
    expect(audits[0][1][2]).toBe("business_supporter_fulfilment"); // entity
    expect(audits[0][1][3]).toBe(12); // entity_id — which supporter was written to
  });
});

describe("a supporter who has already been invited", () => {
  it("is not emailed again, and is reported as already invited rather than as a failure", async () => {
    // The gate (invited_at IS NULL AND captured_at IS NULL) matches nothing for them.
    queryMock.mockImplementation(async (sql: string) => {
      if (isAddressedRead(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const res = await send({ role: "admin" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ pending: 0, sent: 0, failed: 0, alreadyInvited: true });
    // Nothing was stamped, because nothing was sent.
    expect(stamps()).toHaveLength(0);
    // The attempt is still recorded: "somebody clicked send and nothing went" is worth knowing.
    expect(auditInserts()).toHaveLength(1);
  });
});
