import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-501: the private area. Two new tables (the emailed sign in codes and the signed in sessions,
// both kept only as hashes), and two new columns: when an organiser said they have finished, and
// which gifts were paid in by the organiser. Every one nullable or with a default, so the rows
// already there are untouched and a code rollback is safe (golden rule 2). Checked against a fake
// pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000050_fundraising-private-area.js";
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

type Col = { type: string; notNull?: boolean; default?: unknown; primaryKey?: boolean };

describe("the private area migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const tables = calls.filter((c) => c.op === "createTable");
  const tableCols = (name: string) => (tables.find((t) => t.args[0] === name)?.args[1] ?? {}) as Record<string, Col>;
  const adds = calls.filter((c) => c.op === "addColumns");

  // It sorted last when it merged; later migrations (TASK-502 on) sort after it, as they must.
  it("sorts after everything that was on main before it", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000040_fundraiser-sign-up-details.js"));
  });

  it("keeps one sign in code per email, as a hash, with an expiry and a count of tries", () => {
    const cols = tableCols("fundraiser_sign_in_codes");
    expect(Object.keys(cols).sort()).toEqual(["attempts", "code_hash", "created_at", "email", "expires_at"]);
    expect(cols.email.primaryKey).toBe(true);
    expect(cols.code_hash).toMatchObject({ type: "text", notNull: true });
    expect(cols.attempts).toMatchObject({ type: "integer", notNull: true, default: 0 });
    expect(cols.expires_at).toMatchObject({ type: "timestamptz", notNull: true });
  });

  it("keeps each signed in session as a hash, for one email, with an expiry", () => {
    const cols = tableCols("fundraiser_sessions");
    expect(Object.keys(cols).sort()).toEqual(["created_at", "email", "expires_at", "session_hash"]);
    expect(cols.session_hash.primaryKey).toBe(true);
    expect(cols.email).toMatchObject({ type: "text", notNull: true });
    expect(cols.expires_at).toMatchObject({ type: "timestamptz", notNull: true });
  });

  it("adds when the organiser said they have finished, nullable", () => {
    const f = adds.find((a) => a.args[0] === "fundraisers");
    expect(f?.args[1]).toEqual({ finished_requested_at: { type: "timestamptz" } });
  });

  it("marks a gift paid in by the organiser, false for every gift already there", () => {
    const d = adds.find((a) => a.args[0] === "donations");
    expect(d?.args[1]).toEqual({ paid_in_by_organiser: { type: "boolean", notNull: true, default: false } });
  });

  it("drops nothing, renames nothing and rewrites no row on the way up", () => {
    expect(calls.map((c) => c.op).filter((op) => !["createTable", "createIndex", "addColumns"].includes(op))).toEqual([]);
  });

  it("can be undone", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    const ops = down.calls.map((c) => `${c.op}:${String(c.args[0])}`);
    expect(ops).toEqual(
      expect.arrayContaining([
        "dropColumns:donations",
        "dropColumns:fundraisers",
        "dropTable:fundraiser_sessions",
        "dropTable:fundraiser_sign_in_codes",
      ]),
    );
  });
});
