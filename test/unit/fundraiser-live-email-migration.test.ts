import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TASK-497: someone approved while fundraising is switched off is marked as waiting for their
// "Your page is live" email, sent when an admin switches fundraising on. One new column, with a
// default, so it is additive (golden rule 2) and a code rollback is safe. Checked against a fake
// pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000020_fundraiser-live-email-pending.js";
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
    pgm: { addColumns: record("addColumns"), dropColumns: record("dropColumns"), sql: record("sql"), func: (s: string) => ({ func: s }) },
  };
}

describe("the waiting for the live email migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);

  it("adds one boolean column to fundraisers, defaulting to not waiting", () => {
    const adds = calls.filter((c) => c.op === "addColumns");
    expect(adds).toHaveLength(1);
    expect(adds[0].args[0]).toBe("fundraisers");
    expect(adds[0].args[1]).toEqual({ live_email_pending: { type: "boolean", notNull: true, default: false } });
  });

  it("drops nothing and renames nothing on the way up", () => {
    expect(calls.map((c) => c.op).filter((op) => op !== "addColumns" && op !== "sql")).toEqual([]);
    for (const c of calls.filter((c) => c.op === "sql")) expect(String(c.args[0])).not.toMatch(/\b(DROP|ALTER|DELETE|RENAME)\b/i);
  });

  // Anyone already approved with a page while fundraising has never been on is still waiting for
  // the news that their page is live, so they get it too when it is switched on.
  it("marks as waiting the page holders already approved, only if fundraising has never been switched on", () => {
    const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    expect(sql).toMatch(/UPDATE fundraisers SET live_email_pending = true/);
    expect(sql).toMatch(/status = 'approved'/);
    expect(sql).toMatch(/public/);
    expect(sql).toMatch(/path = 'raising'/);
    expect(sql).toMatch(/fundraising\.switched/);
  });

  it("can be undone", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls).toEqual([{ op: "dropColumns", args: ["fundraisers", ["live_email_pending"]] }]);
  });
});
