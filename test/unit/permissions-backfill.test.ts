import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS, roleToPermissions, type Section } from "../../src/admin/permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = resolve(ROOT, "migrations");
const BACKFILL = "1790788129056_permissions-backfill-missed-sections.js";

// A saved permissions matrix is a complete statement of access: a section it does not name is denied
// (effectivePermissions). So a section added after somebody's access was saved is None for them,
// admins included, until a migration writes it into the matrices already saved. TASK-406 made that
// the rule; ball, email-audit, site and outreach arrived just before it and were missed until TASK-463.

// The sections that existed when saved matrices arrived (TASK-186, 1783729848662_user-permissions.js).
// Every saved matrix names these, so only the sections added since need a backfill.
const SECTIONS_WHEN_MATRICES_ARRIVED = [
  "overview", "search", "donations", "claims", "gasds", "subscriptions", "stories", "ticker",
  "contact", "newsletter", "thank-you", "audit", "team",
];

describe("saved access is brought up to date for every section added since it existed", () => {
  const sources = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(resolve(MIGRATIONS, file), "utf8"));

  // Every backfill adds a section only where a saved matrix lacks it, so each carries this clause.
  it.each(SECTIONS.filter((s) => !SECTIONS_WHEN_MATRICES_ARRIVED.includes(s)))(
    "a migration backfills %s",
    (section) => {
      const backfilled = sources.some((src) => src.includes(`NOT (permissions ? '${section}')`));
      expect(backfilled, `no migration adds "${section}" to the access already saved`).toBe(true);
    },
  );
});

describe("the TASK-463 backfill gives each role what roleToPermissions gives it", () => {
  it.each(["ball", "email-audit", "site", "outreach"] as Section[])("%s", (section) => {
    const src = readFileSync(resolve(MIGRATIONS, BACKFILL), "utf8");
    const found = src.match(
      new RegExp(
        `jsonb_build_object\\(\\s*'${section}',\\s*` +
          `CASE role WHEN 'admin' THEN '(\\w+)' WHEN 'editor' THEN '(\\w+)' ELSE '(\\w+)' END`,
      ),
    );
    expect(found, `${BACKFILL} backfills ${section} for each role`).not.toBeNull();
    const [, admin, editor, anyoneElse] = found as RegExpMatchArray;
    // Anyone else is a viewer, or a role roleToPermissions does not know, which it treats as a viewer.
    expect({ admin, editor, anyoneElse }).toEqual({
      admin: roleToPermissions("admin")[section] ?? "none",
      editor: roleToPermissions("editor")[section] ?? "none",
      anyoneElse: roleToPermissions("viewer")[section] ?? "none",
    });
  });
});
