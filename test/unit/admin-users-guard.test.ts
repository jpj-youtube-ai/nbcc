import { describe, it, expect, vi } from "vitest";
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn() } }));
import { wouldOrphanAdmins } from "../../src/db/admin-users";

describe("last-admin guard", () => {
  const admin = { id: 1, email: "a@x", full_name: "A", role: "admin", status: "active", invited_at: null, last_login_at: null };
  const editor = { ...admin, id: 2, role: "editor" };
  it("blocks removing the only enabled admin", () => {
    expect(wouldOrphanAdmins(admin, "delete", 1)).toBe(true);
    expect(wouldOrphanAdmins(admin, "disable", 1)).toBe(true);
    expect(wouldOrphanAdmins(admin, "demote", 1)).toBe(true);
  });
  it("allows when another admin remains", () => {
    expect(wouldOrphanAdmins(admin, "delete", 2)).toBe(false);
  });
  it("ignores non-admins", () => {
    expect(wouldOrphanAdmins(editor, "delete", 1)).toBe(false);
  });

  // Admin Phase 2 (TASK-186): the guard is re-expressed in terms of EFFECTIVE team:edit, not the
  // raw role column, so a non-admin role with a stored team:edit override counts as the "admin"
  // the guard is protecting, and an 'admin' role whose stored permissions explicitly downgrade
  // team below edit no longer counts.
  it("counts a non-admin role with a stored team:edit override as the last admin", () => {
    const viewerWithTeamEdit = { ...editor, role: "viewer", permissions: { team: "edit" } };
    expect(wouldOrphanAdmins(viewerWithTeamEdit, "delete", 1)).toBe(true);
    expect(wouldOrphanAdmins(viewerWithTeamEdit, "delete", 2)).toBe(false);
  });

  it("does not count an 'admin' role whose stored permissions downgrade team below edit", () => {
    const adminWithoutTeamEdit = { ...admin, permissions: { team: "view" } };
    expect(wouldOrphanAdmins(adminWithoutTeamEdit, "delete", 1)).toBe(false);
  });

  it("ignores a disabled user even if their effective permissions grant team:edit", () => {
    const disabledAdmin = { ...admin, status: "disabled" };
    expect(wouldOrphanAdmins(disabledAdmin, "delete", 1)).toBe(false);
  });
});
