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

  // It sorted last when it was made; later migrations (the Santa Sleigh's, TASK-608) come after it, so
  // what must hold is that it runs after every one merged before it.
  it("sorts after the migrations merged before it", () => {
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf("1791200000410_uniform-payments.js"));
  });
});

describe("the migration for the game's tables", () => {
  const FILE = "1791200000440_elf-game.js";

  type Call = { fn: string; args: Any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
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
  const cols = (name: string) => Object.keys(table(name).args[1]).sort();
  const gameKey = ["year", "door", "family_id"];

  it("creates exactly the six game tables, with the agreed columns", () => {
    const made = callsOf("up").filter((c) => c.fn === "createTable").map((c) => c.args[0]);
    expect(made).toEqual(["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos", "elf_photo_files", "elf_practice"]);
    expect(cols("elf_guesses")).toEqual([...gameKey, "text", "norm", "saved_at"].sort());
    expect(cols("elf_word_tries")).toEqual([...gameKey, "wrong", "updated_at"].sort());
    expect(cols("elf_visits")).toEqual(
      ["id", "year", "door", "family_id", "detective_id", "typed_at", "counts_from", "found", "look"].sort(),
    );
    expect(cols("elf_photos")).toEqual(
      [
        "id", "token", "year", "door", "family_id", "status", "mime", "width", "height", "sent_at",
        "decided_at", "decided_by", "decline_reason", "taken_down_at", "taken_down_by", "deleted_at",
      ].sort(),
    );
    expect(cols("elf_photo_files")).toEqual(["bytes", "photo_id"]);
    expect(cols("elf_practice")).toEqual(
      [
        "id", "started_at", "started_by", "place_name", "place_town", "elf_name", "tag_word", "poster_code",
        "clue1_at", "clue2_at", "clue3_at", "reveal_at", "found_at", "found_family_id",
      ].sort(),
    );
  });

  it("allows door 0 (the practice door) and keeps no foreign key to elf_doors", () => {
    for (const t of ["elf_guesses", "elf_word_tries", "elf_visits", "elf_photos"]) {
      const c = table(t).args[1];
      expect(c.year).toMatchObject({ type: "integer", notNull: true });
      expect(c.door).toMatchObject({ type: "integer", notNull: true, check: "door BETWEEN 0 AND 24" });
      expect(JSON.stringify(table(t).args[2] ?? {})).not.toContain("elf_doors");
      expect(c.family_id).toMatchObject({ notNull: true, references: "elf_families", onDelete: "CASCADE" });
    }
  });

  it("keys a family's guess and tries by year, door and family", () => {
    for (const t of ["elf_guesses", "elf_word_tries"]) {
      expect(table(t).args[2].constraints).toMatchObject({ primaryKey: gameKey });
    }
    expect(table("elf_guesses").args[1].text.check).toBe("char_length(text) BETWEEN 1 AND 80");
    expect(table("elf_word_tries").args[1].wrong).toMatchObject({ notNull: true, default: 0 });
  });

  it("makes a visit unique per detective per door, indexed by when it counts from", () => {
    expect(table("elf_visits").args[2].constraints).toMatchObject({ unique: ["year", "door", "detective_id"] });
    expect(table("elf_visits").args[1].detective_id).toMatchObject({ references: "elf_detectives", onDelete: "CASCADE" });
    expect(table("elf_visits").args[1].found).toMatchObject({ type: "boolean", notNull: true, default: false });
    const idx = callsOf("up").filter((c) => c.fn === "createIndex");
    expect(idx.map((c) => [c.args[0], c.args[1]])).toEqual(
      expect.arrayContaining([
        ["elf_visits", ["year", "door", "counts_from"]],
        ["elf_photos", ["year", "door", "status"]],
        ["elf_photos", ["status", "sent_at"]],
      ]),
    );
  });

  it("gives a photo a unique token and a fixed list of statuses, its bytes kept apart", () => {
    const p = table("elf_photos").args[1];
    expect(p.token).toMatchObject({ type: "text", notNull: true, unique: true });
    for (const s of ["waiting", "approved", "declined", "replaced", "taken-down", "deleted"]) {
      expect(p.status.check).toContain(`'${s}'`);
    }
    expect(p.status).toMatchObject({ notNull: true, default: "waiting" });
    expect(p.decline_reason.check).toBe("decline_reason IS NULL OR char_length(decline_reason) <= 200");
    const f = table("elf_photo_files");
    expect(f.args[1].photo_id).toMatchObject({ type: "integer", primaryKey: true, references: "elf_photos", onDelete: "CASCADE" });
    expect(f.args[1].bytes).toMatchObject({ type: "bytea", notNull: true });
    expect(f.args[2].comment).toContain("backup");
  });

  it("keeps the practice door to one row", () => {
    const c = table("elf_practice").args[1];
    expect(c.id).toMatchObject({ type: "integer", primaryKey: true, check: "id = 1" });
    expect(c.found_family_id).toMatchObject({ references: "elf_families", onDelete: "SET NULL" });
    for (const k of ["clue1_at", "clue2_at", "clue3_at", "reveal_at"]) {
      expect(c[k]).toMatchObject({ type: "timestamptz", notNull: true });
    }
  });

  it("adds the doors switch, the door columns and the clue picture columns", () => {
    const adds = callsOf("up").filter((c) => c.fn === "addColumns");
    const of = (t: string) => adds.find((c) => c.args[0] === t)!.args[1];
    expect(of("elf_settings")).toEqual({ doors_on: { type: "boolean", notNull: true, default: false } });
    expect(Object.keys(of("elf_doors")).sort()).toEqual(
      ["found_at", "found_family_id", "snow_day_at", "snow_day_by", "gone_home_at", "gone_home_by"].sort(),
    );
    expect(of("elf_doors").found_family_id).toMatchObject({ references: "elf_families", onDelete: "SET NULL" });
    expect(Object.keys(of("elf_clues")).sort()).toEqual(
      ["picture", "picture_mime", "picture_width", "picture_height", "picture_alt"].sort(),
    );
    expect(of("elf_clues").picture_alt.check).toBe("picture_alt IS NULL OR char_length(picture_alt) <= 200");
  });

  it("lets a clue be words or a picture: words only loses its NOT NULL", () => {
    const up = callsOf("up");
    const alter = up.filter((c) => c.fn === "alterColumn");
    expect(alter.map((c) => c.args)).toEqual([["elf_clues", "words", { notNull: false }]]);
    const cons = up.find((c) => c.fn === "addConstraint")!;
    expect(cons.args[0]).toBe("elf_clues");
    expect(cons.args[1]).toBe("elf_clues_has_something");
    expect(cons.args[2]).toEqual({ check: "words IS NOT NULL OR picture IS NOT NULL" });
  });

  it("can be taken back in reverse", () => {
    const down = callsOf("down").map((c) => [c.fn, c.args[0]]);
    expect(down.slice(0, 6)).toEqual([
      ["dropTable", "elf_practice"],
      ["dropTable", "elf_photo_files"],
      ["dropTable", "elf_photos"],
      ["dropTable", "elf_visits"],
      ["dropTable", "elf_word_tries"],
      ["dropTable", "elf_guesses"],
    ]);
    expect(callsOf("down").map((c) => c.fn)).toEqual(
      expect.arrayContaining(["dropConstraint", "dropColumns", "alterColumn"]),
    );
    expect(callsOf("down").filter((c) => c.fn === "dropColumns").map((c) => c.args[0]).sort()).toEqual(
      ["elf_clues", "elf_doors", "elf_settings"],
    );
  });

  // Not "sorts last": that breaks the next session's migration (as it did for the Doors' test when
  // the Santa Sleigh's landed). Before merging, check by hand that it still sorts after main's newest.
  it("sorts after every migration merged before it, the Santa Sleigh's included", () => {
    const before = "1791200000430_santa-sleigh.js";
    expect(sorted().indexOf(before)).toBeGreaterThan(-1);
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf(before));
  });
});

describe("the migration for the alert and send tables", () => {
  const FILE = "1791200000450_elf-alerts.js";

  type Call = { fn: string; args: Any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Any = any;
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
  const cols = (name: string) => Object.keys(table(name).args[1]).sort();

  it("creates exactly the three tables, with the agreed columns", () => {
    const made = callsOf("up").filter((c) => c.fn === "createTable").map((c) => c.args[0]);
    expect(made).toEqual(["elf_head_elves", "elf_alerts", "elf_sends"]);
    expect(cols("elf_head_elves")).toEqual(["user_id", "mobile", "alerts_on", "updated_at", "updated_by"].sort());
    expect(cols("elf_alerts")).toEqual(
      ["id", "kind", "sent_at", "year", "door", "emails", "texts", "texts_failed"].sort(),
    );
    expect(cols("elf_sends")).toEqual(["kind", "key", "claimed_at", "sent_at", "attempts", "last_error"].sort());
  });

  it("keeps a head elf's mobile as E.164 and the alerts on to start with", () => {
    const c = table("elf_head_elves").args[1];
    expect(c.user_id).toMatchObject({ type: "integer", primaryKey: true, references: "users", onDelete: "CASCADE" });
    expect(c.mobile).toMatchObject({ type: "text", check: "mobile IS NULL OR mobile ~ '^\\+447[0-9]{9}$'" });
    expect(c.alerts_on).toMatchObject({ type: "boolean", notNull: true, default: true });
    expect(c.updated_at).toMatchObject({ type: "timestamptz", notNull: true });
    expect(c.updated_by).toEqual({ type: "text" });
  });

  it("records each alert with its kind, counts and the names whose text failed", () => {
    const c = table("elf_alerts").args[1];
    expect(c.kind).toMatchObject({ type: "text", notNull: true, check: "kind IN ('photo', 'test')" });
    expect(c.year).toMatchObject({ type: "integer", notNull: true });
    expect(c.door).toEqual({ type: "integer" });
    expect(c.emails).toMatchObject({ type: "integer", notNull: true, default: 0 });
    expect(c.texts).toMatchObject({ type: "integer", notNull: true, default: 0 });
    expect(c.texts_failed).toMatchObject({ type: "text[]", notNull: true, default: "{}" });
  });

  it("claims each timed send once, keyed by kind and key", () => {
    const t = table("elf_sends");
    expect(t.args[1].kind).toMatchObject({ type: "text", notNull: true });
    expect(t.args[1].key).toMatchObject({ type: "text", notNull: true });
    expect(t.args[1].attempts).toMatchObject({ type: "integer", notNull: true, default: 1 });
    expect(t.args[2].constraints).toMatchObject({ primaryKey: ["kind", "key"] });
  });

  it("indexes alerts and sends by kind and when sent", () => {
    const idx = callsOf("up").filter((c) => c.fn === "createIndex").map((c) => [c.args[0], c.args[1]]);
    expect(idx).toEqual(
      expect.arrayContaining([
        ["elf_alerts", ["kind", "sent_at"]],
        ["elf_sends", ["kind", "sent_at"]],
      ]),
    );
  });

  it("can be taken back", () => {
    expect(callsOf("down").map((c) => [c.fn, c.args[0]])).toEqual([
      ["dropTable", "elf_sends"],
      ["dropTable", "elf_alerts"],
      ["dropTable", "elf_head_elves"],
    ]);
  });

  it("sorts after the game's migration", () => {
    const before = "1791200000440_elf-game.js";
    expect(sorted().indexOf(FILE)).toBeGreaterThan(sorted().indexOf(before));
  });
});
