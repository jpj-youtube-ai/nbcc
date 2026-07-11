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
  "contact",
  "newsletter",
  "thank-you",
  "audit",
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
    const perms: PermissionMap = { overview: "view", audit: "view", team: "none" };
    for (const section of OPERATIONAL_EDITOR_SECTIONS) {
      perms[section] = "edit";
    }
    return perms;
  }

  // viewer (and any unrecognised role) — view everywhere except team, no edit.
  const perms: PermissionMap = {};
  for (const section of SECTIONS) {
    perms[section] = section === "team" ? "none" : "view";
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
