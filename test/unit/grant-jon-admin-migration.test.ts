import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-164 (REQ-062): the migration that adds jon@nbcc.scot to the admin roster. Like the
// kenny/isabella grant, it is a data-only seed — INSERT one staff row with role='admin' (idempotent
// via ON CONFLICT DO UPDATE) — so it is additive/expand-contract safe (golden rule 2): no schema
// change, nothing dropped/renamed/made NOT NULL. This encodes that so the migration cannot silently
// drift into a destructive one; the live "the user is admin after npm run migrate" check is exercised
// by CI's migrations job. It sets NO password_hash (golden rule 4: secrets never in code).

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783591722822_grant-jon-admin.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));

describe("grant-jon-admin migration", () => {
  it("seeds jon@nbcc.scot with role='admin' in the up", () => {
    expect(up).toMatch(/insert\s+into\s+users/i);
    expect(up).toContain("jon@nbcc.scot");
    expect(up).toMatch(/role\s*=\s*'admin'/i); // the ON CONFLICT upgrade
    expect(up).toMatch(/'admin'/); // the inserted role value
  });

  it("never sets a password in the migration SQL (secrets stay out of the repo)", () => {
    // Guard the executable up/down, not the header comment (which explains why no hash is set).
    const down = src.slice(src.indexOf("exports.down"));
    expect(up).not.toMatch(/password_hash|password\s*=/i);
    expect(down).not.toMatch(/password_hash|password\s*=/i);
  });

  it("is additive-only — no schema change, nothing destructive", () => {
    expect(up).not.toMatch(/addColumn|dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column|not\s+null/i);
  });
});
