import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Elf Detective School, Christmas Eve and the grand prize (Plan 2c-2; docs/superpowers/specs/
// 2026-11-12-elf-catch-up-and-grand-prize-design.md): the entries and their pictures, two settings
// (when the entries close, and the graduates' video) and the families' email switch. Additive: two new
// tables, and new columns that are empty or have a default. The pictures are kept apart so the nightly
// backup leaves them out, as photos are. It must sort after the newest migration main held before it,
// or production refuses to run it.
const require = createRequire(import.meta.url);
const DIR = resolve(__dirname, "../../migrations");
const FILE = "1791200000490_elf-grand-prize.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Call = { fn: string; args: Any[] };
/** Every pgm call a migration makes, in order, from a pretend pgm. */
function callsOf(file: string, way: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm: Any = new Proxy({ func: (s: string) => ({ func: s }) }, { get: (t: Any, fn: string) => t[fn] ?? ((...args: Any[]) => calls.push({ fn, args })) });
  require(resolve(DIR, file))[way](pgm);
  return calls;
}

/** A migration's number, which is how node-pg-migrate orders them. */
const numberOf = (file: string) => Number(file.split("_")[0]);

const up = () => callsOf(FILE, "up");
/** The columns up adds to a table that is already there. */
const added = (table: string) => up().find((c) => c.fn === "addColumns" && c.args[0] === table)!.args[1];
/** A table up makes: its name, its columns and its options. */
const made = (table: string) => up().find((c) => c.fn === "createTable" && c.args[0] === table)!.args;

describe("the migration for the grand prize", () => {
  it("adds to the settings and the families, makes the two tables and one index, and nothing else", () => {
    expect(up().map((c) => [c.fn, c.args[0]])).toEqual([
      ["addColumns", "elf_settings"],
      ["addColumns", "elf_families"],
      ["createTable", "elf_grand_prize_entries"],
      ["createIndex", "elf_grand_prize_entries"],
      ["createTable", "elf_grand_prize_files"],
    ]);
  });

  it("adds when the entries close, empty for 5pm on Christmas Eve, and the graduates' video, an https link or nothing", () => {
    expect(added("elf_settings")).toEqual({
      grand_prize_closes_at: {
        type: "timestamptz",
        comment: "When grand prize entries close on Christmas Eve. Empty: 5pm on 24 December of year.",
      },
      graduate_video_url: {
        type: "text",
        check: "graduate_video_url IS NULL OR (graduate_video_url ~ '^https://' AND char_length(graduate_video_url) <= 300)",
        comment: "The graduates' video, an https link. Empty: there is none, and Detective HQ shows no video link.",
      },
    });
  });

  it("gives the families the email switch: empty, so the emails go, and a random token for every family", () => {
    const families = added("elf_families");
    expect(Object.keys(families)).toEqual(["emails_stopped_at", "emails_token"]);
    expect(families.emails_stopped_at).toEqual({
      type: "timestamptz",
      comment: "When the family stopped the emails that are not essential. Empty: the emails go.",
    });
    const token = families.emails_token;
    expect(token).toMatchObject({ type: "text", notNull: true, unique: true });
    // A function, not a value: Postgres works it out again for each family already there, so every
    // family gets a token of its own, 32 lower case hex letters.
    expect(token.default.func).toContain("gen_random_uuid()");
    expect(token.default).toEqual({ func: "replace(gen_random_uuid()::text, '-', '')" });
    expect(token.comment).toContain("stop");
  });

  it("makes the entries, one a detective a year, with exactly the agreed columns", () => {
    const [, columns, options] = made("elf_grand_prize_entries");
    expect(Object.keys(columns)).toEqual([
      "id", "year", "detective_id", "family_id", "mime", "width", "height", "sent_at", "winner_at", "winner_by",
    ]);
    // node-pg-migrate's shorthand for serial PRIMARY KEY.
    expect(columns.id).toBe("id");
    expect(columns.year).toEqual({ type: "integer", notNull: true });
    expect(columns.detective_id).toEqual({ type: "integer", notNull: true, references: "elf_detectives", onDelete: "CASCADE" });
    expect(columns.family_id).toEqual({ type: "integer", notNull: true, references: "elf_families", onDelete: "CASCADE" });
    expect(columns.mime).toEqual({ type: "text", notNull: true });
    expect(columns.width).toEqual({ type: "integer", notNull: true });
    expect(columns.height).toEqual({ type: "integer", notNull: true });
    expect(columns.sent_at).toEqual({ type: "timestamptz", notNull: true, default: { func: "now()" } });
    expect(columns.winner_at).toEqual({ type: "timestamptz" });
    expect(columns.winner_by).toEqual({ type: "text" });
    expect(options.constraints).toEqual({ unique: ["year", "detective_id"] });
  });

  it("says on the entries that they are never public and that the clear out must take them", () => {
    const [, , options] = made("elf_grand_prize_entries");
    expect(options.comment).toContain("never public");
    expect(options.comment).toContain("end of January");
    expect(options.comment).toContain("clear out, which must take");
  });

  it("keeps one winner a year: unique on the year, only where a winner is marked", () => {
    const index = up().find((c) => c.fn === "createIndex")!;
    expect(index.args).toEqual([
      "elf_grand_prize_entries",
      "year",
      { name: "elf_grand_prize_one_winner", unique: true, where: "winner_at IS NOT NULL" },
    ]);
  });

  it("keeps the pictures apart, so the nightly backup leaves them out", () => {
    const [, columns, options] = made("elf_grand_prize_files");
    expect(columns).toEqual({
      entry_id: { type: "integer", primaryKey: true, references: "elf_grand_prize_entries", onDelete: "CASCADE" },
      bytes: { type: "bytea", notNull: true },
    });
    expect(options.comment).toContain("kept apart");
    expect(options.comment).toContain("nightly backup leaves them out");
  });

  // Dropping the entries takes their index with them, as the game's migration's down does.
  it("can be taken back, in reverse", () => {
    expect(callsOf(FILE, "down")).toEqual([
      { fn: "dropTable", args: ["elf_grand_prize_files"] },
      { fn: "dropTable", args: ["elf_grand_prize_entries"] },
      { fn: "dropColumns", args: ["elf_families", ["emails_stopped_at", "emails_token"]] },
      { fn: "dropColumns", args: ["elf_settings", ["grand_prize_closes_at", "graduate_video_url"]] },
    ]);
  });

  // Not "sorts last": that breaks the next session's migration. Before merging, check by hand that it
  // still sorts after main's newest.
  it("sorts after the newest migration main held before it", () => {
    const sorted = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
    const catchUp = "1791200000480_elf-catch-up.js";
    expect(sorted.indexOf(catchUp)).toBeGreaterThan(-1);
    expect(sorted.indexOf(FILE)).toBeGreaterThan(sorted.indexOf(catchUp));
    expect(numberOf(FILE)).toBeGreaterThan(numberOf(catchUp));
  });
});
