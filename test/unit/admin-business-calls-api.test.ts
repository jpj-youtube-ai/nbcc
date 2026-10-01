import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// TASK-491: the call reminders on Admin > Business supporters.
//   GET  /api/admin/fulfilments              each row gains callDue + callDueOn
//   POST /api/admin/fulfilments/:id/calls    { note? }  record a call (audited, one transaction)
//   PUT  /api/admin/fulfilments/:id/phone    { phone }  set or clear the number (audited)
// All three need business-supporters:edit, like the rest of the section. DB-free, mirroring
// admin-fulfilment-api.test.ts: the pool, the per-request auth row and config are mocked. Every
// name, address and number here is invented.

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
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import {
  getAdminFulfilments,
  postAdminFulfilmentCall,
  putAdminFulfilmentPhone,
} from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";
let authRow: { id: number; email: string; status: string; role: string; permissions: PermissionMap } = {
  id: 1,
  email: "fern@example.com",
  status: "active",
  role: "admin",
  permissions: {},
};
const tokenFor = (role: string) => {
  authRow = { ...authRow, role };
  return signAdminSession({ sub: 1, email: "fern@example.com", role, now: new Date(), secret: SECRET }).token;
};

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
function req(opts: { id?: string; role?: string; token?: string; body?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : tokenFor(opts.role ?? "admin");
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "7" }, headers, body: opts.body ?? {}, query: {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(handler: (rq: any, rs: any) => Promise<unknown>, o: Parameters<typeof req>[0]) {
  const res = mockRes();
  await handler(req(o) as any, res as any);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const auditInserts = () => clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));

function listRow(over: Record<string, unknown>) {
  return {
    id: 7,
    donor_id: 42,
    donor_name: "Rowan Example",
    business_name: "Thistle Bakery Example Ltd",
    band: "gold",
    created_at: new Date("2026-03-01T10:00:00Z"),
    phone: null,
    last_called_at: null,
    last_called_by: null,
    last_call_note: null,
    supporting: true,
    supporting_since: new Date("2026-03-01T10:00:00Z"),
    ...over,
  };
}

let rows: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  authRow = { id: 1, email: "fern@example.com", status: "active", role: "admin", permissions: {} };
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);
  rows = [listRow({})];
  queryMock.mockImplementation(async (sql: string) => {
    if (/from business_supporter_fulfilment/i.test(sql)) return { rows, rowCount: rows.length };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/insert into business_supporter_calls/i.test(sql)) {
      return {
        rows: [{ id: 3, fulfilment_id: 7, called_at: new Date("2026-10-02T12:00:00Z"), called_by: "fern@example.com", note: "Happy" }],
        rowCount: 1,
      };
    }
    if (/select phone from business_supporter_fulfilment/i.test(sql)) return { rows: [{ phone: "0131 496 0001" }], rowCount: 1 };
    if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [{ id: 7, phone: "0131 496 0000" }], rowCount: 1 };
    if (/insert into audit_log/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the list says who is due a call", () => {
  it("asks the database for the phone, the last call and whether they are still giving", async () => {
    await run(getAdminFulfilments, {});
    const sql = String(queryMock.mock.calls.find((c) => /from business_supporter_fulfilment/i.test(String(c[0])))?.[0]);
    expect(sql).toMatch(/f\.phone/);
    expect(sql).toMatch(/business_supporter_calls/);
    expect(sql).toMatch(/last_called_at/);
    expect(sql).toMatch(/subscription_dunning/);
    expect(sql).toMatch(/cancelled_at/);
    expect(sql).toMatch(/'lapsed'/);
    expect(sql).toMatch(/mode = 'monthly'/);
    expect(sql).toMatch(/payment_status = 'paid'/);
    expect(sql).toMatch(/supporting_since/);
  });

  // Review of #614: a dunning row exists only after a failed payment or a cancellation, so a healthy
  // new subscription has none. Falling back to the donor's OTHER rows read an old cancellation as the
  // current state, and a business that cancelled and later gave again was never due.
  it("reads payment health only from the subscription of their latest paid gift", async () => {
    await run(getAdminFulfilments, {});
    const sql = String(queryMock.mock.calls.find((c) => /from business_supporter_fulfilment/i.test(String(c[0])))?.[0]);
    const dunning = sql.slice(sql.search(/FROM subscription_dunning/i));
    expect(dunning).toMatch(
      /gift\.latest_subscription_id IS NULL\s+OR\s+s\.stripe_subscription_id = gift\.latest_subscription_id/i,
    );
    expect(dunning).not.toMatch(/DESC NULLS LAST/i);
  });

  it("marks a business giving since March and never called as due", async () => {
    const res = await run(getAdminFulfilments, {});
    const r = (res.body as { results: Record<string, unknown>[] }).results[0];
    expect(r.callDue).toBe(true);
    expect(r.callDueOn).toBe("2026-09-01");
    expect(r.business_name).toBe("Thistle Bakery Example Ltd");
  });

  it("is not due again for three months after a call", async () => {
    rows = [listRow({ last_called_at: new Date("2026-09-20T09:00:00Z"), last_called_by: "fern@example.com" })];
    const r = (await run(getAdminFulfilments, {})).body as { results: Record<string, unknown>[] };
    expect(r.results[0].callDue).toBe(false);
    expect(r.results[0].callDueOn).toBe("2026-12-20");
  });

  it("counts the call on the UK day it was made, not the UTC one", async () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in the UK (summer time).
    rows = [listRow({ last_called_at: new Date("2026-06-30T23:30:00Z") })];
    const r = (await run(getAdminFulfilments, {})).body as { results: Record<string, unknown>[] };
    expect(r.results[0].callDueOn).toBe("2026-10-01");
    // The page shows that UK day too, so the date it says they were called matches the due date.
    expect(r.results[0].lastCalledOn).toBe("2026-07-01");
  });

  it("never marks a business that has stopped giving", async () => {
    rows = [listRow({ supporting: false })];
    const r = (await run(getAdminFulfilments, {})).body as { results: Record<string, unknown>[] };
    expect(r.results[0].callDue).toBe(false);
    expect(r.results[0].callDueOn).toBeNull();
  });

  it("never marks a business with no paid monthly gift", async () => {
    rows = [listRow({ supporting: false, supporting_since: null })];
    const r = (await run(getAdminFulfilments, {})).body as { results: Record<string, unknown>[] };
    expect(r.results[0].callDue).toBe(false);
  });
});

describe("POST /api/admin/fulfilments/:id/calls", () => {
  it("401s with no session and 403s without business-supporters:edit, writing nothing", async () => {
    expect((await run(postAdminFulfilmentCall, { token: "" })).statusCode).toBe(401);
    expect((await run(postAdminFulfilmentCall, { role: "viewer" })).statusCode).toBe(403);
    expect((await run(postAdminFulfilmentCall, { role: "editor" })).statusCode).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it("records the call and its History row in one transaction", async () => {
    const res = await run(postAdminFulfilmentCall, { id: "7", body: { note: "  Happy  " } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ call: { called_by: "fern@example.com", note: "Happy" } });
    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    const insert = clientQueryMock.mock.calls.find((c) => /insert into business_supporter_calls/i.test(String(c[0])));
    expect(insert?.[1]).toEqual([7, "fern@example.com", "Happy"]);
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1].slice(0, 4)).toEqual([
      "admin:fern@example.com",
      "fulfilment.called",
      "business_supporter_fulfilment",
      7,
    ]);
    expect(audits[0][1][4]).toEqual({ note: "Happy" });
  });

  it("accepts no note at all, and treats a blank one as none", async () => {
    expect((await run(postAdminFulfilmentCall, { body: {} })).statusCode).toBe(200);
    let insert = clientQueryMock.mock.calls.find((c) => /insert into business_supporter_calls/i.test(String(c[0])));
    expect(insert?.[1]).toEqual([7, "fern@example.com", null]);
    clientQueryMock.mockClear();
    expect((await run(postAdminFulfilmentCall, { body: { note: "   " } })).statusCode).toBe(200);
    insert = clientQueryMock.mock.calls.find((c) => /insert into business_supporter_calls/i.test(String(c[0])));
    expect(insert?.[1]).toEqual([7, "fern@example.com", null]);
  });

  it("400s a note over 500 characters, an unknown field, or a bad id, writing nothing", async () => {
    expect((await run(postAdminFulfilmentCall, { body: { note: "x".repeat(501) } })).statusCode).toBe(400);
    expect((await run(postAdminFulfilmentCall, { body: { note: "ok", calledAt: "2020-01-01" } })).statusCode).toBe(400);
    expect((await run(postAdminFulfilmentCall, { body: { note: 5 } })).statusCode).toBe(400);
    expect((await run(postAdminFulfilmentCall, { id: "abc" })).statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("accepts exactly 500 characters", async () => {
    expect((await run(postAdminFulfilmentCall, { body: { note: "x".repeat(500) } })).statusCode).toBe(200);
  });

  it("404s an unknown supporter, rolling back with no History row", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      return { rows: [], rowCount: 0 };
    });
    const res = await run(postAdminFulfilmentCall, { id: "999" });
    expect(res.statusCode).toBe(404);
    expect(auditInserts()).toHaveLength(0);
    expect(clientQueryMock.mock.calls.some((c) => /^\s*rollback/i.test(String(c[0])))).toBe(true);
  });
});

describe("PUT /api/admin/fulfilments/:id/phone", () => {
  it("401s with no session and 403s without business-supporters:edit, writing nothing", async () => {
    expect((await run(putAdminFulfilmentPhone, { token: "", body: { phone: "0131 496 0000" } })).statusCode).toBe(401);
    expect((await run(putAdminFulfilmentPhone, { role: "viewer", body: { phone: "0131 496 0000" } })).statusCode).toBe(403);
    expect(connect).not.toHaveBeenCalled();
  });

  it("saves a number and logs the change, with the old one, in one transaction", async () => {
    const res = await run(putAdminFulfilmentPhone, { body: { phone: " 0131 496 0000 " } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: 7, phone: "0131 496 0000" });
    const update = clientQueryMock.mock.calls.find((c) => /update business_supporter_fulfilment/i.test(String(c[0])));
    expect(update?.[0]).toMatch(/set\s+phone\s*=\s*\$2/i);
    expect(update?.[1]).toEqual([7, "0131 496 0000"]);
    const audits = auditInserts();
    expect(audits).toHaveLength(1);
    expect(audits[0][1][1]).toBe("fulfilment.phone");
    expect(audits[0][1][4]).toEqual({ phone: "0131 496 0000", previous: "0131 496 0001" });
    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
  });

  it("clears the number when the box is emptied", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select phone from business_supporter_fulfilment/i.test(sql)) return { rows: [{ phone: "0131 496 0001" }], rowCount: 1 };
      if (/update business_supporter_fulfilment/i.test(sql)) return { rows: [{ id: 7, phone: null }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const res = await run(putAdminFulfilmentPhone, { body: { phone: "" } });
    expect(res.statusCode).toBe(200);
    const update = clientQueryMock.mock.calls.find((c) => /update business_supporter_fulfilment/i.test(String(c[0])));
    expect(update?.[1]).toEqual([7, null]);
  });

  it.each([
    ["letters", { phone: "call reception" }],
    ["too short", { phone: "12345" }],
    ["too long", { phone: "0".repeat(41) }],
    ["not a string", { phone: 1314960000 }],
    ["missing", {}],
    ["an extra field", { phone: "0131 496 0000", note: "x" }],
  ])("400s a phone that is %s, writing nothing", async (_label, body) => {
    const res = await run(putAdminFulfilmentPhone, { body });
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("404s an unknown supporter, rolling back with no History row", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      return { rows: [], rowCount: 0 };
    });
    const res = await run(putAdminFulfilmentPhone, { id: "999", body: { phone: "0131 496 0000" } });
    expect(res.statusCode).toBe(404);
    expect(auditInserts()).toHaveLength(0);
  });
});
