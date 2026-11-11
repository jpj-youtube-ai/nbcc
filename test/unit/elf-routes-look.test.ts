import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: saving how a detective's elf looks. The server decides which doors the
// detective has done; whatever the page sends is made safe against that. Every family is invented.

const { clientQuery, poolQuery, familyDoorsDone, detectiveDoorsDone } = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  poolQuery: vi.fn(),
  familyDoorsDone: vi.fn(),
  detectiveDoorsDone: vi.fn(),
}));
vi.mock("../../src/db/pool", () => ({
  pool: { query: poolQuery, connect: async () => ({ query: clientQuery, release: vi.fn() }) },
}));
// The route's own session lookup, and the doors done from the game's data layer; saveLook itself is real.
vi.mock("../../src/db/elf", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf")>()), findElfSession: async () => ({ familyId: 3 }) }));
vi.mock("../../src/db/elf-game", async (orig) => ({ ...(await orig<typeof import("../../src/db/elf-game")>()), familyDoorsDone, detectiveDoorsDone }));
vi.mock("../../src/routes/api", () => ({ currentCardFee: async () => ({ percentBp: 120, fixedPence: 20 }) }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test", ADMIN_SESSION_SECRET: "s", PORTAL_BASE_URL: "https://nbcc.scot", BALL_FROM_EMAIL: "events@nbcc.scot" } }));

import type { Request, Response } from "express";
import { saveLook } from "../../src/db/elf";
import { postLook } from "../../src/routes/elf";
import { ELF_DEFAULTS } from "../../src/elf/settings";
import { defaultLook } from "../../src/elf/wardrobe";

const NO_DOORS = { cracked: [], visited: [] };
const STORED = [{ ...defaultLook(), scene: "loch" }];
const ROW = { id: 100, fresh: ["tree", "polarbear"], favourites: STORED };

beforeEach(() => {
  clientQuery.mockReset();
  poolQuery.mockReset();
  familyDoorsDone.mockReset();
  detectiveDoorsDone.mockReset();
});

function db(row: typeof ROW | null) {
  const saved: { sql: string; params: unknown[] }[] = [];
  clientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT[\s\S]*FROM elf_detectives[\s\S]*FOR UPDATE/.test(sql)) return { rows: row ? [row] : [] };
    if (/UPDATE elf_detectives SET/.test(sql)) saved.push({ sql, params });
    return { rows: [] };
  });
  return saved;
}

describe("saving a look", () => {
  it("stores a locked costume as none: the doors done are the server's, never the page's", async () => {
    const saved = db(ROW);
    // The Christmas tree comes with door 2, and in wave 1 no door is done.
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: { ...defaultLook(), costume: "tree", scene: "ayr" }, tried: [], doors: NO_DOORS });
    expect(kept).not.toBe("not-found");
    if (kept !== "not-found") expect(kept.look).toEqual({ ...defaultLook(), scene: "ayr" });
    expect(saved.length).toBe(1);
    expect(JSON.parse(saved[0].params[1] as string)).toEqual({ ...defaultLook(), scene: "ayr" });
  });

  it("refuses another family's detective, and saves nothing", async () => {
    const saved = db(null);
    expect(await saveLook({ detectiveId: 100, familyId: 99, look: defaultLook(), tried: [], doors: NO_DOORS })).toBe("not-found");
    expect(saved.length).toBe(0);
    const select = clientQuery.mock.calls.find((c) => /FROM elf_detectives/.test(String(c[0])))!;
    expect(select[1]).toEqual([100, 99]);
  });

  it("takes off fresh only the presents it had, once, however many times they are sent", async () => {
    const saved = db(ROW);
    await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: ["tree", "nessie", 7, "tree"], doors: NO_DOORS });
    expect(saved[0].params[2]).toEqual(["polarbear"]);
  });

  it("keeps three favourites at most, made safe, each once", async () => {
    const saved = db(ROW);
    const a = { ...defaultLook(), scene: "largs" };
    const b = { ...defaultLook(), costume: "tree", friend: "robin" };
    const c = { ...defaultLook(), glasses: "specs-gold" };
    const d = { ...defaultLook(), bow: "bow-red" };
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: [], favourites: [a, 7, a, b, c, d], doors: NO_DOORS });
    const want = [a, { ...defaultLook(), friend: "robin" }, c];
    if (kept !== "not-found") expect(kept.favourites).toEqual(want);
    expect(saved[0].sql).toMatch(/favourites = \$4/);
    expect(JSON.parse(saved[0].params[3] as string)).toEqual(want);
  });

  it("leaves favourites alone when a save does not send them", async () => {
    const saved = db(ROW);
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: [], doors: NO_DOORS });
    expect(saved[0].sql).not.toMatch(/favourites/);
    expect(saved[0].params.length).toBe(3);
    if (kept !== "not-found") expect(kept.favourites).toEqual(STORED);
  });
});

describe("the look route", () => {
  const SETTINGS = { ...ELF_DEFAULTS, schoolOn: true, year: 2026 };

  async function post(body: Record<string, unknown>) {
    const out = { status: 200, body: undefined as unknown };
    const res = {
      locals: { elfSettings: SETTINGS, elfPractice: false },
      setHeader: () => res,
      status(s: number) {
        out.status = s;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
      type: () => res,
      send: () => res,
      redirect(s: number) {
        out.status = s;
        return res;
      },
    };
    const req = { headers: { cookie: `nbcc_elf_session=${"a".repeat(40)}`, "content-type": "application/json", host: "nbcc.scot" }, body };
    await postLook(req as unknown as Request, res as unknown as Response);
    return out;
  }

  it("makes the look safe against the detective's own doors done, worked out on the server", async () => {
    // Ruby cracked door 2, so its Christmas tree is hers to wear.
    familyDoorsDone.mockResolvedValue(new Map([[100, { cracked: [2], visited: [], snow: [] }]]));
    const saved = db(ROW);
    const r = await post({ detectiveId: 100, look: { ...defaultLook(), costume: "tree" }, tried: [] });
    expect(r.status).toBe(200);
    // Read from the signed in family's own detectives.
    expect(familyDoorsDone).toHaveBeenCalledWith(2026, 3, expect.any(Array), expect.any(Date));
    // The doors as every family route reads them: all 24, wave 1's while December's doors are off.
    expect(familyDoorsDone.mock.calls[0][2]).toHaveLength(24);
    expect(JSON.parse(saved[0].params[1] as string)).toEqual({ ...defaultLook(), costume: "tree" });
  });

  it("still stores a costume the detective has not unlocked as none", async () => {
    familyDoorsDone.mockResolvedValue(new Map([[100, { cracked: [], visited: [], snow: [] }]]));
    const saved = db(ROW);
    await post({ detectiveId: 100, look: { ...defaultLook(), costume: "tree" }, tried: [] });
    expect(JSON.parse(saved[0].params[1] as string)).toEqual(defaultLook());
  });

  it("refuses another family's detective before reading its doors or saving anything", async () => {
    familyDoorsDone.mockResolvedValue(new Map([[100, { cracked: [2], visited: [], snow: [] }]]));
    const saved = db(ROW);
    const r = await post({ detectiveId: 555, look: defaultLook(), tried: [] });
    expect(r.status).toBe(404);
    expect(detectiveDoorsDone).not.toHaveBeenCalled();
    expect(clientQuery).not.toHaveBeenCalled();
    expect(saved.length).toBe(0);
  });

  it("asks nothing of the doors for an id that is not a detective's", async () => {
    const saved = db(ROW);
    const r = await post({ detectiveId: "not an id", look: defaultLook(), tried: [] });
    expect(r.status).toBe(404);
    expect(familyDoorsDone).not.toHaveBeenCalled();
    expect(saved.length).toBe(0);
  });
});
