import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-503: the team's tools. Two new tables (the invites, kept with only a hash of their token, and
// the calls made to each fundraiser), when a fundraiser was taken off Get involved, and the Monday
// summary's list of people and the last week it went. Every one new, nullable or with a default, so
// the rows already there are untouched and a code rollback is safe (golden rule 2). Checked against a
// fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000070_fundraising-team.js";
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
    pgm: {
      createTable: record("createTable"),
      dropTable: record("dropTable"),
      createIndex: record("createIndex"),
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; primaryKey?: boolean; unique?: boolean; references?: string; onDelete?: string; check?: string };

describe("the team's tools migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const tables = calls.filter((c) => c.op === "createTable");
  const tableCols = (name: string) => (tables.find((t) => t.args[0] === name)?.args[1] ?? {}) as Record<string, Col>;
  const tableOpts = (name: string) => (tables.find((t) => t.args[0] === name)?.args[2] ?? {}) as { constraints?: { check?: string | string[] } };
  const adds = calls.filter((c) => c.op === "addColumns");
  const added = (table: string) => (adds.find((a) => a.args[0] === table)?.args[1] ?? {}) as Record<string, Col>;

  // It sorted last when it shipped; later migrations (TASK-505's 080 onwards) now sort after it.
  it("sorts after the private area (050) and the wall after paying (060)", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000050_fundraising-private-area.js"));
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000060_fundraising-wall-after-paying.js"));
  });

  it("keeps each invite with only a hash of its token, who signed and sent it, and when it was used", () => {
    const cols = tableCols("fundraiser_invites");
    expect(Object.keys(cols).sort()).toEqual(
      ["created_at", "email", "id", "name", "note", "resent_at", "sent_by", "signed_by", "token_hash", "used_at", "used_by_fundraiser_id"].sort(),
    );
    expect(cols.token_hash).toMatchObject({ type: "text", notNull: true, unique: true });
    expect(cols.used_by_fundraiser_id).toMatchObject({ references: "fundraisers", onDelete: "SET NULL" });
    expect(cols.name.notNull).toBe(true);
    expect(cols.email.notNull).toBe(true);
    expect(JSON.stringify(tableOpts("fundraiser_invites").constraints)).toContain("char_length(note) <= 600");
  });

  it("keeps each call: which one, when, who by, and a note of up to 500 characters", () => {
    const cols = tableCols("fundraiser_calls");
    expect(Object.keys(cols).sort()).toEqual(["called_at", "called_by", "fundraiser_id", "id", "note", "which"]);
    expect(cols.fundraiser_id).toMatchObject({ notNull: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(cols.which.check).toContain("'before', 'after'");
    expect(JSON.stringify(tableOpts("fundraiser_calls").constraints)).toContain("char_length(note) <= 500");
  });

  it("adds when and by whom a fundraiser was taken off Get involved, both empty to start", () => {
    const cols = added("fundraisers");
    expect(Object.keys(cols).sort()).toEqual(["off_list_at", "off_list_by"]);
    for (const c of Object.values(cols)) expect(c.notNull).toBeFalsy();
  });

  it("adds the summary's list of people (empty) and the last week it went (none yet) to the settings row", () => {
    const cols = added("fundraising_settings");
    expect(cols.summary_recipients).toMatchObject({ type: "jsonb", notNull: true });
    expect(cols.summary_last_week).toMatchObject({ type: "date" });
    expect(cols.summary_last_week.notNull).toBeFalsy();
  });

  it("changes nothing already there: no drops, no renames, no raw SQL", () => {
    expect(calls.filter((c) => !["createTable", "createIndex", "addColumns"].includes(c.op))).toEqual([]);
  });

  it("undoes itself", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.map((c) => `${c.op}:${c.args[0]}`)).toEqual([
      "dropColumns:fundraising_settings",
      "dropColumns:fundraisers",
      "dropTable:fundraiser_calls",
      "dropTable:fundraiser_invites",
    ]);
  });
});
