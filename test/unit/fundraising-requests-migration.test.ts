import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { REQUEST_KINDS, REQUEST_STATUSES, SEND_HOW } from "../../src/fundraising/requests";

// TASK-505: one new table, fundraiser_requests, one row per fundraiser and kind of request, made
// when staff first act on it. Nothing already there changes, so a code rollback is safe (golden
// rule 2). Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000080_fundraising-requests.js";
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
      addConstraint: record("addConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; references?: string; onDelete?: string; check?: string };

describe("the requests migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraiser_requests");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;
  const opts = (table?.args[2] ?? {}) as { constraints?: { check?: string | string[]; unique?: unknown } };

  it("sorts after the team's tools (070), the highest before it", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000070_fundraising-team.js"));
  });

  it("keeps each request's step, counts, dates, who and notes", () => {
    expect(Object.keys(cols).sort()).toEqual(
      [
        "back_note",
        "back_on",
        "created_at",
        "done_on",
        "fundraiser_id",
        "going",
        "handled_by",
        "how",
        "id",
        "kind",
        "link",
        "note",
        "quantity",
        "quantity_back",
        "sent_on",
        "status",
        "updated_at",
        "updated_by",
      ].sort(),
    );
    expect(cols.fundraiser_id).toMatchObject({ notNull: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(cols.kind.notNull).toBe(true);
    expect(cols.status.notNull).toBe(true);
    for (const d of ["sent_on", "back_on", "done_on"]) expect(cols[d].type).toBe("date");
  });

  it("allows only the kinds, steps and ways of sending the code knows", () => {
    for (const k of REQUEST_KINDS) expect(cols.kind.check).toContain(`'${k}'`);
    for (const s of REQUEST_STATUSES) expect(cols.status.check).toContain(`'${s}'`);
    for (const h of SEND_HOW) expect(cols.how.check).toContain(`'${h}'`);
  });

  it("has one row per fundraiser and kind, and keeps notes and links to a sensible length", () => {
    expect(JSON.stringify(opts.constraints?.unique)).toContain("fundraiser_id");
    expect(JSON.stringify(opts.constraints?.unique)).toContain("kind");
    const checks = JSON.stringify(opts.constraints?.check);
    expect(checks).toContain("char_length(note) <= 500");
    expect(checks).toContain("char_length(back_note) <= 500");
    expect(checks).toContain("char_length(link) <= 500");
  });

  it("changes nothing already there: one new table, no drops, no raw SQL", () => {
    expect(calls.map((c) => `${c.op}:${c.args[0]}`)).toEqual(["createTable:fundraiser_requests"]);
  });

  it("undoes itself", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.map((c) => `${c.op}:${c.args[0]}`)).toEqual(["dropTable:fundraiser_requests"]);
  });
});
