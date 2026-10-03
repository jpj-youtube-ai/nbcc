import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { TOUCH_KINDS } from "../../src/fundraising/touch-rules";
import { PROMPT_KEYS } from "../../src/fundraising/call-prompts";

// TASK-515: keeping in touch. One new table (which automatic email each fundraiser has had, once
// each), the Automatic emails switch (off, by default), and the calls about a smart call prompt,
// recorded in TASK-503's fundraiser_calls with which = 'prompt'. Additive only: a new table, new
// columns with defaults or nullable, and a check that allows more. Against a fake pgm.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000170_fundraising-keep-in-touch.js";
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
      dropConstraint: record("dropConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

type Col = { type: string; notNull?: boolean; default?: unknown; references?: string; onDelete?: string; check?: string };

describe("the keep in touch migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const table = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraiser_touchpoints");
  const cols = (table?.args[1] ?? {}) as Record<string, Col>;
  const opts = (table?.args[2] ?? {}) as { constraints?: { unique?: unknown } };
  const added = (t: string) => (calls.find((c) => c.op === "addColumns" && c.args[0] === t)?.args[1] ?? {}) as Record<string, Col>;

  it("sorts last, above every migration on main and the open categories change's 160", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(NAME);
    expect(NAME > "1791200000160").toBe(true);
  });

  it("records each automatic email once per fundraiser, cleared with the fundraiser", () => {
    expect(Object.keys(cols).sort()).toEqual(["fundraiser_id", "id", "kind", "sent_at", "sent_by"]);
    expect(cols.fundraiser_id).toMatchObject({ notNull: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(cols.sent_at.notNull).toBe(true);
    expect(JSON.stringify(opts.constraints?.unique)).toContain("fundraiser_id");
    expect(JSON.stringify(opts.constraints?.unique)).toContain("kind");
    for (const k of TOUCH_KINDS) expect(cols.kind.check).toContain(`'${k}'`);
  });

  it("keeps a Do it again link only as a hash, with when it runs out and when it was used", () => {
    const t = calls.find((c) => c.op === "createTable" && c.args[0] === "fundraiser_again_tokens");
    const c = (t?.args[1] ?? {}) as Record<string, Col & { unique?: boolean }>;
    expect(Object.keys(c).sort()).toEqual(["created_at", "expires_at", "fundraiser_id", "id", "token_hash", "used_at", "used_by_fundraiser_id"]);
    expect(c.token_hash).toMatchObject({ notNull: true, unique: true });
    expect(c.expires_at.notNull).toBe(true);
    expect(c.fundraiser_id).toMatchObject({ references: "fundraisers", onDelete: "CASCADE" });
    expect(c.used_by_fundraiser_id).toMatchObject({ references: "fundraisers", onDelete: "SET NULL" });
  });

  it("adds the Automatic emails switch, off by default", () => {
    const s = added("fundraising_settings");
    expect(s.touch_emails_on).toMatchObject({ type: "boolean", notNull: true, default: false });
    expect(s.touch_emails_updated_at.notNull).toBeFalsy();
    expect(s.touch_emails_updated_by.notNull).toBeFalsy();
  });

  it("lets a call be about a prompt, naming which, and only then", () => {
    const c = added("fundraiser_calls");
    expect(c.prompt).toMatchObject({ type: "text" });
    expect(c.prompt.notNull).toBeFalsy();
    const which = calls.find((x) => x.op === "addConstraint" && x.args[1] === "fundraiser_calls_which_check");
    expect(JSON.stringify(which?.args[2])).toContain("'before', 'after', 'prompt'");
    const prompt = calls.find((x) => x.op === "addConstraint" && x.args[1] === "fundraiser_calls_prompt_check");
    for (const k of PROMPT_KEYS) expect(JSON.stringify(prompt?.args[2])).toContain(`'${k}'`);
    expect(JSON.stringify(prompt?.args[2])).toContain("(which = 'prompt') = (prompt IS NOT NULL)");
  });

  it("is additive: nothing dropped on the way up but the old, narrower check", () => {
    expect(calls.filter((c) => c.op === "dropTable" || c.op === "dropColumns")).toEqual([]);
    const dropped = calls.filter((c) => c.op === "dropConstraint").map((c) => c.args[1]);
    expect(dropped).toEqual(["fundraiser_calls_which_check"]);
  });

  it("undoes itself", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.some((c) => c.op === "dropTable" && c.args[0] === "fundraiser_touchpoints")).toBe(true);
    expect(down.calls.some((c) => c.op === "dropTable" && c.args[0] === "fundraiser_again_tokens")).toBe(true);
    expect(down.calls.some((c) => c.op === "dropColumns" && c.args[0] === "fundraising_settings")).toBe(true);
    expect(down.calls.some((c) => c.op === "dropColumns" && c.args[0] === "fundraiser_calls")).toBe(true);
  });
});
