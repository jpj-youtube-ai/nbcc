import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-493: the community fundraising tables. Additive only (golden rule 2): five new tables and
// four new columns on donations, each nullable or with a default, so a code rollback is safe.
// Run against a fake pgm so the shape is checked without a database.

const ROOT = resolve(__dirname, "../..");
const FILE = resolve(ROOT, "migrations/1791200000000_fundraising.js");

type Call = { op: string; args: unknown[] };

function fakePgm() {
  const calls: Call[] = [];
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  return {
    calls,
    pgm: {
      createTable: record("createTable"),
      addColumns: record("addColumns"),
      addConstraint: record("addConstraint"),
      createIndex: record("createIndex"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
      dropTable: record("dropTable"),
      dropColumns: record("dropColumns"),
      dropColumn: record("dropColumn"),
      dropConstraint: record("dropConstraint"),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require(FILE) as { up: (pgm: unknown) => void; down: (pgm: unknown) => void };

describe("the fundraising migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const tables = Object.fromEntries(
    calls.filter((c) => c.op === "createTable").map((c) => [c.args[0] as string, c.args[1] as Record<string, unknown>]),
  );

  it("adds the five tables in the design", () => {
    expect(Object.keys(tables).sort()).toEqual(
      ["fundraiser_cash", "fundraiser_edits", "fundraiser_manage_tokens", "fundraisers", "fundraising_settings"].sort(),
    );
  });

  it("gives fundraisers every column the design lists", () => {
    expect(Object.keys(tables.fundraisers).sort()).toEqual(
      [
        "id", "slug", "path", "kind", "title", "description", "event_date", "start_time", "venue", "town",
        "target_pence", "public", "status", "organiser_name", "organiser_email", "organiser_phone",
        "social_link", "social_ok", "wants", "post_address", "newsletter_ok", "image_src", "declined_reason",
        "created_at", "approved_at", "approved_by", "updated_at", "updated_by",
      ].sort(),
    );
  });

  it("ships the switch off", () => {
    expect((tables.fundraising_settings.page_on as { default: unknown }).default).toBe(false);
    const seed = calls.find((c) => c.op === "sql" && String(c.args[0]).includes("INSERT INTO fundraising_settings"));
    expect(String(seed?.args[0])).toContain("false");
  });

  it("stores only a hash of each manage link, never the link itself", () => {
    expect(Object.keys(tables.fundraiser_manage_tokens)).toContain("token_hash");
    expect(Object.keys(tables.fundraiser_manage_tokens)).not.toContain("token");
  });

  it("adds the gift columns to donations, each safe for the rows already there", () => {
    const add = calls.find((c) => c.op === "addColumns" && c.args[0] === "donations");
    const cols = add?.args[1] as Record<string, { notNull?: boolean; default?: unknown }>;
    expect(Object.keys(cols).sort()).toEqual(
      ["fundraiser_id", "message_hidden", "show_amount", "show_name", "supporter_message"].sort(),
    );
    for (const [name, col] of Object.entries(cols)) {
      expect(!col.notNull || col.default !== undefined, `${name} is nullable or has a default`).toBe(true);
    }
  });

  it("drops nothing on the way up", () => {
    expect(calls.filter((c) => c.op.startsWith("drop"))).toEqual([]);
  });

  it("holds the enumerated columns to the values the app writes", () => {
    const checks = calls
      .filter((c) => c.op === "addConstraint")
      .map((c) => JSON.stringify(c.args[2]))
      .join("\n");
    expect(checks).toContain("path IN ('raising', 'event')");
    expect(checks).toContain("status IN ('new', 'approved', 'declined', 'finished')");
    expect(checks).toContain("status IN ('waiting', 'approved', 'rejected')");
    expect(checks).toContain("/media/events/");
  });
});
