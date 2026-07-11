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
});
