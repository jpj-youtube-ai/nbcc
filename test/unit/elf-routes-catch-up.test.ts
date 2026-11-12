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
// never kept by a browser or a shared cache. Driven over HTTP through the real router, as
// test/unit/elf-routes-game.test.ts drives it, with the database mocked and the doors built by the real
// loaders from the mocked door rows. The clock is 7:05pm on Monday 7 December 2026 unless a test says
// otherwise: door 7, found at 5:47pm, has had its place shown since 7pm, and doors 1 to 6 were snowed
// in, so door 7 is the only open door. Every family, place, clue and word here is invented.

const db = vi.hoisted(() => ({ getElfSettings: vi.fn(), findElfSession: vi.fn(), familyWithDetectives: vi.fn() }));
const doors = vi.hoisted(() => ({ listElfDoors: vi.fn(), getElfDoor: vi.fn(), findElfDoorByPosterCode: vi.fn(), ensureElfDoors: vi.fn() }));
const practice = vi.hoisted(() => ({ getPractice: vi.fn() }));
const game = vi.hoisted(() => ({
  markAutomaticSnowDays: vi.fn(),
  familyKnowledge: vi.fn(),
  familyDoorsDone: vi.fn(),
  familyPhoto: vi.fn(),
  finderParts: vi.fn(),
  doorCounts: vi.fn(),
  doorScrapbook: vi.fn(),
  doorPhotos: vi.fn(),
  approvedPhoto: vi.fn(),
}));

vi.mock("../../src/db/elf", () => db);
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf-practice", () => practice);
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-game")>()), ...game }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import { elfRouter, resetPublicCalendar } from "../../src/routes/elf";
import { loadDoorRuns } from "../../src/db/elf-game";
import type { FamilyKnowledge } from "../../src/elf/catch-up";
import { doorDetail, doorTile } from "../../src/elf/pages/door";
import type { Scrapbook } from "../../src/elf/scrapbook";
import { calendarViewFor, familyDoorView } from "../../src/elf/views";
import { at, callerAt, door3, door6, door7, doorsDoneFromRuns, FAMILY, FIVE_47, OFF, ON, PRACTICE_PASS, practiceRow, SEVEN_05, SIX_10, snowedIn, TOKEN } from "./elf-routes-fixtures";

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
  db.getElfSettings.mockResolvedValue(ON);
  db.findElfSession.mockResolvedValue({ familyId: 3 });
  db.familyWithDetectives.mockImplementation(async (id: number) => (id === 3 ? FAMILY : null));
  doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7()]);
  doors.getElfDoor.mockImplementation(async (_y: number, d: number) => (d === 7 ? foundDoor7() : null));
  practice.getPractice.mockResolvedValue(null);
  game.markAutomaticSnowDays.mockResolvedValue([]);
  game.familyKnowledge.mockResolvedValue(knowledge());
  game.familyDoorsDone.mockImplementation(doorsDoneFromRuns);
  game.familyPhoto.mockResolvedValue(null);
  game.finderParts.mockResolvedValue(FINDERS);
  game.doorCounts.mockResolvedValue(COUNTS);
  game.doorScrapbook.mockResolvedValue(BOOK);
  game.doorPhotos.mockResolvedValue([PHOTO]);
  game.approvedPhoto.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from("the photo") });
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
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(String(r.data.detail)).toContain("The Example Bakehouse");
    expect(String(r.data.tile)).toContain("The Example Bakehouse");
    expect(String(r.data.detail)).toContain(PHOTO.url);
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(doors.getElfDoor).toHaveBeenCalledWith(2026, 7);
    expect(game.doorPhotos).toHaveBeenCalledWith(2026, 7);
  });

  it("is drawn as the calendar draws a door: the shared door, with the family's place and the door's photos laid on", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    const shared = await sharedDoor7();
    // The shared door names no place: the family's comes only from its own door.
    expect(shared.place).toBeNull();
    const mine = familyDoorView(shared, { place: { name: "The Example Bakehouse", town: "Exampleton" }, photos: [PHOTO] });
    expect(r.data).toEqual({ tile: doorTile(mine, SEVEN_05), detail: doorDetail(mine, ctx) });
  });

  it("takes an empty town for a place with none", async () => {
    doors.getElfDoor.mockResolvedValue(foundDoor7({ placeTown: null }));
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    const mine = familyDoorView(await sharedDoor7(), { place: { name: "The Example Bakehouse", town: "" }, photos: [PHOTO] });
    expect(r.data).toEqual({ tile: doorTile(mine, SEVEN_05), detail: doorDetail(mine, ctx) });
  });

  it("comes to a family whose detective typed door 7's tag word, though it never guessed", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
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
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for a door still shut on the shared calendar, door 8, and nothing more is read", async () => {
    const r = await call("GET", "/api/elf/me/door/8");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  // The one rule's own words would let a detective who typed the tag word see the place at once; the
  // place is never shown before the door is open (rulings on Plan 2c-1, the notes for every task that
  // shows a place).
  it("is not found while door 7's place is still hidden, at 6:10pm, even for the family that found its elf and guessed", async () => {
    vi.setSystemTime(SIX_10);
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.text).not.toContain("Example Bakehouse");
    expect(game.familyKnowledge).not.toHaveBeenCalled();
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for an open door with no place", async () => {
    doors.listElfDoors.mockResolvedValue([...snowedIn([1, 2, 3, 4, 5, 6]), foundDoor7({ placeName: null, placeTown: null })]);
    doors.getElfDoor.mockResolvedValue(foundDoor7({ placeName: null, placeTown: null }));
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await call("GET", "/api/elf/me/door/7");
    expect(r.status).toBe(404);
    expect(r.data).toEqual({ error: "Not found" });
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found for anything but a real door: never the practice door", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [0, 7] }));
    for (const bad of ["0", "25", "x", "7.5"]) expect((await call("GET", `/api/elf/me/door/${bad}`)).status, bad).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    expect((await call("GET", "/api/elf/me/door/0", { cookie: PRACTICE_PASS })).status).toBe(404);
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found with December's doors off, even for a browser playing the practice door", async () => {
    db.getElfSettings.mockResolvedValue(OFF);
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    expect((await call("GET", "/api/elf/me/door/7")).status).toBe(404);
    practice.getPractice.mockResolvedValue(practiceRow({ foundAt: SIX_10, foundFamilyId: 9 }));
    const practising = await call("GET", "/api/elf/me/door/7", { cookie: PRACTICE_PASS });
    expect(practising.status).toBe(404);
    expect(practising.data).toEqual({ error: "Not found" });
    expect(game.doorPhotos).not.toHaveBeenCalled();
  });

  it("is not found the moment December's doors go off, while the shared calendar's last build still has them on", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
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
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await call("GET", "/api/elf/me/door/7");
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
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
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
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7] }));
    const r = await photo();
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(Buffer.from("the photo"));
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(game.familyKnowledge).toHaveBeenCalledWith(2026, 3);
    expect(game.approvedPhoto).toHaveBeenCalledWith(2026, 7, TOKEN);
  });

  it("is served to a family whose detective typed the door's tag word, though it never guessed", async () => {
    game.familyKnowledge.mockResolvedValue(knowledge({ typed: [7] }));
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
    game.familyKnowledge.mockResolvedValue(knowledge({ guessed: [7], typed: [7] }));
    expect((await photo()).status).toBe(404);
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
    game.familyKnowledge.mockRejectedValue(new Error("connection lost"));
    const r = await photo();
    expect(r.status).toBe(500);
    expect(r.text).toBe(WORDS);
    expect(game.approvedPhoto).not.toHaveBeenCalled();
    logged.mockRestore();
  });
});
