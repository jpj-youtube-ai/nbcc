import { describe, it, expect } from "vitest";
import {
  PICTURES_PER_DAY,
  canSendPictures,
  checkPictureUpload,
  decodeBase64,
  organiserPictureView,
  pictureLimitReached,
  pictureStatusWords,
  pictureUploadSchema,
  profileAlt,
  profilePhotoAllowed,
  profilePhotoSrc,
  type PictureRow,
} from "../../src/fundraising/pictures";

// Profile pictures (Jaimie, 2026-10-03): the rules, pure. An organiser sends their page's main photo
// and a small round photo of themselves from their private area; each waits for staff. Every name
// here is invented.

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const row = (over: Partial<PictureRow> = {}): PictureRow => ({
  id: 1,
  fundraiserId: 7,
  kind: "profile",
  status: "pending",
  photoId: "0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d",
  width: 400,
  height: 400,
  createdAt: "2026-11-20T10:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  declineReason: null,
  ...over,
});

describe("what the upload form sends", () => {
  it("takes a kind, a type and the picture as base64", () => {
    const ok = pictureUploadSchema.safeParse({ kind: "profile", mime: "image/jpeg", dataBase64: "abcd" });
    expect(ok.success).toBe(true);
  });

  it("refuses a kind it does not know", () => {
    expect(pictureUploadSchema.safeParse({ kind: "banner", mime: "image/jpeg", dataBase64: "abcd" }).success).toBe(false);
  });

  it("refuses anything else sent with it", () => {
    expect(pictureUploadSchema.safeParse({ kind: "main", mime: "image/jpeg", dataBase64: "abcd", src: "/x" }).success).toBe(false);
  });
});

describe("decoding the picture", () => {
  it("reads strict base64, ignoring line breaks", () => {
    expect([...decodeBase64("/9j/\n4A==")]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("gives nothing for anything that is not base64", () => {
    expect(decodeBase64("not base64!").length).toBe(0);
  });
});

describe("checking the picture", () => {
  it("takes a JPEG, PNG or WebP whose bytes really are that type", () => {
    expect(checkPictureUpload("image/jpeg", JPEG)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkPictureUpload("image/png", PNG)).toEqual({ ok: true, mime: "image/png" });
  });

  it("refuses a picture whose bytes are another type than it says", () => {
    expect(checkPictureUpload("image/png", JPEG)).toEqual({ ok: false, reason: "type" });
  });

  it("refuses SVG and GIF", () => {
    expect(checkPictureUpload("image/svg+xml", Buffer.from("<svg/>"))).toEqual({ ok: false, reason: "type" });
    expect(checkPictureUpload("image/gif", Buffer.from("GIF89a"))).toEqual({ ok: false, reason: "type" });
  });

  it("refuses one over 2 MB, like every other upload", () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(JPEG);
    expect(checkPictureUpload("image/jpeg", big)).toEqual({ ok: false, reason: "size" });
  });
});

describe("who can send pictures", () => {
  const f = { status: "approved" as const, public: true, path: "raising" as const };

  it("an approved fundraiser with a page", () => {
    expect(canSendPictures(f)).toBe(true);
    expect(canSendPictures({ ...f, path: "event" })).toBe(true);
  });

  it("not a finished one, a private one or one with no page", () => {
    expect(canSendPictures({ ...f, status: "finished" })).toBe(false);
    expect(canSendPictures({ ...f, public: false })).toBe(false);
    expect(canSendPictures({ ...f, path: "own" as never })).toBe(false);
  });

  it("a profile photo is for every page but one in memory of someone, which shows their photo instead", () => {
    expect(profilePhotoAllowed(f)).toBe(true);
    expect(profilePhotoAllowed({ ...f, inMemory: false })).toBe(true);
    expect(profilePhotoAllowed({ ...f, inMemory: true })).toBe(false);
  });

  it(`at most ${PICTURES_PER_DAY} in any day`, () => {
    expect(pictureLimitReached(PICTURES_PER_DAY - 1)).toBe(false);
    expect(pictureLimitReached(PICTURES_PER_DAY)).toBe(true);
  });
});

describe("the words", () => {
  it("say where a picture is up to, as the organiser reads it", () => {
    expect(pictureStatusWords("pending")).toBe("Waiting for us to check");
    expect(pictureStatusWords("approved")).toBe("On your page");
    expect(pictureStatusWords("declined")).toBe("Not used");
    expect(pictureStatusWords("removed")).toBe("Taken off your page");
  });

  it("describe a profile photo by the name the page shows", () => {
    expect(profileAlt("Robin O.")).toBe("A photo of Robin O.");
  });

  it("give a profile photo its public address by its own id only", () => {
    expect(profilePhotoSrc("0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d")).toBe("/media/fundraiser-profile/0b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
  });
});

describe("what the organiser sees of each kind", () => {
  it("the one in use, and the newest sent after it", () => {
    const inUse = row({ id: 1, status: "approved" });
    const waiting = row({ id: 2, status: "pending", createdAt: "2026-11-21T10:00:00.000Z" });
    expect(organiserPictureView([waiting, inUse], "profile")).toEqual({ inUse, latest: waiting });
  });

  it("only the other kind's rows are left out", () => {
    const main = row({ id: 3, kind: "main", status: "pending" });
    expect(organiserPictureView([main], "profile")).toEqual({ inUse: null, latest: null });
    expect(organiserPictureView([main], "main")).toEqual({ inUse: null, latest: main });
  });

  it("a declined one shows until a newer one is sent; a replaced one never does", () => {
    const declined = row({ id: 4, status: "declined", declineReason: "Could you send one without other people in it?" });
    const replaced = row({ id: 5, status: "replaced", createdAt: "2026-11-22T10:00:00.000Z" });
    expect(organiserPictureView([replaced, declined], "profile")).toEqual({ inUse: null, latest: declined });
  });

  it("nothing newer than the one in use leaves latest empty", () => {
    const inUse = row({ id: 6, status: "approved", createdAt: "2026-11-23T10:00:00.000Z" });
    const older = row({ id: 7, status: "declined", createdAt: "2026-11-20T10:00:00.000Z" });
    expect(organiserPictureView([inUse, older], "profile")).toEqual({ inUse, latest: null });
  });
});
