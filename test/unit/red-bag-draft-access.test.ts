import { describe, it, expect, vi, beforeEach } from "vitest";

// Fill a Red Bag: who may see the DRAFT list on the page (/fill?preview=draft). A signed in member
// of staff holding VIEW of the "red-bag" access section, read fresh from the database on the request
// itself, and nobody else. It fails closed. Every name and address here is invented.

const { getUserAuthRowMock } = vi.hoisted(() => ({ getUserAuthRowMock: vi.fn() }));
vi.mock("../../src/db/admin-users", () => ({ getUserAuthRow: getUserAuthRowMock }));
vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", ADMIN_SESSION_SECRET: "test-admin-secret" } }));

import { mayViewRedBagDraft } from "../../src/red-bag/staff";
import { signAdminSession } from "../../src/admin/session";
import { SECTIONS } from "../../src/admin/permissions";

const SECRET = "test-admin-secret";
const bearer = (role = "viewer", secret = SECRET, now = new Date()) => `Bearer ${signAdminSession({ sub: 7, email: "sam.staff@nbcc.test", role, now, secret }).token}`;
const row = (role: string, permissions: Record<string, string> = {}, status = "active") => ({ id: 7, email: "sam.staff@nbcc.test", status, role, permissions });
const everythingBut = (level: string) => Object.fromEntries(SECTIONS.filter((s) => s !== "red-bag").map((s) => [s, level]));

beforeEach(() => getUserAuthRowMock.mockReset());

describe("who may see the draft on the page", () => {
  it("an admin, by role", async () => {
    getUserAuthRowMock.mockResolvedValue(row("admin"));
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(true);
  });

  it("anyone given view of the section, and anyone given edit", async () => {
    getUserAuthRowMock.mockResolvedValue(row("viewer", { ...everythingBut("none"), "red-bag": "view" }));
    expect(await mayViewRedBagDraft(bearer())).toBe(true);
    getUserAuthRowMock.mockResolvedValue(row("editor", { ...everythingBut("none"), "red-bag": "edit" }));
    expect(await mayViewRedBagDraft(bearer("editor"))).toBe(true);
  });

  it("not an editor or a viewer by role alone", async () => {
    for (const role of ["editor", "viewer"]) {
      getUserAuthRowMock.mockResolvedValue(row(role));
      expect(await mayViewRedBagDraft(bearer(role)), role).toBe(false);
    }
  });

  it("not someone with every other section but this one, admin or not", async () => {
    getUserAuthRowMock.mockResolvedValue(row("admin", everythingBut("edit")));
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(false);
    getUserAuthRowMock.mockResolvedValue(row("editor", { ...everythingBut("edit"), "red-bag": "none" }));
    expect(await mayViewRedBagDraft(bearer("editor"))).toBe(false);
  });

  it("goes by the account as it is NOW, not by the role the session was signed with", async () => {
    getUserAuthRowMock.mockResolvedValue(row("viewer"));
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(false);
  });

  it("not with no session, a malformed one, a forged one or an expired one, and the database is not even asked", async () => {
    getUserAuthRowMock.mockResolvedValue(row("admin"));
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    for (const header of [undefined, "", "Bearer", "Basic abc", "Bearer not.a.token", bearer("admin", "another-secret"), bearer("admin", SECRET, longAgo)]) {
      expect(await mayViewRedBagDraft(header), String(header)).toBe(false);
    }
    expect(getUserAuthRowMock).not.toHaveBeenCalled();
  });

  it("not an account that is disabled, or gone", async () => {
    getUserAuthRowMock.mockResolvedValue(row("admin", {}, "disabled"));
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(false);
    getUserAuthRowMock.mockResolvedValue(null);
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(false);
  });

  it("not when the database cannot answer: closed, and nothing is thrown", async () => {
    getUserAuthRowMock.mockRejectedValueOnce(new Error("connection refused"));
    expect(await mayViewRedBagDraft(bearer("admin"))).toBe(false);
    expect(getUserAuthRowMock).toHaveBeenCalledTimes(1);
  });
});
