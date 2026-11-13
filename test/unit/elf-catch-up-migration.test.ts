import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// Elf Detective School, catching up on missed doors (docs/superpowers/specs/
// 2026-11-12-elf-catch-up-and-grand-prize-design.md): elf_guesses.late marks a go, the one guess a
// family makes at a door once its place is shown, which the guesses' primary key keeps to one a family
// a door. Additive: one column with a default, so every guess already saved reads as a guess on the
// night. It must sort after the newest migration main held before it, or production refuses to run it.
const require = createRequire(import.meta.url);
const DIR = resolve(__dirname, "../../migrations");
const FILE = "1791200000480_elf-catch-up.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
/** Every pgm call a migration makes, in order, from a pretend pgm. */
function callsOf(file: string, way: "up" | "down"): { fn: string; args: Any[] }[] {
  const calls: { fn: string; args: Any[] }[] = [];
  const pgm: Any = new Proxy({ func: (s: string) => ({ func: s }) }, { get: (t: Any, fn: string) => t[fn] ?? ((...args: Any[]) => calls.push({ fn, args })) });
  require(resolve(DIR, file))[way](pgm);
  return calls;
}

/** A migration's number, which is how node-pg-migrate orders them. */
const numberOf = (file: string) => Number(file.split("_")[0]);

describe("the migration for having a go", () => {
  it("adds one column to the guesses, false for every guess but a go, and nothing else", () => {
    const calls = callsOf(FILE, "up");
    expect(calls.map((c) => c.fn)).toEqual(["addColumns"]);
    expect(calls[0].args).toEqual([
      "elf_guesses",
      {
        late: {
          type: "boolean",
          notNull: true,
          default: false,
          comment: "A guess made when having a go, once the door was open: one only, and final.",
        },
      },
    ]);
  });

  it("can be taken back", () => {
    expect(callsOf(FILE, "down")).toEqual([{ fn: "dropColumns", args: ["elf_guesses", ["late"]] }]);
  });

  // Not "sorts last": that breaks the next session's migration. Before merging, check by hand that it
  // still sorts after main's newest.
  it("sorts after the newest migrations main held before it", () => {
    const sorted = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
    const familyMobile = "1791200000460_elf-family-mobile.js";
    expect(sorted.indexOf(familyMobile)).toBeGreaterThan(-1);
    expect(sorted.indexOf(FILE)).toBeGreaterThan(sorted.indexOf(familyMobile));
    // Main's newest when this was named (TASK-619's), which this branch does not hold yet: the number
    // alone must be above it.
    expect(numberOf(FILE)).toBeGreaterThan(numberOf("1791200000470_admin-push.js"));
  });
});
