// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// All emails in Admin > Fundraising (assets/js/admin/all-emails.js, its own file beside app.js): a
// folded card, ten folded groups, a row for each email that opens it exactly as it would arrive, a
// Version drop-down, and Approve / Withdraw (admins only) on the few emails that are approval gated.
// A fake fetch stands in for the API. Every name and address is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const admin = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
type Api = {
  loadSummary: () => Promise<unknown>;
  open: (group: string, o?: { fundraiserId?: string; touchKind?: string; emailId?: string }) => Promise<unknown>;
};
const { initAdminAllEmails } = require(resolve(ROOT, "assets/js/admin/all-emails.js")) as { initAdminAllEmails: (doc: Document, win: unknown) => Api | null };

const card = admin.match(/<section class="fr-card fr-card--fold" id="frAllEmails"[\s\S]*?<\/section>/)![0];

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tokenFor = (role: string) => `${b64({ email: "fern@example.com", role, exp: 9_999_999_999 })}.sig`;

const GROUPS: Array<[string, string]> = [
  ["signup", "Signing up and approval"],
  ["invites", "Invites from staff"],
  ["teams", "Teams"],
  ["touch", "Keeping in touch (automatic)"],
  ["finishing", "Finishing and paying in"],
  ["memory", "In memory"],
  ["pledges", "Sponsor pledges"],
  ["events", "Event pages and tickets"],
  ["ball", "The Festive Ball"],
  ["staff", "Staff notices"],
];
const APPROVED = { approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "admin:jaimie@example.com" };
const gate = (key: string, path: string, approved = false) => ({ key, path, approvedAt: approved ? APPROVED.approvedAt : null, approvedBy: approved ? APPROVED.approvedBy : null });
const email = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  subject: `Subject of ${name}`,
  who: `Goes to someone, when ${name} happens.`,
  audience: "public",
  note: null,
  touchKind: null,
  state: null,
  waitingVersion: null,
  versions: [{ id: "usual", label: "The usual one", approval: null }],
  ...over,
});
const TOUCH_PATH = "/api/admin/fundraising/touch/approvals/";
const listing = (o: { pledgeApproved?: boolean; unavailable?: boolean } = {}) => {
  const emails: Record<string, unknown[]> = {
    signup: [email("signup-thanks", "Thank you for signing up")],
    invites: [
      email("invite-memory", "Invite: in memory", {
        state: "waiting",
        waitingVersion: "usual",
        note: "The personal note is typed by whoever sends the invite. The one here is an example.",
        versions: [
          { id: "usual", label: "With a personal note", approval: gate("invite_memory", "/api/admin/fundraising/invite-wording/invite_memory/approval") },
          { id: "no-note", label: "No personal note typed", approval: gate("invite_memory", "/api/admin/fundraising/invite-wording/invite_memory/approval") },
        ],
      }),
    ],
    teams: [
      email("team-live", "Your team page is live"),
      email("team-invite", "Team invite", { subject: "Sam <b>invited</b> you", versions: [{ id: "usual", label: "The usual one", approval: null }, { id: "no-date", label: "The team has no date set", approval: null }] }),
    ],
    touch: [
      email("touch-first-gift", "Your first gift is in", { touchKind: "first_gift" }),
      email("touch-target", "You did it, target reached", { touchKind: "target", state: "approved", versions: [{ id: "usual", label: "The usual one", approval: gate("target", TOUCH_PATH + "target", true) }] }),
    ],
    finishing: [
      email("touch-finished", "Thank you, from all of us", {
        touchKind: "finished",
        state: "waiting",
        waitingVersion: "nothing-raised",
        versions: [
          { id: "usual", label: "The usual one", approval: gate("finished", TOUCH_PATH + "finished", true) },
          { id: "nothing-raised", label: "Nothing raised", approval: gate("finished_zero", TOUCH_PATH + "finished_zero") },
          { id: "group", label: "A group or business (no first name to use)", approval: gate("finished", TOUCH_PATH + "finished", true) },
        ],
      }),
    ],
    memory: [email("memory-signup", "We have your details")],
    pledges: [
      email("pledge-pay", "Here's your link to pay your pledge", {
        state: o.pledgeApproved ? "approved" : "waiting",
        waitingVersion: o.pledgeApproved ? null : "usual",
        versions: [
          { id: "usual", label: "The usual one", approval: gate("pledge_pay", "/api/admin/fundraising/pledges/approvals/pledge_pay", o.pledgeApproved) },
          { id: "gift-aid", label: "The sponsor ticked Gift Aid when they pledged", approval: gate("pledge_pay", "/api/admin/fundraising/pledges/approvals/pledge_pay", o.pledgeApproved) },
        ],
      }),
    ],
    events: [email("ticket-confirmation", "Your tickets")],
    ball: [email("ball-menu", "The menu is here", { note: "The menu and the note under it are typed by staff. The ones here are an example." })],
    staff: [email("staff-signup", "New fundraiser", { audience: "staff", note: "A notice to the team." })],
  };
  const groups = GROUPS.map(([id, name]) => ({ id, name, emails: emails[id] }));
  const all = groups.flatMap((g) => g.emails as Array<{ state: string | null }>);
  return { count: all.length, waiting: all.filter((e) => e.state === "waiting").length, approvalsUnavailable: !!o.unavailable, groups };
};

const flush = async () => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
};
const words = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
const el = (id: string) => document.getElementById(id);
const click = async (node: Element | null | undefined) => {
  node!.dispatchEvent(new Event("click", { bubbles: true }));
  await flush();
};
const openFold = async (d: Element | null) => {
  (d as HTMLDetailsElement).open = true;
  d!.dispatchEvent(new Event("toggle"));
  await flush();
};
const group = (id: string) => document.querySelector(`[data-emails-group="${id}"]`) as HTMLDetailsElement;
const item = (id: string) => document.querySelector(`[data-email="${id}"]`) as HTMLElement;
const rowBtn = (id: string) => item(id).querySelector("button.fr-emails-row") as HTMLButtonElement;
const panel = (id: string) => item(id).querySelector(".fr-emails-panel") as HTMLElement;

let gets: string[];
let writes: Array<[string, string]>;
let data: ReturnType<typeof listing>;
let fail: Record<string, number>;
let confirmAnswer = true;
let confirms: string[];
// What app.js says of the signed in person: an admin who can also edit Fundraising (as the server asks).
let canApprove = true;
const RAISING = [
  { id: 12, title: "Robin's Walk", name: "Robin Sample" },
  { id: 14, title: "Alex's Abseil", name: "Alex Sample" },
];

async function start(role = "admin", first = listing(), extra = "") {
  document.body.innerHTML = `<section class="admin-view" id="view-fundraising">${extra}${card}</section>`;
  gets = [];
  writes = [];
  confirms = [];
  fail = {};
  data = first;
  confirmAnswer = true;
  canApprove = role === "admin";
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const json = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body });
    if (method !== "GET") {
      writes.push([method, url]);
      if (fail[url]) return json(fail[url], { error: "Only an admin can do that" });
      // The server now says it is approved (or not), as a real one would.
      if (url.includes("pledge_pay")) data = listing({ pledgeApproved: method === "POST" });
      return json(200, { approval: APPROVED });
    }
    gets.push(url);
    if (fail[url]) return json(fail[url], { error: "That email could not be shown just now. The others are not affected." });
    if (url === "/api/admin/fundraising/emails/summary") return json(200, { count: data.count, waiting: data.waiting, approvalsUnavailable: data.approvalsUnavailable });
    if (url === "/api/admin/fundraising/emails") return json(200, data);
    if (url.startsWith("/api/admin/fundraising/touch/preview/")) {
      const kind = url.split("/").pop()!.split("?")[0];
      return json(200, { kind, sample: false, title: "Robin's Walk", subject: `For Robin: ${kind}`, html: "<!doctype html><p>Hi Robin</p>", wordingKey: kind === "finished" ? "finished_zero" : null, approval: null, approvalsUnavailable: false });
    }
    const m = /^\/api\/admin\/fundraising\/emails\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(url);
    if (m) {
      const e = data.groups.flatMap((g) => g.emails as Array<{ id: string; name: string; versions: Array<{ id: string; label: string; approval: unknown }> }>).find((x) => x.id === m[1])!;
      const v = e.versions.find((x) => x.id === m[2])!;
      return json(200, { id: m[1], version: m[2], label: v.label, approval: v.approval, approvalsUnavailable: data.approvalsUnavailable, subject: `${e.name} (${v.label})`, html: `<!doctype html><p>${m[1]} ${m[2]}</p>` });
    }
    return json(404, { error: "no" });
  });
  const storage = { getItem: (k: string) => (k === "nbcc_admin_token" ? tokenFor(role) : null) };
  const win = {
    fetch: fetchMock,
    sessionStorage: storage,
    AdminHelpers: helpers,
    confirm: (q: string) => (confirms.push(q), confirmAnswer),
    MutationObserver,
    CustomEvent,
    AdminFundraising: { raisingPages: () => RAISING, canApprove: () => canApprove },
    addEventListener: () => {},
  };
  const api = initAdminAllEmails(document, win)!;
  await api.loadSummary();
  await flush();
  return api;
}
async function opened(role = "admin", first = listing(), extra = "") {
  const api = await start(role, first, extra);
  await openFold(el("frAllEmailsFold"));
  return api;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the All emails card", () => {
  it("is in Admin > Fundraising, folded and closed, with its own script", () => {
    expect(admin).toContain('<script defer src="/assets/js/admin/all-emails.js"></script>');
    expect(card).toContain('<details class="fr-fold" id="frAllEmailsFold">');
    expect(card).not.toMatch(/<details[^>]*\sopen/);
    expect(words(new DOMParser().parseFromString(card, "text/html").getElementById("frAllEmailsHead"))).toBe("All emails");
  });

  it("only asks for the count while it is closed, and says how many are waiting for sign off", async () => {
    await start();
    expect(gets).toEqual(["/api/admin/fundraising/emails/summary"]);
    expect(el("frAllEmails")!.hidden).toBe(false);
    expect(words(el("frAllEmailsState"))).toBe("3 waiting for sign off");
  });

  it("says one is waiting, in the singular", async () => {
    const one = listing();
    await start("admin", { ...one, waiting: 1 });
    expect(words(el("frAllEmailsState"))).toBe("1 waiting for sign off");
  });

  it("is calm when nothing needs an admin, with the count the server gave", async () => {
    await start("admin", { ...listing(), waiting: 0, count: 69 });
    expect(words(el("frAllEmailsState"))).toBe("69 emails");
  });

  it("stays hidden for someone who cannot see Fundraising", async () => {
    document.body.innerHTML = `<section class="admin-view" id="view-fundraising">${card}</section>`;
    const win = { fetch: vi.fn(async () => ({ status: 403, ok: false, json: async () => ({ error: "forbidden" }) })), sessionStorage: { getItem: () => tokenFor("viewer") }, AdminHelpers: helpers, MutationObserver, addEventListener: () => {} };
    const api = initAdminAllEmails(document, win)!;
    await api.loadSummary();
    expect(el("frAllEmails")!.hidden).toBe(true);
  });

  it("says so when it cannot load", async () => {
    document.body.innerHTML = `<section class="admin-view" id="view-fundraising">${card}</section>`;
    const win = { fetch: vi.fn(async () => ({ status: 500, ok: false, json: async () => ({}) })), sessionStorage: { getItem: () => tokenFor("viewer") }, AdminHelpers: helpers, MutationObserver, addEventListener: () => {} };
    const api = initAdminAllEmails(document, win)!;
    await api.loadSummary();
    expect(el("frAllEmails")!.hidden).toBe(false);
    expect(words(el("frAllEmailsState"))).toBe("The emails could not load just now. Try again in a moment.");
  });
});

describe("opening the card", () => {
  it("fetches the list the first time only, and no email yet", async () => {
    await start();
    await openFold(el("frAllEmailsFold"));
    (el("frAllEmailsFold") as HTMLDetailsElement).open = false;
    await openFold(el("frAllEmailsFold"));
    expect(gets.filter((u) => u === "/api/admin/fundraising/emails").length).toBe(1);
    expect(gets.some((u) => /\/emails\/[a-z-]+\/[a-z-]+$/.test(u))).toBe(false);
  });

  it("shows the ten groups in order, each folded, with how many emails and how many are waiting", async () => {
    await opened();
    const groups = [...document.querySelectorAll("[data-emails-group]")] as HTMLDetailsElement[];
    expect(groups.map((g) => words(g.querySelector(".fr-emails-group-name")))).toEqual(GROUPS.map(([, name]) => name));
    expect(groups.every((g) => g.tagName === "DETAILS" && !g.open)).toBe(true);
    expect(words(group("teams").querySelector(".fr-emails-group-count"))).toBe("2 emails");
    expect(words(group("signup").querySelector(".fr-emails-group-count"))).toBe("1 email");
    expect(words(group("pledges").querySelector("[data-emails-group-waiting]"))).toBe("1 waiting for sign off");
    expect(group("teams").querySelector("[data-emails-group-waiting]")).toBeNull();
  });

  it("gives each email a row: its name, its subject line, and who gets it and when", async () => {
    await opened();
    const row = rowBtn("team-live");
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("type")).toBe("button");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(words(row.querySelector(".fr-emails-row-name"))).toBe("Your team page is live");
    expect(words(row.querySelector(".fr-emails-row-subject"))).toBe("Subject Subject of Your team page is live");
    expect(words(row.querySelector(".fr-emails-row-who"))).toBe("Goes to someone, when Your team page is live happens.");
  });

  it("labels a row Approved or Waiting for sign off, and nothing when it has no approval", async () => {
    await opened();
    expect(words(rowBtn("touch-target").querySelector("[data-emails-state]"))).toBe("Approved");
    expect(words(rowBtn("pledge-pay").querySelector("[data-emails-state]"))).toBe("Waiting for sign off");
    expect(rowBtn("team-live").querySelector("[data-emails-state]")).toBeNull();
    expect(words(rowBtn("team-live"))).not.toMatch(/approved|sign off/i);
  });

  it("says which version is waiting when it is not the usual one", async () => {
    await opened();
    expect(words(rowBtn("touch-finished").querySelector("[data-emails-waiting-version]"))).toBe("Version: Nothing raised");
    expect(rowBtn("pledge-pay").querySelector("[data-emails-waiting-version]")).toBeNull();
  });

  it("writes what the server sent as text, never as markup", async () => {
    await opened();
    expect(rowBtn("team-invite").querySelector("b")).toBeNull();
    expect(words(rowBtn("team-invite"))).toContain("Sam <b>invited</b> you");
  });

  it("says the sign offs could not be checked", async () => {
    await opened("admin", listing({ unavailable: true }));
    expect(words(el("frAllEmailsStatus"))).toBe("Couldn't check sign-offs just now, so wording that needs approval is held.");
  });

  it("says so when the list cannot load, and tries again the next time it is opened", async () => {
    await start();
    fail["/api/admin/fundraising/emails"] = 500;
    await openFold(el("frAllEmailsFold"));
    expect(words(el("frAllEmailsStatus"))).toBe("The emails could not load just now. Try again in a moment.");
    fail = {};
    await openFold(el("frAllEmailsFold"));
    expect(document.querySelectorAll("[data-emails-group]").length).toBe(10);
    expect(words(el("frAllEmailsStatus"))).toBe("");
  });
});

describe("opening an email", () => {
  it("fetches it only then, and shows it in a sandboxed frame with no scrollbar of its own", async () => {
    await opened();
    expect(panel("team-live").hidden).toBe(true);
    await click(rowBtn("team-live"));
    expect(gets).toContain("/api/admin/fundraising/emails/team-live/usual");
    expect(rowBtn("team-live").getAttribute("aria-expanded")).toBe("true");
    expect(rowBtn("team-live").getAttribute("aria-controls")).toBe(panel("team-live").id);
    expect(panel("team-live").hidden).toBe(false);
    const frame = panel("team-live").querySelector("iframe")!;
    expect(frame.getAttribute("srcdoc")).toBe("<!doctype html><p>team-live usual</p>");
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("scrolling")).toBe("no");
    expect(frame.getAttribute("title")).toBe("Your team page is live, as it would arrive");
    expect(words(panel("team-live").querySelector(".fr-touch-subject"))).toBe("Subject Your team page is live (The usual one)");
  });

  it("closes again on a second press, and does not fetch it twice when opened again", async () => {
    await opened();
    await click(rowBtn("team-live"));
    await click(rowBtn("team-live"));
    expect(panel("team-live").hidden).toBe(true);
    expect(rowBtn("team-live").getAttribute("aria-expanded")).toBe("false");
    await click(rowBtn("team-live"));
    expect(panel("team-live").hidden).toBe(false);
    expect(gets.filter((u) => u.endsWith("/team-live/usual")).length).toBe(1);
  });

  it("opening a second email closes nothing: the page just grows", async () => {
    await opened();
    await click(rowBtn("team-live"));
    await click(rowBtn("team-invite"));
    expect(panel("team-live").hidden).toBe(false);
    expect(panel("team-invite").hidden).toBe(false);
  });

  it("has a Version drop-down only where there is more than one version", async () => {
    await opened();
    await click(rowBtn("team-live"));
    await click(rowBtn("team-invite"));
    expect(panel("team-live").querySelector("select[data-emails-version]")).toBeNull();
    const pick = panel("team-invite").querySelector("select[data-emails-version]") as HTMLSelectElement;
    expect(words(panel("team-invite").querySelector(`label[for="${pick.id}"]`))).toBe("Version");
    expect([...pick.options].map((o) => o.textContent)).toEqual(["The usual one", "The team has no date set"]);
    pick.value = "no-date";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(gets).toContain("/api/admin/fundraising/emails/team-invite/no-date");
    expect(panel("team-invite").querySelector("iframe")!.getAttribute("srcdoc")).toContain("team-invite no-date");
  });

  it("opens on the version that is waiting for sign off", async () => {
    await opened();
    await click(rowBtn("touch-finished"));
    expect(gets).toContain("/api/admin/fundraising/emails/touch-finished/nothing-raised");
    expect((panel("touch-finished").querySelector("select[data-emails-version]") as HTMLSelectElement).value).toBe("nothing-raised");
  });

  it("shows the quiet note on an email whose words are typed elsewhere", async () => {
    await opened();
    await click(rowBtn("ball-menu"));
    expect(words(panel("ball-menu").querySelector(".fr-emails-note"))).toBe("The menu and the note under it are typed by staff. The ones here are an example.");
    await click(rowBtn("team-live"));
    expect(panel("team-live").querySelector(".fr-emails-note")).toBeNull();
  });

  it("when one email cannot be shown, says so in its own row and leaves the rest alone", async () => {
    await opened();
    fail["/api/admin/fundraising/emails/team-live/usual"] = 500;
    await click(rowBtn("team-live"));
    expect(words(panel("team-live").querySelector("[data-emails-status]"))).toBe("That email could not be shown just now. The others are not affected.");
    await click(rowBtn("team-invite"));
    expect(panel("team-invite").querySelector("iframe")!.getAttribute("srcdoc")).toContain("team-invite usual");
    expect(document.querySelectorAll("[data-emails-group]").length).toBe(10);
  });
});

describe("approving", () => {
  it("shows no approval at all on an email that has none", async () => {
    await opened();
    await click(rowBtn("team-live"));
    expect(panel("team-live").querySelector("[data-emails-signoff]")).toBeNull();
    expect(panel("team-live").querySelector("[data-emails-approve],[data-emails-withdraw]")).toBeNull();
  });

  it("an admin sees Approve this wording on one that is waiting", async () => {
    await opened("admin");
    await click(rowBtn("pledge-pay"));
    expect(words(panel("pledge-pay").querySelector("[data-emails-signoff]"))).toBe("Waiting for sign off. It won't send until an admin approves it.");
    expect(words(panel("pledge-pay").querySelector("[data-emails-approve]"))).toBe("Approve this wording");
  });

  it("an editor and a viewer see the state, and no button", async () => {
    for (const role of ["editor", "viewer"]) {
      await opened(role);
      await click(rowBtn("pledge-pay"));
      await click(rowBtn("touch-target"));
      expect(words(panel("pledge-pay").querySelector("[data-emails-signoff]"))).toMatch(/^Waiting for sign off/);
      expect(words(panel("touch-target").querySelector("[data-emails-signoff]"))).toMatch(/^Approved by jaimie@example.com on /);
      expect(document.querySelector("[data-emails-approve],[data-emails-withdraw]"), role).toBeNull();
    }
  });

  it("an admin who can only view Fundraising sees the state, and no button: the server would refuse them", async () => {
    await opened("admin");
    canApprove = false;
    await click(rowBtn("pledge-pay"));
    await click(rowBtn("touch-target"));
    expect(words(panel("pledge-pay").querySelector("[data-emails-signoff]"))).toMatch(/^Waiting for sign off/);
    expect(words(panel("touch-target").querySelector("[data-emails-signoff]"))).toMatch(/^Approved by/);
    expect(document.querySelector("[data-emails-approve],[data-emails-withdraw]")).toBeNull();
  });

  it("approving asks first, posts to the endpoint that already approves it, and updates the labels without closing anything", async () => {
    const heard: string[] = [];
    await opened("admin");
    document.addEventListener("nbcc:wording-changed", () => heard.push("changed"));
    await click(rowBtn("team-live"));
    await click(rowBtn("pledge-pay"));
    await click(panel("pledge-pay").querySelector("[data-emails-approve]"));
    expect(confirms).toEqual(["Approve this wording? From then on it is sent to sponsors while Automatic emails are on."]);
    expect(writes).toEqual([["POST", "/api/admin/fundraising/pledges/approvals/pledge_pay"]]);
    expect(words(rowBtn("pledge-pay").querySelector("[data-emails-state]"))).toBe("Approved");
    expect(words(panel("pledge-pay").querySelector("[data-emails-signoff]"))).toMatch(/^Approved by jaimie@example.com on /);
    expect(words(panel("pledge-pay").querySelector("[data-emails-withdraw]"))).toBe("Withdraw approval");
    expect(words(panel("pledge-pay").querySelector("[data-emails-status]"))).toBe("Wording approved.");
    expect(words(el("frAllEmailsState"))).toBe("2 waiting for sign off");
    expect(group("pledges").querySelector("[data-emails-group-waiting]")).toBeNull();
    expect(panel("team-live").hidden).toBe(false);
    expect(panel("pledge-pay").hidden).toBe(false);
    expect(heard).toEqual(["changed"]);
  });

  it("does nothing when the admin says no", async () => {
    await opened("admin");
    await click(rowBtn("pledge-pay"));
    confirmAnswer = false;
    await click(panel("pledge-pay").querySelector("[data-emails-approve]"));
    expect(writes).toEqual([]);
  });

  it("withdrawing asks first and sends DELETE to the same endpoint", async () => {
    await opened("admin", listing({ pledgeApproved: true }));
    await click(rowBtn("pledge-pay"));
    await click(panel("pledge-pay").querySelector("[data-emails-withdraw]"));
    expect(confirms).toEqual(["Withdraw approval? This email stops going until it is approved again."]);
    expect(writes).toEqual([["DELETE", "/api/admin/fundraising/pledges/approvals/pledge_pay"]]);
    expect(words(rowBtn("pledge-pay").querySelector("[data-emails-state]"))).toBe("Waiting for sign off");
    expect(words(panel("pledge-pay").querySelector("[data-emails-status]"))).toBe("Approval withdrawn.");
  });

  it("uses each kind of email's own question and endpoint", async () => {
    await opened("admin");
    await click(rowBtn("invite-memory"));
    await click(panel("invite-memory").querySelector("[data-emails-approve]"));
    await click(rowBtn("touch-finished"));
    await click(panel("touch-finished").querySelector("[data-emails-approve]"));
    expect(confirms).toEqual([
      "Approve this wording? Once approved, in memory invites can be sent with it.",
      "Approve this wording? Once approved, it goes to organisers by itself when it is due, while automatic emails are on.",
    ]);
    expect(writes).toEqual([
      ["POST", "/api/admin/fundraising/invite-wording/invite_memory/approval"],
      ["POST", "/api/admin/fundraising/touch/approvals/finished_zero"],
    ]);
  });

  it("says what the server said when it refuses", async () => {
    await opened("admin");
    await click(rowBtn("pledge-pay"));
    fail["/api/admin/fundraising/pledges/approvals/pledge_pay"] = 403;
    await click(panel("pledge-pay").querySelector("[data-emails-approve]"));
    expect(words(panel("pledge-pay").querySelector("[data-emails-status]"))).toBe("Only an admin can do that");
    expect(words(rowBtn("pledge-pay").querySelector("[data-emails-state]"))).toBe("Waiting for sign off");
  });

  it("on a version that is approved, points at the one still waiting", async () => {
    await opened("admin");
    await click(rowBtn("touch-finished"));
    const pick = panel("touch-finished").querySelector("select[data-emails-version]") as HTMLSelectElement;
    pick.value = "usual";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(words(panel("touch-finished").querySelector("[data-emails-signoff]"))).toMatch(/^Approved by/);
    expect(words(panel("touch-finished").querySelector("[data-emails-other]"))).toBe("Another version is still waiting for sign off: Nothing raised.");
    await click(panel("touch-finished").querySelector("[data-emails-show-version]"));
    expect(pick.value).toBe("nothing-raised");
    expect(words(panel("touch-finished").querySelector("[data-emails-approve]"))).toBe("Approve this wording");
  });

  it("holds everything, with no buttons, when the sign offs could not be checked", async () => {
    await opened("admin", listing({ unavailable: true }));
    await click(rowBtn("pledge-pay"));
    expect(words(panel("pledge-pay").querySelector("[data-emails-signoff]"))).toBe("Couldn't check sign-offs just now, so this wording is held.");
    expect(panel("pledge-pay").querySelector("[data-emails-approve],[data-emails-withdraw]")).toBeNull();
    // And it never points at another version to approve: nothing can be approved just now.
    await click(rowBtn("touch-finished"));
    expect(panel("touch-finished").querySelector("[data-emails-other],[data-emails-show-version]")).toBeNull();
  });

  it("clears the sign off when another version starts to load, so Approve is never beside the wrong email", async () => {
    await opened("admin");
    await click(rowBtn("touch-finished"));
    expect(panel("touch-finished").querySelector("[data-emails-approve]")).not.toBeNull();
    fail["/api/admin/fundraising/emails/touch-finished/usual"] = 500;
    const pick = panel("touch-finished").querySelector("select[data-emails-version]") as HTMLSelectElement;
    pick.value = "usual";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(panel("touch-finished").querySelector("[data-emails-signoff],[data-emails-approve],[data-emails-withdraw],.fr-touch-subject")).toBeNull();
    // Nor is the email that did load left showing under a drop-down that names another version.
    const frame = panel("touch-finished").querySelector("iframe")!;
    expect((frame.parentElement as HTMLElement).hidden).toBe(true);
    expect(frame.getAttribute("srcdoc") || "").not.toContain("touch-finished nothing-raised");
    expect(words(panel("touch-finished").querySelector("[data-emails-status]"))).toBe("That email could not be shown just now. The others are not affected.");
    // Going back to the version that did load reads it again, with its sign off.
    fail = {};
    pick.value = "nothing-raised";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(words(panel("touch-finished").querySelector("[data-emails-approve]"))).toBe("Approve this wording");
    expect(gets.filter((u) => u.endsWith("/touch-finished/nothing-raised")).length).toBe(2);
    expect((frame.parentElement as HTMLElement).hidden).toBe(false);
    expect(frame.getAttribute("srcdoc")).toContain("touch-finished nothing-raised");
  });
});

describe("the links from the old cards", () => {
  const LINK = '<button type="button" id="go" data-allemails-open="pledges">Read and approve these in All emails</button>';

  it("open the card at the right group, and move the focus there", async () => {
    await start("admin", listing(), LINK);
    await click(el("go"));
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
    expect(group("pledges").open).toBe(true);
    expect(group("teams").open).toBe(false);
    expect(document.activeElement).toBe(group("pledges").querySelector("summary"));
    expect(gets.filter((u) => u === "/api/admin/fundraising/emails").length).toBe(1);
  });

  it("can open one email too", async () => {
    await start("admin", listing(), '<button type="button" id="go" data-allemails-open="invites" data-allemails-email="invite-memory">Approve it in All emails</button>');
    await click(el("go"));
    expect(group("invites").open).toBe(true);
    expect(panel("invite-memory").hidden).toBe(false);
    expect(document.activeElement).toBe(rowBtn("invite-memory"));
  });
});

describe("the automatic emails, for a real fundraiser", () => {
  it("offers Show it for on those emails only, with an example first", async () => {
    await opened();
    await click(rowBtn("touch-first-gift"));
    await click(rowBtn("team-live"));
    const pick = panel("touch-first-gift").querySelector("select[data-emails-for]") as HTMLSelectElement;
    expect(words(panel("touch-first-gift").querySelector(`label[for="${pick.id}"]`))).toBe("Show it for");
    expect([...pick.options].map((o) => o.textContent)).toEqual(["An example: Sam's Santa Dash", "Robin's Walk, Robin Sample", "Alex's Abseil, Alex Sample"]);
    expect(panel("team-live").querySelector("select[data-emails-for]")).toBeNull();
  });

  // Emails can be shown before the sign ups have loaded (a refresh while on it): app.js says when
  // they arrive, and an email already open offers them without being closed and opened again.
  it("fills Show it for again when the sign ups arrive after the email was opened", async () => {
    const all = RAISING.splice(0, RAISING.length);
    try {
      await opened();
      await click(rowBtn("touch-first-gift"));
      const pick = panel("touch-first-gift").querySelector("select[data-emails-for]") as HTMLSelectElement;
      expect([...pick.options].map((o) => o.textContent)).toEqual(["An example: Sam's Santa Dash"]);
      RAISING.push(...all);
      document.getElementById("view-fundraising")!.dispatchEvent(new CustomEvent("nbcc:fundraisers-loaded"));
      expect([...pick.options].map((o) => o.textContent)).toEqual(["An example: Sam's Santa Dash", "Robin's Walk, Robin Sample", "Alex's Abseil, Alex Sample"]);
      expect(pick.value).toBe("");
    } finally {
      if (!RAISING.length) RAISING.push(...all);
    }
  });

  it("shows it as it would go today for the fundraiser chosen, and puts the versions away", async () => {
    await opened();
    await click(rowBtn("touch-finished"));
    const pick = panel("touch-finished").querySelector("select[data-emails-for]") as HTMLSelectElement;
    pick.value = "12";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(gets).toContain("/api/admin/fundraising/touch/preview/finished?fundraiserId=12");
    expect(panel("touch-finished").querySelector("iframe")!.getAttribute("srcdoc")).toContain("Hi Robin");
    expect(words(panel("touch-finished").querySelector("[data-emails-for-hint]"))).toBe("For Robin's Walk, as it would go today.");
    expect((panel("touch-finished").querySelector(".fr-emails-version-field") as HTMLElement).hidden).toBe(true);
    // Its wording key decides the sign off, with the endpoint from the list.
    await click(panel("touch-finished").querySelector("[data-emails-approve]"));
    expect(writes).toEqual([["POST", "/api/admin/fundraising/touch/approvals/finished_zero"]]);
    pick.value = "";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect((panel("touch-finished").querySelector(".fr-emails-version-field") as HTMLElement).hidden).toBe(false);
  });

  it("“Read its automatic emails” on a fundraiser opens the group with them chosen, on the email due next", async () => {
    await start("admin", listing(), '<button type="button" id="go" data-allemails-open="touch" data-allemails-fundraiser="14" data-allemails-touch="target">Read its automatic emails</button>');
    await click(el("go"));
    expect(group("touch").open).toBe(true);
    expect(panel("touch-target").hidden).toBe(false);
    expect(gets).toContain("/api/admin/fundraising/touch/preview/target?fundraiserId=14");
    expect((panel("touch-target").querySelector("select[data-emails-for]") as HTMLSelectElement).value).toBe("14");
    // Another automatic email opened afterwards is for the same fundraiser.
    await click(rowBtn("touch-first-gift"));
    expect(gets).toContain("/api/admin/fundraising/touch/preview/first_gift?fundraiserId=14");
  });

  it("opens the first of them when nothing is due", async () => {
    await start("admin", listing(), '<button type="button" id="go" data-allemails-open="touch" data-allemails-fundraiser="12">Read its automatic emails</button>');
    await click(el("go"));
    expect(panel("touch-first-gift").hidden).toBe(false);
    expect(gets).toContain("/api/admin/fundraising/touch/preview/first_gift?fundraiserId=12");
  });
});

describe("the styles", () => {
  const block = css.slice(css.indexOf("/* All emails"));
  const mine = block.slice(0, block.indexOf("/* end All emails */"));

  it("has its own block in admin.css", () => {
    expect(mine.length).toBeGreaterThan(200);
  });

  // The arrow was once written as a control character and showed as "B8" on every folded card.
  it("draws the fold arrows with a real arrow", () => {
    expect(css).toContain('.fr-fold-bar::before { content: "\\25B8";');
    expect(mine).toContain('.fr-emails-row-name::before { content: "\\25B8";');
    expect(css).not.toContain(String.fromCharCode(0x15));
  });

  it("never scrolls inside a box: the page grows", () => {
    expect(mine).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
    expect(mine).not.toMatch(/max-height/);
  });

  it("uses the admin's own colours, never a new one", () => {
    expect(mine.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });
});
