import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// TASK-147 (REQ-062): the migration that moves the admin login identities onto the nbcc.scot domain
// (matching the public contact addresses, TASK-146) and adds a third admin. It is a data-only
// UPDATE + INSERT — no schema change — so it is additive/expand-contract safe (golden rule 2). This
// encodes that so the migration cannot silently drift into a destructive one; the live "migrate runs
// clean" check is exercised by CI's migrations job.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = readFileSync(resolve(ROOT, "migrations/1783345566569_update-admin-emails-nbcc-scot.js"), "utf8");
const up = src.slice(src.indexOf("exports.up"), src.indexOf("exports.down"));
const down = src.slice(src.indexOf("exports.down"));

describe("update-admin-emails-nbcc-scot migration", () => {
  it("repoints kenny@ and isabella@ from the old domain to nbcc.scot", () => {
    expect(up).toMatch(/update\s+users\s+set\s+email\s*=\s*'kenny@nbcc\.scot'\s+where\s+email\s*=\s*'kenny@nightbeforechristmas\.co\.uk'/i);
    expect(up).toMatch(/update\s+users\s+set\s+email\s*=\s*'isabella@nbcc\.scot'\s+where\s+email\s*=\s*'isabella@nightbeforechristmas\.co\.uk'/i);
  });

  it("adds paul.popa1995@yahoo.ro as an admin, idempotently", () => {
    expect(up).toMatch(/insert\s+into\s+users/i);
    expect(up).toContain("paul.popa1995@yahoo.ro");
    expect(up).toMatch(/on\s+conflict\s*\(email\)\s*do\s+update\s+set\s+role\s*=\s*'admin'/i);
  });

  it("is additive-only — no schema change, nothing destructive", () => {
    expect(up).not.toMatch(/addColumn|dropColumn|dropTable|renameColumn|alterColumn|createTable/i);
    expect(up).not.toMatch(/drop\s+table|drop\s+column|alter\s+column|not\s+null/i);
  });

  it("has a down() that restores the old addresses and removes the added admin", () => {
    expect(down).toMatch(/delete\s+from\s+users\s+where\s+email\s*=\s*'paul\.popa1995@yahoo\.ro'/i);
    expect(down).toContain("kenny@nightbeforechristmas.co.uk");
    expect(down).toContain("isabella@nightbeforechristmas.co.uk");
  });
});
