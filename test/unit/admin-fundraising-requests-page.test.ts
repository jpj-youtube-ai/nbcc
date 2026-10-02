// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-505: the Requests part of each sign up on Admin > Fundraising, in the admin's jsdom harness
// (as admin-fundraising-team-page.test.ts): where each request is up to, moving one on with a small
// form, Undo, the "Requests to do" and "Due back" pills, and the two new filters. A fake fetch
// stands in for the API (src/routes/admin-fundraising-requests.ts). Every person, place and number
// is invented.

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
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const item = (kind: string) => q(`[data-frrequests] [data-frreq="${kind}"]`);
const button = (kind: string, action: string) => q(`[data-frreqkind="${kind}"][data-frreqact="${action}"]`);

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
function check(sel: string) {
  const input = q(sel) as HTMLInputElement;
  input.checked = true;
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

describe("the list", () => {
  it("shows Requests to do on a sign up with something still to send or do, and Due back where buckets are due", async () => {
    await openFundraising();
    expect(row(1)!.querySelector(".fr-requests-pill")?.textContent).toBe("Requests to do");
    expect(row(2)!.querySelector(".fr-requests-pill")).toBeNull();
    expect(row(3)!.querySelector(".fr-requests-pill")).toBeNull();
    expect(row(3)!.querySelector(".fr-dueback-pill")?.textContent).toBe("Due back");
    expect(row(1)!.querySelector(".fr-dueback-pill")).toBeNull();
  });

  it("filters Requests to do, and Buckets not back, with their numbers", async () => {
    await openFundraising();
    const todo = q('[data-frfilter="requests"]') as HTMLElement;
    const notBack = q('[data-frfilter="notback"]') as HTMLElement;
    expect(text(todo)).toBe("Requests to do (1)");
    expect(text(notBack)).toBe("Buckets not back (2)");
    todo.click();
    await settle();
    expect(row(1)).not.toBeNull();
    expect(row(2)).toBeNull();
    expect(row(3)).toBeNull();
    notBack.click();
    await settle();
    expect(row(1)).not.toBeNull();
    expect(row(2)).toBeNull();
    expect(row(3)).not.toBeNull();
  });

  it("says when there is nothing under a filter", async () => {
    reqs.toDo = {};
    reqs.notBack = {};
    await openFundraising();
    (q('[data-frfilter="requests"]') as HTMLElement).click();
    await settle();
    expect(text(el("frList"))).toBe("No requests to do.");
    (q('[data-frfilter="notback"]') as HTMLElement).click();
    await settle();
    expect(text(el("frList"))).toBe("No buckets or tins are out.");
  });

  it("leaves the rest of the list working when the requests cannot load", async () => {
    reqsFail = true;
    await openFundraising();
    expect(row(1)).not.toBeNull();
    expect(row(1)!.querySelector(".fr-requests-pill")).toBeNull();
    await openRow(1);
    expect(text(q("[data-frrequests]"))).toContain("The requests could not load just now.");
    // The rest of the sign up is all there.
    expect(text(q('[data-frdetail="1"]'))).toContain("What they would like");
  });
});

// ---- one sign up ----

describe("the Requests part of a sign up", () => {
  it("is not there when nothing was asked for", async () => {
    await openFundraising();
    await openRow(2);
    expect(q("[data-frrequests]")).toBeNull();
  });

  it("shows each request and where it is up to, with Due back, and a shout out still needing their permission", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(q("[data-frrequests] h4"))).toBe("Requests");
    expect(text(item("posters"))).toContain("Posters");
    expect(text(item("posters"))).toContain("10 asked for");
    expect(text(item("posters"))).toContain("To send");
    expect(text(item("buckets"))).toContain("With them");
    expect(text(item("buckets"))).toContain("2 went out on 20/11/2026, by Fern");
    expect(text(item("buckets"))).toContain("Due back on 26/12/2026");
    expect(text(item("shout_out"))).toContain("Asked, but no permission to post yet: ask them");
    expect(text(item("shout_out"))).not.toContain("nothing to do");
    expect(item("shout_out")!.querySelector("button")).toBeNull();
  });

  for (const r of ["admin", "editor"] as const) {
    it(`gives a${r === "admin" ? "n" : "n"} ${r} the next step and Undo`, async () => {
      asRole(r);
      await openFundraising();
      await openRow(1);
      expect(text(button("posters", "send"))).toBe("Mark as sent");
      expect(text(button("buckets", "back"))).toBe("Mark as back");
      expect(text(button("buckets", "undo"))).toBe("Undo");
    });
  }

  it("gives a viewer where each is up to, and no buttons", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(text(item("posters"))).toContain("To send");
    expect(text(item("buckets"))).toContain("Due back on 26/12/2026");
    expect(q("[data-frrequests] button")).toBeNull();
  });

  it("marks posters sent with a small form: the date, posted or dropped off, who, how many and a note", async () => {
    await openFundraising();
    await openRow(1);
    button("posters", "send")!.click();
    await settle();
    expect((q('#frReqForm [name="on"]') as HTMLInputElement).value).toBe("2026-12-07");
    expect((q('#frReqForm [name="quantity"]') as HTMLInputElement).value).toBe("10");
    expect((q('#frReqForm [name="by"]') as HTMLInputElement).value).toBe("Fern");
    check('#frReqForm [name="how"][value="dropped_off"]');
    setValue('#frReqForm [name="quantity"]', "8");
    setValue('#frReqForm [name="note"]', "Left at the front desk");
    submit("#frReqForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/requests/posters")[0].body).toEqual({
      action: "send",
      from: "to_send",
      on: "2026-12-07",
      how: "dropped_off",
      by: "Fern",
      quantity: 8,
      note: "Left at the front desk",
    });
    expect(q("#frReqForm")).toBeNull();
    expect(text(item("posters"))).toContain("Sent");
    expect(text(item("posters"))).toContain("8 dropped off on 07/12/2026, by Fern");
    expect(text(el("frReqStatus"))).toBe("Saved. Posters: sent (dropped off).");
    expect(row(1)!.querySelector(".fr-requests-pill")).toBeNull();
  });

  it("asks how it went before sending, and keeps what was typed when the server refuses a box", async () => {
    answers["POST /api/admin/fundraisers/1/requests/posters"] = {
      status: 400,
      body: { error: "Some of it needs another look", fields: { on: "That date is still to come." } },
    };
    await openFundraising();
    await openRow(1);
    button("posters", "send")!.click();
    await settle();
    submit("#frReqForm");
    await settle();
    expect(text(el("frReqStatus"))).toBe("Say whether it was posted or dropped off.");
    expect(sent("POST", "/api/admin/fundraisers/1/requests/posters")).toHaveLength(0);
    check('#frReqForm [name="how"][value="post"]');
    setValue('#frReqForm [name="note"]', "Second class");
    submit("#frReqForm");
    await settle();
    expect(q("#frReqForm")).not.toBeNull();
    expect(text(q('[data-frreqerr="on"]'))).toBe("That date is still to come.");
    expect((q('#frReqForm [name="note"]') as HTMLTextAreaElement).value).toBe("Second class");
  });

  it("marks buckets back with how many came back and a note on the money", async () => {
    await openFundraising();
    await openRow(1);
    button("buckets", "back")!.click();
    await settle();
    expect((q('#frReqForm [name="quantity"]') as HTMLInputElement).value).toBe("2");
    setValue('#frReqForm [name="quantity"]', "1");
    setValue('#frReqForm [name="note"]', "One missing, about £40 inside");
    submit("#frReqForm");
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/requests/buckets")[0].body).toEqual({
      action: "back",
      from: "with_them",
      on: "2026-12-07",
      quantity: 1,
      note: "One missing, about £40 inside",
    });
    expect(text(item("buckets"))).toContain("1 of 2 came back on 07/12/2026");
  });

  it("closes the form on Cancel, sending nothing", async () => {
    await openFundraising();
    await openRow(1);
    button("posters", "send")!.click();
    await settle();
    (q("[data-frreqcancel]") as HTMLElement).click();
    await settle();
    expect(q("#frReqForm")).toBeNull();
    expect(calls.filter((c) => c.method === "POST" && c.path.includes("/requests/"))).toHaveLength(0);
  });

  it("undoes one step only after asking", async () => {
    await openFundraising();
    await openRow(1);
    confirmAnswer = false;
    button("buckets", "undo")!.click();
    await settle();
    expect(confirmed.pop()).toBe("Undo Collection buckets? It goes back from With them to To send, and what was entered for that step is cleared.");
    expect(sent("POST", "/api/admin/fundraisers/1/requests/buckets")).toHaveLength(0);
    confirmAnswer = true;
    button("buckets", "undo")!.click();
    await settle();
    expect(sent("POST", "/api/admin/fundraisers/1/requests/buckets")[0].body).toEqual({ action: "undo", from: "with_them" });
  });

  it("passes on the server's words when someone else got there first, and shows how it stands now", async () => {
    answers["POST /api/admin/fundraisers/1/requests/posters"] = { status: 409, body: { error: "Someone else changed this a moment ago. It now shows how it stands." } };
    await openFundraising();
    await openRow(1);
    button("posters", "send")!.click();
    await settle();
    check('#frReqForm [name="how"][value="post"]');
    submit("#frReqForm");
    await settle();
    expect(text(el("frReqStatus"))).toBe("Someone else changed this a moment ago. It now shows how it stands.");
    expect(q("#frReqForm")).toBeNull();
    expect(sent("GET", "/api/admin/fundraising/requests").length).toBeGreaterThan(1);
  });

  it("names each change in History", async () => {
    history = [{ action: "fundraiser.request_updated", actor: "admin:fern@example.com", createdAt: "2026-12-07T10:00:00.000Z", data: { words: "Posters: sent (by post)" } }];
    await openFundraising();
    await openRow(1);
    expect(text(el("frHistory"))).toContain("Posters: sent (by post)");
  });

  it("escapes everything stored", async () => {
    reqs.requests["1"][1] = { ...reqs.requests["1"][1], handledBy: "<img src=x onerror=alert(1)>", note: "<b>hi</b>" };
    await openFundraising();
    await openRow(1);
    expect(item("buckets")!.querySelector("img")).toBeNull();
    expect(item("buckets")!.querySelector("b")).toBeNull();
    expect(text(item("buckets"))).toContain("<img src=x onerror=alert(1)>");
  });

  it("grows the page rather than scrolling inside: no fixed heights on the panel", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
    const rules = css.split("}").filter((r) => /fr-req/.test(r));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/overflow(-y)?\s*:\s*(auto|scroll)|max-height/);
  });
});

describe("the rest of the sign up is untouched", () => {
  it("still shows What they would like as it always did", async () => {
    await openFundraising();
    await openRow(1);
    const panels = qa('[data-frdetail="1"] .fx-panel h4').map((h) => text(h));
    expect(panels).toContain("What they would like");
    expect(panels).toContain("Requests");
  });
});
