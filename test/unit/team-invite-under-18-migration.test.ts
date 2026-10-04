import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// A tick beside each person a team organiser adds: "This person is under 18". The email box is then
// their parent's or guardian's, and the invite speaks to the parent. One column with a default, so
// rows already there are adults and a code rollback is safe (golden rule 2). It must sort after
// 235: node-pg-migrate refuses on production to run one that sorts before a migration already run.
// Never asserted to be the last one.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000240_team-invite-under-18.js";

type Call = { op: string; args: unknown[] };
function run(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm = new Proxy(
    {},
    {
      get(_t, op: string) {
        return (...args: unknown[]) => calls.push({ op, args });
      },
    },
  );
  const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as Record<"up" | "down", (p: unknown) => void>;
  migration[fn](pgm);
  return calls;
}

describe("the team invite under 18 migration", () => {
  it("sorts after 235", () => {
    expect(readdirSync(resolve(ROOT, "migrations"))).toContain(NAME);
    expect(NAME > "1791200000235").toBe(true);
  });

  it("only adds one column with a default, so everyone already added is an adult", () => {
    const up = run("up");
    expect(up).toHaveLength(1);
    expect(up[0].op).toBe("addColumns");
    expect(up[0].args[0]).toBe("team_invites");
    expect(up[0].args[1]).toEqual({ under_18: { type: "boolean", notNull: true, default: false } });
  });

  it("goes back down", () => {
    const down = run("down");
    expect(down).toHaveLength(1);
    expect(down[0]).toMatchObject({ op: "dropColumns", args: ["team_invites", ["under_18"]] });
  });
});
