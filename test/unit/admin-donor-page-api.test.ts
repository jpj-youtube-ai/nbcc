import { describe, it, expect, vi, beforeEach } from "vitest";

// One donor's page (2026-11-14 admin refresh): the two reads beside GET /api/admin/donors/:id.
//   GET /api/admin/donors/:id/giving   what they have given, and the truth about their monthly gift
//   GET /api/admin/donors/:id/history  their lines from the audit trail
// Both are guarded exactly as the donor read is (the Donations section, to look). DB-free: the pool
// and the person's own row are mocked. Every name and figure is invented.

const { queryMock, getUserAuthRowMock } = vi.hoisted(() => ({ queryMock: vi.fn(), getUserAuthRowMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
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

import { adminRouter, getAdminDonorGiving, getAdminDonorHistory } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";
import type { PermissionMap } from "../../src/admin/permissions";

type AuthRow = { id: number; email: string; status: string; role: string; permissions: PermissionMap };
let authRow: AuthRow;
const token = () => signAdminSession({ sub: 1, email: "fern@example.com", role: authRow.role, now: new Date(), secret: "test-admin-secret" }).token;

type MockRes = { statusCode: number; body: unknown; status: (c: number) => MockRes; json: (b: unknown) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
type Handler = (req: never, res: never) => Promise<unknown>;
async function run(handler: Handler, opts: { id?: string; signedIn?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.signedIn !== false) headers.authorization = "Bearer " + token();
  const res = mockRes();
  await handler({ params: { id: opts.id ?? "7" }, headers, body: {}, query: {} } as never, res as never);
  return res;
}

const donorRow = {
  full_name: "Rowan Example", email: "rowan@example.com", email_consent: true, anonymous: false,
  hidden_from_supporters: false, subscription_plan: "silver", subscription_id: "sub_pretend", gift_aid: true,
};
let donor: typeof donorRow | null;
let broken: RegExp | null;

beforeEach(() => {
  authRow = { id: 1, email: "fern@example.com", status: "active", role: "viewer", permissions: {} };
  donor = donorRow;
  broken = null;
  getUserAuthRowMock.mockReset();
  getUserAuthRowMock.mockImplementation(async () => authRow);
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (broken && broken.test(sql)) throw new Error("the database is away");
    // The donor snapshot (it mentions donations only inside its sub-selects).
    if (/FROM donors dn\s+WHERE dn\.id = \$1/.test(sql)) return { rows: donor ? [donor] : [] };
    if (/FROM subscription_dunning/.test(sql)) return { rows: [{ status: "active", cancelled_at: null, lapsed_at: null, failed_attempts: 0 }] };
    if (/FROM audit_log/.test(sql) && /admin\.subscription_cancelled/.test(sql)) return { rows: [] };
    if (/FROM audit_log/.test(sql)) {
      return { rows: [{ id: 3, actor: "admin:fern@example.com", action: "donor.updated", data: { fields: ["email"] }, created_at: new Date("2026-11-14T16:00:00Z") }] };
    }
    if (/stripe_subscription_id = \$2/.test(sql)) return { rows: [{ amount_pence: 1000, created_at: new Date("2026-06-01T08:00:00Z") }] };
    if (/count\(\*\) FILTER/.test(sql)) {
      return { rows: [{ paid_count: 1, all_count: 1, total_pence: 1000, first_at: new Date("2026-06-01T08:00:00Z"), latest_at: new Date("2026-06-01T08:00:00Z") }] };
    }
    if (/FROM donations d/.test(sql)) {
      return { rows: [{ id: 31, donor_id: 7, created_at: new Date("2026-06-01T08:00:00Z"), amount_pence: 1000, refunded_amount_pence: 0, mode: "monthly", plan: "silver", gift_aid: true, payment_status: "paid", source: null, invoice_id: null }] };
    }
    return { rows: [] };
  });
});

describe.each([
  ["giving", getAdminDonorGiving as Handler],
  ["history", getAdminDonorHistory as Handler],
])("GET /api/admin/donors/:id/%s is guarded as the donor read is", (_name, handler) => {
  it("refuses someone who is not signed in", async () => {
    expect((await run(handler, { signedIn: false })).statusCode).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("refuses someone without the Donations section, and reads nothing", async () => {
    authRow = { ...authRow, permissions: { donations: "none", search: "view" } };
    expect((await run(handler)).statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("answers someone who may only look at Donations", async () => {
    authRow = { ...authRow, permissions: { donations: "view" } };
    expect((await run(handler)).statusCode).toBe(200);
  });

  it("refuses an id that is not a number", async () => {
    expect((await run(handler, { id: "abc" })).statusCode).toBe(400);
  });

  it("says the donor is not there, rather than answering with nothing", async () => {
    donor = null;
    const res = await run(handler);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Donor not found" });
  });

  it("says so when the read fails, and never answers with empty figures", async () => {
    broken = /FROM (donations d|audit_log)/;
    const res = await run(handler);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("GET /api/admin/donors/:id/giving", () => {
  it("answers with the figures, each gift, and the truth about the monthly gift", async () => {
    const res = await run(getAdminDonorGiving as Handler);
    expect(res.body).toEqual({
      totalPence: 1000, count: 1, listed: 1, firstAt: "2026-06-01T08:00:00.000Z", latestAt: "2026-06-01T08:00:00.000Z",
      gifts: [{ id: 31, donorId: 7, date: "2026-06-01T08:00:00.000Z", amountPence: 1000, refundedPence: 0, mode: "monthly", plan: "silver", giftAid: true, status: "paid", source: null, invoiceId: null }],
      monthly: { subscriptionId: "sub_pretend", plan: "silver", state: "active", monthlyPence: 1000, firstPaidAt: "2026-06-01T08:00:00.000Z", payments: 1, cancelledAt: null, lapsedAt: null, failedAttempts: 0 },
    });
  });

  it("has no monthly gift to describe for a donor who never had one", async () => {
    donor = { ...donorRow, subscription_plan: null as unknown as string, subscription_id: null as unknown as string };
    const res = await run(getAdminDonorGiving as Handler);
    expect((res.body as { monthly: unknown }).monthly).toBe(null);
    expect(queryMock.mock.calls.some((c) => /FROM subscription_dunning/.test(String(c[0])))).toBe(false);
  });
});

describe("GET /api/admin/donors/:id/history", () => {
  it("answers with who, what and when, newest first", async () => {
    const res = await run(getAdminDonorHistory as Handler);
    expect(res.body).toEqual({
      results: [{ id: 3, action: "donor.updated", actor: "admin:fern@example.com", at: "2026-11-14T16:00:00.000Z", fields: ["email"] }],
    });
  });
});

describe("the two reads are mounted beside the donor read", () => {
  const routes = (adminRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack
    .filter((l) => l.route)
    .map((l) => Object.keys(l.route!.methods)[0] + " " + l.route!.path);

  it("as GETs, and nothing that changes anything", () => {
    expect(routes).toContain("get /api/admin/donors/:id/giving");
    expect(routes).toContain("get /api/admin/donors/:id/history");
    expect(routes.filter((r) => /\/donors\/:id\/(giving|history)$/.test(r))).toHaveLength(2);
  });
});
