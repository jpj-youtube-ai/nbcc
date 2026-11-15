// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SECTIONS, roleToPermissions, type PermissionMap } from "../../src/admin/permissions";
import { permissionsSchema } from "../../src/admin/user-schema";
import { mountAdmin, el, q, qa, text, press, choose, settle, type Admin, type Call, type Reply } from "./helpers/admin-settings-harness";

// Admin > Team and Team > Manage access, in the kit's look
// (docs/superpowers/specs/2026-11-14-admin-refresh-settings.md). These two screens decide who can see
// donors' data, so what they SAY must be what the server does. The server here is the real one's
// rules, restated: a person with saved access of their own keeps it whatever their role
// (effectivePermissions), and a save of someone's access is held to the real schema. Every person and
// address is invented.

vi.setConfig({ testTimeout: 20_000 });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ukDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
const ukToday = ukDay(new Date());
/** Noon on the UK day `n` days back, so the day never slips with the clocks. */
const daysAgo = (n: number) => new Date(Date.parse(ukToday + "T12:00:00Z") - n * 864e5).toISOString();
/** "12 November", with the year when it is not this one: how the screens say a date. */
const dayWords = (iso: string) => {
  const [y, m, d] = ukDay(new Date(iso)).split("-").map(Number);
  return d + " " + MONTHS[m - 1] + (y === Number(ukToday.slice(0, 4)) ? "" : " " + y);
};

type Person = {
  id: number; email: string; full_name: string; role: string; status: string;
  invited_at: string | null; last_login_at: string | null; permissions: PermissionMap;
};
const complete = (perms: PermissionMap): PermissionMap => ({ ...Object.fromEntries(SECTIONS.map((s) => [s, "none"])), ...perms });
/** Rowan's own access: an editor's, but with Donations taken away and Audit raised to edit. */
const ROWANS = complete({ ...roleToPermissions("editor"), donations: "none", audit: "edit" });

let people: Person[] = [];
let permsAnswer: Reply | null = null; // what saving someone's access answers, when a test wants a failure
let roleAnswer: Reply | null = null;
let admin: Admin;

const person = (id: number) => people.find((p) => p.id === id) as Person;
function route(call: Call): Reply | undefined {
  const { method, path, body } = call;
  if (path === "/api/admin/users" && method === "GET") return { body: { results: people } };
  if (path === "/api/admin/users" && method === "POST") return { status: 201, body: { id: 99 } };
  const perms = path.match(/^\/api\/admin\/users\/(\d+)\/permissions$/);
  if (perms && method === "PATCH") {
    if (permsAnswer) return permsAnswer;
    const parsed = permissionsSchema.safeParse(body);
    if (!parsed.success) return { status: 400, body: { error: "Invalid permissions update" } };
    const p = person(Number(perms[1]));
    p.permissions = parsed.data.permissions;
    return { body: { ...p } };
  }
  const reset = path.match(/^\/api\/admin\/users\/(\d+)\/reset$/);
  if (reset && method === "POST") return { body: { sent: true } };
  const one = path.match(/^\/api\/admin\/users\/(\d+)$/);
  if (one && method === "PATCH") {
    if (roleAnswer) return roleAnswer;
    const p = person(Number(one[1]));
    const change = body as { role?: string; status?: string };
    // As the server does: the role and the status are columns of their own. Saved access is not touched.
    if (change.role) p.role = change.role;
    if (change.status) p.status = change.status;
    return { body: { ...p } };
  }
  if (one && method === "DELETE") {
    people = people.filter((p) => p.id !== Number(one[1]));
    return { body: { deleted: true } };
  }
  return undefined;
}

const card = (id: number) => q('#teamTable [data-team-id="' + id + '"]') as HTMLElement;
const said = (id: number) => q('[data-team-said="' + id + '"]') as HTMLElement;
const sent = (method: string, pattern: RegExp) => admin.calls.filter((c) => c.method === method && pattern.test(c.path));

async function openTeam(who: Parameters<typeof mountAdmin>[0] = {}) {
  admin = mountAdmin({ sub: 3, email: "fern@example.com", role: "admin", ...who }, route);
  await admin.signIn();
  await admin.open("team");
}
async function openAccess(id: number) {
  press(q('[data-team-perms="' + id + '"]'));
  await settle();
}
const level = (section: string) => {
  const on = q('[data-perm-section="' + section + '"] .admin-seg.is-active');
  return on ? on.getAttribute("data-perm-level") : null;
};
const setLevel = (section: string, to: string) => press(q('[data-perm-section="' + section + '"] [data-perm-level="' + to + '"]'));

beforeEach(() => {
  permsAnswer = null;
  roleAnswer = null;
  people = [
    { id: 10, email: "calum@example.com", full_name: "Calum Example", role: "viewer", status: "disabled", invited_at: daysAgo(200), last_login_at: daysAgo(90), permissions: {} },
    { id: 9, email: "morag@example.com", full_name: "Morag Example", role: "viewer", status: "invited", invited_at: daysAgo(2), last_login_at: null, permissions: {} },
    { id: 8, email: "rowan@example.com", full_name: "Rowan Example", role: "editor", status: "active", invited_at: daysAgo(120), last_login_at: daysAgo(0), permissions: ROWANS },
    { id: 7, email: "sam@example.com", full_name: "Sam Example", role: "editor", status: "active", invited_at: daysAgo(150), last_login_at: daysAgo(3), permissions: {} },
    { id: 3, email: "fern@example.com", full_name: "Fern Example", role: "admin", status: "active", invited_at: daysAgo(400), last_login_at: daysAgo(1), permissions: {} },
  ];
});

describe("Team tells the truth about a change of role", () => {
  it("asks before changing a role, and changes nothing if the answer is no", async () => {
    await openTeam();
    choose(q('[data-team-role="7"]'), "viewer");
    await settle();
    expect(sent("PATCH", /\/users\/7$/)).toHaveLength(0);
    const ask = q('[data-team-ask="7"]') as HTMLElement;
    expect(text(ask)).toContain("Change Sam Example from Editor to Viewer?");
    press(q("[data-ask-no]", ask));
    await settle();
    expect(sent("PATCH", /\/users\/7$/)).toHaveLength(0);
    expect((q('[data-team-role="7"]') as HTMLSelectElement).value).toBe("editor");
    expect(text(q('[data-team-ask="7"]'))).toBe("");
  });

  it("says the role was updated, and what the new role can do, for someone on their role's access", async () => {
    await openTeam();
    choose(q('[data-team-role="7"]'), "viewer");
    await settle();
    press(q('[data-team-ask="7"] [data-ask-yes]'));
    await settle();
    expect(sent("PATCH", /\/users\/7$/).map((c) => c.body)).toEqual([{ role: "viewer" }]);
    expect(text(said(7))).toContain("Role updated.");
    expect(text(said(7))).toContain("Sam Example is now a Viewer");
    expect(said(7).className).toContain("is-ok");
    expect(text(card(7))).toContain("The Viewer's usual access");
  });

  // The fault: the server keeps a person's saved access whatever their role (effectivePermissions,
  // src/admin/permissions.ts), and the screen said "Role updated." as if their access had changed.
  it("says a change of role does not change what someone with their own access can open, before it is made", async () => {
    await openTeam();
    choose(q('[data-team-role="8"]'), "viewer");
    await settle();
    const ask = q('[data-team-ask="8"]') as HTMLElement;
    expect(text(ask)).toContain("Rowan Example has their own access, so changing the role does not change what they can open.");
    expect(text(ask)).toContain("Use Manage access");
  });

  it("says so afterwards too, never a bare Role updated, and offers the way through", async () => {
    await openTeam();
    choose(q('[data-team-role="8"]'), "viewer");
    await settle();
    press(q('[data-team-ask="8"] [data-ask-yes]'));
    await settle();
    expect(sent("PATCH", /\/users\/8$/).map((c) => c.body)).toEqual([{ role: "viewer" }]);
    const line = text(said(8));
    expect(line).not.toContain("Role updated.");
    expect(line).toContain("Rowan Example's role now reads Viewer.");
    expect(line).toContain("Rowan Example has their own access, so changing the role does not change what they can open.");
    // What they can open is still their own access, in the card, as before.
    expect(text(card(8))).toContain("Their own access");
    // The way through is beside the message.
    expect(text(q('[data-team-said-perms="8"]'))).toBe("Manage access");
    press(q('[data-team-said-perms="8"]'));
    await settle();
    expect(el("view-team-permissions").hidden).toBe(false);
    expect(text(el("team-permissions-heading"))).toContain("Rowan Example");
  });

  it("says the Admin role still decides the jobs only an Admin may do, when the change is to or from Admin", async () => {
    await openTeam();
    choose(q('[data-team-role="8"]'), "admin");
    await settle();
    expect(text(q('[data-team-ask="8"]'))).toContain("only an Admin may do");
    choose(q('[data-team-role="8"]'), "viewer");
    await settle();
    expect(text(q('[data-team-ask="8"]'))).not.toContain("only an Admin may do");
  });

  it("keeps the last admin message, in red, and puts the role back", async () => {
    roleAnswer = { status: 409, body: { error: "last_admin" } };
    await openTeam();
    choose(q('[data-team-role="3"]'), "editor");
    await settle();
    press(q('[data-team-ask="3"] [data-ask-yes]'));
    await settle();
    expect(text(said(3))).toBe("That is the last admin. Promote someone else first.");
    expect(said(3).className).toContain("is-error");
    expect((q('[data-team-role="3"]') as HTMLSelectElement).value).toBe("admin");
  });

  it("says it could not change the role, in red, when the server fails", async () => {
    roleAnswer = { status: 500, body: { error: "Admin update is temporarily unavailable" } };
    await openTeam();
    choose(q('[data-team-role="7"]'), "admin");
    await settle();
    press(q('[data-team-ask="7"] [data-ask-yes]'));
    await settle();
    expect(text(said(7))).toBe("Could not change that role.");
    expect(said(7).className).toContain("is-error");
  });
});

describe("Manage access: a failed save is red, and Back asks before throwing changes away", () => {
  // The fault: the status line never took is-error, so "Could not save that access." was drawn in the
  // same green as "Access updated.".
  it("draws a failed save as an error", async () => {
    permsAnswer = { status: 500, body: { error: "Permissions update is temporarily unavailable" } };
    await openTeam();
    await openAccess(7);
    press(el("teamPermSave"));
    await settle();
    expect(text(el("teamPermStatus"))).toBe("Could not save that access.");
    expect(el("teamPermStatus").classList.contains("is-error")).toBe(true);
    expect(el("teamPermStatus").classList.contains("is-ok")).toBe(false);
  });

  it("draws the last admin refusal as an error", async () => {
    permsAnswer = { status: 409, body: { error: "last_admin" } };
    await openTeam();
    await openAccess(3);
    press(el("teamPermSave"));
    await settle();
    expect(text(el("teamPermStatus"))).toBe("That is the last admin. Promote someone else first.");
    expect(el("teamPermStatus").classList.contains("is-error")).toBe(true);
  });

  it("draws a save that worked as fine, and clears an earlier error", async () => {
    permsAnswer = { status: 500, body: {} };
    await openTeam();
    await openAccess(7);
    press(el("teamPermSave"));
    await settle();
    permsAnswer = null;
    press(el("teamPermSave"));
    await settle();
    expect(text(el("teamPermStatus"))).toBe("Access updated.");
    expect(el("teamPermStatus").classList.contains("is-ok")).toBe(true);
    expect(el("teamPermStatus").classList.contains("is-error")).toBe(false);
  });

  it("goes straight back when nothing was changed", async () => {
    await openTeam();
    await openAccess(7);
    press(el("teamPermBack"));
    await settle();
    expect(el("view-team").hidden).toBe(false);
    expect(el("view-team-permissions").hidden).toBe(true);
  });

  // The fault: Back threw away every change without a word.
  it("asks before leaving with changes that are not saved, and stays if asked to", async () => {
    await openTeam();
    await openAccess(7);
    setLevel("donations", "none");
    press(el("teamPermBack"));
    await settle();
    expect(el("view-team-permissions").hidden).toBe(false);
    const ask = el("teamPermAsk");
    expect(text(ask)).toContain("You have changes to Sam Example's access that are not saved.");
    press(q("[data-ask-no]", ask));
    await settle();
    expect(el("view-team-permissions").hidden).toBe(false);
    expect(level("donations")).toBe("none"); // the change is still there to save
    expect(text(ask)).toBe("");
  });

  it("leaves without saving when told to, and saves nothing", async () => {
    await openTeam();
    await openAccess(7);
    setLevel("donations", "none");
    press(el("teamPermBack"));
    await settle();
    press(q("#teamPermAsk [data-ask-yes]"));
    await settle();
    expect(el("view-team").hidden).toBe(false);
    expect(sent("PATCH", /\/permissions$/)).toHaveLength(0);
    // Opened again, the change is gone: what shows is what is saved.
    await openAccess(7);
    expect(level("donations")).toBe("edit");
  });

  it("can save from the question, and then goes back", async () => {
    await openTeam();
    await openAccess(7);
    setLevel("donations", "none");
    press(el("teamPermBack"));
    await settle();
    press(q("#teamPermAsk [data-ask-other]"));
    await settle();
    const saves = sent("PATCH", /\/users\/7\/permissions$/);
    expect(saves).toHaveLength(1);
    expect((saves[0].body as { permissions: PermissionMap }).permissions.donations).toBe("none");
    expect(el("view-team").hidden).toBe(false);
  });

  it("does not ask again once the changes are saved", async () => {
    await openTeam();
    await openAccess(7);
    setLevel("donations", "none");
    press(el("teamPermSave"));
    await settle();
    press(el("teamPermBack"));
    await settle();
    expect(el("view-team").hidden).toBe(false);
  });
});

describe("Team: a card a person", () => {
  it("says when each person last signed in, or since when they were invited", async () => {
    await openTeam();
    expect(text(card(7))).toContain("Last signed in 3 days ago");
    expect(text(card(8))).toContain("Last signed in today");
    expect(text(card(9))).toContain("Invited " + dayWords(daysAgo(2)) + ", not signed in yet");
  });

  it("marks your own card, and says what each person can open in words", async () => {
    await openTeam();
    expect(text(card(3))).toContain("(you)");
    expect(text(card(7))).not.toContain("(you)");
    expect(text(card(3))).toContain("Everything");
    expect(text(card(7))).toContain("The Editor's usual access");
    const edits = Object.values(ROWANS).filter((l) => l === "edit").length;
    const looks = Object.values(ROWANS).filter((l) => l === "view").length;
    expect(text(card(8))).toContain("Their own access: can change " + edits + " areas, can look at " + looks);
  });

  it("explains the three roles from their own defaults", async () => {
    await openTeam();
    const roles = text(el("teamRolesBody"));
    expect(roles).toContain("Admin. Can open and change everything");
    expect(roles).toContain("Viewer.");
    expect(roles).toContain("Cannot open");
    expect(text(el("teamInviteRoleSays"))).toContain("An Editor can change");
  });

  it("filters by the tiles", async () => {
    await openTeam();
    press(q('[data-team-filter="invited"]'));
    expect(qa("#teamTable [data-team-id]").map((c) => c.getAttribute("data-team-id"))).toEqual(["9"]);
    press(q('[data-team-filter="all"]'));
    expect(qa("#teamTable [data-team-id]")).toHaveLength(5);
  });

  it.each([
    ["disable", "They cannot sign in until you enable them again. Nothing is deleted."],
    ["reset", "Emails them a link to choose a new one."],
    ["remove", "This cannot be undone."],
  ])("asks before %s, saying what it does, and sends nothing until told", async (what, says) => {
    await openTeam();
    press(q('[data-team-' + what + '="7"]'));
    await settle();
    expect(text(q('[data-team-ask="7"]'))).toContain(says);
    const writes = () => admin.calls.filter((c) => c.method !== "GET" && c.path.startsWith("/api/admin/users/7"));
    expect(writes()).toHaveLength(0);
    press(q('[data-team-ask="7"] [data-ask-yes]'));
    await settle();
    expect(writes()).toHaveLength(1);
  });

  it("says a removal at the head of the list, since the card has gone", async () => {
    await openTeam();
    press(q('[data-team-remove="7"]'));
    await settle();
    press(q('[data-team-ask="7"] [data-ask-yes]'));
    await settle();
    expect(card(7)).toBeNull();
    expect(text(el("teamSaid"))).toContain("Removed.");
  });
});

describe("Manage access, explained", () => {
  it("names the person, groups the rows under the menu's headings and says what each covers", async () => {
    await openTeam();
    await openAccess(7);
    expect(text(el("team-permissions-heading"))).toBe("Manage access: Sam Example");
    const groups = qa("#teamPermMatrix .set-perm-group").map((g) => text(g));
    expect(groups.slice(0, 5)).toEqual(["Monitor", "Giving", "Content", "Governance", "Admin"]);
    expect(text(q('[data-perm-row="site"]'))).toContain("Also opens QR codes");
    expect(text(q('[data-perm-row="donations"]'))).toContain("Also opens Invoices");
    expect(text(q('[data-perm-row="events"] .admin-perm-label'))).toBe("Get involved: our events");
    expect(text(el("teamPermDetail"))).toContain("None: cannot open it. View: can look. Edit: can look and change.");
  });

  it("says what saving will change, at the top and the foot, and marks rows that differ from the role", async () => {
    await openTeam();
    await openAccess(7);
    setLevel("donations", "none");
    setLevel("analytics", "view");
    const summaries = qa("[data-perm-summary]").map((p) => text(p));
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toContain("Sam Example will lose Donations and gain Analytics (View).");
    expect(q('[data-perm-row="donations"]')!.classList.contains("is-different")).toBe(true);
    expect(text(q("[data-perm-reset]"))).toBe("Put back to the Editor's usual access");
    press(q("[data-perm-reset]"));
    expect(level("donations")).toBe("edit");
    expect(text(q("[data-perm-summary]"))).toContain("Nothing has changed yet");
    press(el("teamPermSaveTop"));
    await settle();
    expect(sent("PATCH", /\/users\/7\/permissions$/)).toHaveLength(1);
  });

  it("copies access from another person", async () => {
    await openTeam();
    await openAccess(7);
    choose(el("teamPermCopyFrom"), "8");
    press(q("[data-perm-copy]"));
    expect(level("donations")).toBe("none");
    expect(level("audit")).toBe("edit");
  });
});
