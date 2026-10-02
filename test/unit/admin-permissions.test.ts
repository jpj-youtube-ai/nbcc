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
  it("lists exactly the 21 matrix sections", () => {
    expect(SECTIONS).toEqual([
      "overview",
      "search",
      "donations",
      "claims",
      "gasds",
      "subscriptions",
      "stories",
      "ticker",
      "ball",
      "events",
      "fundraising",
      "contact",
      "newsletter",
      "thank-you",
      "audit",
      "email-audit",
      "site",
      "outreach",
      "business-supporters",
      "analytics",
      "team",
    ]);
    expect(SECTIONS).toHaveLength(21);
  });
});

// TASK-493: community fundraising is operational work like Events: admins and editors edit by
// default, viewers may look. The on and off switch is admin only in the route, whatever this says.
describe("fundraising defaults", () => {
  it("admins and editors run fundraisers, viewers may look", () => {
    expect(roleToPermissions("admin").fundraising).toBe("edit");
    expect(roleToPermissions("editor").fundraising).toBe("edit");
    expect(roleToPermissions("viewer").fundraising).toBe("view");
    expect(can(roleToPermissions("viewer"), "fundraising", "edit")).toBe(false);
  });
});

// Site addressing (site-pages feature): editing changes PUBLIC URLs and what search engines
// list, so edit arrives only with the admin role (like ball's launch gate); everyone else may
// look but not touch by default.
describe("site defaults", () => {
  it("admins edit; editors and viewers view", () => {
    expect(roleToPermissions("admin").site).toBe("edit");
    expect(roleToPermissions("editor").site).toBe("view");
    expect(roleToPermissions("viewer").site).toBe("view");
    expect(can(roleToPermissions("editor"), "site", "edit")).toBe(false);
  });
});

// TASK-354: business outreach is operational fundraising work, so editors get it with the other
// operational sections. Viewers do not: the page carries contact details for named people at
// businesses who have not asked to hear from us.
describe("outreach defaults", () => {
  it("editors can work it, viewers cannot", () => {
    expect(roleToPermissions("admin").outreach).toBe("edit");
    expect(roleToPermissions("editor").outreach).toBe("edit");
    expect(can(roleToPermissions("viewer"), "outreach", "edit")).toBe(false);
  });
});

// TASK-453: building events is content work, like Stories, so editors get it with the other
// operational sections and viewers may look. Turning the whole Events page on or off is a launch
// decision and is admin-only in the route, whatever this matrix says.
describe("events defaults", () => {
  it("admins and editors build events, viewers may look", () => {
    expect(roleToPermissions("admin").events).toBe("edit");
    expect(roleToPermissions("editor").events).toBe("edit");
    expect(roleToPermissions("viewer").events).toBe("view");
    expect(can(roleToPermissions("viewer"), "events", "edit")).toBe(false);
  });
});

// The email audit page (email-audit feature) lists who received what email — donor-identifying
// operational data — so unlike every other section it never arrives with a role below admin.
// Today's admins are exactly the two people the page was commissioned for; anyone else gets it
// per person, through the Team matrix.
describe("email-audit defaults", () => {
  it("arrives with the admin role", () => {
    expect(roleToPermissions("admin")["email-audit"]).toBe("edit");
  });

  it("is NONE for editors — even though they edit most operational sections", () => {
    expect(roleToPermissions("editor")["email-audit"] ?? "none").toBe("none");
    expect(can(roleToPermissions("editor"), "email-audit", "view")).toBe(false);
  });

  it("is NONE for viewers — the one view-everywhere role exception besides team", () => {
    expect(roleToPermissions("viewer")["email-audit"]).toBe("none");
    expect(can(roleToPermissions("viewer"), "email-audit", "view")).toBe(false);
  });

  it("can still be granted per person via a stored override", () => {
    const stored: PermissionMap = { "email-audit": "view" };
    expect(can(effectivePermissions({ role: "viewer", permissions: stored }), "email-audit", "view")).toBe(true);
  });
});

// TASK-479: site analytics. Admins hold it by role and can give it to anyone from Team > Manage
// access; nobody else gets it with their role, as Jaimie asked.
describe("analytics defaults", () => {
  it("admins edit; editors and viewers get none", () => {
    expect(roleToPermissions("admin").analytics).toBe("edit");
    expect(roleToPermissions("editor").analytics ?? "none").toBe("none");
    expect(roleToPermissions("viewer").analytics).toBe("none");
    expect(can(roleToPermissions("editor"), "analytics", "view")).toBe(false);
    expect(can(roleToPermissions("viewer"), "analytics", "view")).toBe(false);
  });

  it("can still be given to anyone through a saved matrix", () => {
    expect(can(effectivePermissions({ role: "viewer", permissions: { analytics: "view" } }), "analytics", "view")).toBe(true);
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

  it("viewer gets view on all sections except team, email-audit, business-supporters and analytics", () => {
    const perms = roleToPermissions("viewer");
    for (const section of SECTIONS) {
      if (section === "team" || section === "email-audit" || section === "business-supporters" || section === "analytics") continue;
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

// TASK-406: the new section, and the rule that decides who gets it.
describe("business supporters is granted, not inherited (TASK-406)", () => {
  it("comes with the admin role", () => {
    expect(can(roleToPermissions("admin"), "business-supporters", "edit")).toBe(true);
  });

  // Locked down like email-audit, and for the same reason: these records carry business contact
  // details and the postal address a certificate is sent to.
  it.each(["editor", "viewer"])("does not come with the %s role", (role) => {
    expect(can(roleToPermissions(role), "business-supporters", "view")).toBe(false);
  });

  // The rule that makes the migration necessary, asserted here so nobody "fixes" it by laying the
  // role defaults underneath a stored matrix. Failing closed loses somebody a tab, which is
  // visible and recoverable; failing open grants access nobody chose and nobody sees.
  it("stays denied when a stored matrix predates the section, rather than falling back to the role", () => {
    const savedBefore: PermissionMap = {};
    for (const section of SECTIONS) {
      if (section === "business-supporters") continue;
      savedBefore[section] = "edit";
    }
    const perms = effectivePermissions({ role: "admin", permissions: savedBefore });
    expect(can(perms, "business-supporters", "edit")).toBe(false);
  });
});
