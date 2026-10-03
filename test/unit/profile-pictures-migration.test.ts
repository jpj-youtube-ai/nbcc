import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Profile pictures (Jaimie, 2026-10-03): the organiser sends their page's main photo and a small
// round photo of themselves from their private area; each waits for staff. One new table, so a code
// rollback is safe (golden rule 2). It must sort after the impact markers migration (200), which is
// on its way to main: node-pg-migrate refuses on production to run one that sorts before a
// migration already run.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000205_profile-pictures.js";

type Call = { op: string; args: unknown[] };
function run(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm = new Proxy(
    { func: (s: string) => ({ fn: s }) },
    {
      get(target, op: string) {
        if (op in target) return (target as Record<string, unknown>)[op];
        return (...args: unknown[]) => calls.push({ op, args });
      },
    },
  );
  const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as Record<"up" | "down", (p: unknown) => void>;
  migration[fn](pgm);
  return calls;
}

describe("the profile pictures migration", () => {
  it("adds one table, fundraiser_pictures, cleared with its fundraiser", () => {
    const create = run("up").filter((c) => c.op === "createTable");
    expect(create).toHaveLength(1);
    const [name, cols] = create[0].args as [string, Record<string, Record<string, unknown>>];
    expect(name).toBe("fundraiser_pictures");
    expect(cols.fundraiser_id).toMatchObject({ notNull: true, references: "fundraisers", onDelete: "CASCADE" });
    expect(String(cols.kind.check)).toContain("'main'");
    expect(String(cols.kind.check)).toContain("'profile'");
    for (const s of ["pending", "approved", "declined", "replaced", "removed"]) expect(String(cols.status.check)).toContain(`'${s}'`);
    expect(cols.status.default).toBe("pending");
    expect(cols.photo_id).toMatchObject({ type: "uuid", notNull: true, unique: true });
    // Review: the bytes go once a picture is not used, replaced or taken off (the row stays, for
    // the audit), so they may be empty; a waiting one or one in use always has them.
    expect(cols.bytes).toMatchObject({ type: "bytea" });
    expect(cols.bytes.notNull).toBeUndefined();
    // Review: an approved main photo's copy in event_images, so taking it off can delete that copy.
    expect(cols.event_image_id).toMatchObject({ type: "uuid", references: "event_images", onDelete: "SET NULL" });
    expect(String(cols.mime.check)).toContain("image/jpeg");
    expect(String(cols.mime.check)).not.toContain("svg");
  });

  it("keeps the bytes of one waiting or in use", () => {
    const create = run("up").find((c) => c.op === "createTable")!;
    const checks = (create.args[2] as { constraints: { check: string[] } }).constraints.check;
    expect(checks).toContain("status NOT IN ('pending', 'approved') OR bytes IS NOT NULL");
  });

  it("holds at most one waiting and one in use of each kind per fundraiser", () => {
    const indexes = run("up").filter((c) => c.op === "createIndex");
    const unique = indexes.filter((c) => (c.args[2] as { unique?: boolean } | undefined)?.unique);
    const wheres = unique.map((c) => String((c.args[2] as { where: string }).where));
    expect(wheres).toEqual(expect.arrayContaining(["status = 'pending'", "status = 'approved'"]));
    for (const c of unique) expect(c.args[1]).toEqual(["fundraiser_id", "kind"]);
  });

  it("only drops its own table on the way down", () => {
    expect(run("down")).toEqual([{ op: "dropTable", args: ["fundraiser_pictures"] }]);
  });

  it("sorts after the impact markers migration (1791200000200)", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js"));
    expect(names).toContain(NAME);
    expect(NAME > "1791200000200").toBe(true);
    expect([...names].sort().indexOf(NAME)).toBeGreaterThan([...names].sort().indexOf("1791200000190_teams.js"));
  });
});
