import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin > Fill a Red Bag > Company Workshops (6 November 2026): view of the "red-bag" section sees the
// companies, their links, bags, totals and QR codes; only edit adds or archives one. The database is
// mocked. Every name here is invented.

const db = vi.hoisted(() => ({
  listRedBagWorkshops: vi.fn(),
  redBagWorkshopTotals: vi.fn(),
  createRedBagWorkshop: vi.fn(),
  setRedBagWorkshopArchived: vi.fn(),
  forgetRedBagWorkshops: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/red-bag-workshops", () => ({ ...db, WORKSHOP_NAME_MAX: 80 }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    DATABASE_URL: "postgres://localhost:5432/test",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
    PORTAL_BASE_URL: "https://nbcc.test",
  },
}));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import * as routes from "../../src/routes/admin-red-bag-workshops";
import { signAdminSession } from "../../src/admin/session";
import { SECTIONS } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";
const EMAIL = "rowan.workshops@nbcc.test";
const everythingBut = (level: string) => Object.fromEntries(SECTIONS.filter((s) => s !== "red-bag").map((s) => [s, level]));
function tokenFor(access: "none" | "view" | "edit") {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role: "editor", permissions: { ...everythingBut("edit"), "red-bag": access } });
  return signAdminSession({ sub: 1, email: EMAIL, role: "editor", now: new Date(), secret: SECRET }).token;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: unknown) => ((res.body = b), res);
  res.setHeader = (k: string, v: string) => ((res.headers[k.toLowerCase()] = v), res);
  res.type = (t: string) => ((res.headers["content-type"] = t), res);
  res.send = (b: unknown) => ((res.body = b), res);
  return res;
}
async function run(handler: (req: any, res: any) => Promise<unknown>, o: { token?: string; body?: unknown; params?: Record<string, string>; query?: Record<string, string> } = {}) {
  const res = mockRes();
  const headers: Record<string, string> = o.token ? { authorization: `Bearer ${o.token}` } : {};
  await handler({ headers, body: o.body ?? {}, params: o.params ?? {}, query: o.query ?? {} }, res);
  return res;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const company = (over: Record<string, unknown> = {}) => ({ id: 4, slug: "fern-and-thistle", name: "Fern & Thistle", size: "small", createdAt: "2026-11-06T09:00:00.000Z", archivedAt: null, ...over });

beforeEach(() => {
  Object.values(db).forEach((f) => f.mockReset());
  db.listRedBagWorkshops.mockResolvedValue([company()]);
  db.redBagWorkshopTotals.mockResolvedValue({ everyonePence: 60000, byWorkshopPence: new Map([[4, 15000]]) });
});

describe("the list of companies", () => {
  it("needs a session, and view of Fill a Red Bag", async () => {
    expect((await run(routes.getRedBagWorkshops)).statusCode).toBe(401);
    expect((await run(routes.getRedBagWorkshops, { token: tokenFor("none") })).statusCode).toBe(403);
  });

  it("gives each company's link, bags, total and code, and everyone's", async () => {
    const res = await run(routes.getRedBagWorkshops, { token: tokenFor("view") });
    expect(res.statusCode).toBe(200);
    expect(res.body.mayEdit).toBe(false);
    expect(res.body.everyone).toEqual({ pence: 60000, bags: 12 });
    const [w] = res.body.workshops;
    expect(w).toMatchObject({ id: 4, name: "Fern & Thistle", link: "https://nbcc.scot/fill/fern-and-thistle", pence: 15000, bags: 3, archived: false });
    expect(w.qrSvg).toMatch(/^<svg/);
    expect(db.forgetRedBagWorkshops).toHaveBeenCalled();
  });

  it("draws no code for an archived company", async () => {
    db.listRedBagWorkshops.mockResolvedValue([company({ archivedAt: "2026-11-07T09:00:00.000Z" })]);
    const res = await run(routes.getRedBagWorkshops, { token: tokenFor("edit") });
    expect(res.body.workshops[0].qrSvg).toBeNull();
    expect(res.body.mayEdit).toBe(true);
  });
});

describe("adding a company", () => {
  it("needs edit", async () => {
    expect((await run(routes.postRedBagWorkshop, { token: tokenFor("view"), body: { name: "Fern & Thistle", size: "small" } })).statusCode).toBe(403);
    expect(db.createRedBagWorkshop).not.toHaveBeenCalled();
  });

  it("adds it, as the person signed in", async () => {
    db.createRedBagWorkshop.mockResolvedValue({ ok: true, workshop: company() });
    const res = await run(routes.postRedBagWorkshop, { token: tokenFor("edit"), body: { name: "Fern & Thistle", size: "small" } });
    expect(res.statusCode).toBe(201);
    expect(db.createRedBagWorkshop).toHaveBeenCalledWith({ name: "Fern & Thistle", size: "small", by: `admin:${EMAIL}` });
  });

  it("says plainly what is wrong", async () => {
    expect((await run(routes.postRedBagWorkshop, { token: tokenFor("edit"), body: { name: "Fern", size: "huge" } })).body.error).toBe(routes.WORKSHOP_MESSAGES.size);
    db.createRedBagWorkshop.mockResolvedValue({ ok: false, reason: "taken" });
    const taken = await run(routes.postRedBagWorkshop, { token: tokenFor("edit"), body: { name: "Fern & Thistle", size: "small" } });
    expect(taken.statusCode).toBe(409);
    expect(taken.body.error).toBe(routes.WORKSHOP_MESSAGES.taken);
  });
});

describe("archiving a company", () => {
  it("needs edit, and archives it as the person signed in", async () => {
    expect((await run(routes.postRedBagWorkshopArchive, { token: tokenFor("view"), params: { id: "4" }, body: { archived: true } })).statusCode).toBe(403);
    db.setRedBagWorkshopArchived.mockResolvedValue(company({ archivedAt: "2026-11-07T09:00:00.000Z" }));
    const res = await run(routes.postRedBagWorkshopArchive, { token: tokenFor("edit"), params: { id: "4" }, body: { archived: true } });
    expect(res.statusCode).toBe(200);
    expect(db.setRedBagWorkshopArchived).toHaveBeenCalledWith(4, true, `admin:${EMAIL}`);
  });

  it("is a 404 for one that is not there", async () => {
    db.setRedBagWorkshopArchived.mockResolvedValue(null);
    expect((await run(routes.postRedBagWorkshopArchive, { token: tokenFor("edit"), params: { id: "99" }, body: { archived: true } })).statusCode).toBe(404);
  });
});

describe("a company's QR code", () => {
  it("is a file to download, carrying the company's link and the QR mark", async () => {
    const res = await run(routes.getRedBagWorkshopQr, { token: tokenFor("view"), params: { id: "4" }, query: { format: "svg" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="nbcc-fill-a-red-bag-fern-and-thistle.svg"');
    expect(String(res.body)).toMatch(/^<svg/);
  });

  it("is refused for an archived company or a bad format", async () => {
    expect((await run(routes.getRedBagWorkshopQr, { token: tokenFor("view"), params: { id: "4" }, query: { format: "gif" } })).statusCode).toBe(400);
    db.listRedBagWorkshops.mockResolvedValue([company({ archivedAt: "2026-11-07T09:00:00.000Z" })]);
    expect((await run(routes.getRedBagWorkshopQr, { token: tokenFor("view"), params: { id: "4" }, query: { format: "png" } })).statusCode).toBe(404);
  });
});
