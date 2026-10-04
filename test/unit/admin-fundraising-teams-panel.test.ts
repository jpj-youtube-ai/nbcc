// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Each test loads the whole admin page afresh in jsdom: quick alone, but past the usual 5 seconds
// under a full parallel run (as admin-fundraising-page.test.ts).
vi.setConfig({ testTimeout: 20_000 });

// Team pages (Jaimie, 2026-10-03): teams in Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-news-panel.test.ts). A team page is marked Team; a member sign up says which team
// it is joining; the open team shows its split, its join link, its combined meter, its members and
// its invites (held, sent, reminded, joined, deleted); and staff (editors and admins, never viewers)
// hand the team organiser role over, by an emailed code. Every name here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
const fundraiser = (id: number, over: Record<string, unknown> = {}): Rec => ({
  id, slug: "f" + id, path: "raising", kind: "santa_dash", kindLabel: "Santa dash", title: "Exampleton Juniors", description: "Dashing.",
  eventDate: "2026-12-05", startTime: null, venue: "", town: "Exampleton", targetPence: 200000, public: true, status: "approved",
  name: "Robin Organiser", email: "robin@example.com", phone: "07700 900123", socialLink: null, socialOk: false,
  wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false }, postAddress: null, newsletterOk: false, imageSrc: null,
  declinedReason: null, createdAt: "2026-09-20T10:00:00.000Z", approvedAt: "2026-09-21T10:00:00.000Z", approvedBy: null,
  updatedAt: "2026-09-21T10:00:00.000Z", updatedBy: null, pageUrl: null, isTeam: false, teamId: null, teamLeftAt: null, ...over,
});
const meter = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 25000, percent: 0, barPercent: 0, overTarget: false };

const teamView = () => ({
  kind: "team",
  shareMode: "team",
  split: "The whole team’s split: every member page shares 50% with NBCC, the rest to Exampleton Food Larder.",
  joinUrl: "https://nbcc.scot/fundraise/ej/join",
  meter: { raisedPence: 6000, onlinePence: 6000, cashPence: 0, giftAidPence: 0, targetPence: 200000, percent: 3, barPercent: 3, overTarget: false },
  members: [
    { id: 41, name: "Ava Sample", email: "parent@example.com", status: "new", left: false, raisedPence: 0, targetPence: null, pageUrl: null },
    { id: 42, name: "Zara Example", email: "zara@example.com", status: "approved", left: false, raisedPence: 2500, targetPence: 5000, pageUrl: "https://nbcc.scot/fundraise/ze" },
  ],
  invites: [
    { id: 7, name: "Dee <Example>", email: "dee@example.com", under18: true, status: "held", createdAt: "2026-10-01T10:00:00.000Z", sentAt: null, remindedAt: null, joinedAt: null, deletedAt: null },
    { id: 8, name: null, email: null, status: "joined", createdAt: "2026-09-01T10:00:00.000Z", sentAt: "2026-09-02T10:00:00.000Z", remindedAt: null, joinedAt: "2026-09-03T10:00:00.000Z", deletedAt: "2026-10-02T10:00:00.000Z" },
  ],
  handover: handoverOpen
    ? { id: 3, teamId: 40, toFirstName: "Sam", toLastName: "New", toEmail: "sam@example.com", createdBy: "admin:fern@example.com", createdAt: "2026-10-03T10:00:00.000Z", expiresAt: "2026-10-06T10:00:00.000Z" }
    : null,
});

let records: Rec[] = [];
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let calls: { method: string; path: string; body: unknown }[] = [];
let handoverOpen = false;
let history: Record<number, unknown[]> = {};

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((r) => r.id === id);
  if (!f) return j({ error: "That no longer exists" }, 404);
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: history[id] || [] });
  if (/^\/team\/members\/\d+\/remove$/.test(rest) && method === "POST") return j({ removed: Number(rest.split("/")[3]) });
  if (rest === "/news") return j({ updates: [] });
  if (rest === "/team" && method === "GET") {
    if (f.isTeam) return j(teamView());
    if (f.teamId) return j({ kind: "member", left: false, team: { id: 40, title: "Exampleton Juniors", slug: "ej", shareMode: "team", status: "approved" } });
    return j({ kind: "none" });
  }
  if (rest === "/team/handover" && method === "POST") {
    handoverOpen = true;
    return j({ handover: teamView().handover, emailed: true });
  }
  if (rest === "/split" && method === "PUT") return j({ fundraiser: f });
  if (rest === "/team/handover/cancel" && method === "POST") {
    handoverOpen = false;
    return j({ cancelled: true });
  }
  return j({ error: "not here" }, 404);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 14; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);

async function openFundraising() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="get-involved"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  (row(id) as HTMLElement).click();
  await settle();
}

let confirmed: string[] = [];

beforeEach(() => {
  records = [
    fundraiser(40, { isTeam: true, slug: "ej" }),
    fundraiser(41, { title: "Ava's page for Exampleton Juniors", name: "Ava Sample", status: "new", teamId: 40 }),
    fundraiser(50, { title: "Solo Walk" }),
  ];
  role = "admin";
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  handoverOpen = false;
  history = {};
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return true;
  };
  window.alert = () => undefined;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string; headers?: Record<string, string> }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

describe("the list", () => {
  it("marks a team page as a team, and says which team a member sign up is joining", async () => {
    await openFundraising();
    expect(text(row(40)?.querySelector(".fr-team-pill") ?? null)).toBe("Team");
    expect(text(row(41)?.querySelector(".fr-joining-pill") ?? null)).toBe("Joining Exampleton Juniors");
    expect(row(50)?.querySelector(".fr-team-pill, .fr-joining-pill")).toBeNull();
    expect(document.body.textContent).not.toMatch(/captain/i);
  });
});

describe("an open team", () => {
  it("shows the split, the join link, the combined meter, the members and the invites", async () => {
    await openFundraising();
    await openRow(40);
    const p = q("#frTeam")!;
    expect(text(p.closest("section")!.querySelector("h4"))).toBe("Team");
    expect(text(p)).toContain("The whole team’s split: every member page shares 50% with NBCC");
    expect(text(p)).toContain("nbcc.scot/fundraise/ej/join");
    expect(text(p)).toContain("£60 raised of £2000, by the whole team");
    expect(text(p)).toContain("Ava Sample");
    expect(text(p)).toContain("Waiting for you to approve");
    expect(text(p)).toContain("Zara Example");
    expect(text(p)).toContain("Dee <Example>");
    expect(p.innerHTML).not.toContain("<Example>");
    expect(text(p)).toContain("Dee <Example> (under 18, parent or guardian’s email: dee@example.com)");
    expect(text(p)).toContain("Held until you approve the team");
    expect(text(p)).toContain("Joined");
    expect(text(p)).toContain("Name and email deleted");
  });

  it("hands the team organiser role to a member, by an emailed code", async () => {
    asRole("editor");
    await openFundraising();
    await openRow(40);
    const pick = q('#frTeam select[data-frteam-member]') as HTMLSelectElement;
    // Only an approved member (Ava is still waiting for staff).
    expect([...pick.options].map((o) => o.textContent)).toEqual(["Someone new", "Zara Example"]);
    pick.value = "42";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    (q("#frTeamPhone") as HTMLInputElement).value = "07700 900222";
    (q("[data-frteam-handover]") as HTMLElement).click();
    await settle();
    const sent = calls.find((c) => c.method === "POST" && c.path === "/api/admin/fundraisers/40/team/handover");
    expect(sent?.body).toEqual({ memberId: 42, phone: "07700 900222" });
    expect(confirmed.some((c) => c.includes("We will email them a code"))).toBe(true);
    expect(text(q("#frTeam"))).toContain("Waiting for Sam New (sam@example.com) to confirm with the code we emailed");
  });

  it("hands it to someone new", async () => {
    await openFundraising();
    await openRow(40);
    (q("#frTeamFirst") as HTMLInputElement).value = "Sam";
    (q("#frTeamLast") as HTMLInputElement).value = "New";
    (q("#frTeamEmail") as HTMLInputElement).value = "sam@example.com";
    (q("#frTeamPhone") as HTMLInputElement).value = "07700 900123";
    (q("[data-frteam-handover]") as HTMLElement).click();
    await settle();
    expect(calls.find((c) => c.path.endsWith("/team/handover"))?.body).toEqual({ firstName: "Sam", lastName: "New", email: "sam@example.com", phone: "07700 900123" });
  });

  it("cancels a handover still open", async () => {
    handoverOpen = true;
    await openFundraising();
    await openRow(40);
    (q("[data-frteam-cancel]") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.path.endsWith("/team/handover/cancel"))).toBe(true);
  });

  it("offers a viewer no handover", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(40);
    expect(q("[data-frteam-handover]")).toBeNull();
    expect(text(q("#frTeam"))).toContain("Zara Example");
  });
});

describe("an open member sign up", () => {
  it("says which team it is joining, and that its split is the team's", async () => {
    await openFundraising();
    await openRow(41);
    expect(text(q("#frTeam"))).toContain("Joining the team Exampleton Juniors");
    expect(text(q("#frTeam"))).toContain("The whole team shares the same split");
  });

  it("has no team panel on a sign up that is not part of a team", async () => {
    await openFundraising();
    await openRow(50);
    expect(q("#frTeam")).toBeNull();
  });
});

describe("staff taking someone off the team", () => {
  it("is a Remove beside each current member, for editors and admins, asking first", async () => {
    asRole("editor");
    await openFundraising();
    await openRow(40);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#frTeam [data-frteam-remove]")];
    expect(buttons.map((b) => b.getAttribute("data-frteam-remove"))).toEqual(["41", "42"]);
    buttons[1].click();
    await settle();
    expect(confirmed.some((c) => c.startsWith("Take Zara Example off the team?"))).toBe(true);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/fundraisers/40/team/members/42/remove")).toBe(true);
    expect(text(q("#frTeamStatus"))).toContain("Zara Example is off the team.");
  });

  it("is not offered to a viewer", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(40);
    expect(q("#frTeam [data-frteam-remove]")).toBeNull();
  });

  it("shows in the member's History as taken off by NBCC, or by the team organiser", async () => {
    history = {
      41: [
        { id: 2, actor: "admin:fern@example.com", action: "fundraiser.removed_from_team", data: { teamId: 40, by: "staff" }, createdAt: "2026-10-12T10:00:00.000Z" },
        { id: 1, actor: "organiser", action: "fundraiser.removed_from_team", data: { teamId: 40 }, createdAt: "2026-10-11T10:00:00.000Z" },
      ],
    };
    await openFundraising();
    await openRow(41);
    const h = text(q("#frHistory"));
    expect(h).toContain("Taken off the team by NBCC");
    expect(h).toContain("Taken off the team by the team organiser");
  });
});

describe("correcting a team's split (review)", () => {
  it("asks whose split it is, the team's mode chosen, and sends it", async () => {
    records[0] = { ...records[0], sharesWithOther: true, nbccSharePercent: 50, otherCauseName: "Exampleton Food Larder", teamShareMode: "team" };
    await openFundraising();
    await openRow(40);
    const team = q('#frSplitForm input[name="teamShareMode"][value="team"]') as HTMLInputElement;
    expect(team.checked).toBe(true);
    (q('#frSplitForm input[name="teamShareMode"][value="organiser"]') as HTMLInputElement).checked = true;
    q("#frSplitForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(calls.find((c) => c.method === "PUT" && c.path.endsWith("/split"))?.body).toMatchObject({ sharesWithOther: true, teamShareMode: "organiser" });
  });

  it("is not asked of a page that is not a team", async () => {
    await openFundraising();
    await openRow(50);
    expect(q('#frSplitForm input[name="teamShareMode"]')).toBeNull();
  });
});
