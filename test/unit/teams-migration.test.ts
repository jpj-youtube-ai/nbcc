import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

// Team pages (Jaimie, 2026-10-03): a sponsorship fundraiser can be a team, with member pages linked
// to it, a team wide or organiser only split, the people the team organiser added (held until staff
// approve the team, then invited, reminded once and deleted after 30 days or the event), and a staff
// handover of the team organiser role, confirmed with an emailed code. One additive migration.
//
// It must sort after 185 (event pages, merging first): node-pg-migrate refuses on production to run
// one that sorts before a migration already run. Never asserted to be the last one.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000190_teams.js";

type Call = { op: string; args: unknown[] };
function record(fn: "up" | "down"): Call[] {
  const calls: Call[] = [];
  const pgm = new Proxy(
    { func: (s: string) => ({ fn: s }) },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (...args: unknown[]) => calls.push({ op: prop, args });
      },
    },
  );
  const migration = createRequire(import.meta.url)(resolve(ROOT, "migrations", NAME)) as Record<string, (p: unknown) => void>;
  migration[fn](pgm);
  return calls;
}
const all = (calls: Call[]) => JSON.stringify(calls);

describe("the teams migration", () => {
  it("sorts after the 185 event pages migration", () => {
    const names = readdirSync(resolve(ROOT, "migrations")).filter((n) => n.endsWith(".js")).sort();
    expect(names).toContain(NAME);
    expect(NAME > "1791200000185").toBe(true);
    // 185 (event pages) is on main now: it must be there, and run first.
    const at = names.indexOf("1791200000185_event-pages.js");
    expect(at).toBeGreaterThan(-1);
    expect(names.indexOf(NAME)).toBeGreaterThan(at);
  });

  it("adds the team columns to fundraisers, each nullable or with a default", () => {
    const up = record("up");
    const add = up.find((c) => c.op === "addColumns" && c.args[0] === "fundraisers")!;
    const cols = add.args[1] as Record<string, { type: string; notNull?: boolean; default?: unknown; references?: string }>;
    expect(Object.keys(cols).sort()).toEqual(
      ["is_team", "team_id", "team_left_at", "team_left_by", "team_nudge_1_at", "team_nudge_2_at", "team_share_mode"].sort(),
    );
    expect(cols.is_team).toMatchObject({ type: "boolean", notNull: true, default: false });
    expect(cols.team_id.references).toBe("fundraisers");
    for (const [k, c] of Object.entries(cols)) if (k !== "is_team") expect(c.notNull).toBeFalsy();
  });

  it("holds a team together with checks: a team is raising money, never a member, and a team wide split needs a split", () => {
    const text = all(record("up"));
    expect(text).toContain("fundraisers_team_not_member");
    expect(text).toContain("NOT (is_team AND team_id IS NOT NULL)");
    expect(text).toContain("fundraisers_team_raising");
    expect(text).toContain("(NOT is_team AND (team_id IS NULL OR team_left_at IS NOT NULL)) OR path = 'raising'");
    expect(text).toContain("fundraisers_team_share_mode");
    expect(text).toContain("team_share_mode IN ('team', 'organiser')");
    expect(text).toContain("fundraisers_team_not_self");
  });

  it("creates team_invites, whose names and email are deleted with the token", () => {
    const up = record("up");
    const table = up.find((c) => c.op === "createTable" && c.args[0] === "team_invites")!;
    const cols = table.args[1] as Record<string, unknown>;
    for (const c of ["team_id", "first_name", "last_name", "email", "token_hash", "created_at", "created_by", "sent_at", "reminded_at", "joined_at", "joined_fundraiser_id", "deleted_at"]) {
      expect(cols).toHaveProperty(c);
    }
    const text = all(up);
    expect(text).toContain("team_invites_details_kept");
    expect(text).toContain("team_invites_deleted_cleared");
    expect(text).toContain("first_name IS NULL AND last_name IS NULL AND email IS NULL AND token_hash IS NULL");
    expect(text).toContain("team_invites_reminded_after_sent");
  });

  it("creates team_handovers, the code kept only as a hash, one open at a time for a team", () => {
    const up = record("up");
    const table = up.find((c) => c.op === "createTable" && c.args[0] === "team_handovers")!;
    const cols = table.args[1] as Record<string, unknown>;
    for (const c of ["team_id", "to_first_name", "to_last_name", "to_email", "to_phone", "code_hash", "expires_at", "attempts", "created_by", "confirmed_at", "cancelled_at"]) {
      expect(cols).toHaveProperty(c);
    }
    expect(all(up)).toContain("team_handovers_one_open");
  });

  it("takes everything away again on the way down", () => {
    const down = all(record("down"));
    expect(down).toContain("team_handovers");
    expect(down).toContain("team_invites");
    expect(down).toContain("is_team");
    expect(down).toContain("team_share_mode");
  });
});

describe("the teams migration, after review", () => {
  it("keeps a reminder's own token hash beside the invite's, cleared with the rest", () => {
    const up = record("up");
    const table = up.find((c) => c.op === "createTable" && c.args[0] === "team_invites")!;
    expect((table.args[1] as Record<string, { unique?: boolean }>).reminder_token_hash).toMatchObject({ unique: true });
    expect(all(up)).toContain("first_name IS NULL AND last_name IS NULL AND email IS NULL AND token_hash IS NULL AND reminder_token_hash IS NULL");
  });

  it("lets a handover's name, email, phone and code be cleared, and marks when", () => {
    const up = record("up");
    const table = up.find((c) => c.op === "createTable" && c.args[0] === "team_handovers")!;
    const cols = table.args[1] as Record<string, { notNull?: boolean }>;
    for (const c of ["to_first_name", "to_last_name", "to_email", "to_phone", "code_hash"]) expect(cols[c].notNull, c).toBeFalsy();
    expect(cols).toHaveProperty("cleared_at");
    const text = all(up);
    expect(text).toContain("team_handovers_details_kept");
    expect(text).toContain("cleared_at IS NOT NULL OR (to_first_name IS NOT NULL AND to_last_name IS NOT NULL AND to_email IS NOT NULL AND to_phone IS NOT NULL AND code_hash IS NOT NULL)");
  });
});
