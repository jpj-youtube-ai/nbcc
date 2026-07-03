import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-107 (REQ-062): the migration that grants Kenny and Isabella the Admin role. It is a data-only
// seed — INSERT the two staff rows with role='admin' (idempotent via ON CONFLICT DO UPDATE) — so it
// is additive/expand-contract safe (golden rule 2): no schema change, nothing dropped/renamed/made
// NOT NULL. This encodes that so the migration cannot silently drift into a destructive one; the
// live "both users are admin after npm run migrate" check is exercised by CI's migrations job.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783080586661_grant-kenny-isabella-admin.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("grant-kenny-isabella-admin migration", () => {
  it("seeds both admins with role='admin' in the up", () => {
    expect(up).toMatch(/insert\s+into\s+users/i);
    expect(up).toContain("kenny@nightbeforechristmas.co.uk");
    expect(up).toContain("isabella@nightbeforechristmas.co.uk");
    expect(up).toMatch(/role\s*=\s*'admin'/i); // the ON CONFLICT upgrade
    expect(up).toMatch(/'admin'/); // the inserted role value
  });

  it("is additive-only — no schema change, nothing destructive", () => {
    expect(up).not.toMatch(/addColumn|dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column|not\s+null/i);
  });
});
