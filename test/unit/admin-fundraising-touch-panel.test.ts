// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-515: Admin > Fundraising > Automatic emails and the smart call prompts, in the admin's jsdom
// harness (as admin-fundraising-thanks-panel.test.ts). The card has the switch (admins only) and what
// the next 8am run would send; reading and approving the emails themselves moved to the All emails
// card (assets/js/admin/all-emails.js, test/unit/admin-all-emails-panel.test.ts), which this card
// and each fundraiser's "Read its automatic emails" button open. The list shows a pill for each
// prompt; the open sign up shows each prompt's reason and talking points with Called, and which
// automatic emails it has had. A fake fetch stands in for the API. Every name is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const allEmailsSrc = readFileSync(resolve(ROOT, "assets/js/admin/all-emails.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
type Rec = Record<string, unknown> & { id: number };
function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "test-dash-" + id, path: "raising", kind: "santa_dash", kindLabel: "A Santa dash", title: "Test Dash " + id,
    description: "Running round the park.", eventDate: "2026-12-12", startTime: "10:30", venue: "The Bandstand", town: "Testtown",
    targetPence: 25000, public: true, status: "approved", name: "Robin Example", email: "robin@example.com", phone: "07700 900123",
    socialLink: null, socialOk: false, wants: { ...NONE }, postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null,
    createdAt: "2026-09-20T10:00:00.000Z", approvedAt: "2026-09-21T10:00:00.000Z", approvedBy: "admin:fern@example.com",
    updatedAt: "2026-09-21T10:00:00.000Z", updatedBy: null, pageUrl: "https://nbcc.scot/fundraise/test-dash-" + id,
    finishedRequestedAt: null, offListAt: null, offListBy: null, ...over,
  };
}
const meter = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 25000, percent: 0, barPercent: 0, overTarget: false };

const KINDS = [
  ["first_gift", "Your first gift is in", false],
  ["halfway", "You’re halfway there", false],
  ["target", "You did it, target reached", true],
  ["week_before", "One week to go", false],
  ["week_after", "How did it go?", false],
  ["finished", "Thank you, from all of us", false],
  ["year_on", "A year ago today", false],
  ["need_a_hand", "Need a hand?", true],
  ["on_track", "You’re doing great", true],
].map(([kind, label, newWording]) => ({ kind: kind as string, label: label as string, when: "When it goes.", newWording }));

// Signing off the new wording (Jaimie, 2026-10-03): each version of an email that needs it, and the
// ones approved so far (as seeded: target, need a hand, on track).
const NEW_KINDS = ["target", "finished", "need_a_hand", "on_track"];
const ZERO_KINDS = ["week_after", "finished", "year_on"];
const keysOf = (kind: string) => [...(NEW_KINDS.includes(kind) ? [kind] : []), ...(ZERO_KINDS.includes(kind) ? [kind + "_zero"] : [])];
let approved: Record<string, { approvedAt: string; approvedBy: string }> = {};
let approvalsUnavailable = false;
let touchFails = false;

const BEHIND = {
  key: "behind",
  pill: "Behind",
  label: "Behind",
  reason: "Its date is 5 days away and it has raised £20 of its £250 target, under a third.",
  points: ["Offer posters and leaflets to put up.", "Offer a shout out on our social media.", "Offer someone from NBCC to come along on the day."],
};

let records: Rec[] = [];
let perms: PermissionMap;
let role = "admin";
let calls: { method: string; path: string; query: string; body: unknown }[] = [];
let touchOn = false;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const [path, query = ""] = url.split("?");
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, query, body });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraisers" && method === "GET") {
    // The list gives a team page its whole team's total (withTeamTotals), as the daily run reads it.
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter: (f.listMeter as typeof meter) || meter, editWaiting: false })) });
  }
  if (path === "/api/admin/fundraising/team") return j({ today: "2026-12-07", me: 3, calls: {}, prompts: {}, invites: [], signers: [] });
  if (path === "/api/admin/fundraising/summary") return j({ recipients: [], lastWeek: null });
  if (path === "/api/admin/fundraising/requests") return j({ today: "2026-12-07", requests: {}, toDo: {}, notBack: {}, totals: {} });
  if (path === "/api/admin/fundraising/thanks-waiting") return j({ counts: {} });
  if (path === "/api/admin/fundraising/news-waiting") return j({ counts: {} });
  if (path === "/api/admin/fundraising/touch") {
    if (touchFails) return j({ error: "Admin is temporarily unavailable" }, 500);
    return j({
      today: "2026-12-07",
      settings: { on: touchOn, updatedAt: touchOn ? "2026-12-01T09:00:00.000Z" : null, updatedBy: touchOn ? "admin:fern@example.com" : null },
      kinds: KINDS.map((k) => ({ ...k, waiting: keysOf(k.kind).filter((key) => !approved[key]) })),
      approvals: approved,
      approvalsUnavailable,
      sent: { "1": [{ kind: "first_gift", sentAt: "2026-11-20T08:00:00.000Z" }] },
      prompts: { "1": [BEHIND] },
      promptCalls: {},
      due: { "1": "need_a_hand", "2": "halfway" },
    });
  }
  if (path === "/api/admin/fundraising/emails/summary") return j({ count: 3, waiting: 1, approvalsUnavailable });
  if (path === "/api/admin/fundraising/emails") {
    const one = (id: string, kind: string, name: string) => ({
      id, name, subject: "Subject for " + kind, who: "Goes to the fundraiser.", audience: "public", note: null, touchKind: kind,
      state: null, waitingVersion: null, versions: [{ id: "usual", label: "The usual one", approval: null }],
    });
    return j({
      count: 3,
      waiting: 0,
      approvalsUnavailable,
      groups: [
        { id: "touch", name: "Keeping in touch (automatic)", emails: [one("touch-first-gift", "first_gift", "Your first gift is in"), one("touch-need-a-hand", "need_a_hand", "Need a hand?")] },
        { id: "finishing", name: "Finishing and paying in", emails: [one("touch-finished", "finished", "Thank you, from all of us")] },
      ],
    });
  }
  const pv = path.match(/^\/api\/admin\/fundraising\/touch\/preview\/([a-z_]+)$/);
  if (pv) {
    const forId = new URLSearchParams(query).get("fundraiserId");
    const title = forId ? "Test Dash " + forId : "Sam's Santa Dash";
    const zero = new URLSearchParams(query).get("sample") === "zero";
    const key = zero && ZERO_KINDS.includes(pv[1]) ? pv[1] + "_zero" : NEW_KINDS.includes(pv[1]) ? pv[1] : null;
    return j({
      kind: pv[1],
      label: KINDS.find((k) => k.kind === pv[1])!.label,
      newWording: key !== null,
      wordingKey: key,
      approval: (key && approved[key]) || null,
      approvalsUnavailable,
      sample: !forId,
      title,
      subject: "Subject for " + pv[1],
      html: "<!doctype html><html><body><p>Email body for " + pv[1] + " about " + title + "</p></body></html>",
      text: "Text for " + pv[1],
    });
  }
  const ap = path.match(/^\/api\/admin\/fundraising\/touch\/approvals\/([a-z_]+)$/);
  if (ap && method === "POST") {
    approved[ap[1]] = { approvedAt: "2026-12-07T09:00:00.000Z", approvedBy: "admin:fern@example.com" };
    return j({ approval: { key: ap[1], ...approved[ap[1]] } });
  }
  if (ap && method === "DELETE") {
    delete approved[ap[1]];
    return j({ withdrawn: true });
  }
  if (path === "/api/admin/fundraising/touch/settings" && method === "PUT") {
    touchOn = !!body.on;
    return j({ on: touchOn, updatedAt: "2026-12-07T09:00:00.000Z", updatedBy: "admin:fern@example.com" });
  }
  const pc = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/prompt-calls$/);
  if (pc && method === "POST") return j({ call: { prompt: body.prompt, calledAt: "2026-12-07T10:00:00.000Z", calledBy: "fern@example.com", note: body.note || null } });
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const f = records.find((x) => x.id === Number(m[1]))!;
  const rest = m[2] || "";
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/news") return j({ updates: [] });
  if (rest === "/thanks") return j({ thanks: [] });
  return j({ error: "not here" }, 404);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
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

let confirmAnswer = true;
let confirmed: string[] = [];
function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

beforeEach(() => {
  records = [fundraiser(1), fundraiser(2), fundraiser(3, { path: "event", title: "Test Coffee Morning" })];
  touchOn = false;
  approvalsUnavailable = false;
  touchFails = false;
  approved = Object.fromEntries(["target", "need_a_hand", "on_track"].map((k) => [k, { approvedAt: "2026-10-03T11:00:00.000Z", approvedBy: "Jaimie" }]));
  asRole("admin");
  calls = [];
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
  // eslint-disable-next-line no-eval
  (0, eval)(allEmailsSrc);
});

describe("the Automatic emails card", () => {
  it("says they are off, and that each one is read in All emails", async () => {
    await openFundraising();
    expect(el("frTouch").hidden).toBe(false);
    expect(text(el("frTouchState"))).toBe("Off. None of these is sent. Read each one in All emails, then switch them on when you are happy.");
  });

  it("no longer shows the emails itself: no tabs, no preview, and none is fetched", async () => {
    await openFundraising();
    for (const id of ["frTouchKinds", "frTouchFor", "frTouchMeta", "frTouchPreview", "frTouchPreviewWrap"]) expect(document.getElementById(id), id).toBeNull();
    expect(text(el("frTouch"))).not.toContain("Read them");
    expect(calls.filter((c) => c.path.startsWith("/api/admin/fundraising/touch/preview/"))).toHaveLength(0);
  });

  it("has a button that opens All emails at Keeping in touch (automatic)", async () => {
    await openFundraising();
    const link = q('#frTouch [data-allemails-open="touch"]') as HTMLButtonElement;
    expect(link.tagName).toBe("BUTTON");
    expect(text(link)).toBe("Read and approve these in All emails");
    expect(text(el("frTouch"))).toContain("The two that go after their date, “How did it go?” and the thank you when you mark them finished, are under “Finishing and paying in”.");
    link.click();
    await settle();
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
    expect((q('[data-emails-group="touch"]') as HTMLDetailsElement).open).toBe(true);
    expect((q('[data-emails-group="finishing"]') as HTMLDetailsElement).open).toBe(false);
  });

  it("says what the next 8am run would send, so the first morning is no surprise", async () => {
    await openFundraising();
    expect(text(el("frTouchDue"))).toBe(
      "Switched on now, the next 8am run would send up to 2 emails: You’re halfway there (1), Need a hand? (1). Anyone who has asked us to stop is left out.",
    );
    await openRow(1);
    expect(text(q("[data-frtouchnext]"))).toBe("Next: Need a hand?, once automatic emails are switched on.");
  });

  it("“Read its automatic emails” on a fundraiser opens All emails for them, on the email due next", async () => {
    await openFundraising();
    await openRow(1);
    const btn = q('[data-frtouch-panel] [data-allemails-open="touch"]') as HTMLButtonElement;
    expect(text(btn)).toBe("Read its automatic emails");
    btn.click();
    await settle();
    expect((el("frAllEmailsFold") as HTMLDetailsElement).open).toBe(true);
    // Fundraiser 1 is due "Need a hand?" next: that is the email opened, as it would go to them today.
    const last = calls.filter((c) => c.path === "/api/admin/fundraising/touch/preview/need_a_hand").pop()!;
    expect(last.query).toBe("fundraiserId=1");
    const panel = q('[data-email="touch-need-a-hand"] .fr-emails-panel') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector("iframe")!.getAttribute("srcdoc")).toContain("about Test Dash 1");
    expect(text(panel)).toContain("For Test Dash 1, as it would go today.");
    // "Show it for" lists the example, then the pages raising money (never the event).
    const pick = panel.querySelector("select[data-emails-for]") as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.value)).toEqual(["", "1", "2"]);
    expect(pick.value).toBe("1");
  });

  it("is not offered on an event, which gets no automatic emails", async () => {
    await openFundraising();
    await openRow(3);
    expect(q("[data-frtouch-panel] [data-allemails-open]")).toBeNull();
    expect(text(q("[data-frtouch-panel]"))).toContain("Automatic emails only go to public pages raising money.");
  });

  it("reads what is due again when a sign off changes in All emails", async () => {
    await openFundraising();
    const before = sent("GET", "/api/admin/fundraising/touch").length;
    el("frAllEmails").dispatchEvent(new CustomEvent("nbcc:wording-changed", { bubbles: true, detail: { key: "finished" } }));
    await settle();
    expect(sent("GET", "/api/admin/fundraising/touch").length).toBe(before + 1);
  });

  it("lets an admin switch them on, after a warning", async () => {
    await openFundraising();
    const btn = el("frTouchSwitch");
    expect(btn.hidden).toBe(false);
    expect(text(btn)).toBe("Switch automatic emails on");
    btn.click();
    await settle();
    expect(confirmed[0]).toMatch(/real organisers/);
    expect(sent("PUT", "/api/admin/fundraising/touch/settings")[0].body).toEqual({ on: true });
    expect(text(el("frTouchState"))).toContain("On.");
  });

  it("sends nothing when the warning is cancelled", async () => {
    confirmAnswer = false;
    await openFundraising();
    el("frTouchSwitch").click();
    await settle();
    expect(sent("PUT", "/api/admin/fundraising/touch/settings")).toHaveLength(0);
  });

  it("shows an editor the card but not the switch", async () => {
    asRole("editor");
    await openFundraising();
    expect(el("frTouch").hidden).toBe(false);
    expect(el("frTouchSwitch").hidden).toBe(true);
    expect(el("frTouchSwitchNote").hidden).toBe(false);
  });
});

describe("signing off the new wording (Jaimie, 2026-10-03)", () => {
  it("says in the card that new wording only sends once approved", async () => {
    await openFundraising();
    expect(text(el("frTouch"))).toContain("Read every one in All emails before switching them on. New wording only sends once it's approved there.");
  });

  it("has no approve or withdraw button of its own: those are in All emails", async () => {
    await openFundraising();
    expect(text(el("frTouch"))).not.toMatch(/Approve this wording|Withdraw approval/);
    expect(appSrc).not.toMatch(/data-frtouchapprove|data-frtouchwithdraw|data-frtouchkind|data-frtouchshow/);
  });

  it("says before Mark finished that the thank you waits for its wording to be approved", async () => {
    confirmAnswer = false;
    touchOn = true;
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="finish"]') as HTMLElement).click();
    expect(confirmed.pop()).toContain("its new wording is waiting for your sign off");
  });
});

describe("review: sign offs, team totals and an unread card", () => {
  it("says before Mark finished that a team page's thank you goes, judged on the whole team's total", async () => {
    // The team page itself has raised nothing (its own meter); its members £500 (the list's meter).
    // The usual thank you is approved, its nothing raised version is not: the team total decides.
    approved.finished = { approvedAt: "2026-12-01T09:00:00.000Z", approvedBy: "admin:fern@example.com" };
    records = [fundraiser(1, { isTeam: true, title: "Team Dash", listMeter: { ...meter, raisedPence: 50000, onlinePence: 50000 } })];
    touchOn = true;
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="finish"]') as HTMLElement).click();
    expect(confirmed.pop()).toContain("Automatic emails are on, so we email Robin Example their thank you");
  });

  it("does not claim the thank you goes when the automatic emails could not load", async () => {
    touchFails = true;
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="finish"]') as HTMLElement).click();
    const said = confirmed.pop()!;
    expect(said).toContain("If its wording is still waiting for sign off, the thank you is held until you approve it.");
    expect(said).not.toContain("so we email");
  });

  it("says when the sign offs could not be checked", async () => {
    approvalsUnavailable = true;
    approved = {};
    await openFundraising();
    expect(text(el("frTouch"))).toContain("Couldn't check sign-offs just now, so new wording is held.");
  });
});

describe("the call prompts", () => {
  it("puts a pill on the list for each prompt", async () => {
    await openFundraising();
    expect(text(row(1)!.querySelector('[data-frprompt-pill="behind"]'))).toBe("Behind");
    expect(row(2)!.querySelector("[data-frprompt-pill]")).toBeNull();
  });

  it("shows the reason and the talking points in the open sign up, and records a call with a note", async () => {
    await openFundraising();
    await openRow(1);
    const li = q('[data-frprompt="behind"]')!;
    expect(text(li)).toContain("under a third");
    expect(text(li)).toContain("Offer a shout out on our social media.");
    const note = q('[data-frpromptnote="behind"]') as HTMLTextAreaElement;
    note.value = "Sending posters";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    (q('[data-frpromptcall="behind"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/prompt-calls")[0].body).toEqual({ prompt: "behind", note: "Sending posters" });
  });

  it("gives a viewer the prompts but no Called button", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(q('[data-frprompt="behind"]')).not.toBeNull();
    expect(q('[data-frpromptcall="behind"]')).toBeNull();
  });

  it("says, before Mark finished, whether the organiser is emailed their thank you", async () => {
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (q('[data-fraction="finish"]') as HTMLElement).click();
    expect(confirmed.pop()).toContain("Automatic emails are off, so no thank you email goes.");
    // Switched on meanwhile, with its wording approved: opening Fundraising again reads it afresh
    // (the sign up stays open).
    touchOn = true;
    for (const k of ["finished", "finished_zero"]) approved[k] = { approvedAt: "2026-12-01T09:00:00.000Z", approvedBy: "admin:fern@example.com" };
    (q('.admin-nav-link[data-view="fundraising"]') as HTMLElement).click();
    await settle();
    (q('[data-fraction="finish"]') as HTMLElement).click();
    expect(confirmed.pop()).toContain("Automatic emails are on, so we email Robin Example their thank you, with their certificate.");
  });

  it("lists which automatic emails a fundraiser has had, and when", async () => {
    await openFundraising();
    await openRow(1);
    const sentList = text(q("[data-frtouchsent]"));
    expect(sentList).toContain("Your first gift is in");
    expect(sentList).toContain("20/11/2026");
  });
});
