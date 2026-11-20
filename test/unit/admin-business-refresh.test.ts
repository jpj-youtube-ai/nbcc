// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin refresh (2026-11-14): the page for one business, opened from Content > Contact businesses,
// in the kit's look, and the faults the audit found on it
// (docs/superpowers/specs/2026-11-14-admin-refresh-outreach.md). The most serious was the first:
// the supporter picker kept the last business's list, so the wrong donor could be linked.
// admin.html's <body> in jsdom, the kit, a pretend server, and app.js run against them. Every
// business, person, address and number is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const ME = "fern@example.com";
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY - 3_600_000).toISOString();

type Biz = Record<string, unknown> & { id: number; businessName: string };
function biz(id: number, over: Record<string, unknown> = {}): Biz {
  return {
    id, businessName: "Pretend Business " + id, contactName: null, contactEmail: null, contactPhone: null,
    businessType: "company", note: null, warmIntro: null, detailsSource: "website_or_listing", consentBasis: null,
    consentBasisRecordedBy: null, owner: null, ownerEmail: null, donorId: null, tags: [], nudgeSentAt: null,
    nudgeSentBy: null, sentWithPersonalMessage: null, ctpsCheckedAt: null, ctpsCheckedBy: null, sentBy: null,
    sentAt: null, outcome: null, outcomeAt: null, askAgainOn: null, lastEngagementAt: null, createdAt: daysAgo(40),
    latestNote: null, ...over,
  };
}
type Todo = { id: number; kind: string; businessName: string; reason: string; action: string; owner: string | null; daysOverdue: number };
type Note = { id: number; author: string; body: string; createdAt: string };
type Donor = { id: number; name: string; email: string | null; totalPence: number; score: number };
type Answer = { status: number; body: unknown };

let role = "editor";
let perms: Record<string, string> = {};
// Someone given a look at Contact businesses from the Team screen, and nothing more.
const onlyLooks = () => {
  role = "viewer";
  perms = { ...effectivePermissions({ role: "viewer", permissions: null }), outreach: "view" };
};
let businesses: Biz[] = [];
let todos: Todo[] = [];
let todoFor: Record<number, Todo | null> = {};
let notesFor: Record<number, Note[]> = {};
let donorsFor: Record<number, Donor[]> = {};
let supporterFor: Record<number, { id: number; name: string } | null> = {};
// A request held back until the test lets it go, to prove a late answer is thrown away.
let held: Record<string, { release: () => void }> = {};
let holdPaths: string[] = [];
let patchAnswer: Answer | null = null;
let calls: { method: string; path: string; body: Record<string, unknown> }[] = [];

function respond(url: string, init?: { method?: string; body?: string }): unknown {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  let body: Record<string, unknown> = {};
  try { body = init?.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  calls.push({ method, path, body });

  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: ME, role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: ME, role } });
  }
  if (path === "/api/admin/me") return j({ email: ME, permissions: perms });
  // The donor page is another builder's; here it only has to be asked for.
  if (path.startsWith("/api/admin/donors/")) return j({ error: "Donor not found" }, 404);
  if (path === "/api/admin/outreach" && method === "GET") return j({ results: businesses, total: businesses.length });
  if (path === "/api/admin/outreach/todo") return j({ scope: "mine", todos, totalEverywhere: todos.length });
  if (path === "/api/admin/outreach/volunteers") {
    return j({ volunteers: [{ name: "Fern Example", email: ME }, { name: "Rowan Example", email: "rowan@example.com" }] });
  }
  if (path === "/api/admin/outreach/reports") return j({ funnel: {}, money: {} });
  if (path === "/api/admin/outreach/preview") return j({ subject: "A subject", html: "<p>Hello</p>" });
  const m = path.match(/^\/api\/admin\/outreach\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const b = businesses.find((x) => x.id === id);
  if (!b) return j({ error: "Unknown business" }, 404);
  const rest = m[2] || "";
  const answer = () => {
    if (rest === "" && method === "GET") {
      return j({ business: b, notes: notesFor[id] || [], todo: todoFor[id] ?? null, supporter: supporterFor[id] ?? null });
    }
    if (rest === "" && method === "PATCH") {
      if (patchAnswer) return j(patchAnswer.body, patchAnswer.status);
      const phoneChanged = "contactPhone" in body && String(body.contactPhone || "") !== String(b.contactPhone || "");
      Object.assign(b, {
        businessName: body.businessName ?? b.businessName, contactName: body.contactName || null, contactEmail: body.contactEmail || null,
        contactPhone: body.contactPhone || null, warmIntro: body.warmIntro || null, owner: body.owner || null,
        ownerEmail: body.ownerEmail || null, tags: String(body.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
      });
      if (phoneChanged) Object.assign(b, { ctpsCheckedAt: null, ctpsCheckedBy: null });
      return j({ business: b });
    }
    if (rest === "/donors") return j({ donors: donorsFor[id] || [] });
    if (rest === "/outcome") { Object.assign(b, { outcome: body.outcome, outcomeAt: new Date().toISOString() }); return j({ saved: true }); }
    if (rest === "/nudge") { Object.assign(b, { nudgeSentAt: new Date().toISOString(), nudgeSentBy: ME }); return j({ sent: true }); }
    if (rest === "/notes") {
      notesFor[id] = [{ id: 50, author: ME, body: String(body.body), createdAt: new Date().toISOString() }, ...(notesFor[id] || [])];
      return j({ notes: notesFor[id] }, 201);
    }
    if (rest === "/disclosure") return j({ text: "Everything we hold about " + b.businessName });
    if (rest === "/ctps") { Object.assign(b, { ctpsCheckedAt: new Date().toISOString(), ctpsCheckedBy: ME }); return j({ checked: true }); }
    return j({ results: [] });
  };
  if (holdPaths.includes(method + " " + path)) {
    return new Promise((done) => { held[method + " " + path] = { release: () => done(answer()) }; });
  }
  return answer();
}

beforeEach(() => {
  role = "editor";
  perms = effectivePermissions({ role: "editor", permissions: null }) as Record<string, string>;
  businesses = [];
  todos = [];
  todoFor = {};
  notesFor = {};
  donorsFor = {};
  supporterFor = {};
  held = {};
  holdPaths = [];
  patchAnswer = null;
  calls = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  window.confirm = () => true;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true });
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const view = () => el("view-business");
const q = (sel: string) => view().querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(view().querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").split(/\s+/).join(" ").trim();
const partBtn = (key: string) => q('.ak-parts [data-akpart="' + key + '"]') as HTMLElement;
const partBody = (key: string) => q('[data-akpart-body="' + key + '"]') as HTMLElement;
const shownParts = () => qa("[data-akpart-body]").filter((p) => !p.hidden).map((p) => p.getAttribute("data-akpart-body"));
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const donorChoices = () => Array.from((el("businessDonor") as HTMLSelectElement).options).map((o) => o.value);
const outcome = (key: string) => q('input[name="outOutcome"][value="' + key + '"]') as HTMLInputElement;

async function press(node: HTMLElement | null) {
  expect(node, "the thing to press").not.toBeNull();
  (node as HTMLElement).click();
  await settle();
}
async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = ME;
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="outreach"]') as HTMLElement).click();
  await settle();
}
// Opens a business from the list of everyone, as a volunteer would.
async function openFromList(id: number) {
  await press(document.querySelector('#outList [data-out-open="' + id + '"]') as HTMLElement);
}
async function choose(key: string) {
  outcome(key).checked = true;
  outcome(key).dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
async function submit(formId: string) {
  el(formId).dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

const donor = (id: number, name: string): Donor => ({ id, name, email: null, totalPence: 5000, score: 1 });

// THE fault: "Which supporter did they become?" was filled once and never emptied, so the second
// business opened showed the first one's list with its supporter still chosen. Saving "Signed up"
// there linked the wrong donor, and the money report counted somebody else's giving.
describe("the supporter picker belongs to the business that is open", () => {
  beforeEach(() => {
    businesses = [
      biz(1, { businessName: "First Firm", outcome: "signed_up", donorId: 71, sentAt: daysAgo(30) }),
      biz(2, { businessName: "Second Firm", sentAt: daysAgo(30) }),
    ];
    donorsFor = { 1: [donor(71, "First Firm Ltd"), donor(72, "First Firm Holdings")], 2: [donor(81, "Second Firm Ltd")] };
  });

  it("offers the first business its own supporters, with the one it became chosen", async () => {
    await signIn();
    await openFromList(1);
    expect(el("businessDonorField").hidden).toBe(false);
    expect(donorChoices()).toEqual(["", "71", "72"]);
    expect((el("businessDonor") as HTMLSelectElement).value).toBe("71");
  });

  it("does not carry that list, or the one chosen, to the next business opened", async () => {
    await signIn();
    await openFromList(1);
    await press(el("businessBack"));
    await openFromList(2);
    expect(el("businessDonorField").hidden).toBe(true);
    // Nothing of the first business is left in the picker, even while it is hidden.
    expect(donorChoices()).not.toContain("71");
    expect((el("businessDonor") as HTMLSelectElement).value).toBe("");
    await choose("signed_up");
    expect(el("businessDonorField").hidden).toBe(false);
    expect(donorChoices()).toEqual(["", "81"]);
    expect((el("businessDonor") as HTMLSelectElement).value).toBe("");
  });

  it("never sends the last business's supporter when the next one is saved as signed up", async () => {
    await signIn();
    await openFromList(1);
    await press(el("businessBack"));
    await openFromList(2);
    await choose("signed_up");
    await submit("businessOutcomeForm");
    const saved = sent("POST", "/api/admin/outreach/2/outcome");
    expect(saved).toHaveLength(1);
    expect(saved[0].body.outcome).toBe("signed_up");
    expect(saved[0].body.donorId).toBeNull();
  });

  it("throws away a list of supporters that arrives after another business has been opened", async () => {
    holdPaths = ["GET /api/admin/outreach/1/donors"];
    await signIn();
    await openFromList(1);
    await press(el("businessBack"));
    await openFromList(2);
    await choose("signed_up");
    expect(donorChoices()).toEqual(["", "81"]);
    held["GET /api/admin/outreach/1/donors"].release();
    await settle();
    expect(donorChoices()).toEqual(["", "81"]);
    expect((el("businessDonor") as HTMLSelectElement).value).toBe("");
  });

  it("throws away a business that arrives after another has been opened", async () => {
    holdPaths = ["GET /api/admin/outreach/1"];
    await signIn();
    await openFromList(1);
    await press(el("businessBack"));
    await openFromList(2);
    expect(text(el("business-heading"))).toBe("Second Firm");
    held["GET /api/admin/outreach/1"].release();
    await settle();
    expect(text(el("business-heading"))).toBe("Second Firm");
  });

  it("does not carry the ask again date, or a half written note, to the next business either", async () => {
    businesses[0] = biz(1, { businessName: "First Firm", outcome: "not_this_year", askAgainOn: "2027-08-01", sentAt: daysAgo(30) });
    await signIn();
    await openFromList(1);
    expect((el("businessAskAgain") as HTMLInputElement).value).toBe("2027-08-01");
    (el("businessNote") as HTMLTextAreaElement).value = "Half a note about the first firm";
    await press(el("businessBack"));
    await openFromList(2);
    expect((el("businessAskAgain") as HTMLInputElement).value).toBe("");
    expect((el("businessNote") as HTMLTextAreaElement).value).toBe("");
    // The date suggested for the second business is its own: eleven months on, not the first one's.
    await choose("not_this_year");
    expect((el("businessAskAgain") as HTMLInputElement).value).not.toBe("2027-08-01");
    expect((el("businessAskAgain") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

// The fault: "Saved." and "Sent. They will not be chased again." were written and wiped in the
// same breath, because redrawing the business went through the function that clears the messages.
describe("what just happened is said beside the button, and left there", () => {
  beforeEach(() => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example", sentAt: daysAgo(20) })];
  });

  it("leaves Saved. on the screen after what happened is saved", async () => {
    await signIn();
    await openFromList(1);
    await choose("interested");
    await submit("businessOutcomeForm");
    await settle();
    expect(text(el("businessOutcomeStatus"))).toBe("Saved.");
    expect(el("businessOutcomeStatus").classList.contains("is-ok")).toBe(true);
    // And the page shows what was saved.
    expect(text(el("businessDetail"))).toContain("Interested");
    expect(outcome("interested").checked).toBe(true);
  });

  it("leaves Sent. on the screen after the follow-up goes, and takes the button away", async () => {
    await signIn();
    await openFromList(1);
    expect(el("businessNudge").hidden).toBe(false);
    await press(el("businessNudgeSend"));
    await settle();
    expect(text(el("businessNudgeStatus"))).toBe("Sent. They will not be chased again.");
    expect(el("businessNudge").hidden).toBe(false);
    expect(el("businessNudgeSend").hidden).toBe(true);
    expect(text(el("businessDetail"))).toContain("Follow-up sent");
  });

  it("clears those messages when a different business is opened", async () => {
    businesses.push(biz(2, { businessName: "Second Firm" }));
    await signIn();
    await openFromList(1);
    await choose("interested");
    await submit("businessOutcomeForm");
    await press(el("businessBack"));
    await openFromList(2);
    expect(text(el("businessOutcomeStatus"))).toBe("");
    expect(text(el("businessNudgeStatus"))).toBe("");
  });

  it("says Added. beside the note button and shows the note", async () => {
    await signIn();
    await openFromList(1);
    await press(partBtn("notes"));
    (el("businessNote") as HTMLTextAreaElement).value = "Rang and spoke to Jo.";
    await submit("businessNoteForm");
    expect(text(el("businessNoteStatus"))).toBe("Added.");
    expect(text(el("businessNotes"))).toContain("Rang and spoke to Jo.");
    expect(text(partBtn("notes"))).toBe("Notes (1)");
  });
});

describe("the page is in the look, in four parts", () => {
  beforeEach(() => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example", sentAt: daysAgo(20) })];
  });

  it("takes the kit's look and opens with one sentence", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const v = doc.getElementById("view-business") as HTMLElement;
    expect(v.classList.contains("ak")).toBe(true);
    expect(text(v.querySelector(".admin-view-intro")).length).toBeGreaterThan(30);
  });

  it("has a bar of four parts and opens on At a glance", async () => {
    await signIn();
    await openFromList(1);
    expect(qa(".ak-parts [data-akpart]").map((b) => text(b))).toEqual(["At a glance", "Notes", "Their details", "If they ask what we hold"]);
    expect(shownParts()).toEqual(["glance"]);
  });

  it("shows one part at a time, and goes back to At a glance for the next business", async () => {
    businesses.push(biz(2, { businessName: "Second Firm" }));
    await signIn();
    await openFromList(1);
    await press(partBtn("hold"));
    expect(shownParts()).toEqual(["hold"]);
    await press(el("businessBack"));
    await openFromList(2);
    expect(shownParts()).toEqual(["glance"]);
  });

  it("stays on the part you are on when the business is redrawn after a save", async () => {
    await signIn();
    await openFromList(1);
    await press(partBtn("notes"));
    (el("businessNote") as HTMLTextAreaElement).value = "A note.";
    await submit("businessNoteForm");
    expect(shownParts()).toEqual(["notes"]);
  });

  it("puts the notes, with how many there are, in a part of their own", async () => {
    notesFor = { 1: [
      { id: 1, author: "rowan@example.com", body: "Rang. Try after their year end.", createdAt: "2026-11-03T10:00:00.000Z" },
      { id: 2, author: ME, body: "Met the owner at the market.", createdAt: "2026-10-20T10:00:00.000Z" },
    ] };
    await signIn();
    await openFromList(1);
    expect(text(partBtn("notes"))).toBe("Notes (2)");
    expect(partBody("notes").contains(el("businessNotes"))).toBe(true);
    expect(text(el("businessNotes"))).toContain("rowan@example.com");
    expect(text(el("businessNotes"))).toContain("3 November 2026");
  });

  it("keeps what happened and the facts on At a glance, and the rest under Their details", async () => {
    businesses[0] = biz(1, {
      businessName: "Quiet Bakery", contactName: "Jo Example", contactEmail: "hello@quietbakery.example", warmIntro: "Rowan knows the owner",
      owner: "Fern Example", ownerEmail: ME, note: "Sponsored the gala last year.", businessType: "sole_trader",
      consentBasis: "Gave me her card and said to email", consentBasisRecordedBy: ME, detailsSource: "given_to_us",
    });
    await signIn();
    await openFromList(1);
    const glance = text(el("businessDetail"));
    for (const label of ["Where it stands", "Contact", "Looked after by", "Who knows them"]) expect(glance, label).toContain(label);
    expect(glance).toContain("Not emailed yet");
    expect(glance).toContain("Rowan knows the owner");
    expect(partBody("glance").contains(el("businessOutcomeForm"))).toBe(true);
    const more = text(el("businessMore"));
    for (const label of ["Kind of business", "Where the details came from", "They agreed to hear from us", "Why this business", "Added"]) {
      expect(more, label).toContain(label);
    }
    expect(more).toContain("Sole trader or partnership");
    expect(more).toContain("They gave them to us");
    expect(more).toContain("Gave me her card and said to email");
    expect(more).toContain("Sponsored the gala last year.");
    expect(partBody("details").contains(el("businessMore"))).toBe(true);
  });

  it("shows their tags, which were returned and never shown", async () => {
    businesses[0].tags = ["chamber", "supplier"];
    await signIn();
    await openFromList(1);
    expect(qa("#businessDetail .biz-tag").map((t) => text(t))).toEqual(["chamber", "supplier"]);
  });

  it("does not show someone who may only look a heading with nothing under it", async () => {
    onlyLooks();
    await signIn();
    await openFromList(1);
    expect(el("businessOutcomeBlock").hidden).toBe(true);
    expect(el("businessNoteForm").hidden).toBe(true);
    expect(el("businessNudge").hidden).toBe(true);
    // They still see where it stands, and the notes.
    expect(text(el("businessDetail"))).toContain("Where it stands");
    expect(partBody("notes").contains(el("businessNotes"))).toBe(true);
  });

  it("shows an editor all of it", async () => {
    await signIn();
    await openFromList(1);
    expect(el("businessOutcomeBlock").hidden).toBe(false);
    expect(el("businessNoteForm").hidden).toBe(false);
  });
});

describe("what to do next, in the words of the to do list", () => {
  const sendTodo: Todo = { id: 1, kind: "send", businessName: "Waiting Joinery", reason: "Added, with an address, but never emailed.", action: "Send the invitation", owner: null, daysOverdue: 4 };

  it("says why this business is on the list, what to do, and how late it is", async () => {
    businesses = [biz(1, { businessName: "Waiting Joinery", contactEmail: "hello@waitingjoinery.example" })];
    todoFor = { 1: sendTodo };
    await signIn();
    await openFromList(1);
    const card = el("businessTodo");
    expect(card.hidden).toBe(false);
    expect(text(card.querySelector("h3"))).toBe("What to do next");
    expect(text(card)).toContain("Ready to send");
    expect(text(card)).toContain("Added, with an address, but never emailed.");
    expect(text(card)).toContain("Send the invitation");
    expect(text(card)).toContain("4 days over");
    // Above the bar of parts, so it is the first thing read.
    const kids = Array.from(view().children);
    expect(kids.indexOf(card)).toBeLessThan(kids.indexOf(el("businessParts")));
  });

  // The other half of the fault on Contact businesses: this page could not send a first email.
  it("offers Write their first email, which goes back to Write and send with this business chosen", async () => {
    businesses = [
      biz(5, { businessName: "Another Waiting", contactEmail: "hello@anotherwaiting.example" }),
      biz(1, { businessName: "Waiting Joinery", contactEmail: "hello@waitingjoinery.example" }),
    ];
    todoFor = { 1: sendTodo };
    await signIn();
    await openFromList(1);
    const go = q('#businessTodo [data-biz-go="write"]') as HTMLElement;
    expect(text(go)).toBe("Write their first email");
    await press(go);
    await settle();
    expect(el("view-outreach").hidden).toBe(false);
    expect(view().hidden).toBe(true);
    const outreach = el("view-outreach");
    const showing = Array.from(outreach.querySelectorAll("[data-akpart-body]")).filter((p) => !(p as HTMLElement).hidden).map((p) => p.getAttribute("data-akpart-body"));
    expect(showing).toEqual(["write"]);
    expect((el("outSendTo") as HTMLSelectElement).value).toBe("1");
  });

  it("does not offer it once they have been emailed, or to someone who may only look", async () => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example", sentAt: daysAgo(3) })];
    await signIn();
    await openFromList(1);
    expect(q('#businessTodo [data-biz-go="write"]')).toBeNull();
    expect(text(el("businessTodo"))).toContain("Nothing just now.");
  });

  it("does not offer a viewer a button that sends", async () => {
    onlyLooks();
    businesses = [biz(1, { businessName: "Waiting Joinery", contactEmail: "hello@waitingjoinery.example" })];
    todoFor = { 1: sendTodo };
    await signIn();
    await openFromList(1);
    expect(text(el("businessTodo"))).toContain("Ready to send");
    expect(q('#businessTodo [data-biz-go="write"]')).toBeNull();
  });

  it("says when there is no address yet", async () => {
    businesses = [biz(1, { businessName: "No Address Motors" })];
    todoFor = { 1: { id: 1, kind: "find-address", businessName: "No Address Motors", reason: "On the list with no email address.", action: "Find an address, or give them a call", owner: null, daysOverdue: 2 } };
    await signIn();
    await openFromList(1);
    expect(text(el("businessTodo"))).toContain("No address");
    expect(text(el("businessTodo"))).toContain("Find an address, or give them a call");
    expect(q('#businessTodo [data-biz-go="write"]')).toBeNull();
  });

  it("says nothing is needed, and why, for a business that said no or signed up", async () => {
    businesses = [
      biz(1, { businessName: "Refusing Roofer", outcome: "declined", sentAt: daysAgo(60) }),
      biz(2, { businessName: "Giving Grocer", outcome: "signed_up", sentAt: daysAgo(60) }),
    ];
    await signIn();
    await openFromList(1);
    expect(text(el("businessTodo"))).toContain("Nothing. They said no, and will not be contacted again.");
    await press(el("businessBack"));
    await openFromList(2);
    expect(text(el("businessTodo"))).toContain("Nothing. They signed up.");
  });
});

describe("the supporter they became", () => {
  beforeEach(() => {
    businesses = [biz(1, { businessName: "Giving Grocer", outcome: "signed_up", donorId: 71, sentAt: daysAgo(60) })];
    supporterFor = { 1: { id: 71, name: "Giving Grocer Ltd" } };
    donorsFor = { 1: [donor(71, "Giving Grocer Ltd")] };
  });

  it("is named, with See their giving for someone who may open Donations", async () => {
    await signIn();
    await openFromList(1);
    expect(text(el("businessDetail"))).toContain("The supporter they became");
    expect(text(el("businessDetail"))).toContain("Giving Grocer Ltd");
    const go = q('#businessDetail [data-biz-go="giving"]') as HTMLElement;
    expect(text(go)).toBe("See their giving");
    await press(go);
    expect(el("view-donor").hidden).toBe(false);
    expect(sent("GET", "/api/admin/donors/71").length).toBeGreaterThan(0);
  });

  it("is named without the button for someone who may not open Donations", async () => {
    perms = { ...perms, donations: "none" };
    await signIn();
    await openFromList(1);
    expect(text(el("businessDetail"))).toContain("Giving Grocer Ltd");
    expect(q('#businessDetail [data-biz-go="giving"]')).toBeNull();
  });
});

describe("copying their email, and their number once it is checked", () => {
  it("copies the email address and says so, there, until you leave", async () => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example" })];
    await signIn();
    await openFromList(1);
    const copy = q('#businessDetail [data-biz-copy="email"]') as HTMLElement;
    expect(copy.getAttribute("aria-label")).toBe("Copy their email address");
    await press(copy);
    expect((window.navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("hello@quietbakery.example");
    expect(text(el("businessContactStatus"))).toBe("Copied their email address.");
    await settle();
    expect(text(el("businessContactStatus"))).toBe("Copied their email address.");
  });

  it("offers no Copy for a number nobody has checked, and does not put the number on the page", async () => {
    businesses = [biz(1, { businessName: "Unchecked Joinery", contactPhone: "01632 960123" })];
    await signIn();
    await openFromList(1);
    expect(q('#businessDetail [data-biz-copy="phone"]')).toBeNull();
    expect(text(el("businessDetail"))).toContain("Number hidden until checked");
    expect(view().innerHTML).not.toContain("960123");
  });

  it("offers Copy for the number once it is checked", async () => {
    businesses = [biz(1, { businessName: "Checked Joinery", contactPhone: "01632 960123", ctpsCheckedAt: daysAgo(2), ctpsCheckedBy: ME })];
    await signIn();
    await openFromList(1);
    await press(q('#businessDetail [data-biz-copy="phone"]'));
    expect((window.navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("01632 960123");
    expect(text(el("businessContactStatus"))).toBe("Copied their number.");
  });

  it("says so when the browser will not copy", async () => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example" })];
    await signIn();
    await openFromList(1);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) }, configurable: true });
    await press(q('#businessDetail [data-biz-copy="email"]'));
    expect(text(el("businessContactStatus"))).toBe("Could not copy. Select it and copy by hand.");
    expect(el("businessContactStatus").classList.contains("is-error")).toBe(true);
  });

  it("says the check failed beside the button that was pressed", async () => {
    businesses = [biz(1, { businessName: "Unchecked Joinery", contactPhone: "01632 960123" })];
    await signIn();
    await openFromList(1);
    businesses = [];
    await press(q("#businessDetail #businessCtps"));
    expect(text(el("businessContactStatus"))).toBe("Could not record that check.");
    expect(el("businessContactStatus").classList.contains("is-error")).toBe(true);
  });
});

describe("next and previous, through the list you came from", () => {
  beforeEach(() => {
    businesses = [biz(1, { businessName: "Alpha Firm" }), biz(2, { businessName: "Beta Firm" }), biz(3, { businessName: "Gamma Firm" })];
  });

  it("says where you are in the list, and moves along it", async () => {
    await signIn();
    await openFromList(2);
    expect(el("businessStep").hidden).toBe(false);
    expect(text(el("businessPlace"))).toBe("2 of 3");
    await press(el("businessNext"));
    expect(text(el("business-heading"))).toBe("Gamma Firm");
    expect(text(el("businessPlace"))).toBe("3 of 3");
    expect((el("businessNext") as HTMLButtonElement).disabled).toBe(true);
    await press(el("businessPrev"));
    await press(el("businessPrev"));
    expect(text(el("business-heading"))).toBe("Alpha Firm");
    expect((el("businessPrev") as HTMLButtonElement).disabled).toBe(true);
  });

  it("follows the list as it was filtered when you left it", async () => {
    businesses[2].businessName = "Gamma Shop";
    await signIn();
    (el("outSearch") as HTMLInputElement).value = "firm";
    el("outSearch").dispatchEvent(new Event("input", { bubbles: true }));
    await openFromList(2);
    expect(text(el("businessPlace"))).toBe("2 of 2");
    expect((el("businessNext") as HTMLButtonElement).disabled).toBe(true);
    await press(el("businessPrev"));
    expect(text(el("business-heading"))).toBe("Alpha Firm");
  });

  it("has nowhere to step to when the list you came from holds one business", async () => {
    await signIn();
    (el("outSearch") as HTMLInputElement).value = "gamma";
    el("outSearch").dispatchEvent(new Event("input", { bubbles: true }));
    await openFromList(3);
    expect(el("businessStep").hidden).toBe(true);
  });

  it("follows the to do list when that is where you came from", async () => {
    todos = [
      { id: 3, kind: "send", businessName: "Gamma Firm", reason: "r", action: "a", owner: null, daysOverdue: 0 },
      { id: 1, kind: "nudge", businessName: "Alpha Firm", reason: "r", action: "a", owner: null, daysOverdue: 0 },
    ];
    await signIn();
    await press(document.querySelector('#outTodo [data-out-open="3"]') as HTMLElement);
    expect(text(el("businessPlace"))).toBe("1 of 2");
    await press(el("businessNext"));
    expect(text(el("business-heading"))).toBe("Alpha Firm");
    expect(text(el("businessPlace"))).toBe("2 of 2");
  });
});

describe("the one follow-up is signed on this page", () => {
  beforeEach(() => {
    businesses = [biz(1, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example", sentAt: daysAgo(20) })];
  });

  it("asks who it is from here, with a label", async () => {
    await signIn();
    await openFromList(1);
    const signer = el("businessSigner") as HTMLSelectElement;
    expect(el("businessNudge").contains(signer)).toBe(true);
    expect(view().querySelector('label[for="businessSigner"]')).not.toBeNull();
    expect(signer.options.length).toBe(helpers.SIGNERS.length);
  });

  // It used to be signed by whoever was chosen in a drop down on a different screen.
  it("sends it from whoever is chosen here, not from the other screen's choice", async () => {
    await signIn();
    await openFromList(1);
    (el("outSigner") as HTMLSelectElement).selectedIndex = 0;
    (el("businessSigner") as HTMLSelectElement).selectedIndex = 2;
    await press(el("businessNudgeSend"));
    const nudge = sent("POST", "/api/admin/outreach/1/nudge")[0];
    expect(nudge.body.signerName).toBe(helpers.SIGNERS[2].name);
    expect(nudge.body.signerRole).toBe(helpers.SIGNERS[2].role);
  });

  it("says what the button does under it", async () => {
    await signIn();
    await openFromList(1);
    expect(text(el("businessNudge").querySelector(".ak-says"))).toContain("cannot be sent again");
  });
});

describe("if they ask what we hold", () => {
  it("is a part of its own, and still shows and copies everything", async () => {
    businesses = [biz(1, { businessName: "Quiet Bakery" })];
    await signIn();
    await openFromList(1);
    await press(partBtn("hold"));
    expect(partBody("hold").contains(el("businessDisclose"))).toBe(true);
    await press(el("businessDisclose"));
    expect(text(el("businessDisclosure"))).toBe("Everything we hold about Quiet Bakery");
    expect(el("businessDiscloseCopy").hidden).toBe(false);
    await press(el("businessDiscloseCopy"));
    expect(text(el("businessDiscloseStatus"))).toBe("Copied. Paste it into your reply.");
  });
});

describe("nothing on the page was lost", () => {
  it("keeps every id app.js and the older tests use", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const id of [
      "businessBack", "business-heading", "businessDetail", "businessOutcomeForm", "businessOutcomes", "businessDonorField",
      "businessDonor", "businessAskAgainField", "businessAskAgain", "businessOutcomeSave", "businessOutcomeStatus", "businessNudge",
      "businessNudgeSend", "businessNudgeStatus", "businessDisclose", "businessDiscloseCopy", "businessDiscloseStatus",
      "businessDisclosure", "businessNoteForm", "businessNote", "businessNoteAdd", "businessNoteStatus", "businessNotes",
    ]) {
      expect(doc.getElementById(id), id).not.toBeNull();
      expect(doc.getElementById("view-business")!.contains(doc.getElementById(id)), id).toBe(true);
    }
  });

  it("keeps every word of help it had", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const words = text(doc.getElementById("view-business"));
    for (const phrase of [
      "Pick one and press save. This is what puts them on, or takes them off, the list of people who need chasing.",
      "Pick them and their giving counts towards what this whole effort has raised. Leave it if you are not sure; you can come back.",
      "They will appear on your list again on this date.",
      "A short note saying it is the last they will hear from us, with an easy way to say no.",
      "A sole trader can ask for this by law, and answering plainly is easier than working out whether they are entitled to.",
      "Anything worth the next volunteer knowing.",
      "e.g. Rang and spoke to Jim. Asked us to try again after their year end in April.",
    ]) {
      const inPage = words.includes(phrase) || doc.getElementById("view-business")!.innerHTML.includes(phrase);
      expect(inPage, phrase).toBe(true);
    }
  });
});
