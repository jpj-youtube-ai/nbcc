import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// The Kilmarnock Santa Sleigh's two tables (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md):
// the nights, seeded with the seven 2026 nights from the poster, and one row of settings. Additive
// only (golden rule 2), and it must sort last, as production has history CI cannot see.

const dir = join(__dirname, "..", "..", "migrations");
const name = "1791200000430_santa-sleigh.js";
const load = () => createRequire(__filename)(join(dir, name)) as { up: (pgm: unknown) => void; down: (pgm: unknown) => void };

const recorder = () => {
  const calls: Array<[string, ...unknown[]]> = [];
  const pgm = new Proxy(
    {},
    {
      get:
        (_t, method: string) =>
        (...args: unknown[]) => {
          if (method === "func") return `FUNC(${String(args[0])})`;
          calls.push([method, ...args]);
          return undefined;
        },
    },
  );
  return { pgm, calls };
};

type Columns = Record<string, Record<string, unknown> | string>;

describe("the Santa Sleigh migration", () => {
  it("sorts after every migration before it, so production never sees it run out of order", () => {
    const all = readdirSync(dir).filter((f) => f.endsWith(".js")).sort();
    expect(all).toContain(name);
    expect(all.indexOf(name)).toBeGreaterThan(all.indexOf("1791200000420_elf-doors.js"));
  });

  it("creates the nights table: a unique date, the areas, times that may be empty, and bucket cash never below nothing", () => {
    const { pgm, calls } = recorder();
    load().up(pgm);
    const nights = calls.find((c) => c[0] === "createTable" && c[1] === "sleigh_nights");
    expect(nights).toBeDefined();
    const cols = nights![2] as Columns;
    expect(Object.keys(cols)).toEqual(["id", "night_on", "areas", "starts_at", "ends_at", "bucket_pence", "updated_at"]);
    const col = (k: string) => cols[k] as Record<string, unknown>;
    expect(col("night_on")).toMatchObject({ type: "date", notNull: true, unique: true });
    expect(col("areas")).toMatchObject({ type: "text", notNull: true });
    expect(col("starts_at")).toMatchObject({ type: "time" });
    expect(col("starts_at")).not.toHaveProperty("notNull");
    expect(col("ends_at")).toMatchObject({ type: "time" });
    expect(col("ends_at")).not.toHaveProperty("notNull");
    expect(col("bucket_pence")).toMatchObject({ type: "integer", notNull: true, default: 0, check: "bucket_pence >= 0" });
  });

  it("creates the one row of settings, with the start of the year's count and the switch off day", () => {
    const { pgm, calls } = recorder();
    load().up(pgm);
    const settings = calls.find((c) => c[0] === "createTable" && c[1] === "sleigh_settings");
    expect(settings).toBeDefined();
    const cols = settings![2] as Columns;
    expect(Object.keys(cols)).toEqual(["id", "season_from", "off_on", "updated_at"]);
    expect(cols.id).toMatchObject({ type: "integer", primaryKey: true, check: "id = 1" });
    expect(cols.season_from).toMatchObject({ type: "date", notNull: true, default: "2026-11-01" });
    expect(cols.off_on).toMatchObject({ type: "date", notNull: true, default: "2027-01-31" });
  });

  it("seeds the seven 2026 nights from the poster, times to be added, and the settings row, each only once", () => {
    const { pgm, calls } = recorder();
    load().up(pgm);
    const sql = calls.filter((c) => c[0] === "sql").map((c) => String(c[1])).join("\n");
    const nights: Array<[string, string]> = [
      ["2026-12-15", "New Farm"],
      ["2026-12-16", "Wardneuk, Onthank & Altonhill"],
      ["2026-12-17", "Bellfield & Shortlees"],
      ["2026-12-18", "Fardalehill, Margaret Parker, Whisky"],
      ["2026-12-20", "Southcraig & surrounding"],
      ["2026-12-21", "Gargieston & Moorfield"],
      ["2026-12-22", "Caprington & Grange"],
    ];
    for (const [on, areas] of nights) expect(sql).toContain(`('${on}', '${areas}')`);
    expect(sql.match(/\('2026-12-\d\d', /g)).toHaveLength(7);
    expect(sql).toMatch(/INSERT INTO sleigh_nights \(night_on, areas\) VALUES[\s\S]*ON CONFLICT \(night_on\) DO NOTHING/);
    expect(sql).toMatch(/INSERT INTO sleigh_settings \(id\) VALUES \(1\) ON CONFLICT DO NOTHING/);
  });

  it("is additive: nothing existing is altered or dropped on the way up", () => {
    const { pgm, calls } = recorder();
    load().up(pgm);
    expect(calls.map((c) => c[0]).filter((m) => m !== "createTable" && m !== "sql")).toEqual([]);
  });

  it("is undone by dropping the two new tables", () => {
    const { pgm, calls } = recorder();
    load().down(pgm);
    expect(calls).toEqual([
      ["dropTable", "sleigh_settings", { ifExists: true }],
      ["dropTable", "sleigh_nights", { ifExists: true }],
    ]);
  });
});
