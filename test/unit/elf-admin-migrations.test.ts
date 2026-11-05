import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Head Elf HQ's migrations (docs/superpowers/specs/2026-11-05-elf-admin-design.md). Each is additive,
// and each must sort after the newest migration main held before it, or production refuses to run it
// ("Not run migration X is preceding already run migration Y"), which CI cannot see.
const require = createRequire(import.meta.url);
const DIR = resolve(__dirname, "../../migrations");

/** The SQL a migration's up or down hands to node-pg-migrate, from a pretend pgm. */
function sqlOf(file: string, way: "up" | "down"): string {
  const sql: string[] = [];
  const pgm = { sql: (s: string) => sql.push(s) };
  require(resolve(DIR, file))[way](pgm);
  return sql.join("\n");
}

const sorted = () => readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();

describe("the Elf Detective School's permission migration", () => {
  const FILE = "1791200000330_permissions-elf.js";

  it("adds the elf section to every saved matrix that lacks it: admins edit, everyone else none", () => {
    const up = sqlOf(FILE, "up");
    expect(up).toContain("'elf'");
    expect(up).toContain("CASE WHEN role = 'admin' THEN 'edit' ELSE 'none' END");
    expect(up).toContain("NOT (permissions ? 'elf')");
    expect(up).toContain("permissions <> '{}'::jsonb");
  });

  it("can be taken back", () => {
    expect(sqlOf(FILE, "down")).toContain("permissions - 'elf'");
  });

  it("sorts after the newest migration main held before it", () => {
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf("1791200000320_elf-favourites.js"));
  });
});

describe("the migration that lets a head elf remove a family", () => {
  const FILE = "1791200000340_elf-families-removed.js";

  /** The columns a migration adds or drops, from a pretend pgm. */
  function columnsOf(way: "up" | "down") {
    const seen: { table: string; columns: unknown }[] = [];
    const pgm = {
      addColumns: (table: string, columns: unknown) => seen.push({ table, columns }),
      dropColumns: (table: string, columns: unknown) => seen.push({ table, columns }),
    };
    require(resolve(DIR, FILE))[way](pgm);
    return seen;
  }

  it("adds when and by whom a family was removed, both empty to start with", () => {
    const [added] = columnsOf("up");
    expect(added.table).toBe("elf_families");
    expect(added.columns).toEqual({ removed_at: { type: "timestamptz" }, removed_by: { type: "text" } });
  });

  it("can be taken back", () => {
    expect(columnsOf("down")).toEqual([{ table: "elf_families", columns: ["removed_at", "removed_by"] }]);
  });

  it("sorts after the permission migration", () => {
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf("1791200000330_permissions-elf.js"));
  });
});
