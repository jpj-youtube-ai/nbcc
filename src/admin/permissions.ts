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
  // TASK-453: the Events page's events. Content work like Stories, so editors edit by default.
  // Switching the whole page on or off is admin-only in the route, whatever this matrix says.
  "events",
  // TASK-493: community fundraising (Admin > Fundraising). Operational work like Events, so editors
  // edit by default and viewers look. Switching fundraising on or off is admin only in the route.
  "fundraising",
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
  // TASK-354: business outreach. Editors get it alongside the other operational sections below:
  // it is fundraising work volunteers do, not governance. It does carry contact details for
  // businesses and named people, which is why it is not given to viewers.
  "outreach",
  // Business supporters: what each one asked to be thanked with, and ticking each step done
  // (TASK-406). Locked down by default like "email-audit", and for the same reason: the records
  // carry business contact details and the POSTAL ADDRESS a certificate goes to. It used to ride
  // on donations:edit, which meant anyone who could correct a donation could also work through
  // somebody's perks. Admins hold it by role and grant it per person from the Team matrix.
  "business-supporters",
  // TASK-479: site analytics (Admin > Analytics). Admins only by role, as Jaimie asked; anyone else
  // is given it per person from the Team matrix. Editors and viewers get NONE, like "email-audit".
  "analytics",
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
  "outreach",
  "events",
  "fundraising",
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

  // viewer (and any unrecognised role) — view everywhere except team, the email audit, analytics and
  // business supporters (donor-identifying data is admin-granted per person, never arrives with
  // a role).
  const perms: PermissionMap = {};
  for (const section of SECTIONS) {
    perms[section] =
      section === "team" || section === "email-audit" || section === "business-supporters" || section === "analytics"
        ? "none"
        : "view";
  }
  return perms;
}

/**
 * A user's effective permissions: their stored per-section map if it has any
 * keys, else the defaults derived from their role.
 *
 * A stored map is a COMPLETE statement of access: anything it does not name is denied. That is
 * deliberate and it stays (TASK-406 considered laying the role defaults underneath and decided
 * against - a rule that fails closed loses somebody a tab, which is visible and recoverable,
 * where one that fails open grants access nobody chose and nobody sees).
 *
 * The consequence is that ADDING a section leaves it unnamed in every matrix saved before it
 * existed, and therefore denied to everyone who has ever had their permissions edited. That is
 * handled where it belongs, in the data: each new section ships with a migration that writes the
 * role-appropriate default into the existing rows. See
 * migrations/*_permissions-business-supporters.js for the pattern.
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
