import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-130 (REQ-059/REQ-062): PATCH /api/admin/donors/:id/declaration lets Editor+ staff correct the
// identity/address on a donor's active declaration (amend) + sync the account name, audited as
// admin:<email>. Pool + config mocked; admin token real (signAdminSession).

const { queryMock, clientQueryMock, connect } = vi.hoisted(() => {
  const queryMock = vi.fn();
  const clientQueryMock = vi.fn();
  const mockClient = { query: clientQueryMock, release: vi.fn() };
  const connect = vi.fn(async () => mockClient);
  return { queryMock, clientQueryMock, connect };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
  },
}));
vi.mock("../../src/clients/stripe", () => ({ cancelSubscription: vi.fn() }));

import { patchAdminDeclaration } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const SECRET = "test-admin-secret";
const tokenFor = (role: string) =>
  signAdminSession({ sub: 1, email: "kenny@nbcc.test", role, now: new Date(), secret: SECRET }).token;

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockRes = { statusCode: number; body: any; status: (c: number) => MockRes; json: (b: any) => MockRes };
const mockRes = (): MockRes => {
  const res = { statusCode: 200, body: undefined } as MockRes;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};
const req = (o: { role?: string; token?: string; id?: string; body?: unknown }) => {
  const headers: Record<string, string> = {};
  const token = o.token !== undefined ? o.token : o.role ? tokenFor(o.role) : undefined;
  if (token) headers.authorization = `Bearer ${token}`;
  return { params: { id: o.id ?? "42" }, headers, body: o.body ?? {} };
};
const run = async (o: any) => {
  const res = mockRes();
  await patchAdminDeclaration(req(o) as any, res as any);
  return res;
};

// The active declaration on file: body matches it except the address, so the edit is an AMEND.
const activeRow = {
  id: 77,
  donor_id: 42,
  title: "Dr",
  first_name: "Ada",
  last_name: "Lovelace",
  house_name_number: "12",
  address: "Old Ave, London",
  postcode: "SW1A 1AA",
  non_uk: false,
  scope: "all_donations",
  confirmed_taxpayer: true,
  revoked_at: null,
};
const body = {
  title: "Dr",
  firstName: "Ada",
  lastName: "Lovelace",
  houseNameNumber: "12",
  address: "New Road, Ayr",
  postcode: "KA7 1AA",
  nonUk: false,
};
let activeExists = true;

beforeEach(() => {
  queryMock.mockReset();
  clientQueryMock.mockReset();
  connect.mockClear();
  activeExists = true;
  queryMock.mockImplementation(async (sql: string) => {
    if (/from declarations/i.test(sql)) {
      return { rows: activeExists ? [activeRow] : [], rowCount: activeExists ? 1 : 0 };
    }
    if (/from donors/i.test(sql)) {
      return {
        rows: [
          {
            full_name: "Ada Lovelace",
            email: "ada@example.com",
            email_consent: true,
            anonymous: false,
            subscription_plan: null,
            subscription_id: null,
            gift_aid: true,
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*(begin|commit|rollback)/i.test(sql)) return {};
    if (/select[\s\S]*from declarations/i.test(sql)) return { rows: [activeRow], rowCount: 1 }; // FOR UPDATE
    if (/update declarations/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/update donors/i.test(sql)) return { rowCount: 1, rows: [] };
    if (/insert into audit_log/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
});

const clientSqls = () => clientQueryMock.mock.calls.map((c) => String(c[0]));
const clientHas = (re: RegExp) => clientSqls().some((s) => re.test(s));
const auditActions = () =>
  clientQueryMock.mock.calls
    .filter((c) => /insert into audit_log/i.test(String(c[0])))
    .map((c) => (c[1] as any[])[1]);

describe("PATCH /api/admin/donors/:id/declaration (TASK-130)", () => {
  it("amends the declaration + syncs the name for an editor, audited as admin:<email>", async () => {
    const res = await run({ role: "editor", body });
    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe("amended");
    const declUpdate = clientQueryMock.mock.calls.find((c) => /update declarations/i.test(String(c[0])));
    expect(String(declUpdate?.[0])).not.toMatch(/revoked_at/i);
    expect(auditActions()).toContain("declaration.amended");
    expect(clientHas(/update donors/i)).toBe(true);
  });

  it("403s a viewer (read-only) and writes nothing", async () => {
    const res = await run({ role: "viewer", body });
    expect(res.statusCode).toBe(403);
    expect(clientHas(/update declarations/i)).toBe(false);
    expect(clientHas(/update donors/i)).toBe(false);
  });

  it("404s when the donor has no active declaration", async () => {
    activeExists = false;
    const res = await run({ role: "editor", body });
    expect(res.statusCode).toBe(404);
    expect(clientHas(/update declarations/i)).toBe(false);
  });

  it("400s on an invalid body (blank last name)", async () => {
    const res = await run({ role: "editor", body: { ...body, lastName: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("401s without a token", async () => {
    const res = await run({ token: "", body });
    expect(res.statusCode).toBe(401);
  });
});
