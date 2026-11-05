import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: saving how a detective's elf looks. The server decides which doors the
// detective has done; whatever the page sends is made safe against that. Every family is invented.

const { clientQuery, poolQuery } = vi.hoisted(() => ({ clientQuery: vi.fn(), poolQuery: vi.fn() }));
vi.mock("../../src/db/pool", () => ({
  pool: { query: poolQuery, connect: async () => ({ query: clientQuery, release: vi.fn() }) },
}));

import { saveLook } from "../../src/db/elf";
import { defaultLook } from "../../src/elf/wardrobe";

const STORED = [{ ...defaultLook(), scene: "loch" }];
const ROW = { id: 100, fresh: ["tree", "polarbear"], favourites: STORED };

beforeEach(() => {
  clientQuery.mockReset();
  poolQuery.mockReset();
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
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: { ...defaultLook(), costume: "tree", scene: "ayr" }, tried: [] });
    expect(kept).not.toBe("not-found");
    if (kept !== "not-found") expect(kept.look).toEqual({ ...defaultLook(), scene: "ayr" });
    expect(saved.length).toBe(1);
    expect(JSON.parse(saved[0].params[1] as string)).toEqual({ ...defaultLook(), scene: "ayr" });
  });

  it("refuses another family's detective, and saves nothing", async () => {
    const saved = db(null);
    expect(await saveLook({ detectiveId: 100, familyId: 99, look: defaultLook(), tried: [] })).toBe("not-found");
    expect(saved.length).toBe(0);
    const select = clientQuery.mock.calls.find((c) => /FROM elf_detectives/.test(String(c[0])))!;
    expect(select[1]).toEqual([100, 99]);
  });

  it("takes off fresh only the presents it had, once, however many times they are sent", async () => {
    const saved = db(ROW);
    await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: ["tree", "nessie", 7, "tree"] });
    expect(saved[0].params[2]).toEqual(["polarbear"]);
  });

  it("keeps three favourites at most, made safe, each once", async () => {
    const saved = db(ROW);
    const a = { ...defaultLook(), scene: "largs" };
    const b = { ...defaultLook(), costume: "tree", friend: "robin" };
    const c = { ...defaultLook(), glasses: "specs-gold" };
    const d = { ...defaultLook(), bow: "bow-red" };
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: [], favourites: [a, 7, a, b, c, d] });
    const want = [a, { ...defaultLook(), friend: "robin" }, c];
    if (kept !== "not-found") expect(kept.favourites).toEqual(want);
    expect(saved[0].sql).toMatch(/favourites = \$4/);
    expect(JSON.parse(saved[0].params[3] as string)).toEqual(want);
  });

  it("leaves favourites alone when a save does not send them", async () => {
    const saved = db(ROW);
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: [] });
    expect(saved[0].sql).not.toMatch(/favourites/);
    expect(saved[0].params.length).toBe(3);
    if (kept !== "not-found") expect(kept.favourites).toEqual(STORED);
  });
});
