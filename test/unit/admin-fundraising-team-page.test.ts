// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-503: the team's tools on Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-page.test.ts): invite someone, the invites not taken up, Time to call and the
// Calls due filter, "Take off Get involved?", and the Weekly summary card. A fake fetch stands in for
// the API (src/routes/admin-fundraising-team.ts). Every person, place and amount is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id,
    slug: "test-dash-" + id,
    path: "raising",
    kind: "santa_dash",
    kindLabel: "A Santa dash",
    title: "Test Dash " + id,
    description: "Running round the park.",
    eventDate: "2026-12-06",
    startTime: "10:30",
    venue: "The Bandstand",
    town: "Testtown",
    targetPence: 25000,
    public: true,
    status: "approved",
    name: "Robin Example",
    email: "robin@example.com",
    phone: "07700 900123",
    socialLink: null,
    socialOk: false,
    wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null,
    newsletterOk: false,
    imageSrc: null,
    declinedReason: null,
    createdAt: "2026-09-20T10:00:00.000Z",
    approvedAt: "2026-09-21T10:00:00.000Z",
    approvedBy: "admin:fern@example.com",
    updatedAt: "2026-09-21T10:00:00.000Z",
    updatedBy: null,
    pageUrl: "https://nbcc.scot/fundraise/test-dash-" + id,
    finishedRequestedAt: null,
    offListAt: null,
    offListBy: null,
    ...over,
  };
}
const meter = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 25000, percent: 0, barPercent: 0, overTarget: false };

type Invite = { id: number; name: string; email: string; note: string | null; signedBy: string; sentBy: string; createdAt: string; resentAt: string | null; expired?: boolean; type?: string | null };
type Approval = { approvedAt: string; approvedBy: string };
const callState = (over: Record<string, unknown> = {}) => ({
  before: { which: "before", dueOn: "2026-11-29", due: true, called: null },
  after: { which: "after", dueOn: "2026-12-13", due: false, called: null },
  due: true,
  dueWhich: "before",
  ...over,
});

// ---- the stand in server ----

let records: Rec[] = [];
let team: { today: string; me: number; calls: Record<string, unknown>; prompts: Record<string, string>; invites: Invite[]; signers: Array<{ id: number; firstName: string }>; inviteWording?: { approvals: Record<string, Approval>; unavailable: boolean } };
let summary: { recipients: string[]; lastWeek: string | null };
let perms: PermissionMap;
let role = "admin";
let calls: { method: string; path: string; body: unknown; query?: string }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body, query: url.split("?")[1] || "" });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  const fixed = answers[method + " " + path];
  if (fixed) return j(fixed.body, fixed.status);
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  }
  if (path === "/api/admin/fundraising/team") return j(JSON.parse(JSON.stringify(team)));
  if (path === "/api/admin/fundraising/invites" && method === "POST") {
    const inv = { id: 40 + team.invites.length, name: `${body.firstName} ${body.lastName}`, firstName: body.firstName, lastName: body.lastName, email: body.email, note: body.note || null, signedBy: body.signedBy === 5 ? "Rowan" : "Fern", sentBy: "admin:fern@example.com", createdAt: "2026-10-02T09:00:00.000Z", resentAt: null, type: body.type ?? null };
    team.invites = [inv, ...team.invites];
    return j({ invite: inv, emailed: true }, 201);
  }
  // Invite types: each type's email to read, and the in memory wording's sign off.
  const wording = path.match(/^\/api\/admin\/fundraising\/invite-wording\/([a-z_]+)(\/approval)?$/);
  if (wording) {
    const approvals = team.inviteWording!.approvals;
    if (wording[2]) {
      if (method === "POST") approvals[wording[1]] = { approvedAt: "2026-10-03T12:00:00.000Z", approvedBy: "admin:fern@example.com" };
      else delete approvals[wording[1]];
      return j(method === "POST" ? { approval: { key: wording[1], ...approvals[wording[1]] } } : { withdrawn: true });
    }
    const memory = wording[1] === "memory";
    return j({
      type: wording[1],
      label: memory ? "In memory" : "Raising money",
      wordingKey: memory ? "invite_memory" : null,
      approval: memory ? (approvals.invite_memory ?? null) : null,
      approvalsUnavailable: false,
      subject: memory ? "A page in memory of someone you love" : "We'd love you to fundraise with us",
      html: `<html><body><p>The ${wording[1]} invite, signed by ${new URLSearchParams(url.split("?")[1] || "").get("signedBy") === "5" ? "Rowan" : "Fern"}</p></body></html>`,
      text: `The ${wording[1]} invite`,
    });
  }
  const inv = path.match(/^\/api\/admin\/fundraising\/invites\/(\d+)(\/resend)?$/);
  if (inv) {
    const id = Number(inv[1]);
    if (method === "DELETE") {
      team.invites = team.invites.filter((i) => i.id !== id);
      return j({ removed: id });
    }
    const found = team.invites.find((i) => i.id === id)!;
    found.resentAt = "2026-10-08T09:00:00.000Z";
    return j({ invite: found, emailed: true });
  }
  if (path === "/api/admin/fundraising/summary") {
    if (method === "PUT") summary = { ...summary, recipients: [...body.recipients].map((e: string) => e.toLowerCase()).sort() };
    return j({ ...summary });
  }
  if (path === "/api/admin/fundraising/summary/test") return j({ sentTo: "fern@example.com" });
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((r) => r.id === id)!;
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/calls") {
    team.calls[String(id)] = callState({ before: { which: "before", dueOn: "2026-11-29", due: false, called: { which: "before", calledAt: "2026-12-01T10:00:00.000Z", calledBy: "fern@example.com", note: body.note || null } }, due: false, dueWhich: null });
    return j({ call: { which: body.which } });
  }
  if (rest === "/off-list") {
    f.offListAt = "2026-12-01T10:00:00.000Z";
    f.offListBy = "admin:fern@example.com";
    delete team.prompts[String(id)];
    return j({ offListAt: f.offListAt });
  }
  if (rest === "/on-list") {
    f.offListAt = null;
    return j({ offListAt: null });
  }
  if (rest === "/finish") {
    f.status = "finished";
    return j({ fundraiser: f });
  }
  return j({ error: "not here" }, 404);
}

// ---- driving the page ----

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

async function openFundraising() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="fundraising"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  (row(id) as HTMLElement).click();
  await settle();
}
function setValue(sel: string, value: string) {
  const input = q(sel) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function submit(sel: string) {
  (q(sel) as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}

let confirmAnswer = true;
let confirmed: string[] = [];

function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

beforeEach(() => {
  records = [fundraiser(1), fundraiser(2, { eventDate: null }), fundraiser(3, { eventDate: "2026-10-01" })];
  team = {
    today: "2026-12-01",
    me: 3,
    calls: { "1": callState(), "3": callState({ before: { which: "before", dueOn: "2026-09-24", due: false, called: null }, after: { which: "after", dueOn: "2026-10-08", due: true, called: null }, dueWhich: "after" }) },
    prompts: { "3": "date" },
    invites: [{ id: 7, name: "Alex Example", email: "alex@example.com", note: null, signedBy: "Fern", sentBy: "admin:fern@example.com", createdAt: "2026-10-01T09:00:00.000Z", resentAt: null }],
    signers: [{ id: 3, firstName: "Fern" }, { id: 5, firstName: "Rowan" }],
    inviteWording: { approvals: {}, unavailable: false },
  };
  summary = { recipients: ["fern@example.com"], lastWeek: "2026-11-30" };
  asRole("admin");
  calls = [];
  answers = {};
  confirmAnswer = true;
  confirmed = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return confirmAnswer;
  };
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

// ---- inviting someone ----

describe("Invite someone", () => {
  for (const r of ["admin", "editor"] as const) {
    it(`is there for ${r === "admin" ? "an admin" : "an editor"}`, async () => {
      asRole(r);
      await openFundraising();
      expect(el("frInvite").hidden).toBe(false);
      expect(text(q("#frInvite h3"))).toBe("Invite someone");
    });
  }

  it("is not there for a viewer", async () => {
    asRole("viewer");
    await openFundraising();
    expect(el("frInvite").hidden).toBe(true);
  });

  it("is signed by the person signed in, unless they choose someone else", async () => {
    await openFundraising();
    const select = el("frInviteSigner") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Fern", "Rowan"]);
    expect(select.value).toBe("3");
  });

  // Jaimie 2026-10-04: the copy of the invite goes to whoever it is signed by, and the form says so.
  it("says under Signed by that a copy goes to whoever it is signed by", async () => {
    await openFundraising();
    expect(text(el("frInviteSigner")!.closest(".fr-field")!.querySelector(".fr-field-hint"))).toBe(
      "The email is signed with this first name, so they know who they spoke to. A copy goes to whoever it is signed by.",
    );
  });

  // Jaimie 2026-10-03: a First name box and a Surname box, in place of one "Their name" box.
  it("has a First name box and a Surname box, and no single name box", async () => {
    await openFundraising();
    expect(el("frInviteName")).toBeNull();
    const first = el("frInviteFirstName") as HTMLInputElement;
    const last = el("frInviteLastName") as HTMLInputElement;
    expect(text(q('label[for="frInviteFirstName"]'))).toBe("First name");
    expect(text(q('label[for="frInviteLastName"]'))).toBe("Surname");
    expect([first.name, first.maxLength]).toEqual(["firstName", 50]);
    expect([last.name, last.maxLength]).toEqual(["lastName", 50]);
    expect(first.closest("form")!.id).toBe("frInviteForm");
    expect(text(first.closest(".fr-field")!.querySelector(".fr-field-hint"))).toBe("The email says hello with this. Both boxes fill in their form exactly as you type them.");
  });

  it("sends the invite after asking, then empties the form and lists it", async () => {
    await openFundraising();
    setValue("#frInviteType", "raising");
    setValue("#frInviteFirstName", "Sky Ann");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@example.com");
    setValue("#frInviteNote", "Lovely to chat about the quiz!");
    setValue("#frInviteSigner", "5");
    submit("#frInviteForm");
    await settle();
    expect(confirmed.pop()).toBe("Send a raising money invite to Sky Ann Sample at sky@example.com, signed by Rowan?");
    expect(sent("POST", "/api/admin/fundraising/invites")[0].body).toEqual({
      firstName: "Sky Ann",
      lastName: "Sample",
      email: "sky@example.com",
      note: "Lovely to chat about the quiz!",
      signedBy: 5,
      type: "raising",
    });
    expect(text(el("frInviteStatus"))).toBe("Invite sent to Sky Ann Sample.");
    expect((el("frInviteFirstName") as HTMLInputElement).value).toBe("");
    expect((el("frInviteLastName") as HTMLInputElement).value).toBe("");
    expect((el("frInviteNote") as HTMLTextAreaElement).value).toBe("");
    // Nothing is chosen for the next one either.
    expect((el("frInviteType") as HTMLSelectElement).value).toBe("");
    expect(text(el("frInvites"))).toContain("Sky Ann Sample");
  });

  it("checks the first name, the surname, the email and the note before sending", async () => {
    await openFundraising();
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Choose what you are inviting them to do.");
    setValue("#frInviteType", "event");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Add their first name.");
    setValue("#frInviteFirstName", "Sky");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Add their surname.");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("That isn't a whole email address.");
    setValue("#frInviteEmail", "sky@example.com");
    setValue("#frInviteNote", "a".repeat(5001));
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Keep the note to 5,000 characters or fewer.");
    expect(sent("POST", "/api/admin/fundraising/invites")).toHaveLength(0);
  });

  it("sends nothing when the question is answered no", async () => {
    confirmAnswer = false;
    await openFundraising();
    setValue("#frInviteType", "raising");
    setValue("#frInviteFirstName", "Sky");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@example.com");
    submit("#frInviteForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraising/invites")).toHaveLength(0);
  });

  it("says so when the invite is saved but the email did not go", async () => {
    answers["POST /api/admin/fundraising/invites"] = { status: 201, body: { invite: team.invites[0], emailed: false } };
    await openFundraising();
    setValue("#frInviteType", "raising");
    setValue("#frInviteFirstName", "Sky");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@example.com");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Saved, but the email did not go. Press Resend to try again.");
  });

  it("passes on the server's words for the box that needs another look", async () => {
    answers["POST /api/admin/fundraising/invites"] = { status: 400, body: { error: "Some of it needs another look", fields: { lastName: "Keep the surname to 50 characters or fewer." } } };
    await openFundraising();
    setValue("#frInviteType", "raising");
    setValue("#frInviteFirstName", "Sky");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@example.com");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("Keep the surname to 50 characters or fewer.");
  });

  it("passes on the server's words when it refuses", async () => {
    answers["POST /api/admin/fundraising/invites"] = { status: 429, body: { error: "You have sent 50 invites today. Please send the rest tomorrow." } };
    await openFundraising();
    setValue("#frInviteType", "raising");
    setValue("#frInviteFirstName", "Sky");
    setValue("#frInviteLastName", "Sample");
    setValue("#frInviteEmail", "sky@example.com");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe("You have sent 50 invites today. Please send the rest tomorrow.");
    expect((el("frInviteFirstName") as HTMLInputElement).value).toBe("Sky");
    expect((el("frInviteLastName") as HTMLInputElement).value).toBe("Sample");
  });
});

// ---- invite types (Jaimie, B1 + I1) ----

// What the form says while the wording is waiting, and what the server says if it refuses one.
const WAITING = "The in memory invite wording is waiting for sign off, so this invite cannot be sent yet.";
const SERVER_WAITING = "The in memory invite wording is waiting for sign off. Read it and approve it first.";
// A sign off changed in the All emails card (assets/js/admin/all-emails.js): it says so with this.
const wordingChanged = () => el("frInvite").dispatchEvent(new CustomEvent("nbcc:wording-changed", { bubbles: true, detail: { key: "invite_memory" } }));
function fillInvite(type: string) {
  setValue("#frInviteType", type);
  setValue("#frInviteFirstName", "Mary");
  setValue("#frInviteLastName", "Smith");
  setValue("#frInviteEmail", "mary@example.com");
}
const approveMemory = () => {
  team.inviteWording!.approvals.invite_memory = { approvedAt: "2026-10-03T12:00:00.000Z", approvedBy: "admin:fern@example.com" };
};

describe("What are you inviting them to do?", () => {
  it("is a drop-down of the four, required, with nothing chosen", async () => {
    await openFundraising();
    const select = el("frInviteType") as HTMLSelectElement;
    expect(text(q('label[for="frInviteType"]'))).toBe("What are you inviting them to do?");
    expect(select.closest("form")!.id).toBe("frInviteForm");
    expect(select.required).toBe(true);
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ["", "Choose one"],
      ["raising", "Raising money"],
      ["team", "A team"],
      ["event", "Hosting an event"],
      ["memory", "In memory"],
    ]);
    // The empty choice cannot be picked again.
    expect(select.options[0].disabled).toBe(true);
    // The first thing asked.
    expect(q("#frInviteForm .fr-field")!.contains(select)).toBe(true);
  });

  it("sends the type with the invite", async () => {
    for (const type of ["team", "event"]) {
      calls = [];
      await openFundraising();
      fillInvite(type);
      submit("#frInviteForm");
      await settle();
      expect((sent("POST", "/api/admin/fundraising/invites")[0].body as Record<string, unknown>).type).toBe(type);
    }
  });

  it("names the type in plain words, the full name, the email and the signer before sending", async () => {
    const asked: Record<string, string> = {
      raising: "Send a raising money invite to Mary Smith at mary@example.com, signed by Fern?",
      team: "Send a team invite to Mary Smith at mary@example.com, signed by Fern?",
      event: "Send an event invite to Mary Smith at mary@example.com, signed by Fern?",
      memory: "Send an in memory invite to Mary Smith at mary@example.com, signed by Fern?",
    };
    approveMemory();
    confirmAnswer = false;
    await openFundraising();
    for (const type of Object.keys(asked)) {
      fillInvite(type);
      await settle();
      submit("#frInviteForm");
      await settle();
      expect(confirmed.pop()).toBe(asked[type]);
    }
    expect(sent("POST", "/api/admin/fundraising/invites")).toHaveLength(0);
  });

  it("signs the email being read as the signer chosen, and reads it again when that changes", async () => {
    await openFundraising();
    setValue("#frInviteType", "team");
    await settle();
    const read = () => sent("GET", "/api/admin/fundraising/invite-wording/team");
    expect(read()).toHaveLength(1);
    expect(read()[0].query).toBe("signedBy=3");
    expect((el("frInviteWordingFrame") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("signed by Fern");
    setValue("#frInviteSigner", "5");
    await settle();
    expect(read()).toHaveLength(2);
    expect(read()[1].query).toBe("signedBy=5");
    expect((el("frInviteWordingFrame") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("signed by Rowan");
  });

  it("reads nothing when the signer changes with no type chosen", async () => {
    await openFundraising();
    calls = [];
    setValue("#frInviteSigner", "5");
    await settle();
    expect(calls.filter((c) => c.path.indexOf("invite-wording") !== -1)).toHaveLength(0);
  });

  it("shows the email for the type chosen, to read", async () => {
    await openFundraising();
    expect(el("frInviteWording").hidden).toBe(true);
    setValue("#frInviteType", "raising");
    await settle();
    expect(sent("GET", "/api/admin/fundraising/invite-wording/raising")).toHaveLength(1);
    expect(el("frInviteWording").hidden).toBe(false);
    expect(text(el("frInviteWordingMeta"))).toContain("Subject We'd love you to fundraise with us");
    expect((el("frInviteWordingFrame") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("The raising invite");
    // Approved wording: nothing to sign off, and it stays folded away until asked for.
    expect(q("#frInviteWording [data-frinviteapprove]")).toBeNull();
    expect((el("frInviteRead") as HTMLDetailsElement).open).toBe(false);
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(false);
    expect(el("frInviteHeld").hidden).toBe(true);
  });
});

describe("the in memory invite's sign off", () => {
  it("cannot be sent until the wording is approved, and says why, with a link to All emails", async () => {
    await openFundraising();
    fillInvite("memory");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(true);
    expect(el("frInviteHeld").hidden).toBe(false);
    expect(text(el("frInviteHeldWords"))).toBe(WAITING);
    const link = el("frInviteHeldLink");
    expect(link.tagName).toBe("BUTTON");
    expect(link.hidden).toBe(false);
    expect(text(link)).toBe("Approve it in All emails");
    expect(link.getAttribute("data-allemails-open")).toBe("invites");
    expect(link.getAttribute("data-allemails-email")).toBe("invite-memory");
    // Even if the form is sent some other way, nothing goes.
    submit("#frInviteForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraising/invites")).toHaveLength(0);
    expect(confirmed).toHaveLength(0);
    expect(text(el("frInviteStatus"))).toBe(WAITING);
  });

  it("opens the email to read and says it is waiting, with no Approve button of its own", async () => {
    await openFundraising();
    setValue("#frInviteType", "memory");
    await settle();
    expect((el("frInviteRead") as HTMLDetailsElement).open).toBe(true);
    expect(text(el("frInviteWordingMeta"))).toContain("Waiting for sign off. It won't send until an admin approves it.");
    expect(text(el("frInviteWordingMeta"))).toContain("Subject A page in memory of someone you love");
    expect((el("frInviteWordingFrame") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("The memory invite");
    expect(text(el("frInvite"))).not.toMatch(/Approve this wording|Withdraw approval/);
    expect(q("#frInvite [data-frinviteapprove], #frInvite [data-frinvitewithdraw]")).toBeNull();
  });

  it("can be sent once it is approved in All emails, with what was typed still there", async () => {
    await openFundraising();
    fillInvite("memory");
    await settle();
    approveMemory();
    wordingChanged();
    await settle();
    expect(text(el("frInviteWordingMeta"))).toContain("Approved by fern@example.com on 03/10/2026.");
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(false);
    expect(el("frInviteHeld").hidden).toBe(true);
    expect((el("frInviteFirstName") as HTMLInputElement).value).toBe("Mary");
    expect((el("frInviteType") as HTMLSelectElement).value).toBe("memory");
    submit("#frInviteForm");
    await settle();
    expect(confirmed.pop()).toBe("Send an in memory invite to Mary Smith at mary@example.com, signed by Fern?");
    expect((sent("POST", "/api/admin/fundraising/invites")[0].body as Record<string, unknown>).type).toBe("memory");
    expect(text(el("frInviteStatus"))).toBe("Invite sent to Mary Smith.");
  });

  it("never approves or withdraws anything itself", async () => {
    await openFundraising();
    fillInvite("memory");
    await settle();
    approveMemory();
    wordingChanged();
    await settle();
    expect(calls.filter((c) => c.path.includes("/invite-wording/") && c.method !== "GET")).toHaveLength(0);
  });

  it("tells an editor that only an admin can approve it, with a link to read it", async () => {
    asRole("editor");
    await openFundraising();
    setValue("#frInviteType", "memory");
    await settle();
    expect(text(el("frInviteWordingMeta"))).toContain("Waiting for sign off. It won't send until an admin approves it.");
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(true);
    expect(text(el("frInviteHeldWords"))).toBe(WAITING + " Only an admin can approve it.");
    expect(text(el("frInviteHeldLink"))).toBe("Read it in All emails");
  });

  it("lets an editor send one once an admin has approved it", async () => {
    approveMemory();
    asRole("editor");
    await openFundraising();
    fillInvite("memory");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(false);
    expect(text(el("frInviteWordingMeta"))).toContain("Approved by fern@example.com on 03/10/2026.");
    expect(q("[data-frinvitewithdraw]")).toBeNull();
  });

  it("is held again when its approval is withdrawn in All emails", async () => {
    approveMemory();
    await openFundraising();
    setValue("#frInviteType", "memory");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(false);
    team.inviteWording = { approvals: {}, unavailable: false };
    wordingChanged();
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(true);
    expect(text(el("frInviteHeldWords"))).toBe(WAITING);
  });

  it("holds only the in memory type: choosing another lets it be sent again", async () => {
    await openFundraising();
    setValue("#frInviteType", "memory");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(true);
    setValue("#frInviteType", "team");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(false);
    expect(el("frInviteHeld").hidden).toBe(true);
  });

  it("is held when the sign offs could not be checked, saying so, with no link to approve it", async () => {
    const UNCHECKED = "We could not check the sign off just now. Try again in a moment.";
    team.inviteWording = { approvals: {}, unavailable: true };
    await openFundraising();
    fillInvite("memory");
    await settle();
    expect((el("frInviteSend") as HTMLButtonElement).disabled).toBe(true);
    expect(el("frInviteHeld").hidden).toBe(false);
    expect(text(el("frInviteHeld"))).toBe(UNCHECKED);
    expect(el("frInviteHeldLink").hidden).toBe(true);
    expect(text(el("frInvite"))).not.toContain("Approve it in All emails");
    expect(text(el("frInviteWordingMeta"))).toContain("Couldn't check sign-offs just now, so new wording is held.");
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe(UNCHECKED);
    expect(sent("POST", "/api/admin/fundraising/invites")).toHaveLength(0);
  });

  it("passes on the server's words if it refuses one all the same", async () => {
    approveMemory();
    answers["POST /api/admin/fundraising/invites"] = { status: 409, body: { error: SERVER_WAITING } };
    await openFundraising();
    fillInvite("memory");
    await settle();
    submit("#frInviteForm");
    await settle();
    expect(text(el("frInviteStatus"))).toBe(SERVER_WAITING);
  });
});

describe("invites not taken up", () => {
  it("shows what each was invited to do, and nothing for one from before", async () => {
    team.invites = [
      { ...team.invites[0], id: 8, name: "Mary Smith", type: "memory" },
      { ...team.invites[0], id: 9, name: "Sky Sample", type: "team" },
      { ...team.invites[0], id: 10, name: "Jo Sample", type: "event" },
      { ...team.invites[0], id: 11, name: "Robin Sample", type: "raising" },
      team.invites[0],
    ];
    await openFundraising();
    const pill = (id: number) => text(q(`#frInvites [data-frinvite="${id}"] .fr-invite-type`));
    expect([pill(8), pill(9), pill(10), pill(11)]).toEqual(["In memory", "A team", "Hosting an event", "Raising money"]);
    expect(q('#frInvites [data-frinvite="7"] .fr-invite-type')).toBeNull();
  });

  it("says the type when asking about a resend, and sends no type: the server keeps it", async () => {
    team.invites = [{ ...team.invites[0], type: "memory" }];
    await openFundraising();
    (q('[data-frinviteresend="7"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe("Send the in memory invite to Alex Example again? The link in the first email stops working.");
    const resent = sent("POST", "/api/admin/fundraising/invites/7/resend");
    expect(resent).toHaveLength(1);
    expect(resent[0].body ?? {}).toEqual({});
  });


  it("lists each with who invited them and when, with Resend and Remove", async () => {
    await openFundraising();
    const item = q('#frInvites [data-frinvite="7"]')!;
    expect(text(item)).toContain("Alex Example");
    expect(text(item)).toContain("alex@example.com");
    expect(text(item)).toContain("Invited by Fern on 01/10/2026");
    expect(item.querySelector('[data-frinviteresend="7"]')).not.toBeNull();
    expect(item.querySelector('[data-frinviteremove="7"]')).not.toBeNull();
    expect(text(item)).not.toContain("Expired");
  });

  it("marks an invite whose link has expired, and still offers Resend", async () => {
    team.invites = [{ ...team.invites[0], expired: true }];
    await openFundraising();
    const item = q('#frInvites [data-frinvite="7"]')!;
    expect(item.querySelector(".fr-invite-expired")!.textContent).toBe("Expired");
    expect(text(item)).toContain("The link has expired. Resend to send a new one.");
    expect(item.querySelector('[data-frinviteresend="7"]')).not.toBeNull();
  });

  it("resends, after asking", async () => {
    await openFundraising();
    (q('[data-frinviteresend="7"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe("Send the invite to Alex Example again? The link in the first email stops working.");
    expect(sent("POST", "/api/admin/fundraising/invites/7/resend")).toHaveLength(1);
    expect(text(el("frInviteStatus"))).toBe("Sent again to Alex Example.");
    expect(text(q('[data-frinvite="7"]'))).toContain("sent again on 08/10/2026");
  });

  it("removes, after asking", async () => {
    await openFundraising();
    (q('[data-frinviteremove="7"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe("Remove the invite to Alex Example? Their link stops working.");
    expect(sent("DELETE", "/api/admin/fundraising/invites/7")).toHaveLength(1);
    expect(text(el("frInvites"))).toBe("Nobody is waiting to take up an invite.");
  });
});

// ---- Time to call ----

describe("Time to call", () => {
  it("shows the pill on each fundraiser with a call due", async () => {
    await openFundraising();
    expect(row(1)!.querySelector(".is-call-due")?.textContent).toBe("Time to call");
    expect(row(2)!.querySelector(".is-call-due")).toBeNull();
    expect(row(3)!.querySelector(".is-call-due")).not.toBeNull();
  });

  it("lists only the calls due under Calls due, with their number", async () => {
    await openFundraising();
    const chip = q('[data-frfilter="calls"]') as HTMLElement;
    expect(text(chip)).toBe("Calls due (2)");
    chip.click();
    await settle();
    expect(row(1)).not.toBeNull();
    expect(row(2)).toBeNull();
    expect(row(3)).not.toBeNull();
  });

  it("says when no calls are due", async () => {
    team.calls = {};
    await openFundraising();
    (q('[data-frfilter="calls"]') as HTMLElement).click();
    await settle();
    expect(text(el("frList"))).toBe("No calls due.");
  });

  it("records the call with an optional note, after asking", async () => {
    await openFundraising();
    await openRow(1);
    const panel = q("[data-frcalls]")!;
    expect(text(panel)).toContain("Time to call");
    expect(text(panel)).toContain("The call a week before is due since 29/11/2026.");
    setValue("#frCallNote", "All set for Saturday");
    (q('[data-frcall="before"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe("Record the call a week before Test Dash 1 as made today?\n\nThis is recorded against your name and clears the reminder.");
    expect(sent("POST", "/api/admin/fundraisers/1/calls")[0].body).toEqual({ which: "before", note: "All set for Saturday" });
    expect(text(q("[data-frcalls]"))).toContain("01/12/2026 by fern@example.com");
    expect(text(q("[data-frcalls]"))).toContain("All set for Saturday");
    expect(row(1)!.querySelector(".is-call-due")).toBeNull();
  });

  it("keeps a note to 500 characters", async () => {
    await openFundraising();
    await openRow(1);
    setValue("#frCallNote", "a".repeat(501));
    (q('[data-frcall="before"]') as HTMLElement).click();
    await settle();
    expect(text(el("frCallStatus"))).toBe("A note can be up to 500 characters.");
    expect(sent("POST", "/api/admin/fundraisers/1/calls")).toHaveLength(0);
  });

  it("lets a viewer see the calls, but not record one", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(text(q("[data-frcalls]"))).toContain("Time to call");
    expect(q("[data-frcall]")).toBeNull();
  });
});

// ---- Take off Get involved? ----

describe("Take off Get involved?", () => {
  it("shows the pill four weeks after the date", async () => {
    await openFundraising();
    expect(text(row(3)!.querySelector(".fr-offlist-pill"))).toBe("Take off Get involved?");
    expect(row(1)!.querySelector(".fr-offlist-pill")).toBeNull();
  });

  it("takes it off the list after asking, keeping its page", async () => {
    await openFundraising();
    await openRow(3);
    const panel = q("[data-frofflist]")!;
    expect(text(panel)).toContain("It is four weeks past its date.");
    (q('[data-frlist="off"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe(
      "Take Test Dash 3 off Get involved? It comes off the list only: its page and giving link keep working, so late gifts still count.",
    );
    expect(sent("POST", "/api/admin/fundraisers/3/off-list")).toHaveLength(1);
    expect(text(q("[data-frofflist]"))).toContain("Taken off Get involved");
    expect(q('[data-frlist="on"]')).not.toBeNull();
    expect(row(3)!.querySelector(".fr-offlist-pill")).toBeNull();
    expect(text(row(3))).toContain("Off Get involved");
  });

  it("says why when the organiser has finished", async () => {
    records[0] = fundraiser(1, { finishedRequestedAt: "2026-11-30T10:00:00.000Z" });
    team.prompts = { "1": "finished" };
    await openFundraising();
    await openRow(1);
    expect(text(q("[data-frofflist]"))).toContain("They say they've finished.");
  });

  it("puts it back", async () => {
    records[2] = fundraiser(3, { eventDate: "2026-10-01", offListAt: "2026-11-01T10:00:00.000Z", offListBy: "admin:fern@example.com" });
    team.prompts = {};
    await openFundraising();
    await openRow(3);
    (q('[data-frlist="on"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/3/on-list")).toHaveLength(1);
  });

  it("leaves Mark finished as it was", async () => {
    await openFundraising();
    await openRow(3);
    (q('[data-fraction="finish"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/3/finish")).toHaveLength(1);
  });

  it("is not offered to a viewer", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(3);
    expect(q("[data-frlist]")).toBeNull();
  });
});

// ---- the Weekly summary ----

describe("the Weekly summary card", () => {
  it("is for admins only", async () => {
    asRole("editor");
    await openFundraising();
    expect(el("frSummary").hidden).toBe(true);
    expect(sent("GET", "/api/admin/fundraising/summary")).toHaveLength(0);
  });

  it("shows who gets it and when it last went", async () => {
    await openFundraising();
    expect(el("frSummary").hidden).toBe(false);
    expect(text(el("frSummaryState"))).toBe("On. It goes to 1 person at 8am on Mondays. The last one went on 30/11/2026.");
    expect(text(el("frSummaryList"))).toContain("fern@example.com");
  });

  it("adds an address and saves the list", async () => {
    await openFundraising();
    setValue("#frSummaryEmail", "Rowan@Example.com");
    (q("#frSummaryAdd") as HTMLElement).click();
    await settle();
    expect(sent("PUT", "/api/admin/fundraising/summary")[0].body).toEqual({ recipients: ["fern@example.com", "rowan@example.com"] });
    expect(text(el("frSummaryList"))).toContain("rowan@example.com");
    expect(text(el("frSummaryStatus"))).toBe("Saved. rowan@example.com gets the next one.");
  });

  it("refuses an address that is not whole, or already there", async () => {
    await openFundraising();
    setValue("#frSummaryEmail", "rowan@");
    (q("#frSummaryAdd") as HTMLElement).click();
    await settle();
    expect(text(el("frSummaryStatus"))).toBe("That isn't a whole email address.");
    setValue("#frSummaryEmail", "fern@example.com");
    (q("#frSummaryAdd") as HTMLElement).click();
    await settle();
    expect(text(el("frSummaryStatus"))).toBe("That address is already on the list.");
    expect(sent("PUT", "/api/admin/fundraising/summary")).toHaveLength(0);
  });

  it("removes an address after asking", async () => {
    await openFundraising();
    (q('[data-frsummaryremove="fern@example.com"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toBe("Stop sending the Monday summary to fern@example.com?");
    expect(sent("PUT", "/api/admin/fundraising/summary")[0].body).toEqual({ recipients: [] });
    expect(text(el("frSummaryState"))).toBe("Off. Nobody is on the list, so no summary goes.");
  });

  it("sends a test to the admin asking", async () => {
    await openFundraising();
    (q("#frSummaryTest") as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraising/summary/test")).toHaveLength(1);
    expect(text(el("frSummaryStatus"))).toBe("A test is on its way to fern@example.com.");
  });
});

describe("nothing else on the screen moves", () => {
  it("keeps the switch, the filters and the list as they were", async () => {
    await openFundraising();
    expect(text(el("frSwitchState"))).toMatch(/^Yes\./);
    // TASK-505 added Requests to do and Buckets not back, after Calls due.
    expect(qa("[data-frfilter]").map((b) => b.getAttribute("data-frfilter"))).toEqual(["", "new", "approved", "declined", "finished", "calls", "requests", "notback", "packs"]); // welcome packs added Packs to send
    expect(qa("#frList tr.fx-summary")).toHaveLength(3);
  });
});
