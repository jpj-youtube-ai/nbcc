import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-101 (REQ-061): the self-serve donor portal API. Every route authenticates the magic-link
// token (verifyPortalToken) and 401s an invalid/expired one. GET returns the donor snapshot; PATCH
// updates the donor + appends a donor.updated audit row in the SAME transaction. DB-free: pool
// (query for reads, connect for the writeWithAudit transaction) + config are mocked.

const { queryMock, clientQueryMock, mockClient, connect } = vi.hoisted(() => {
  const queryMock = vi.fn(); // pool.query — reads
  const clientQueryMock = vi.fn(); // client.query — the writeWithAudit transaction
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, clientQueryMock, mockClient, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    // portal.ts imports the stripe client (cancelSubscription), which builds `new Stripe(...)` at
    // module load — needs a non-empty key + webhook secret even though these tests never cancel.
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  },
}));

import { getPortal, patchPortal } from "../../src/routes/portal";

// A valid (unexpired, unused) token row for donor 42.
let tokenRow: { token: string; donor_id: number; expires_at: Date; used_at: Date | null } | undefined;

function installPoolQuery() {
  queryMock.mockImplementation(async (sql: string) => {
    if (/from portal_access_tokens/i.test(sql)) {
      return { rows: tokenRow ? [tokenRow] : [], rowCount: tokenRow ? 1 : 0 };
    }
    if (/from donors/i.test(sql)) {
      return {
        rows: [
          {
            full_name: "Ada Lovelace",
            email: "ada@example.com",
            email_consent: true,
            anonymous: false,
            subscription_plan: "gold",
            subscription_id: "sub_123",
            gift_aid: true,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

function installClientQuery() {
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/update donors/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
}

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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runGet = async (token: string) => { const res = mockRes(); await getPortal({ params: { token } } as any, res as any); return res; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const runPatch = async (token: string, body: unknown) => { const res = mockRes(); await patchPortal({ params: { token }, body } as any, res as any); return res; };

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  mockClient.release.mockClear();
  connect.mockClear();
  tokenRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() + 60_000), used_at: null };
  installPoolQuery();
  installClientQuery();
});

describe("GET /api/portal/:token (REQ-061)", () => {
  it("returns the donor's details, subscription plan and Gift Aid status for a valid token", async () => {
    const res = await runGet("tok_1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      donorId: 42,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      emailConsent: true,
      anonymous: false,
      subscriptionPlan: "gold",
      subscriptionId: "sub_123",
      giftAid: true,
      history: { totalPence: 0, count: 0, donations: [] },
    });
  });

  it("401s on an unknown token", async () => {
    tokenRow = undefined;
    const res = await runGet("nope");
    expect(res.statusCode).toBe(401);
  });

  it("401s on an expired token", async () => {
    tokenRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() - 1), used_at: null };
    const res = await runGet("tok_1");
    expect(res.statusCode).toBe(401);
  });

  it("401s on an already-used token", async () => {
    tokenRow = { token: "tok_1", donor_id: 42, expires_at: new Date(Date.now() + 60_000), used_at: new Date() };
    const res = await runGet("tok_1");
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /api/portal/:token (REQ-061)", () => {
  it("updates full_name/email/consent and appends a donor.updated audit row in the same transaction", async () => {
    const res = await runPatch("tok_1", { fullName: "Ada L.", email: "new@example.com", emailConsent: false });
    expect(res.statusCode).toBe(200);

    const seq = clientQueryMock.mock.calls.map((c) => String(c[0]).trim());
    expect(seq[0]).toMatch(/^begin/i);
    expect(seq[seq.length - 1]).toMatch(/^commit/i);

    const update = clientQueryMock.mock.calls.find((c) => /update donors/i.test(String(c[0])));
    expect(update?.[0]).toMatch(/full_name/i);
    expect(update?.[0]).toMatch(/email/i);
    expect(update?.[1]).toEqual(["Ada L.", "new@example.com", false, 42]);

    const audit = clientQueryMock.mock.calls.find((c) => /insert into audit_log/i.test(String(c[0])));
    expect(audit?.[1][1]).toBe("donor.updated"); // action
    expect(audit?.[1][3]).toBe(42); // entity_id = donor id
    // The audit INSERT is inside the transaction (before COMMIT).
    const auditIdx = seq.findIndex((s) => /insert into audit_log/i.test(s));
    const commitIdx = seq.findIndex((s) => /^commit/i.test(s));
    expect(auditIdx).toBeGreaterThan(0);
    expect(auditIdx).toBeLessThan(commitIdx);
  });

  it("401s on an invalid token before any write", async () => {
    tokenRow = undefined;
    const res = await runPatch("nope", { fullName: "X" });
    expect(res.statusCode).toBe(401);
    expect(connect).not.toHaveBeenCalled();
  });

  it("400s on an empty body (no fields to update)", async () => {
    const res = await runPatch("tok_1", {});
    expect(res.statusCode).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("400s on an invalid email", async () => {
    const res = await runPatch("tok_1", { email: "not-an-email" });
    expect(res.statusCode).toBe(400);
  });
});
