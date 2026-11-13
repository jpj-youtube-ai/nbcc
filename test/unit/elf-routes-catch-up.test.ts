import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// NBCC Elf Detective School, catching up on missed doors (Plan 2c-1,
// docs/superpowers/plans/2026-11-12-elf-catch-up.md): a family's own places and photos. A family sees a
// door's place once the door is open and it has had its guess there, or once one of its detectives has
// typed the door's tag word (the one rule, src/elf/catch-up.ts); from Christmas Day until 1 January
// everyone sees every place. The calendar everyone shares carries no place, so a signed in family gets
// its own door from GET /api/elf/me/door/:n, and a door's photos go only to whoever may see its place,
// never kept by a browser or a shared cache. A family that missed a door's evening has a go at it on
// the door's own page in Detective HQ (GET /elf/hq/door/:n, POST /elf/hq/door/:n/go): the clues one at a
// time, then one guess. Driven over HTTP through the real router, as test/unit/elf-routes-game.test.ts
// drives it, with the database mocked and the doors built by the real loaders from the mocked door rows.
// The clock is 7:05pm on Monday 7 December 2026 unless a test says otherwise: door 7, found at 5:47pm, has
// had its place shown since 7pm and closes at 8:30pm, and doors 1 to 6 were snowed in, so door 7 is the
// only open door. Every family, place, clue and word here is invented.

const db = vi.hoisted(() => ({ getElfSettings: vi.fn(), findElfSession: vi.fn(), familyWithDetectives: vi.fn() }));
const doors = vi.hoisted(() => ({ listElfDoors: vi.fn(), getElfDoor: vi.fn(), findElfDoorByPosterCode: vi.fn(), ensureElfDoors: vi.fn() }));
const practice = vi.hoisted(() => ({ getPractice: vi.fn() }));
const game = vi.hoisted(() => ({
  markAutomaticSnowDays: vi.fn(),
  familyKnowledge: vi.fn(),
  familyKnowsDoor: vi.fn(),
  familyDoorsDone: vi.fn(),
  familyPhoto: vi.fn(),
  finderParts: vi.fn(),
  doorCounts: vi.fn(),
  doorScrapbook: vi.fn(),
  doorPhotos: vi.fn(),
  doorsPhotos: vi.fn(),
  approvedPhoto: vi.fn(),
  saveLateGuess: vi.fn(),
  saveGuess: vi.fn(),
  detectiveDoorsDone: vi.fn(),
}));

vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf-practice", () => practice);
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-game")>()), ...game }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
// What every page of the site gains in its banner and footer as it goes out (TASK-615) is not this file's
// to check: the pages here go out as drawn, as in test/unit/elf-routes-game.test.ts.
vi.mock("../../src/routes/site", () => ({ decorateSitePage: async (html: string) => html }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter, GUESS_LIMIT, resetElfLimits, resetPublicCalendar } from "../../src/routes/elf";
import { loadDoorRuns } from "../../src/db/elf-game";
import type { FamilyKnowledge } from "../../src/elf/catch-up";
import { ELF_NAMES } from "../../src/elf/names";
import { doorDetail, doorTile } from "../../src/elf/pages/door";
import { normalisePlaceName } from "../../src/elf/place-names";
import type { Scrapbook } from "../../src/elf/scrapbook";
import { calendarViewFor, familyDoorView } from "../../src/elf/views";
import { at, callerAt, door3, door6, door7, doorsDoneFromRuns, FAMILY, FIVE_47, knowsDoors, OFF, ON, PRACTICE_PASS, practiceRow, SEVEN_05, SIX_10, snowedIn, TOKEN } from "./elf-routes-fixtures";

/** Door 7, found at 5:47pm by another family: its place is shown at 7pm. */
const foundDoor7 = (over: Parameters<typeof door7>[0] = {}) => door7({ foundAt: FIVE_47, foundFamilyId: 9, ...over });
const FINDERS = [{ firstName: "Ava", surname: "Snowdrift", approved: true }];
/** Door 7's scrapbook on the calendar everyone shares: the finder's elf, and no photo. */
const BOOK: Scrapbook = {
  elves: [{ visitId: 5, detective: FINDERS[0], countsFrom: FIVE_47, found: true, pictureUrl: "/elf/door/7/elf/5.png" }],
  photos: [],
  count: 1,
};
const COUNTS = { cracked: 1, visited: 1 };
/** Door 7's photo, from a family's visit. */
const PHOTO = { token: TOKEN, url: `/elf/door/7/photo/${TOKEN}.jpg` };
const WORDS = "Something went wrong just now. Please try again in a few minutes.";

/** What the family has done: a guess on the night at each door in `guessed`, and a detective's typed tag
 *  word at each door in `typed`. */
function knowledge(o: { guessed?: number[]; typed?: number[] } = {}): FamilyKnowledge {
  return {
    guesses: new Map((o.guessed ?? []).map((d) => [d, { text: "Example Bakes", norm: "examplebakes", at: SIX_10, late: false }])),
    typed: new Set(o.typed ?? []),
  };
}

let server: Server;
let base = "";
beforeAll(async () => {
  const app = express();
  // As src/app.ts runs behind its proxy: a test can then send from an address other than the box itself,
  // whose requests are never limited.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(elfRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = callerAt(() => base);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SEVEN_05);
  for (const group of [db, doors, practice, game]) for (const f of Object.values(group)) f.mockReset();
  resetPublicCalendar();
  resetElfLimits();
  db.getElfSettings.mockResolvedValue(ON);
  db.findElfSession.mockResolvedValue({ familyId: 3 });
  db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? FAMILY : null));
  doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7()]);
  doors.getElfDoor.mockImplementation(async (_y: number, d: number) => (d === 7 ? foundDoor7() : null));
  practice.getPractice.mockResolvedValue(null);
  game.markAutomaticSnowDays.mockResolvedValue([]);
  game.familyKnowledge.mockResolvedValue(knowledge());
  game.familyKnowsDoor.mockImplementation(knowsDoors());
  game.familyDoorsDone.mockImplementation(doorsDoneFromRuns);
  game.familyPhoto.mockResolvedValue(null);
  game.finderParts.mockResolvedValue(FINDERS);
  game.doorCounts.mockResolvedValue(COUNTS);
  game.doorScrapbook.mockResolvedValue(BOOK);
  game.doorPhotos.mockResolvedValue([PHOTO]);
  // The photos of every door asked for, in one read: door 7 has the one photo.
  game.doorsPhotos.mockImplementation(async (_year: number, asked: number[]) => new Map(asked.map((d) => [d, d === 7 ? [PHOTO] : []])));
  game.approvedPhoto.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("the photo") });
  game.saveLateGuess.mockResolvedValue("saved");
  game.saveGuess.mockResolvedValue(true);
  game.detectiveDoorsDone.mockResolvedValue({ cracked: [], visited: [], snow: [] });
});
afterEach(() => vi.useRealTimers());

// ---- the family's marks --------------------------------------------------------------------------

describe("the family's marks with December's doors on", () => {
  it("say a family that guessed door 7 on the night can see its place, and has no door to crack", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(200);
    expect(r.data.known).toEqual([7]);
    expect(r.data.goes).toEqual([]);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("say a family that has done nothing at door 7 can see no place, and may crack door 7", async () => {
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(200);
    expect(r.data.known).toEqual([]);
    expect(r.data.goes).toEqual([7]);
  });

  it("list the doors whose place the family can see in door order, and the doors it may still crack newest first", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 4, 5]), door3(), door6(), foundDoor7()]);
    expect((await call("GET", "/api/elf/me")).data).toMatchObject({ known: [], goes: [7, 6, 3] });
    // A guess on the night at door 7, and a detective's visit to door 3.
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [3] }));
    expect((await call("GET", "/api/elf/me")).data).toMatchObject({ known: [3, 7], goes: [6] });
  });

  it("answer 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    logged.mockRestore();
  });
});

describe("the family's marks with December's doors off", () => {
  beforeEach(() => db.getElfSettings.mockResolvedValue(OFF));

  it("are exactly today's: their keys are doors and photos, and nothing about places is read", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [7] }));
    const r = await call("GET", "/api/elf/me");
    expect(r.status).toBe(200);
    expect(Object.keys(r.data)).toEqual(["doors", "photos"]);
    expect(r.data).toEqual({ doors: [], photos: [] });
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("are exactly today's for a browser playing the practice door too", async () => {
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const r = await call("GET", "/api/elf/me", { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(Object.keys(r.data)).toEqual(["doors", "photos"]);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });
});

// ---- the family's own door -----------------------------------------------------------------------

describe("a family's own door", () => {
  const ctx = { now: SEVEN_05, joinUrl: "/elf/join", hqUrl: "/elf/hq" };

  /** Door 7 as the calendar everyone shares draws it at 7:05pm, from the same door rows the route reads. */
  async function sharedDoor7() {
    const runs = await loadDoorRuns(2026, SEVEN_05);
    const view = calendarViewFor({ settings: ON, now: SEVEN_05, runs, finders: new Map([[7, FINDERS]]), counts: new Map([[7, COUNTS]]), scrapbooks: new Map([[7, BOOK]]) });
    return view.doors.find((d) => d.door === 7)!;
  }

  it("comes to a family that can see door 7's place, with its place and its photos, and is never kept", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(String(r.data.detail)).toContain("The Example Bakehouse");
    expect(String(r.data.tile)).toContain("The Example Bakehouse");
    expect(String(r.data.detail)).toContain(PHOTO.url);
    expect(game.familyKnowsDoor).toHaveBeenCalledWith(2026, 7, 3);
    expect(doors.getElfDoor).toHaveBeenCalledWith(2026, 7);
    expect(game.doorPhotos).toHaveBeenCalledWith(2026, 7);
  });

  it("is drawn as the calendar draws a door: the shared door, with the family's place and the door's photos laid on", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    const shared = await sharedDoor7();
    // The shared door names no place: the family's comes only from its own door.
    expect(shared.place).toBeNull();
    const mine = familyDoorView(shared, { place: { name: "The Example Bakehouse", town: "Exampleton" }, photos: [PHOTO] });
    expect(r.data).toEqual({ tile: doorTile(mine, SEVEN_05), detail: doorDetail(mine, ctx) });
  });

  it("takes an empty town for a place with none", async () => {
    doors.getElfDoor.mockResolvedValue(foundDoor7({ placeTown: null }));
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    const mine = familyDoorView(await sharedDoor7(), { place: { name: "The Example Bakehouse", town: "" }, photos: [PHOTO] });
    expect(r.data).toEqual({ tile: doorTile(mine, SEVEN_05), detail: doorDetail(mine, ctx) });
  });

  it("comes to a family whose detective typed door 7's tag word, though it never guessed", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ typed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(200);
    expect(String(r.data.detail)).toContain("The Example Bakehouse");
  });

  it("is not found for a family that cannot see the place, and nothing more is read", async () => {
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.text).not.toContain("Example Bakehouse");
    expect(game.familyKnowsDoor).toHaveBeenCalledWith(2026, 7, 3);
    expect(doors.getElfDoor).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("asks someone signed out to sign in, and reads nothing of the family's", async () => {
    const r = await call("GET", "/api/elf/me/door/7", { cookie: null });
    expect(r.status).toBe(401);
    expect(r.data).toEqual({ error: "Not signed in" });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    db.findElfSession.mockResolvedValue(null);
    expect((await call("GET", "/api/elf/me/door/7")).status).toBe(401);
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for a door still shut on the shared calendar, door 8, and nothing more is read", async () => {
    const r = await call("GET", "/api/elf/me/door/8");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  // The one rule's own words would let a detective who typed the tag word see the place at once; the
  // place is never shown before the door is open (rulings on Plan 2c-1, the notes for every task that
  // shows a place).
  it("is not found while door 7's place is still hidden, at 6:10pm, even for the family that found its elf and guessed", async () => {
    vi.setSystemTime(SIX_10);
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7], typed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.text).not.toContain("Example Bakehouse");
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for an open door with no place", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7({ placeName: null, placeTown: null })]);
    doors.getElfDoor.mockResolvedValue(foundDoor7({ placeName: null, placeTown: null }));
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    // It is the place that is missing: the family can see it, and the door was read.
    expect(game.familyKnowsDoor).toHaveBeenCalled();
    expect(doors.getElfDoor).toHaveBeenCalledWith(2026, 7);
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  // Rulings on Plan 2c-1, from Task 5's review: a place cleared to spaces is no place, as everywhere else.
  it("is not found for an open door whose place is only spaces", async () => {
    doors.getElfDoor.mockResolvedValue(foundDoor7({ placeName: "   ", placeTown: null }));
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    expect(doors.getElfDoor).toHaveBeenCalledWith(2026, 7);
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for anything but a real door: never the practice door", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [0, 7] }));
    for (const bad of ["0", "25", "x", "7.5"]) expect((await call("GET", `/api/elf/me/door/${bad}`)).status, bad).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    expect((await call("GET", "/api/elf/me/door/0", { cookie: PRACTICE_PASS })).status).toBe(404);
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found with December's doors off, even for a browser playing the practice door", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    expect((await call("GET", "/api/elf/me/door/7")).status).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const practising = await call("GET", "/api/elf/me/door/7", { cookie: PRACTICE_PASS });
    expect(practising.status).toBe(404);
    expect(practising.data).toEqual({ error: "Not found" });
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found the moment December's doors go off, while the shared calendar's last build still has them on", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    expect((await call("GET", "/api/elf/me/door/7")).status).toBe(200);
    // Switched off a moment ago: the calendar built with the doors on is still shared, for up to 15 seconds.
    db.getElfSettings.mockResolvedValue(OFF);
    const practising = await call("GET", "/api/elf/me/door/7", { cookie: PRACTICE_PASS });
    expect(practising.status).toBe(404);
    expect(practising.data).toEqual({ error: "Not found" });
    expect(doors.listElfDoors).toHaveBeenCalledTimes(1);
  });

  it("comes to a family that cannot see the place only from midnight as Christmas Day begins until 1 January", async () => {
    const moments: [Date, number][] = [
      [at("2026-12-24T23:59:59.000Z"), 404],
      [at("2026-12-25T00:00:00.000Z"), 200],
      [at("2026-12-31T23:59:59.000Z"), 200],
      [at("2027-01-01T00:00:00.000Z"), 404],
    ];
    for (const [now, status] of moments) {
      vi.setSystemTime(now);
      resetPublicCalendar();
      const r = await call("GET", "/api/elf/me/door/7");
      expect(r.status, now.toISOString()).toBe(status);
      expect(r.headers.get("cache-control"), now.toISOString()).toBe("private, no-store");
      if (status === 200) expect(String(r.data.detail), now.toISOString()).toContain("The Example Bakehouse");
    }
  });

  it("answers 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowsDoor.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain("connection lost");
    expect(lines).not.toContain("Example Bakehouse");
    logged.mockRestore();
  });
});

// ---- asking about one door (the whole-branch review, Important 2) --------------------------------
//
// A photo, and a family's own door, ask about one door, so they read only what the family has done at that
// door (familyKnowsDoor), never its whole year (familyKnowledge, which the batch, /api/elf/me and Detective HQ
// still read). The one rule is the same: the door open, and a guess or a visit there.

describe("asking about one door", () => {
  const photo = () => call("GET", `/elf/door/7/photo/${TOKEN}.jpg`);
  const own = () => call("GET", "/api/elf/me/door/7");

  it("reads only door 7's guess and visits for the family's own door, never the family's whole year", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await own();
    expect(r.status).toBe(200);
    expect(game.familyKnowsDoor).toHaveBeenCalledTimes(1);
    expect(game.familyKnowsDoor).toHaveBeenCalledWith(2026, 7, 3);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("reads only door 7's guess and visits for a photo, never the family's whole year", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ typed: [7] }));
    const r = await photo();
    expect(r.status).toBe(200);
    expect(game.familyKnowsDoor).toHaveBeenCalledTimes(1);
    expect(game.familyKnowsDoor).toHaveBeenCalledWith(2026, 7, 3);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("keeps the one rule: a guess or a visit at door 7 shows it, a guess or a visit at another door does not", async () => {
    for (const [done, status] of [
      [{ guessed: [7] }, 200],
      [{ typed: [7] }, 200],
      [{ guessed: [7], typed: [7] }, 200],
      [{ guessed: [3], typed: [6] }, 404],
      [{}, 404],
    ] as const) {
      game.familyKnowsDoor.mockImplementation(knowsDoors(done));
      expect((await own()).status, JSON.stringify(done)).toBe(status);
      expect((await photo()).status, JSON.stringify(done)).toBe(status);
    }
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });
});

// ---- every door a family can see, in one answer (Task 8) -----------------------------------------
//
// The rulings on Plan 2c-1, from Task 5's report: the calendar's script draws the doors a family can see from
// one private answer holding all of them, with every door's photos read in one query, never one request a door.

describe("a family's own doors, all in one answer", () => {
  const mine = (cookie?: string | null) => call("GET", "/api/elf/me/doors", { cookie });
  /** Doors 3 and 6, found on their days, are open beside door 7: doors 1, 2, 4 and 5 were snowed in. */
  const withDoors3And6 = () => doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 4, 5]), door3(), door6(), foundDoor7()]);
  const doorNumbers = (data: Record<string, unknown>) => (data.doors as { door: number }[]).map((d) => d.door);

  it("come in door order, each drawn exactly as the family's own door is, with every door's photos read in one query, never kept", async () => {
    withDoors3And6();
    // A guess on the night at door 7, and a detective's visit to door 3: the family cannot see door 6's place.
    // The batch reads the family's year; the one door's route below reads that door alone.
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [3] }));
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7], typed: [3] }));
    const r = await mine();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(doorNumbers(r.data)).toEqual([3, 7]);
    const [three, seven] = r.data.doors as { door: number; tile: string; detail: string }[];
    expect(three.detail).toContain("The Old Example Mill");
    expect(seven.detail).toContain("The Example Bakehouse");
    expect(seven.detail).toContain(PHOTO.url);
    expect(r.text).not.toContain("The Example Mill");
    expect(game.familyKnowledge).toHaveBeenCalledTimes(1);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.doorsPhotos).toHaveBeenCalledTimes(1);
    expect(game.doorsPhotos).toHaveBeenCalledWith(2026, [3, 7]);
    // Nothing is read a door at a time.
    expect(game.doorPhotos).not.toHaveBeenCalled();
    expect(doors.getElfDoor).not.toHaveBeenCalled();
    // Door 7 is drawn exactly as its own route draws it.
    const one = await call("GET", "/api/elf/me/door/7");
    expect(seven).toEqual({ door: 7, ...one.data });
  });

  it("are none for a family that can see no door's place, and no photo is read", async () => {
    const r = await mine();
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ doors: [] });
    expect(r.text).not.toContain("Example Bakehouse");
    expect(game.doorsPhotos).not.toHaveBeenCalled();
  });

  it("ask someone signed out to sign in, and read nothing of the family's", async () => {
    const r = await mine(null);
    expect(r.status).toBe(401);
    expect(r.data).toEqual({ error: "Not signed in" });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorsPhotos).not.toHaveBeenCalled();
  });

  it("leave out door 7 while its place is still hidden, at 6:10pm, even for the family that found its elf and guessed, and nothing more is read", async () => {
    vi.setSystemTime(SIX_10);
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [7] }));
    const r = await mine();
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ doors: [] });
    expect(r.text).not.toContain("Example Bakehouse");
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorsPhotos).not.toHaveBeenCalled();
  });

  it("leave out an open door with no place, and read no photo for it", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7({ placeName: "  ", placeTown: null })]);
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await mine();
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ doors: [] });
    expect(game.familyKnowledge).toHaveBeenCalled();
    expect(game.doorsPhotos).not.toHaveBeenCalled();
  });

  it("are not found with December's doors off, even for a browser playing the practice door", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    expect((await mine()).status).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const practising = await mine(PRACTICE_PASS);
    expect(practising.status).toBe(404);
    expect(practising.data).toEqual({ error: "Not found" });
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorsPhotos).not.toHaveBeenCalled();
  });

  it("draw every open door from midnight as Christmas Day begins until 1 January, as the family's own door does, without reading what it has done", async () => {
    const moments: [Date, number[]][] = [
      [at("2026-12-24T23:59:59.000Z"), []],
      [at("2026-12-25T00:00:00.000Z"), [7]],
      [at("2026-12-31T23:59:59.000Z"), [7]],
      [at("2027-01-01T00:00:00.000Z"), []],
    ];
    for (const [now, shown] of moments) {
      vi.setSystemTime(now);
      resetPublicCalendar();
      game.familyKnowledge.mockClear();
      const r = await mine();
      expect(r.status, now.toISOString()).toBe(200);
      expect(r.headers.get("cache-control"), now.toISOString()).toBe("private, no-store");
      expect(doorNumbers(r.data), now.toISOString()).toEqual(shown);
      expect(game.familyKnowledge.mock.calls.length, now.toISOString()).toBe(shown.length > 0 ? 0 : 1);
    }
  });

  it("put nothing of the family's into the calendar everyone shares", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    expect(String((await mine()).text)).toContain("The Example Bakehouse");
    const r = await call("GET", "/api/elf/door/7", { cookie: null });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("Example Bakehouse");
    expect(r.text).not.toContain(PHOTO.url);
  });

  it("answer 500 with the game's words when what the family has done cannot be read, and log no place", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await mine();
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain("connection lost");
    expect(lines).not.toContain("Example Bakehouse");
    logged.mockRestore();
  });
});

// ---- the calendar everyone shares ----------------------------------------------------------------

describe("the calendar everyone shares", () => {
  it("names no place on door 7, whoever asks, a family that can see it included", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    for (const cookie of [null, undefined]) {
      const r = await call("GET", "/api/elf/door/7", { cookie });
      expect(r.status).toBe(200);
      expect(r.text).toContain("Wigglepop was found!");
      expect(r.text).not.toContain("Example Bakehouse");
      expect(r.text).not.toContain("Exampleton");
      expect(r.headers.get("cache-control")).toBe("public, max-age=15");
    }
  });

  it("still names no place on door 7 after a family that can see it has had its own door: nothing of it goes into the shared calendar", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    expect(String((await call("GET", "/api/elf/me/door/7")).data.detail)).toContain("The Example Bakehouse");
    const r = await call("GET", "/api/elf/door/7", { cookie: null });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("Example Bakehouse");
    expect(r.text).not.toContain(PHOTO.url);
    // The one build of the calendar, handed to everyone who asks inside 15 seconds.
    expect(doors.listElfDoors).toHaveBeenCalledTimes(1);
  });
});

// ---- a door's photos -----------------------------------------------------------------------------

describe("a photo on a door", () => {
  const photo = (cookie?: string | null) => call("GET", `/elf/door/7/photo/${TOKEN}.jpg`, { cookie });

  it("is served to a family that can see the door's place, and kept by no cache", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7] }));
    const r = await photo();
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(Buffer.from("the photo"));
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(game.familyKnowsDoor).toHaveBeenCalledWith(2026, 7, 3);
    expect(game.approvedPhoto).toHaveBeenCalledWith(2026, 7, TOKEN);
  });

  it("is served to a family whose detective typed the door's tag word, though it never guessed", async () => {
    game.familyKnowsDoor.mockImplementation(knowsDoors({ typed: [7] }));
    expect((await photo()).status).toBe(200);
  });

  it("is not found for a signed in family that has not had its guess at the door, and the photo is never read", async () => {
    const r = await photo();
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(game.approvedPhoto).not.toHaveBeenCalled();
  });

  it("is not found while the place is still hidden, at 6:10pm, even for the family that found the elf and guessed", async () => {
    vi.setSystemTime(SIX_10);
    game.familyKnowsDoor.mockImplementation(knowsDoors({ guessed: [7], typed: [7] }));
    expect((await photo()).status).toBe(404);
    expect(game.familyKnowsDoor).not.toHaveBeenCalled();
    expect(game.approvedPhoto).not.toHaveBeenCalled();
  });

  it("is served to someone signed out only from midnight as Christmas Day begins until 1 January, and kept by no cache even then", async () => {
    const moments: [Date, number][] = [
      [SEVEN_05, 404],
      [at("2026-12-24T23:59:59.000Z"), 404],
      [at("2026-12-25T00:00:00.000Z"), 200],
      [at("2026-12-31T23:59:59.000Z"), 200],
      [at("2027-01-01T00:00:00.000Z"), 404],
    ];
    for (const [now, status] of moments) {
      vi.setSystemTime(now);
      const r = await photo(null);
      expect(r.status, now.toISOString()).toBe(status);
      expect(r.headers.get("cache-control"), now.toISOString()).toBe("private, no-store");
      if (status === 200) expect(r.bytes, now.toISOString()).toEqual(Buffer.from("the photo"));
    }
    expect(game.approvedPhoto).toHaveBeenCalledTimes(2);
  });

  it("answers 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowsDoor.mockRejectedValue(new Error("connection lost"));
    const r = await photo();
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    expect(game.approvedPhoto).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});

// ---- having a go: a door's own page in Detective HQ ----------------------------------------------

/** How many clue notes a page holds. */
const clueNotes = (html: string) => (html.match(/<li class="elf-clue">/g) ?? []).length;
const CRACKED_7 = "You cracked it! Wigglepop was hiding at The Example Bakehouse, Exampleton.";
const GO_FORM = 'action="/elf/hq/door/7/go"';

describe("a door's go page", () => {
  it("offers a family that missed door 7 clue 1 and its one guess, never kept by any cache", async () => {
    const r = await call("GET", "/elf/hq/door/7");
    expect(r.status).toBe(200);
    // Ruling F14: the family's own page.
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(clueNotes(r.text)).toBe(1);
    expect(r.text).toContain("Pretend clue one");
    expect(r.text).not.toContain("Pretend clue two");
    expect(r.text).toContain("Found by Detective Ava Snowdrift at 5:47pm.");
    expect(r.text).toContain(`<form class="elf-guess" method="post" ${GO_FORM}>`);
    expect(r.text).toContain("You get one guess at this door.");
    expect(r.text).toContain("The hiding place closes at 8:30pm today.");
    expect(r.text).toContain("<title>Door 7 |");
    for (const secret of ["Example Bakehouse", "Exampleton", "Example Bakes"]) expect(r.text).not.toContain(secret);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(game.finderParts).toHaveBeenCalledWith(2026, 7);
  });

  it("shows the clues asked for: two or three, and one for anything else", async () => {
    expect(clueNotes((await call("GET", "/elf/hq/door/7?clues=3")).text)).toBe(3);
    expect(clueNotes((await call("GET", "/elf/hq/door/7?clues=2")).text)).toBe(2);
    for (const odd of ["clues=4", "clues=0", "clues=x", "clues=", "clues=3&clues=3"]) {
      expect(clueNotes((await call("GET", `/elf/hq/door/7?${odd}`)).text), odd).toBe(1);
    }
  });

  it("sends a door that is not open back to Detective HQ: door 8 still shut, door 7 found with its place hidden, and door 7 snowed in", async () => {
    const shut = await call("GET", "/elf/hq/door/8");
    expect(shut.status).toBe(303);
    expect(shut.headers.get("location")).toBe("/elf/hq");
    vi.setSystemTime(SIX_10);
    expect((await call("GET", "/elf/hq/door/7")).headers.get("location")).toBe("/elf/hq");
    vi.setSystemTime(SEVEN_05);
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), door7({ snowDayAt: at("2026-12-07T17:30:00.000Z"), snowDayBy: "automatic" })]);
    const snowed = await call("GET", "/elf/hq/door/7");
    expect(snowed.status).toBe(303);
    expect(snowed.headers.get("location")).toBe("/elf/hq");
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("sends an open door with no place back to Detective HQ", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7({ placeName: "  ", placeTown: null })]);
    const r = await call("GET", "/elf/hq/door/7");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/hq");
  });

  it("asks someone signed out to sign in, and reads nothing of any family's", async () => {
    const r = await call("GET", "/elf/hq/door/7", { cookie: null });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/sign-in");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("shows a family that guessed door 7 on the night how it went, with its place and no form", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/elf/hq/door/7");
    expect(r.status).toBe(200);
    expect(r.text).toContain(CRACKED_7);
    expect(r.text).toContain("The Example Bakehouse closes at 8:30pm today.");
    expect(clueNotes(r.text)).toBe(0);
    expect(r.text).not.toContain(GO_FORM);
  });

  it("shows a family whose detective typed door 7's tag word where the elf was, and that it has been there", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
    const r = await call("GET", "/elf/hq/door/7");
    expect(r.text).toContain("Wigglepop was hiding at The Example Bakehouse, Exampleton.");
    expect(r.text).toContain("Your family has been there. Candy cane collected.");
    expect(r.text).not.toContain(GO_FORM);
  });

  it("is not found for anything but a door, nor for the practice door without the preview link, nor with December's doors off", async () => {
    for (const bad of ["25", "x", "7.5"]) expect((await call("GET", `/elf/hq/door/${bad}`)).status, bad).toBe(404);
    expect((await call("GET", "/elf/hq/door/0")).status).toBe(404);
    db.getElfSettings.mockResolvedValue(OFF);
    expect((await call("GET", "/elf/hq/door/7")).status).toBe(404);
    expect((await call("GET", "/elf/hq/door/7", { cookie: PRACTICE_PASS })).status).toBe(404);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
  });

  it("plays the practice door through the preview link, with December's doors off, naming no finder", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const r = await call("GET", "/elf/hq/door/0?clues=3", { cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(r.text).toContain("<title>The practice door |");
    expect(r.text).toContain("Tinsel, the practice door's elf");
    expect(clueNotes(r.text)).toBe(3);
    expect(r.text).toContain("Practice clue 1: it lives where the kettle lives.");
    expect(r.text).not.toContain("The Example Office");
    expect(game.familyKnowledge).toHaveBeenCalledWith(0, 3);
    expect(game.finderParts).not.toHaveBeenCalled();
  });

  it("answers 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/elf/hq/door/7");
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Example Bakehouse");
    logged.mockRestore();
  });
});

describe("having a go at a door", () => {
  const goAt = (text: unknown, o: { door?: string; cookie?: string | null; headers?: Record<string, string> } = {}) =>
    call("POST", `/elf/hq/door/${o.door ?? "7"}/go`, { json: { text }, cookie: o.cookie, headers: o.headers });
  const formGo = (form: Record<string, string>, o: { door?: string; cookie?: string | null } = {}) => call("POST", `/elf/hq/door/${o.door ?? "7"}/go`, { form, cookie: o.cookie });

  it("saves a family's one go, and says straight away that it cracked the case and where the elf was", async () => {
    const r = await goAt("the example bakehouse");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ cracked: true, message: CRACKED_7 });
    expect(game.saveLateGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "the example bakehouse", norm: "examplebakehouse" }, SEVEN_05);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });

  it("says not this time for a wrong go, still with where the elf was, and saves the go as typed, trimmed", async () => {
    const r = await goAt("  The Example Cafe ");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ cracked: false, message: "Not this time. Wigglepop was hiding at The Example Bakehouse, Exampleton." });
    expect(game.saveLateGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "The Example Cafe", norm: "examplecafe" }, SEVEN_05);
  });

  it("refuses a second go: the database keeps one, and a guess from the night is the family's go", async () => {
    game.saveLateGuess.mockResolvedValue("already");
    const r = await goAt("the example bakehouse");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "already", message: "You have already had your go at this door." });
    game.saveLateGuess.mockClear();
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const night = await goAt("the example bakehouse");
    expect(night.status).toBe(409);
    expect(night.data).toEqual({ reason: "already", message: "You have already had your go at this door." });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("tells a family whose detective typed the tag word that there is nothing to guess", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
    const r = await goAt("the example bakehouse");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "been-there", message: "Your family has been to this hiding place, so there is nothing to guess." });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("is closed from midnight as Christmas Day begins", async () => {
    vi.setSystemTime(at("2026-12-25T00:00:00.000Z"));
    const r = await goAt("the example bakehouse");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "closed", message: "Having a go closed on Christmas Day." });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("asks for a place when nothing is typed, naming the elf, and refuses a long one", async () => {
    const empty = await goAt("");
    expect(empty.status).toBe(400);
    expect(empty.data).toEqual({ reason: "empty", message: "Type where you think Wigglepop is hiding." });
    expect((await goAt("   ")).data.reason).toBe("empty");
    const long = await goAt("x".repeat(81));
    expect(long.status).toBe(400);
    expect(long.data).toEqual({ reason: "too-long", message: "That is a bit long. Up to 80 letters is plenty." });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("refuses a go at a door that is not open, door 8, never naming its elf", async () => {
    const r = await goAt("the example bakehouse", { door: "8" });
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ reason: "not-open", message: "There is nothing to guess at this door just now." });
    expect(r.text).not.toContain(ELF_NAMES[7]);
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("refuses a go at an open door with no place, as a door with nothing to guess", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7({ placeName: null, placeTown: null })]);
    const r = await goAt("example bakes");
    expect(r.status).toBe(404);
    expect(r.data).toMatchObject({ reason: "not-open" });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("is not found for anything but a door", async () => {
    for (const bad of ["25", "x"]) expect((await goAt("x", { door: bad })).status, bad).toBe(404);
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("goes back to the door's page after the plain form, which shows how it went", async () => {
    const r = await formGo({ text: "the example bakehouse" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/hq/door/7");
    expect(game.saveLateGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "the example bakehouse", norm: "examplebakehouse" }, SEVEN_05);
  });

  it("goes back to the door's page for the plain form's go once the family has had its go or been there", async () => {
    game.saveLateGuess.mockResolvedValue("already");
    expect((await formGo({ text: "the example cafe" })).headers.get("location")).toBe("/elf/hq/door/7");
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    expect((await formGo({ text: "the example cafe" })).headers.get("location")).toBe("/elf/hq/door/7");
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
    const been = await formGo({ text: "the example cafe" });
    expect(been.status).toBe(303);
    expect(been.headers.get("location")).toBe("/elf/hq/door/7");
  });

  it("draws the page again for the plain form's empty or long go, with the words in its status line and the clues it had showing", async () => {
    const empty = await formGo({ text: "  ", clues: "3" });
    expect(empty.status).toBe(400);
    expect(empty.headers.get("content-type")).toContain("text/html");
    expect(empty.headers.get("cache-control")).toBe("private, no-store");
    expect(empty.text).toContain('<p class="elf-guess__status is-error" role="status">Type where you think Wigglepop is hiding.</p>');
    expect(clueNotes(empty.text)).toBe(3);
    const long = await formGo({ text: "x".repeat(81) });
    expect(long.status).toBe(400);
    expect(long.text).toContain('<p class="elf-guess__status is-error" role="status">That is a bit long. Up to 80 letters is plenty.</p>');
    expect(clueNotes(long.text)).toBe(1);
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("draws the page closed for the plain form from Christmas Day", async () => {
    vi.setSystemTime(at("2026-12-25T00:00:00.000Z"));
    const r = await formGo({ text: "the example bakehouse" });
    expect(r.status).toBe(409);
    expect(r.text).toContain("Having a go closed on Christmas Day.");
    expect(r.text).not.toContain(GO_FORM);
  });

  it("sends the plain form's go at a door that is not open back to Detective HQ", async () => {
    const r = await formGo({ text: "the example bakehouse" }, { door: "8" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/elf/hq");
  });

  it("asks someone signed out to sign in, and refuses a go sent from another site", async () => {
    const out = await goAt("the example bakehouse", { cookie: null });
    expect(out.status).toBe(401);
    expect(out.data).toEqual({ error: "Please sign in again." });
    const outForm = await formGo({ text: "the example bakehouse" }, { cookie: null });
    expect(outForm.status).toBe(303);
    expect(outForm.headers.get("location")).toBe("/elf/sign-in");
    const elsewhere = await goAt("the example bakehouse", { headers: { Origin: "https://elsewhere.example" } });
    expect(elsewhere.status).toBe(403);
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  // Ruling F15: a go counts against the family's guesses, 60 in 15 minutes, from whatever address.
  it("limits each family's goes with its guesses: JSON is told, and the plain form's page says so in its status line", async () => {
    const goFrom = (address: string, json = true) =>
      call("POST", "/elf/hq/door/7/go", { ...(json ? { json: { text: "the example cafe" } } : { form: { text: "the example cafe" } }), headers: { "X-Forwarded-For": address } });
    expect(GUESS_LIMIT).toEqual({ max: 60, windowMs: 900_000 });
    for (let i = 1; i <= 60; i++) expect((await goFrom(`203.0.113.${i}`)).status, `go ${i}`).toBe(200);
    const r = await goFrom("203.0.113.61");
    expect(r.status).toBe(429);
    expect(r.data).toEqual({ reason: "too-many-requests", message: "Too many tries. Please wait a few minutes and try again." });
    const form = await goFrom("203.0.113.62", false);
    expect(form.status).toBe(429);
    expect(form.headers.get("content-type")).toContain("text/html");
    expect(form.text).toContain('<p class="elf-guess__status is-error" role="status">Too many tries. Please wait a few minutes and try again.</p>');
    expect(game.saveLateGuess).toHaveBeenCalledTimes(60);
  });

  it("plays the practice door through the preview link: a go there is door 0 of year 0", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const r = await call("POST", "/elf/hq/door/0/go", { json: { text: "the example office" }, cookie: PRACTICE_PASS });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ cracked: true, message: "You cracked it! Tinsel was hiding at The Example Office, Exampleton." });
    expect(game.saveLateGuess).toHaveBeenCalledWith(0, 0, 3, { text: "the example office", norm: "exampleoffice" }, SEVEN_05);
    expect(game.familyKnowledge).toHaveBeenCalledWith(0, 3);
  });

  it("answers 500 with the game's words when what the family has done cannot be read, and saves nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await goAt("the example bakehouse");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    expect(game.saveLateGuess).not.toHaveBeenCalled();
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain("connection lost");
    expect(lines).not.toContain("example bakehouse");
    logged.mockRestore();
  });
});

// ---- Detective HQ catches up (Task 7) ------------------------------------------------------------

describe("Detective HQ catching up", () => {
  const hq = (cookie?: string | null) => call("GET", "/elf/hq", { cookie });
  /** Doors 3 and 6, found on their days, are open beside door 7: doors 1, 2, 4 and 5 were snowed in. */
  const withDoors3And6 = () => doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 4, 5]), door3(), door6(), foundDoor7()]);

  it("offers a family that has done nothing at door 7 its one go, and never names the place", async () => {
    const r = await hq();
    expect(r.status).toBe(200);
    expect(r.text).toContain("Case closed");
    expect(r.text).toContain("You did not lock in a guess in time, but you can still crack this case, with one guess.");
    expect(r.text).toContain('<a class="elf-btn elf-btn--crimson" href="/elf/hq/door/7">Have a go<span class="sr-only"> at door 7</span></a>');
    for (const secret of ["Example Bakehouse", "Exampleton", "Example Bakes"]) expect(r.text).not.toContain(secret);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
  });

  it("shows a family that guessed door 7 on the night how it went, where the elf was and when the place closes, with no go", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await hq();
    expect(r.text).toContain("You cracked it!");
    expect(r.text).toContain("Wigglepop was hiding at The Example Bakehouse.");
    expect(r.text).toContain("The Example Bakehouse closes at 8:30pm today.");
    expect(r.text).not.toContain('href="/elf/hq/door/7"');
  });

  it("shows a family whose detective typed door 7's tag word where the elf was, with no go", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
    const r = await hq();
    expect(r.text).toContain("Wigglepop was hiding at The Example Bakehouse.");
    expect(r.text).not.toContain('href="/elf/hq/door/7"');
  });

  it("says when the place closes under the clues while door 7 is hunted, without naming it", async () => {
    vi.setSystemTime(SIX_10);
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), door7()]);
    const r = await hq();
    expect(r.text).toContain("The hiding place closes at 8:30pm today.");
    expect(r.text).not.toContain("Example Bakehouse");
  });

  it("lists the other doors the family can still crack under today's case, newest first, never naming their places", async () => {
    withDoors3And6();
    const r = await hq();
    expect(r.text).toContain("Doors you can still crack");
    const six = r.text.indexOf('href="/elf/hq/door/6"');
    expect(six).toBeGreaterThan(r.text.indexOf('id="elf-case-heading"'));
    expect(r.text.indexOf('href="/elf/hq/door/3"')).toBeGreaterThan(six);
    // Today's door is offered by today's case alone (ruling F9).
    expect(r.text.match(/href="\/elf\/hq\/door\/7"/g)?.length).toBe(1);
    for (const secret of ["Example Mill", "Example Bakehouse"]) expect(r.text).not.toContain(secret);
  });

  it("leaves a door off the list once the family has guessed it, rightly or wrongly, or been there", async () => {
    withDoors3And6();
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [6], typed: [3] }));
    const r = await hq();
    expect(r.status).toBe(200);
    expect(r.text).toContain('href="/elf/hq/door/7"');
    expect(r.text).not.toContain("Doors you can still crack");
    expect(r.text).not.toMatch(/href="\/elf\/hq\/door\/[36]"/);
  });

  it("plays the practice door's go through the preview link, with December's doors off", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const r = await hq(PRACTICE_PASS);
    expect(r.status).toBe(200);
    expect(r.text).toContain('href="/elf/hq/door/0">Have a go<span class="sr-only"> at the practice door</span></a>');
    expect(r.text).not.toContain("The Example Office");
    expect(r.text).not.toContain("Doors you can still crack");
    expect(game.familyKnowledge).toHaveBeenCalledWith(0, 3);
    expect(game.familyKnowledge).not.toHaveBeenCalledWith(2026, 3);
  });

  it("shows the practice door's place to a family that has had its practice guess, from the practice door's own rows", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    game.familyKnowledge.mockImplementation(async (year: number) => knowledge(year === 0 ? { guessed: [0] } : {}));
    const r = await hq(PRACTICE_PASS);
    expect(r.text).toContain("Tinsel was hiding at The Example Office.");
    expect(r.text).not.toContain('href="/elf/hq/door/0"');
  });

  // Review Focus 5: with December's doors off, Detective HQ is exactly today's.
  it("reads nothing of what the family has done with December's doors off, and draws no go, no list and no closing time", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    const r = await hq();
    expect(r.status).toBe(200);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    for (const words of ["Have a go", "Doors you can still crack", "closes at"]) expect(r.text).not.toContain(words);
  });

  it("answers 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await hq();
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// Ruling F7: a missed door's costume sends the family to Detective HQ only while it can still crack that door.
describe("the wardrobe's missed doors", () => {
  const wardrobe = () => call("GET", "/elf/hq/wardrobe/100");
  /** How many costume notes say these words: each door brings two costumes. */
  const notes = (html: string, words: string) => (html.match(new RegExp(`<span class="elf-wd-why" aria-hidden="true">${words}</span>`, "g")) ?? []).length;

  it("sends each missed door the family can still crack to Detective HQ, and only a door it cannot to the place", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 4, 5]), door3(), door6(), foundDoor7()]);
    game.detectiveDoorsDone.mockResolvedValue({ cracked: [], visited: [], snow: [1, 2, 4, 5] });
    const r = await wardrobe();
    expect(r.status).toBe(200);
    expect(notes(r.text, "Crack it in Detective HQ to catch up")).toBe(4);
    expect(notes(r.text, "Visit the place to catch up")).toBe(0);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    // Door 6 guessed on the night: the family knows its place, so its costumes say to visit.
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [6] }));
    const guessed = await wardrobe();
    expect(notes(guessed.text, "Crack it in Detective HQ to catch up")).toBe(2);
    expect(notes(guessed.text, "Visit the place to catch up")).toBe(2);
  });

  it("reads nothing of what the family has done with December's doors off, and says to visit, as today", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    const r = await wardrobe();
    expect(r.status).toBe(200);
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(r.text).not.toContain("Crack it in Detective HQ");
    expect(notes(r.text, "Visit the place to catch up")).toBeGreaterThan(0);
  });

  it("answers 500 with the game's words when what the family has done cannot be read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await wardrobe();
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    logged.mockRestore();
  });
});

// ---- the night's guess once a door is open (Task 7) ----------------------------------------------

const guess = (door: unknown, text: unknown, cookie?: string | null) => call("POST", "/api/elf/guess", { json: { door, text }, cookie });
const formGuess = (door: string, text: string, cookie?: string | null) => call("POST", "/api/elf/guess", { form: { door, text }, cookie });

describe("a guess sent once the place is shown", () => {
  it("tells a family with a guess at door 7 that it is locked in, sends it back to Detective HQ, and saves nothing", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await guess(7, "The Example Cafe");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "locked-in", message: "Your guess is locked in, and the hiding place is shown now.", goUrl: "/elf/hq" });
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("sends a family with no guess at door 7 to have its one go there, never saving the guess as its go", async () => {
    const r = await guess(7, "The Example Bakehouse");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "have-a-go", message: "The hiding place is shown now, so this is your one go at this door.", goUrl: "/elf/hq/door/7" });
    expect(game.saveGuess).not.toHaveBeenCalled();
    expect(game.saveLateGuess).not.toHaveBeenCalled();
  });

  it("sends the plain form back to Detective HQ, or to the go page", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const locked = await formGuess("7", "The Example Cafe");
    expect(locked.status).toBe(303);
    expect(locked.headers.get("location")).toBe("/elf/hq");
    game.familyKnowledge.mockResolvedValue(knowledge());
    const go = await formGuess("7", "The Example Cafe");
    expect(go.status).toBe(303);
    expect(go.headers.get("location")).toBe("/elf/hq/door/7");
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("tells a family that has been to door 7 but never guessed that there is nothing to guess", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
    const r = await guess(7, "The Example Bakehouse");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "not-hunting", message: "There is nothing to guess at this door just now." });
    // The plain form: Detective HQ drawn again, with the words in the case.
    const form = await formGuess("7", "The Example Bakehouse");
    expect(form.status).toBe(400);
    expect(form.text).toContain('<p class="elf-guess__status is-error" role="status">There is nothing to guess at this door just now.</p>');
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("tells a family its guess at a shut door has nothing to guess, never naming the door's elf", async () => {
    const r = await guess(8, "The Example Cafe");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "not-hunting", message: "There is nothing to guess at this door just now." });
    expect(r.text).not.toContain(ELF_NAMES[7]);
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("plays the practice door through the preview link: a family with no practice guess is sent to have its go there", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const r = await guess(0, "the example office", PRACTICE_PASS);
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ reason: "have-a-go", goUrl: "/elf/hq/door/0" });
    expect(game.familyKnowledge).toHaveBeenCalledWith(0, 3);
    expect(game.familyKnowledge).not.toHaveBeenCalledWith(2026, 3);
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  // Carried from Task 2: the night's save never replaces a go, and then the family is never told it saved.
  it("never says a guess was saved when the family's go was kept in its place", async () => {
    vi.setSystemTime(SIX_10);
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), door7()]);
    game.saveGuess.mockResolvedValue(false);
    const r = await guess(7, "The Example Cafe");
    expect(r.status).toBe(409);
    expect(r.data).toEqual({ reason: "already", message: "You have already had your go at this door." });
    expect(game.saveGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "The Example Cafe", norm: normalisePlaceName("The Example Cafe") }, SIX_10);
    const form = await formGuess("7", "The Example Cafe");
    expect(form.status).toBe(409);
    expect(form.text).toContain('<p class="elf-guess__status is-error" role="status">You have already had your go at this door.</p>');
  });

  it("answers 500 with the game's words when what the family has done cannot be read, and saves nothing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await guess(7, "The Example Bakehouse");
    expect(r.status).toBe(500);
    expect(r.data).toEqual({ error: WORDS });
    expect(game.saveGuess).not.toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("Example Bakehouse");
    logged.mockRestore();
  });
});

// Review Focus 3: a refusal names another open door only when the family can see that door's place, so it never
// gives a place away. At 5:47pm door 7 is hunted, and door 3, found last Thursday, is open.
describe("a guess naming another open door's place", () => {
  beforeEach(() => {
    vi.setSystemTime(FIVE_47);
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 4, 5, 6]), door3(), door7()]);
  });

  it("is saved like any other guess for a family that has neither guessed door 3 nor been there, and nothing says door 3", async () => {
    const r = await guess(7, "The Old Example Mill");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ ok: true, text: "The Old Example Mill" });
    expect(r.text).not.toContain("door 3");
    expect(game.saveGuess).toHaveBeenCalledWith(2026, 7, 3, { text: "The Old Example Mill", norm: normalisePlaceName("The Old Example Mill") }, FIVE_47);
  });

  it("is refused, naming door 3, for a family that guessed door 3", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [3] }));
    const r = await guess(7, "The Old Example Mill");
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ reason: "place-already-open", message: "That elf was already found behind door 3. Try again!", door: 3 });
    expect(game.saveGuess).not.toHaveBeenCalled();
  });

  it("is refused, naming door 3, by either of its names, for a family whose detective has been to door 3", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [3] }));
    expect((await guess(7, "Example Mill")).data).toMatchObject({ reason: "place-already-open", door: 3 });
    expect(game.saveGuess).not.toHaveBeenCalled();
  });
});
