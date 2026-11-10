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
  const FILE = "1791200000350_permissions-elf.js";

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
    expect(sorted().indexOf("1791200000330_donation-invoices.js")).toBeGreaterThan(-1);
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf("1791200000330_donation-invoices.js"));
  });
});

describe("the migration that lets a head elf remove a family", () => {
  const FILE = "1791200000360_elf-families-removed.js";

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
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf("1791200000350_permissions-elf.js"));
  });
});

describe("the migration for the 24 doors, their names that count and their clues", () => {
  const FILE = "1791200000420_elf-doors.js";

  type Call = { fn: string; args: Any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
  /** Every pgm call a migration makes, in order, from a pretend pgm. */
  function callsOf(way: "up" | "down"): Call[] {
    const calls: Call[] = [];
    const pgm: Any = new Proxy(
      { func: (s: string) => ({ func: s }) },
      { get: (t: Any, fn: string) => t[fn] ?? ((...args: Any[]) => calls.push({ fn, args })) },
    );
    require(resolve(DIR, FILE))[way](pgm);
    return calls;
  }
  const table = (name: string) => callsOf("up").find((c) => c.fn === "createTable" && c.args[0] === name)!;
  const cols = (name: string) => Object.keys(table(name).args[1]);

  it("creates elf_doors with exactly the agreed columns, a unique poster code and a 1 to 24 door", () => {
    expect(cols("elf_doors").sort()).toEqual(
      [
        "year", "door", "place_name", "place_town", "place_address", "contact_name", "contact_phone",
        "contact_email", "elf_spot", "agreed_by", "prize", "prize_show_off", "elf_name", "tag_word",
        "closes_at", "clue1_time", "clue2_time", "clue3_time", "reveal_time", "poster_code",
        "tag_printed_at", "dropped_off_at", "dropped_off_by", "thanked_at", "thanked_by",
        "updated_at", "updated_by",
      ].sort(),
    );
    const c = table("elf_doors").args[1];
    expect(c.poster_code).toMatchObject({ type: "text", notNull: true, unique: true });
    expect(c.door.check).toBe("door BETWEEN 1 AND 24");
    expect(c.prize_show_off).toMatchObject({ type: "boolean", notNull: true, default: false });
    for (const k of ["closes_at", "clue1_time", "clue2_time", "clue3_time", "reveal_time"]) {
      expect(c[k].type).toBe("text");
      expect(c[k].check).toBe(`${k} IS NULL OR ${k} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`);
    }
    expect(table("elf_doors").args[2].constraints).toMatchObject({ primaryKey: ["year", "door"] });
  });

  it("creates elf_door_names and elf_clues, each cascading from its door", () => {
    expect(cols("elf_door_names").sort()).toEqual(["id", "year", "door", "name", "added_at", "added_by"].sort());
    expect(table("elf_door_names").args[1].name.check).toBe("char_length(name) BETWEEN 1 AND 80");
    expect(cols("elf_clues").sort()).toEqual(["year", "door", "n", "words", "updated_at", "updated_by"].sort());
    expect(table("elf_clues").args[1].words.check).toBe("char_length(words) BETWEEN 1 AND 500");
    expect(table("elf_clues").args[1].n.check).toBe("n BETWEEN 1 AND 3");
    expect(table("elf_clues").args[2].constraints).toMatchObject({ primaryKey: ["year", "door", "n"] });
    for (const t of ["elf_door_names", "elf_clues"]) {
      expect(table(t).args[2].constraints.foreignKeys).toMatchObject({
        columns: ["year", "door"],
        references: "elf_doors(year, door)",
        onDelete: "CASCADE",
      });
    }
  });

  it("adds the place phone setting, empty to start with", () => {
    const add = callsOf("up").find((c) => c.fn === "addColumns")!;
    expect(add.args[0]).toBe("elf_settings");
    expect(add.args[1]).toEqual({
      place_phone: { type: "text", check: "place_phone IS NULL OR char_length(place_phone) <= 40" },
    });
  });

  it("can be taken back, children first", () => {
    expect(callsOf("down").map((c) => [c.fn, c.args[0]])).toEqual([
      ["dropColumns", "elf_settings"],
      ["dropTable", "elf_clues"],
      ["dropTable", "elf_door_names"],
      ["dropTable", "elf_doors"],
    ]);
    expect(callsOf("down")[0].args[1]).toEqual(["place_phone"]);
  });

  it("sorts last in migrations", () => {
    expect(sorted().at(-1)).toBe(FILE);
  });
});
