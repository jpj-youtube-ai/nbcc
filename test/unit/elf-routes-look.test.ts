import { describe, it, expect, vi, beforeEach } from "vitest";

// NBCC Elf Detective School: saving how a detective's elf looks. The server decides what the
// detective has earned; whatever the page sends is made safe against that. Every family is invented.

const { clientQuery, poolQuery } = vi.hoisted(() => ({ clientQuery: vi.fn(), poolQuery: vi.fn() }));
vi.mock("../../src/db/pool", () => ({
  pool: { query: poolQuery, connect: async () => ({ query: clientQuery, release: vi.fn() }) },
}));

import { saveLook } from "../../src/db/elf";
import { defaultLook } from "../../src/elf/wardrobe";

const ROW = { id: 100, family_id: 3, look: null, fresh: ["bow:gold", "hat:elf:red"] };

beforeEach(() => {
  clientQuery.mockReset();
  poolQuery.mockReset();
});

function db(row: typeof ROW | null) {
  const saved: unknown[][] = [];
  clientQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (/SELECT[\s\S]*FROM elf_detectives[\s\S]*FOR UPDATE/.test(sql)) return { rows: row ? [row] : [] };
    if (/UPDATE elf_detectives SET look/.test(sql)) saved.push(params);
    return { rows: [] };
  });
  return saved;
}

describe("saving a look", () => {
  it("keeps the look made safe against what the detective has earned, never what the page claims", async () => {
    const saved = db(ROW);
    // A jumper unlocks at 6 doors; this detective has none, so the starter top is kept.
    const sent = { ...defaultLook(), pieces: { ...defaultLook().pieces, top: ["jumper", "red"] } };
    const kept = await saveLook({ detectiveId: 100, familyId: 3, look: sent, tried: [] });
    expect(kept).not.toBe("not-found");
    if (kept !== "not-found") expect(kept.pieces.top).toEqual(defaultLook().pieces.top);
    expect(saved.length).toBe(1);
  });

  it("refuses another family's detective, and saves nothing", async () => {
    const saved = db(null);
    expect(await saveLook({ detectiveId: 100, familyId: 99, look: defaultLook(), tried: [] })).toBe("not-found");
    expect(saved.length).toBe(0);
    const select = clientQuery.mock.calls.find((c) => /FROM elf_detectives/.test(String(c[0])))!;
    expect(select[1]).toEqual([100, 99]);
  });

  it("clears the New tag of what was tried on, once, however many times it is sent", async () => {
    const saved = db(ROW);
    await saveLook({ detectiveId: 100, familyId: 3, look: defaultLook(), tried: ["bow:gold", "bow:gold", 42 as unknown as string] });
    const fresh = saved[0].find((p) => Array.isArray(p)) as string[];
    expect(fresh).toEqual(["hat:elf:red"]);
  });
});
