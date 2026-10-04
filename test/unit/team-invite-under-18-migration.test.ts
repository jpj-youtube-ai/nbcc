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

const migration = () => createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as { BACKFILL_SQL: string };

describe("the team invite under 18 migration", () => {
  it("sorts after 235", () => {
    expect(readdirSync(resolve(ROOT, "migrations"))).toContain(NAME);
    expect(NAME > "1791200000235").toBe(true);
  });

  it("adds one column with a default, so everyone already added is an adult", () => {
    const up = run("up");
    expect(up.filter((c) => c.op !== "sql")).toHaveLength(1);
    expect(up[0].op).toBe("addColumns");
    expect(up[0].args[0]).toBe("team_invites");
    expect(up[0].args[1]).toEqual({ under_18: { type: "boolean", notNull: true, default: false } });
  });

  // Welcome packs (review): a request the pack changed is now marked "pack:" before the staff member
  // in fundraiser_requests.updated_by. Requests the pack changed BEFORE this ran have no mark, and
  // would be treated as changed by hand for ever, so they are marked here, once.
  describe("marking the requests a welcome pack changed before this", () => {
    const sql = () => String(run("up").find((c) => c.op === "sql")?.args[0] ?? "");

    it("is one statement that only puts the mark before who changed it, and never moves its time", () => {
      expect(run("up").filter((c) => c.op === "sql")).toHaveLength(1);
      expect(sql()).toMatch(/UPDATE fundraiser_requests r\s+SET updated_by = 'pack:' \|\| r\.updated_by/);
      expect(sql()).not.toMatch(/updated_at\s*=\s*now\(\)/);
      expect(sql()).not.toMatch(/SET[^;]*updated_at\s*=/);
      expect(sql()).toBe(migration().BACKFILL_SQL);
    });

    it("matches a request whose last change was made in the same transaction as a change to the pack", () => {
      // A pack's press writes its History line and changes the request in one transaction, so both
      // carry the same time; a change by hand in Requests writes no pack line.
      expect(sql()).toContain("a.action = 'fundraiser.pack_updated'");
      expect(sql()).toContain("a.entity = 'fundraiser'");
      expect(sql()).toContain("a.entity_id = r.fundraiser_id");
      expect(sql()).toContain("a.created_at = r.updated_at");
    });

    it("can run again and changes nothing, and never touches a row with nobody on it", () => {
      expect(sql()).toContain("r.updated_by NOT LIKE 'pack:%'");
      expect(sql()).toContain("r.updated_by IS NOT NULL");
    });
  });

  it("goes back down: the column goes, and the mark comes off again", () => {
    const down = run("down");
    expect(down.find((c) => c.op === "dropColumns")).toMatchObject({ args: ["team_invites", ["under_18"]] });
    const strip = String(down.find((c) => c.op === "sql")?.args[0] ?? "");
    expect(strip).toMatch(/UPDATE fundraiser_requests SET updated_by = substr\(updated_by, 6\) WHERE updated_by LIKE 'pack:%'/);
    expect(down).toHaveLength(2);
  });
});
