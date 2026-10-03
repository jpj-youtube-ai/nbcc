import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACCESS } from "../../src/events/model";
import { BOOKINGS } from "../../src/fundraising/model";

// TASK-499: the posting address in separate boxes, and the event questions, as new columns on
// fundraisers. Every one is nullable or has a default, so the rows already there are untouched and
// a code rollback is safe (golden rule 2). Checked against a fake pgm, without a database.

const ROOT = resolve(__dirname, "../..");
const NAME = "1791200000040_fundraiser-sign-up-details.js";
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
      addColumns: record("addColumns"),
      dropColumns: record("dropColumns"),
      addConstraint: record("addConstraint"),
      dropConstraint: record("dropConstraint"),
      sql: record("sql"),
      func: (s: string) => ({ func: s }),
    },
  };
}

const NEW_COLUMNS = [
  "post_line1",
  "post_line2",
  "post_town",
  "post_postcode",
  "card_line",
  "end_time",
  "time_tbc",
  "venue_address",
  "venue_postcode",
  "access",
  "price",
  "booking",
  "ticket_url",
  "age_limit",
  "dress_code",
  "included",
  "credit_name",
];

describe("the sign up details migration", () => {
  const { calls, pgm } = fakePgm();
  migration.up(pgm);
  const adds = calls.filter((c) => c.op === "addColumns");
  const columns = adds[0].args[1] as Record<string, { type: string; notNull?: boolean; default?: unknown }>;

  // Nothing production has already run may sort after it: it comes after TASK-492's QR channel
  // (1791200000030), the highest on main before it. (It was last until TASK-501 added its own.)
  it("sorts after everything production had already run, so production never sees it out of order", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all.indexOf(NAME)).toBeGreaterThan(all.indexOf("1791200000030_analytics-qr-channel.js"));
  });

  it("adds the new columns to fundraisers, each nullable or with a default", () => {
    expect(adds).toHaveLength(1);
    expect(adds[0].args[0]).toBe("fundraisers");
    expect(Object.keys(columns)).toEqual(NEW_COLUMNS);
    for (const [name, col] of Object.entries(columns)) {
      if (col.notNull) expect(col.default, name).not.toBeUndefined();
    }
    expect(columns.time_tbc).toEqual({ type: "boolean", notNull: true, default: false });
    expect(columns.access).toMatchObject({ type: "text[]", notNull: true });
    expect(columns.end_time.type).toBe("time");
  });

  // The sign up tidy (Jaimie, 2026-10-03) adds a fourth way in, "donations", after this migration
  // was run: it is never edited (golden rule 2), so a later migration must widen the check for it.
  const LATER_BOOKINGS = ["donations", "nbcc"];

  it("holds the way in and the access ticks to the same lists as the code", () => {
    const checks = calls.filter((c) => c.op === "addConstraint").map((c) => JSON.stringify(c.args));
    expect(checks.join("\n")).toContain("fundraisers_booking_check");
    for (const b of BOOKINGS.filter((b) => !LATER_BOOKINGS.includes(b))) expect(checks.join("\n")).toContain(`'${b}'`);
    expect(checks.join("\n")).toContain("fundraisers_access_check");
    for (const a of ACCESS) expect(checks.join("\n")).toContain(`'${a}'`);
  });

  it("has its way in check widened by a later migration for every way in the code added since", () => {
    const later = readdirSync(resolve(ROOT, "migrations"))
      .filter((f) => f.endsWith(".js") && f > NAME)
      .map((f) => readFileSync(resolve(ROOT, "migrations", f), "utf8"))
      .filter((src) => src.includes("fundraisers_booking_check"));
    for (const b of LATER_BOOKINGS) expect(later.some((src) => src.includes(`"${b}"`) || src.includes(`'${b}'`)), b).toBe(true);
  });

  it("drops nothing, renames nothing and rewrites no row on the way up", () => {
    expect(calls.map((c) => c.op).filter((op) => !["addColumns", "addConstraint"].includes(op))).toEqual([]);
  });

  it("can be undone", () => {
    const down = fakePgm();
    migration.down(down.pgm);
    expect(down.calls.filter((c) => c.op === "dropColumns")).toEqual([{ op: "dropColumns", args: ["fundraisers", NEW_COLUMNS] }]);
  });
});
