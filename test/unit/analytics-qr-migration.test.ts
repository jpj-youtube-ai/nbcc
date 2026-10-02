import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// TASK-492: the migration that lets Analytics count a QR code scan. It only WIDENS the channel
// check (golden rule 2): every channel allowed before is still allowed. The SQL runs against
// Postgres in features/admin-qr.feature; this checks its shape.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const FILE = "1791200000000_analytics-qr-channel.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require(resolve(ROOT, "migrations", FILE));

function sqlOf(fn: "up" | "down"): string {
  const sql: string[] = [];
  migration[fn]({ sql: (s: string) => sql.push(s) });
  return sql.join("\n");
}
const allowed = (sql: string): string[] => {
  const list = sql.match(/ADD CONSTRAINT analytics_views_channel_check CHECK \(channel IN \(([^)]*)\)\)/);
  return list ? list[1].split(",").map((s) => s.trim().replace(/'/g, "")) : [];
};
const BEFORE = ["newsletter", "email", "search", "social", "other_websites", "direct"];

describe("the QR code channel migration", () => {
  it("sorts last, so production never sees it run out of order", () => {
    const all = readdirSync(resolve(ROOT, "migrations")).filter((f) => f.endsWith(".js")).sort();
    expect(all[all.length - 1]).toBe(FILE);
  });

  it("only widens the channel check: everything allowed before, and qr", () => {
    const up = sqlOf("up");
    expect(allowed(up).sort()).toEqual([...BEFORE, "qr"].sort());
    expect(up).not.toMatch(/DROP (TABLE|COLUMN)|DELETE|UPDATE/i);
  });

  it("drops the old check whatever Postgres named it", () => {
    expect(sqlOf("up")).toMatch(/pg_get_constraintdef\(oid\) LIKE '%channel%'/);
  });

  it("goes back to the old list without failing on scans already counted", () => {
    const down = sqlOf("down");
    expect(allowed(down).sort()).toEqual([...BEFORE].sort());
    expect(down).toMatch(/NOT VALID/);
  });
});
