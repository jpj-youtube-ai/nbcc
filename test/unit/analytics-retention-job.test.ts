import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-479: the daily 8am job (src/scripts/send-reminders.ts) prunes the analytics tables, in its
// own try/catch like every other pass there, so a failure cannot stop anything else it does. The
// pruning itself (13 months for views and clicks, every salt older than today) is tested in
// analytics-db.test.ts; this checks the job actually calls it. The script only runs when started
// directly, so its wiring is read from the source.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(ROOT, "src/scripts/send-reminders.ts"), "utf8");

describe("the daily job prunes analytics", () => {
  it("calls pruneAnalytics inside its own try/catch", () => {
    const at = source.indexOf("pruneAnalytics(");
    expect(at, "send-reminders.ts never calls pruneAnalytics").toBeGreaterThan(-1);
    const before = source.lastIndexOf("try {", at);
    const catchAt = source.indexOf("} catch (err) {", at);
    expect(before).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(at);
    // No other pass sits between this try and its catch.
    expect(source.slice(before, catchAt).match(/await import\(/g)).toHaveLength(1);
    expect(source.slice(catchAt, catchAt + 200)).toContain("analytics");
  });

  it("runs before the pool is closed", () => {
    expect(source.indexOf("pruneAnalytics(")).toBeLessThan(source.indexOf("await pool.end();"));
  });
});
