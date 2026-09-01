// Pure permission model for admin management Phase 2 (per-section view/edit matrix).
// No DB, no Express — consumed by src/routes/admin-authz.ts (authorizeSection) and the
// permissions endpoint. See docs/superpowers/plans/2026-07-11-admin-phase-2-matrix.md, Task 1.

export const SECTIONS = [
  "overview",
  "search",
  "donations",
  "claims",
  "gasds",
  "subscriptions",
  "stories",
  "ticker",
  "ball",
  "contact",
  "newsletter",
  "thank-you",
  "audit",
  // The email send audit page (email-audit feature). Deliberately locked down by default:
  // admins get it through the role loop below (today that is exactly Jaimie and Jon, per the
  // request that they alone hold it and control who else does — via the Team matrix);
  // editors and viewers get NONE, unlike every other section, because the page lists who
  // received what email — donor-identifying operational data, not general content.
  "email-audit",
  // Site addressing (site-pages feature): the spare-address table and the per-page
  // search-visibility choices. Editing changes PUBLIC URLs and what Google lists, so edit is
  // launch-sensitive like "ball": admins edit by role; editors and viewers may look.
  "site",
  "team",
] as const;

export type Section = (typeof SECTIONS)[number];

export type Level = "none" | "view" | "edit";

export type PermissionMap = Partial<Record<Section, Level>>;

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

/**
 * Default permission matrix for a role, used when a user has no per-section
 * overrides stored (see effectivePermissions). Existing users keep exactly
 * their current access with zero data migration.
 */
export function roleToPermissions(role: string): PermissionMap {
  if (role === "admin") {
    const perms: PermissionMap = {};
    for (const section of SECTIONS) {
      perms[section] = "edit";
    }
    return perms;
  }

  if (role === "editor") {
    // "ball" is deliberately view-only for editors rather than joining
    // OPERATIONAL_EDITOR_SECTIONS: this section holds the gate toggle, and flipping that
    // publishes the ticket page to the public and puts the ball on the home page. That is a
    // launch decision, not routine operational work, so edit is granted per user instead of
    // arriving by default with the role.
    const perms: PermissionMap = { overview: "view", audit: "view", team: "none", ball: "view", site: "view" };
    for (const section of OPERATIONAL_EDITOR_SECTIONS) {
      perms[section] = "edit";
    }
    return perms;
  }

  // viewer (and any unrecognised role) — view everywhere except team and the email audit
  // (donor-identifying send data is admin-granted per person, never arrives with a role).
  const perms: PermissionMap = {};
  for (const section of SECTIONS) {
    perms[section] = section === "team" || section === "email-audit" ? "none" : "view";
  }
  return perms;
}

/**
 * A user's effective permissions: their stored per-section map if it has any
 * keys, else the defaults derived from their role.
 */
export function effectivePermissions(row: { role: string; permissions: PermissionMap | null }): PermissionMap {
  if (row.permissions && Object.keys(row.permissions).length > 0) {
    return row.permissions;
  }
  return roleToPermissions(row.role);
}

const LEVEL_RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

/**
 * Does this permission map satisfy `level` for `section`? Edit satisfies a
 * view requirement; a missing entry or an explicit "none" always fails.
 */
export function can(perms: PermissionMap, section: Section, level: "view" | "edit"): boolean {
  const actual = perms[section] ?? "none";
  return LEVEL_RANK[actual] >= LEVEL_RANK[level];
}
