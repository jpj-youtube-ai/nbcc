import { describe, it, expect, vi, beforeEach } from "vitest";

// Admin > Giving > Santa Sleigh (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md): no
// permission of its own. View of Donations sees the nights, the totals and the switch off day, and
// downloads the hand-out QR code; edit of Donations changes a night or the switch off day. The
// database is a stand-in. Every name here is invented.

const db = vi.hoisted(() => ({
  listNights: vi.fn(),
  getSleighSettings: vi.fn(),
  saveNight: vi.fn(),
  saveSleighSettings: vi.fn(),
  readSleighTotalsNow: vi.fn(),
  findOrCreateSleighCode: vi.fn(),
}));
const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));

vi.mock("../../src/db/sleigh", () => db);
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

import * as routes from "../../src/routes/admin-sleigh";
import { signAdminSession } from "../../src/admin/session";
import { SECTIONS } from "../../src/admin/permissions";
import { qrPng } from "../../src/fundraising/qr-png";
import { namedShortLink } from "../../src/site/qr-named";

const SECRET = "test-admin-secret";
const EMAIL = "sky.sleigh@nbcc.test";
const everythingBut = (level: string) => Object.fromEntries(SECTIONS.filter((s) => s !== "donations").map((s) => [s, level]));
function tokenFor(access: "none" | "view" | "edit") {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: EMAIL, status: "active", role: "editor", permissions: { ...everythingBut("edit"), donations: access } });
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

const NIGHT = { id: 1, nightOn: "2026-12-15", areas: "New Farm", startsAt: null, endsAt: null, bucketPence: 0, cardPence: 2500, cardGifts: 2, window: { from: "2026-12-15 16:00", to: "2026-12-15 22:00" } };
const SETTINGS = { seasonFrom: "2026-11-01", offOn: "2027-01-31" };
const TOTALS = { onlinePence: 5000, cardPence: 2500, bucketPence: 0, totalPence: 7500, gifts: 4 };

beforeEach(() => {
  Object.values(db).forEach((f) => f.mockReset());
  db.listNights.mockResolvedValue([NIGHT]);
  db.getSleighSettings.mockResolvedValue(SETTINGS);
  db.readSleighTotalsNow.mockResolvedValue(TOTALS);
  db.saveNight.mockResolvedValue({ id: 1, nightOn: "2026-12-15", areas: "New Farm", startsAt: "18:00", endsAt: "20:30", bucketPence: 0 });
  db.saveSleighSettings.mockResolvedValue({ ...SETTINGS, offOn: "2027-02-14" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reading the Santa Sleigh section", () => {
  it("needs a session, and view of Donations", async () => {
    expect((await run(routes.getAdminSleigh)).statusCode).toBe(401);
    expect((await run(routes.getAdminSleigh, { token: tokenFor("none") })).statusCode).toBe(403);
    expect(db.listNights).not.toHaveBeenCalled();
  });

  it("gives the nights, the settings and the totals read afresh, and whether this person may change them", async () => {
    const res = await run(routes.getAdminSleigh, { token: tokenFor("view") });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ nights: [NIGHT], settings: SETTINGS, totals: TOTALS, mayEdit: false });
    expect(db.readSleighTotalsNow).toHaveBeenCalled();
    expect((await run(routes.getAdminSleigh, { token: tokenFor("edit") })).body.mayEdit).toBe(true);
  });

  it("answers 500, never a zero, when the database is away", async () => {
    db.readSleighTotalsNow.mockRejectedValue(new Error("down"));
    const res = await run(routes.getAdminSleigh, { token: tokenFor("view") });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("saving a night", () => {
  const save = (body: unknown, token = tokenFor("edit"), id = "1") => run(routes.patchSleighNight, { token, body, params: { id } });

  it("needs edit of Donations", async () => {
    expect((await run(routes.patchSleighNight, { body: { areas: "x" }, params: { id: "1" } })).statusCode).toBe(401);
    expect((await save({ areas: "New Farm" }, tokenFor("view"))).statusCode).toBe(403);
    expect(db.saveNight).not.toHaveBeenCalled();
  });

  it("saves the areas, the times, the bucket cash, with who did it, and answers with the section afresh", async () => {
    const res = await save({ areas: "New Farm", startsAt: "18:00", endsAt: "20:30", bucketPence: 15240 });
    expect(res.statusCode).toBe(200);
    expect(db.saveNight).toHaveBeenCalledWith(1, { areas: "New Farm", startsAt: "18:00", endsAt: "20:30", bucketPence: 15240 }, `admin:${EMAIL}`);
    expect(res.body).toEqual({ nights: [NIGHT], settings: SETTINGS, totals: TOTALS, mayEdit: true });
  });

  it("clears the times back to Timings TBC", async () => {
    expect((await save({ startsAt: null, endsAt: null })).statusCode).toBe(200);
    expect(db.saveNight).toHaveBeenCalledWith(1, { startsAt: null, endsAt: null }, `admin:${EMAIL}`);
  });

  it.each([
    ["empty areas", { areas: "   " }, "Write the areas the sleigh goes round, up to 120 letters."],
    ["areas that are too long", { areas: "a".repeat(121) }, "Write the areas the sleigh goes round, up to 120 letters."],
    ["a time that is not a time", { startsAt: "6pm" }, "Write each time as hours and minutes, like 18:00, or leave it empty."],
    ["an hour past 23", { endsAt: "24:00" }, "Write each time as hours and minutes, like 18:00, or leave it empty."],
    ["bucket cash below nothing", { bucketPence: -1 }, "Write the bucket cash in pounds and pence, like 152.40."],
    ["bucket cash in part pence", { bucketPence: 10.5 }, "Write the bucket cash in pounds and pence, like 152.40."],
    ["bucket cash of more than £100,000", { bucketPence: 10_000_001 }, "Write the bucket cash in pounds and pence, like 152.40."],
    ["a finish before the start", { startsAt: "20:00", endsAt: "18:00" }, "The finish time must be after the start time."],
    ["nothing at all", {}, "There was nothing to save."],
    ["something it does not know", { colour: "red" }, "There was nothing to save."],
  ])("refuses %s, in plain words, and saves nothing", async (_what, body, words) => {
    const res = await save(body);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: words });
    expect(db.saveNight).not.toHaveBeenCalled();
  });

  it("says a night that is not there is not there", async () => {
    db.saveNight.mockResolvedValue(null);
    const res = await save({ areas: "New Farm" });
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "That night is not there any more. Reload the page." });
    expect((await save({ areas: "New Farm" }, tokenFor("edit"), "nope")).statusCode).toBe(404);
  });

  it("answers 500 when saving fails", async () => {
    db.saveNight.mockRejectedValue(new Error("down"));
    expect((await save({ areas: "New Farm" })).statusCode).toBe(500);
  });
});

describe("saving the switch off day", () => {
  const save = (body: unknown, token = tokenFor("edit")) => run(routes.patchSleighSettings, { token, body });

  it("needs edit of Donations", async () => {
    expect((await save({ offOn: "2027-02-14" }, tokenFor("view"))).statusCode).toBe(403);
    expect(db.saveSleighSettings).not.toHaveBeenCalled();
  });

  it("saves a real day, with who did it", async () => {
    const res = await save({ offOn: "2027-02-14" });
    expect(res.statusCode).toBe(200);
    expect(db.saveSleighSettings).toHaveBeenCalledWith({ offOn: "2027-02-14" }, `admin:${EMAIL}`);
    expect(res.body.mayEdit).toBe(true);
  });

  it.each([["2027-02-30"], ["14/02/2027"], [""], [20270214]])("refuses %j, in plain words", async (offOn) => {
    const res = await save({ offOn });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Choose the day the page switches off." });
    expect(db.saveSleighSettings).not.toHaveBeenCalled();
  });
});

describe("the QR code for hand-outs", () => {
  it("needs view of Donations", async () => {
    expect((await run(routes.getSleighQrHandout)).statusCode).toBe(401);
    expect((await run(routes.getSleighQrHandout, { token: tokenFor("none") })).statusCode).toBe(403);
    expect(db.findOrCreateSleighCode).not.toHaveBeenCalled();
  });

  it("is the named code for hand-outs, as a PNG to save, never kept by the browser", async () => {
    db.findOrCreateSleighCode.mockResolvedValue(42);
    const res = await run(routes.getSleighQrHandout, { token: tokenFor("view") });
    expect(res.statusCode).toBe(200);
    expect(db.findOrCreateSleighCode).toHaveBeenCalledWith("Santa Sleigh hand-outs", `admin:${EMAIL}`);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="santa-sleigh-qr.png"');
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.isBuffer(res.body)).toBe(true);
    // the code's own short link, so its scans are counted under its name in Admin > QR codes
    expect((res.body as Buffer).equals(qrPng(namedShortLink(42)))).toBe(true);
  });

  it("answers 500 when the code cannot be found or made", async () => {
    db.findOrCreateSleighCode.mockRejectedValue(new Error("down"));
    expect((await run(routes.getSleighQrHandout, { token: tokenFor("view") })).statusCode).toBe(500);
  });
});

describe("the router", () => {
  it("serves the section, the two saves and the hand-out code at their addresses", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stack = (routes.adminSleighRouter as any).stack.map((l: any) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    // the posters' route joins these later, so this lists only what must be there
    expect(stack).toEqual(expect.arrayContaining(["GET /api/admin/sleigh", "PATCH /api/admin/sleigh/nights/:id", "PATCH /api/admin/sleigh/settings", "GET /api/admin/sleigh/qr-handout"]));
  });
});
