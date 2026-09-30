import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SECTIONS, roleToPermissions, type PermissionMap } from "../../src/admin/permissions";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// TASK-313: the admin section list exists in THREE places — the server enum
// (src/admin/permissions.ts), the browser bundle (assets/js/admin/app.js) and the BDD steps.
// They are not cosmetic duplicates: PATCH /api/admin/users/:id/permissions validates a
// COMPLETE, .strict() matrix built from the server's list, so a section present on the server
// but missing in the browser copy makes EVERY permissions save fail with a 400 in production.
//
// That is exactly what happened when the "ball" section was added, and only a BDD scenario
// caught it by accident. This test makes the drift fail fast and name itself.

function parseJsArrayLiteral(source: string, name: string, where: string): string[] {
  // The two files declare it differently (var in the browser bundle, const in the steps), so
  // try each keyword. Plain string matching rather than a regex: this only has to find one
  // known declaration, and it keeps the guard readable.
  const start = ["var ", "const ", "let "]
    .map((keyword) => source.indexOf(keyword + name + " = ["))
    .find((index) => index !== -1);
  if (start === undefined) throw new Error(`could not find ${name} in ${where}`);
  const open = source.indexOf("[", start);
  const close = source.indexOf("]", open);
  return source
    .slice(open + 1, close)
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

// One named function's source, found by counting braces from its opening one. Enough for the small
// function it is used on, which has no brace inside a string or a comment.
function parseJsFunction(source: string, name: string, where: string): string {
  const start = source.indexOf("function " + name + "(");
  if (start === -1) throw new Error(`could not find ${name} in ${where}`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not find the end of ${name} in ${where}`);
}

// The browser's own rolePresetPermissions, run over the browser's own lists, so the check below
// compares the server with what the Team screen will actually do, not with a restatement of it.
function browserRolePresets(appJs: string): (role: string) => PermissionMap {
  const where = "assets/js/admin/app.js";
  const source = parseJsFunction(appJs, "rolePresetPermissions", where);
  let build: (sections: string[], operational: string[]) => (role: string) => PermissionMap;
  try {
    build = new Function("SECTIONS", "OPERATIONAL_EDITOR_SECTIONS", "return " + source) as typeof build;
  } catch (err) {
    // Most likely a brace inside a string or a comment, which parseJsFunction's count cannot see.
    throw new Error(`could not rebuild rolePresetPermissions from ${where}: ${(err as Error).message}`);
  }
  return build(
    parseJsArrayLiteral(appJs, "SECTIONS", where),
    parseJsArrayLiteral(appJs, "OPERATIONAL_EDITOR_SECTIONS", where),
  );
}

describe("admin section list stays in sync", () => {
  it("the browser bundle lists exactly the server's sections, in the same order", () => {
    const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
    expect(parseJsArrayLiteral(appJs, "SECTIONS", "assets/js/admin/app.js")).toEqual([...SECTIONS]);
  });

  // TASK-459: the browser mirrors each role's DEFAULT access as well, and drift there raises no error
  // at all. Team → Manage access pre-fills anyone never given access of their own from the browser's
  // copy, and Save stores what it shows as their complete access. The server has given editors
  // Contact businesses since TASK-354; the browser's copy never listed it, so the screen showed None
  // and every save took the screen away from them.
  it.each([
    ["an admin", "admin"],
    ["an editor", "editor"],
    ["a viewer", "viewer"],
  ])("the browser gives %s the same default access as the server", (_who, role) => {
    const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
    expect(browserRolePresets(appJs)(role)).toEqual(roleToPermissions(role));
  });

  it("the BDD steps list exactly the server's sections", () => {
    const steps = readFileSync(
      resolve(ROOT, "features/steps/admin-permissions.steps.js"),
      "utf8",
    );
    const listed = parseJsArrayLiteral(steps, "SECTIONS", "the BDD steps");
    expect([...listed].sort()).toEqual([...SECTIONS].sort());
  });

  // A menu link is shown only to people who hold the permission it is gated on, so a link gated on
  // one that does not exist is shown to nobody at all. That is how Monthly givers went unseen,
  // admins included, from the day it shipped (TASK-447): it gated on "monthly", which no permission
  // map has ever held. Gate is data-edit-gate, else data-view-gate, else the link's own data-view,
  // the same order app.js's applyNavFiltering reads them in.
  it("gates every menu link on a section the server knows", () => {
    const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
    // Any element with the class anywhere in its list, and every one of them: a link this missed
    // would skip the check while applyNavFiltering still gated it, so the count must match too.
    const links = [...html.matchAll(/<[a-z]+\b[^>]*\bclass="[^"]*\badmin-nav-link\b[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(links.length).toBeGreaterThan(0);
    expect(links.length, "every admin-nav-link in admin.html was checked").toBe((html.match(/\badmin-nav-link\b/g) || []).length);
    const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
    const gatedOnNothing = links
      .map((tag) => ({ view: attr(tag, "data-view"), gate: attr(tag, "data-edit-gate") ?? attr(tag, "data-view-gate") ?? attr(tag, "data-view") }))
      .filter(({ gate }) => !(SECTIONS as readonly string[]).includes(gate ?? ""))
      .map(({ view, gate }) => `${view} is gated on "${gate}"`);
    expect(gatedOnNothing).toEqual([]);
  });
});
