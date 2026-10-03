import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Profile pictures, review: the daily 8am job (src/scripts/send-reminders.ts) lets go of the bytes of
// any picture not in use after 30 days (purgePictureBytes, tested in fundraiser-pictures-db.test.ts),
// in its own try/catch like every other pass there. The script only runs when started directly, so
// its wiring is read from the source.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(ROOT, "src/scripts/send-reminders.ts"), "utf8");

describe("the daily job clears out old pictures", () => {
  it("calls purgePictureBytes inside its own try/catch", () => {
    const at = source.indexOf("purgePictureBytes(");
    expect(at, "send-reminders.ts never calls purgePictureBytes").toBeGreaterThan(-1);
    const before = source.lastIndexOf("try {", at);
    const catchAt = source.indexOf("} catch (err) {", at);
    expect(source.slice(before, catchAt).match(/await import\(/g)).toHaveLength(1);
    expect(source.slice(catchAt, catchAt + 200)).toContain("picture");
  });

  it("runs before the pool is closed", () => {
    expect(source.indexOf("purgePictureBytes(")).toBeLessThan(source.indexOf("await pool.end();"));
  });
});
