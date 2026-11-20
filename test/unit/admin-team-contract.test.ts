// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";

// TASK-644: Team, Manage access and My account fed what the REAL server sends. The route handlers in
// src/routes/admin-users.ts run for real, with every query they make (src/db/admin-users.ts and the
// permission check) answered by invented rows in the users table's own shape (helpers/real-rows.ts).
// The real /api/admin/me answer also decides, at sign in, what the menu offers. Only the database is
// pretend.

vi.mock("../../src/db/pool", async () => ({ pool: (await import("./helpers/real-server")).db.pool }));
vi.mock("../../src/config", async () => ({ config: (await import("./helpers/real-server")).CONFIG }));

import { db, callRoute, replyWith, type Reply } from "./helpers/real-server";
import { teamRows, down } from "./helpers/real-rows";
import { mountAdmin, el, q, qa, text, press } from "./helpers/admin-settings-harness";
import { getAdminUsers, getAdminMe } from "../../src/routes/admin-users";

vi.setConfig({ testTimeout: 30_000 });

const FERN = { email: "fern@example.com", fullName: "Fern Example" };
const real: Record<string, Reply> = {};
const broken: Record<string, Reply> = {};
beforeAll(async () => {
  db.answer(teamRows(), FERN);
  real["GET /api/admin/users"] = await callRoute(getAdminUsers);
  db.answer(teamRows(), FERN);
  real["GET /api/admin/me"] = await callRoute(getAdminMe);

  db.answer([down("FROM users ORDER BY id DESC")], FERN);
  broken["GET /api/admin/users"] = await callRoute(getAdminUsers);
});

async function open(view: string, replies: Record<string, Reply>) {
  const admin = mountAdmin({ role: "admin", ...FERN }, replyWith(replies));
  await admin.signIn();
  if (view === "account") {
    press(el("accountBtn"));
    await admin.settle();
  } else await admin.open(view);
  return admin;
}
const NOTHING_MADE_UP = /undefined|NaN|Invalid Date|\[object Object\]|null/;

describe("Team, Manage access and My account with the real server's answers", () => {
  it("the real handlers answered", () => {
    for (const r of Object.values(real)) expect(r.status).toBe(200);
    expect(broken["GET /api/admin/users"].status).toBe(500);
  });

  it("Team: lists everyone with their role, where they stand, and who has their own access", async () => {
    await open("team", real);
    const team = text(el("teamTable"));
    for (const s of ["Sam Pretend", "new.helper@example.com", "Robin Madeup", "Fern Example", "Morven Unreal", "Viewer", "Editor", "Admin"]) {
      expect(team).toContain(s);
    }
    expect(team).toContain("Their own access");
    expect(team).not.toMatch(NOTHING_MADE_UP);
    expect(qa("#teamTable [data-team-perms]").length).toBeGreaterThan(0);
  });

  it("Manage access: opens on the person's own saved access", async () => {
    const admin = await open("team", real);
    press(q('#teamTable [data-team-perms="4"]'));
    await admin.settle();
    expect(text(el("team-permissions-heading"))).toContain("Robin Madeup");
    const detail = el("teamPermDetail");
    expect(text(detail)).not.toMatch(NOTHING_MADE_UP);
    expect(text(detail)).toContain("They have access of their own");
    // Stories saved as "edit" and Donations as "none": the matrix shows what was saved, not the role's usual.
    const picked = (area: string) => detail.querySelector(`[data-perm-section="${area}"] .admin-seg.is-active`)?.getAttribute("data-perm-level");
    expect(picked("stories")).toBe("edit");
    expect(picked("donations")).toBe("none");
  });

  it("Team: says plainly when the team could not be loaded", async () => {
    await open("team", broken);
    expect(text(el("teamTable"))).toBe("Could not load the team.");
  });

  it("My account: shows their own email and name from the real answer", async () => {
    await open("account", real);
    expect((el("accountEmail") as HTMLInputElement).value).toBe("fern@example.com");
    expect((el("accountName") as HTMLInputElement).value).toBe("Fern Example");
    expect(text(el("accountNameStatus"))).toBe("");
    expect(text(el("accountTiles"))).not.toMatch(NOTHING_MADE_UP);
  });
});
