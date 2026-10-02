// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-507: "Thank yous to check" on Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-requests-page.test.ts): the pill on the list, and in the open sign up each thank
// you the organiser sent, with its words, the gifts it picked and what happened to each, Approve and
// send, and Don't send with a reason kept for staff. A fake fetch stands in for the API
// (src/routes/fundraiser-thanks.ts). Every person, place and number is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false };
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
    eventDate: "2026-12-12",
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
    wants: { ...NONE },
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

type View = Record<string, unknown>;

function recipient(donationId: number, name: string, outcome: string, outcomeWords: string) {
  return { donationId, name, amountPence: 2000, outcome, outcomeWords, sentAt: null };
}
function thanksItem(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    fundraiserId: 1,
    message: "Thank you so much, everyone! " + id,
    status: "pending",
    statusWords: "Waiting for us to check",
    createdAt: "2026-11-24T10:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    rejectReason: null,
    deliveredAt: null,
    gifts: 2,
    waiting: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    recipients: [],
    ...over,
  };
}
function view(kind: string, over: Record<string, unknown> = {}): View {
  const info: Record<string, [string, string, string]> = {
    posters: ["printed", "Posters", "to_send"],
    buckets: ["lent", "Collection buckets", "to_send"],
    shout_out: ["shout_out", "Social media shout out", "to_do"],
    attend: ["attend", "Someone from NBCC to come along", "to_arrange"],
  };
  const [group, label, status] = info[kind];
  const labels: Record<string, string> = { to_send: "To send", sent: "Sent", with_them: "With them", back: "Back", to_do: "To do", done: "Done", to_arrange: "To arrange", arranged: "Arranged" };
  const v: View = {
    kind,
    group,
    label,
    asked: group === "printed" || group === "lent" ? 10 : null,
    status,
    statusLabel: labels[status],
    quantity: null,
    quantityBack: null,
    how: null,
    sentOn: null,
    backOn: null,
    doneOn: null,
    handledBy: null,
    going: null,
    note: null,
    backNote: null,
    link: null,
    dueOn: null,
    dueBack: false,
    outstanding: true,
    noPermission: false,
    actions: [group === "printed" ? "send" : group === "lent" ? "out" : group === "attend" ? "arrange" : "done"],
    updatedAt: null,
    updatedBy: null,
    ...over,
  };
  if (over.status && !over.statusLabel) v.statusLabel = labels[String(over.status)];
  return v;
}

// ---- the stand in server ----

let records: Rec[] = [];
let reqs: { today: string; requests: Record<string, View[]>; toDo: Record<string, true>; notBack: Record<string, true>; totals: Record<string, unknown> };
let reqsFail = false;
let perms: PermissionMap;
let role = "admin";
let calls: { method: string; path: string; body: unknown }[] = [];
let answers: Record<string, { status: number; body: unknown }> = {};
let history: Array<Record<string, unknown>> = [];
// TASK-507
let thanksCounts: Record<string, number> = {};
let thanksBy: Record<string, Array<Record<string, unknown>>> = {};
let thanksFail = false;

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
  calls.push({ method, path, body });
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
  if (path === "/api/admin/fundraising/team") {
    return j({ today: "2026-12-07", me: 3, calls: {}, prompts: {}, invites: [], signers: [{ id: 3, firstName: "Fern" }, { id: 5, firstName: "Rowan" }] });
  }
  if (path === "/api/admin/fundraising/summary") return j({ recipients: [], lastWeek: null });
  if (path === "/api/admin/fundraising/requests") {
    if (reqsFail) return j({ error: "Admin is temporarily unavailable" }, 500);
    return j(JSON.parse(JSON.stringify(reqs)));
  }
  if (path === "/api/admin/fundraising/thanks-waiting") return j({ counts: thanksCounts });
  const t = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/thanks(?:\/(\d+)\/(approve|reject))?$/);
  if (t) {
    if (method === "GET") return thanksFail ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ thanks: JSON.parse(JSON.stringify(thanksBy[t[1]] || [])) });
    const one = (thanksBy[t[1]] || []).find((x) => String(x.id) === t[2])!;
    if (t[3] === "approve") Object.assign(one, { status: "approved", statusWords: "Sending now", waiting: one.gifts });
    if (t[3] === "reject") Object.assign(one, { status: "rejected", statusWords: "Not sent", rejectReason: body.reason || null });
    delete thanksCounts[t[1]];
    return j({ thanks: one });
  }
  const r = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/requests\/([a-z_]+)$/);
  if (r && method === "POST") {
    const list = reqs.requests[r[1]] || [];
    const v = list.find((x) => x.kind === r[2])!;
    if (body.action === "send") Object.assign(v, { status: "sent", statusLabel: "Sent", sentOn: body.on, how: body.how, handledBy: body.by, quantity: body.quantity, note: body.note || null, outstanding: false, actions: ["count", "undo"] });
    if (body.action === "back") Object.assign(v, { status: "back", statusLabel: "Back", backOn: body.on, quantityBack: body.quantity, backNote: body.note || null, dueBack: false, actions: ["undo"] });
    if (body.action === "undo") Object.assign(v, { status: "to_send", statusLabel: "To send", sentOn: null, how: null, handledBy: null, quantity: null, outstanding: true, actions: ["send"] });
    delete reqs.toDo[r[1]];
    return j({ row: {}, words: "Posters: sent (dropped off)" });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((x) => x.id === id)!;
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history });
  return j({ error: "not here" }, 404);
}

// ---- driving the page ----

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) await flush();
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
function setValue(sel: string, value: string) {
  const input = q(sel) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

let confirmAnswer = true;
let confirmed: string[] = [];

function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}

beforeEach(() => {
  records = [
    fundraiser(1, { wants: { ...NONE, posterCount: 10, bucketCount: 2, shoutOut: true } }),
    fundraiser(2),
    fundraiser(3, { wants: { ...NONE, bucketCount: 2 } }),
  ];
  reqs = {
    today: "2026-12-07",
    requests: {
      "1": [
        view("posters"),
        view("buckets", { asked: 2, status: "with_them", quantity: 2, sentOn: "2026-11-20", handledBy: "Fern", dueOn: "2026-12-26", outstanding: false, actions: ["back", "undo"] }),
        view("shout_out", { noPermission: true, outstanding: false, actions: [] }),
      ],
      "3": [view("buckets", { asked: 2, status: "with_them", quantity: 2, sentOn: "2026-11-01", dueOn: "2026-11-29", dueBack: true, outstanding: false, actions: ["back", "undo"] })],
    },
    toDo: { "1": true },
    notBack: { "1": true, "3": true },
    totals: {},
  };
  reqsFail = false;
  history = [];
  thanksCounts = { "1": 1 };
  thanksFail = false;
  thanksBy = {
    "1": [
      thanksItem(5, { recipients: [recipient(41, "Alex Example", "waiting", "Waiting for you to check"), recipient(42, "Jo Bloggs", "waiting", "Waiting for you to check")] }),
      thanksItem(4, {
        status: "approved",
        statusWords: "Sent to 1 supporter",
        deliveredAt: "2026-11-25T10:05:00.000Z",
        decidedBy: "admin:rowan@example.com",
        sent: 1,
        skipped: 1,
        recipients: [
          recipient(31, "Sam Giver", "sent", "Sent"),
          recipient(32, "Kit Giver", "skipped", "Not sent: On the do not email list (a bounce, a complaint, or stopped by staff)"),
        ],
      }),
    ],
  };
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

// ---- the list ----

const panel = () => q("[data-frthanks-panel]");
const thanksLi = (id: number) => q(`[data-frthanksitem="${id}"]`);

describe("Thank yous to check", () => {
  it("shows the pill on a sign up with a thank you waiting, and not on the others", async () => {
    await openFundraising();
    expect(text(row(1)!.querySelector(".fr-thanksto-pill"))).toBe("Thank yous to check");
    expect(row(2)!.querySelector(".fr-thanksto-pill")).toBeNull();
  });

  it("shows each thank you in the open sign up: its words, the gifts it picked and where each is up to", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(panel()!.querySelector("h4"))).toBe("Thank yous to supporters");
    const waiting = thanksLi(5)!;
    expect(text(waiting)).toContain("Waiting for you to check");
    expect(text(waiting)).toContain("Thank you so much, everyone! 5");
    expect(text(waiting)).toContain("for 2 gifts");
    expect(text(waiting)).toContain("Alex Example");
    expect(text(waiting)).toContain("Jo Bloggs");
    const done = thanksLi(4)!;
    expect(text(done)).toContain("Sent to 1 of 2");
    expect(text(done)).toContain("decided by rowan@example.com");
    expect(text(done)).toContain("Sam Giver");
    expect(text(done)).toContain("Not sent: On the do not email list");
    // Only the waiting one has the buttons.
    expect(waiting.querySelector('[data-frthanks="approve"]')).not.toBeNull();
    expect(done.querySelector('[data-frthanks="approve"]')).toBeNull();
  });

  it("lists the waiting one first", async () => {
    thanksBy["1"].reverse();
    await openFundraising();
    await openRow(1);
    const items = Array.from(document.querySelectorAll("[data-frthanksitem]")).map((n) => n.getAttribute("data-frthanksitem"));
    expect(items).toEqual(["5", "4"]);
  });

  it("approves and sends, after asking, and then reads it again", async () => {
    await openFundraising();
    await openRow(1);
    (thanksLi(5)!.querySelector('[data-frthanks="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toContain("Approve and send this thank you?");
    expect(sent("POST", "/api/admin/fundraisers/1/thanks/5/approve")).toHaveLength(1);
    expect(text(el("frThanksStatus"))).toContain("Approved. The emails are going now");
    expect(text(thanksLi(5))).toContain("Sending now");
    expect(row(1)!.querySelector(".fr-thanksto-pill")).toBeNull();
  });

  it("sends nothing when the question is answered No", async () => {
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (thanksLi(5)!.querySelector('[data-frthanks="approve"]') as HTMLElement).click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/thanks/5/approve")).toHaveLength(0);
  });

  it("does not send, with the reason typed kept for staff", async () => {
    await openFundraising();
    await openRow(1);
    setValue('[data-frthanksreason="5"]', "Names a giver in full");
    (thanksLi(5)!.querySelector('[data-frthanks="reject"]') as HTMLElement).click();
    await settle();
    expect(confirmed[0]).toContain("Not send this thank you?");
    expect(sent("POST", "/api/admin/fundraisers/1/thanks/5/reject")[0].body).toEqual({ reason: "Names a giver in full" });
    expect(text(thanksLi(5))).toContain("Not sent");
    expect(text(thanksLi(5))).toContain("Our reason, for staff only: Names a giver in full");
  });

  it("gives a viewer no buttons", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(text(thanksLi(5))).toContain("Thank you so much, everyone! 5");
    expect(panel()!.querySelector("[data-frthanks]")).toBeNull();
  });

  it("escapes what the organiser wrote", async () => {
    thanksBy["1"][0].message = "<img src=x onerror=alert(1)>";
    await openFundraising();
    await openRow(1);
    expect(panel()!.querySelector("img")).toBeNull();
    expect(text(thanksLi(5))).toContain("<img src=x onerror=alert(1)>");
  });

  it("says so when there are none", async () => {
    await openFundraising();
    await openRow(2);
    expect(text(panel())).toContain("No thank yous yet.");
  });

  it("says so when they cannot load, leaving the rest of the sign up working", async () => {
    thanksFail = true;
    await openFundraising();
    await openRow(1);
    expect(text(panel())).toContain("The thank yous could not load just now.");
    expect(text(q('[data-frdetail="1"]'))).toContain("What they would like");
  });

  it("reads them afresh when the sign up is closed and opened again, to show how many went", async () => {
    await openFundraising();
    await openRow(1);
    const before = sent("GET", "/api/admin/fundraisers/1/thanks").length;
    await openRow(1); // closes it
    thanksBy["1"][1].statusWords = "Sent to 2 supporters";
    Object.assign(thanksBy["1"][1], { sent: 2, skipped: 0 });
    await openRow(1); // opens it again
    expect(sent("GET", "/api/admin/fundraisers/1/thanks").length).toBe(before + 1);
    expect(text(thanksLi(4))).toContain("Sent to 2 of 2");
  });

  it("names thank yous in the history", async () => {
    history = [
      { action: "fundraiser.thanks_posted", actor: "organiser", createdAt: "2026-11-24T10:00:00.000Z", data: { thanksId: 5, gifts: 2 } },
      { action: "fundraiser.thanks_delivered", actor: "system", createdAt: "2026-11-25T10:05:00.000Z", data: { thanksId: 4, sent: 1, skipped: 1, failed: 0 } },
      { action: "fundraiser.thanks_rejected", actor: "admin:fern@example.com", createdAt: "2026-11-25T10:00:00.000Z", data: { thanksId: 3, reason: "Too long" } },
      { action: "fundraiser.thanks_approved", actor: "admin:fern@example.com", createdAt: "2026-11-25T10:00:00.000Z", data: { thanksId: 4 } },
    ];
    await openFundraising();
    await openRow(1);
    const h = text(el("frHistory"));
    expect(h).toContain("The organiser sent a thank you to check, for 2 gifts");
    expect(h).toContain("Thank you emails done: 1 sent, 1 not sent");
    expect(h).toContain("Thank you not sent: Too long");
    expect(h).toContain("Thank you approved and sent");
  });
});
