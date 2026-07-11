import { describe, it, expect } from "vitest";
import {
  SECTIONS,
  roleToPermissions,
  effectivePermissions,
  can,
  type Section,
  type PermissionMap,
} from "../../src/admin/permissions";

const OPERATIONAL_EDITOR_SECTIONS: Section[] = [
  "donations",
  "claims",
  "gasds",
  "subscriptions",
  "stories",
  "ticker",
  "contact",
  "newsletter",
  "thank-you",
  "search",
];

describe("SECTIONS", () => {
  it("lists exactly the 13 matrix sections", () => {
    expect(SECTIONS).toEqual([
      "overview",
      "search",
      "donations",
      "claims",
      "gasds",
      "subscriptions",
      "stories",
      "ticker",
      "contact",
      "newsletter",
      "thank-you",
      "audit",
      "team",
    ]);
    expect(SECTIONS).toHaveLength(13);
  });
});

describe("can", () => {
  it("edit satisfies a view requirement", () => {
    expect(can({ stories: "edit" }, "stories", "view")).toBe(true);
  });

  it("edit satisfies an edit requirement", () => {
    expect(can({ stories: "edit" }, "stories", "edit")).toBe(true);
  });

  it("view satisfies a view requirement", () => {
    expect(can({ stories: "view" }, "stories", "view")).toBe(true);
  });

  it("view does not satisfy an edit requirement", () => {
    expect(can({ stories: "view" }, "stories", "edit")).toBe(false);
  });

  it("'none' fails a view requirement", () => {
    expect(can({ stories: "none" }, "stories", "view")).toBe(false);
  });

  it("'none' fails an edit requirement", () => {
    expect(can({ stories: "none" }, "stories", "edit")).toBe(false);
  });

  it("a missing section entry fails a view requirement", () => {
    expect(can({}, "stories", "view")).toBe(false);
  });

  it("a missing section entry fails an edit requirement", () => {
    expect(can({}, "stories", "edit")).toBe(false);
  });
});

describe("roleToPermissions", () => {
  it("admin gets edit on every section, including team", () => {
    const perms = roleToPermissions("admin");
    for (const section of SECTIONS) {
      expect(perms[section]).toBe("edit");
    }
  });

  it("editor gets edit on the operational sections", () => {
    const perms = roleToPermissions("editor");
    for (const section of OPERATIONAL_EDITOR_SECTIONS) {
      expect(perms[section]).toBe("edit");
    }
  });

  it("editor gets view on audit", () => {
    const perms = roleToPermissions("editor");
    expect(perms.audit).toBe("view");
  });

  it("editor gets none on team", () => {
    const perms = roleToPermissions("editor");
    expect(perms.team).toBe("none");
  });

  it("editor has no edit access on team, however permissions are read", () => {
    const perms = roleToPermissions("editor");
    expect(can(perms, "team", "edit")).toBe(false);
    expect(can(perms, "team", "view")).toBe(false);
  });

  it("viewer gets view on all sections except team", () => {
    const perms = roleToPermissions("viewer");
    for (const section of SECTIONS) {
      if (section === "team") continue;
      expect(perms[section]).toBe("view");
    }
  });

  it("viewer gets none on team", () => {
    const perms = roleToPermissions("viewer");
    expect(perms.team).toBe("none");
  });

  it("viewer has no edit access anywhere", () => {
    const perms = roleToPermissions("viewer");
    for (const section of SECTIONS) {
      expect(perms[section]).not.toBe("edit");
    }
  });
});

describe("effectivePermissions", () => {
  it("falls back to roleToPermissions when the stored map is null", () => {
    const result = effectivePermissions({ role: "editor", permissions: null });
    expect(result).toEqual(roleToPermissions("editor"));
  });

  it("falls back to roleToPermissions when the stored map is empty", () => {
    const result = effectivePermissions({ role: "viewer", permissions: {} });
    expect(result).toEqual(roleToPermissions("viewer"));
  });

  it("uses the stored map when it has any keys, ignoring role", () => {
    const stored: PermissionMap = { stories: "edit" };
    const result = effectivePermissions({ role: "viewer", permissions: stored });
    expect(result).toEqual(stored);
    expect(can(result, "stories", "edit")).toBe(true);
    expect(can(result, "donations", "view")).toBe(false);
  });

  it("uses a partial stored map even when role would otherwise grant more", () => {
    const stored: PermissionMap = { team: "edit" };
    const result = effectivePermissions({ role: "admin", permissions: stored });
    expect(result).toEqual(stored);
    expect(can(result, "donations", "view")).toBe(false);
  });
});
