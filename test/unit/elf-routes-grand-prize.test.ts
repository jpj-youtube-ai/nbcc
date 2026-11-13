import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NBCC Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2,
// docs/superpowers/plans/2026-11-12-elf-grand-prize.md, Task 3): a family sends in a graduate's picture for the
// grand prize from Detective HQ. The entry page (GET /elf/hq/entry/:detective), the picture
// (POST /api/elf/entry/:detective, JSON { mime, dataBase64, mobile? }), the family's own picture
// (GET /elf/hq/entry/:detective/picture.jpg) and Detective HQ's grand prize section, driven over HTTP through
// the real router and body parsers, as test/unit/elf-routes-game.test.ts drives them, with the database mocked
// and the doors built by the real loaders from the mocked door rows (test/unit/elf-routes-fixtures.ts).
//
// The clock is 10:30am on Christmas Eve, 24 December 2026, unless a test says otherwise (ruling F8): every door
// was snowed in, and a snowed in door 24 counts as done from its first clue at 10am, so Ruby (detective 100) and
// Leo (101) of family 3 have both done all 24 doors. The entries close at 5pm. Every family, place and picture
// here is invented.
//
// Task 6 adds a graduate's certificate (GET /elf/hq/certificate/:detective), share card
// (GET /elf/hq/share/:detective.png) and the graduates' video (GET /elf/hq/video), at 6pm on Christmas Eve, with
// the elf's picture (elfPng) answering a small PNG and the share card drawn by the real sharp.

const db = vi.hoisted(() => ({
  getElfSettings: vi.fn(),
  findElfSession: vi.fn(),
  familyWithDetectives: vi.fn(),
  // Task 7: the family's switch for the emails that are not essential.
  familyByEmailsToken: vi.fn(),
  setEmailsStopped: vi.fn(),
}));
const doors = vi.hoisted(() => ({ listElfDoors: vi.fn(), getElfDoor: vi.fn(), findElfDoorByPosterCode: vi.fn(), ensureElfDoors: vi.fn() }));
const practice = vi.hoisted(() => ({ getPractice: vi.fn() }));
const game = vi.hoisted(() => ({
  markAutomaticSnowDays: vi.fn(),
  familyKnowledge: vi.fn(),
  familyDoorsDone: vi.fn(),
  detectiveDoorsDone: vi.fn(),
  finderParts: vi.fn(),
  // For the one test that sends a door's photo, which shares the day's tries with the entries.
  familyVisits: vi.fn(),
  sendElfPhoto: vi.fn(),
}));
const prize = vi.hoisted(() => ({ saveEntry: vi.fn(), familyHasMobile: vi.fn(), familyEntries: vi.fn(), entryPicture: vi.fn() }));
// The elf on its stage, for the certificate and the share card: answering a small PNG. The rest of the module is the
// real one, its queue (inTurn) among it, which the share card takes its turn in.
const png = vi.hoisted(() => ({ elfPng: vi.fn() }));
// The real picture processing and the real share card, watched.
const spies = vi.hoisted(() => ({}) as { processPicture: Mock; shareCardSvg: Mock });

vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf-practice", () => practice);
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-game")>()), ...game }));
vi.mock("../../src/db/elf-grand-prize", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-grand-prize")>()), ...prize }));
vi.mock("../../src/elf/elf-png", async (orig) => ({ ...(await orig<typeof import("../../src/elf/elf-png")>()), ...png }));
vi.mock("../../src/elf/print", async (orig) => {
  const real = await orig<typeof import("../../src/elf/print")>();
  spies.shareCardSvg = vi.fn(real.shareCardSvg);
  return { ...real, shareCardSvg: spies.shareCardSvg };
});
vi.mock("../../src/fundraising/picture-process", async (orig) => {
  const real = await orig<typeof import("../../src/fundraising/picture-process")>();
  spies.processPicture = vi.fn(real.processPicture);
  return { ...real, processPicture: spies.processPicture };
});
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
// What every page of the site gains in its banner and footer as it goes out (TASK-615) is not this file's to
// check: the pages here go out as drawn, as in test/unit/elf-routes-game.test.ts.
vi.mock("../../src/routes/site", () => ({ decorateSitePage: async (html: string) => html }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import sharp from "sharp";
import { elfPhotoBodyGuard, elfRouter, ELF_ENTRY_POST_PATH, ELF_PHOTO_POST_PATH, PHOTO_TRIES, resetElfLimits, resetPublicCalendar } from "../../src/routes/elf";
import { PICTURE_JSON_BODY_LIMIT } from "../../src/routes/fundraiser-pictures";
import { ELF_PNG_QUEUE_MAX, inTurn } from "../../src/elf/elf-png";
import { MOBILE_WORDS } from "../../src/elf/join";
import { hqViewFor } from "../../src/elf/views";
import { tinyJpeg } from "./fixtures/tiny-jpeg";
import { at, callerAt, CODE, door7, doorsDoneFromRuns, EVE_10_30, EVERY_DOOR, FAMILY, OFF, ON, PRACTICE_PASS, practiceRow, snowedIn, type Ask } from "./elf-routes-fixtures";

const FOUR_59_59 = at("2026-12-24T16:59:59.000Z");
const FIVE_PM = at("2026-12-24T17:00:00.000Z");
/** 6pm on Christmas Eve: the entries have closed, and every detective of family 3 has graduated. */
const SIX_PM = at("2026-12-24T18:00:00.000Z");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BUSY = "Busy. Please try again in a moment.";
/** The graduates' video a head elf set: a pretend one. */
const VIDEO = "https://example.org/graduates";
/** The elf on its stage, as elfPng answers it here: a small real PNG, made before the tests. */
let ELF = Buffer.alloc(0);
const elfData = () => `data:image/png;base64,${ELF.toString("base64")}`;
/** A minute before midnight as Christmas Eve begins, when the entries are not open yet. */
const EVE_EVE = at("2026-12-23T23:59:00.000Z");
const WORDS = "Something went wrong just now. Please try again in a few minutes.";
const THANKS = "Thank you! Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.";
const CLOSED = "Grand prize entries closed at 5pm on Christmas Eve.";
/** Family 3's own token for the link that stops its emails (Task 7), as the database makes them: invented. */
const EMAILS_TOKEN = "0123456789abcdef0123456789abcdef";
/** Family 3's detectives: Ruby and Leo, whose first name staff have not ticked yet. Detective 999 is another family's. */
const RUBY = 100;
const LEO = 101;
const OTHER = 999;

let server: Server;
let base = "";
beforeAll(async () => {
  ELF = await sharp({ create: { width: 34, height: 51, channels: 3, background: { r: 26, g: 83, b: 26 } } }).png().toBuffer();
  // Mounted as src/app.ts mounts them: the photo's and the entry's bigger body parsers first, each on its own
  // path behind the cookie guard, then the usual one.
  const app = express();
  app.set("trust proxy", 1);
  app.use(ELF_PHOTO_POST_PATH, elfPhotoBodyGuard(express.json({ limit: PICTURE_JSON_BODY_LIMIT })));
  app.use(ELF_ENTRY_POST_PATH, elfPhotoBodyGuard(express.json({ limit: PICTURE_JSON_BODY_LIMIT })));
  app.use(express.json());
  app.use(elfRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVE_10_30);
  for (const group of [db, doors, practice, game, prize, png]) for (const f of Object.values(group)) f.mockReset();
  spies.processPicture.mockClear();
  // Made the first time the router's prints are loaded.
  spies.shareCardSvg?.mockClear();
  resetPublicCalendar();
  resetElfLimits();
  db.getElfSettings.mockResolvedValue(ON);
  db.findElfSession.mockResolvedValue({ familyId: 3 });
  db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? FAMILY : null));
  db.familyByEmailsToken.mockImplementation(async (token: string) => (token === EMAILS_TOKEN ? { id: 3, stopped: false } : null));
  db.setEmailsStopped.mockResolvedValue(undefined);
  doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR));
  doors.getElfDoor.mockResolvedValue(null);
  practice.getPractice.mockResolvedValue(null);
  game.markAutomaticSnowDays.mockResolvedValue([]);
  game.familyKnowledge.mockResolvedValue({ guesses: new Map(), typed: new Set() });
  game.familyDoorsDone.mockImplementation(doorsDoneFromRuns);
  game.finderParts.mockResolvedValue([]);
  prize.familyHasMobile.mockResolvedValue(true);
  prize.familyEntries.mockResolvedValue(new Map());
  prize.saveEntry.mockResolvedValue({ id: 21, replaced: false });
  prize.entryPicture.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("the picture") });
  png.elfPng.mockResolvedValue(ELF);
});
afterEach(() => vi.useRealTimers());

const call = callerAt(() => base);

/** The picture as the entry page's script sends it: a real JPEG, in base64. */
const entryBody = async (over: Record<string, unknown> = {}) => ({ mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64"), ...over });
const send = async (over: Record<string, unknown> = {}, ask: Ask = {}, detective: number | string = RUBY) =>
  call("POST", `/api/elf/entry/${detective}`, { json: await entryBody(over), ...ask });
/** Every detective of family 3 with all 24 doors done whatever the doors say: for the moments before door 24's
 *  first clue, when no real December could have a graduate yet. */
const everyDoorDone = () =>
  game.familyDoorsDone.mockResolvedValue(new Map(FAMILY.detectives.map((d) => [d.id, { cracked: [], visited: [], snow: [...EVERY_DOOR] }])));
/** Nothing of a family's entry was read, made or stored. */
const nothingDone = () => {
  expect(prize.saveEntry).not.toHaveBeenCalled();
  expect(spies.processPicture).not.toHaveBeenCalled();
};

// ---- the entry page ----------------------------------------------------------------------------------------

describe("the entry page", () => {
  it("is a graduate's own page from Christmas Eve, private and never kept, posting to the entry's address", async () => {
    const r = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.text).toContain("Send in your picture");
    expect(r.text).toContain('data-api="/api/elf/entry/100"');
    expect(r.text).toContain("For Detective Ruby Tinselfoot, for the grand prize");
    expect(r.text).toContain("Entries close at 5pm on Christmas Eve.");
    expect(r.text).not.toContain('name="mobile"');
    expect(game.familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), EVE_10_30);
    expect(prize.familyHasMobile).toHaveBeenCalledWith(3);
    expect(prize.familyEntries).toHaveBeenCalledWith(2026, 3);
  });

  it("asks a family with no mobile for one", async () => {
    prize.familyHasMobile.mockResolvedValue(false);
    const r = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(r.text).toContain('name="mobile"');
    expect(r.text).toContain("So we can ring you straight away if one of your detectives wins the grand prize on Christmas Eve.");
  });

  it("shows the picture that is in, from its private address, with a new one to send", async () => {
    prize.familyEntries.mockResolvedValue(new Map([[RUBY, { sentAt: at("2026-12-24T10:15:00.000Z") }]]));
    const r = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(r.text).toContain('src="/elf/hq/entry/100/picture.jpg"');
    expect(r.text).toContain("Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.");
    expect(r.text).toContain("Send a new picture");
  });

  it("says the entries have closed from 5pm, with no form", async () => {
    vi.setSystemTime(FIVE_PM);
    const r = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain(CLOSED);
    expect(r.text).not.toContain("<form");
  });

  it("is not found for a detective who has done 23 doors, for another family's, or for no detective at all", async () => {
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR.slice(0, 23)));
    const notYet = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(notYet.status).toBe(404);
    expect(notYet.headers.get("cache-control")).toBe("private, no-store");
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR));
    for (const id of [String(OTHER), "0", "abc", "100.5", "12345678901"]) expect((await call("GET", `/elf/hq/entry/${id}`)).status, id).toBe(404);
    expect(prize.familyEntries).not.toHaveBeenCalled();
  });

  it("is not found before midnight as Christmas Eve begins, even for a detective with every door done", async () => {
    vi.setSystemTime(EVE_EVE);
    everyDoorDone();
    expect((await call("GET", `/elf/hq/entry/${RUBY}`)).status).toBe(404);
    expect(prize.familyEntries).not.toHaveBeenCalled();
  });

  it("sends someone signed out to sign in", async () => {
    const r = await call("GET", `/elf/hq/entry/${RUBY}`, { cookie: null });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/sign-in");
  });

  it("answers 500 with the game's words when the family's entries cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prize.familyEntries.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", `/elf/hq/entry/${RUBY}`);
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- sending the picture -----------------------------------------------------------------------------------

describe("sending in a picture", () => {
  it("makes the picture again, keeps it as the graduate's entry, and answers 201 with the thank you", async () => {
    const jpeg = await tinyJpeg();
    const r = await send();
    expect(r.status).toBe(201);
    expect(r.data).toEqual({ ok: true, message: THANKS });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(spies.processPicture).toHaveBeenCalledWith("main", jpeg);
    expect(spies.processPicture.mock.invocationCallOrder[0]).toBeLessThan(prize.saveEntry.mock.invocationCallOrder[0]);
    const saved = prize.saveEntry.mock.calls[0][0];
    expect({ ...saved, picture: { ...saved.picture, bytes: Buffer.isBuffer(saved.picture.bytes) } }).toEqual({
      year: 2026,
      detectiveId: 100,
      familyId: 3,
      picture: { mime: "image/jpeg", bytes: true, width: 4, height: 4 },
      mobile: null,
      at: EVE_10_30,
    });
  });

  it("answers 200 with the same thank you when the picture takes the place of the one before", async () => {
    prize.saveEntry.mockResolvedValue({ id: 21, replaced: true });
    const r = await send();
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, message: THANKS });
  });

  // Review Focus 1: a picture sent at 4:59:59pm is kept, and one at 5pm is refused with nothing stored.
  it("keeps a picture sent at 4:59:59pm, and refuses one at 5pm with nothing made or stored", async () => {
    vi.setSystemTime(FOUR_59_59);
    const last = await send();
    expect(last.status).toBe(201);
    expect(prize.saveEntry.mock.calls[0][0].at).toEqual(FOUR_59_59);
    prize.saveEntry.mockClear();
    spies.processPicture.mockClear();
    vi.setSystemTime(FIVE_PM);
    const late = await send();
    expect(late.status).toBe(409);
    expect(late.data).toEqual({ error: CLOSED });
    nothingDone();
  });

  it("closes at the time a head elf set in Settings, and says it", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, grandPrizeClosesAt: at("2026-12-24T18:30:00.000Z") });
    vi.setSystemTime(at("2026-12-24T18:00:00.000Z"));
    const r = await send();
    expect(r.status).toBe(201);
    expect(r.data.message).toBe("Thank you! Detective Ruby Tinselfoot's picture is in. You can change it until 6:30pm on Christmas Eve.");
    vi.setSystemTime(at("2026-12-24T18:30:00.000Z"));
    expect((await send()).data).toEqual({ error: "Grand prize entries closed at 6:30pm on Christmas Eve." });
  });

  it("is not found before midnight as Christmas Eve begins, even for a detective with every door done", async () => {
    vi.setSystemTime(EVE_EVE);
    everyDoorDone();
    const r = await send();
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    nothingDone();
  });

  // Fix round 1 (the review's Minor 1): the window is entryOpen's, which fails closed. With a year that is not one,
  // the closing is not a real time either, and a picture is refused rather than taken.
  it("refuses a picture, with nothing made or stored, when the closing is not a real time", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, year: Number.NaN });
    everyDoorDone();
    const r = await send();
    expect(r.status).toBe(409);
    expect(String(r.data.error)).toMatch(/^Grand prize entries closed at/);
    nothingDone();
  });

  it("refuses a detective who has not done all 24 doors, by name, with nothing made or stored", async () => {
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR.slice(0, 23)));
    const r = await send();
    expect(r.status).toBe(403);
    expect(r.data).toEqual({ error: "Detective Ruby Tinselfoot has not done all 24 doors yet." });
    nothingDone();
  });

  it("is not found for another family's detective, or for no detective at all, with nothing stored", async () => {
    for (const id of [String(OTHER), "0", "abc"]) {
      const r = await send({}, {}, id);
      expect(r.status, id).toBe(404);
      expect(r.data).toEqual({ error: "Not found" });
    }
    nothingDone();
  });

  it("asks a family with no mobile for one, with the join form's words, and makes nothing", async () => {
    prize.familyHasMobile.mockResolvedValue(false);
    for (const mobile of [undefined, "", "12345", "01632 960 123"]) {
      const r = await send(mobile === undefined ? {} : { mobile });
      expect(r.status, String(mobile)).toBe(400);
      expect(r.data).toEqual({ error: MOBILE_WORDS, fields: { mobile: MOBILE_WORDS } });
    }
    expect(MOBILE_WORDS).toBe("Please type a UK mobile number, like 07700 900 123.");
    nothingDone();
  });

  it("keeps the mobile a family with none sends with its picture, as +447 and nine digits", async () => {
    prize.familyHasMobile.mockResolvedValue(false);
    const r = await send({ mobile: "07700 900 123" });
    expect(r.status).toBe(201);
    expect(prize.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ mobile: "+447700900123" }));
  });

  it("ignores a mobile from a family that already has one", async () => {
    const r = await send({ mobile: "07700 900 456" });
    expect(r.status).toBe(201);
    expect(prize.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ mobile: null }));
  });

  it("answers as the photo post does for a picture it cannot use: not a picture, busy, too big, unreadable", async () => {
    const notOne = await send({ mime: "image/png", dataBase64: Buffer.from("<svg onload='x'/>").toString("base64") });
    expect(notOne.status).toBe(400);
    expect(notOne.data).toEqual({ error: "Your picture needs another look", fields: { photo: "That picture is not one we can use. Try a JPG, PNG or WebP photo." } });
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "busy" });
    const busy = await send();
    expect(busy.status).toBe(503);
    expect(busy.data).toEqual({ error: "Lots of photos arriving just now. Please try again in a minute." });
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "size" });
    const big = await send();
    expect(big.status).toBe(413);
    expect(big.data).toEqual({ error: "Your picture needs another look", fields: { photo: "That picture is too big. Try a smaller one." } });
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "unreadable" });
    const unreadable = await send();
    expect(unreadable.status).toBe(400);
    expect(unreadable.data).toEqual({ error: "Your picture needs another look", fields: { photo: "We could not open that picture. Please try a different photo." } });
    expect(prize.saveEntry).not.toHaveBeenCalled();
  });

  it("counts every try before a picture is opened, with the photo's limit of 20 a family a day", async () => {
    expect(PHOTO_TRIES).toEqual({ max: 20, windowMs: 86_400_000 });
    const from = { "X-Forwarded-For": "203.0.113.40" };
    for (let i = 1; i <= 20; i++) expect((await send({}, { headers: from })).status, `try ${i}`).toBe(201);
    spies.processPicture.mockClear();
    prize.saveEntry.mockClear();
    const r = await send({}, { headers: from });
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ error: "You have tried to send a lot of pictures today. Please try again tomorrow." });
    nothingDone();
  });

  // Planner's call 4: sending a picture shares the photo's daily tries.
  it("shares the day's tries with the family's photos for the doors", async () => {
    const from = { "X-Forwarded-For": "203.0.113.41" };
    for (let i = 1; i <= 20; i++) await send({}, { headers: from });
    doors.findElfDoorByPosterCode.mockImplementation(async (code: string) => (code === CODE ? { year: 2026, setup: door7() } : null));
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: RUBY, countsFrom: at("2026-12-07T19:00:00.000Z"), found: false }]);
    const photo = await call("POST", `/api/elf/p/${CODE}/photo`, { json: { ...(await entryBody()), consent: true }, headers: from });
    expect(photo.status).toBe(429);
    expect(photo.data).toEqual({ error: "You have tried to send a lot of photos today. Please try again tomorrow." });
    expect(game.sendElfPhoto).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when the entry cannot be saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prize.saveEntry.mockRejectedValue(new Error("connection lost"));
    const r = await send();
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    logged.mockRestore();
  });

  it("takes a picture only from our own pages, and only from a family that is signed in", async () => {
    const elsewhere = await send({}, { headers: { Origin: "https://elsewhere.example.org" } });
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.data).toEqual({ error: "Please use the form on our website." });
    // No cookie: the guard reads no body at all.
    const noCookie = await send({}, { cookie: null });
    expect(noCookie.status).toBe(401);
    expect(noCookie.data).toEqual({ error: "Please sign in again." });
    // A cookie the shape of a session that is not one, or a family that is no longer in.
    db.findElfSession.mockResolvedValue(null);
    expect((await send()).data).toEqual({ error: "Please sign in again." });
    db.findElfSession.mockResolvedValue({ familyId: 4 });
    const gone = await send();
    expect(gone.status).toBe(401);
    expect(gone.data).toEqual({ error: "Please sign in again." });
    nothingDone();
  });
});

// ---- the family's own picture ------------------------------------------------------------------------------

describe("the family's own picture", () => {
  it("is served for the family's own detective, privately, never kept and never sniffed", async () => {
    const r = await call("GET", `/elf/hq/entry/${RUBY}/picture.jpg`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.bytes.toString()).toBe("the picture");
    expect(prize.entryPicture).toHaveBeenCalledWith(2026, 100, 3);
  });

  it("is not found for another family's detective, and nothing is read", async () => {
    const r = await call("GET", `/elf/hq/entry/${OTHER}/picture.jpg`);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(prize.entryPicture).not.toHaveBeenCalled();
  });

  it("is not found when no picture is in, or for someone signed out", async () => {
    prize.entryPicture.mockResolvedValue(null);
    expect((await call("GET", `/elf/hq/entry/${RUBY}/picture.jpg`)).status).toBe(404);
    expect((await call("GET", `/elf/hq/entry/${RUBY}/picture.jpg`, { cookie: null })).status).toBe(404);
  });

  it("answers 500 with the game's words when it cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prize.entryPicture.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", `/elf/hq/entry/${RUBY}/picture.jpg`);
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- Detective HQ's grand prize ----------------------------------------------------------------------------

describe("Detective HQ's grand prize", () => {
  it("gives each graduate its button from Christmas Eve, reading the family's entries", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).toContain("The grand prize");
    expect(r.text).toContain('href="/elf/hq/entry/100"');
    expect(r.text).toContain('href="/elf/hq/entry/101"');
    expect(r.text).toContain("Send in your picture");
    expect(prize.familyEntries).toHaveBeenCalledWith(2026, 3);
  });

  it("says whose picture is in", async () => {
    prize.familyEntries.mockResolvedValue(new Map([[RUBY, { sentAt: at("2026-12-24T10:15:00.000Z") }]]));
    const r = await call("GET", "/elf/hq");
    expect(r.text).toContain("Detective Ruby Tinselfoot's picture is in.");
  });

  it("shows no grand prize, and reads no entries, before midnight as Christmas Eve begins", async () => {
    vi.setSystemTime(EVE_EVE);
    everyDoorDone();
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("elf-hq-prize");
    expect(prize.familyEntries).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when the family's entries cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    prize.familyEntries.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- a graduate's certificate (Task 6) ---------------------------------------------------------------------

describe("a graduate's certificate", () => {
  beforeEach(() => vi.setSystemTime(SIX_PM));

  it("is the family's own graduate's, by name in full, dated the day it is printed, private and never kept", async () => {
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.text).toContain("Graduate Elf Detective");
    expect(r.text).toContain("Detective Ruby Tinselfoot");
    expect(r.text).toContain("Class of 2026");
    expect(r.text).toContain("Badge EDS 0427");
    expect(r.text).toContain("Thursday 24 December 2026");
    expect(game.familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), SIX_PM);
  });

  it("is a sheet to print, as Elf Detective School's other prints are", async () => {
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(r.text).toContain("Print or save as PDF");
    expect(r.text).toContain("@page{size:A4 landscape;margin:0}");
  });

  it("shows the graduate's own elf, made on the server in the wardrobe that all 24 doors have earned", async () => {
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(png.elfPng).toHaveBeenCalledWith(null, { doors: [...EVERY_DOOR] }, 340);
    expect(r.text).toContain(`<img src="${elfData()}" alt="Detective Ruby Tinselfoot's elf" width="340" height="510">`);
  });

  it("names a detective in full to their own family, one whose first name staff have not ticked included", async () => {
    const r = await call("GET", `/elf/hq/certificate/${LEO}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain("Detective Leo Frostwhistle");
  });

  it("is not found for a detective who has done 23 doors, for another family's, or for no detective at all, and no elf is made", async () => {
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR.slice(0, 23)));
    const notYet = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(notYet.status).toBe(404);
    expect(notYet.headers.get("cache-control")).toBe("private, no-store");
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR));
    for (const id of [String(OTHER), "0", "abc", "100.5", "12345678901"]) expect((await call("GET", `/elf/hq/certificate/${id}`)).status, id).toBe(404);
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("sends someone signed out to sign in, as Detective HQ's other pages do", async () => {
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`, { cookie: null });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/sign-in");
  });

  it("answers busy, to try again in a moment, when the elf's picture cannot be made just now", async () => {
    png.elfPng.mockResolvedValue(null);
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.text).toBe(BUSY);
  });

  it("answers 500 with the game's words when the family's doors cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyDoorsDone.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", `/elf/hq/certificate/${RUBY}`);
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- a graduate's share card (Task 6) ----------------------------------------------------------------------

describe("a graduate's share card", () => {
  beforeEach(() => vi.setSystemTime(SIX_PM));

  it("is a PNG made on the server for the family's own graduate, private, never kept, and saved by its own name", async () => {
    const r = await call("GET", `/elf/hq/share/${RUBY}.png`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="elf-detective-school-graduate.png"');
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    const meta = await sharp(r.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 1200, 630]);
  });

  it("draws the graduate's rank, doors done and class, with their own elf", async () => {
    await call("GET", `/elf/hq/share/${RUBY}.png`);
    expect(png.elfPng).toHaveBeenCalledWith(null, { doors: [...EVERY_DOOR] }, 340);
    expect(spies.shareCardSvg).toHaveBeenCalledWith({ detective: { firstName: "Ruby", surname: "Tinselfoot", approved: true }, rank: "Graduate", doorsDone: 24, year: 2026 }, elfData());
  });

  // Ruling F11: the card is made to be shared, so it names a detective only as the public sees them.
  it("names a detective whose first name staff have not ticked by its first letter only", async () => {
    const r = await call("GET", `/elf/hq/share/${LEO}.png`);
    expect(r.status).toBe(200);
    expect(spies.shareCardSvg.mock.calls[0][0].detective).toEqual({ firstName: "Leo", surname: "Frostwhistle", approved: false });
    const svg = String(spies.shareCardSvg.mock.results[0].value);
    expect(svg).toContain('aria-label="NBCC Elf Detective School: Detective L. Frostwhistle, Graduate"');
    // Its words, without the pictures' data, whose letters are anything at all.
    expect(svg.replace(/href="[^"]*"/g, "")).not.toContain("Leo");
  });

  it("is not found for a detective who has done 23 doors, for another family's, or for an address that is not a card's", async () => {
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR.slice(0, 23)));
    expect((await call("GET", `/elf/hq/share/${RUBY}.png`)).status).toBe(404);
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR));
    for (const file of [`${OTHER}.png`, `${RUBY}.jpg`, String(RUBY), "abc.png", `${RUBY}.png.png`, "0.png", "12345678901.png"]) {
      const r = await call("GET", `/elf/hq/share/${file}`);
      expect(r.status, file).toBe(404);
      expect(r.headers.get("cache-control"), file).toBe("private, no-store");
    }
    expect(png.elfPng).not.toHaveBeenCalled();
    expect(spies.shareCardSvg).not.toHaveBeenCalled();
  });

  it("is not found for someone signed out, and makes nothing", async () => {
    expect((await call("GET", `/elf/hq/share/${RUBY}.png`, { cookie: null })).status).toBe(404);
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("answers busy, to try again in a moment, when the elf's picture cannot be made just now", async () => {
    png.elfPng.mockResolvedValue(null);
    const r = await call("GET", `/elf/hq/share/${RUBY}.png`);
    expect(r.status).toBe(503);
    expect(r.headers.get("retry-after")).toBe("2");
    expect(r.text).toBe(BUSY);
    expect(spies.shareCardSvg).not.toHaveBeenCalled();
  });

  // The card is made in turn with the elves' pictures (inTurn, src/elf/elf-png.ts), so the one small task never
  // makes two at once, and it is told busy at once while too many are already waiting.
  it("takes its turn with the other pictures, and answers busy while too many are already waiting", async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((go) => (open = go));
    const waiting = Array.from({ length: ELF_PNG_QUEUE_MAX + 1 }, () => inTurn(() => gate, undefined));
    try {
      const r = await call("GET", `/elf/hq/share/${RUBY}.png`);
      expect(r.status).toBe(503);
      expect(r.headers.get("retry-after")).toBe("2");
      expect(r.text).toBe(BUSY);
    } finally {
      open();
      await Promise.all(waiting);
    }
    expect((await call("GET", `/elf/hq/share/${RUBY}.png`)).status).toBe(200);
  });

  it("answers 500 with the game's words when the family's doors cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyDoorsDone.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", `/elf/hq/share/${RUBY}.png`);
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- the graduates' video (Task 6, ruling F10) -------------------------------------------------------------

describe("the graduates' video", () => {
  beforeEach(() => {
    vi.setSystemTime(SIX_PM);
    db.getElfSettings.mockResolvedValue({ ...ON, graduateVideoUrl: VIDEO });
  });

  // Detective HQ links only to this site, so the video's link goes through Detective HQ's own address.
  it("sends a signed in family with a graduate on to the video, telling the video's site nothing of where it came from", async () => {
    const r = await call("GET", "/elf/hq/video");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(VIDEO);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("is not found while no video link is set", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, graduateVideoUrl: null });
    const r = await call("GET", "/elf/hq/video");
    expect(r.status).toBe(404);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is not found for a family none of whose detectives has done all 24 doors", async () => {
    doors.listElfDoors.mockResolvedValue(snowedIn(EVERY_DOOR.slice(0, 23)));
    const r = await call("GET", "/elf/hq/video");
    expect(r.status).toBe(404);
    expect(r.headers.get("location")).toBeNull();
  });

  it("is not found for someone signed out, or for a family that is no longer in, and reads none of their doors", async () => {
    expect((await call("GET", "/elf/hq/video", { cookie: null })).status).toBe(404);
    db.findElfSession.mockResolvedValue({ familyId: 4 });
    expect((await call("GET", "/elf/hq/video")).status).toBe(404);
    expect(game.familyDoorsDone).not.toHaveBeenCalled();
  });

  it("never sends anyone to a stored link that is not an https one", async () => {
    for (const stored of ["http://example.org/graduates", "javascript:alert(1)", "//example.org/graduates", " "]) {
      db.getElfSettings.mockResolvedValue({ ...ON, graduateVideoUrl: stored });
      const r = await call("GET", "/elf/hq/video");
      expect(r.status, stored).toBe(404);
      expect(r.headers.get("location"), stored).toBeNull();
    }
  });

  it("answers 500 with the game's words when the family's doors cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyDoorsDone.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/elf/hq/video");
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- Detective HQ's graduates (Task 6) ---------------------------------------------------------------------

describe("Detective HQ's graduates", () => {
  beforeEach(() => vi.setSystemTime(SIX_PM));

  it("gives each graduate their certificate and share card, and the graduates' video once a head elf has set it", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, graduateVideoUrl: VIDEO });
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    for (const id of [RUBY, LEO]) {
      expect(r.text).toContain(`href="/elf/hq/certificate/${id}"`);
      expect(r.text).toContain(`href="/elf/hq/share/${id}.png" download`);
    }
    expect(r.text).toContain('href="/elf/hq/video"');
    // Only Detective HQ's own address for the video goes on the page, never the video's link itself.
    expect(r.text).not.toContain(VIDEO);
  });

  it("has no video link while none is set", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.text).toContain(`href="/elf/hq/certificate/${RUBY}"`);
    expect(r.text).not.toContain("/elf/hq/video");
  });
});

// ---- the emails a family can stop (Task 7) ----------------------------------------------------------------------
//
// The link at the foot of a clue email, a promotion or a graduation opens GET /elf/emails/:token, which asks; only
// its button (POST /elf/emails/:token) changes the family's switch. Detective HQ has the same switch for a signed in
// family (POST /api/elf/emails). The link answers while Elf Detective School is on, whatever December's doors say,
// so a family can always stop the emails it has had (ruling F16 for the checks).

const STOPPING = "Stop the emails from Elf Detective School? You will not get each door's first clue, or the emails when a detective is promoted or graduates. Everything stays in Detective HQ.";
const STOPPED_ALREADY = "You have stopped the emails from Elf Detective School. Everything is still in Detective HQ.";
const DONE_STOPPED = "Done. We will not send you these emails any more.";
const DONE_STARTED = "Done. They will start again with the next clue.";
const NOT_OURS = "Please use the form on our website.";
const LINK = `/elf/emails/${EMAILS_TOKEN}`;

describe("the page the link to stop the emails opens", () => {
  it("is the family's own switch, private, never kept and never listed, and asks before it stops anything", async () => {
    const r = await call("GET", LINK, { cookie: null });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.text).toContain("<title>Your emails | Night Before Christmas Campaign</title>");
    expect(r.text).toContain(STOPPING);
    expect(r.text).toContain(`<form class="elf-emails" method="post" action="${LINK}">`);
    expect(r.text).toContain('<input type="hidden" name="stopped" value="yes" />');
    expect(db.familyByEmailsToken).toHaveBeenCalledWith(EMAILS_TOKEN);
    // Following a link never changes anything.
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("says the emails are stopped, with the button to start them again", async () => {
    db.familyByEmailsToken.mockResolvedValue({ id: 3, stopped: true });
    const r = await call("GET", LINK, { cookie: null });
    expect(r.text).toContain(STOPPED_ALREADY);
    expect(r.text).toContain('<input type="hidden" name="stopped" value="no" />');
    expect(r.text).toContain("Start them again");
  });

  it("shows nothing of the family", async () => {
    const r = await call("GET", LINK, { cookie: null });
    for (const theirs of ["Sam", "sam.example@example.com", "Ruby", "Tinselfoot"]) expect(r.text, theirs).not.toContain(theirs);
  });

  it("is not found for a token that is no family's, private and never listed", async () => {
    const r = await call("GET", "/elf/emails/fedcba9876543210fedcba9876543210", { cookie: null });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("answers while Elf Detective School is on, whatever December's doors say", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    const r = await call("GET", LINK, { cookie: null });
    expect(r.status).toBe(200);
    expect(r.text).toContain(STOPPING);
  });

  it("is not found while Elf Detective School is switched off, and reads no family", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, schoolOn: false });
    expect((await call("GET", LINK, { cookie: null })).status).toBe(404);
    expect(db.familyByEmailsToken).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when the family cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.familyByEmailsToken.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", LINK, { cookie: null });
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

describe("the button on the page the link opens", () => {
  const press = (stopped: string | undefined, ask: Ask = {}, link = LINK) => call("POST", link, { cookie: null, form: stopped === undefined ? {} : { stopped }, ...ask });

  it("stops the emails with stopped=yes, and says so, with the button turned round", async () => {
    const r = await press("yes");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(db.setEmailsStopped).toHaveBeenCalledWith(3, true);
    expect(r.text).toContain(DONE_STOPPED);
    expect(r.text).toContain('<input type="hidden" name="stopped" value="no" />');
    expect(r.text).toContain("Start them again");
  });

  it("starts them again with stopped=no, and says so", async () => {
    db.familyByEmailsToken.mockResolvedValue({ id: 3, stopped: true });
    const r = await press("no");
    expect(r.status).toBe(200);
    expect(db.setEmailsStopped).toHaveBeenCalledWith(3, false);
    expect(r.text).toContain(DONE_STARTED);
    expect(r.text).toContain('<input type="hidden" name="stopped" value="yes" />');
  });

  it("is refused from a page that is not ours, with nothing read or changed", async () => {
    const r = await press("yes", { headers: { Origin: "https://elsewhere.example.org" } });
    expect(r.status).toBe(403);
    expect(r.text).toBe(NOT_OURS);
    expect(db.familyByEmailsToken).not.toHaveBeenCalled();
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  // Ruling F16.
  it("is not found for a token that is no family's, with nothing changed", async () => {
    const r = await press("yes", {}, "/elf/emails/fedcba9876543210fedcba9876543210");
    expect(r.status).toBe(404);
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("changes nothing for a choice that is not yes or no, and draws the page as it stands", async () => {
    for (const stopped of [undefined, "", "maybe", "YES", "true"]) {
      const r = await press(stopped);
      expect(r.status, String(stopped)).toBe(400);
      expect(r.text).toContain(STOPPING);
      expect(r.text).not.toContain("Done.");
    }
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("works while December's doors are off, so a family can always stop the emails it has had", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    expect((await press("yes")).status).toBe(200);
    expect(db.setEmailsStopped).toHaveBeenCalledWith(3, true);
  });

  it("is not found while Elf Detective School is switched off, with nothing changed", async () => {
    db.getElfSettings.mockResolvedValue({ ...ON, schoolOn: false });
    expect((await press("yes")).status).toBe(404);
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when the switch cannot be saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.setEmailsStopped.mockRejectedValue(new Error("connection lost"));
    const r = await press("yes");
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

describe("Detective HQ's switch, posted", () => {
  const post = (body: { json?: unknown; form?: Record<string, string> }, ask: Ask = {}) => call("POST", "/api/elf/emails", { ...body, ...ask });

  it("starts the emails again from the script's { stopped: false }, answering what it did, privately", async () => {
    const r = await post({ json: { stopped: false } });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, stopped: false });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(db.setEmailsStopped).toHaveBeenCalledWith(3, false);
  });

  it("stops them from { stopped: true }", async () => {
    const r = await post({ json: { stopped: true } });
    expect(r.data).toEqual({ ok: true, stopped: true });
    expect(db.setEmailsStopped).toHaveBeenCalledWith(3, true);
  });

  it("takes the plain form's stopped=yes or stopped=no, and goes back to Detective HQ", async () => {
    const yes = await post({ form: { stopped: "yes" } });
    expect(yes.status).toBe(303);
    expect(yes.headers.get("location")).toBe("/elf/hq");
    expect(db.setEmailsStopped).toHaveBeenLastCalledWith(3, true);
    const no = await post({ form: { stopped: "no" } });
    expect(no.status).toBe(303);
    expect(db.setEmailsStopped).toHaveBeenLastCalledWith(3, false);
  });

  // Ruling F16.
  it("is refused from a page that is not ours, with nothing changed", async () => {
    const r = await post({ json: { stopped: true } }, { headers: { Origin: "https://elsewhere.example.org" } });
    expect(r.status).toBe(403);
    expect(r.data).toEqual({ error: NOT_OURS });
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("asks someone signed out to sign in, with nothing changed", async () => {
    const json = await post({ json: { stopped: true } }, { cookie: null });
    expect(json.status).toBe(401);
    expect(json.data).toEqual({ error: "Please sign in again." });
    const form = await post({ form: { stopped: "yes" } }, { cookie: null });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/elf/sign-in");
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("changes nothing for a choice that is not one", async () => {
    for (const json of [{}, { stopped: "yes" }, { stopped: 1 }, { stopped: null }]) {
      const r = await post({ json });
      expect(r.status, JSON.stringify(json)).toBe(400);
      expect(r.data).toEqual({ error: NOT_OURS });
    }
    for (const stopped of ["", "maybe", "true"]) expect((await post({ form: { stopped } })).status, stopped).toBe(400);
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when the switch cannot be saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.setEmailsStopped.mockRejectedValue(new Error("connection lost"));
    const r = await post({ json: { stopped: true } });
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    logged.mockRestore();
  });
});

describe("Detective HQ's switch for the emails", () => {
  it("is last on the page while December's doors are on, posting to the signed in switch", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).toContain('class="section elf-hq-emails"');
    expect(r.text).toContain("We email you when each door's first clue comes out, and when a detective is promoted or graduates.");
    expect(r.text).toContain('<form class="elf-emails" method="post" action="/api/elf/emails">');
    expect(r.text).toContain('<input type="hidden" name="stopped" value="yes" />');
    expect(r.text.indexOf("elf-hq-emails")).toBeGreaterThan(r.text.indexOf("elf-hq-marks"));
  });

  it("says the emails are stopped for a family that has stopped them, and never puts the family's own token on the page", async () => {
    db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? { ...FAMILY, emailsStopped: true, emailsToken: EMAILS_TOKEN } : null));
    const r = await call("GET", "/elf/hq");
    expect(r.text).toContain("You have stopped these emails. Everything is still here in Detective HQ.");
    expect(r.text).toContain('<input type="hidden" name="stopped" value="no" />');
    expect(r.text).toContain("Start them again");
    expect(r.text).not.toContain(EMAILS_TOKEN);
  });

  // Review Focus 5: the switch is in Detective HQ's view only while December's doors are on.
  it("is in hqViewFor's view only while December's doors are on, read from the family's row", () => {
    const view = (settings: typeof ON, family: typeof FAMILY & { emailsStopped?: boolean }) =>
      hqViewFor({ family, settings, now: EVE_10_30, runs: { runs: [], practice: null }, guesses: new Map(), typed: new Set(), doorsDone: new Map(), finders: new Map(), photos: [], entries: new Map() });
    expect(view(ON, { ...FAMILY, emailsStopped: true }).emails).toEqual({ stopped: true, url: "/api/elf/emails" });
    expect(view(ON, { ...FAMILY, emailsStopped: false }).emails).toEqual({ stopped: false, url: "/api/elf/emails" });
    // A family row built by hand, with no switch read, has the emails on.
    expect(view(ON, FAMILY).emails).toEqual({ stopped: false, url: "/api/elf/emails" });
    expect(view(OFF, { ...FAMILY, emailsStopped: true }).emails).toBeNull();
  });
});

// ---- with December's doors off (Review Focus 5) ------------------------------------------------------------

describe("with December's doors off", () => {
  // A video link set, so the switch alone keeps the video shut.
  beforeEach(() => db.getElfSettings.mockResolvedValue({ ...OFF, graduateVideoUrl: VIDEO }));

  const asks = (cookie?: string): [string, string, Ask][] => [
    ["GET", `/elf/hq/entry/${RUBY}`, { cookie }],
    ["POST", `/api/elf/entry/${RUBY}`, { cookie }],
    ["GET", `/elf/hq/entry/${RUBY}/picture.jpg`, { cookie }],
    ["GET", `/elf/hq/certificate/${RUBY}`, { cookie }],
    ["GET", `/elf/hq/share/${RUBY}.png`, { cookie }],
    ["GET", "/elf/hq/video", { cookie }],
  ];

  it("has no entry page, takes no picture and serves none, gives no certificate, share card or video, and reads nothing of the family's entries", async () => {
    for (const [method, path, ask] of asks()) {
      const r = await call(method, path, method === "POST" ? { ...ask, json: await entryBody() } : ask);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    for (const f of Object.values(prize)) expect(f).not.toHaveBeenCalled();
    expect(spies.processPicture).not.toHaveBeenCalled();
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("lets no browser through with the preview link either: its pass opens the practice door only", async () => {
    practice.getPractice.mockResolvedValue(practiceRow());
    // Every door reported done, so the switch alone keeps each route shut.
    everyDoorDone();
    for (const [method, path, ask] of asks(PRACTICE_PASS)) {
      const r = await call(method, path, method === "POST" ? { ...ask, json: await entryBody() } : ask);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    for (const f of Object.values(prize)) expect(f).not.toHaveBeenCalled();
    expect(spies.processPicture).not.toHaveBeenCalled();
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("shows no grand prize in Detective HQ, and reads no entries", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("elf-hq-prize");
    expect(r.text).not.toContain("grand prize");
    expect(prize.familyEntries).not.toHaveBeenCalled();
  });

  it("gives a detective with every door done no certificate, share card or video in Detective HQ", async () => {
    everyDoorDone();
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).toContain("All 24 doors done");
    for (const gone of ["/elf/hq/certificate/", "/elf/hq/share/", "/elf/hq/video", "elf-detective__graduate"]) expect(r.text, gone).not.toContain(gone);
  });

  // Task 7, ruling F16: Detective HQ's switch is not found while December's doors are off, whatever the preview link
  // says, and changes nothing.
  it("takes no post to Detective HQ's emails switch, with or without the preview link", async () => {
    practice.getPractice.mockResolvedValue(practiceRow());
    for (const cookie of [undefined, PRACTICE_PASS]) {
      for (const body of [{ json: { stopped: true } }, { form: { stopped: "yes" } }]) {
        const r = await call("POST", "/api/elf/emails", { cookie, ...body });
        expect(r.status, `${cookie ?? "signed in"} ${JSON.stringify(body)}`).toBe(404);
      }
    }
    expect(db.setEmailsStopped).not.toHaveBeenCalled();
  });

  // Task 7: no emails switch in Detective HQ, even for a browser with the preview link.
  it("has no emails switch in Detective HQ, with or without the preview link", async () => {
    db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? { ...FAMILY, emailsStopped: true, emailsToken: EMAILS_TOKEN } : null));
    for (const cookie of [undefined, PRACTICE_PASS]) {
      const r = await call("GET", "/elf/hq", { cookie });
      expect(r.status).toBe(200);
      for (const gone of ["elf-hq-emails", "Your emails", "/api/elf/emails", "Stop these emails", "Start them again"]) expect(r.text, gone).not.toContain(gone);
    }
  });
});

// ---- how the app mounts the entry post ---------------------------------------------------------------------

describe("how the app mounts the entry post", () => {
  // Read from the source: the app itself needs a whole environment to start.
  const app = readFileSync(resolve(__dirname, "../../src/app.ts"), "utf8");
  const where = (s: string) => app.indexOf(s);

  it("reads the picture's bigger body only on the entry's own address, behind the cookie guard, before the usual parser", () => {
    expect(ELF_ENTRY_POST_PATH).toBe("/api/elf/entry/:detective");
    expect(where("app.use(ELF_ENTRY_POST_PATH, elfPhotoBodyGuard(express.json({ limit: PICTURE_JSON_BODY_LIMIT })));")).toBeGreaterThan(-1);
    expect(where("app.use(ELF_ENTRY_POST_PATH")).toBeLessThan(where("app.use(express.json());"));
  });

  it("takes a picture bigger than the usual parser allows", async () => {
    const r = await send({ padding: "x".repeat(200 * 1024) });
    expect(r.status).toBe(201);
  });
});
