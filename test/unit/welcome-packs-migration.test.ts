import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Welcome packs (Jaimie, 2026-10-03): the tick list staff pack and post for each approved page. Two
// new tables, so a code rollback is safe (golden rule 2). It must sort after every migration on its
// way to main before it (up to 225): node-pg-migrate refuses on production to run one that sorts
// before a migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000230_welcome-packs.js";

type Call = { op: string; args: unknown[] };
function run(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm = new Proxy(
    { func: (s: string) => ({ fn: s }) },
    {
      get(target, op: string) {
        if (op in target) return (target as Record<string, unknown>)[op];
        return (...args: unknown[]) => calls.push({ op, args });
      },
    },
  );
  const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as Record<"up" | "down", (p: unknown) => void>;
  migration[fn](pgm);
  return calls;
}

type Cols = Record<string, Record<string, unknown>>;
const table = (name: string) => {
  const c = run("up").find((x) => x.op === "createTable" && x.args[0] === name);
  expect(c, `no table ${name}`).toBeTruthy();
  return c!.args as [string, Cols, { constraints?: { check?: string[]; unique?: unknown } }];
};

describe("the welcome packs migration", () => {
  it("adds two tables and nothing else", () => {
    const up = run("up");
    expect(up.filter((c) => c.op === "createTable").map((c) => c.args[0])).toEqual(["welcome_packs", "welcome_pack_items"]);
    expect(up.filter((c) => !["createTable", "createIndex"].includes(c.op))).toEqual([]);
  });

  it("keeps one pack per fundraiser, cleared with it: when it was sent, by whom, and who signs the letter", () => {
    const [, cols] = table("welcome_packs");
    expect(cols.fundraiser_id).toMatchObject({ type: "integer", notNull: true, unique: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(cols.sent_at).toMatchObject({ type: "timestamptz" });
    expect(cols.sent_at.notNull).toBeUndefined();
    expect(cols.sent_by).toMatchObject({ type: "text" });
    // When the signer was chosen, so each staff member's last choice is exactly their last.
    expect(cols.signer_at).toMatchObject({ type: "timestamptz" });
    for (const c of ["signer", "signer_role", "signer_by"]) {
      expect(cols[c]).toMatchObject({ type: "text" });
      expect(cols[c].notNull).toBeUndefined();
    }
  });

  it("keeps one row per thing in a pack: what it was called and how many when ticked, who ticked it and when, or why it was left out", () => {
    const [, cols, opts] = table("welcome_pack_items");
    expect(cols.pack_id).toMatchObject({ type: "integer", notNull: true, references: "welcome_packs", onDelete: "CASCADE" });
    expect(cols.key).toMatchObject({ type: "text", notNull: true });
    expect(cols.label).toMatchObject({ type: "text", notNull: true });
    expect(cols.quantity).toMatchObject({ type: "integer" });
    expect(cols.ticked_at).toMatchObject({ type: "timestamptz" });
    expect(cols.ticked_by).toMatchObject({ type: "text" });
    expect(cols.skipped_reason).toMatchObject({ type: "text" });
    expect(opts.constraints?.unique).toEqual(["pack_id", "key"]);
    const checks = (opts.constraints?.check ?? []).join(" ");
    expect(checks).toContain("char_length(skipped_reason) <= 200");
    // Ticked or left out, never both.
    expect(checks).toContain("ticked_at IS NULL OR skipped_reason IS NULL");
  });

  it("only drops its own tables on the way down, the items first", () => {
    expect(run("down")).toEqual([
      { op: "dropTable", args: ["welcome_pack_items"] },
      { op: "dropTable", args: ["welcome_packs"] },
    ]);
  });

  it("sorts after the migrations on their way to main before it", () => {
    expect(NAME > "1791200000225").toBe(true);
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names.indexOf(NAME)).toBeGreaterThan(names.indexOf("1791200000210_signup-tidy.js"));
  });
});
