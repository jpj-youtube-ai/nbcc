import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// NBCC Elf Detective School in the admin, Head Elf HQ: the Doors routes. Every place, prize and
// name here is invented.

const { getUserAuthRowMock, doors, settingsDb } = vi.hoisted(() => ({
  getUserAuthRowMock: vi.fn(),
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
    savePastedClues: vi.fn(),
  },
  settingsDb: { getElfSettings: vi.fn(), setElfSettings: vi.fn(), setElfPreview: vi.fn() },
}));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/db/elf-doors", () => doors);
vi.mock("../../src/db/elf", () => settingsDb);
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
import { emptyDoor, type DoorSetup } from "../../src/elf/door-setup";
import type { Door } from "../../src/elf/calendar";

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
  doors.savePastedClues.mockResolvedValue({ doors: 1, clues: 3 });
});
afterEach(() => vi.useRealTimers());

describe("the doors list", () => {
  it("is for the elf section only", async () => {
    expect((await run(routes.getAdminElfDoors, ask("editor"))).statusCode).toBe(403);
    expect(doors.ensureElfDoors).not.toHaveBeenCalled();
  });

  it("gives 24 tiles, the counts and the prize list to a head elf who can only look", async () => {
    doors.listElfDoors.mockResolvedValue(all24().map((d) => (d.door === 7 ? { ...d, placeName: "Pine Cone Cafe", placeTown: "Ayr", placeAddress: "1 Example Street", prize: "A cake" } : d)));
    const res = await run(routes.getAdminElfDoors, ask("viewer", { permissions: VIEW }));
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(doors.ensureElfDoors).toHaveBeenCalledWith(2026);
    const b = body(res);
    expect(b.year).toBe(2026);
    expect(b.doors).toHaveLength(24);
    expect(b.doors[6]).toMatchObject({ door: 7, weekday: "Mon", placeName: "Pine Cone Cafe", ready: false, toDo: 4 });
    expect(b.counts).toEqual({ placesAgreed: 1, prizesChosen: 1, ready: 0 });
    expect(b.prizeList.split("\n")[6]).toBe("Door 7: A cake");
    expect(b.canEdit).toBe(false);
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
    const res = await patch("8", { placeName: " Pine Cone Cafe ", contactEmail: "", prizeShowOff: true });
    expect(res.statusCode).toBe(200);
    expect(doors.changeElfDoor).toHaveBeenCalledWith(2026, 8, { placeName: "Pine Cone Cafe", contactEmail: null, prizeShowOff: true }, ACTOR);
    expect(body(res).door.door).toBe(8);
  });

  it("refuses an unknown key, a bad door and bad values", async () => {
    expect((await patch("8", { colour: "red" })).statusCode).toBe(400);
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

  it("with clue 1 out, refuses new times but takes place details and the prize", async () => {
    const d7 = await patch("7", { clue3Time: "19:00" });
    expect(d7.statusCode).toBe(409);
    expect(body(d7)).toEqual({ error: "Door 7's evening has started, so its times cannot change." });
    expect((await patch("7", { placeName: "Pine Cone Cafe", prize: "A cake" })).statusCode).toBe(200);
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
    expect((await remove("8", "3")).statusCode).toBe(200);
    expect(doors.removeElfDoorName).toHaveBeenCalledWith(2026, 8, 3, ACTOR);
    const res = await remove("7", "3");
    expect(res.statusCode).toBe(409);
    expect(body(res)).toEqual({ error: "Door 7's evening has started, so names that count can only be added now." });
  });

  it("holds the id to a whole number inside the database's range", async () => {
    for (const id of ["0", "01", "x", "1234567890", "-1"]) expect((await remove("8", id)).statusCode, id).toBe(400);
    expect((await remove("8", "123456789")).statusCode).toBe(200);
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
    expect(typeof made[2]).toBe("string");
    expect(made[2].length).toBeGreaterThan(3);
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

describe("the pasted clues", () => {
  const GOOD = "Door 8\nClue 1: one\nClue 2: two\nClue 3: three";
  const check = (text: unknown) => run(routes.postAdminElfCluesCheck, ask("viewer", { permissions: EDIT, body: { text } }));
  const save = (text: unknown) => run(routes.postAdminElfCluesSave, ask("viewer", { permissions: EDIT, body: { text } }));

  it("check answers what it parsed, with the place names, and the problems", async () => {
    doors.listElfDoors.mockResolvedValue(all24().map((d) => (d.door === 8 ? { ...d, placeName: "Pine Cone Cafe" } : d)));
    const res = await check(`${GOOD}\nDoor 25`);
    expect(res.statusCode).toBe(200);
    expect(body(res).doors).toEqual([{ door: 8, line: 1, placeName: "Pine Cone Cafe", clues: [{ n: 1, words: "one" }, { n: 2, words: "two" }, { n: 3, words: "three" }] }]);
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
