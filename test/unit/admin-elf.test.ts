import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School in the admin: the switch, the pay what you can amounts, and the sign ups.
// Every family here is invented.

const { getUserAuthRowMock, db } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  db: { getElfSettings: vi.fn(), setElfSettings: vi.fn(), listElfSignups: vi.fn(), setElfPreview: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa", STRIPE_WEBHOOK_SECRET: "whsec_x" },
}));

import { getAdminElfSettings, getAdminElfSignups, patchAdminElfSettings } from "../../src/routes/admin-elf";
import { signAdminSession } from "../../src/admin/session";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500 };

const tokenFor = (role: string) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.org", status: "active", role, permissions: {} });
  return signAdminSession({ sub: 1, email: "staff@example.org", role, now: new Date(), secret: "test-admin-secret" }).token;
};

function mockRes() {
  const res = { statusCode: 200, body: undefined as unknown, status(c: number) { res.statusCode = c; return res; }, json(b: unknown) { res.body = b; return res; }, setHeader() { return res; } };
  return res;
}
const req = (role: string | null, body: unknown = {}) => ({ headers: role ? { authorization: `Bearer ${tokenFor(role)}` } : {}, body, params: {}, query: {} });
/* eslint-disable @typescript-eslint/no-explicit-any */
const run = async (h: (req: any, res: any) => Promise<unknown>, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  getUserAuthRowMock.mockReset();
  for (const f of Object.values(db)) f.mockReset();
  db.getElfSettings.mockResolvedValue(ON);
  db.setElfSettings.mockImplementation(async (patch: object) => ({ ...ON, ...patch }));
});

describe("the school's settings in the admin", () => {
  it("can be read by a viewer, but nobody signed out", async () => {
    expect((await run(getAdminElfSettings, req(null))).statusCode).toBe(401);
    const res = await run(getAdminElfSettings, req("viewer"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ settings: ON });
  });

  it("can only be changed by an admin", async () => {
    expect((await run(patchAdminElfSettings, req("viewer", { schoolOn: true }))).statusCode).toBe(403);
    expect((await run(patchAdminElfSettings, req("editor", { schoolOn: true }))).statusCode).toBe(403);
    const res = await run(patchAdminElfSettings, req("admin", { schoolOn: true }));
    expect(res.statusCode).toBe(200);
    expect(db.setElfSettings).toHaveBeenCalledWith({ schoolOn: true }, "admin:staff@example.org");
  });

  it("refuses amounts that do not make sense, in plain words, and saves nothing", async () => {
    for (const body of [{ entryFromPence: 50 }, { entryFromPence: 1100 }, { entrySuggestedPence: 99 }, { entrySuggestedPence: 6000 }, { entryFromPence: 300, entrySuggestedPence: 200 }, { schoolOn: "yes" }]) {
      const res = await run(patchAdminElfSettings, req("admin", body));
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(String((res.body as { error: string }).error)).toMatch(/^[A-Z]/);
    }
    // The suggested amount is checked against the "from" amount already saved, too.
    db.getElfSettings.mockResolvedValue({ ...ON, entryFromPence: 300 });
    expect((await run(patchAdminElfSettings, req("admin", { entrySuggestedPence: 200 }))).statusCode).toBe(400);
    expect(db.setElfSettings).not.toHaveBeenCalled();
  });
});

describe("the sign ups in the admin", () => {
  it("shows a viewer the paid sign ups", async () => {
    const summary = { families: 2, detectives: 3, entryPence: 1500, donationPence: 500, giftAidPence: 500, recent: [] };
    db.listElfSignups.mockResolvedValue(summary);
    const res = await run(getAdminElfSignups, req("viewer"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(summary);
  });
});

describe("the private preview link", () => {
  it("is made by an admin only, and hands back a link with a long random code", async () => {
    const { postAdminElfPreview } = await import("../../src/routes/admin-elf");
    expect((await run(postAdminElfPreview, req("editor"))).statusCode).toBe(403);
    const res = await run(postAdminElfPreview, req("admin"));
    expect(res.statusCode).toBe(200);
    const url = String((res.body as { url: string }).url);
    expect(url).toMatch(/\/elf\/preview\/[0-9a-f]{64}$/);
  });
});
