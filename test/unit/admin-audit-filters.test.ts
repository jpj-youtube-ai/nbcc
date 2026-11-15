import { describe, it, expect, vi, beforeEach } from "vitest";

// Governance > Audit, the filters (the admin refresh, 2026-11-14): the audit trail can be read by
// part of the admin (several entities at once), by who did it, by UK dates and by a word, and can
// leave out what Stripe, visitors and automatic jobs wrote. Each filter is a plain WHERE clause with
// a bound parameter: nothing a person types is ever put into the SQL itself. The pool is mocked;
// every name and address here is invented.

const { queryMock, getUserAuthRowMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getUserAuthRowMock: vi.fn(),
}));
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

import { listAuditLog } from "../../src/db/admin";
import { getAdminAuditLog } from "../../src/routes/admin";
import { signAdminSession } from "../../src/admin/session";

const flat = (sql: unknown) => String(sql).replace(/\s+/g, " ").trim();
const calls = () => queryMock.mock.calls.map((c) => ({ sql: flat(c[0]), params: (c[1] || []) as unknown[] }));
const countCall = () => calls().find((c) => /^select count\(\*\)::int as count from audit_log/i.test(c.sql))!;
const pageCall = () => calls().find((c) => /order by a\.id desc/i.test(c.sql))!;

beforeEach(() => {
  queryMock.mockReset();
  getUserAuthRowMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }] });
});

describe("listAuditLog", () => {
  it("reads the newest 50 with no filter at all, as it always has", async () => {
    await listAuditLog({});
    expect(countCall().params).toEqual([]);
    expect(countCall().sql).not.toMatch(/where/i);
    expect(pageCall().sql).toMatch(/limit 50 offset 0$/i);
  });

  it("still narrows to one entity and one record, for a record's own history", async () => {
    await listAuditLog({ entity: "business_supporter_fulfilment", entityId: 7 });
    expect(countCall().sql).toMatch(/a\.entity = \$1 and a\.entity_id = \$2/i);
    expect(countCall().params).toEqual(["business_supporter_fulfilment", 7]);
  });

  it("takes several entities at once, as one bound list", async () => {
    await listAuditLog({ entities: ["donation", "donor", "declaration"] });
    expect(countCall().sql).toMatch(/a\.entity = any\(\$1\)/i);
    expect(countCall().params).toEqual([["donation", "donor", "declaration"]]);
    expect(pageCall().params).toEqual([["donation", "donor", "declaration"]]);
  });

  it("finds one member of staff by email, however their lines were stamped", async () => {
    await listAuditLog({ actor: " Fern@Example.com " });
    expect(countCall().sql).toContain("lower(a.actor) IN ('admin:' || $1::text, 'self:' || $1::text, $1::text)");
    expect(countCall().params).toEqual(["fern@example.com"]);
  });

  it("can leave out everything staff did not do", async () => {
    await listAuditLog({ staffOnly: true });
    expect(countCall().sql).toContain("(a.actor LIKE 'admin:%' OR a.actor LIKE 'self:%' OR (a.actor LIKE '%@%' AND a.actor NOT LIKE '%:%'))");
    expect(countCall().params).toEqual([]);
  });

  it("reads From and To as UK calendar days", async () => {
    await listAuditLog({ from: "2026-11-01", to: "2026-11-07" });
    expect(countCall().sql).toMatch(/\(a\.created_at at time zone 'Europe\/London'\)::date >= \$1::date/i);
    expect(countCall().sql).toMatch(/\(a\.created_at at time zone 'Europe\/London'\)::date <= \$2::date/i);
    expect(countCall().params).toEqual(["2026-11-01", "2026-11-07"]);
  });

  it("ignores a date that is not a real day", async () => {
    await listAuditLog({ from: "2026-02-31", to: "yesterday" });
    expect(countCall().sql).not.toMatch(/where/i);
  });

  it("looks for a word in what was done, to what, by whom and in what was recorded", async () => {
    await listAuditLog({ q: "  NBCC-1234 " });
    const sql = countCall().sql;
    expect(sql).toMatch(/a\.action ilike \$1/i);
    expect(sql).toMatch(/a\.entity ilike \$1/i);
    expect(sql).toMatch(/a\.actor ilike \$1/i);
    expect(sql).toMatch(/a\.data::text ilike \$1/i);
    expect(countCall().params).toEqual(["%NBCC-1234%"]);
  });

  it("takes the wild characters in a word literally", async () => {
    await listAuditLog({ q: "100%_off" });
    expect(countCall().params).toEqual(["%100\\%\\_off%"]);
  });

  it("never puts what was typed into the SQL itself", async () => {
    const typed = "x'; DROP TABLE audit_log; --";
    await listAuditLog({ q: typed, actor: typed, entities: [typed], from: typed, to: typed });
    for (const c of calls()) expect(c.sql).not.toContain("DROP TABLE");
  });

  it("uses the same filters for the count and for the page, so they can never disagree", async () => {
    await listAuditLog({ entities: ["user"], actor: "fern@example.com", from: "2026-11-01", q: "role", staffOnly: true, offset: 50 });
    expect(pageCall().params).toEqual(countCall().params);
    expect(pageCall().sql).toMatch(/limit 50 offset 50$/i);
  });

  it("names who did it and who it is about, when they are one of the team", async () => {
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [{ count: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 9, actor: "admin:fern@example.com", action: "admin_user.role_changed", entity: "user", entity_id: 4,
          data: { role: "editor" }, created_at: new Date("2026-11-12T10:00:00Z"), actor_name: "Fern Example",
          about_name: "Sam Example", about_email: "sam@example.com" }],
      });
    const out = await listAuditLog({});
    expect(pageCall().sql).toMatch(/as actor_name/i);
    expect(pageCall().sql).toMatch(/as about_name/i);
    expect(pageCall().sql).toMatch(/as about_email/i);
    expect(out.total).toBe(1);
    expect(out.results[0].actor_name).toBe("Fern Example");
    expect(out.results[0].about_email).toBe("sam@example.com");
    expect(out.counts).toBeUndefined();
    expect(out.people).toBeUndefined();
  });

  describe("with a summary, for the screen's tiles and its list of people", () => {
    beforeEach(() => {
      queryMock.mockReset();
      queryMock.mockImplementation((sql: string) => {
        const s = flat(sql);
        if (/group by a\.entity/i.test(s)) return Promise.resolve({ rows: [{ entity: "donation", count: 12 }, { entity: "user", count: 3 }] });
        if (/select distinct/i.test(s)) return Promise.resolve({ rows: [{ email: "fern@example.com", name: "Fern Example" }, { email: "old@example.com", name: null }] });
        if (/^select count/i.test(s)) return Promise.resolve({ rows: [{ count: 15 }] });
        return Promise.resolve({ rows: [] });
      });
    });

    it("counts the lines by entity under every filter but the entities themselves", async () => {
      const out = await listAuditLog({ entities: ["user"], q: "role", withSummary: true });
      const grouped = calls().find((c) => /group by a\.entity/i.test(c.sql))!;
      expect(grouped.sql).not.toMatch(/any\(/i);
      expect(grouped.sql).toMatch(/a\.action ilike \$1/i);
      expect(grouped.params).toEqual(["%role%"]);
      expect(out.counts).toEqual({ donation: 12, user: 3 });
    });

    it("lists the staff who appear in the log, with their names where they are still on the team", async () => {
      const out = await listAuditLog({ withSummary: true });
      const people = calls().find((c) => /select distinct/i.test(c.sql))!;
      expect(people.sql).toMatch(/a\.actor like 'admin:%'/i);
      expect(people.params).toEqual([]);
      expect(out.people).toEqual([{ email: "fern@example.com", name: "Fern Example" }, { email: "old@example.com", name: null }]);
    });
  });
});

describe("GET /api/admin/audit", () => {
  const tokenFor = (role: string) => {
    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.com", status: "active", role, permissions: {} });
    return signAdminSession({ sub: 1, email: "staff@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
  };
  function mockRes() {
    const res: Record<string, unknown> & { statusCode: number; body: unknown } = { statusCode: 0, body: undefined };
    res.status = (c: number) => ((res.statusCode = c), res);
    res.json = (b: unknown) => ((res.body = b), res);
    return res as never as { statusCode: number; body: { results: unknown[]; total: number; counts?: unknown; people?: unknown } };
  }
  const req = (role: string | null, query: Record<string, unknown> = {}) =>
    ({ headers: role ? { authorization: `Bearer ${tokenFor(role)}` } : {}, query, params: {} }) as never;

  it("is behind the same guard as before: nobody without a session, and nobody without the Audit", async () => {
    const none = mockRes();
    await getAdminAuditLog(req(null, { q: "role" }), none as never);
    expect(none.statusCode).toBe(401);

    getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.com", status: "active", role: "viewer", permissions: { audit: "none" } });
    const token = signAdminSession({ sub: 1, email: "staff@example.com", role: "viewer", now: new Date(), secret: "test-admin-secret" }).token;
    const shut = mockRes();
    await getAdminAuditLog({ headers: { authorization: `Bearer ${token}` }, query: { q: "role" }, params: {} } as never, shut as never);
    expect(shut.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("hands each filter on from the address, and a Viewer may use them", async () => {
    const res = mockRes();
    await getAdminAuditLog(
      req("viewer", { entities: "donation,donor", actor: "fern@example.com", staff: "1", from: "2026-11-01", to: "2026-11-07", q: "refund", offset: "50", limit: "50" }),
      res as never,
    );
    expect(res.statusCode).toBe(200);
    expect(countCall().params).toEqual([["donation", "donor"], "fern@example.com", "2026-11-01", "2026-11-07", "%refund%"]);
    expect(countCall().sql).toMatch(/a\.actor like 'admin:%'/i);
    expect(pageCall().sql).toMatch(/limit 50 offset 50$/i);
    // No summary unless it is asked for: one count and one page, as before.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it("ignores entities that are not plain names, and a list that is far too long", async () => {
    const res = mockRes();
    await getAdminAuditLog(req("viewer", { entities: "donation, DROP TABLE x;,donor,," }), res as never);
    expect(countCall().params).toEqual([["donation", "donor"]]);

    queryMock.mockClear();
    const many = Array.from({ length: 80 }, (_, i) => "thing_" + "a".repeat((i % 50) + 1)).join(",");
    await getAdminAuditLog(req("viewer", { entities: many }), mockRes() as never);
    expect((countCall().params[0] as string[]).length).toBe(40);
  });

  it("adds the counts and the people only when the screen asks for its summary", async () => {
    const res = mockRes();
    await getAdminAuditLog(req("viewer", { summary: "1" }), res as never);
    expect(res.statusCode).toBe(200);
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(res.body.counts).toBeDefined();
    expect(res.body.people).toBeDefined();
  });
});
