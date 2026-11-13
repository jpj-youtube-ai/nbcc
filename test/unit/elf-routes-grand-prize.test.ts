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

const db = vi.hoisted(() => ({ getElfSettings: vi.fn(), findElfSession: vi.fn(), familyWithDetectives: vi.fn() }));
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
// The real picture processing, watched.
const spies = vi.hoisted(() => ({}) as { processPicture: Mock });

vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf-practice", () => practice);
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-game")>()), ...game }));
vi.mock("../../src/db/elf-grand-prize", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-grand-prize")>()), ...prize }));
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

import { elfPhotoBodyGuard, elfRouter, ELF_ENTRY_POST_PATH, ELF_PHOTO_POST_PATH, PHOTO_TRIES, resetElfLimits, resetPublicCalendar } from "../../src/routes/elf";
import { PICTURE_JSON_BODY_LIMIT } from "../../src/routes/fundraiser-pictures";
import { MOBILE_WORDS } from "../../src/elf/join";
import { tinyJpeg } from "./fixtures/tiny-jpeg";
import { at, callerAt, CODE, door7, doorsDoneFromRuns, EVE_10_30, EVERY_DOOR, FAMILY, OFF, ON, PRACTICE_PASS, practiceRow, snowedIn, type Ask } from "./elf-routes-fixtures";

const FOUR_59_59 = at("2026-12-24T16:59:59.000Z");
const FIVE_PM = at("2026-12-24T17:00:00.000Z");
/** A minute before midnight as Christmas Eve begins, when the entries are not open yet. */
const EVE_EVE = at("2026-12-23T23:59:00.000Z");
const WORDS = "Something went wrong just now. Please try again in a few minutes.";
const THANKS = "Thank you! Detective Ruby Tinselfoot's picture is in. You can change it until 5pm on Christmas Eve.";
const CLOSED = "Grand prize entries closed at 5pm on Christmas Eve.";
/** Family 3's detectives: Ruby and Leo. Detective 999 is another family's. */
const RUBY = 100;
const OTHER = 999;

let server: Server;
let base = "";
beforeAll(async () => {
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
  for (const group of [db, doors, practice, game, prize]) for (const f of Object.values(group)) f.mockReset();
  spies.processPicture.mockClear();
  resetPublicCalendar();
  resetElfLimits();
  db.getElfSettings.mockResolvedValue(ON);
  db.findElfSession.mockResolvedValue({ familyId: 3 });
  db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? FAMILY : null));
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

// ---- with December's doors off (Review Focus 5) ------------------------------------------------------------

describe("with December's doors off", () => {
  beforeEach(() => db.getElfSettings.mockResolvedValue(OFF));

  const asks = (cookie?: string): [string, string, Ask][] => [
    ["GET", `/elf/hq/entry/${RUBY}`, { cookie }],
    ["POST", `/api/elf/entry/${RUBY}`, { cookie }],
    ["GET", `/elf/hq/entry/${RUBY}/picture.jpg`, { cookie }],
  ];

  it("has no entry page, takes no picture and serves none, and reads nothing of the family's entries", async () => {
    for (const [method, path, ask] of asks()) {
      const r = await call(method, path, method === "POST" ? { ...ask, json: await entryBody() } : ask);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    for (const f of Object.values(prize)) expect(f).not.toHaveBeenCalled();
    expect(spies.processPicture).not.toHaveBeenCalled();
  });

  it("lets no browser through with the preview link either: its pass opens the practice door only", async () => {
    practice.getPractice.mockResolvedValue(practiceRow());
    for (const [method, path, ask] of asks(PRACTICE_PASS)) {
      const r = await call(method, path, method === "POST" ? { ...ask, json: await entryBody() } : ask);
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    for (const f of Object.values(prize)) expect(f).not.toHaveBeenCalled();
    expect(spies.processPicture).not.toHaveBeenCalled();
  });

  it("shows no grand prize in Detective HQ, and reads no entries", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("elf-hq-prize");
    expect(r.text).not.toContain("grand prize");
    expect(prize.familyEntries).not.toHaveBeenCalled();
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
