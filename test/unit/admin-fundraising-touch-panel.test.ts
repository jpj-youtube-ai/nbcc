// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-515: Admin > Fundraising > Automatic emails and the smart call prompts, in the admin's jsdom
// harness (as admin-fundraising-thanks-panel.test.ts). The card reads every automatic email,
// rendered, before any is sent; only an admin sees the switch; the list shows a pill for each
// prompt; the open sign up shows each prompt's reason and talking points with Called, and which
// automatic emails it has had. A fake fetch stands in for the API. Every name is invented.

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
].map(([kind, label, newWording]) => ({ kind, label, when: "When it goes.", newWording }));

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
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  }
  if (path === "/api/admin/fundraising/team") return j({ today: "2026-12-07", me: 3, calls: {}, prompts: {}, invites: [], signers: [] });
  if (path === "/api/admin/fundraising/summary") return j({ recipients: [], lastWeek: null });
  if (path === "/api/admin/fundraising/requests") return j({ today: "2026-12-07", requests: {}, toDo: {}, notBack: {}, totals: {} });
  if (path === "/api/admin/fundraising/thanks-waiting") return j({ counts: {} });
  if (path === "/api/admin/fundraising/news-waiting") return j({ counts: {} });
  if (path === "/api/admin/fundraising/touch") {
    return j({
      today: "2026-12-07",
      settings: { on: touchOn, updatedAt: touchOn ? "2026-12-01T09:00:00.000Z" : null, updatedBy: touchOn ? "admin:fern@example.com" : null },
      kinds: KINDS,
      sent: { "1": [{ kind: "first_gift", sentAt: "2026-11-20T08:00:00.000Z" }] },
      prompts: { "1": [BEHIND] },
      promptCalls: {},
      due: { "1": "need_a_hand", "2": "halfway" },
    });
  }
  const pv = path.match(/^\/api\/admin\/fundraising\/touch\/preview\/([a-z_]+)$/);
  if (pv) {
    const forId = new URLSearchParams(query).get("fundraiserId");
    const title = forId ? "Test Dash " + forId : "Sam's Santa Dash";
    return j({
      kind: pv[1],
      label: KINDS.find((k) => k.kind === pv[1])!.label,
      newWording: KINDS.find((k) => k.kind === pv[1])!.newWording,
      sample: !forId,
      title,
      subject: "Subject for " + pv[1],
      html: "<!doctype html><html><body><p>Email body for " + pv[1] + " about " + title + "</p></body></html>",
      text: "Text for " + pv[1],
    });
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
});

describe("the Automatic emails card", () => {
  it("says they are off, and shows the first email straight away, for the invented example", async () => {
    await openFundraising();
    expect(el("frTouch").hidden).toBe(false);
    expect(text(el("frTouchState"))).toContain("Off.");
    expect(sent("GET", "/api/admin/fundraising/touch/preview/first_gift")).toHaveLength(1);
    expect((el("frTouchPreview") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("Email body for first_gift about Sam's Santa Dash");
    expect(text(el("frTouchMeta"))).toContain("Subject for first_gift");
  });

  it("says what the next 8am run would send, so the first morning is no surprise", async () => {
    await openFundraising();
    expect(text(el("frTouchDue"))).toBe(
      "Switched on now, the next 8am run would send up to 2 emails: You’re halfway there (1), Need a hand? (1). Anyone who has asked us to stop is left out.",
    );
    await openRow(1);
    expect(text(q("[data-frtouchnext]"))).toBe("Next: Need a hand?, once automatic emails are switched on.");
  });

  it("has a button for every email, and marks the new wording for sign off", async () => {
    await openFundraising();
    const buttons = Array.from(document.querySelectorAll("[data-frtouchkind]"));
    expect(buttons.map((b) => b.getAttribute("data-frtouchkind"))).toEqual(KINDS.map((k) => k.kind));
    (q('[data-frtouchkind="need_a_hand"]') as HTMLElement).click();
    await settle();
    expect((el("frTouchPreview") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("Email body for need_a_hand");
    expect(text(el("frTouchMeta"))).toContain("New wording, waiting for sign off");
    (q('[data-frtouchkind="halfway"]') as HTMLElement).click();
    await settle();
    expect(text(el("frTouchMeta"))).not.toContain("New wording");
  });

  it("shows an email for a real fundraiser raising money, picked from the list", async () => {
    await openFundraising();
    const pick = el("frTouchFor") as HTMLSelectElement;
    const values = Array.from(pick.options).map((o) => o.value);
    expect(values).toEqual(["", "1", "2"]); // the example, then the pages raising money (not the event)
    pick.value = "2";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const last = calls.filter((c) => c.path === "/api/admin/fundraising/touch/preview/first_gift").pop()!;
    expect(last.query).toBe("fundraiserId=2");
    expect((el("frTouchPreview") as HTMLIFrameElement).getAttribute("srcdoc")).toContain("about Test Dash 2");
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

  it("shows an editor the emails but not the switch", async () => {
    asRole("editor");
    await openFundraising();
    expect(el("frTouch").hidden).toBe(false);
    expect(el("frTouchSwitch").hidden).toBe(true);
    expect(el("frTouchSwitchNote").hidden).toBe(false);
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

  it("lists which automatic emails a fundraiser has had, and when", async () => {
    await openFundraising();
    await openRow(1);
    const sentList = text(q("[data-frtouchsent]"));
    expect(sentList).toContain("Your first gift is in");
    expect(sentList).toContain("20/11/2026");
  });
});
