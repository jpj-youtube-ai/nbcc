import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { WORDING_KEYS } from "../../src/fundraising/touch-rules";

// Jaimie 2026-10-03: new automatic email wording only sends once an admin approves it. One small
// table of approvals (key, when, by whom), seeded with the three she approved that day: target,
// need a hand and on track. Finished and the three nothing raised versions are left waiting.
// Additive only. Against a fake pgm. Named to sort after 196 and before 200: node-pg-migrate refuses
// on production to run one that sorts before a migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000197_touch-wording-approvals.js";
const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

function fakePgm() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    sql: () => calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join(" "),
    pgm: {
      createTable: record("createTable"),
      dropTable: record("dropTable"),
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

describe("the touch wording approvals migration", () => {
  it("makes one small table keyed by the wording, with who approved it and when", () => {
    const f = fakePgm();
    migration.up(f.pgm);
    const create = f.calls.find((c) => c.op === "createTable")!;
    expect(create.args[0]).toBe("touch_wording_approvals");
    const cols = create.args[1] as Record<string, Record<string, unknown>>;
    expect(Object.keys(cols)).toEqual(["key", "approved_at", "approved_by"]);
    expect(cols.key).toMatchObject({ type: "text", primaryKey: true });
    expect(cols.approved_at).toMatchObject({ type: "timestamptz", notNull: true });
    expect(cols.approved_by).toMatchObject({ type: "text", notNull: true });
  });

  it("seeds only the three Jaimie approved on 2026-10-03, with a History row for each", () => {
    const f = fakePgm();
    migration.up(f.pgm);
    const sql = f.sql();
    expect(sql).toContain("INSERT INTO touch_wording_approvals");
    for (const key of ["target", "need_a_hand", "on_track"]) expect(sql).toContain(`'${key}'`);
    for (const key of ["'finished'", "finished_zero", "week_after_zero", "year_on_zero"]) expect(sql).not.toContain(key);
    expect(sql).toContain("2026-10-03");
    expect(sql).toContain("ON CONFLICT (key) DO NOTHING");
    expect(sql).toContain("INSERT INTO audit_log");
    expect(sql).toContain("fundraising.touch_wording_approved");
  });

  it("seeds only keys the sender knows", () => {
    const f = fakePgm();
    migration.up(f.pgm);
    const seeded = [...f.sql().matchAll(/\('([a-z_]+)', TIMESTAMPTZ/g)].map((m) => m[1]);
    expect(seeded).toEqual(["target", "need_a_hand", "on_track"]);
    for (const k of seeded) expect(WORDING_KEYS as readonly string[]).toContain(k);
  });

  it("marks a thank you held for sign off or whose send failed, so only those are caught up (review)", () => {
    const f = fakePgm();
    migration.up(f.pgm);
    const add = f.calls.find((c) => c.op === "addColumns")!;
    expect(add.args[0]).toBe("fundraisers");
    const cols = add.args[1] as Record<string, Record<string, unknown>>;
    expect(Object.keys(cols)).toEqual(["touch_finished_pending", "touch_finished_pending_at"]);
    // Nullable, no default: every page today reads "nothing to catch up".
    expect(cols.touch_finished_pending).toMatchObject({ type: "text" });
    expect(cols.touch_finished_pending.notNull).toBeUndefined();
    expect(String(cols.touch_finished_pending.check)).toContain("'held', 'failed'");
    expect(cols.touch_finished_pending_at).toEqual({ type: "timestamptz" });
  });

  it("drops the table and the columns on the way down", () => {
    const f = fakePgm();
    migration.down(f.pgm);
    expect(f.calls.map((c) => [c.op, c.args[0]])).toEqual([
      ["dropColumns", "fundraisers"],
      ["dropTable", "touch_wording_approvals"],
    ]);
  });

  it("sorts after 1791200000196 and before 1791200000200, by name", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js"));
    expect(names).toContain(NAME);
    expect(NAME > "1791200000196").toBe(true);
    expect(NAME < "1791200000200").toBe(true);
    expect(NAME > "1791200000190_teams.js").toBe(true);
  });
});
