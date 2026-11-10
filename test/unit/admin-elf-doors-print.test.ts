import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School in the admin, Head Elf HQ: the print routes. Every place, name and number
// here is invented.

const { getUserAuthRowMock, doors, settingsDb, cfg } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  doors: { getElfDoor: vi.fn(), listElfDoors: vi.fn(), markElfTagPrinted: vi.fn(), ensureElfDoors: vi.fn() },
  settingsDb: { getElfSettings: vi.fn() },
  cfg: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret", STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa", STRIPE_WEBHOOK_SECRET: "whsec_x", PORTAL_BASE_URL: "https://nbcc.scot/" as string },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf", () => settingsDb);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: cfg }));

import * as routes from "../../src/routes/admin-elf-doors";
import { signAdminSession } from "../../src/admin/session";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import { renderElfPoster } from "../../src/elf/print";
import type { Door } from "../../src/elf/calendar";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null, placePhone: "01632 960 123" as string | null };
const ACTOR = "admin:staff@example.org";

const tokenFor = (role: string, permissions: object = {}) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.org", status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: "staff@example.org", role, now: new Date(), secret: "test-admin-secret" }).token;
};
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    contentType: undefined as string | undefined,
    headers: {} as Record<string, string>,
    status(c: number) { res.statusCode = c; return res; },
    type(t: string) { res.contentType = t; return res; },
    send(b: unknown) { res.body = b; return res; },
    json(b: unknown) { res.body = b; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; return res; },
  };
  return res;
}
const ask = (role: string, o: { params?: object; permissions?: object } = {}) => ({
  headers: { authorization: `Bearer ${tokenFor(role, o.permissions ?? {})}` },
  body: {},
  params: o.params ?? {},
  query: {},
});
const VIEW = { elf: "view" };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
const run = async (h: Handler, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
const page = (res: { body: unknown }) => (typeof res.body === "string" ? res.body : JSON.stringify(res.body));

const doorOf = (n: number, over: Partial<DoorSetup> = {}): DoorSetup => ({ ...emptyDoor(n as Door, "abcdefghijkm"), ...over });
const READY = { placeName: "Pine Cone Cafe", placeTown: "Ayr", placeAddress: "1 Example Street", elfName: "Pip", tagWord: "SNOWBALL 472" };
const params7 = { params: { door: "7" } };
const seeing = (p: object) => ask("viewer", { ...p, permissions: VIEW });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
  getUserAuthRowMock.mockReset();
  for (const f of [...Object.values(doors), ...Object.values(settingsDb)]) f.mockReset();
  settingsDb.getElfSettings.mockResolvedValue(ON);
  cfg.PORTAL_BASE_URL = "https://nbcc.scot/";
  doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, READY));
  doors.listElfDoors.mockResolvedValue(Array.from({ length: 24 }, (_, i) => doorOf(i + 1, READY)));
  doors.markElfTagPrinted.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

const prints: [string, Handler, object][] = [
  ["poster", routes.getAdminElfDoorPoster, params7],
  ["staff card", routes.getAdminElfDoorStaffCard, params7],
  ["tag", routes.getAdminElfDoorTag, params7],
  ["places list", routes.getAdminElfPlacesList, {}],
];

describe("the print routes", () => {
  it.each(prints)("the %s is a secret page for elf view", async (_n, h, p) => {
    const res = await run(h, seeing(p));
    expect(res.statusCode).toBe(200);
    expect(res.contentType).toBe("html");
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
    expect(page(res)).toContain("<!doctype html>");
  });

  it.each(prints)("the %s answers 403 JSON with no elf permission and renders nothing", async (_n, h, p) => {
    const res = await run(h, ask("editor", p));
    expect(res.statusCode).toBe(403);
    expect(page(res)).not.toContain("<html");
    expect(doors.getElfDoor).not.toHaveBeenCalled();
    expect(doors.listElfDoors).not.toHaveBeenCalled();
    expect(doors.markElfTagPrinted).not.toHaveBeenCalled();
  });

  it("refuses a door that is not 1 to 24", async () => {
    const res = await run(routes.getAdminElfDoorPoster, seeing({ params: { door: "25" } }));
    expect(res.statusCode).toBe(400);
  });

  it("the poster of a door with no place is a message page with 409", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(7));
    const res = await run(routes.getAdminElfDoorPoster, seeing(params7));
    expect(res.statusCode).toBe(409);
    expect(page(res)).toContain("Not ready to print");
    expect(page(res)).toMatch(/Door 7 needs its place(&#39;|')s name and town before its poster can be printed\./);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("the poster is made for the poster address on the live site, with no doubled slash", async () => {
    // The address is drawn into a QR code, not written out, so the page must match the one made for it.
    const want = renderElfPoster({ placeName: "Pine Cone Cafe", placeTown: "Ayr", siteOrigin: "https://nbcc.scot", posterUrl: "https://nbcc.scot/elf/p/abcdefghijkm" });
    const res = await run(routes.getAdminElfDoorPoster, seeing(params7));
    expect(res.statusCode).toBe(200);
    expect(page(res)).toBe(want);
    const other = renderElfPoster({ placeName: "Pine Cone Cafe", placeTown: "Ayr", siteOrigin: "https://nbcc.scot", posterUrl: "https://nbcc.scot/elf/p/zzzzzzzzzzzz" });
    expect(page(res)).not.toBe(other);
  });

  it("the poster says it can only be printed on the live site when the address is not https", async () => {
    cfg.PORTAL_BASE_URL = "http://localhost:3000";
    const res = await run(routes.getAdminElfDoorPoster, seeing(params7));
    expect(res.statusCode).toBe(409);
    expect(page(res)).toContain("The poster can only be printed on the live site.");
  });

  it("the staff card names the place, and needs the elf's name", async () => {
    const ok = await run(routes.getAdminElfDoorStaffCard, seeing(params7));
    expect(ok.statusCode).toBe(200);
    expect(page(ok)).toContain("Pine Cone Cafe");
    expect(page(ok)).toContain("01632 960 123");
    doors.getElfDoor.mockResolvedValue(doorOf(7, { ...READY, elfName: null }));
    const res = await run(routes.getAdminElfDoorStaffCard, seeing(params7));
    expect(res.statusCode).toBe(409);
    expect(page(res)).toMatch(/Door 7 needs its place and its elf(&#39;|')s name before its staff card can be printed\./);
  });

  it("the staff card without the place phone says to add it in Settings", async () => {
    settingsDb.getElfSettings.mockResolvedValue({ ...ON, placePhone: null });
    const res = await run(routes.getAdminElfDoorStaffCard, seeing(params7));
    expect(res.statusCode).toBe(409);
    expect(page(res)).toMatch(/Add NBCC(&#39;|')s phone number for places in Settings before printing a staff card\./);
  });

  it("the tag needs the elf's name and a usable word", async () => {
    for (const over of [{ elfName: null }, { tagWord: null }, { tagWord: "nonsense" }]) {
      doors.getElfDoor.mockResolvedValue(doorOf(7, { ...READY, ...over }));
      const res = await run(routes.getAdminElfDoorTag, seeing(params7));
      expect(res.statusCode).toBe(409);
      expect(page(res)).toMatch(/Door 7 needs its elf(&#39;|')s name before its tag can be printed\./);
    }
    expect(doors.markElfTagPrinted).not.toHaveBeenCalled();
  });

  it("printing the tag notes it as printed, once", async () => {
    const res = await run(routes.getAdminElfDoorTag, seeing(params7));
    expect(res.statusCode).toBe(200);
    expect(page(res)).toContain("SNOWBALL 472");
    expect(doors.markElfTagPrinted).toHaveBeenCalledTimes(1);
    expect(doors.markElfTagPrinted).toHaveBeenCalledWith(2026, 7, ACTOR);
  });

  it("a failure is a 500 message page, never a stack trace", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    doors.getElfDoor.mockRejectedValue(new Error("boom at /secret/path.ts:1"));
    const res = await run(routes.getAdminElfDoorTag, seeing(params7));
    expect(res.statusCode).toBe(500);
    expect(res.contentType).toBe("html");
    expect(page(res)).not.toContain("boom");
    expect(page(res)).not.toContain("secret/path");
    spy.mockRestore();
  });

  it("makes the year's door rows before reading a door, and before listing the places", async () => {
    await run(routes.getAdminElfDoorTag, seeing(params7));
    expect(doors.ensureElfDoors).toHaveBeenCalledWith(2026);
    expect(doors.ensureElfDoors.mock.invocationCallOrder[0]).toBeLessThan(doors.getElfDoor.mock.invocationCallOrder[0]);
    doors.ensureElfDoors.mockClear();
    await run(routes.getAdminElfPlacesList, seeing({}));
    expect(doors.ensureElfDoors).toHaveBeenCalledWith(2026);
    expect(doors.ensureElfDoors.mock.invocationCallOrder[0]).toBeLessThan(doors.listElfDoors.mock.invocationCallOrder[0]);
  });

  it("a door with no place, once the rows are made, gets the needs-its-place page and not a 404", async () => {
    let made = false;
    doors.ensureElfDoors.mockImplementation(async () => {
      made = true;
    });
    doors.getElfDoor.mockImplementation(async (_y: number, n: number) => (made ? doorOf(n) : null));
    const res = await run(routes.getAdminElfDoorStaffCard, seeing({ params: { door: "8" } }));
    expect(res.statusCode).toBe(409);
    expect(page(res)).toContain("needs its place");
  });

  it("still sends the tag when noting it as printed fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    doors.markElfTagPrinted.mockRejectedValue(new Error("db down"));
    const res = await run(routes.getAdminElfDoorTag, seeing(params7));
    expect(res.statusCode).toBe(200);
    expect(page(res)).toContain("SNOWBALL 472");
    expect(spy).toHaveBeenCalledWith("admin elf doors tag printed note failed:", "db down");
    spy.mockRestore();
  });

  it("the places list has 24 entries and says it is for staff only", async () => {
    const res = await run(routes.getAdminElfPlacesList, seeing({}));
    expect(page(res)).toContain("For staff only");
    expect((page(res).match(/class="entry"/g) ?? []).length).toBe(24);
  });
});
