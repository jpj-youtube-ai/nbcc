import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-507: two new tables, the thank yous organisers send for checking and the gifts each one picked,
// with what happened to each gift's email. Nothing already there changes, so a code rollback is safe
// (golden rule 2). Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000110_fundraiser-thanks.js";
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
type Opts = { constraints?: { check?: string | string[] } };

describe("the thank yous migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = (name: string) => calls.find((c) => c.op === "createTable" && c.args[0] === name);
  const cols = (name: string) => (table(name)?.args[1] ?? {}) as Record<string, Col>;
  const opts = (name: string) => (table(name)?.args[2] ?? {}) as Opts;

  it("sorts above the requests (080, the highest on main when it was written) and the 100 another open task uses", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000080_fundraising-requests.js"));
    expect(NAME > "1791200000100_fundraiser-updates.js").toBe(true);
  });

  it("only creates two tables and their indexes", () => {
    expect(calls.map((c) => c.op).filter((op) => op !== "createIndex")).toEqual(["createTable", "createTable"]);
    expect(calls.filter((c) => c.op === "createTable").map((c) => c.args[0])).toEqual(["fundraiser_thanks", "fundraiser_thank_gifts"]);
  });

  it("keeps each thank you's words, where it is up to, and who decided", () => {
    const c = cols("fundraiser_thanks");
    expect(Object.keys(c).sort()).toEqual(
      ["created_at", "decided_at", "decided_by", "delivered_at", "fundraiser_id", "id", "message", "reject_reason", "status"].sort(),
    );
    expect(c.fundraiser_id).toMatchObject({ references: "fundraisers", onDelete: "CASCADE", notNull: true });
    expect(c.status).toMatchObject({ notNull: true, default: "pending" });
    expect(c.status.check).toContain("'pending', 'approved', 'rejected'");
    expect(JSON.stringify(opts("fundraiser_thanks").constraints)).toContain("char_length(message) BETWEEN 1 AND 600");
  });

  it("keeps each picked gift and what happened to its email, never an address", () => {
    const c = cols("fundraiser_thank_gifts");
    expect(Object.keys(c).sort()).toEqual(["donation_id", "id", "outcome", "sent_at", "skip_reason", "thanks_id", "updated_at"].sort());
    expect(c.thanks_id).toMatchObject({ references: "fundraiser_thanks", onDelete: "CASCADE", notNull: true });
    expect(c.donation_id).toMatchObject({ references: "donations", onDelete: "CASCADE", notNull: true });
    expect(c.outcome.check).toContain("'waiting', 'queued', 'sending', 'sent', 'skipped', 'failed', 'cancelled'");
    expect(Object.keys(c).filter((k) => /email|name|address/.test(k))).toEqual([]);
  });

  it("thanks a gift at most once: a unique index on the gift, except where a thank you was not sent", () => {
    const once = calls.find((c) => c.op === "createIndex" && c.args[0] === "fundraiser_thank_gifts" && c.args[1] === "donation_id");
    expect(once?.args[2]).toMatchObject({ unique: true, where: "outcome <> 'cancelled'" });
  });

  it("drops only its own two tables on the way down", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.map((c) => `${c.op}:${c.args[0]}`)).toEqual(["dropTable:fundraiser_thank_gifts", "dropTable:fundraiser_thanks"]);
  });
});
