import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School in the admin, Head Elf HQ: the photo check routes. Every name is invented.

const { getUserAuthRowMock, photos, alerts } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  photos: {
    photosWaiting: vi.fn(),
    photoLog: vi.fn(),
    photoForStaff: vi.fn(),
    photoStep: vi.fn(),
    decidePhoto: vi.fn(),
    takeDownPhoto: vi.fn(),
  },
  alerts: { lastAlert: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf-photos", () => photos);
vi.mock("../../src/db/elf-alerts", () => alerts);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "development",
    ADMIN_SESSION_SECRET: "test-admin-secret",
    STRIPE_SECRET_KEY: "sk_test_aaaaaaaaaaaaaaaaaaaa",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    PORTAL_BASE_URL: "https://example.org/",
  },
}));

import * as routes from "../../src/routes/admin-elf-finds";
import { signAdminSession } from "../../src/admin/session";

const ACTOR = "admin:staff@example.org";
const tokenFor = (role: string, permissions: object = {}) => {
  getUserAuthRowMock.mockResolvedValue({ id: 1, email: "staff@example.org", status: "active", role, permissions });
  return signAdminSession({ sub: 1, email: "staff@example.org", role, now: new Date(), secret: "test-admin-secret" }).token;
};
function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    send(b: unknown) { res.body = b; return res; },
    setHeader(k: string, v: string) { res.headers[k] = v; return res; },
  };
  return res;
}
const ask = (role: string, o: { body?: unknown; params?: object; permissions?: object } = {}) => ({
  headers: { authorization: `Bearer ${tokenFor(role, o.permissions ?? {})}` },
  body: o.body ?? {},
  params: o.params ?? { id: "41" },
  query: {},
});
const VIEW = { elf: "view" };
const EDIT = { elf: "edit" };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
const run = async (h: Handler, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
const body = (res: { body: unknown }) => res.body as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const WAITING = {
  id: 41,
  token: "aaaaaaaaaaaa",
  year: 2026,
  door: 7,
  practice: false,
  sentAt: new Date("2026-12-07T18:04:00Z"),
  family: { id: 3, grownUpName: "Alex Example", detectives: 2 },
  placeName: "Pine Cone Café",
  placeShownAt: new Date("2026-12-07T19:00:00Z"),
  firstFamily: false,
};

beforeEach(() => {
  getUserAuthRowMock.mockReset();
  for (const f of [...Object.values(photos), ...Object.values(alerts)]) f.mockReset();
  photos.photosWaiting.mockResolvedValue([WAITING]);
  photos.photoLog.mockResolvedValue([]);
  alerts.lastAlert.mockResolvedValue({ at: new Date("2026-12-07T18:04:00Z"), textsFailed: [] });
});

describe("the queue", () => {
  it("lets an elf viewer read the queue, the log and the last alert, and says whether they may change it", async () => {
    const res = await run(routes.getAdminElfPhotos, ask("viewer", { permissions: VIEW }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(body(res)).toEqual({ waiting: [WAITING], log: [], lastAlert: { at: new Date("2026-12-07T18:04:00Z"), textsFailed: [] }, canEdit: false });
    expect(photos.photoLog).toHaveBeenCalledWith(200);
    expect(alerts.lastAlert).toHaveBeenCalledWith("photo");
    const edit = await run(routes.getAdminElfPhotos, ask("viewer", { permissions: EDIT }));
    expect(body(edit).canEdit).toBe(true);
  });

  it("is 403 without the section and 401 signed out, and 500 in words when the database fails", async () => {
    expect((await run(routes.getAdminElfPhotos, ask("viewer"))).statusCode).toBe(403);
    expect((await run(routes.getAdminElfPhotos, { headers: {}, body: {}, params: {}, query: {} })).statusCode).toBe(401);
    photos.photosWaiting.mockRejectedValue(new Error("boom"));
    const res = await run(routes.getAdminElfPhotos, ask("viewer", { permissions: VIEW }));
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("the picture", () => {
  it("gives the bytes to an elf viewer, never to be kept or indexed", async () => {
    photos.photoForStaff.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("x") });
    const res = await run(routes.getAdminElfPhotoPicture, ask("viewer", { permissions: VIEW }));
    expect(res.statusCode).toBe(200);
    expect(res.headers).toMatchObject({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Type": "image/jpeg",
    });
    expect(res.body).toEqual(Buffer.from("x"));
    expect(photos.photoForStaff).toHaveBeenCalledWith(41);
  });

  it("is 404 when the photo has no bytes, 400 for a bad id, and 403 without the section", async () => {
    photos.photoForStaff.mockResolvedValue(null);
    expect((await run(routes.getAdminElfPhotoPicture, ask("viewer", { permissions: VIEW }))).statusCode).toBe(404);
    expect((await run(routes.getAdminElfPhotoPicture, ask("viewer", { permissions: VIEW, params: { id: "x" } }))).statusCode).toBe(400);
    expect((await run(routes.getAdminElfPhotoPicture, ask("viewer"))).statusCode).toBe(403);
  });
});

describe("approving, declining and taking down", () => {
  const posts: [string, Handler, object][] = [
    ["approve", routes.postAdminElfPhotoApprove as Handler, {}],
    ["decline", routes.postAdminElfPhotoDecline as Handler, { reason: "someone else in it" }],
    ["take down", routes.postAdminElfPhotoTakeDown as Handler, {}],
  ];

  it.each(posts)("%s is 403 for someone who may only look", async (_n, handler, b) => {
    const res = await run(handler, ask("viewer", { permissions: VIEW, body: b }));
    expect(res.statusCode).toBe(403);
    expect(photos.decidePhoto).not.toHaveBeenCalled();
    expect(photos.takeDownPhoto).not.toHaveBeenCalled();
  });

  it("approves as the actor", async () => {
    photos.decidePhoto.mockResolvedValue("done");
    const res = await run(routes.postAdminElfPhotoApprove, ask("viewer", { permissions: EDIT }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(photos.decidePhoto).toHaveBeenCalledWith(41, "approved", ACTOR, null);
  });

  it("answers 409 with the photo's newest step when someone else decided first", async () => {
    photos.decidePhoto.mockResolvedValue("already");
    photos.photoStep.mockResolvedValue("Approved by Alex Example at 6:13pm");
    const res = await run(routes.postAdminElfPhotoApprove, ask("viewer", { permissions: EDIT }));
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "Someone has already checked this photo.", step: "Approved by Alex Example at 6:13pm" });
  });

  it("answers 404 for a photo that is not there", async () => {
    photos.decidePhoto.mockResolvedValue(null);
    expect((await run(routes.postAdminElfPhotoApprove, ask("viewer", { permissions: EDIT }))).statusCode).toBe(404);
  });

  it("declines with a reason of 1 to 200 characters, trimmed", async () => {
    photos.decidePhoto.mockResolvedValue("done");
    const res = await run(routes.postAdminElfPhotoDecline, ask("viewer", { permissions: EDIT, body: { reason: "  someone else in it " } }));
    expect(res.statusCode).toBe(200);
    expect(photos.decidePhoto).toHaveBeenCalledWith(41, "declined", ACTOR, "someone else in it");
  });

  it.each([[{}], [{ reason: "" }], [{ reason: "   " }], [{ reason: "x".repeat(201) }], [{ reason: 5 }]])("refuses a decline with no usable reason %j", async (b) => {
    const res = await run(routes.postAdminElfPhotoDecline, ask("viewer", { permissions: EDIT, body: b }));
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "Say why in a few words. Only head elves see it." });
    expect(photos.decidePhoto).not.toHaveBeenCalled();
  });

  it("answers a decline that lost the race with the same 409", async () => {
    photos.decidePhoto.mockResolvedValue("already");
    photos.photoStep.mockResolvedValue(null);
    const res = await run(routes.postAdminElfPhotoDecline, ask("viewer", { permissions: EDIT, body: { reason: "no" } }));
    expect(res.statusCode).toBe(409);
    expect(body(res).error).toBe("Someone has already checked this photo.");
  });

  it("takes a photo down with an optional reason", async () => {
    photos.takeDownPhoto.mockResolvedValue(true);
    expect((await run(routes.postAdminElfPhotoTakeDown, ask("viewer", { permissions: EDIT }))).statusCode).toBe(200);
    expect(photos.takeDownPhoto).toHaveBeenLastCalledWith(41, ACTOR, null);
    await run(routes.postAdminElfPhotoTakeDown, ask("viewer", { permissions: EDIT, body: { reason: "the family asked by phone" } }));
    expect(photos.takeDownPhoto).toHaveBeenLastCalledWith(41, ACTOR, "the family asked by phone");
    photos.takeDownPhoto.mockResolvedValue(false);
    expect((await run(routes.postAdminElfPhotoTakeDown, ask("viewer", { permissions: EDIT }))).statusCode).toBe(409);
    photos.takeDownPhoto.mockResolvedValue(null);
    expect((await run(routes.postAdminElfPhotoTakeDown, ask("viewer", { permissions: EDIT }))).statusCode).toBe(404);
    const long = await run(routes.postAdminElfPhotoTakeDown, ask("viewer", { permissions: EDIT, body: { reason: "x".repeat(201) } }));
    expect(long.statusCode).toBe(400);
  });

  it("answers 500 in words when the database fails", async () => {
    photos.decidePhoto.mockRejectedValue(new Error("boom"));
    const res = await run(routes.postAdminElfPhotoApprove, ask("viewer", { permissions: EDIT }));
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });
});

describe("the router", () => {
  it("mounts the five routes", () => {
    const paths = (routes.adminElfFindsRouter as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }).stack
      .filter((l) => l.route)
      .map((l) => `${Object.keys(l.route!.methods)[0].toUpperCase()} ${l.route!.path}`);
    expect(paths).toEqual([
      "GET /api/admin/elf/photos",
      "GET /api/admin/elf/photos/:id/picture",
      "POST /api/admin/elf/photos/:id/approve",
      "POST /api/admin/elf/photos/:id/decline",
      "POST /api/admin/elf/photos/:id/take-down",
    ]);
  });
});
