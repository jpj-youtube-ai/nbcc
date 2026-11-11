import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// TASK-613: the grown up's mobile on elf_families, so a head elf can ring the grand prize winner on
// Christmas Eve. Additive: one empty column, as families from before it was asked have none. It is kept
// exactly as a head elf's own mobile is (elf_head_elves.mobile, 1791200000450_elf-alerts.js), and it
// must sort after the newest migration main held before it, or production refuses to run it.
const require = createRequire(import.meta.url);
const DIR = resolve(__dirname, "../../migrations");
const FILE = "1791200000460_elf-family-mobile.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Every pgm call a migration makes, in order, from a pretend pgm. */
function callsOf(file: string, way: "up" | "down"): { fn: string; args: Any[] }[] {
  const calls: { fn: string; args: Any[] }[] = [];
  const pgm: Any = new Proxy({ func: (s: string) => ({ func: s }) }, { get: (t: Any, fn: string) => t[fn] ?? ((...args: Any[]) => calls.push({ fn, args })) });
  require(resolve(DIR, file))[way](pgm);
  return calls;
}

/** The check a head elf's mobile has, from the migration that made it. */
const headElfMobileCheck = () => callsOf("1791200000450_elf-alerts.js", "up").find((c) => c.fn === "createTable" && c.args[0] === "elf_head_elves")!.args[1].mobile.check;

describe("the migration for the grown up's mobile", () => {
  it("adds one empty column to the families, and nothing else", () => {
    const calls = callsOf(FILE, "up");
    expect(calls.map((c) => c.fn)).toEqual(["addColumns"]);
    const [table, columns] = calls[0].args;
    expect(table).toBe("elf_families");
    expect(Object.keys(columns)).toEqual(["mobile"]);
    expect(columns.mobile.type).toBe("text");
    expect(columns.mobile.notNull).toBeUndefined();
    expect(columns.mobile.default).toBeUndefined();
  });

  it("keeps it exactly as a head elf's mobile is kept: +447 and nine digits, or nothing", () => {
    const check = callsOf(FILE, "up")[0].args[1].mobile.check;
    expect(check).toBe(headElfMobileCheck());
    expect(check).toBe("mobile IS NULL OR mobile ~ '^\\+447[0-9]{9}$'");
  });

  it("can be taken back", () => {
    expect(callsOf(FILE, "down")).toEqual([{ fn: "dropColumns", args: ["elf_families", ["mobile"]] }]);
  });

  it("sorts straight after the newest migration main held before it", () => {
    const sorted = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
    expect(sorted.indexOf(FILE)).toBe(sorted.indexOf("1791200000450_elf-alerts.js") + 1);
  });
});
