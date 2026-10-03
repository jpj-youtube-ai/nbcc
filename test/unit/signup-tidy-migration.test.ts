import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { TSHIRT_SIZES, EMPLOYER_MATCH } from "../../src/fundraising/signup-tidy";
import { MEMORY_CATEGORIES } from "../../src/fundraising/categories";
import { SETUP_BY } from "../../src/fundraising/in-memory";

// The sign up tidy (Jaimie, 2026-10-03): a "sporty" mark on each fundraising category (Run, Walk and
// Santa dash start sporting), and on each sign up whether it is a sporting event, the T-shirt size,
// and the private link staff may send to ask for the size. Additive only, so a code rollback is
// safe, and numbered after the profile pictures migration (205): node-pg-migrate refuses on
// production to run one that sorts before one already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000210_signup-tidy.js";

type Call = { op: string; args: unknown[] };
function fakePgm() {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      addColumns: rec("addColumns"),
      dropColumns: rec("dropColumns"),
      addConstraint: rec("addConstraint"),
      dropConstraint: rec("dropConstraint"),
      createIndex: rec("createIndex"),
      dropIndex: rec("dropIndex"),
      sql: rec("sql"),
    },
  };
}

const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as {
  up: (pgm: unknown) => void;
  down: (pgm: unknown) => void;
};

type Cols = Record<string, { type: string; notNull?: boolean; default?: unknown }>;
const added = (calls: Call[], table: string) => calls.find((c) => c.op === "addColumns" && c.args[0] === table)?.args[1] as Cols | undefined;

describe("the sign up tidy migration", () => {
  it("sorts after the profile pictures migration", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js"));
    expect(names).toContain(NAME);
    expect(NAME > "1791200000205").toBe(true);
  });

  it("adds a sporty mark and an in memory mark to the categories, false unless set", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    expect(added(calls, "fundraising_categories")).toEqual({
      sporty: { type: "boolean", notNull: true, default: false },
      memory_only: { type: "boolean", notNull: true, default: false },
    });
  });

  it("adds the in memory ways of giving, as the code has them, never changing one already there", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    for (const c of MEMORY_CATEGORIES) expect(sql).toContain(`('${c.key}', '${c.label}', true, false, true, 'migration')`);
    expect(sql).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
  });

  it("widens who may set up an in memory page, and the requests, keeping everything allowed before", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    const setup = calls.find((c) => c.op === "addConstraint" && c.args[1] === "fundraisers_memory_setup_by_known");
    for (const s of SETUP_BY) expect(String((setup?.args[2] as { check: string }).check)).toContain(`'${s}'`);
    const booking = calls.find((c) => c.op === "addConstraint" && c.args[1] === "fundraisers_booking_check");
    for (const b of ["away", "door", "free", "donations"]) expect(String((booking?.args[2] as { check: string }).check)).toContain(`'${b}'`);
    expect(sql).toMatch(/fundraiser_requests_kind_check CHECK \(kind IN \([^)]*'qr_codes', 'envelopes'\)\)/);
  });

  it("marks Run, Walk and Santa dash sporting, by key or name whatever the case, if they are there", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const sql = calls.filter((c) => c.op === "sql").map((c) => String(c.args[0])).join("\n");
    expect(sql).toMatch(/UPDATE fundraising_categories\s+SET sporty = true/);
    expect(sql).toMatch(/lower\(key\) IN \('run', 'walk', 'santa_dash'\)/);
    expect(sql).toMatch(/lower\(label\) IN \('run', 'walk', 'santa dash'\)/);
  });

  it("adds the sign up's answers, every one nullable", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const cols = added(calls, "fundraisers")!;
    expect(Object.keys(cols).sort()).toEqual(["call_time", "child_consent", "child_first_name", "date_tbc", "employer_match", "guardian_first_name", "is_sporting", "memory_director_business", "memory_family_contact_email", "memory_family_contact_name", "org_name", "tshirt_asked_at", "tshirt_asked_by", "tshirt_size", "tshirt_token_hash"]);
    for (const [name, c] of Object.entries(cols)) expect(c.notNull, name).not.toBe(true);
    expect(cols.is_sporting.type).toBe("boolean");
  });

  it("holds the size to the list, and the link's hash to one sign up", () => {
    const { calls, pgm } = fakePgm();
    migration.up(pgm);
    const check = calls.find((c) => c.op === "addConstraint" && c.args[1] === "fundraisers_tshirt_size_known");
    const words = String((check?.args[2] as { check: string }).check);
    for (const s of TSHIRT_SIZES) expect(words).toContain(`'${s.key}'`);
    expect(words).toMatch(/tshirt_size IS NULL OR/);
    const index = calls.find((c) => c.op === "createIndex" && c.args[0] === "fundraisers");
    expect(index?.args[1]).toBe("tshirt_token_hash");
    expect(index?.args[2]).toMatchObject({ unique: true });
    const match = calls.find((c) => c.op === "addConstraint" && c.args[1] === "fundraisers_employer_match_known");
    for (const m of EMPLOYER_MATCH) expect(String((match?.args[2] as { check: string }).check)).toContain(`'${m}'`);
  });

  it("goes back down by dropping only what it added", () => {
    const { calls, pgm } = fakePgm();
    migration.down(pgm);
    const dropped = calls.filter((c) => c.op === "dropColumns");
    expect(dropped.map((c) => [c.args[0], [...(c.args[1] as string[])].sort()])).toEqual([
      ["fundraisers", ["call_time", "child_consent", "child_first_name", "date_tbc", "employer_match", "guardian_first_name", "is_sporting", "memory_director_business", "memory_family_contact_email", "memory_family_contact_name", "org_name", "tshirt_asked_at", "tshirt_asked_by", "tshirt_size", "tshirt_token_hash"]],
      ["fundraising_categories", ["memory_only", "sporty"]],
    ]);
  });
});
