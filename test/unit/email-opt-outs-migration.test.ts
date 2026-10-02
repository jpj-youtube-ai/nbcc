import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// TASK-507: the address level opt out list, and the backfill for people who may have pressed "Stop
// all emails" before it existed (the preference centre kept no record of that). Additive: one new
// table, a backfill into it, and the thank you gifts' skip reasons widened to the three new ones.
// Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000120_email-opt-outs.js";
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
      dropConstraint: record("dropConstraint"),
      addConstraint: record("addConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; check?: string };

describe("the opt out list migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "email_opt_outs");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;
  const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");

  it("sorts above the thank yous (110)", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000110_fundraiser-thanks.js"));
  });

  it("keeps an address, what kind of opt out, where it came from, when, and a tombstone to lift it", () => {
    expect(Object.keys(cols).sort()).toEqual(["created_at", "email", "id", "kind", "removed_at", "removed_by", "source"].sort());
    expect(cols.email.check).toContain("email = lower(email)");
    expect(cols.kind.check).toContain("'all', 'thank_you'");
    expect(cols.source.check).toContain("'preferences', 'backfill'");
  });

  it("holds one live opt out per address", () => {
    const idx = calls.find((c) => c.op === "createIndex" && c.args[0] === "email_opt_outs");
    expect(idx?.args[2]).toMatchObject({ unique: true, where: "removed_at IS NULL" });
  });

  it("backfills every donor address whose thank you consent is off and that could have reached Stop all emails", () => {
    expect(sql).toMatch(/INSERT INTO email_opt_outs \(email, kind, source\)/);
    expect(sql).toMatch(/dn\.thankyou_consent = false/);
    // Thank yous off while the newsletter is on: only the preference centre does that.
    expect(sql).toMatch(/d2\.email_consent = true/);
    // Sent a newsletter, a welcome, or on a list: they held a link to the preference centre.
    expect(sql).toMatch(/FROM newsletter_sends/);
    expect(sql).toMatch(/FROM newsletter_email_events/);
    expect(sql).toMatch(/FROM list_subscribers/);
    // A newsletter that went out before each recipient was recorded: everyone on file then.
    expect(sql).toMatch(/FROM newsletters n/);
    expect(sql).toMatch(/'backfill'/);
  });

  it("widens the thank you gifts' skip reasons, keeping the old ones", () => {
    const add = calls.find((c) => c.op === "addConstraint");
    expect(add?.args[0]).toBe("fundraiser_thank_gifts");
    const check = JSON.stringify(add?.args[2]);
    for (const r of ["no_email", "suppressed", "opted_out", "duplicate", "refunded", "paid_in", "not_running"]) expect(check).toContain(r);
  });

  it("drops its table on the way down (the wider skip reasons stay, as rows may already use them)", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.some((c) => c.op === "dropTable" && c.args[0] === "email_opt_outs")).toBe(true);
  });
});
