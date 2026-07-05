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
  getAdminSearchDonors,
  getAdminSearchDeclarations,
  getAdminSearchDonations,
  postAdminSubmitClaimBatch,
  postAdminCreateClaimBatch,
  getAdminEligibleForClaim,
  postAdminAssignBatchDonations,
  getAdminAdjustmentDue,
  getAdminRetentionExpiry,
  getAdminAwaitingDeclaration,
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
function req(opts: { id?: string; role?: string; token?: string; body?: unknown; query?: unknown }) {
  const headers: Record<string, string> = {};
  const token = opts.token !== undefined ? opts.token : opts.role ? tokenFor(opts.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: opts.id ?? "42" }, headers, body: opts.body ?? {}, query: opts.query ?? {} };
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const runGet = async (o: any) => { const res = mockRes(); await getAdminDonor(req(o) as any, res as any); return res; };
const runPatch = async (o: any) => { const res = mockRes(); await patchAdminDonor(req(o) as any, res as any); return res; };
const runCancelSub = async (o: any) => { const res = mockRes(); await postAdminCancelSubscription(req(o) as any, res as any); return res; };
const runCancelGa = async (o: any) => { const res = mockRes(); await postAdminCancelGiftAid(req(o) as any, res as any); return res; };
const runSearchDonors = async (o: any) => { const res = mockRes(); await getAdminSearchDonors(req(o) as any, res as any); return res; };
const runSearchDeclarations = async (o: any) => { const res = mockRes(); await getAdminSearchDeclarations(req(o) as any, res as any); return res; };
const runSearchDonations = async (o: any) => { const res = mockRes(); await getAdminSearchDonations(req(o) as any, res as any); return res; };
const runSubmitBatch = async (o: any) => { const res = mockRes(); await postAdminSubmitClaimBatch(req(o) as any, res as any); return res; };
const runCreateBatch = async (o: any) => { const res = mockRes(); await postAdminCreateClaimBatch(req(o) as any, res as any); return res; };
const runEligible = async (o: any) => { const res = mockRes(); await getAdminEligibleForClaim(req(o) as any, res as any); return res; };
const runAssign = async (o: any) => { const res = mockRes(); await postAdminAssignBatchDonations(req(o) as any, res as any); return res; };
const runAdjustmentDue = async (o: any) => { const res = mockRes(); await getAdminAdjustmentDue(req(o) as any, res as any); return res; };
const runRetentionExpiry = async (o: any) => { const res = mockRes(); await getAdminRetentionExpiry(req(o) as any, res as any); return res; };
const runAwaitingDeclaration = async (o: any) => { const res = mockRes(); await getAdminAwaitingDeclaration(req(o) as any, res as any); return res; };
/* eslint-enable @typescript-eslint/no-explicit-any */

const donorRow = {
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  email_consent: true,
  anonymous: false,
  subscription_plan: "gold",
  subscription_id: "sub_123",
  gift_aid: true,
  // Address fields read by getDonorAddress (getAdminDonor merges them into the response). An
  // individual's postal address lives on their latest non-revoked declaration; a company's on the
  // donor's billing_* columns. Present here so the shared `from donors` mock feeds both queries.
  donor_type: "individual",
  house_name_number: "12",
  address: "Analytical Avenue, London",
  postcode: "KA1 1AA",
  billing_address: null,
  billing_postcode: null,
};

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  cancelSubscriptionMock.mockClear();

  queryMock.mockImplementation(async (sql: string) => {
    // `from donors` (getDonorPortalSnapshot, searchDonors) is checked before `from donations` so the
    // snapshot query — which references `from donations` only in a subquery — isn't misrouted.
    if (/from donors/i.test(sql)) return { rows: [donorRow], rowCount: 1 };
    if (/from donations/i.test(sql)) return { rows: [{ id: 5, donor_id: 42, donor_name: "Ada Lovelace" }], rowCount: 1 };
    // findActiveDeclarationIdForDonor + searchDeclarations both read declarations.
    if (/from declarations/i.test(sql)) return { rows: [{ id: 77, donor_id: 42 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    // the FOR UPDATE lock inside adminCancelGiftAid's transaction
    if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [{ id: 77, donor_id: 42, revoked_at: null }], rowCount: 1 };
    // the FOR UPDATE lock inside submitClaimBatch's transaction — an open batch by default
    if (/select[\s\S]*from claim_batches/i.test(sql)) return { rows: [{ id: 9, status: "open" }], rowCount: 1 };
    if (/update donors/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update declarations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update claim_batches/i.test(sql)) return { rowCount: 1, rows: [] };
    // createClaimBatch's INSERT … RETURNING id
    if (/insert into claim_batches/i.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
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

// --- Admin search (REQ-062 · TASK-108) ----------------------------------------------------------
const SEARCHERS: Array<[string, (o: unknown) => Promise<MockRes>]> = [
  ["donors", runSearchDonors],
  ["declarations", runSearchDeclarations],
  ["donations", runSearchDonations],
];

describe("admin search endpoints require a valid token (401)", () => {
  it.each(SEARCHERS)("401s /search/%s with no token", async (_name, run) => {
    expect((await run({ token: "", query: { q: "ada" } })).statusCode).toBe(401);
  });

  it.each(SEARCHERS)("401s /search/%s with a token signed with the wrong key", async (_name, run) => {
    const forged = signAdminSession({ sub: 1, email: "x@y.co", role: "admin", now: new Date(), secret: "wrong" }).token;
    expect((await run({ token: forged, query: { q: "ada" } })).statusCode).toBe(401);
  });
});

describe.each(["viewer", "editor", "admin"])("admin search: role %s (viewer-or-above) gets results", (role) => {
  it.each(SEARCHERS)("200s /search/%s and returns matching rows", async (_name, run) => {
    const res = await run({ role, query: { q: "ada" } });
    expect(res.statusCode).toBe(200);
    const body = res.body as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });
});

describe("admin search query validation", () => {
  it.each(SEARCHERS)("400s /search/%s with a missing / blank q", async (_name, run) => {
    expect((await run({ role: "admin", query: {} })).statusCode).toBe(400);
    expect((await run({ role: "admin", query: { q: "   " } })).statusCode).toBe(400);
  });

  it("passes the query to the db layer as an ILIKE pattern (donors)", async () => {
    await runSearchDonors({ role: "admin", query: { q: "Ada" } });
    const call = queryMock.mock.calls.find((c) => /from donors/i.test(String(c[0])));
    expect(call?.[1]?.[0]).toBe("%Ada%");
  });

  it("matches an all-digits query by id too (numeric param non-null)", async () => {
    await runSearchDonors({ role: "admin", query: { q: "42" } });
    const call = queryMock.mock.calls.find((c) => /from donors/i.test(String(c[0])));
    expect(call?.[1]?.[0]).toBe("%42%");
    expect(call?.[1]?.[1]).toBe(42);
  });
});

// --- Admin claim operations (REQ-052/REQ-063 · TASK-109) ----------------------------------------
describe("POST /api/admin/claim-batches/:id/submit", () => {
  it("401s with no token", async () => {
    expect((await runSubmitBatch({ token: "", id: "9" })).statusCode).toBe(401);
  });

  it("403s a Viewer (submitting is a write)", async () => {
    const res = await runSubmitBatch({ role: "viewer", id: "9" });
    expect(res.statusCode).toBe(403);
    // No write happened.
    expect(clientQueryMock.mock.calls.some((c) => /update claim_batches/i.test(String(c[0])))).toBe(false);
  });

  it.each(["editor", "admin"])("lets %s submit: marks submitted + one audit row in one transaction", async (role) => {
    const res = await runSubmitBatch({ role, id: "9" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ submitted: true, batchId: 9 });

    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);
    // Locked FOR UPDATE, set status='submitted', and appended exactly one audit row, all in-tx.
    expect(seq.some((s) => /select[\s\S]*from claim_batches[\s\S]*for update/i.test(s))).toBe(true);
    const update = clientQueryMock.mock.calls.find((c) => /update claim_batches/i.test(String(c[0])));
    expect(update?.[0]).toMatch(/status\s*=\s*'submitted'/i);
    expect(update?.[0]).toMatch(/submitted_at/i);
    const audits = clientQueryMock.mock.calls.filter((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audits).toHaveLength(1);
    expect(audits[0][1][1]).toBe("claim_batch.submitted");
  });

  it("404s an unknown batch and 409s a non-open batch, writing nothing", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select[\s\S]*from claim_batches/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    expect((await runSubmitBatch({ role: "editor", id: "9" })).statusCode).toBe(404);

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select[\s\S]*from claim_batches/i.test(sql)) return { rows: [{ id: 9, status: "submitted" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const res = await runSubmitBatch({ role: "editor", id: "9" });
    expect(res.statusCode).toBe(409);
    expect(clientQueryMock.mock.calls.some((c) => /update claim_batches/i.test(String(c[0])))).toBe(false);
  });

  it("400s a non-numeric batch id", async () => {
    expect((await runSubmitBatch({ role: "admin", id: "abc" })).statusCode).toBe(400);
  });
});

describe("GET /api/admin/claims/adjustment-due", () => {
  it("401s with no token", async () => {
    expect((await runAdjustmentDue({ token: "" })).statusCode).toBe(401);
  });

  it.each(["viewer", "editor", "admin"])("lets %s (viewer-or-above) list adjustment-due donations", async (role) => {
    const res = await runAdjustmentDue({ role });
    expect(res.statusCode).toBe(200);
    const body = res.body as { results: unknown[] };
    expect(Array.isArray(body.results)).toBe(true);
    // The query filters on claim_status='adjustment_due'.
    const call = queryMock.mock.calls.find((c) => /adjustment_due/i.test(String(c[0])));
    expect(call).toBeTruthy();
  });
});

// --- Retention-expiry + awaiting-declaration queues (REQ-046/REQ-049 · TASK-110) ----------------
describe("GET /api/admin/queues/retention-expiry", () => {
  it("401s with no token", async () => {
    expect((await runRetentionExpiry({ token: "" })).statusCode).toBe(401);
  });

  it.each(["viewer", "editor", "admin"])("lets %s list declarations the calculator flags as expired", async (role) => {
    // A revoked, this-donation declaration whose final claimed charge is >6 years old → expired.
    queryMock.mockImplementation(async (sql: string) => {
      if (/from declarations/i.test(sql)) {
        return {
          rows: [{
            id: 1, donor_id: 42, first_name: "Ada", last_name: "Lovelace",
            scope: "this_donation", revoked_at: new Date("2018-01-01T00:00:00Z"),
            last_claimed_at: new Date("2017-01-01T00:00:00Z"),
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await runRetentionExpiry({ role });
    expect(res.statusCode).toBe(200);
    const body = res.body as { results: Array<{ id: number; flag: string; retentionExpiry: string }> };
    expect(body.results.length).toBe(1);
    expect(body.results[0]).toMatchObject({ id: 1, flag: "expired" });
    // 2017-01-01 + 6 years = 2023-01-01, in the past → expired.
    expect(new Date(body.results[0].retentionExpiry).getUTCFullYear()).toBe(2023);
  });

  it("omits declarations retained indefinitely (a live enduring declaration)", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/from declarations/i.test(sql)) {
        return {
          rows: [{
            id: 2, donor_id: 42, first_name: "Ada", last_name: "Lovelace",
            scope: "all_donations", revoked_at: null, last_claimed_at: new Date("2020-01-01T00:00:00Z"),
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await runRetentionExpiry({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect((res.body as { results: unknown[] }).results).toHaveLength(0);
  });
});

describe("GET /api/admin/queues/awaiting-declaration", () => {
  it("401s with no token", async () => {
    expect((await runAwaitingDeclaration({ token: "" })).statusCode).toBe(401);
  });

  it.each(["viewer", "editor", "admin"])("lets %s list sent/undelivered donations (bounced included)", async (role) => {
    const res = await runAwaitingDeclaration({ role });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.body as { results: unknown[] }).results)).toBe(true);
    // The query filters declaration_status to 'sent'/'undelivered' (bounced emails included).
    const call = queryMock.mock.calls.find((c) => /declaration_status\s+in\s*\(\s*'sent'\s*,\s*'undelivered'\s*\)/i.test(String(c[0])));
    expect(call).toBeTruthy();
  });
});

// --- claims pipeline: create batch, eligible list, assign-to-batch (TASK-NNN) -------------------
describe("POST /api/admin/claim-batches (create)", () => {
  it("401s with no token", async () => {
    expect((await runCreateBatch({ token: "" })).statusCode).toBe(401);
  });
  it("403s a Viewer (create is a write)", async () => {
    const res = await runCreateBatch({ role: "viewer" });
    expect(res.statusCode).toBe(403);
    // No INSERT into claim_batches attempted.
    expect(clientQueryMock.mock.calls.some((c) => /insert into claim_batches/i.test(String(c[0])))).toBe(false);
  });
  it("creates a batch for an Editor and returns its id (201) with a claim_batch.created audit row", async () => {
    const res = await runCreateBatch({ role: "editor", body: {} });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ batchId: 77 });
    expect(auditInserts().length).toBe(1);
  });
});

describe("GET /api/admin/claims/eligible", () => {
  it("401s with no token", async () => {
    expect((await runEligible({ token: "" })).statusCode).toBe(401);
  });
  it("lets a Viewer list the eligible-unbatched donations", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 5, donor_name: "Ada Lovelace", amount_pence: 5000, postcode: "KA1 1AA", created_at: new Date(0) }],
      rowCount: 1,
    });
    const res = await runEligible({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    expect((res.body as { results: unknown[] }).results).toHaveLength(1);
  });
});

describe("POST /api/admin/claim-batches/:id/donations (assign)", () => {
  it("403s a Viewer (assign is a write)", async () => {
    const res = await runAssign({ role: "viewer", body: { donationIds: [1] } });
    expect(res.statusCode).toBe(403);
  });
  it("400s an empty donationIds body", async () => {
    const res = await runAssign({ role: "editor", body: { donationIds: [] } });
    expect(res.statusCode).toBe(400);
  });
  it("assigns each id and reports per-id failures (already batched)", async () => {
    // Drive batchDonation's FOR UPDATE lock per donation id: id 2 is already batched → blocked.
    clientQueryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
      if (/select[\s\S]*from donations[\s\S]*for update/i.test(sql)) {
        const donationId = Array.isArray(params) ? params[0] : undefined;
        return donationId === 2
          ? { rows: [{ claim_status: "batched", claim_batch_id: 5 }], rowCount: 1 }
          : { rows: [{ claim_status: "eligible", claim_batch_id: null }], rowCount: 1 };
      }
      if (/update donations/i.test(sql)) return { rowCount: 1, rows: [] };
      if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = await runAssign({ id: "9", role: "editor", body: { donationIds: [1, 2] } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ assigned: [1], failed: [{ id: 2, reason: "already_batched" }] });
  });
});

// --- donor detail now includes the postal address (declaration for individuals, billing for companies) ---
describe("GET /api/admin/donors/:id — postal address", () => {
  it("returns the individual's declaration address + postcode merged onto the snapshot", async () => {
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    const b = res.body as { postcode?: string; address?: string; houseNameNumber?: string };
    expect(b.postcode).toBe("KA1 1AA");
    expect(b.address).toBe("Analytical Avenue, London");
    expect(b.houseNameNumber).toBe("12");
  });

  it("returns the company's billing address + postcode for a company donor", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/from donors/i.test(sql)) {
        return {
          rows: [{ ...donorRow, donor_type: "company", house_name_number: null, address: null, postcode: null, billing_address: "1 Office Park, London", billing_postcode: "SW1A 1AA" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = await runGet({ role: "viewer" });
    expect(res.statusCode).toBe(200);
    const b = res.body as { postcode?: string; address?: string };
    expect(b.postcode).toBe("SW1A 1AA");
    expect(b.address).toBe("1 Office Park, London");
  });
});
