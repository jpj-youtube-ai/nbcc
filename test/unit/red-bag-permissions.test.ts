import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SECTIONS, can, effectivePermissions, roleToPermissions, type PermissionMap, type Section } from "../../src/admin/permissions";
import { permissionsSchema } from "../../src/admin/user-schema";
import { AREAS, FEATURES, reachableAreas } from "../../src/admin/whats-new";

// Fill a Red Bag gets an access section of its own, "red-bag", on Team > Manage access: view to see
// the editor, the differences, the history and the preview; edit to save, publish, throw away or put
// back. Admins have it by role. NOBODY else has it until it is given to them, and adding it must not
// change anything else anyone could already do (TASK-459, TASK-462 and TASK-463 were faults in
// exactly this corner). Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const SECTION = "red-bag" as Section;
const others = SECTIONS.filter((s) => s !== SECTION);

// A complete matrix as it was saved before the section existed: every other section named.
function savedBefore(level: (s: Section) => "none" | "view" | "edit"): PermissionMap {
  const matrix: PermissionMap = {};
  for (const s of others) matrix[s] = level(s);
  return matrix;
}

describe("the section", () => {
  it("is one of the admin's sections", () => {
    expect(SECTIONS).toContain(SECTION);
  });

  it("is an admin's by role, to edit", () => {
    expect(roleToPermissions("admin")[SECTION]).toBe("edit");
    expect(can(roleToPermissions("admin"), SECTION, "edit")).toBe(true);
  });

  it("is nobody else's by role: not an editor's, a viewer's, or a role nobody has heard of", () => {
    for (const role of ["editor", "viewer", "volunteer", ""]) {
      expect(can(roleToPermissions(role), SECTION, "view"), role).toBe(false);
      expect(can(roleToPermissions(role), SECTION, "edit"), role).toBe(false);
    }
    expect(roleToPermissions("viewer")[SECTION]).toBe("none");
  });

  it("can be given to anyone: view lets them look, and only edit lets them change", () => {
    const viewer = effectivePermissions({ role: "viewer", permissions: { ...savedBefore(() => "view"), [SECTION]: "view" } });
    expect(can(viewer, SECTION, "view")).toBe(true);
    expect(can(viewer, SECTION, "edit")).toBe(false);
    const editor = effectivePermissions({ role: "editor", permissions: { ...savedBefore(() => "view"), [SECTION]: "edit" } });
    expect(can(editor, SECTION, "edit")).toBe(true);
  });
});

describe("people whose access was saved before the section existed", () => {
  it.each(["admin", "editor", "viewer"])("a %s with saved access has none of it until the migration or a person says so", (role) => {
    const perms = effectivePermissions({ role, permissions: savedBefore(() => "edit") });
    expect(can(perms, SECTION, "view")).toBe(false);
    expect(can(perms, SECTION, "edit")).toBe(false);
  });

  it("keep every other section exactly as it was saved", () => {
    const saved = savedBefore((s) => (s === "team" ? "none" : s === "donations" ? "edit" : "view"));
    const perms = effectivePermissions({ role: "editor", permissions: saved });
    for (const s of others) expect(perms[s], s).toBe(saved[s]);
  });

  it("people with no saved access keep their role's defaults for every other section", () => {
    // What each role had on the commit this was cut from, for every section but the new one.
    const editor = roleToPermissions("editor");
    expect(editor.donations).toBe("edit");
    expect(editor.fundraising).toBe("edit");
    expect(editor.ball).toBe("view");
    expect(editor.team).toBe("none");
    expect(editor.analytics ?? "none").toBe("none");
    const viewer = roleToPermissions("viewer");
    for (const s of others) {
      const none = s === "team" || s === "email-audit" || s === "business-supporters" || s === "analytics";
      expect(viewer[s], s).toBe(none ? "none" : "view");
    }
    for (const s of others) expect(roleToPermissions("admin")[s], s).toBe("edit");
  });
});

describe("saving somebody's access on Team > Manage access", () => {
  // The browser's own completePermissions, taken from app.js and run over its own SECTIONS, so this
  // is what the screen will really send (the way admin-sections-in-sync.test.ts reads the presets).
  const appJs = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
  const list = (name: string): string[] => {
    const start = appJs.indexOf("var " + name + " = [");
    const open = appJs.indexOf("[", start);
    return appJs
      .slice(open + 1, appJs.indexOf("]", open))
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  };
  const fn = (name: string): string => {
    const start = appJs.indexOf("function " + name + "(");
    let depth = 0;
    for (let i = appJs.indexOf("{", start); i < appJs.length; i++) {
      if (appJs[i] === "{") depth++;
      else if (appJs[i] === "}" && --depth === 0) return appJs.slice(start, i + 1);
    }
    throw new Error("no " + name);
  };
  const completePermissions = new Function("SECTIONS", "return " + fn("completePermissions"))(list("SECTIONS")) as (p: PermissionMap) => PermissionMap;
  const rolePreset = new Function("SECTIONS", "OPERATIONAL_EDITOR_SECTIONS", "return " + fn("rolePresetPermissions"))(list("SECTIONS"), list("OPERATIONAL_EDITOR_SECTIONS")) as (role: string) => PermissionMap;

  it("the screen knows the section", () => {
    expect(list("SECTIONS")).toContain("red-bag");
  });

  it("opening and saving an older saved matrix changes no other section and grants nothing new", () => {
    const saved = savedBefore((s) => (s === "team" ? "none" : s === "stories" ? "edit" : "view"));
    const sent = completePermissions(saved);
    for (const s of others) expect(sent[s], s).toBe(saved[s]);
    expect(sent[SECTION]).toBe("none");
    // And the server takes exactly that: a complete matrix, stored as it is.
    const parsed = permissionsSchema.safeParse({ permissions: sent });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.permissions).toEqual(sent);
  });

  it.each(["editor", "viewer"])("opening and saving a %s who never had saved access leaves them without it", (role) => {
    const sent = completePermissions(rolePreset(role));
    expect(sent[SECTION]).toBe("none");
    const server = roleToPermissions(role);
    for (const s of others) expect(sent[s], s).toBe(server[s] ?? "none");
    expect(permissionsSchema.safeParse({ permissions: sent }).success).toBe(true);
  });

  it("the Admin button on that screen gives it, the Editor and Viewer buttons do not", () => {
    expect(completePermissions(rolePreset("admin"))[SECTION]).toBe("edit");
    expect(completePermissions(rolePreset("editor"))[SECTION]).toBe("none");
    expect(completePermissions(rolePreset("viewer"))[SECTION]).toBe("none");
  });

  it("the server refuses a matrix that leaves the section out, rather than guess", () => {
    expect(permissionsSchema.safeParse({ permissions: savedBefore(() => "view") }).success).toBe(false);
  });

  it("has a line on the screen: the menu link the row takes its name from says Fill a Red Bag", () => {
    const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
    const link = html.match(/<button class="admin-nav-link" type="button" data-view="red-bag">([^<]*)<\/button>/);
    expect(link?.[1]).toBe("Fill a Red Bag");
  });
});

describe("the menu and its New pill", () => {
  const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");

  it("is under Giving, straight after Donations", () => {
    const giving = html.slice(html.indexOf(">Giving</li>"), html.indexOf(">Content</li>"));
    const views = [...giving.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
    expect(views.slice(0, 2)).toEqual(["donations", "red-bag"]);
  });

  it("is gated on its own section, so it shows only to people who have it", () => {
    const tag = html.match(/<button class="admin-nav-link"[^>]*data-view="red-bag"[^>]*>/)![0];
    expect(tag).not.toMatch(/data-(edit|view)-gate/);
  });

  it("carries a New pill for people who may open it, from a moment already past", () => {
    const area = AREAS.find((a) => (a.area as string) === "red-bag");
    expect(area).toEqual({ area: "red-bag", section: "red-bag", level: "view" });
    const feature = FEATURES.find((f) => (f.area as string) === "red-bag");
    expect(feature).toBeTruthy();
    expect(feature!.added.getTime()).toBeLessThan(Date.now());
    expect(feature!.added.toISOString() > "2026-10-05T00:00:00.000Z").toBe(true);
    expect(reachableAreas(roleToPermissions("admin")).some((a) => (a.area as string) === "red-bag")).toBe(true);
    expect(reachableAreas(roleToPermissions("editor")).some((a) => (a.area as string) === "red-bag")).toBe(false);
    expect(reachableAreas(roleToPermissions("viewer")).some((a) => (a.area as string) === "red-bag")).toBe(false);
  });
});
