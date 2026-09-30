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

// Sections added since that are deliberately left unbackfilled. The email audit was asked for so that
// exactly two named admins hold it and grant it to anyone else (see its entry in SECTIONS); a backfill
// would hand it to every admin account whose access predates it. A missing key stays None, which fails
// closed, and editors and viewers get None for it anyway.
const DELIBERATELY_NOT_BACKFILLED = ["email-audit"];

// Comments removed, so text in a comment can neither satisfy a check nor hide what the SQL does.
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("saved access is brought up to date for every section added since it existed", () => {
  const sources = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".js"))
    .map((file) => withoutComments(readFileSync(resolve(MIGRATIONS, file), "utf8")));

  // Every backfill adds a section only where a saved matrix lacks it, so each carries this clause.
  it.each(
    SECTIONS.filter((s) => !SECTIONS_WHEN_MATRICES_ARRIVED.includes(s) && !DELIBERATELY_NOT_BACKFILLED.includes(s)),
  )("a migration backfills %s", (section) => {
    const backfilled = sources.some((src) => src.includes(`NOT (permissions ? '${section}')`));
    expect(backfilled, `no migration adds "${section}" to the access already saved`).toBe(true);
  });
});

describe("the TASK-463 backfill", () => {
  const source = () => withoutComments(readFileSync(resolve(MIGRATIONS, BACKFILL), "utf8"));

  it.each(["ball", "site", "outreach"] as Section[])("gives each role what roleToPermissions gives it: %s", (section) => {
    const found = [
      ...source().matchAll(
        new RegExp(
          `jsonb_build_object\\(\\s*'${section}',\\s*` +
            `CASE role WHEN 'admin' THEN '(\\w+)' WHEN 'editor' THEN '(\\w+)' ELSE '(\\w+)' END`,
          "g",
        ),
      ),
    ];
    expect(found, `${BACKFILL} sets ${section} exactly once, with a level for each role`).toHaveLength(1);
    const [, admin, editor, anyoneElse] = found[0];
    // Anyone else is a viewer, or a role roleToPermissions does not know, which it treats as a viewer.
    expect({ admin, editor, anyoneElse }).toEqual({
      admin: roleToPermissions("admin")[section] ?? "none",
      editor: roleToPermissions("editor")[section] ?? "none",
      anyoneElse: roleToPermissions("viewer")[section] ?? "none",
    });
  });

  it("leaves the email audit alone", () => {
    expect(source()).not.toContain("'email-audit'");
  });
});
