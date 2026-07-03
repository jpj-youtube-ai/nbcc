import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-106 (REQ-062): role-gated admin endpoints mirroring the self-serve donor actions. An admin
// acts on a donor's behalf: GET/PATCH /api/admin/donors/:id, POST …/subscription/cancel and POST
// …/gift-aid/cancel. Each requires a valid admin session token (401 otherwise) and enforces the role
// rank — Viewer is read-only (403 on any write), Editor and Admin may write. Every successful write
// appends its audit_log row in the same transaction (writeWithAudit — the truth model). DB-free:
// pool (reads + the writeWithAudit transaction) and config are mocked, and the Stripe client stubbed.

const { queryMock, clientQueryMock, mockClient, connect, cancelSubscriptionMock } = vi.hoisted(() => {
  const queryMock = vi.fn(); // pool.query — reads
  const clientQueryMock = vi.fn(); // client.query — writeWithAudit transactions
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  const cancelSubscriptionMock = vi.fn(async () => ({ id: "sub_123", status: "canceled" }));
  return { queryMock, clientQueryMock, mockClient, connect, cancelSubscriptionMock };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: cancelSubscriptionMock }));

import {
  getAdminDonor,
  patchAdminDonor,
  postAdminCancelSubscription,
  postAdminCancelGiftAid,
} from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string) =>
  signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;

// --- mock req/res --------------------------------------------------------------------------------
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
function req(opts: { id?: string; role?: string; token?: string; body?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "42" }, headers, body: opts.body ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runGet = async (o: any) => { const res = mockRes(); await getAdminDonor(req(o) as any, res as any); return res; };
const runPatch = async (o: any) => { const res = mockRes(); await patchAdminDonor(req(o) as any, res as any); return res; };
const runCancelSub = async (o: any) => { const res = mockRes(); await postAdminCancelSubscription(req(o) as any, res as any); return res; };
const runCancelGa = async (o: any) => { const res = mockRes(); await postAdminCancelGiftAid(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

const donorRow = {
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  email_consent: true,
  anonymous: false,
  subscription_plan: "gold",
  subscription_id: "sub_123",
  gift_aid: true,
};

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  cancelSubscriptionMock.mockClear();

  queryMock.mockImplementation(async (sql: string) => {
    if (/from donors/i.test(sql)) return { rows: [donorRow], rowCount: 1 };
    // findActiveDeclarationIdForDonor: the donor's active (non-revoked) declaration.
    if (/from declarations/i.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    // the FOR UPDATE lock inside adminCancelGiftAid's transaction
    if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [{ id: 77, donor_id: 42, revoked_at: null }], rowCount: 1 };
    if (/update donors/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update declarations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const auditInserts = () =>
  clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));

// --- 401: missing / invalid token ---------------------------------------------------------------
describe("admin endpoints require a valid session token (401)", () => {
  it("401s every endpoint with no Authorization header", async () => {
    expect((await runGet({ token: "" })).statusCode).toBe(401);
    expect((await runPatch({ token: "", body: { fullName: "X" } })).statusCode).toBe(401);
    expect((await runCancelSub({ token: "", body: { subscriptionId: "sub_123", accepted: "cancel" } })).statusCode).toBe(401);
    expect((await runCancelGa({ token: "" })).statusCode).toBe(401);
  });

  it("401s on a token signed with the wrong key", async () => {
    const forged = signAdminSession({ sub: 1, email: "x@y.co", role: "admin", now: new Date(), secret: "wrong-key" }).token;
    expect((await runGet({ token: forged })).statusCode).toBe(401);
  });
});

// --- 403: Viewer is read-only -------------------------------------------------------------------
describe("role enforcement: Viewer is read-only (403 on writes)", () => {
  it("lets a Viewer GET the donor", async () => {
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ donorId: 42, fullName: "Ada Lovelace" });
  });

  it("403s a Viewer on every write", async () => {
    expect((await runPatch({ role: "viewer", body: { fullName: "New" } })).statusCode).toBe(403);
    expect((await runCancelSub({ role: "viewer", body: { subscriptionId: "sub_123", accepted: "cancel" } })).statusCode).toBe(403);
    expect((await runCancelGa({ role: "viewer" })).statusCode).toBe(403);
    // No write happened.
    expect(auditInserts()).toHaveLength(0);
  });
});

// --- 200: Editor and Admin succeed, each write audited ------------------------------------------
describe.each(["editor", "admin"])("role %s may perform all three actions, each audited", (role) => {
  it("GET returns the donor snapshot", async () => {
    const res = await runGet({ role });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ donorId: 42, subscriptionPlan: "gold", giftAid: true });
  });

  it("PATCH updates the donor and audits in one transaction (writeWithAudit)", async () => {
    const res = await runPatch({ role, body: { fullName: "Ada L." } });
    expect(res.statusCode).toBe(200);
    // updateDonorPortal ran an audited transaction: UPDATE donors + INSERT audit_log inside BEGIN/COMMIT.
    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    expect(seq.some((s) => /update donors/i.test(s))).toBe(true);
    expect(auditInserts().length).toBeGreaterThanOrEqual(1);
  });

  it("cancels the subscription (Stripe) and audits the admin action", async () => {
    const res = await runCancelSub({ role, body: { subscriptionId: "sub_123", accepted: "cancel" } });
    expect(res.statusCode).toBe(200);
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("sub_123");
    expect(auditInserts().length).toBeGreaterThanOrEqual(1);
  });

  it("refuses subscription cancel without the reduce-instead acknowledgement (400)", async () => {
    const res = await runCancelSub({ role, body: { subscriptionId: "sub_123", accepted: "reduce" } });
    expect(res.statusCode).toBe(400);
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
  });

  it("cancels Gift Aid: revokes the active declaration + audits in one transaction", async () => {
    const res = await runCancelGa({ role });
    expect(res.statusCode).toBe(200);
    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq.some((s) => /update declarations/i.test(s))).toBe(true);
    // No NEW declaration row is inserted (a cancellation has no replacement).
    expect(seq.some((s) => /insert into declarations/i.test(s))).toBe(false);
    expect(auditInserts().length).toBeGreaterThanOrEqual(1);
  });
});

describe("admin donor id validation", () => {
  it("400s a non-numeric donor id", async () => {
    expect((await runGet({ role: "admin", id: "abc" })).statusCode).toBe(400);
  });

  it("404s when the donor does not exist", async () => {
    queryMock.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    expect((await runGet({ role: "admin" })).statusCode).toBe(404);
  });

  it("404s Gift Aid cancel when the donor has no active declaration", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/from declarations/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [donorRow], rowCount: 1 };
    });
    expect((await runCancelGa({ role: "admin" })).statusCode).toBe(404);
  });
});
