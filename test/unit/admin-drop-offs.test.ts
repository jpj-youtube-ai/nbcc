import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin > Giving > Workshop drop-offs: the list (Donations view) and Remove (Donations edit). The
// database is mocked. Invented names only.

const m = vi.hoisted(() => ({ getUserAuthRow: vi.fn(), listDropOffs: vi.fn(), removeDropOff: vi.fn(), recordAudit: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: m.getUserAuthRow }));
vi.mock("../../src/db/workshop-dropoffs", () => ({ listDropOffs: m.listDropOffs, removeDropOff: m.removeDropOff }));
vi.mock("../../src/db/donations", () => ({ recordAudit: m.recordAudit }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { getAdminDropOffs, deleteAdminDropOff } from "../../src/routes/admin-drop-offs";
import { signAdminSession } from "../../src/admin/session";

const tokenFor = (role: "admin" | "viewer", permissions: Record<string, string> = {}) => {
  m.getUserAuthRow.mockResolvedValue({ id: 4, email: "staff@example.com", status: "active", role, permissions });
  return signAdminSession({ sub: 4, email: "staff@example.com", role, now: new Date(), secret: "test-admin-secret" }).token;
};

type MockRes = { statusCode: number; body: unknown; headers: Record<string, string>; status: (c: number) => MockRes; json: (b: unknown) => MockRes; setHeader: (k: string, v: string) => MockRes };
function mockRes(): MockRes {
  const res = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, string> } as MockRes;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  return res;
}
const call = async (handler: (rq: never, rs: never) => Promise<unknown>, token: string | null, params: Record<string, string> = {}) => {
  const res = mockRes();
  await handler({ headers: token ? { authorization: `Bearer ${token}` } : {}, params, query: {}, body: {} } as never, res as never);
  return res;
};

const ROW = {
  id: 3, name: "Robin Example", email: "robin@example.com", brought: "Selection boxes", groupName: "Church group", phone: null, newsletter: true,
  createdAt: new Date("2026-11-28T10:00:00Z"), letterSentAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.listDropOffs.mockResolvedValue([ROW]);
  m.removeDropOff.mockImplementation(async (id: number) => id === 3);
  m.recordAudit.mockResolvedValue(undefined);
});

describe("GET /api/admin/drop-offs", () => {
  it("lists them for anyone who can see Donations", async () => {
    const res = await call(getAdminDropOffs, tokenFor("viewer", { donations: "view" }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ dropOffs: [ROW] });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("is closed to someone who cannot see Donations, and to nobody signed in", async () => {
    expect((await call(getAdminDropOffs, tokenFor("viewer", { newsletter: "edit" }))).statusCode).toBe(403);
    expect((await call(getAdminDropOffs, null)).statusCode).toBe(401);
  });
});

describe("DELETE /api/admin/drop-offs/:id", () => {
  it("removes one for someone who can edit Donations, and keeps a record of who did", async () => {
    const res = await call(deleteAdminDropOff, tokenFor("viewer", { donations: "edit" }), { id: "3" });
    expect(res.statusCode).toBe(200);
    expect(m.removeDropOff).toHaveBeenCalledWith(3);
    expect(m.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "workshop_dropoff.removed", entity: "workshop_dropoff", entityId: 3 }));
  });

  it("is refused to a viewer, and answers 404 for one that is not there", async () => {
    expect((await call(deleteAdminDropOff, tokenFor("viewer", { donations: "view" }), { id: "3" })).statusCode).toBe(403);
    expect((await call(deleteAdminDropOff, tokenFor("admin"), { id: "99" })).statusCode).toBe(404);
    expect((await call(deleteAdminDropOff, tokenFor("admin"), { id: "abc" })).statusCode).toBe(404);
  });
});
