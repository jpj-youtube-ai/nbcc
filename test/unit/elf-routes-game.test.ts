import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach, type Mock } from "vitest";
import express, { type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// NBCC Elf Detective School wave 2: the family's routes for the doors in December (the poster page,
// the word, the guess, the family's photo and the pictures), driven over HTTP through the real router
// and body parsers, with the database mocked. The doors are built by the real loaders (runOf,
// waveOneRuns, runsFor) from the mocked door rows, so what a route serves is what a family would see.
// The clock is 5:47pm on Monday 7 December 2026 unless a test says otherwise: door 7's clues come out
// at 5:30pm, 6pm and 6:30pm, and its place is shown at 7pm. Every family, place, clue and word here is
// invented.

const db = vi.hoisted(() => ({ getElfSettings: vi.fn(), findElfSession: vi.fn(), familyWithDetectives: vi.fn(), saveLook: vi.fn() }));
const doors = vi.hoisted(() => ({ listElfDoors: vi.fn(), getElfDoor: vi.fn(), findElfDoorByPosterCode: vi.fn(), ensureElfDoors: vi.fn() }));
const practice = vi.hoisted(() => ({ getPractice: vi.fn(), markPracticeFound: vi.fn(), clearPractice: vi.fn(), startPractice: vi.fn(), inTransaction: vi.fn() }));
const game = vi.hoisted(() => ({
  markAutomaticSnowDays: vi.fn(),
  saveGuess: vi.fn(),
  familyGuesses: vi.fn(),
  takeWordTry: vi.fn(),
  giveBackWordTry: vi.fn(),
  familyHasWon: vi.fn(),
  recordWord: vi.fn(),
  familyVisits: vi.fn(),
  finderParts: vi.fn(),
  familyDoorsDone: vi.fn(),
  detectiveDoorsDone: vi.fn(),
  doorCounts: vi.fn(),
  doorScrapbook: vi.fn(),
  sendElfPhoto: vi.fn(),
  familyPhoto: vi.fn(),
  takeDownOwnPhoto: vi.fn(),
  approvedPhoto: vi.fn(),
  visitElf: vi.fn(),
  cluePicture: vi.fn(),
}));
const png = vi.hoisted(() => ({ elfPng: vi.fn(), elfPngKey: vi.fn() }));
// The real functions, watched: the loader every family route reads through, the word's rule, the
// picture processing, Detective HQ's view and the gold card.
const spies = vi.hoisted(() => ({}) as { runsFor: Mock; decideWord: Mock; processPicture: Mock; hqViewFor: Mock; claimWinHtml: Mock });

vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf-practice", () => practice);
vi.mock("../../src/db/elf-game", async (orig) => {
  const real = await orig<typeof import("../../src/db/elf-game")>();
  spies.runsFor = vi.fn(real.runsFor);
  return { ...real, ...game, runsFor: spies.runsFor };
});
vi.mock("../../src/elf/claim", async (orig) => {
  const real = await orig<typeof import("../../src/elf/claim")>();
  spies.decideWord = vi.fn(real.decideWord);
  return { ...real, decideWord: spies.decideWord };
});
vi.mock("../../src/fundraising/picture-process", async (orig) => {
  const real = await orig<typeof import("../../src/fundraising/picture-process")>();
  spies.processPicture = vi.fn(real.processPicture);
  return { ...real, processPicture: spies.processPicture };
});
vi.mock("../../src/elf/views", async (orig) => {
  const real = await orig<typeof import("../../src/elf/views")>();
  spies.hqViewFor = vi.fn(real.hqViewFor);
  return { ...real, hqViewFor: spies.hqViewFor };
});
vi.mock("../../src/elf/pages/poster", async (orig) => {
  const real = await orig<typeof import("../../src/elf/pages/poster")>();
  spies.claimWinHtml = vi.fn(real.claimWinHtml);
  return { ...real, claimWinHtml: spies.claimWinHtml };
});
vi.mock("../../src/elf/elf-png", () => png);
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { pool } from "../../src/db/pool";
import {
  DOOR_ELVES_KEPT,
  doorsOn,
  elfPhotoBodyGuard,
  elfRouter,
  ELF_PHOTO_POST_PATH,
  GUESS_LIMIT,
  PHOTO_TRIES,
  resetDoorElves,
  resetElfLimits,
  resetPublicCalendar,
  WORD_ADDRESS_LIMIT,
  WORD_LIMIT,
} from "../../src/routes/elf";
import { PICTURE_JSON_BODY_LIMIT } from "../../src/routes/fundraiser-pictures";
import { waveOneRuns, type DoorRun } from "../../src/db/elf-game";
import { emptyDoor, type DoorClue, type DoorSetup } from "../../src/elf/door-setup";
import { doorState } from "../../src/elf/doors";
import { calendarViewFor, hqViewFor } from "../../src/elf/views";
import { doorDetail, doorTile } from "../../src/elf/pages/door";
import { renderHqPage } from "../../src/elf/pages/hq";
import sharp from "sharp";
import { normalisePlaceName } from "../../src/elf/place-names";
import { defaultLook } from "../../src/elf/wardrobe";
import { ELF_NAMES } from "../../src/elf/names";
import { PRACTICE_CLUES } from "../../src/elf/practice-words";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { tinyJpeg } from "./fixtures/tiny-jpeg";

const at = (iso: string) => new Date(iso);
const THREE = at("2026-12-07T15:00:00.000Z");
const FIVE_47 = at("2026-12-07T17:47:00.000Z");
const SIX_10 = at("2026-12-07T18:10:00.000Z");
const SEVEN = at("2026-12-07T19:00:00.000Z");
const SEVEN_05 = at("2026-12-07T19:05:00.000Z");

const PREVIEW_TOKEN = "c".repeat(64);
const ON = {
  ...ELF_DEFAULTS,
  schoolOn: true,
  year: 2026,
  previewHash: createHash("sha256").update(`elf:${PREVIEW_TOKEN}`).digest("hex"),
  doorsOn: true,
};
/** December's doors switched off: the school is live, the doors are wave 1's. */
const OFF = { ...ON, doorsOn: false };

const SESSION = `nbcc_elf_session=${"a".repeat(40)}`;
const PRACTICE_PASS = `${SESSION}; nbcc_elf_preview=${PREVIEW_TOKEN}`;

const FAMILY = {
  id: 3,
  grownUpName: "Sam Example",
  email: "sam.example@example.com",
  detectives: [
    { id: 100, firstName: "Ruby", surname: "Tinselfoot", nameApproved: true, badgeNumber: 427, look: null, fresh: [], favourites: [] },
    { id: 101, firstName: "Leo", surname: "Frostwhistle", nameApproved: false, badgeNumber: 428, look: null, fresh: [], favourites: [] },
  ],
};

const CODE = "abcdefghijkm"; // door 7's poster
const PRACTICE_CODE = "pqrstuvwxyz2";
const TOKEN = "q2w3e4r5t6y7"; // a photo's address
const TYPED_ELF = "Wigglepop"; // a name a head elf typed for door 7

const clue = (n: 1 | 2 | 3, words: string, hasPicture = false): DoorClue => ({ n, words, hasPicture, pictureAlt: hasPicture ? "A pretend picture" : null });

function door7(over: Partial<DoorSetup> = {}): DoorSetup {
  return {
    ...emptyDoor(7, CODE),
    placeName: "The Example Bakehouse",
    placeTown: "Exampleton",
    closesAt: "20:30",
    prize: "A pretend sledge",
    elfName: TYPED_ELF,
    tagWord: "SNOWBALL 472",
    names: [{ id: 1, name: "Example Bakes" }],
    clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two", true), clue(3, "Pretend clue three")],
    ...over,
  };
}

/** Door 6, found on Sunday morning and open since. */
const door6 = (): DoorSetup => ({
  ...emptyDoor(6, "c3d4e5f6g7h8"),
  placeName: "The Example Mill",
  placeTown: "Exampleton",
  tagWord: "PUDDING 316",
  clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two"), clue(3, "Pretend clue three")],
  foundAt: at("2026-12-06T10:20:00.000Z"),
  foundFamilyId: 9,
});

/** Door 3, found last Thursday: its place is open, by both its names. */
const door3 = (): DoorSetup => ({
  ...emptyDoor(3, "zyxwvutsrqpn"),
  placeName: "The Old Example Mill",
  placeTown: "Exampleton",
  tagWord: "TINSEL 828",
  names: [{ id: 2, name: "Example Mill" }],
  clues: [clue(1, "Pretend clue one"), clue(2, "Pretend clue two"), clue(3, "Pretend clue three")],
  foundAt: at("2026-12-03T17:50:00.000Z"),
  foundFamilyId: 9,
});

/** A practice evening a head elf started at 5:58pm, its clues three minutes apart. */
const practiceRow = (over: Record<string, unknown> = {}) => ({
  startedAt: at("2026-12-07T17:58:00.000Z"),
  startedBy: "admin:staff@example.org",
  placeName: "The Example Office",
  placeTown: "Exampleton",
  elfName: "Tinsel",
  tagWord: "TINSEL 314",
  posterCode: PRACTICE_CODE,
  clue1At: at("2026-12-07T17:59:00.000Z"),
  clue2At: at("2026-12-07T18:02:00.000Z"),
  clue3At: at("2026-12-07T18:05:00.000Z"),
  revealAt: at("2026-12-07T18:20:00.000Z"),
  foundAt: null,
  foundFamilyId: null,
  ...over,
});

/** familyDoorsDone as the database would answer it: no cracks or visits, and the snowed in doors of
 *  the runs it is given (as the real one works them out). */
async function doorsDoneFromRuns(_year: number, _familyId: number, runs: DoorRun[], now: Date) {
  const snow = runs.filter((r) => r.door > 0 && doorState(r.facts, now) === "snow").map((r) => r.door);
  return new Map(FAMILY.detectives.map((d) => [d.id, { cracked: [], visited: [], snow }]));
}

const gameCalls = () =>
  [game.takeWordTry, game.recordWord, game.saveGuess, game.sendElfPhoto, game.takeDownOwnPhoto, game.approvedPhoto, game.visitElf, game.cluePicture, game.familyVisits].reduce(
    (n, f) => n + f.mock.calls.length,
    0,
  );

let server: Server;
let base = "";
beforeAll(async () => {
  // Mounted as src/app.ts mounts it: the photo's bigger body parser first, on its own path.
  const app = express();
  app.set("trust proxy", 1);
  app.use(ELF_PHOTO_POST_PATH, elfPhotoBodyGuard(express.json({ limit: PICTURE_JSON_BODY_LIMIT })));
  app.use(express.json());
  app.use(elfRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIVE_47);
  for (const group of [db, doors, practice, game, png]) for (const f of Object.values(group)) f.mockReset();
  for (const s of Object.values(spies)) s.mockClear();
  resetPublicCalendar();
  resetElfLimits();
  resetDoorElves();
  db.getElfSettings.mockResolvedValue(ON);
  db.findElfSession.mockResolvedValue({ familyId: 3 });
  db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? FAMILY : null));
  doors.listElfDoors.mockResolvedValue([door7()]);
  doors.getElfDoor.mockImplementation(async (_y: number, d: number) => (d === 7 ? door7() : null));
  doors.findElfDoorByPosterCode.mockImplementation(async (code: string) => (code === CODE ? { year: 2026, setup: door7() } : null));
  practice.getPractice.mockResolvedValue(null);
  game.markAutomaticSnowDays.mockResolvedValue([]);
  game.familyGuesses.mockResolvedValue(new Map());
  game.takeWordTry.mockResolvedValue(1);
  game.giveBackWordTry.mockResolvedValue(undefined);
  game.familyHasWon.mockResolvedValue(false);
  game.familyVisits.mockResolvedValue([]);
  // As the real one answers: the winner counts from now, anyone else from the later of now and the reveal.
  game.recordWord.mockImplementation(async (o: { won: boolean; at: Date; shownAt: Date; detectiveIds: number[] }) => ({
    won: o.won,
    countsFrom: o.won || o.at.getTime() >= o.shownAt.getTime() ? o.at : o.shownAt,
    stamped: o.detectiveIds,
  }));
  game.finderParts.mockResolvedValue([]);
  game.familyDoorsDone.mockImplementation(doorsDoneFromRuns);
  game.detectiveDoorsDone.mockResolvedValue({ cracked: [], visited: [], snow: [] });
  game.doorCounts.mockResolvedValue({ cracked: 0, visited: 0 });
  game.doorScrapbook.mockResolvedValue({ elves: [], photos: [], count: 0 });
  game.sendElfPhoto.mockResolvedValue({ token: TOKEN });
  game.familyPhoto.mockResolvedValue(null);
  game.takeDownOwnPhoto.mockResolvedValue(true);
  game.approvedPhoto.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("the photo") });
  game.visitElf.mockResolvedValue(null);
  game.cluePicture.mockResolvedValue({ mime: "image/png", bytes: Buffer.from("the clue picture") });
  png.elfPng.mockResolvedValue(Buffer.from("png"));
  png.elfPngKey.mockReturnValue("k1");
});
afterEach(() => vi.useRealTimers());

interface Ask {
  json?: unknown;
  form?: Record<string, string | string[]>;
  /** The cookie header: signed in unless told otherwise; null for none. */
  cookie?: string | null;
  headers?: Record<string, string>;
}

async function call(method: string, path: string, o: Ask = {}) {
  const headers: Record<string, string> = { Origin: base, ...o.headers };
  const cookie = o.cookie === undefined ? SESSION : o.cookie;
  if (cookie) headers.Cookie = cookie;
  let body: string | undefined;
  if (o.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(o.json);
  } else if (o.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(Object.entries(o.form).flatMap(([k, v]) => [v].flat().map((x) => [k, x]))).toString();
  }
  const res = await fetch(`${base}${path}`, { method, headers, body, redirect: "manual" });
  const bytes = Buffer.from(await res.arrayBuffer());
  const text = bytes.toString("utf8");
  const data = (res.headers.get("content-type") ?? "").includes("application/json") ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: res.status, headers: res.headers, text, bytes, data };
}

const word = (w: string, ids: unknown = ["100"], cookie?: string | null) => call("POST", "/api/elf/word", { json: { code: CODE, detectiveIds: ids, word: w }, cookie });
const guess = (door: unknown, text: unknown, cookie?: string | null) => call("POST", "/api/elf/guess", { json: { door, text }, cookie });

/** A res for calling a middleware directly. */
function fakeRes(locals: Record<string, unknown>) {
  const out = { statusCode: 200, body: undefined as unknown };
  const res = {
    locals,
    status(c: number) {
      out.statusCode = c;
      return res;
    },
    type() {
      return res;
    },
    send(b: unknown) {
      out.body = b;
      return res;
    },
  };
  return { res: res as unknown as Response, out };
}

// ---- December's doors switched off -------------------------------------------------------------

describe("with December's doors switched off, at 6:10pm on 7 December", () => {
  beforeEach(() => {
    vi.setSystemTime(SIX_10);
    db.getElfSettings.mockResolvedValue(OFF);
    // What a head elf has typed is in the database, ready for when the doors go on.
    doors.listElfDoors.mockResolvedValue([door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" })]);
  });

  it("doorsOn answers 404 and calls nothing", async () => {
    const { res, out } = fakeRes({ elfSettings: OFF, elfPractice: false });
    const next = vi.fn();
    await doorsOn({} as Request, res, next);
    expect(out.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
    expect(spies.runsFor).not.toHaveBeenCalled();
    expect(gameCalls()).toBe(0);
  });

  const GAME_ROUTES: [string, string, Ask?][] = [
    ["GET", `/elf/p/${CODE}`],
    ["POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "SNOWBALL 472" } }],
    ["POST", "/api/elf/word", { json: { code: CODE, detectiveIds: ["100"], word: "SNOWBALL 472" } }],
    ["POST", "/api/elf/guess", { json: { door: 7, text: "Example Bakes" } }],
    ["POST", `/api/elf/p/${CODE}/photo`, { json: { mime: "image/jpeg", dataBase64: "AAAA", consent: true } }],
    ["DELETE", `/api/elf/p/${CODE}/photo`],
    ["DELETE", "/api/elf/door/7/photo"],
    ["GET", `/elf/door/7/photo/${TOKEN}.jpg`],
    ["GET", "/elf/door/7/elf/5.png"],
    ["GET", "/elf/hq/clue/7/1.jpg"],
  ];

  it.each(GAME_ROUTES)("%s %s answers 404 to a family", async (method, path, ask) => {
    const r = await call(method, path, ask);
    expect(r.status).toBe(404);
    expect(gameCalls()).toBe(0);
  });

  it.each(GAME_ROUTES)("%s %s answers 404 to a practice browser too: its pass opens door 0 only", async (method, path, ask) => {
    practice.getPractice.mockResolvedValue(practiceRow());
    const r = await call(method, path, { ...ask, cookie: PRACTICE_PASS });
    expect(r.status).toBe(404);
    expect(gameCalls()).toBe(0);
  });

  it("serves Detective HQ through runsFor as wave 1: no clue, no snow day and no elf name a head elf typed", async () => {
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ doorsOn: false }), practice: false }));
    expect(doors.listElfDoors).not.toHaveBeenCalled();
    expect(r.text).not.toMatch(/class="elf-clue"/);
    expect(r.text).not.toContain("snowed in");
    expect(r.text).not.toContain("Snow day");
    expect(r.text).not.toContain(TYPED_ELF);
    expect(r.text).not.toContain("Pretend clue");
    expect(r.text).not.toContain("Example Bakehouse");
  });

  it("draws exactly wave 1's Detective HQ: the view hqViewFor builds from waveOneRuns, with the stock elves, and empty maps", async () => {
    const r = await call("GET", "/elf/hq");
    const runs = waveOneRuns(2026, SIX_10);
    expect(runs.map((run) => run.elfName)).toEqual([...ELF_NAMES]);
    const wave1 = hqViewFor({ family: FAMILY, settings: OFF, now: SIX_10, runs: { runs, practice: null }, guesses: new Map(), doorsDone: new Map(), finders: new Map(), photos: [] });
    // No case today with the doors off, so no elf is named at all, and, door 1's first clue having
    // passed, no next clue either: wave 1's HQ says every door is open (final review, Important 7).
    expect(wave1.today).toBeNull();
    expect(r.text).toBe(renderHqPage(wave1));
    expect(r.text).toContain("Every door is open");
  });

  it("serves the calendar through runsFor as wave 1: shut doors with the stock elves, never what a head elf typed", async () => {
    const feed = await call("GET", "/api/elf/calendar");
    expect(feed.status).toBe(200);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ doorsOn: false }), practice: false }));
    expect(doors.listElfDoors).not.toHaveBeenCalled();
    expect(game.markAutomaticSnowDays).not.toHaveBeenCalled();
    expect(feed.data.found).toBe(0);
    expect(JSON.stringify(feed.data)).not.toContain("snow");
    // Door 7 is exactly wave 1's door 7, stock elf name and all (its version hashes the name).
    const wave1 = calendarViewFor({ settings: OFF, now: SIX_10, runs: waveOneRuns(2026, SIX_10), finders: new Map(), counts: new Map(), scrapbooks: new Map() });
    const seven = wave1.doors[6];
    expect(seven.elfName).toBe(ELF_NAMES[6]);
    const r = await call("GET", "/api/elf/door/7");
    expect(r.data).toEqual({ tile: doorTile(seven, SIX_10), detail: doorDetail(seven, { now: SIX_10, joinUrl: "/elf/join", hqUrl: "/elf/hq" }) });
    const page = await call("GET", "/elf");
    expect(page.status).toBe(200);
    for (const text of [page.text, feed.text, r.text]) {
      expect(text).not.toContain(TYPED_ELF);
      expect(text).not.toContain("snowed in");
    }
  });

  it("gives the family's marks with no snow day", async () => {
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ doors: [], photos: [] });
    expect(r.text).not.toContain('"snow":true');
    expect(doors.listElfDoors).not.toHaveBeenCalled();
  });
});

// ---- the practice door with the switch off -----------------------------------------------------

describe("a practice browser with December's doors switched off, at 6:10pm", () => {
  beforeEach(() => {
    vi.setSystemTime(SIX_10);
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow());
  });

  it("is let through doorsOn", async () => {
    const { res, out } = fakeRes({ elfSettings: OFF, elfPractice: true });
    const next = vi.fn();
    await doorsOn({} as Request, res, next);
    expect(next).toHaveBeenCalled();
    expect(out.statusCode).toBe(200);
  });

  it("is let in by the preview cookie even while the school itself is on, and nobody else is", async () => {
    expect((await call("GET", `/elf/p/${PRACTICE_CODE}`, { cookie: PRACTICE_PASS })).status).toBe(200);
    expect((await call("GET", `/elf/p/${PRACTICE_CODE}`)).status).toBe(404);
    expect((await call("GET", `/elf/p/${PRACTICE_CODE}`, { cookie: `${SESSION}; nbcc_elf_preview=${"d".repeat(64)}` })).status).toBe(404);
  });

  it("opens the practice poster page, and a real door's poster page is not found", async () => {
    const r = await call("GET", `/elf/p/${PRACTICE_CODE}`, { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(r.text).toContain("The Example Office");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect((await call("GET", `/elf/p/${CODE}`, { cookie: PRACTICE_PASS })).status).toBe(404);
    expect(doors.findElfDoorByPosterCode).not.toHaveBeenCalled();
  });

  it("saves a guess for door 0 as the practice door's, year 0", async () => {
    const r = await guess(0, "the example office", PRACTICE_PASS);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, text: "the example office" });
    expect(game.saveGuess).toHaveBeenCalledWith(0, 0, 3, { text: "the example office", norm: normalisePlaceName("the example office") }, SIX_10);
  });

  it("does not take door 0 from a browser without the practice pass", async () => {
    expect((await guess(0, "the example office")).status).toBe(404);
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("shows the practice case on Detective HQ, all three clues out, with the family's practice guess", async () => {
    game.familyGuesses.mockImplementation(async (year: number) =>
      year === 0 ? new Map([[0, { text: "the example office", norm: "exampleoffice", at: at("2026-12-07T18:06:00.000Z") }]]) : new Map(),
    );
    const r = await call("GET", "/elf/hq", { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ practice: true }));
    expect(r.text).toContain("The practice door");
    expect(r.text.match(/class="elf-clue"/g)?.length).toBe(3);
    expect(r.text).toContain(PRACTICE_CLUES[0]);
    expect(r.text).toContain("Your guess: the example office.");
  });

  it("takes the practice word without asking whether the family has won this year", async () => {
    const r = await call("POST", "/api/elf/word", { json: { code: PRACTICE_CODE, detectiveIds: ["100"], word: "tinsel 314" }, cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("won");
    expect(String(r.data.html)).toContain("The practice door");
    expect(game.familyHasWon).not.toHaveBeenCalled();
    expect(game.takeWordTry).toHaveBeenCalledWith(0, 0, 3);
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ year: 0, door: 0, familyId: 3, won: true, detectiveIds: [100] }));
  });

  it("serves the practice door's approved photo once its place is shown, privately, reading only the practice door", async () => {
    // Found at 6:10pm, so the place is shown at the reveal, 6:20pm.
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    vi.setSystemTime(at("2026-12-07T18:15:00.000Z"));
    expect((await call("GET", `/elf/door/0/photo/${TOKEN}.jpg`, { cookie: PRACTICE_PASS })).status).toBe(404);
    expect(game.approvedPhoto).not.toHaveBeenCalled();
    vi.setSystemTime(at("2026-12-07T18:25:00.000Z"));
    const r = await call("GET", `/elf/door/0/photo/${TOKEN}.jpg`, { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(game.approvedPhoto).toHaveBeenCalledWith(0, 0, TOKEN);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(doors.listElfDoors).not.toHaveBeenCalled();
    expect(doors.getElfDoor).not.toHaveBeenCalled();
  });
});

// ---- the poster page --------------------------------------------------------------------------

describe("the poster page", () => {
  it("is the place's own page, private, asking someone signed out to join", async () => {
    const r = await call("GET", `/elf/p/${CODE}`, { cookie: null });
    expect(r.status).toBe(200);
    expect(r.text).toContain("The Example Bakehouse");
    expect(r.text).toContain("Join Elf Detective School");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(doors.findElfDoorByPosterCode).toHaveBeenCalledWith(CODE);
  });

  it("offers a signed in family the word, with who already has this place's candy cane", async () => {
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: 101, countsFrom: SEVEN, found: false }]);
    const r = await call("GET", `/elf/p/${CODE}`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('class="elf-word"');
    expect(r.text).toContain("Detective Leo Frostwhistle already has this candy cane.");
  });

  it("is not found for a code that is not a poster's, or one of no door this year", async () => {
    for (const bad of ["ABCDEFGHIJKM", "abcdefghijk", "abcdefghijkl", "abcdefghijkm1", "..%2Fetc"]) {
      expect((await call("GET", `/elf/p/${bad}`)).status, bad).toBe(404);
    }
    expect((await call("GET", "/elf/p/mnpqrstuvwxy")).status).toBe(404);
  });

  it("never matches another year's door with the same code", async () => {
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2025, setup: door7() });
    expect((await call("GET", `/elf/p/${CODE}`)).status).toBe(404);
  });
});

// ---- the word ---------------------------------------------------------------------------------

describe("the word on the tag", () => {
  it("wins a hunting door: the try is taken before the word is checked, and the gold card comes back", async () => {
    const r = await word("snowball 472");
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("won");
    expect(String(r.data.html)).toContain("You're first!");
    expect(String(r.data.html)).toContain("Detective Ruby Tinselfoot");
    expect(game.takeWordTry).toHaveBeenCalledWith(2026, 7, 3);
    expect(game.takeWordTry.mock.invocationCallOrder[0]).toBeLessThan(spies.decideWord.mock.invocationCallOrder[0]);
    expect(game.recordWord).toHaveBeenCalledWith({
      year: 2026,
      door: 7,
      familyId: 3,
      detectiveIds: [100],
      won: true,
      // The moment the place is shown once the elf is found now: the reveal at 7pm.
      shownAt: SEVEN,
      at: FIVE_47,
      looks: { 100: defaultLook() },
    });
    // Only a wrong word keeps the try.
    expect(game.giveBackWordTry).toHaveBeenCalledWith(2026, 7, 3);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("takes ids from the script as text against the family's numbers, end to end", async () => {
    const r = await word("SNOWBALL 472", ["101", "100"]);
    expect(r.data.outcome).toBe("won");
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ detectiveIds: [101, 100], looks: { 100: defaultLook(), 101: defaultLook() } }));
    expect(spies.decideWord.mock.calls[0][0].familyDetectiveIds).toEqual([100, 101]);
  });

  it("refuses a detective who is not the family's, and gives the try back", async () => {
    const r = await word("SNOWBALL 472", ["999"]);
    expect(r.status).toBe(400);
    expect(r.data.reason).toBe("not-your-detective");
    expect(game.recordWord).not.toHaveBeenCalled();
    expect(game.giveBackWordTry).toHaveBeenCalled();
  });

  it("is a visit, counting from 7pm, when another family's word got there first", async () => {
    game.recordWord.mockResolvedValue({ won: false, countsFrom: SEVEN, stamped: [100] });
    doors.getElfDoor.mockResolvedValue(door7({ foundAt: FIVE_47, foundFamilyId: 9 }));
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("visited");
    expect(String(r.data.html)).toContain("It counts from 7pm");
    expect(String(r.data.html)).not.toContain("You're first!");
  });

  // Final review, Important 4: the family's word for another door won in the same moment, so the
  // database refuses this claim (one prize a family). Door 7 is still unfound: this word is a visit.
  it("is a visit when the family's word for another door won in the same moment", async () => {
    game.recordWord.mockResolvedValue({ won: false, countsFrom: SEVEN, stamped: [100] });
    const r = await word("SNOWBALL 472");
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ won: true, door: 7 }));
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("visited");
    expect(String(r.data.html)).not.toContain("You're first!");
    expect(String(r.data.html)).toContain("It counts from 7pm");
  });

  it("is still the gold card when the family's own first tap won and its second lost the race", async () => {
    game.recordWord.mockResolvedValue({ won: false, countsFrom: SEVEN, stamped: [] });
    doors.getElfDoor.mockResolvedValue(door7({ foundAt: at("2026-12-07T17:46:59.000Z"), foundFamilyId: 3 }));
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("won");
    expect(String(r.data.html)).toContain("You're first!");
    expect(String(r.data.html)).toContain("Found at 5:46pm");
  });

  it("answers a wrong word with the tries left, and keeps the try", async () => {
    const r = await word("snowball 999");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "wrong-word", message: "That is not the right word. Check the tag and try again. You have 5 tries left here.", triesLeft: 5 });
    expect(game.giveBackWordTry).not.toHaveBeenCalled();
    expect(game.recordWord).not.toHaveBeenCalled();
  });

  it("answers the right word on a shut door as too early, 409, and gives the try back", async () => {
    vi.setSystemTime(THREE);
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(409);
    expect(r.data.reason).toBe("too-early");
    expect(r.data.message).toBe("That is the right word, but this elf is not out yet. Come back once its clue is on the calendar to claim it.");
    expect(r.data).not.toHaveProperty("triesLeft");
    expect(game.giveBackWordTry).toHaveBeenCalledWith(2026, 7, 3);
    expect(game.recordWord).not.toHaveBeenCalled();
  });

  it("answers a door whose elves have gone home with 409", async () => {
    vi.setSystemTime(at("2026-12-10T12:00:00.000Z"));
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt: FIVE_47, foundFamilyId: 9, goneHomeAt: at("2026-12-09T10:00:00.000Z"), goneHomeBy: "admin:staff@example.org" }) });
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(409);
    expect(r.data.reason).toBe("gone-home");
    expect(game.giveBackWordTry).toHaveBeenCalled();
  });

  it("refuses with too many tries after six wrong words, even the right word, and gives that try back", async () => {
    game.takeWordTry.mockResolvedValue(7);
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(400);
    expect(r.data.reason).toBe("too-many-tries");
    expect(game.giveBackWordTry).toHaveBeenCalled();
  });

  it("reads the right word on a snowed in door as a wrong word, like any other place", async () => {
    vi.setSystemTime(SIX_10);
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" }) });
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(400);
    expect(r.data.reason).toBe("wrong-word");
  });

  it("makes a family that has won this year a visitor at another door's hunt", async () => {
    game.familyHasWon.mockResolvedValue(true);
    const r = await word("SNOWBALL 472");
    expect(r.data.outcome).toBe("visited");
    expect(game.familyHasWon).toHaveBeenCalledWith(2026, 3);
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ won: false }));
  });

  it("counts a visit while the place is still hidden from 7pm, and tells the family", async () => {
    vi.setSystemTime(SIX_10);
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt: FIVE_47, foundFamilyId: 9 }) });
    const r = await word("SNOWBALL 472", ["100", "101"]);
    expect(r.data.outcome).toBe("visited");
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ won: false, shownAt: SEVEN, at: SIX_10, detectiveIds: [100, 101] }));
    const html = String(r.data.html);
    expect(html).toContain("It counts from 7pm");
    expect(html).toContain("Detective Ruby Tinselfoot and Detective Leo Frostwhistle have a candy cane stamp");
    expect(html).toContain(`/api/elf/p/${CODE}/photo`);
  });

  it("stamps only the detectives who have not got this place's candy cane", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt: FIVE_47, foundFamilyId: 9 }) });
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: 100, countsFrom: SEVEN, found: false }]);
    const r = await word("SNOWBALL 472", ["100", "101"]);
    expect(r.data.outcome).toBe("visited");
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ detectiveIds: [101] }));
    const again = await word("SNOWBALL 472", ["100"]);
    expect(again.status).toBe(400);
    expect(again.data.reason).toBe("nothing-new");
  });

  it("tells the family a visit's promotion and the new costumes it brings", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt: FIVE_47, foundFamilyId: 9 }) });
    // Ruby has five doors done; door 7 is her sixth, and brings door 7's two costumes.
    game.familyDoorsDone.mockResolvedValue(new Map([[100, { cracked: [1, 2, 3], visited: [4, 5], snow: [] }]]));
    const r = await word("SNOWBALL 472", ["100"]);
    const html = String(r.data.html);
    expect(html).toContain("6 doors done");
    expect(html).toContain("Promoted to Junior Detective!");
    expect(html).toContain("2 new things in the wardrobe");
  });

  it("asks a signed out script to sign in, and sends a signed out form to the sign in page", async () => {
    expect((await word("SNOWBALL 472", ["100"], null)).status).toBe(401);
    const form = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "SNOWBALL 472" }, cookie: null });
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/elf/sign-in");
    expect(game.takeWordTry).not.toHaveBeenCalled();
  });

  it("takes a word only from our own pages", async () => {
    const r = await call("POST", "/api/elf/word", { json: { code: CODE, detectiveIds: ["100"], word: "SNOWBALL 472" }, headers: { Origin: "https://elsewhere.example.org" } });
    expect(r.status).toBe(403);
    expect(game.takeWordTry).not.toHaveBeenCalled();
  });

  it("is not found for a code of no door", async () => {
    const r = await call("POST", "/api/elf/word", { json: { code: "mnpqrstuvwxy", detectiveIds: ["100"], word: "SNOWBALL 472" } });
    expect(r.status).toBe(404);
    expect(game.takeWordTry).not.toHaveBeenCalled();
  });

  it("answers 500 when the game cannot be read, logging neither the word, the tag's word nor the place", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.takeWordTry.mockRejectedValue(new Error("connection lost"));
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: "Something went wrong just now. Please try again in a few minutes." });
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain("connection lost");
    for (const secret of ["SNOWBALL", "472", "Example Bakehouse", "Example Bakes", TYPED_ELF]) expect(lines).not.toContain(secret);
    // No try was taken, so none is given back (that would cancel out a real wrong word).
    expect(game.giveBackWordTry).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("draws the poster page with the gold card for the plain form, its ticks sent as text", async () => {
    const r = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: ["100", "101"], word: "SNOWBALL 472" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain("You're first!");
    expect(r.text).toContain("<h1");
    expect(game.recordWord).toHaveBeenCalledWith(expect.objectContaining({ detectiveIds: [100, 101], won: true }));
  });

  it("draws the poster page with the refusal for the plain form", async () => {
    const r = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "snowball 999" } });
    expect(r.status).toBe(400);
    expect(r.text).toContain("That is not the right word. Check the tag and try again. You have 5 tries left here.");
    expect(r.text).toContain('class="elf-word"');
  });

  const wrongFrom = (address: string) => call("POST", "/api/elf/word", { json: { code: CODE, detectiveIds: ["100"], word: "snowball 999" }, headers: { "X-Forwarded-For": address } });

  it("limits each family to 30 words in 15 minutes, from whatever address", async () => {
    expect(WORD_LIMIT).toEqual({ max: 30, windowMs: 900_000 });
    for (let i = 1; i <= 30; i++) expect((await wrongFrom(`203.0.113.${i}`)).status, `word ${i}`).toBe(400);
    const r = await wrongFrom("203.0.113.31");
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ reason: "too-many-requests", message: "Too many tries. Please wait a few minutes and try again." });
    expect(game.takeWordTry).toHaveBeenCalledTimes(30);
    // Another family is not held up, even at an address the first family used.
    db.findElfSession.mockResolvedValue({ familyId: 4 });
    db.familyWithDetectives.mockImplementation(async (id: number) => ({ ...FAMILY, id }));
    expect((await wrongFrom("203.0.113.1")).status).toBe(400);
  });

  it("limits each address to 300 words in 15 minutes, whoever types them, and holds up no other address", async () => {
    expect(WORD_ADDRESS_LIMIT).toEqual({ max: 300, windowMs: 900_000 });
    // Families sharing one mobile network's address, each well inside its own 30.
    let n = 0;
    db.findElfSession.mockImplementation(async () => ({ familyId: 1000 + (n++ % 12) }));
    db.familyWithDetectives.mockImplementation(async (id: number) => ({ ...FAMILY, id }));
    for (let batch = 0; batch < 6; batch++) {
      const answers = await Promise.all(Array.from({ length: 50 }, () => wrongFrom("198.51.100.77")));
      expect(answers.every((a) => a.status === 400), `batch ${batch + 1}`).toBe(true);
    }
    const over = await wrongFrom("198.51.100.77");
    expect(over.status).toBe(429);
    expect(over.data.message).toBe("Too many tries. Please wait a few minutes and try again.");
    expect((await wrongFrom("198.51.100.78")).status).toBe(400);
  });

  it("draws the poster page for the plain form when the family has typed too many words, with the words in its form", async () => {
    for (let i = 1; i <= 30; i++) await wrongFrom(`203.0.113.${i}`);
    const r = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "snowball 999" }, headers: { "X-Forwarded-For": "203.0.113.99" } });
    expect(r.status).toBe(429);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain('<p class="elf-form-status is-error" role="status">Too many tries. Please wait a few minutes and try again.</p>');
    expect(r.text).toContain('class="elf-word"');
    expect(game.takeWordTry).toHaveBeenCalledTimes(30);
  });

  it("answers 500, never a failure left unhandled, when the page for the plain form cannot be drawn", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyPhoto.mockRejectedValue(new Error("connection lost"));
    const r = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "SNOWBALL 472" } });
    expect(r.status).toBe(500);
    expect(r.text).toBe("Something went wrong just now. Please try again in a few minutes.");
    expect(game.recordWord).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("answers 500 when a card cannot be drawn for the script", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    spies.claimWinHtml.mockImplementationOnce(() => {
      throw new Error("a card that cannot be drawn");
    });
    const r = await word("SNOWBALL 472");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: "Something went wrong just now. Please try again in a few minutes." });
    logged.mockRestore();
  });

  it("gives the try back when the game cannot be read after the try was taken", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyVisits.mockRejectedValue(new Error("connection lost"));
    const r = await word("snowball 999");
    expect(r.status).toBe(500);
    expect(game.takeWordTry).toHaveBeenCalledTimes(1);
    expect(game.giveBackWordTry).toHaveBeenCalledTimes(1);
    expect(game.giveBackWordTry).toHaveBeenCalledWith(2026, 7, 3);
    logged.mockRestore();
  });

  it("still answers 500, and lets nothing escape, when giving the try back fails too", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyVisits.mockRejectedValue(new Error("connection lost"));
    game.giveBackWordTry.mockRejectedValue(new Error("still lost"));
    const r = await word("snowball 999");
    expect(r.status).toBe(500);
    await vi.waitFor(() => expect(JSON.stringify(logged.mock.calls)).toContain("still lost"));
    logged.mockRestore();
  });

  it("keeps a wrong word's try even when its answer cannot be drawn", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyPhoto.mockRejectedValue(new Error("connection lost"));
    const r = await call("POST", `/elf/p/${CODE}/word`, { form: { code: CODE, detective: "100", word: "snowball 999" } });
    expect(r.status).toBe(500);
    expect(game.giveBackWordTry).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("shows the gold card again to the finder's own second tap, inside two minutes of the find", async () => {
    const foundAt = at("2026-12-07T17:46:30.000Z");
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt, foundFamilyId: 3 }) });
    game.familyHasWon.mockResolvedValue(true);
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: 100, countsFrom: foundAt, found: true }]);
    const r = await word("SNOWBALL 472", ["100"]);
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("won");
    const html = String(r.data.html);
    expect(html).toContain("You're first!");
    expect(html).toContain("Found at 5:46pm");
    expect(html).toContain("Detective Ruby Tinselfoot");
    expect(game.recordWord).not.toHaveBeenCalled();
    expect(game.giveBackWordTry).toHaveBeenCalledWith(2026, 7, 3);
  });

  it("never shows an old gold card again: three minutes after the find, the same tap is nothing new", async () => {
    const foundAt = at("2026-12-07T17:44:00.000Z");
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt, foundFamilyId: 3 }) });
    game.familyHasWon.mockResolvedValue(true);
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: 100, countsFrom: foundAt, found: true }]);
    const r = await word("SNOWBALL 472", ["100"]);
    expect(r.status).toBe(400);
    expect(r.data.reason).toBe("nothing-new");
  });

  it("never shows another family's gold card to a family that only visited", async () => {
    const foundAt = at("2026-12-07T17:46:30.000Z");
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt, foundFamilyId: 9 }) });
    game.familyVisits.mockResolvedValue([{ door: 7, detectiveId: 100, countsFrom: SEVEN, found: false }]);
    const r = await word("SNOWBALL 472", ["100"]);
    expect(r.status).toBe(400);
    expect(r.data.reason).toBe("nothing-new");
  });

  it("promises no promotion and no new costumes on a visit that only counts from later", async () => {
    vi.setSystemTime(SIX_10);
    doors.findElfDoorByPosterCode.mockResolvedValue({ year: 2026, setup: door7({ foundAt: FIVE_47, foundFamilyId: 9 }) });
    // Door 7 would be Ruby's sixth door, a promotion and two costumes, but only from 7pm.
    game.familyDoorsDone.mockResolvedValue(new Map([[100, { cracked: [1, 2, 3], visited: [4, 5], snow: [] }]]));
    const r = await word("SNOWBALL 472", ["100"]);
    const html = String(r.data.html);
    expect(html).toContain("It counts from 7pm");
    expect(html).toContain("6 doors done");
    expect(html).not.toContain("Promoted");
    expect(html).not.toContain("new thing");
  });
});

// ---- the typed guess --------------------------------------------------------------------------

describe("the typed guess", () => {
  it("saves a guess on a hunting door and answers with it as typed", async () => {
    const r = await guess(7, "  Example Bakes ");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, text: "Example Bakes" });
    expect(game.saveGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "Example Bakes", norm: normalisePlaceName("Example Bakes") }, FIVE_47);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a guess once the place is shown", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.listElfDoors.mockResolvedValue([door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
    const r = await guess(7, "Example Bakes");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "not-hunting", message: "Too late: the hiding place is shown now. Have a look at the calendar." });
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("still takes a guess once the elf is found while the place is hidden", async () => {
    vi.setSystemTime(SIX_10);
    doors.listElfDoors.mockResolvedValue([door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
    expect((await guess(7, "Example Bakes")).status).toBe(200);
  });

  it("asks for a place when nothing is typed, naming the elf, and refuses a long one", async () => {
    const empty = await guess(7, "   ");
    expect(empty.status).toBe(400);
    expect(empty.data).toEqual({ reason: "empty", message: `Type where you think ${TYPED_ELF} is hiding.` });
    const long = await guess(7, "x".repeat(81));
    expect(long.status).toBe(400);
    expect(long.data).toEqual({ reason: "too-long", message: "That is a bit long. Up to 80 letters is plenty." });
  });

  it("never names a shut door's elf, even for an empty guess", async () => {
    vi.setSystemTime(THREE);
    const r = await guess(7, "");
    expect(r.status).toBe(400);
    expect(r.text).not.toContain(TYPED_ELF);
  });

  it("says kindly when the guess names a place whose door is already open", async () => {
    doors.listElfDoors.mockResolvedValue([door3(), door7()]);
    const r = await guess(7, "the old example mill");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "place-already-open", message: "That elf was already found behind door 3. Try again!", door: 3 });
    expect((await guess(7, "Example Mill")).data.door).toBe(3);
  });

  it("is not found for a door that is not 1 to 24", async () => {
    for (const door of [25, -1, "seven", 7.5, null]) expect((await guess(door, "Example Bakes")).status, String(door)).toBe(404);
  });

  it("asks a signed out family to sign in", async () => {
    expect((await guess(7, "Example Bakes", null)).status).toBe(401);
  });

  it("goes back to Detective HQ after the plain form", async () => {
    const r = await call("POST", "/api/elf/guess", { form: { door: "7", text: "Example Bakes" } });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/hq");
    expect(game.saveGuess).toHaveBeenCalled();
  });

  it("draws Detective HQ again for the plain form's refusal, with the words in the guess form's status line", async () => {
    doors.listElfDoors.mockResolvedValue([door3(), door7()]);
    const r = await call("POST", "/api/elf/guess", { form: { door: "7", text: "the old example mill" } });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain("Detective HQ");
    expect(r.text).toContain('<p class="elf-guess__status is-error" role="status">That elf was already found behind door 3. Try again!</p>');
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  // Final review, minor 8: a guess is saved on every send, so each family may send 60 in 15 minutes
  // (plenty for changing a mind), counted as the word's limit is, by family.
  const guessFrom = (address: string, text = "Example Bakes") => call("POST", "/api/elf/guess", { json: { door: 7, text }, headers: { "X-Forwarded-For": address } });

  it("limits each family to 60 guesses in 15 minutes, from whatever address, and holds up no other family", async () => {
    expect(GUESS_LIMIT).toEqual({ max: 60, windowMs: 900_000 });
    for (let i = 1; i <= 60; i++) expect((await guessFrom(`203.0.113.${i}`)).status, `guess ${i}`).toBe(200);
    const r = await guessFrom("203.0.113.61");
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ reason: "too-many-requests", message: "Too many tries. Please wait a few minutes and try again." });
    expect(game.saveGuess).toHaveBeenCalledTimes(60);
    // Another family is not held up, even at an address the first family used.
    db.findElfSession.mockResolvedValue({ familyId: 4 });
    db.familyWithDetectives.mockImplementation(async (id: number) => ({ ...FAMILY, id }));
    expect((await guessFrom("203.0.113.1")).status).toBe(200);
  });

  it("draws Detective HQ again for the plain form when the family has sent too many guesses, with the words in its guess form", async () => {
    for (let i = 1; i <= 60; i++) await guessFrom(`203.0.113.${i}`);
    const r = await call("POST", "/api/elf/guess", { form: { door: "7", text: "Example Bakes" }, headers: { "X-Forwarded-For": "203.0.113.99" } });
    expect(r.status).toBe(429);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain('<p class="elf-guess__status is-error" role="status">Too many tries. Please wait a few minutes and try again.</p>');
    expect(game.saveGuess).toHaveBeenCalledTimes(60);
  });

  it("says too late on Detective HQ, drawn again, when the plain form arrives after the place is shown", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.listElfDoors.mockResolvedValue([door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
    const r = await call("POST", "/api/elf/guess", { form: { door: "7", text: "Example Bakes" } });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain('<p class="elf-guess__status is-error" role="status">Too late: the hiding place is shown now. Have a look at the calendar.</p>');
    expect(spies.hqViewFor).toHaveBeenCalledTimes(1);
  });
});

// ---- the family's photo -----------------------------------------------------------------------

describe("the family's photo", () => {
  const VISIT = [{ door: 7, detectiveId: 100, countsFrom: FIVE_47, found: true }];
  const photo = async (over: Record<string, unknown> = {}, ask: Ask = {}) =>
    call("POST", `/api/elf/p/${CODE}/photo`, { json: { mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64"), consent: true, ...over }, ...ask });

  it("is only for a family that has typed the word at this door", async () => {
    const r = await photo();
    expect(r.status).toBe(403);
    expect(r.data).toEqual({ error: "Type the word on the elf's tag first." });
    expect(spies.processPicture).not.toHaveBeenCalled();
    expect(game.familyVisits).toHaveBeenCalledWith(2026, 3);
  });

  it("needs the grown up's tick, exactly", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    for (const consent of [false, "true", "yes", undefined]) {
      const r = await photo({ consent });
      expect(r.status, String(consent)).toBe(400);
      expect(r.data).toEqual({ error: "Tick the box to say we can show this photo." });
    }
    expect(spies.processPicture).not.toHaveBeenCalled();
  });

  it("makes the picture again, then keeps it waiting, and answers 202 with its address", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    const jpeg = await tinyJpeg();
    const r = await photo();
    expect(r.status).toBe(202);
    expect(r.data).toEqual({ status: "waiting", token: TOKEN });
    expect(spies.processPicture).toHaveBeenCalledWith("main", jpeg);
    expect(spies.processPicture.mock.invocationCallOrder[0]).toBeLessThan(game.sendElfPhoto.mock.invocationCallOrder[0]);
    const sent = game.sendElfPhoto.mock.calls[0][0];
    expect({ ...sent, picture: { ...sent.picture, bytes: Buffer.isBuffer(sent.picture.bytes) } }).toEqual({
      year: 2026,
      door: 7,
      familyId: 3,
      picture: { mime: "image/jpeg", bytes: true, width: 4, height: 4 },
      at: FIVE_47,
    });
  });

  it("takes a PNG as the fundraisers' pictures do, and keeps it made again as a JPEG", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 128, b: 0 } } }).png().toBuffer();
    const r = await photo({ mime: "image/png", dataBase64: png.toString("base64") });
    expect(r.status).toBe(202);
    expect(spies.processPicture).toHaveBeenCalledWith("main", png);
    expect(game.sendElfPhoto.mock.calls[0][0].picture.mime).toBe("image/jpeg");
  });

  it("spends none of an address's allowance on tries its family's own limit has refused", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    game.sendElfPhoto.mockResolvedValue("limit");
    const from = { "X-Forwarded-For": "203.0.113.30" };
    // Twenty tries for the family, then forty its limit refuses: the address has counted only twenty.
    for (let i = 1; i <= 60; i++) await photo({}, { headers: from });
    db.findElfSession.mockResolvedValue({ familyId: 4 });
    game.sendElfPhoto.mockResolvedValue({ token: TOKEN });
    const r = await photo({}, { headers: from });
    expect(r.status).toBe(202);
  });

  // Final review, minor 9: once the place has sent its elf home, its door takes no more photos.
  it("refuses a photo for a door whose elf has gone home, and makes nothing", async () => {
    vi.setSystemTime(at("2026-12-10T12:00:00.000Z"));
    doors.findElfDoorByPosterCode.mockResolvedValue({
      year: 2026,
      setup: door7({ foundAt: FIVE_47, foundFamilyId: 9, goneHomeAt: at("2026-12-09T10:00:00.000Z"), goneHomeBy: "admin:staff@example.org" }),
    });
    game.familyVisits.mockResolvedValue(VISIT);
    const r = await photo();
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ error: "This elf has gone home, so its door is not taking photos now." });
    expect(spies.processPicture).not.toHaveBeenCalled();
    expect(game.sendElfPhoto).not.toHaveBeenCalled();
  });

  it("says when the family has sent five today", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    game.sendElfPhoto.mockResolvedValue("limit");
    const r = await photo();
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ error: "You have sent 5 photos today. Please try again tomorrow." });
  });

  it("answers as the fundraisers' pictures do: not a picture, too big, busy", async () => {
    game.familyVisits.mockResolvedValue(VISIT);
    const notOne = await photo({ mime: "image/png", dataBase64: Buffer.from("<svg onload='x'/>").toString("base64") });
    expect(notOne.status).toBe(400);
    expect(notOne.data).toEqual({ error: "Your picture needs another look", fields: { photo: "That picture is not one we can use. Try a JPG, PNG or WebP photo." } });
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "busy" });
    const busy = await photo();
    expect(busy.status).toBe(503);
    expect(busy.data).toEqual({ error: "Lots of photos arriving just now. Please try again in a minute." });
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "size" });
    expect((await photo()).status).toBe(413);
    spies.processPicture.mockResolvedValueOnce({ ok: false, reason: "unreadable" });
    const unreadable = await photo();
    expect(unreadable.status).toBe(400);
    expect(unreadable.data).toEqual({ error: "Your picture needs another look", fields: { photo: "We could not open that picture. Please try a different photo." } });
    expect(game.sendElfPhoto).not.toHaveBeenCalled();
  });

  it("counts every try before a picture is opened, so nobody can keep the picture maker busy", async () => {
    expect(PHOTO_TRIES).toEqual({ max: 20, windowMs: 86_400_000 });
    game.familyVisits.mockResolvedValue(VISIT);
    game.sendElfPhoto.mockResolvedValue("limit");
    const from = { "X-Forwarded-For": "203.0.113.20" };
    for (let i = 1; i <= 20; i++) expect((await photo({}, { headers: from })).status, `try ${i}`).toBe(429);
    spies.processPicture.mockClear();
    const r = await photo({}, { headers: from });
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ error: "You have tried to send a lot of photos today. Please try again tomorrow." });
    expect(spies.processPicture).not.toHaveBeenCalled();
  });

  it("reads no body without a signed in family's cookie, and takes photos only from our own pages", async () => {
    expect((await photo({}, { cookie: null })).status).toBe(401);
    game.familyVisits.mockResolvedValue(VISIT);
    expect((await photo({}, { headers: { Origin: "https://elsewhere.example.org" } })).status).toBe(403);
    expect(game.sendElfPhoto).not.toHaveBeenCalled();
  });

  it("keeps the practice door's photo as year 0, door 0", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow());
    game.familyVisits.mockImplementation(async (year: number) => (year === 0 ? [{ door: 0, detectiveId: 100, countsFrom: FIVE_47, found: true }] : []));
    const r = await call("POST", `/api/elf/p/${PRACTICE_CODE}/photo`, {
      json: { mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64"), consent: true },
      cookie: PRACTICE_PASS,
    });
    expect(r.status).toBe(202);
    expect(game.sendElfPhoto).toHaveBeenCalledWith(expect.objectContaining({ year: 0, door: 0, familyId: 3 }));
  });

  it("takes the family's own photo down from the calendar's door and from the poster page", async () => {
    const fromCalendar = await call("DELETE", "/api/elf/door/7/photo");
    expect(fromCalendar.status).toBe(200);
    expect(fromCalendar.data).toEqual({ ok: true });
    expect(game.takeDownOwnPhoto).toHaveBeenCalledWith(2026, 7, 3, FIVE_47);
    const fromPoster = await call("DELETE", `/api/elf/p/${CODE}/photo`);
    expect(fromPoster.data).toEqual({ ok: true });
    expect(game.takeDownOwnPhoto).toHaveBeenCalledTimes(2);
    expect(game.takeDownOwnPhoto.mock.calls[1]).toEqual([2026, 7, 3, FIVE_47]);
  });

  it("takes nothing down for someone signed out, from elsewhere, or for no door", async () => {
    expect((await call("DELETE", "/api/elf/door/7/photo", { cookie: null })).status).toBe(401);
    expect((await call("DELETE", "/api/elf/door/7/photo", { headers: { Origin: "https://elsewhere.example.org" } })).status).toBe(403);
    expect((await call("DELETE", "/api/elf/door/25/photo")).status).toBe(404);
    expect((await call("DELETE", "/api/elf/door/0/photo")).status).toBe(404);
    expect(game.takeDownOwnPhoto).not.toHaveBeenCalled();
  });
});

// ---- the pictures -----------------------------------------------------------------------------

describe("a photo on a door", () => {
  beforeEach(() => {
    doors.listElfDoors.mockResolvedValue([door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
    doors.getElfDoor.mockResolvedValue(door7({ foundAt: FIVE_47, foundFamilyId: 9 }));
  });

  it("is not served while the place is still hidden, at 6:10pm, and that answer is never kept", async () => {
    vi.setSystemTime(SIX_10);
    const r = await call("GET", `/elf/door/7/photo/${TOKEN}.jpg`, { cookie: null });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(game.approvedPhoto).not.toHaveBeenCalled();
  });

  it("is served once the place is shown, at 7:05pm, as a picture that a cache may keep for five minutes", async () => {
    vi.setSystemTime(SEVEN_05);
    const r = await call("GET", `/elf/door/7/photo/${TOKEN}.jpg`, { cookie: null });
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(Buffer.from("the photo"));
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    expect(game.approvedPhoto).toHaveBeenCalledWith(2026, 7, TOKEN);
  });

  it("reads only its own door, never all 24", async () => {
    vi.setSystemTime(SEVEN_05);
    await call("GET", `/elf/door/7/photo/${TOKEN}.jpg`, { cookie: null });
    expect(doors.getElfDoor).toHaveBeenCalledWith(2026, 7);
    expect(doors.listElfDoors).not.toHaveBeenCalled();
    expect(spies.runsFor).not.toHaveBeenCalled();
  });

  it("is not found for an address that is not a photo token, or a photo not approved", async () => {
    vi.setSystemTime(SEVEN_05);
    for (const bad of ["Q2W3E4R5T6Y7", "q2w3e4r5t6y", "q2w3e4r5t6y70", "q2w3e4r5t6yl"]) {
      expect((await call("GET", `/elf/door/7/photo/${bad}.jpg`)).status, bad).toBe(404);
    }
    expect(game.approvedPhoto).not.toHaveBeenCalled();
    game.approvedPhoto.mockResolvedValue(null);
    expect((await call("GET", `/elf/door/7/photo/${TOKEN}.jpg`)).status).toBe(404);
  });

  it("is never served on a snow day", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.listElfDoors.mockResolvedValue([door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" })]);
    doors.getElfDoor.mockResolvedValue(door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" }));
    expect((await call("GET", `/elf/door/7/photo/${TOKEN}.jpg`)).status).toBe(404);
    expect(game.approvedPhoto).not.toHaveBeenCalled();
  });
});

describe("an elf on a door", () => {
  const LOOK = { ...defaultLook(), costume: "tree" };
  /** Every door done: everything in the wardrobe unlocked. */
  const EVERYTHING = { doors: Array.from({ length: 24 }, (_, i) => i + 1) };
  const poolCalls = () => (pool.query as unknown as Mock).mock.calls.length;

  // Final review, Important 5: a busy evening asks for many of these. A visit's look was made safe
  // against its detective's doors when it was stored, so it is drawn as stored, with everything
  // unlocked: one read (the visit, whether it counts by now, and that its family is still in) and no
  // doors read at all.
  it("is drawn from its stored look with one read and no doors read, once the visit counts, for any cache to keep an hour", async () => {
    vi.setSystemTime(SIX_10);
    const before = poolCalls();
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: FIVE_47 });
    const r = await call("GET", "/elf/door/7/elf/5.png", { cookie: null });
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(Buffer.from("png"));
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(r.headers.get("etag")).toBe('"k1"');
    expect(game.visitElf).toHaveBeenCalledTimes(1);
    expect(game.visitElf).toHaveBeenCalledWith(2026, 7, 5);
    expect(png.elfPng).toHaveBeenCalledWith(LOOK, EVERYTHING, 240);
    expect(png.elfPngKey).toHaveBeenCalledWith(LOOK, EVERYTHING, 240);
    for (const read of [doors.listElfDoors, doors.getElfDoor, doors.findElfDoorByPosterCode, practice.getPractice, game.detectiveDoorsDone, game.familyDoorsDone, spies.runsFor]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(poolCalls()).toBe(before);
  });

  it("draws a visit's elf once and keeps it, still asking on every request whether the visit counts and its family is in", async () => {
    vi.setSystemTime(SIX_10);
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: FIVE_47 });
    expect((await call("GET", "/elf/door/7/elf/5.png")).status).toBe(200);
    const again = await call("GET", "/elf/door/7/elf/5.png");
    expect(again.status).toBe(200);
    expect(again.bytes).toEqual(Buffer.from("png"));
    expect(again.headers.get("etag")).toBe('"k1"');
    expect(png.elfPng).toHaveBeenCalledTimes(1);
    expect(game.visitElf).toHaveBeenCalledTimes(2);
    // Its family removed since: the one read finds nothing, so the kept picture is not served.
    game.visitElf.mockResolvedValue(null);
    expect((await call("GET", "/elf/door/7/elf/5.png")).status).toBe(404);
    // Another visit is drawn for itself.
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 101, countsFrom: FIVE_47 });
    expect((await call("GET", "/elf/door/7/elf/6.png")).status).toBe(200);
    expect(png.elfPng).toHaveBeenCalledTimes(2);
  });

  it(`keeps at most ${DOOR_ELVES_KEPT} drawn elves, letting the one asked for longest ago go first`, async () => {
    vi.setSystemTime(SIX_10);
    game.visitElf.mockImplementation(async () => ({ look: LOOK, detectiveId: 100, countsFrom: FIVE_47 }));
    for (let id = 1; id <= DOOR_ELVES_KEPT; id++) await call("GET", `/elf/door/7/elf/${id}.png`);
    // Visit 1 is asked for again, so visit 2 is now the one asked for longest ago.
    await call("GET", "/elf/door/7/elf/1.png");
    expect(png.elfPng).toHaveBeenCalledTimes(DOOR_ELVES_KEPT);
    await call("GET", `/elf/door/7/elf/${DOOR_ELVES_KEPT + 1}.png`);
    expect(png.elfPng).toHaveBeenCalledTimes(DOOR_ELVES_KEPT + 1);
    await call("GET", "/elf/door/7/elf/1.png");
    expect(png.elfPng).toHaveBeenCalledTimes(DOOR_ELVES_KEPT + 1);
    await call("GET", "/elf/door/7/elf/2.png");
    expect(png.elfPng).toHaveBeenCalledTimes(DOOR_ELVES_KEPT + 2);
  });

  it("says busy when the elf cannot be drawn just now, keeps nothing, and draws it when asked again", async () => {
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: FIVE_47 });
    png.elfPng.mockResolvedValueOnce(null);
    const busy = await call("GET", "/elf/door/7/elf/5.png");
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).toBe("2");
    expect(busy.headers.get("cache-control")).toBe("no-store");
    expect((await call("GET", "/elf/door/7/elf/5.png")).status).toBe(200);
    expect(png.elfPng).toHaveBeenCalledTimes(2);
  });

  it("answers 'not changed' without drawing it again", async () => {
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: FIVE_47 });
    const r = await call("GET", "/elf/door/7/elf/5.png", { headers: { "If-None-Match": '"k1"' } });
    expect(r.status).toBe(304);
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("is not served before the visit counts, and that answer is never kept", async () => {
    vi.setSystemTime(SIX_10);
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: SEVEN });
    const r = await call("GET", "/elf/door/7/elf/5.png");
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(png.elfPng).not.toHaveBeenCalled();
  });

  it("is private for the practice door, which nobody else should be handed", async () => {
    vi.setSystemTime(SIX_10);
    practice.getPractice.mockResolvedValue(practiceRow());
    game.visitElf.mockResolvedValue({ look: LOOK, detectiveId: 100, countsFrom: SIX_10 });
    const r = await call("GET", "/elf/door/0/elf/5.png", { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(game.visitElf).toHaveBeenCalledWith(0, 0, 5);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is not found for no visit, or an address that is not a visit's", async () => {
    expect((await call("GET", "/elf/door/7/elf/5.png")).status).toBe(404);
    for (const bad of ["abc", "0", "5.5", "-5"]) expect((await call("GET", `/elf/door/7/elf/${bad}.png`)).status, bad).toBe(404);
    expect((await call("GET", "/elf/door/25/elf/5.png")).status).toBe(404);
    expect(game.visitElf).toHaveBeenCalledTimes(1);
  });
});

describe("a clue's picture", () => {
  beforeEach(() => vi.setSystemTime(SIX_10));

  it("is served to a signed in family once its clue is out, privately", async () => {
    const r = await call("GET", "/elf/hq/clue/7/2.jpg");
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(Buffer.from("the clue picture"));
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(game.cluePicture).toHaveBeenCalledWith(2026, 7, 2);
  });

  it("is not found before its clue is out: clue 3 at 6:10pm", async () => {
    expect((await call("GET", "/elf/hq/clue/7/3.jpg")).status).toBe(404);
    expect(game.cluePicture).not.toHaveBeenCalled();
  });

  it("is never served on a snow day, nor to someone signed out, nor for door 0", async () => {
    doors.listElfDoors.mockResolvedValue([door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" })]);
    expect((await call("GET", "/elf/hq/clue/7/1.jpg")).status).toBe(404);
    doors.listElfDoors.mockResolvedValue([door7()]);
    expect((await call("GET", "/elf/hq/clue/7/1.jpg", { cookie: null })).status).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow());
    expect((await call("GET", "/elf/hq/clue/0/1.jpg", { cookie: PRACTICE_PASS })).status).toBe(404);
    for (const bad of ["7/4", "7/0", "25/1", "7/x"]) expect((await call("GET", `/elf/hq/clue/${bad}.jpg`)).status, bad).toBe(404);
    expect(game.cluePicture).not.toHaveBeenCalled();
  });
});

// ---- the public calendar ----------------------------------------------------------------------

/** Doors 1 to 5, snowed in on their days (every door has its row once December's doors are on). */
const snowedIn = (): DoorSetup[] =>
  ([1, 2, 3, 4, 5] as const).map((d) => ({ ...emptyDoor(d, "bcdfg"[d - 1].repeat(12)), snowDayAt: at(`2026-12-0${d}T10:00:00.000Z`), snowDayBy: "automatic" }));

describe("the public calendar", () => {
  beforeEach(() => {
    vi.setSystemTime(SIX_10);
    doors.listElfDoors.mockResolvedValue([...snowedIn(), door6(), door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
  });

  it("counts found doors with their places still hidden as found, as the page's tally does", async () => {
    const r = await call("GET", "/api/elf/calendar", { cookie: null });
    expect(r.status).toBe(200);
    expect(r.data.found).toBe(2);
    expect(r.headers.get("cache-control")).toBe("public, max-age=15");
  });

  it("snows in what cannot run, then reads the finders of found doors and the scrapbooks of open ones only", async () => {
    await call("GET", "/api/elf/calendar");
    expect(game.markAutomaticSnowDays).toHaveBeenCalledWith(2026, SIX_10);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ practice: false }));
    expect(game.finderParts.mock.calls.map((c) => c[1]).sort()).toEqual([6, 7]);
    expect(game.doorCounts.mock.calls.map((c) => c[1])).toEqual([6]);
    expect(game.doorScrapbook.mock.calls.map((c) => c[1])).toEqual([6]);
    expect(doors.ensureElfDoors).not.toHaveBeenCalled();
  });

  // Final review, Important 1: the calendar is built once every 15 seconds and shared, so the time its
  // script sets its clock by is the time of each answer, never the time of the build.
  it("tells the script the time of the answer, not the time the shared calendar was built", async () => {
    const first = await call("GET", "/api/elf/calendar", { cookie: null });
    expect(first.data.now).toBe(SIX_10.toISOString());
    const later = new Date(SIX_10.getTime() + 10_000);
    vi.setSystemTime(later);
    const feed = await call("GET", "/api/elf/calendar", { cookie: null });
    const page = await call("GET", "/elf", { cookie: null });
    // Still the one build...
    expect(spies.runsFor).toHaveBeenCalledTimes(1);
    // ...but each answer carries its own time.
    expect(feed.data.now).toBe(later.toISOString());
    expect(page.text).toContain(`data-now="${later.toISOString()}"`);
    expect(page.text).not.toContain(`data-now="${SIX_10.toISOString()}"`);
  });

  it("is built once for everyone who asks inside 15 seconds", async () => {
    await call("GET", "/elf");
    await call("GET", "/api/elf/calendar", { cookie: PRACTICE_PASS });
    await call("GET", "/api/elf/door/7");
    expect(spies.runsFor).toHaveBeenCalledTimes(1);
    expect(game.markAutomaticSnowDays).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(SIX_10.getTime() + 15_100));
    await call("GET", "/api/elf/calendar");
    expect(spies.runsFor).toHaveBeenCalledTimes(2);
  });

  it("never carries the practice door, even for a practice browser", async () => {
    practice.getPractice.mockResolvedValue(practiceRow());
    const r = await call("GET", "/api/elf/calendar", { cookie: PRACTICE_PASS });
    expect((r.data.doors as { door: number }[]).map((d) => d.door)).not.toContain(0);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ practice: false }));
    expect(practice.getPractice).not.toHaveBeenCalled();
    expect((await call("GET", "/api/elf/door/0", { cookie: PRACTICE_PASS })).status).toBe(404);
    expect((await call("GET", "/elf", { cookie: PRACTICE_PASS })).text).not.toContain("The Example Office");
  });

  it("answers 500, and keeps nothing, when the calendar cannot be built", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    doors.listElfDoors.mockRejectedValueOnce(new Error("the database is away"));
    expect((await call("GET", "/api/elf/calendar")).status).toBe(500);
    expect((await call("GET", "/api/elf/calendar")).status).toBe(200);
    quiet.mockRestore();
  });
});

// ---- Detective HQ and the family's marks ------------------------------------------------------

describe("Detective HQ with the doors on", () => {
  it("shows today's clues that are out and the family's guess, read through runsFor", async () => {
    vi.setSystemTime(SIX_10);
    game.familyGuesses.mockImplementation(async (year: number) => (year === 2026 ? new Map([[7, { text: "Example Bakes", norm: "examplebakes", at: FIVE_47 }]]) : new Map()));
    const r = await call("GET", "/elf/hq");
    expect(r.status).toBe(200);
    expect(spies.runsFor).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ doorsOn: true }), practice: false }));
    expect(r.text.match(/class="elf-clue"/g)?.length).toBe(2);
    expect(r.text).not.toContain("Pretend clue three");
    expect(r.text).toContain("/elf/hq/clue/7/2.jpg");
    expect(r.text).toContain("Your guess: Example Bakes.");
    expect(game.familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), SIX_10);
    expect(game.finderParts).not.toHaveBeenCalled();
  });

  // Final review, Important 2: door 7's place closes at 8:30pm. HQ says the staff reveal time, 7pm, until
  // it passes, then that the place is shown as soon as the elf is found; never the closing time.
  it("never prints the place's closing time as when the place is shown, either side of the reveal time", async () => {
    vi.setSystemTime(at("2026-12-07T18:45:00.000Z"));
    const before = await call("GET", "/elf/hq");
    expect(before.status).toBe(200);
    expect(before.text).toContain("The hiding place is shown at 7pm");
    expect(before.text).not.toContain("8:30pm");
    vi.setSystemTime(at("2026-12-07T19:15:00.000Z"));
    const after = await call("GET", "/elf/hq");
    expect(after.text).toContain("The hiding place is shown as soon as the elf is found.");
    expect(after.text).not.toContain("8:30pm");
    expect(after.text).not.toContain("shown at");
  });

  it("keeps the same rule for the practice door, which closes an hour after its 6:20pm reveal", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow());
    vi.setSystemTime(SIX_10);
    const before = await call("GET", "/elf/hq", { cookie: PRACTICE_PASS });
    expect(before.text).toContain("The hiding place is shown at 6:20pm");
    expect(before.text).not.toContain("7:20pm");
    vi.setSystemTime(at("2026-12-07T18:30:00.000Z"));
    const after = await call("GET", "/elf/hq", { cookie: PRACTICE_PASS });
    expect(after.text).toContain("The hiding place is shown as soon as the elf is found.");
    expect(after.text).not.toContain("7:20pm");
  });

  it("names who found today's elf once its place is shown, building the view once", async () => {
    vi.setSystemTime(SEVEN_05);
    doors.listElfDoors.mockResolvedValue([door7({ foundAt: FIVE_47, foundFamilyId: 9 })]);
    game.finderParts.mockResolvedValue([{ firstName: "Ava", surname: "Snowdrift", approved: true }]);
    const r = await call("GET", "/elf/hq");
    expect(game.finderParts).toHaveBeenCalledWith(2026, 7);
    expect(r.text).toContain("Detective Ava Snowdrift");
    expect(spies.hqViewFor).toHaveBeenCalledTimes(1);
  });

  it("dresses the wardrobe from the detective's own doors done", async () => {
    game.detectiveDoorsDone.mockResolvedValue({ cracked: [2], visited: [], snow: [] });
    const r = await call("GET", "/elf/hq/wardrobe/100");
    expect(r.status).toBe(200);
    expect(game.detectiveDoorsDone).toHaveBeenCalledWith(2026, 100, expect.any(Array), FIVE_47);
  });

  it("gives the family's marks and its own photos for the calendar's script", async () => {
    vi.setSystemTime(SIX_10);
    doors.listElfDoors.mockResolvedValue([door6(), door7()]);
    game.familyDoorsDone.mockResolvedValue(
      new Map([
        [100, { cracked: [], visited: [6], snow: [] }],
        [101, { cracked: [], visited: [], snow: [] }],
      ]),
    );
    game.familyPhoto.mockResolvedValue({ token: TOKEN, status: "approved" });
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ doors: [{ door: 6, cracked: false, visited: true, snow: false }], photos: [{ door: 6, token: TOKEN, status: "approved" }] });
    expect(game.familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), SIX_10);
    // Door 6's place is shown, so an approved photo reads as approved.
    expect(game.familyPhoto).toHaveBeenCalledWith(2026, 6, 3, true);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("asks for a sign in for the family's marks", async () => {
    expect((await call("GET", "/api/elf/me", { cookie: null })).status).toBe(401);
  });
});

// ---- how the app mounts the photo post ---------------------------------------------------------

describe("how the app mounts the photo post", () => {
  // Read from the source: the app itself needs a whole environment to start.
  const app = readFileSync(resolve(__dirname, "../../src/app.ts"), "utf8");
  const where = (s: string) => app.indexOf(s);

  it("reads the photo's bigger body only on its own path, behind the cookie guard, before the usual parser", () => {
    expect(where("app.use(ELF_PHOTO_POST_PATH, elfPhotoBodyGuard(express.json({ limit: PICTURE_JSON_BODY_LIMIT })));")).toBeGreaterThan(-1);
    expect(where("app.use(ELF_PHOTO_POST_PATH")).toBeLessThan(where("app.use(express.json());"));
    expect(ELF_PHOTO_POST_PATH).toBe("/api/elf/p/:code/photo");
  });

  // Final review, minor 10: a take down (DELETE) on the photo's own address must never be read by the
  // photo's 4 MB parser. It goes on to the usual small parser, which refuses a body that big.
  it("never reads a take down's body with the photo's bigger parser", async () => {
    // Express's own error handler says why it refused the body; that line is expected here.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const big = { padding: "x".repeat(200 * 1024) };
    const down = await call("DELETE", `/api/elf/p/${CODE}/photo`, { json: big });
    expect(down.status).toBe(413);
    expect(game.takeDownOwnPhoto).not.toHaveBeenCalled();
    // A photo of the same size is still read: it reaches the route, which asks for a visit first.
    const post = await call("POST", `/api/elf/p/${CODE}/photo`, { json: { ...big, mime: "image/jpeg", dataBase64: "AAAA", consent: true } });
    expect(post.status).toBe(403);
    expect(post.data).toEqual({ error: "Type the word on the elf's tag first." });
    // And a take down with no body is taken as before.
    expect((await call("DELETE", `/api/elf/p/${CODE}/photo`)).data).toEqual({ ok: true });
    // The error handler writes its line a moment after it answers.
    await vi.waitFor(() => expect(JSON.stringify(quiet.mock.calls)).toContain("request entity too large"));
    quiet.mockRestore();
  });

  it("lets a body through the guard only with a cookie the shape of a signed in family's, and lets only a post reach the parser", () => {
    const guard = (cookie: string | undefined, method = "POST") => {
      let status = 0;
      const next = vi.fn();
      const parser = vi.fn();
      const res = { status: (c: number) => ((status = c), res), json: () => res };
      elfPhotoBodyGuard(parser)({ method, headers: cookie ? { cookie } : {} } as unknown as Request, res as unknown as Response, next);
      return { status, next, parser };
    };
    const signedIn = guard(SESSION);
    expect(signedIn.parser).toHaveBeenCalledTimes(1);
    // The parser goes on to the route itself.
    expect(signedIn.parser.mock.calls[0][2]).toBe(signedIn.next);
    for (const bad of [undefined, "other=1", "nbcc_elf_session=not%20ours!", `nbcc_elf_session=${"a".repeat(101)}`]) {
      const g = guard(bad);
      expect(g.parser, String(bad)).not.toHaveBeenCalled();
      expect(g.next, String(bad)).not.toHaveBeenCalled();
      expect(g.status).toBe(401);
    }
    for (const method of ["DELETE", "GET", "PUT"]) {
      const g = guard(SESSION, method);
      expect(g.parser, method).not.toHaveBeenCalled();
      expect(g.next, method).toHaveBeenCalledTimes(1);
    }
  });
});
