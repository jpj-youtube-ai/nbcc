import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import sharp from "sharp";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Profile pictures (Jaimie, 2026-10-03): the routes, driven over HTTP through the real router, body
// parser and picture processing (real pictures, made here), with the database mocked. What is
// checked: only the signed in organiser sends pictures for their own running page; each is made
// again on the server (nothing from the camera kept) and waits for staff; a waiting picture is never
// public (only its owner and staff see it), and a profile photo's address answers only once it is
// approved; staff approve, decline (with an optional note the organiser sees) and take one off, with
// the right permission. Every name and address here is invented.

const db = vi.hoisted(() => ({
  fundraisingIsOn: vi.fn(),
  listForOrganiser: vi.fn(),
  getFundraiser: vi.fn(),
}));
const pics = vi.hoisted(() => ({
  sendPicture: vi.fn(),
  listPictures: vi.fn(),
  pictureForOwner: vi.fn(),
  pictureForStaff: vi.fn(),
  publicProfilePhoto: vi.fn(),
  decidePicture: vi.fn(),
  deletePicture: vi.fn(),
  countSentToday: vi.fn(),
  pendingPicturesByFundraiser: vi.fn(),
}));
// The real processing, unless a test says otherwise (busy, too big).
const proc = vi.hoisted(() => ({ override: null as null | (() => Promise<unknown>) }));
vi.mock("../../src/fundraising/picture-process", async () => {
  const real = await vi.importActual<typeof import("../../src/fundraising/picture-process")>("../../src/fundraising/picture-process");
  return { ...real, processPicture: (...args: Parameters<typeof real.processPicture>) => (proc.override ? proc.override() : real.processPicture(...args)) };
});
const signIn = vi.hoisted(() => ({ findSession: vi.fn() }));
const users = vi.hoisted(() => ({ getUserAuthRow: vi.fn() }));

vi.mock("../../src/db/fundraisers", () => ({ ...db, FundraiserError: class extends Error {} }));
vi.mock("../../src/db/fundraiser-pictures", () => {
  class PictureError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { ...pics, PictureError };
});
vi.mock("../../src/db/fundraiser-sign-in", () => signIn);
vi.mock("../../src/fundraising/send", () => ({
  fundraiserPageUrl: (slug: string) => `https://nbcc.test/fundraise/${slug}`,
  manageUrl: () => "https://nbcc.test/fundraise/manage",
  sendSignUpEmails: vi.fn(),
  sendSignInCodeEmail: vi.fn(),
  sendFinishedStaffEmail: vi.fn(),
}));
vi.mock("../../src/db/admin-users", () => users);
vi.mock("../../src/newsletter/self-signup", () => ({ subscribeSelf: vi.fn() }));
vi.mock("../../src/clients/turnstile", () => ({ captchaEnabled: () => false, captchaSiteKey: () => null, verifyCaptcha: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: {
    NODE_ENV: "production",
    PORTAL_BASE_URL: "https://nbcc.test",
    ADMIN_SESSION_SECRET: "a-test-secret",
    DATABASE_URL: "postgres://localhost:5432/test",
  },
}));

import { fundraiserPicturesRouter, PICTURE_POST_PATH, PICTURE_JSON_BODY_LIMIT, pictureLimitersReset } from "../../src/routes/fundraiser-pictures";
import { newsBodyGuard } from "../../src/routes/fundraiser-news";
import { signAdminSession } from "../../src/admin/session";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import type { PictureRow } from "../../src/fundraising/pictures";

const PHOTO_ID = "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
const COOKIE = "nbcc_fr_session=abcDEF123_-";
let JPEG: Buffer;

let server: Server;
let base = "";
beforeAll(async () => {
  JPEG = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#a33" } })
    .withMetadata({ exif: { IFD0: { Make: "ExamplePhone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 27/1 0/1" } } })
    .jpeg()
    .toBuffer();
  const app = express();
  app.set("trust proxy", 1);
  app.use(PICTURE_POST_PATH, newsBodyGuard, express.json({ limit: PICTURE_JSON_BODY_LIMIT }));
  app.use(express.json());
  app.use(fundraiserPicturesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const record = (over: Partial<FundraiserRecord> = {}) =>
  ({
    id: 9,
    slug: "sams-walk",
    path: "raising",
    kind: "run_walk",
    title: "Sam's Walk",
    description: "Ten miles.",
    eventDate: null,
    public: true,
    status: "approved",
    name: "Sam Sample",
    email: "Sam@Example.com",
    imageSrc: null,
    isTeam: false,
    meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
    editWaiting: false,
    ...over,
  }) as FundraiserRecord & { meter: ReturnType<typeof meter>; editWaiting: boolean };

const row = (over: Partial<PictureRow> = {}): PictureRow => ({
  id: 41,
  fundraiserId: 9,
  kind: "profile",
  status: "pending",
  photoId: PHOTO_ID,
  hasPhoto: true,
  width: 400,
  height: 400,
  createdAt: "2026-11-20T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  declineReason: null,
  ...over,
});

beforeEach(() => {
  for (const group of [db, pics, signIn, users]) for (const fn of Object.values(group)) fn.mockReset();
  db.fundraisingIsOn.mockResolvedValue(true);
  db.getFundraiser.mockResolvedValue(record());
  db.listForOrganiser.mockResolvedValue([record()]);
  signIn.findSession.mockResolvedValue({ email: "sam@example.com" });
  pics.sendPicture.mockResolvedValue({ verdict: "ok", picture: row() });
  pics.listPictures.mockResolvedValue([]);
  pics.countSentToday.mockResolvedValue(0);
  proc.override = null;
  pictureLimitersReset();
});

function organiser(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: base, Cookie: COOKIE, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const send = (body: unknown, headers?: Record<string, string>) => organiser("POST", "/api/fundraise/manage/fundraisers/9/pictures", body, headers);
const jpegBody = (kind = "profile") => ({ kind, mime: "image/jpeg", dataBase64: JPEG.toString("base64") });

describe("sending a picture from the private area", () => {
  it("makes it again on the server, square for a profile photo, and stores it waiting", async () => {
    const res = await send(jpegBody("profile"));
    expect(res.status).toBe(202);
    const [id, email, kind, made] = pics.sendPicture.mock.calls[0];
    expect([id, email, kind]).toEqual([9, "sam@example.com", "profile"]);
    expect([made.mime, made.width, made.height]).toEqual(["image/jpeg", 400, 400]);
    const meta = await sharp(made.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(made.bytes.includes(Buffer.from("ExamplePhone"))).toBe(false);
    expect(await res.json()).toEqual({
      status: "waiting",
      picture: {
        id: 41,
        kind: "profile",
        status: "pending",
        statusWords: "Waiting for us to check",
        createdAt: row().createdAt,
        photoUrl: "/api/fundraise/manage/pictures/41/photo",
        note: null,
      },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps a main photo's shape", async () => {
    await send(jpegBody("main"));
    const made = pics.sendPicture.mock.calls[0][3];
    expect([made.width, made.height]).toEqual([900, 600]);
  });

  it("refuses anything that is not a JPEG, PNG or WebP, and stores nothing", async () => {
    for (const body of [
      { kind: "profile", mime: "image/png", dataBase64: Buffer.from("<html><script>alert(1)</script></html>").toString("base64") },
      { kind: "profile", mime: "image/svg+xml", dataBase64: Buffer.from("<svg onload='x'/>").toString("base64") },
      { kind: "profile", mime: "image/jpeg", dataBase64: "not base64 at all!!" },
    ]) {
      const res = await send(body);
      expect(res.status).toBe(400);
      expect((await res.json()).fields.photo).toBe("That picture is not one we can use. Try a JPG, PNG or WebP photo.");
    }
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("takes only a JPEG, which is all the private area sends", async () => {
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#a33" } }).png().toBuffer();
    const res = await send({ kind: "profile", mime: "image/png", dataBase64: png.toString("base64") });
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photo).toBe("That picture is not one we can use. Try a JPG, PNG or WebP photo.");
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("says so when ten were sent today, before the picture is even opened", async () => {
    pics.countSentToday.mockResolvedValue(10);
    let opened = false;
    proc.override = async () => {
      opened = true;
      return { ok: false, reason: "unreadable" };
    };
    const res = await send(jpegBody());
    expect(res.status).toBe(429);
    expect(opened).toBe(false);
    expect(pics.countSentToday).toHaveBeenCalledWith(9);
  });

  it("counts every try, even ones that fail, and stops a session after 20 in a day", async () => {
    const bad = { kind: "profile", mime: "image/jpeg", dataBase64: "not base64 at all!!" };
    for (let i = 0; i < 20; i++) expect((await send(bad)).status).toBe(400);
    const res = await send(jpegBody());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("You have tried to send a lot of photos today. Please try again tomorrow.");
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("says to try again in a minute when lots of photos are arriving at once", async () => {
    proc.override = async () => ({ ok: false, reason: "busy" });
    const res = await send(jpegBody());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("Lots of photos arriving just now. Please try again in a minute.");
  });

  it("says a picture is too big when even a smaller save of it is over the limit", async () => {
    proc.override = async () => ({ ok: false, reason: "size" });
    const res = await send(jpegBody());
    expect(res.status).toBe(413);
    expect((await res.json()).fields.photo).toBe("That picture is too big. Try a smaller one.");
  });

  it("takes no round photo for a page in memory of someone", async () => {
    db.getFundraiser.mockResolvedValue(record({ inMemory: true } as Partial<FundraiserRecord>));
    expect((await send(jpegBody("profile"))).status).toBe(410);
    expect((await send(jpegBody("main"))).status).toBe(202);
  });

  it("refuses one that only starts like a JPEG", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("nothing more")]);
    const res = await send({ kind: "main", mime: "image/jpeg", dataBase64: fake.toString("base64") });
    expect(res.status).toBe(400);
    expect((await res.json()).fields.photo).toBe("We could not open that picture. Please try a different photo.");
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("refuses one over 2 MB, the same as every other upload", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    const res = await send({ kind: "main", mime: "image/jpeg", dataBase64: big.toString("base64") });
    expect(res.status).toBe(413);
    expect((await res.json()).fields.photo).toBe("That picture is too big. Try a smaller one.");
  });

  it("refuses a kind it does not know", async () => {
    const res = await send({ kind: "banner", mime: "image/jpeg", dataBase64: JPEG.toString("base64") });
    expect(res.status).toBe(400);
  });

  it("is ten a day for each fundraiser", async () => {
    pics.sendPicture.mockResolvedValue({ verdict: "limit" });
    const res = await send(jpegBody());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("You have sent 10 pictures in the last day. Please try again tomorrow.");
  });

  it("is only for their own fundraiser: anyone else's reads as not there", async () => {
    db.getFundraiser.mockResolvedValue(record({ email: "someone.else@example.com" }));
    expect((await send(jpegBody())).status).toBe(404);
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("is only for one still running with a page", async () => {
    for (const over of [{ status: "finished" as const }, { public: false }]) {
      db.getFundraiser.mockResolvedValue(record(over));
      expect((await send(jpegBody())).status).toBe(410);
    }
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });

  it("needs a session before the body is read, and our own page", async () => {
    let res = await fetch(`${base}/api/fundraise/manage/fundraisers/9/pictures`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(jpegBody()),
    });
    expect(res.status).toBe(401);
    res = await send(jpegBody(), { Origin: "https://elsewhere.example" });
    expect(res.status).toBe(403);
    expect(pics.sendPicture).not.toHaveBeenCalled();
  });
});

describe("what the private area shows", () => {
  it("each fundraiser's pictures: the one in use and the newest after it, with the note on one not used", async () => {
    db.listForOrganiser.mockResolvedValue([record({ imageSrc: "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d" })]);
    pics.listPictures.mockResolvedValue([
      row({ id: 43, kind: "profile", status: "declined", declineReason: "One without other people in it, please.", createdAt: "2026-11-22T10:00:00.000Z" }),
      row({ id: 42, kind: "profile", status: "approved", createdAt: "2026-11-21T10:00:00.000Z" }),
      row({ id: 41, kind: "main", status: "pending" }),
    ]);
    const res = await organiser("GET", "/api/fundraise/manage/pictures");
    expect(res.status).toBe(200);
    const body = await res.json();
    const f = body.fundraisers[0];
    expect(f).toMatchObject({
      id: 9,
      canSend: true,
      profileAllowed: true,
      name: "Sam S.",
      title: "Sam's Walk",
      isTeam: false,
      inTeam: false,
      pageImageSrc: "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d",
    });
    expect(f.profile.inUse).toMatchObject({ id: 42, statusWords: "On your page" });
    expect(f.profile.latest).toMatchObject({ id: 43, statusWords: "Not used", note: "One without other people in it, please." });
    expect(f.main.inUse).toBeNull();
    expect(f.main.latest).toMatchObject({ id: 41, statusWords: "Waiting for us to check" });
    expect(f.inMemory).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/decidedBy|admin:/);
  });

  it("gives no photo address once a picture's bytes have gone", async () => {
    pics.listPictures.mockResolvedValue([row({ id: 43, status: "declined", hasPhoto: false })]);
    const body = await (await organiser("GET", "/api/fundraise/manage/pictures")).json();
    expect(body.fundraisers[0].profile.latest.photoUrl).toBeNull();
  });

  it("says a page in memory of someone has no round photo", async () => {
    db.listForOrganiser.mockResolvedValue([record({ inMemory: true } as Partial<FundraiserRecord>)]);
    const body = await (await organiser("GET", "/api/fundraise/manage/pictures")).json();
    expect(body.fundraisers[0]).toMatchObject({ inMemory: true, profileAllowed: false });
  });

  it("lets the owner see their own picture, kept out of every cache", async () => {
    pics.pictureForOwner.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG });
    const res = await organiser("GET", "/api/fundraise/manage/pictures/41/photo");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pics.pictureForOwner).toHaveBeenCalledWith(41, "sam@example.com");
  });

  it("someone else's picture is not there", async () => {
    pics.pictureForOwner.mockResolvedValue(null);
    expect((await organiser("GET", "/api/fundraise/manage/pictures/41/photo")).status).toBe(404);
  });
});

describe("the public address of a profile photo", () => {
  it("answers nothing until it is approved", async () => {
    pics.publicProfilePhoto.mockResolvedValue(null);
    const res = await fetch(`${base}/media/fundraiser-profile/${PHOTO_ID}`);
    expect(res.status).toBe(404);
  });

  it("serves an approved one as the picture it is, for a few minutes", async () => {
    pics.publicProfilePhoto.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG });
    const res = await fetch(`${base}/media/fundraiser-profile/${PHOTO_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers nothing while fundraising is switched off, or for an address that is not a uuid", async () => {
    pics.publicProfilePhoto.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG });
    expect((await fetch(`${base}/media/fundraiser-profile/../../etc`)).status).toBe(404);
    expect((await fetch(`${base}/media/fundraiser-profile/not-a-uuid`)).status).toBe(404);
    db.fundraisingIsOn.mockResolvedValue(false);
    expect((await fetch(`${base}/media/fundraiser-profile/${PHOTO_ID}`)).status).toBe(404);
  });
});

describe("staff, in Admin > Fundraising", () => {
  async function token(role: "viewer" | "editor" | "admin") {
    users.getUserAuthRow.mockResolvedValue({ id: 3, email: "fern@example.com", role, status: "active", permissions: {} });
    return signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: "a-test-secret" }).token;
  }
  async function staff(role: "viewer" | "editor" | "admin", method: string, path: string, body?: unknown) {
    return fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token(role)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  it("lists a sign up's pictures, the reason and who decided included", async () => {
    pics.listPictures.mockResolvedValue([row({ status: "declined", declineReason: "Too dark.", decidedBy: "admin:fern@example.com" })]);
    const res = await staff("viewer", "GET", "/api/admin/fundraisers/9/pictures");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pictures[0]).toMatchObject({
      id: 41,
      kind: "profile",
      status: "declined",
      note: "Too dark.",
      decidedBy: "admin:fern@example.com",
      photoUrl: "/api/admin/fundraisers/9/pictures/41/photo",
    });
    expect(body.organisedBy).toBe("Sam S.");
  });

  it("shows staff a waiting picture with their own sign in", async () => {
    pics.pictureForStaff.mockResolvedValue({ mime: "image/jpeg", bytes: JPEG });
    const res = await staff("viewer", "GET", "/api/admin/fundraisers/9/pictures/41/photo");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await fetch(`${base}/api/admin/fundraisers/9/pictures/41/photo`)).status).toBe(401);
  });

  it("counts what waits on each sign up", async () => {
    pics.pendingPicturesByFundraiser.mockResolvedValue({ 9: 1 });
    const res = await staff("viewer", "GET", "/api/admin/fundraising/pictures-waiting");
    expect(await res.json()).toEqual({ counts: { 9: 1 } });
  });

  it("an editor approves, with who did it", async () => {
    pics.decidePicture.mockResolvedValue(row({ status: "approved" }));
    const res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/approve");
    expect(res.status).toBe(200);
    expect(pics.decidePicture).toHaveBeenCalledWith(9, 41, "approve", "admin:fern@example.com", { reason: null, adminId: 3 });
  });

  it("declines with an optional note for the organiser, 500 characters at most", async () => {
    pics.decidePicture.mockResolvedValue(row({ status: "declined" }));
    let res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/decline", { reason: "  Too dark.  " });
    expect(res.status).toBe(200);
    expect(pics.decidePicture).toHaveBeenCalledWith(9, 41, "decline", "admin:fern@example.com", { reason: "Too dark.", adminId: 3 });
    res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/decline", { reason: "x".repeat(501) });
    expect(res.status).toBe(400);
  });

  it("will not approve a round photo for a page in memory of someone", async () => {
    const { PictureError } = await import("../../src/db/fundraiser-pictures");
    pics.decidePicture.mockRejectedValue(new PictureError("not_allowed"));
    const res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/approve");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A page in memory of someone shows their photo, not a round photo of the organiser.");
  });

  it("an admin deletes a picture for good, audited by who did it; an editor cannot", async () => {
    pics.deletePicture.mockResolvedValue(undefined);
    let res = await staff("admin", "POST", "/api/admin/fundraisers/9/pictures/41/delete");
    expect(res.status).toBe(200);
    expect(pics.deletePicture).toHaveBeenCalledWith(9, 41, "admin:fern@example.com");
    pics.deletePicture.mockClear();
    res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/delete");
    expect(res.status).toBe(403);
    expect(pics.deletePicture).not.toHaveBeenCalled();
  });

  it("a viewer cannot decide anything", async () => {
    const res = await staff("viewer", "POST", "/api/admin/fundraisers/9/pictures/41/approve");
    expect(res.status).toBe(403);
    expect(pics.decidePicture).not.toHaveBeenCalled();
  });

  it("one dealt with already is a 409", async () => {
    const { PictureError } = await import("../../src/db/fundraiser-pictures");
    pics.decidePicture.mockRejectedValue(new PictureError("not_waiting"));
    const res = await staff("editor", "POST", "/api/admin/fundraisers/9/pictures/41/remove");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("That picture has already been dealt with. Look again.");
  });
});
