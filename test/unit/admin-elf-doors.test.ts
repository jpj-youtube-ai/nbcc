import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School in the admin, Head Elf HQ: the Doors routes. Every place, prize and
// name here is invented.

const { getUserAuthRowMock, doors, settingsDb, processPictureMock, cluePictureMock } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
  processPictureMock: vi.fn(),
  cluePictureMock: vi.fn(),
  doors: {
    ensureElfDoors: vi.fn(),
    listElfDoors: vi.fn(),
    getElfDoor: vi.fn(),
    changeElfDoor: vi.fn(),
    addElfDoorName: vi.fn(),
    removeElfDoorName: vi.fn(),
    setElfTagWord: vi.fn(),
    markElfTagPrinted: vi.fn(),
    tickElfDoor: vi.fn(),
    saveElfClue: vi.fn(),
    saveElfCluePicture: vi.fn(),
    removeElfCluePicture: vi.fn(),
    savePastedClues: vi.fn(),
  },
  settingsDb: { getElfSettings: vi.fn(), setElfSettings: vi.fn(), setElfPreview: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf", () => settingsDb);
vi.mock("../../src/db/elf-game", () => ({ onDoorsSwitchedOn: vi.fn(), familyWordTries: vi.fn(), clearWordTries: vi.fn(), cluePicture: cluePictureMock }));
vi.mock("../../src/fundraising/picture-process", () => ({ processPicture: processPictureMock }));
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

import * as routes from "../../src/routes/admin-elf-doors";
import { patchAdminElfSettings } from "../../src/routes/admin-elf";
import { signAdminSession } from "../../src/admin/session";
import { pool } from "../../src/db/pool";
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import { isUsableSecretWord } from "../../src/elf/claim";
import type { Door } from "../../src/elf/calendar";
import { tinyJpeg } from "./fixtures/tiny-jpeg";

const ON = { schoolOn: true, year: 2026, entryFromPence: 100, entrySuggestedPence: 500, previewHash: null, placePhone: null };
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
const ask = (role: string, o: { body?: unknown; params?: object; query?: object; permissions?: object } = {}) => ({
  headers: { authorization: `Bearer ${tokenFor(role, o.permissions ?? {})}` },
  body: o.body ?? {},
  params: o.params ?? {},
  query: o.query ?? {},
});
const EDIT = { elf: "edit" };
const VIEW = { elf: "view" };
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (req: any, res: any) => Promise<unknown>;
const run = async (h: Handler, r: unknown) => {
  const res = mockRes();
  await h(r as any, res as any);
  return res;
};
const body = (res: { body: unknown }) => res.body as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const doorOf = (n: number, over: Partial<DoorSetup> = {}): DoorSetup => ({ ...emptyDoor(n as Door, "abcdefghijkm"), ...over });
const all24 = () => Array.from({ length: 24 }, (_, i) => doorOf(i + 1));
/** The users table, for the names of who called a snow day or ticked gone home. */
const users = (rows: { full_name: string; email: string }[]) =>
  vi.mocked(pool.query).mockImplementation((async (sql: string) => ({ rows: /FROM users/.test(String(sql)) ? rows : [] })) as never);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-07T17:31:00Z")); // 5:31pm in London: December has no clock change
  getUserAuthRowMock.mockReset();
  for (const f of [...Object.values(doors), ...Object.values(settingsDb)]) f.mockReset();
  settingsDb.getElfSettings.mockResolvedValue(ON);
  settingsDb.setElfSettings.mockImplementation(async (patch: object) => ({ ...ON, ...patch }));
  doors.listElfDoors.mockResolvedValue(all24());
  doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { tagWord: "SNOWBALL 472" }));
  for (const f of [doors.changeElfDoor, doors.saveElfClue, doors.setElfTagWord, doors.tickElfDoor, doors.addElfDoorName, doors.removeElfDoorName]) {
    f.mockImplementation(async (_y: number, n: number) => doorOf(n));
  }
  for (const f of [doors.saveElfCluePicture, doors.removeElfCluePicture]) f.mockImplementation(async (_y: number, n: number) => doorOf(n));
  processPictureMock.mockReset();
  cluePictureMock.mockReset();
  doors.savePastedClues.mockResolvedValue({ doors: 1, clues: 3 });
  vi.mocked(pool.query).mockReset();
  users([]);
});
afterEach(() => vi.useRealTimers());

describe("the doors list", () => {
  it("is for the elf section only", async () => {
    expect((await run(routes.getAdminElfDoors, ask("editor"))).statusCode).toBe(403);
    expect(doors.ensureElfDoors).not.toHaveBeenCalled();
  });

  it("gives 24 tiles, the counts and the prize list to a head elf who can only look", async () => {
    doors.listElfDoors.mockResolvedValue(all24().map((d) => (d.door === 7 ? { ...d, placeName: "Pine Cone Café", placeTown: "Ayr", placeAddress: "1 Example Street", prize: "A cake" } : d)));
    const res = await run(routes.getAdminElfDoors, ask("viewer", { permissions: VIEW }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(doors.ensureElfDoors).toHaveBeenCalledWith(2026);
    const b = body(res);
    expect(b.year).toBe(2026);
    expect(b.doors).toHaveLength(24);
    expect(b.doors[6]).toMatchObject({ door: 7, weekday: "Mon", placeName: "Pine Cone Café", ready: false, toDo: 3 });
    expect(b.counts).toEqual({ placesAgreed: 1, prizesChosen: 1, ready: 0 });
    expect(b.prizeList.split("\n")[6]).toBe("Door 7: A cake");
    expect(b.canEdit).toBe(false);
  });

  // 12 November 2026: every door carries the same present, so a door no longer waits on a picture.
  it("counts a door with everything in as ready, on its tile, in the counts and on its sheet, with no door picture", async () => {
    const full = doorOf(7, {
      placeName: "Pine Cone Café",
      placeTown: "Exampleton",
      placeAddress: "1 Example Street",
      prize: "A cake",
      elfName: "Pip",
      tagWord: "SNOWBALL 472",
      clues: [1, 2, 3].map((n) => ({ n: n as 1 | 2 | 3, words: `Pretend clue ${n}`, hasPicture: false, pictureAlt: null })),
      droppedOffAt: new Date("2026-12-01T10:00:00Z"),
    });
    doors.listElfDoors.mockResolvedValue(all24().map((d) => (d.door === 7 ? full : d)));
    const b = body(await run(routes.getAdminElfDoors, ask("viewer", { permissions: VIEW })));
    expect(b.doors[6]).toMatchObject({ door: 7, ready: true, toDo: 0 });
    expect(b.counts).toEqual({ placesAgreed: 1, prizesChosen: 1, ready: 1 });
    doors.getElfDoor.mockResolvedValue(full);
    const d = body(await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "7" } }))).door;
    expect(d.picture).toBeNull();
    expect(d.readiness).toEqual({
      items: ["place", "prize", "elf", "clues", "droppedOff"].map((key) => ({ key, done: true })),
      toDo: 0,
      ready: true,
    });
  });

  it("says for each tile whether its first clue is out yet", async () => {
    vi.setSystemTime(new Date("2026-12-08T12:00:00Z")); // noon in London on Tuesday 8 December
    const res = await run(routes.getAdminElfDoors, ask("viewer", { permissions: VIEW }));
    const b = body(res);
    expect(b.doors[6]).toMatchObject({ door: 7, started: true });
    expect(b.doors[7]).toMatchObject({ door: 8, started: false });
    expect(b.doors[23]).toMatchObject({ door: 24, started: false });
    expect(b.doors[0]).toMatchObject({ door: 1, started: true });
  });

  it("says canEdit to a head elf who can edit", async () => {
    const res = await run(routes.getAdminElfDoors, ask("viewer", { permissions: EDIT }));
    expect(body(res).canEdit).toBe(true);
  });
});

describe("one door's sheet", () => {
  it("has the day, the evening, which clues are out and the poster address", async () => {
    const res = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "7" } }));
    expect(res.statusCode).toBe(200);
    const d = body(res).door;
    expect(d).toMatchObject({ door: 7, day: "Monday 7 December", started: true, clueOut: [true, false, false], posterUrl: "https://example.org/elf/p/abcdefghijkm", picture: null });
    expect(d.evening).toMatchObject({ clue1: "17:30", clue2: "18:00", clue3: "18:30", reveal: "19:00" });
    const other = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }));
    expect(body(other).door).toMatchObject({ started: false, clueOut: [false, false, false] });
  });

  // TASK-613: places close early on Christmas Eve, so door 24 is a morning door unless a head elf sets
  // its own times. Head Elf HQ > Doors shows those morning times as the door's own.
  it("shows Christmas Eve's door at the morning times, and keeps times a head elf set", async () => {
    const res = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "24" } }));
    expect(body(res).door).toMatchObject({ door: 24, day: "Thursday 24 December", started: false });
    expect(body(res).door.evening).toEqual({ clue1: "10:00", clue2: "10:30", clue3: "11:00", reveal: "11:30", problems: [] });
    doors.getElfDoor.mockResolvedValue(doorOf(24, { clue1Time: "16:00:00" }));
    const set = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "24" } }));
    expect(body(set).door.evening).toMatchObject({ clue1: "16:00", clue2: "16:30", clue3: "17:00", reveal: "17:30" });
  });

  it("refuses a door that is not 1 to 24, and one with no row", async () => {
    for (const door of ["25", "0", "x", "07", "1.5"]) {
      const res = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door } }));
      expect(res.statusCode, door).toBe(400);
      expect(body(res)).toEqual({ error: "There is no door like that." });
    }
    doors.getElfDoor.mockResolvedValue(null);
    const res = await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "3" } }));
    expect(res.statusCode).toBe(404);
    expect(body(res)).toEqual({ error: "There is no door 3." });
  });
});

describe("every write handler", () => {
  const writes: [string, Handler, { body?: object; params?: object }][] = [
    ["patch", routes.patchAdminElfDoor, { body: { prize: "x" } }],
    ["add name", routes.postAdminElfDoorName, { body: { name: "x" } }],
    ["remove name", routes.deleteAdminElfDoorName, { params: { id: "3" } }],
    ["word", routes.postAdminElfDoorWord, {}],
    ["dropped off on", routes.postAdminElfDoorDroppedOff, {}],
    ["dropped off off", routes.deleteAdminElfDoorDroppedOff, {}],
    ["thanked on", routes.postAdminElfDoorThanked, {}],
    ["thanked off", routes.deleteAdminElfDoorThanked, {}],
    ["clue", routes.putAdminElfDoorClue, { params: { n: "2" }, body: { words: "x" } }],
    ["check", routes.postAdminElfCluesCheck, { body: { text: "Door 1" } }],
    ["save", routes.postAdminElfCluesSave, { body: { text: "Door 1" } }],
  ];
  it.each(writes)("%s refuses elf view with 403 and touches no data", async (_name, handler, o) => {
    const res = await run(handler, ask("viewer", { permissions: VIEW, body: o.body, params: { door: "8", ...(o.params ?? {}) } }));
    expect(res.statusCode).toBe(403);
    for (const f of Object.values(doors)) expect(f).not.toHaveBeenCalled();
  });
});

describe("changing a door", () => {
  const patch = (door: string, b: unknown) => run(routes.patchAdminElfDoor, ask("viewer", { permissions: EDIT, params: { door }, body: b }));

  it("passes only the given keys, blank words as null, and answers the sheet", async () => {
    const res = await patch("8", { placeName: " Pine Cone Café ", contactEmail: "", prizeShowOff: true });
    expect(res.statusCode).toBe(200);
    expect(doors.changeElfDoor).toHaveBeenCalledWith(2026, 8, { placeName: "Pine Cone Café", contactEmail: null, prizeShowOff: true }, ACTOR);
    expect(body(res).door.door).toBe(8);
  });

  it("refuses an unknown key, a bad door and bad values", async () => {
    const unknown = await patch("8", { colour: "red" });
    expect(unknown.statusCode).toBe(400);
    expect(body(unknown)).toEqual({ error: "That did not look right. Reload the page and try again." });
    const missing = await run(routes.postAdminElfCluesCheck, ask("viewer", { permissions: EDIT, body: {} }));
    expect(body(missing)).toEqual({ error: "That did not look right. Reload the page and try again." });
    expect((await patch("25", { prize: "x" })).statusCode).toBe(400);
    const bad = [{ contactPhone: "call me" }, { contactPhone: "123" }, { contactEmail: "nope" }, { placeName: "x".repeat(81) }, { prize: "x".repeat(201) }, { elfName: "x".repeat(31) }, { clue1Time: "25:00" }, { prizeShowOff: "yes" }];
    for (const b of bad) {
      const res = await patch("8", b);
      expect(res.statusCode, JSON.stringify(b)).toBe(400);
      expect(/^[A-Z]/.test(body(res).error)).toBe(true);
    }
    expect(doors.changeElfDoor).not.toHaveBeenCalled();
  });

  it("refuses an evening that is out of order", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(8, { clue1Time: "17:30" }));
    const res = await patch("8", { clue2Time: "17:00" });
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "Clue 2 must come after clue 1." });
  });

  it("refuses a time that would show door 24's place after 8pm on Christmas Eve", async () => {
    const res = await patch("24", { revealTime: "20:30" });
    expect(res.statusCode).toBe(400);
    expect(body(res)).toEqual({ error: "On Christmas Eve the place must be shown by 8pm." });
    expect((await patch("24", { revealTime: "20:00" })).statusCode).toBe(200);
    expect((await patch("23", { revealTime: "20:30" })).statusCode).toBe(200);
  });

  it("with clue 1 out, refuses new times but takes place details and the prize", async () => {
    const d7 = await patch("7", { clue3Time: "19:00" });
    expect(d7.statusCode).toBe(409);
    expect(body(d7)).toEqual({ error: "Door 7's evening has started, so its times cannot change." });
    expect((await patch("7", { placeName: "Pine Cone Café", prize: "A cake" })).statusCode).toBe(200);
    // sending the time it already has is not a change
    doors.getElfDoor.mockResolvedValue(doorOf(7, { clue3Time: "19:00:00" }));
    expect((await patch("7", { clue3Time: "19:00" })).statusCode).toBe(200);
    expect((await patch("8", { clue3Time: "19:00" })).statusCode).toBe(200);
  });

  it("404s a door with no row", async () => {
    doors.getElfDoor.mockResolvedValue(null);
    expect((await patch("8", { prize: "x" })).statusCode).toBe(404);
  });
});

describe("names", () => {
  const add = (door: string, b: unknown) => run(routes.postAdminElfDoorName, ask("viewer", { permissions: EDIT, params: { door }, body: b }));
  const remove = (door: string, id: string) => run(routes.deleteAdminElfDoorName, ask("viewer", { permissions: EDIT, params: { door, id } }));

  it("adds a name with 201, even once the evening has started", async () => {
    const res = await add("7", { name: "The Pine Cone" });
    expect(res.statusCode).toBe(201);
    expect(doors.addElfDoorName).toHaveBeenCalledWith(2026, 7, "The Pine Cone", ACTOR);
  });

  it("fixes names at midnight at the end of the door's day: 409 for door 6 and 201 for door 7", async () => {
    const late = await add("6", { name: "The Pine Cone" });
    expect(late.statusCode).toBe(409);
    expect(body(late)).toEqual({ error: "Door 6's day is over, so its names are fixed now." });
    expect(doors.addElfDoorName).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-12-07T23:59:30Z"));
    expect((await add("7", { name: "The Pine Cone" })).statusCode).toBe(201);
    vi.setSystemTime(new Date("2026-12-08T00:00:00Z"));
    expect((await add("7", { name: "The Pine Cone" })).statusCode).toBe(409);
  });

  it("refuses a name with no letter or number, and one already counting", async () => {
    for (const name of ["!!!", "The", "  ", ""]) {
      const res = await add("8", { name });
      expect(res.statusCode, name).toBe(400);
      expect(body(res)).toEqual({ error: "A name needs at least one letter or number." });
    }
    doors.addElfDoorName.mockResolvedValue("taken");
    const res = await add("8", { name: "Pine Cone" });
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "That name already counts for this door." });
    doors.addElfDoorName.mockResolvedValue(null);
    expect((await add("8", { name: "Pine Cone" })).statusCode).toBe(404);
  });

  it("removes a name before the evening starts, and not after", async () => {
    doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { names: [{ id: 3, name: "The Pine Cone" }, { id: 123456789, name: "Another" }] }));
    expect((await remove("8", "3")).statusCode).toBe(200);
    expect(doors.removeElfDoorName).toHaveBeenCalledWith(2026, 8, 3, ACTOR);
    const res = await remove("7", "3");
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "Door 7's evening has started, so names that count can only be added now." });
  });

  it("holds the id to a whole number inside the database's range", async () => {
    doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { names: [{ id: 123456789, name: "Another" }] }));
    for (const id of ["0", "01", "x", "1234567890", "-1"]) expect((await remove("8", id)).statusCode, id).toBe(400);
    expect((await remove("8", "123456789")).statusCode).toBe(200);
  });

  it("answers 404, with no change and no audit, for a name the door does not have", async () => {
    doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { names: [{ id: 3, name: "The Pine Cone" }] }));
    const res = await remove("8", "4");
    expect(res.statusCode).toBe(404);
    expect(body(res)).toEqual({ error: "There is no name like that on door 8." });
    expect(doors.removeElfDoorName).not.toHaveBeenCalled();
  });
});

describe("the word", () => {
  const word = (door: string, b: unknown = {}) => run(routes.postAdminElfDoorWord, ask("viewer", { permissions: EDIT, params: { door }, body: b }));

  it("makes a new usable word", async () => {
    const res = await word("8");
    expect(res.statusCode).toBe(200);
    const made = doors.setElfTagWord.mock.calls[0];
    expect(made[0]).toBe(2026);
    expect(made[1]).toBe(8);
    expect(isUsableSecretWord(made[2])).toBe(true);
  });

  it("counts clue 1 as out at exactly 5:30pm", async () => {
    vi.setSystemTime(new Date("2026-12-07T17:30:00Z"));
    expect((await word("7")).statusCode).toBe(409);
    vi.setSystemTime(new Date("2026-12-07T17:29:59Z"));
    expect((await word("7")).statusCode).toBe(200);
  });

  it("is refused once the elf is out", async () => {
    const res = await word("7");
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "Door 7's elf is out, so its word cannot change." });
  });

  it("asks first when the tag has been printed", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(8, { tagPrintedAt: new Date() }));
    const res = await word("8");
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "This door's tag has been printed. Make a new word only if you will print the tag again.", printed: true });
    expect(doors.setElfTagWord).not.toHaveBeenCalled();
    expect((await word("8", { confirm: true })).statusCode).toBe(200);
    expect(doors.setElfTagWord).toHaveBeenCalled();
  });
});

describe("the ticks", () => {
  it("tick and untick dropped off and thanked, even after the evening starts", async () => {
    const cases: [Handler, "droppedOff" | "thanked", boolean][] = [
      [routes.postAdminElfDoorDroppedOff, "droppedOff", true],
      [routes.deleteAdminElfDoorDroppedOff, "droppedOff", false],
      [routes.postAdminElfDoorThanked, "thanked", true],
      [routes.deleteAdminElfDoorThanked, "thanked", false],
    ];
    for (const [h, which, on] of cases) {
      const res = await run(h, ask("viewer", { permissions: EDIT, params: { door: "7" } }));
      expect(res.statusCode).toBe(200);
      expect(doors.tickElfDoor).toHaveBeenLastCalledWith(2026, 7, which, on, ACTOR);
    }
  });
});

describe("one clue", () => {
  const put = (door: string, n: string, b: unknown) => run(routes.putAdminElfDoorClue, ask("viewer", { permissions: EDIT, params: { door, n }, body: b }));

  it("saves words, or clears with null", async () => {
    expect((await put("8", "1", { words: " It is by the door. " })).statusCode).toBe(200);
    expect(doors.saveElfClue).toHaveBeenLastCalledWith(2026, 8, 1, "It is by the door.", ACTOR);
    expect((await put("8", "3", { words: null })).statusCode).toBe(200);
    expect(doors.saveElfClue).toHaveBeenLastCalledWith(2026, 8, 3, null, ACTOR);
  });

  it("refuses a clue that is out, the wrong n, and too many words", async () => {
    const out = await put("7", "1", { words: "x" });
    expect(out.statusCode).toBe(409);
    expect(body(out)).toEqual({ error: "Door 7, clue 1 is already out, so it cannot be changed." });
    expect((await put("7", "2", { words: "x" })).statusCode).toBe(200);
    expect((await put("8", "4", { words: "x" })).statusCode).toBe(400);
    const long = await put("8", "1", { words: "x".repeat(501) });
    expect(long.statusCode).toBe(400);
    expect(body(long)).toEqual({ error: "A clue can be up to 500 characters." });
    expect((await put("8", "1", { words: 5 })).statusCode).toBe(400);
  });
});

describe("a clue's picture", () => {
  const pic = (method: "put" | "del" | "get", door: string, n: string, b: unknown = {}, permissions: object = EDIT) => {
    const h = { put: routes.putAdminElfDoorCluePicture, del: routes.deleteAdminElfDoorCluePicture, get: routes.getAdminElfDoorCluePicture }[method];
    return run(h as Handler, ask("viewer", { permissions, params: { door, n }, body: b }));
  };
  const send = async (over: Record<string, unknown> = {}) => ({ mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64"), alt: "A red door", ...over });
  const made = { ok: true, mime: "image/jpeg", bytes: Buffer.from([9, 9]), width: 4, height: 4 };
  const ALT = "Describe the picture in a few words, for anyone who cannot see it.";

  it("needs alt words, one to 200 characters", async () => {
    const none = await pic("put", "8", "2", { mime: "image/jpeg", dataBase64: (await tinyJpeg()).toString("base64") });
    expect(none.statusCode).toBe(400);
    expect(body(none)).toEqual({ error: ALT });
    expect(body(await pic("put", "8", "2", await send({ alt: "   " }))).error).toBe(ALT);
    expect((await pic("put", "8", "2", await send({ alt: "x".repeat(201) }))).statusCode).toBe(400);
    expect(doors.saveElfCluePicture).not.toHaveBeenCalled();
    expect(processPictureMock).not.toHaveBeenCalled();
  });

  it("refuses a clue that is out, the same way the words are", async () => {
    const out = await pic("put", "7", "1", await send());
    expect(out.statusCode).toBe(409);
    expect(body(out)).toEqual({ error: "Door 7, clue 1 is already out, so it cannot be changed." });
    expect((await pic("del", "7", "1")).statusCode).toBe(409);
    expect(doors.saveElfCluePicture).not.toHaveBeenCalled();
    expect(doors.removeElfCluePicture).not.toHaveBeenCalled();
    expect(processPictureMock).not.toHaveBeenCalled();
  });

  it("makes the picture again and saves it, with the alt words, for a clue not yet out", async () => {
    processPictureMock.mockResolvedValue(made);
    const res = await pic("put", "7", "2", await send());
    expect(res.statusCode).toBe(200);
    expect(processPictureMock).toHaveBeenCalledWith("main", expect.any(Buffer));
    expect(doors.saveElfCluePicture).toHaveBeenCalledWith(2026, 7, 2, { mime: "image/jpeg", bytes: made.bytes, width: 4, height: 4 }, "A red door", ACTOR);
    expect(body(res).door).toMatchObject({ door: 7 });
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("answers a bad picture as the fundraisers route does", async () => {
    const type = await pic("put", "8", "2", await send({ mime: "image/gif" }));
    expect(type.statusCode).toBe(400);
    expect(body(type)).toEqual({ error: "Your picture needs another look", fields: { photo: "That picture is not one we can use. Try a JPG, PNG or WebP photo." } });
    expect((await pic("put", "8", "2", await send({ dataBase64: "not base64!" }))).statusCode).toBe(400);
    processPictureMock.mockResolvedValueOnce({ ok: false, reason: "busy" });
    expect((await pic("put", "8", "2", await send())).statusCode).toBe(503);
    processPictureMock.mockResolvedValueOnce({ ok: false, reason: "size" });
    expect((await pic("put", "8", "2", await send())).statusCode).toBe(413);
    processPictureMock.mockResolvedValueOnce({ ok: false, reason: "unreadable" });
    const read = await pic("put", "8", "2", await send());
    expect(read.statusCode).toBe(400);
    expect(body(read).fields.photo).toBe("We could not open that picture. Please try a different photo.");
    expect(doors.saveElfCluePicture).not.toHaveBeenCalled();
  });

  it("is for editing, a real door and clue 1 to 3", async () => {
    expect((await pic("put", "8", "2", await send(), VIEW)).statusCode).toBe(403);
    expect((await pic("del", "8", "2", {}, VIEW)).statusCode).toBe(403);
    expect((await pic("put", "8", "4", await send())).statusCode).toBe(400);
    expect((await pic("put", "99", "2", await send())).statusCode).toBe(400);
    doors.getElfDoor.mockResolvedValue(null);
    expect((await pic("put", "8", "2", await send())).statusCode).toBe(404);
    expect((await pic("del", "8", "2")).statusCode).toBe(404);
  });

  it("takes a picture off a clue that is not out", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(8, { clues: [1, 2, 3].map((n) => ({ n: n as 1 | 2 | 3, words: null, hasPicture: n === 3, pictureAlt: n === 3 ? "A red door" : null })) }));
    const res = await pic("del", "8", "3");
    expect(res.statusCode).toBe(200);
    expect(doors.removeElfCluePicture).toHaveBeenCalledWith(2026, 8, 3, ACTOR);
    expect(res.headers["Cache-Control"]).toBe("no-store");
  });

  it("answers 200 with the door as it is, and writes nothing, when the clue has no picture", async () => {
    const res = await pic("del", "8", "3");
    expect(res.statusCode).toBe(200);
    expect(body(res).door).toMatchObject({ door: 8 });
    expect(doors.removeElfCluePicture).not.toHaveBeenCalled();
  });

  it("reads a big body only for a PUT that carries a bearer token", () => {
    const want = (method: string, authorization?: string) => routes.elfCluePictureBodyWanted({ method, headers: authorization === undefined ? {} : { authorization } } as never);
    expect(want("PUT", "Bearer abc.def")).toBe(true);
    expect(want("PUT")).toBe(false);
    expect(want("PUT", "Bearer")).toBe(false);
    expect(want("PUT", "Basic abc")).toBe(false);
    expect(want("DELETE", "Bearer abc")).toBe(false);
    expect(want("GET", "Bearer abc")).toBe(false);
    expect(want("POST", "Bearer abc")).toBe(false);
  });

  it("answers 500 when the database fails", async () => {
    processPictureMock.mockResolvedValue(made);
    doors.saveElfCluePicture.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await pic("put", "8", "2", await send());
    expect(res.statusCode).toBe(500);
    expect(body(res)).toEqual({ error: "Admin is temporarily unavailable" });
  });

  it("gives the bytes to a head elf who can look, never to be kept or sniffed", async () => {
    cluePictureMock.mockResolvedValue({ mime: "image/jpeg", bytes: Buffer.from([1, 2, 3]) });
    const res = await pic("get", "7", "1", {}, VIEW);
    expect(res.statusCode).toBe(200);
    expect(cluePictureMock).toHaveBeenCalledWith(2026, 7, 1);
    expect(res.body).toEqual(Buffer.from([1, 2, 3]));
    expect(res.headers).toMatchObject({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Content-Type": "image/jpeg" });
  });

  it("says there is no picture, and is for the elf section only", async () => {
    cluePictureMock.mockResolvedValue(null);
    expect((await pic("get", "7", "1", {}, VIEW)).statusCode).toBe(404);
    expect((await run(routes.getAdminElfDoorCluePicture, ask("editor", { params: { door: "7", n: "1" } }))).statusCode).toBe(403);
  });
});

describe("the pasted clues", () => {
  const GOOD = "Door 8\nClue 1: one\nClue 2: two\nClue 3: three";
  const check = (text: unknown) => run(routes.postAdminElfCluesCheck, ask("viewer", { permissions: EDIT, body: { text } }));
  const save = (text: unknown) => run(routes.postAdminElfCluesSave, ask("viewer", { permissions: EDIT, body: { text } }));

  it("check answers what it parsed, with the place names, and the problems", async () => {
    doors.listElfDoors.mockResolvedValue(all24().map((d) => (d.door === 8 ? { ...d, placeName: "Pine Cone Café" } : d)));
    const res = await check(`${GOOD}\nDoor 25`);
    expect(res.statusCode).toBe(200);
    expect(body(res).doors).toEqual([{ door: 8, line: 1, placeName: "Pine Cone Café", clues: [{ n: 1, words: "one" }, { n: 2, words: "two" }, { n: 3, words: "three" }] }]);
    expect(body(res).problems.map((p: { message: string }) => p.message)).toEqual(["Line 5: there is no door 25. Doors go from 1 to 24."]);
  });

  it("check also names clues that are already out", async () => {
    const res = await check("Door 7\nClue 1: a\nClue 2: b\nClue 3: c");
    expect(body(res).problems.map((p: { kind: string }) => p.kind)).toEqual(["clue-out"]);
  });

  it("save with a problem is 400 and saves nothing", async () => {
    const res = await save("Door 25\nClue 1: a");
    expect(res.statusCode).toBe(400);
    expect(body(res).error).toBe("Fix the problems in the text first.");
    expect(body(res).problems.length).toBeGreaterThan(0);
    const out = await save("Door 7\nClue 1: a\nClue 2: b\nClue 3: c");
    expect(out.statusCode).toBe(400);
    expect(doors.savePastedClues).not.toHaveBeenCalled();
  });

  it("save with a good text saves the parsed doors", async () => {
    const res = await save(GOOD);
    expect(res.statusCode).toBe(200);
    expect(body(res)).toEqual({ doors: 1, clues: 3 });
    expect(doors.ensureElfDoors).toHaveBeenCalledWith(2026);
    expect(doors.savePastedClues).toHaveBeenCalledWith(2026, [{ door: 8, line: 1, clues: [{ n: 1, words: "one" }, { n: 2, words: "two" }, { n: 3, words: "three" }] }], ACTOR);
  });

  it("refuses text that is not text or too long", async () => {
    expect((await check(5)).statusCode).toBe(400);
    expect((await check("x".repeat(60001))).statusCode).toBe(400);
  });
});

describe("the place phone in the settings", () => {
  it("takes a phone number from an admin, and refuses words", async () => {
    const ok = await run(patchAdminElfSettings, ask("admin", { body: { placePhone: "01632 960 123" } }));
    expect(ok.statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenCalledWith({ placePhone: "01632 960 123" }, ACTOR);
    expect((await run(patchAdminElfSettings, ask("admin", { body: { placePhone: "call me" } }))).statusCode).toBe(400);
    expect((await run(patchAdminElfSettings, ask("admin", { body: { placePhone: null } }))).statusCode).toBe(200);
    expect(settingsDb.setElfSettings).toHaveBeenLastCalledWith({ placePhone: null }, ACTOR);
  });
});

// ---- Task 10: the blank place rule, an empty change, snow days and gone home ----

describe("a change that does nothing, and a place that keeps its name", () => {
  const patch = (door: string, b: unknown) => run(routes.patchAdminElfDoor, ask("viewer", { permissions: EDIT, params: { door }, body: b }));

  it("writes nothing and audits nothing for an empty change, and answers the door as it is", async () => {
    for (const b of [{}, { prize: undefined }]) {
      const res = await patch("8", b);
      expect(res.statusCode).toBe(200);
      expect(body(res).door.door).toBe(8);
    }
    expect(doors.changeElfDoor).not.toHaveBeenCalled();
  });

  it("with clue 1 out, will not blank the place's name, but takes a new one", async () => {
    const blank = await patch("7", { placeName: "" });
    expect(blank.statusCode).toBe(409);
    expect(body(blank)).toEqual({ error: "Door 7's evening has started, so its place must keep a name." });
    expect((await patch("7", { placeName: "   " })).statusCode).toBe(409);
    expect(doors.changeElfDoor).not.toHaveBeenCalled();
    expect((await patch("7", { placeName: "Pine Cone Café" })).statusCode).toBe(200);
    expect(doors.changeElfDoor).toHaveBeenCalledTimes(1);
  });

  it("before clue 1, still lets the place's name be blanked", async () => {
    expect((await patch("8", { placeName: "" })).statusCode).toBe(200);
    expect(doors.changeElfDoor).toHaveBeenCalledWith(2026, 8, { placeName: null }, ACTOR);
  });
});

describe("a snow day", () => {
  const call = (h: Handler, door: string, permissions: object = EDIT) => run(h, ask("viewer", { permissions, params: { door } }));

  it("is called before clue 1, by a head elf who may edit", async () => {
    const res = await call(routes.postAdminElfDoorSnowDay, "8");
    expect(res.statusCode).toBe(200);
    expect(doors.tickElfDoor).toHaveBeenCalledWith(2026, 8, "snowDay", true, ACTOR);
  });

  it("cannot be called once clue 1 is out", async () => {
    const res = await call(routes.postAdminElfDoorSnowDay, "7");
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "Door 7's evening has started, so it cannot be called off now." });
    expect(doors.tickElfDoor).not.toHaveBeenCalled();
  });

  it("calling it again changes nothing and keeps who called it", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(8, { snowDayAt: new Date("2026-12-06T09:00:00Z"), snowDayBy: "admin:other@example.org" }));
    const res = await call(routes.postAdminElfDoorSnowDay, "8");
    expect(res.statusCode).toBe(200);
    // Nobody in Team has that email any more: the email is the name, as in the photo log.
    expect(body(res).door.snowDay).toEqual({ at: "2026-12-06T09:00:00.000Z", by: "admin:other@example.org", name: "other@example.org" });
    expect(doors.tickElfDoor).not.toHaveBeenCalled();
  });

  // As the photo log names a head elf: their users.full_name, the email only when it is blank.
  it("names who called it and who ticked gone home by their name, and by their email only when the name is blank", async () => {
    users([
      { full_name: "Alex Example", email: "Staff@Example.org" },
      { full_name: "  ", email: "jo@example.org" },
    ]);
    doors.getElfDoor.mockResolvedValue(
      doorOf(8, { snowDayAt: new Date("2026-12-06T09:00:00Z"), snowDayBy: ACTOR, goneHomeAt: new Date("2026-12-09T09:00:00Z"), goneHomeBy: "admin:jo@example.org" }),
    );
    const d = body(await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }))).door;
    expect(d.snowDay).toEqual({ at: "2026-12-06T09:00:00.000Z", by: ACTOR, name: "Alex Example" });
    expect(d.goneHome).toEqual({ at: "2026-12-09T09:00:00.000Z", by: "admin:jo@example.org", name: "jo@example.org" });
    const lookups = vi.mocked(pool.query).mock.calls.filter((c) => /FROM users/.test(String(c[0])));
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]).toEqual([["staff@example.org", "jo@example.org"]]);
  });

  it("answers the name of whoever called it from every route that answers the sheet", async () => {
    users([{ full_name: "Alex Example", email: "staff@example.org" }]);
    doors.tickElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { snowDayAt: new Date("2026-12-07T09:00:00Z"), snowDayBy: ACTOR }));
    const res = await call(routes.postAdminElfDoorSnowDay, "8");
    expect(body(res).door.snowDay).toEqual({ at: "2026-12-07T09:00:00.000Z", by: ACTOR, name: "Alex Example" });
  });

  it("reads no users for a door nobody has called off or ticked, or one snowed in by itself", async () => {
    doors.getElfDoor.mockResolvedValue(doorOf(8, { snowDayAt: new Date("2026-12-06T09:00:00Z"), snowDayBy: "automatic" }));
    await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }));
    doors.getElfDoor.mockResolvedValue(doorOf(8));
    await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }));
    expect(vi.mocked(pool.query).mock.calls.filter((c) => /FROM users/.test(String(c[0])))).toEqual([]);
  });

  it("is cancelled before clue 1 only", async () => {
    doors.getElfDoor.mockImplementation(async (_y: number, n: number) => doorOf(n, { snowDayAt: new Date("2026-12-06T09:00:00Z"), snowDayBy: ACTOR }));
    expect((await call(routes.deleteAdminElfDoorSnowDay, "8")).statusCode).toBe(200);
    expect(doors.tickElfDoor).toHaveBeenCalledWith(2026, 8, "snowDay", false, ACTOR);
    doors.tickElfDoor.mockClear();
    const late = await call(routes.deleteAdminElfDoorSnowDay, "7");
    expect(late.statusCode).toBe(409);
    expect(body(late)).toEqual({ error: "Door 7's evening has started, so its snow day cannot be cancelled now." });
    expect(doors.tickElfDoor).not.toHaveBeenCalled();
  });

  it("is not for a head elf who may only look, and a door with no row is 404", async () => {
    expect((await call(routes.postAdminElfDoorSnowDay, "8", VIEW)).statusCode).toBe(403);
    expect((await call(routes.deleteAdminElfDoorSnowDay, "8", VIEW)).statusCode).toBe(403);
    doors.getElfDoor.mockResolvedValue(null);
    expect((await call(routes.postAdminElfDoorSnowDay, "8")).statusCode).toBe(404);
  });

  it("says whether the door's day is over on the sheet", async () => {
    const day = async (door: string) => body(await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door } }))).door.dayOver;
    expect(await day("6")).toBe(true);
    expect(await day("7")).toBe(false);
    expect(await day("8")).toBe(false);
  });

  it("is on the door's sheet, with who and when", async () => {
    users([{ full_name: "Alex Example", email: "staff@example.org" }]);
    doors.getElfDoor.mockResolvedValue(doorOf(8, { snowDayAt: new Date("2026-12-06T09:00:00Z"), snowDayBy: "automatic", goneHomeAt: new Date("2026-12-09T09:00:00Z"), goneHomeBy: "admin:staff@example.org" }));
    const d = body(await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }))).door;
    expect(d.snowDay).toEqual({ at: "2026-12-06T09:00:00.000Z", by: "automatic", name: "automatic" });
    expect(d.goneHome).toEqual({ at: "2026-12-09T09:00:00.000Z", by: "admin:staff@example.org", name: "Alex Example" });
    doors.getElfDoor.mockResolvedValue(doorOf(8));
    const none = body(await run(routes.getAdminElfDoor, ask("viewer", { permissions: VIEW, params: { door: "8" } }))).door;
    expect(none.snowDay).toBeNull();
    expect(none.goneHome).toBeNull();
  });
});

describe("gone home", () => {
  const call = (h: Handler, door: string, permissions: object = EDIT) => run(h, ask("viewer", { permissions, params: { door } }));

  it("is ticked once the door's day has passed", async () => {
    const res = await call(routes.postAdminElfDoorGoneHome, "6");
    expect(res.statusCode).toBe(200);
    expect(doors.tickElfDoor).toHaveBeenCalledWith(2026, 6, "goneHome", true, ACTOR);
  });

  it("is unticked once the door's day has passed", async () => {
    const res = await call(routes.deleteAdminElfDoorGoneHome, "6");
    expect(res.statusCode).toBe(200);
    expect(doors.tickElfDoor).toHaveBeenCalledWith(2026, 6, "goneHome", false, ACTOR);
  });

  it("is not for the door's own day, nor a day to come", async () => {
    for (const door of ["7", "8"]) {
      const res = await call(routes.postAdminElfDoorGoneHome, door);
      expect(res.statusCode, door).toBe(409);
      expect(body(res)).toEqual({ error: `Gone home is for after door ${door}'s day.` });
    }
    expect((await call(routes.deleteAdminElfDoorGoneHome, "7")).statusCode).toBe(409);
    expect(doors.tickElfDoor).not.toHaveBeenCalled();
  });

  it("starts at midnight at the end of the door's day", async () => {
    vi.setSystemTime(new Date("2026-12-07T23:59:59Z"));
    expect((await call(routes.postAdminElfDoorGoneHome, "7")).statusCode).toBe(409);
    vi.setSystemTime(new Date("2026-12-08T00:00:00Z"));
    expect((await call(routes.postAdminElfDoorGoneHome, "7")).statusCode).toBe(200);
  });

  it("is not for a head elf who may only look", async () => {
    expect((await call(routes.postAdminElfDoorGoneHome, "6", VIEW)).statusCode).toBe(403);
    expect((await call(routes.deleteAdminElfDoorGoneHome, "6", VIEW)).statusCode).toBe(403);
    expect(doors.tickElfDoor).not.toHaveBeenCalled();
  });
});
