import { describe, it, expect, vi, beforeEach } from "vitest";

// What gifts could do, the SQL side, against a fake pool (no database): reading the list (kept for a
// minute, read afresh after any change here, never throwing), adding one at the end of the list,
// changing one, moving one up or down, and every change written to audit_log in the same transaction.

vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "test" } }));

import { pool } from "../../src/db/pool";
import {
  IMPACT_CACHE_MS,
  ImpactExampleError,
  addImpactExample,
  forgetImpactExamples,
  listImpactExamples,
  loadImpactExamples,
  moveImpactExample,
  updateImpactExample,
} from "../../src/db/impact-examples";

const row = (id: number, amount: number, wording: string, over: Record<string, unknown> = {}) => ({
  id,
  amount_pence: amount,
  wording,
  active: true,
  sort_order: id * 10,
  on_give_form: true,
  meter_line: null,
  created_at: "2026-10-03T09:00:00Z",
  created_by: "migration",
  updated_at: "2026-10-03T09:00:00Z",
  updated_by: "migration",
  ...over,
});
const rows = () => [
  row(1, 500, "could help put a cosy pair of pyjamas in a Red Bag"),
  row(2, 2500, "could help buy a pair of school shoes"),
  row(3, 5000, "could help fill a whole Red Bag Full of Joy", { meter_line: "red_bags" }),
];

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

type Answer = (sql: string, params: unknown[]) => unknown;
function useClient(answer: Answer) {
  const calls: Array<[string, unknown[]]> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push([sql, params]);
      const out = answer(sql, params);
      if (out instanceof Error) throw out;
      return out ?? { rows: [] };
    }),
    release: vi.fn(),
  };
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return calls;
}
const audits = (calls: Array<[string, unknown[]]>) => calls.filter(([sql]) => /INSERT INTO audit_log/.test(sql)).map(([, p]) => p);

beforeEach(() => {
  query.mockReset();
  (pool.connect as unknown as ReturnType<typeof vi.fn>).mockReset();
  forgetImpactExamples();
});

describe("reading the list", () => {
  it("is every example in the list's order, as the pages and the admin want it", async () => {
    query.mockResolvedValue({ rows: [row(2, 2500, "could help buy a pair of school shoes", { sort_order: 5 }), ...rows().filter((r) => r.id !== 2)] });
    const list = await listImpactExamples();
    expect(list.map((e) => e.id)).toEqual([2, 1, 3]);
    expect(list[2]).toMatchObject({ amountPence: 5000, active: true, onGiveForm: true, meterLine: "red_bags", sortOrder: 30, updatedBy: "migration" });
    expect(String(query.mock.calls[0][0])).toMatch(/FROM impact_examples/);
  });

  it("is kept for a minute, then read again", async () => {
    query.mockResolvedValue({ rows: rows() });
    const t = 1_000_000;
    await loadImpactExamples({ now: t });
    await loadImpactExamples({ now: t + IMPACT_CACHE_MS - 1 });
    expect(query).toHaveBeenCalledTimes(1);
    await loadImpactExamples({ now: t + IMPACT_CACHE_MS + 1 });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("never throws: the list last read stands, or none at all before any was read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    query.mockRejectedValueOnce(new Error("database down"));
    expect(await loadImpactExamples()).toEqual([]);
    query.mockResolvedValueOnce({ rows: rows() });
    expect(await loadImpactExamples({ fresh: true })).toHaveLength(3);
    query.mockRejectedValueOnce(new Error("database down"));
    expect(await loadImpactExamples({ fresh: true })).toHaveLength(3);
  });
});

describe("adding one", () => {
  it("puts it at the end of the list, on, and writes it to audit_log", async () => {
    const calls = useClient((sql) => {
      if (/max\(sort_order\)/i.test(sql)) return { rows: [{ next: 60 }] };
      if (/INSERT INTO impact_examples/.test(sql)) return { rows: [row(9, 10000, "could help buy a warm winter coat", { sort_order: 60 })] };
      return undefined;
    });
    query.mockResolvedValue({ rows: rows() });
    const added = await addImpactExample({ amountPence: 10000, wording: "could help buy a warm winter coat", onGiveForm: true }, "admin:fern@example.com");
    expect(added).toMatchObject({ id: 9, amountPence: 10000, sortOrder: 60, active: true });
    const insert = calls.find(([sql]) => /INSERT INTO impact_examples/.test(sql))!;
    expect(insert[1]).toEqual([10000, "could help buy a warm winter coat", true, 60, "admin:fern@example.com"]);
    expect(audits(calls)).toHaveLength(1);
    expect(audits(calls)[0].slice(0, 4)).toEqual(["admin:fern@example.com", "impact.example_added", "impact_example", 9]);
    expect(calls[0][0]).toBe("BEGIN");
    expect(calls[calls.length - 1][0]).toBe("COMMIT");
    // Read again at once, so the pages show it.
    expect(query).toHaveBeenCalled();
  });
});

describe("changing one", () => {
  it("saves the amount, the words, on or off and the give form choice, with what it was", async () => {
    const calls = useClient((sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [rows()[1]] };
      if (/UPDATE impact_examples/.test(sql)) return { rows: [row(2, 3000, "could help buy school shoes that fit", { active: false })] };
      return undefined;
    });
    query.mockResolvedValue({ rows: rows() });
    const after = await updateImpactExample(2, { amountPence: 3000, wording: "could help buy school shoes that fit", active: false }, "admin:fern@example.com");
    expect(after).toMatchObject({ amountPence: 3000, active: false });
    const update = calls.find(([sql]) => /UPDATE impact_examples/.test(sql))!;
    expect(update[1]).toEqual([2, 3000, "could help buy school shoes that fit", false, true, "admin:fern@example.com"]);
    const audit = audits(calls)[0];
    expect(audit.slice(0, 4)).toEqual(["admin:fern@example.com", "impact.example_changed", "impact_example", 2]);
    expect(audit[4]).toMatchObject({ amountPence: 3000, active: false, was: { amountPence: 2500, wording: "could help buy a pair of school shoes", active: true } });
  });

  it("never changes the amount or words of one the meter line counts with, and says so", async () => {
    for (const change of [{ amountPence: 6000 }, { wording: "could help fill a big Red Bag" }]) {
      const calls = useClient((sql) => (/FOR UPDATE/.test(sql) ? { rows: [rows()[2]] } : undefined));
      const err = await updateImpactExample(3, change, "admin:x").catch((e) => e);
      expect(err).toBeInstanceOf(ImpactExampleError);
      expect(err.reason).toBe("fixed");
      expect(calls.some(([sql]) => /UPDATE impact_examples/.test(sql))).toBe(false);
    }
  });

  it("still switches one the meter line counts with off and on, and lets the same words through", async () => {
    const calls = useClient((sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [rows()[2]] };
      if (/UPDATE impact_examples/.test(sql)) return { rows: [{ ...rows()[2], active: false }] };
      return undefined;
    });
    query.mockResolvedValue({ rows: rows() });
    await updateImpactExample(3, { active: false, amountPence: 5000, wording: "could help fill a whole Red Bag Full of Joy" }, "admin:x");
    expect(calls.some(([sql]) => /UPDATE impact_examples/.test(sql))).toBe(true);
  });

  it("says when it is not there any more", async () => {
    const calls = useClient(() => ({ rows: [] }));
    await expect(updateImpactExample(77, { active: false }, "admin:x")).rejects.toBeInstanceOf(ImpactExampleError);
    expect(calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  });
});

describe("moving one", () => {
  const answer = (sql: string) => (/ORDER BY sort_order, id\s+FOR UPDATE/.test(sql) ? { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] } : undefined);

  it("swaps it with the one above, numbering the list afresh in tens", async () => {
    const calls = useClient(answer);
    query.mockResolvedValue({ rows: rows() });
    await moveImpactExample(3, "up", "admin:fern@example.com");
    const sets = calls.filter(([sql]) => /UPDATE impact_examples SET sort_order/.test(sql)).map(([, p]) => p);
    expect(sets).toEqual([
      [1, 10],
      [3, 20],
      [2, 30],
    ]);
    expect(audits(calls)[0].slice(0, 4)).toEqual(["admin:fern@example.com", "impact.example_moved", "impact_example", 3]);
  });

  it("moves past the ones switched off, as the card lists those apart", async () => {
    const calls = useClient((sql) =>
      /ORDER BY sort_order, id\s+FOR UPDATE/.test(sql)
        ? { rows: [{ id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true }] }
        : undefined,
    );
    query.mockResolvedValue({ rows: rows() });
    await moveImpactExample(3, "up", "admin:fern@example.com");
    const sets = calls.filter(([sql]) => /UPDATE impact_examples SET sort_order/.test(sql)).map(([, p]) => p);
    expect(sets).toEqual([
      [3, 10],
      [2, 20],
      [1, 30],
    ]);
  });

  it("does nothing at the end of the list", async () => {
    const calls = useClient(answer);
    query.mockResolvedValue({ rows: rows() });
    await moveImpactExample(1, "up", "admin:fern@example.com");
    expect(calls.filter(([sql]) => /UPDATE impact_examples/.test(sql))).toHaveLength(0);
    expect(audits(calls)).toHaveLength(0);
  });

  it("says when it is not there any more", async () => {
    useClient(answer);
    await expect(moveImpactExample(42, "down", "admin:x")).rejects.toBeInstanceOf(ImpactExampleError);
  });
});
