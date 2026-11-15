// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";
import { buildListCounts, inListFilter, LIST_FILTERS } from "../../src/outreach/list-counts";

// Admin refresh (2026-11-14): Content > Contact businesses in the kit's look, and the faults the
// audit found on it (docs/superpowers/specs/2026-11-14-admin-refresh-outreach.md). The page for one
// business is in admin-business-refresh.test.ts. admin.html's <body> in jsdom, the kit, a pretend
// server, and app.js run against them. Every business, person, address and number is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-outreach.css"), "utf8");
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

let role = "editor";
// What the person signed in may do. An editor by default; onlyLooks() is someone given a look at
// Contact businesses from the Team screen, and nothing more.
let perms: Record<string, string> = {};
const onlyLooks = () => {
  role = "viewer";
  perms = { ...effectivePermissions({ role: "viewer", permissions: null }), outreach: "view" };
};
let businesses: Biz[] = [];
let todos: Todo[] = [];
let totalEverywhere = 0;
let listFails = false;
let laterPagesFail = false;
let calls: { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> }[] = [];
let nextId = 900;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    blob: () => Promise.resolve({}), headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const [path, qs] = url.split("?");
  const query = new URLSearchParams(qs || "");
  let body: Record<string, unknown> = {};
  try { body = init?.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  calls.push({ method, path, query, body });

  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: ME, role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: ME, role } });
  }
  if (path === "/api/admin/me") return j({ email: ME, permissions: perms });
  if (path === "/api/admin/outreach" && method === "GET") {
    const offset = Number(query.get("offset") || 0);
    const limit = Number(query.get("limit") || 200);
    if (listFails || (laterPagesFail && offset > 0)) return j({ error: "Admin is temporarily unavailable" }, 500);
    const all = businesses.map((b) => ({ outcome: b.outcome as string | null, sentAt: b.sentAt as string | null, ownerEmail: b.ownerEmail as string | null }));
    return j({ results: businesses.slice(offset, offset + limit), total: businesses.length, counts: buildListCounts(all, ME) });
  }
  if (path === "/api/admin/outreach" && method === "POST") {
    const made = biz(nextId++, { ...body, createdAt: new Date().toISOString() });
    businesses.unshift(made);
    return j({ business: made, matches: [] }, 201);
  }
  if (path === "/api/admin/outreach/todo") return j({ scope: query.get("scope") || "mine", todos, totalEverywhere });
  if (path === "/api/admin/outreach/volunteers") {
    return j({ volunteers: [{ name: "Fern Example", email: ME }, { name: "Rowan Example", email: "rowan@example.com" }] });
  }
  if (path === "/api/admin/outreach/reports") return j({ funnel: {}, money: {} });
  if (path === "/api/admin/outreach/preview") {
    return j({ subject: "Could " + (body.businessName || "your business") + " help a child this Christmas?", html: "<p>Hello</p>" });
  }
  if (path === "/api/admin/outreach/paste") {
    return j({ usable: [{ businessName: "Pasted One", contactEmail: "one@example.com", contactPhone: null }, { businessName: "Pasted Two", contactEmail: null, contactPhone: null }], problems: [], duplicatedInPaste: [] });
  }
  const m = path.match(/^\/api\/admin\/outreach\/(\d+)(\/.*)?$/);
  if (m) {
    const b = businesses.find((x) => x.id === Number(m[1]));
    if (!b) return j({ error: "Unknown business" }, 404);
    if (!m[2] && method === "GET") return j({ business: b, notes: [], todo: null, supporter: null });
    if (m[2] === "/send") { b.sentAt = new Date().toISOString(); return j({ sent: true }); }
  }
  return j({ results: [] });
}

beforeEach(() => {
  role = "editor";
  perms = effectivePermissions({ role: "editor", permissions: null }) as Record<string, string>;
  businesses = [];
  todos = [];
  totalEverywhere = 0;
  listFails = false;
  laterPagesFail = false;
  calls = [];
  nextId = 900;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  // jsdom draws nothing, so it cannot scroll; the bar of parts asks it to.
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
const view = () => el("view-outreach");
const q = (sel: string) => view().querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(view().querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").split(/\s+/).join(" ").trim();
const partBtn = (key: string) => q('.ak-parts [data-akpart="' + key + '"]') as HTMLElement;
const partBody = (key: string) => q('[data-akpart-body="' + key + '"]') as HTMLElement;
const shownParts = () => qa("[data-akpart-body]").filter((p) => !p.hidden).map((p) => p.getAttribute("data-akpart-body"));
const tile = (key: string) => q('#outStats [data-out-filter="' + key + '"]') as HTMLElement;
const tileCount = (key: string) => text(tile(key).querySelector(".ak-tile__n"));
const listNames = () => qa("#outList [data-out-open]").map((b) => text(b));
const sent = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

async function openOutreach() {
  (el("adminEmail") as HTMLInputElement).value = ME;
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="outreach"]') as HTMLElement).click();
  await settle();
}
async function press(node: HTMLElement | null) {
  expect(node, "the thing to press").not.toBeNull();
  (node as HTMLElement).click();
  await settle();
}

// A list with one business in every state the tiles count.
function mixedList(): Biz[] {
  return [
    biz(1, { businessName: "Waiting Joinery", contactEmail: "hello@waitingjoinery.example", ownerEmail: ME, owner: "Fern Example" }),
    biz(2, { businessName: "No Address Motors" }),
    biz(3, { businessName: "Quiet Bakery", contactEmail: "hello@quietbakery.example", sentAt: daysAgo(12), sentBy: "Fern Example" }),
    biz(4, { businessName: "Warm Florist", contactEmail: "hello@warmflorist.example", sentAt: daysAgo(30), outcome: "interested", outcomeAt: daysAgo(20) }),
    biz(5, { businessName: "Asking Garage", sentAt: daysAgo(30), outcome: "asked_for_info", outcomeAt: daysAgo(3), ownerEmail: ME, owner: "Fern Example" }),
    biz(6, { businessName: "Giving Grocer", sentAt: daysAgo(60), outcome: "signed_up", outcomeAt: daysAgo(50) }),
    biz(7, { businessName: "Refusing Roofer", sentAt: daysAgo(60), outcome: "declined", outcomeAt: daysAgo(55) }),
    biz(8, { businessName: "Later Laundry", sentAt: daysAgo(60), outcome: "not_this_year", outcomeAt: daysAgo(55), askAgainOn: "2027-08-01" }),
  ];
}

describe("the screen is in the look, in five parts", () => {
  it("takes the kit's look and still opens with its sentence", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const v = doc.getElementById("view-outreach") as HTMLElement;
    expect(v.classList.contains("ak")).toBe(true);
    expect(text(v.querySelector(".admin-view-intro"))).toContain("Ask a local business to become a monthly supporter.");
  });

  it("has a bar of five parts in the order the work is done, and shows To do first", async () => {
    await openOutreach();
    expect(qa(".ak-parts [data-akpart]").map((b) => text(b))).toEqual(["To do", "Add a business", "Write and send", "Everyone", "How it is going"]);
    expect(shownParts()).toEqual(["todo"]);
    expect(partBtn("todo").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows one part at a time", async () => {
    await openOutreach();
    await press(partBtn("everyone"));
    expect(shownParts()).toEqual(["everyone"]);
    await press(partBtn("add"));
    expect(shownParts()).toEqual(["add"]);
  });

  it("opens every part with one sentence, and names each for a screen reader", async () => {
    await openOutreach();
    for (const key of ["todo", "add", "write", "everyone", "going"]) {
      const intro = text(partBody(key).querySelector(".ak-part-intro"));
      expect(intro.length, key).toBeGreaterThan(20);
      expect(intro.endsWith("."), key).toBe(true);
      expect(partBody(key).getAttribute("role")).toBe("region");
      expect(partBody(key).getAttribute("aria-label"), key).toBeTruthy();
    }
  });

  it("keeps each heading in the part it belongs to", async () => {
    await openOutreach();
    const heads = (key: string) => Array.from(partBody(key).querySelectorAll("h3.admin-subhead")).map((h) => text(h));
    expect(heads("todo")).toEqual(["Needs you today"]);
    expect(heads("add")).toEqual(["1. Who are we writing to?"]);
    expect(heads("write")).toEqual(["2. Write and send"]);
    expect(heads("everyone")).toEqual(["3. Everyone we have contacted"]);
    expect(heads("going")).toEqual(["Is it working?"]);
  });

  it("comes back to the part you were on after looking at a business", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    await press(q('#outList [data-out-open="3"]'));
    expect(el("view-business").hidden).toBe(false);
    await press(el("businessBack"));
    expect(view().hidden).toBe(false);
    expect(shownParts()).toEqual(["everyone"]);
  });
});

describe("To do", () => {
  const sendRow: Todo = { id: 1, kind: "send", businessName: "Waiting Joinery", reason: "Added, with an address, but never emailed.", action: "Send the invitation", owner: "Fern Example", daysOverdue: 4 };
  const callRow: Todo = { id: 4, kind: "call", businessName: "Warm Florist", reason: "They were interested and nothing has happened since.", action: "Check their number against the register, then call", owner: null, daysOverdue: 0 };

  it("puts a dot on To do when something is waiting, and none when nothing is", async () => {
    businesses = mixedList();
    todos = [sendRow];
    await openOutreach();
    expect(el("outTodoDot").hidden).toBe(false);
    todos = [];
    await press(q('[data-out-scope="all"]'));
    expect(el("outTodoDot").hidden).toBe(true);
  });

  it("still says why each business is there, what to do, whose it is and how late", async () => {
    businesses = mixedList();
    todos = [sendRow, callRow];
    await openOutreach();
    const rows = qa("#outTodo .out-todo-row");
    expect(rows).toHaveLength(2);
    expect(text(rows[0])).toContain("Ready to send");
    expect(text(rows[0])).toContain("Waiting Joinery");
    expect(text(rows[0])).toContain("Added, with an address, but never emailed.");
    expect(text(rows[0])).toContain("Send the invitation");
    expect(text(rows[0])).toContain("Fern Example");
    expect(text(rows[0])).toContain("4 days over");
    expect(text(rows[1])).toContain("Worth a call");
    expect(text(rows[1])).toContain("Nobody yet");
  });

  // The fault: "Ready to send" said "Send the invitation", and pressing it opened a page that
  // could not send a first email. You came back and hunted for the business in a drop down.
  it("offers Write to them on a Ready to send row, and nowhere else", async () => {
    businesses = mixedList();
    todos = [sendRow, callRow];
    await openOutreach();
    const rows = qa("#outTodo .out-todo-row");
    expect(text(rows[0].querySelector("[data-out-write]"))).toBe("Write to them");
    expect(rows[1].querySelector("[data-out-write]")).toBeNull();
  });

  it("opens Write and send with that business chosen", async () => {
    businesses = mixedList();
    todos = [sendRow];
    await openOutreach();
    await press(q('#outTodo [data-out-write="1"]'));
    expect(shownParts()).toEqual(["write"]);
    expect((el("outSendTo") as HTMLSelectElement).value).toBe("1");
    // The preview is of that business, not whichever happened to be first.
    const previews = sent("POST", "/api/admin/outreach/preview");
    expect(previews[previews.length - 1].body.businessName).toBe("Waiting Joinery");
    // Still a way in to everything about them.
    expect(view().hidden).toBe(false);
  });

  it("still opens the business when the row itself is pressed", async () => {
    businesses = mixedList();
    todos = [sendRow];
    await openOutreach();
    await press(q('#outTodo [data-out-open="1"]'));
    expect(el("view-business").hidden).toBe(false);
  });

  it("does not offer someone who may only look a button that sends", async () => {
    onlyLooks();
    businesses = mixedList();
    todos = [sendRow];
    await openOutreach();
    expect(q("#outTodo [data-out-write]")).toBeNull();
    expect(q('#outTodo [data-out-open="1"]')).not.toBeNull();
  });
});

describe("Add a business", () => {
  async function add(fields: Record<string, string>) {
    await press(partBtn("add"));
    for (const [id, value] of Object.entries(fields)) (el(id) as HTMLInputElement).value = value;
    el("outAddForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
  }

  it("says the business was added, where it is now, and leaves the message there", async () => {
    await openOutreach();
    await add({ outBusinessName: "Newly Added Ltd", outContactEmail: "hello@newlyadded.example" });
    expect(text(el("outAddStatus"))).toBe("Added. They are under Everyone, not emailed yet.");
    expect(el("outAddStatus").classList.contains("is-ok")).toBe(true);
    await settle();
    expect(text(el("outAddStatus"))).toBe("Added. They are under Everyone, not emailed yet.");
  });

  // The fault: after "Add this business" it was not chosen in Sending to.
  it("offers Write to them straight after, which opens Write and send with the new business chosen", async () => {
    await openOutreach();
    expect(el("outAddWrite").hidden).toBe(true);
    await add({ outBusinessName: "Newly Added Ltd", outContactEmail: "hello@newlyadded.example" });
    expect(el("outAddWrite").hidden).toBe(false);
    expect(text(el("outAddWrite"))).toBe("Write to them");
    await press(el("outAddWrite"));
    expect(shownParts()).toEqual(["write"]);
    expect((el("outSendTo") as HTMLSelectElement).value).toBe("900");
  });

  it("does not offer to write to a business added without an address, and says why", async () => {
    await openOutreach();
    await add({ outBusinessName: "No Address Yet" });
    expect(el("outAddWrite").hidden).toBe(true);
    expect(text(el("outAddStatus"))).toBe("Added. They are under Everyone, with no email address yet.");
  });

  // The fault: a pasted list was added as a limited company, with whichever "where did you get
  // their details" happened to be chosen in the form above, and nothing near the box said so.
  it("asks what kind of business a pasted list is and where it came from, inside the fold", async () => {
    await openOutreach();
    const fold = q("details.out-paste") as HTMLElement;
    const kind = fold.querySelector("#outPasteType") as HTMLSelectElement;
    const source = fold.querySelector("#outPasteSource") as HTMLSelectElement;
    expect(Array.from(kind.options).map((o) => o.value)).toEqual(["company", "sole_trader"]);
    expect(Array.from(source.options).map((o) => o.value)).toEqual(["website_or_listing", "given_to_us", "referred", "social"]);
    expect(fold.querySelector('label[for="outPasteType"]')).not.toBeNull();
    expect(fold.querySelector('label[for="outPasteSource"]')).not.toBeNull();
  });

  it("adds a pasted list as what the fold says, not as what the form above says", async () => {
    await openOutreach();
    (el("outSource") as HTMLSelectElement).value = "social";
    (el("outPasteType") as HTMLSelectElement).value = "sole_trader";
    (el("outPasteSource") as HTMLSelectElement).value = "referred";
    (el("outPasteText") as HTMLTextAreaElement).value = "Pasted One, one@example.com";
    await press(el("outPasteCheck"));
    await press(el("outPasteAdd"));
    const adds = sent("POST", "/api/admin/outreach");
    expect(adds).toHaveLength(2);
    for (const a of adds) {
      expect(a.body.businessType).toBe("sole_trader");
      expect(a.body.detailsSource).toBe("referred");
    }
    expect(text(el("outPasteStatus"))).toBe("Added 2 of 2.");
  });

  it("shows what it made of a pasted list as cards on a phone, each cell named", async () => {
    await openOutreach();
    (el("outPasteText") as HTMLTextAreaElement).value = "Pasted One, one@example.com";
    await press(el("outPasteCheck"));
    const table = q("#outPastePreview table") as HTMLElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    expect(table.querySelector("tbody td.ak-cards__lead")).not.toBeNull();
    expect(table.querySelectorAll("tbody td")[1].getAttribute("data-label")).toBe("Email");
  });
});

describe("Write and send", () => {
  // The fault: the subject came back from the server and was never shown.
  it("shows the subject line above the email", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("write"));
    expect(text(el("outSubject"))).toBe("Subject: Could Waiting Joinery help a child this Christmas?");
    const wrap = el("outPreview").parentElement as HTMLElement;
    const kids = Array.from(wrap.children);
    expect(kids.indexOf(el("outSubject"))).toBeLessThan(kids.indexOf(el("outPreview")));
  });

  // The fault: a frame of fixed height, so the email scrolled inside a box and trapped the thumb.
  it("makes the frame as tall as the email, so nothing scrolls inside it", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("write"));
    const frame = el("outPreview") as HTMLIFrameElement;
    Object.defineProperty(frame, "contentDocument", {
      configurable: true,
      value: { documentElement: { scrollHeight: 1480 }, body: { scrollHeight: 1466 } },
    });
    frame.dispatchEvent(new Event("load"));
    expect(frame.style.height).toBe("1480px");
    expect(frame.getAttribute("scrolling")).toBe("no");
  });

  it("no longer gives the frame a height of its own in the stylesheet", () => {
    const flat = css.split(/\s+/).join(" ");
    expect(flat).toContain("#view-outreach .out-preview {");
    const rule = flat.slice(flat.indexOf("#view-outreach .out-preview {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("height: auto");
  });

  it("says what Send it does under the button, and still asks first", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("write"));
    const says = text(el("outSend").closest("form")!.querySelector(".ak-says"));
    expect(says).toContain("straight to their inbox");
    let asked = "";
    window.confirm = (msg?: string) => { asked = String(msg); return false; };
    el("outSendForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(asked).toContain("Send this to Waiting Joinery?");
    expect(sent("POST", "/api/admin/outreach/1/send")).toHaveLength(0);
  });

  it("says it was sent beside the button and leaves it there, with the business gone from the choices", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("write"));
    el("outSendForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    await settle();
    expect(text(el("outSendStatus"))).toBe("Sent to Waiting Joinery.");
    expect(Array.from((el("outSendTo") as HTMLSelectElement).options).map((o) => o.value)).not.toContain("1");
  });
});

describe("Everyone: the whole list, and true counts", () => {
  // The fault: only the newest 200 were listed, and the counts were counted from those 200.
  it("fetches the list a page at a time until it has every business", async () => {
    businesses = Array.from({ length: 450 }, (_, i) => biz(i + 1, { sentAt: i < 100 ? daysAgo(5) : null }));
    await openOutreach();
    const offsets = sent("GET", "/api/admin/outreach").map((c) => c.query.get("offset"));
    expect(offsets).toEqual(["0", "200", "400"]);
    expect(tileCount("all")).toBe("450");
    expect(tileCount("noAnswer")).toBe("100");
    expect(tileCount("waiting")).toBe("350");
    // Search covers all of them, not the first page.
    await press(partBtn("everyone"));
    (el("outSearch") as HTMLInputElement).value = "Pretend Business 449";
    el("outSearch").dispatchEvent(new Event("input", { bubbles: true }));
    expect(listNames()).toEqual(["Pretend Business 449"]);
    expect(text(el("outSearchCount"))).toBe("1 of 450 businesses");
  });

  it("uses the server's counts even before the rest of the list has arrived", async () => {
    businesses = Array.from({ length: 450 }, (_, i) => biz(i + 1));
    laterPagesFail = true;
    await openOutreach();
    expect(tileCount("all")).toBe("450");
    // And says, in the page, that the list is not all there.
    expect(text(el("outListNote"))).toBe("Could not load the whole list. The first 200 of 450 are here.");
    expect(el("outListNote").classList.contains("is-error")).toBe(true);
  });

  it("draws thirty at a time, with Show more for the rest", async () => {
    businesses = Array.from({ length: 70 }, (_, i) => biz(i + 1));
    await openOutreach();
    await press(partBtn("everyone"));
    expect(listNames()).toHaveLength(30);
    expect(text(el("outShowing"))).toBe("Showing 30 of 70");
    expect(el("outMore").hidden).toBe(false);
    await press(el("outMore"));
    expect(listNames()).toHaveLength(60);
    await press(el("outMore"));
    expect(listNames()).toHaveLength(70);
    expect(el("outMore").hidden).toBe(true);
    expect(text(el("outShowing"))).toBe("Showing all 70");
  });

  it("says progress in one line at the top", async () => {
    businesses = mixedList();
    await openOutreach();
    expect(text(el("outProgress"))).toBe("6 of 8 emailed, 5 replied, 1 signed up");
  });

  it("says so when there is nobody on the list, and nothing at all when it could not load", async () => {
    await openOutreach();
    expect(text(el("outProgress"))).toBe("No businesses on the list yet.");
    listFails = true;
    await press(document.querySelector('.admin-nav-link[data-view="ticker"]') as HTMLElement);
    await press(document.querySelector('.admin-nav-link[data-view="outreach"]') as HTMLElement);
    expect(text(el("outProgress"))).toBe("");
    expect(text(el("outStats"))).toBe("");
    expect(text(el("outList"))).toBe("Could not load the list.");
  });
});

describe("Everyone: count tiles that filter the list", () => {
  it("has a tile for each place a business can stand, with its count", async () => {
    businesses = mixedList();
    await openOutreach();
    expect(qa("#outStats [data-out-filter]").map((t) => text(t.querySelector(".ak-tile__name")))).toEqual([
      "On the list", "Waiting to be emailed", "Emailed and no answer", "Interested", "Signed up", "Said no", "Mine",
    ]);
    expect(["all", "waiting", "noAnswer", "interested", "signedUp", "saidNo", "mine"].map(tileCount)).toEqual(["8", "2", "1", "2", "1", "1", "2"]);
  });

  it("shows only those businesses when a tile is pressed, and everyone again on On the list", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    await press(tile("interested"));
    expect(listNames()).toEqual(["Warm Florist", "Asking Garage"]);
    expect(tile("interested").getAttribute("aria-pressed")).toBe("true");
    expect(tile("interested").classList.contains("is-active")).toBe(true);
    expect(tile("all").getAttribute("aria-pressed")).toBe("false");
    expect(text(el("outSearchCount"))).toBe("2 of 8 businesses");
    await press(tile("all"));
    expect(listNames()).toHaveLength(8);
    expect(text(el("outSearchCount"))).toBe("");
  });

  it("lets go of a tile when it is pressed a second time", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    await press(tile("saidNo"));
    expect(listNames()).toEqual(["Refusing Roofer"]);
    await press(tile("saidNo"));
    expect(listNames()).toHaveLength(8);
    expect(tile("all").getAttribute("aria-pressed")).toBe("true");
  });

  it("narrows together with the search box and the tag", async () => {
    businesses = mixedList();
    businesses[0].tags = ["chamber"];
    businesses[4].tags = ["chamber"];
    await openOutreach();
    await press(partBtn("everyone"));
    await press(tile("mine"));
    expect(listNames()).toEqual(["Waiting Joinery", "Asking Garage"]);
    (el("outSearch") as HTMLInputElement).value = "garage";
    el("outSearch").dispatchEvent(new Event("input", { bubbles: true }));
    expect(listNames()).toEqual(["Asking Garage"]);
  });

  it("steps a tile back when its count is nought, and says why a filter found nothing", async () => {
    businesses = [biz(1, { businessName: "Only One" })];
    await openOutreach();
    await press(partBtn("everyone"));
    expect(tile("signedUp").classList.contains("is-none")).toBe(true);
    await press(tile("signedUp"));
    expect(text(el("outList"))).toBe("Nobody here yet. Press On the list to see everyone.");
  });

  // The tiles filter in the browser; the counts come from the server. One rule, in two places.
  it("filters by the same rule the server counts by", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    for (const f of LIST_FILTERS) {
      await press(tile(f));
      const expected = businesses
        .filter((b) => inListFilter({ outcome: b.outcome as string | null, sentAt: b.sentAt as string | null, ownerEmail: b.ownerEmail as string | null }, f, ME))
        .map((b) => b.businessName);
      expect(listNames(), f).toEqual(expected);
      expect(tileCount(f), f).toBe(String(expected.length));
      await press(tile("all"));
    }
  });
});

describe("Everyone: a card for each business", () => {
  it("is a ledger that becomes cards on a phone, each cell named after its column", async () => {
    businesses = mixedList();
    await openOutreach();
    const table = q("#outList table") as HTMLElement;
    expect(table.classList.contains("ak-cards")).toBe(true);
    const cells = Array.from(table.querySelectorAll("tbody tr")[0].children) as HTMLElement[];
    expect(cells[0].classList.contains("ak-cards__lead")).toBe(true);
    expect(cells.slice(1).map((c) => c.getAttribute("data-label"))).toEqual(["Where it stands", "Contact", "Looked after by", "Latest note", "Added"]);
  });

  it("says where it stands in words, and how long ago it was emailed", async () => {
    businesses = mixedList();
    await openOutreach();
    const row = (id: number) => text((q('#outList [data-out-open="' + id + '"]') as HTMLElement).closest("tr"));
    expect(row(1)).toContain("Not emailed yet");
    expect(row(3)).toContain("Emailed 12 days ago");
    expect(row(4)).toContain("Interested");
    expect(row(4)).toContain("Emailed 30 days ago");
    expect(row(7)).toContain("Said no");
    expect(row(1)).toContain("Fern Example");
    expect(row(2)).toContain("Nobody yet");
  });

  it("gives the email as a link, with a Copy button that says it copied and leaves that there", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    const row = (q('#outList [data-out-open="3"]') as HTMLElement).closest("tr") as HTMLElement;
    const link = row.querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:hello@quietbakery.example");
    const copy = row.querySelector("[data-out-copy]") as HTMLElement;
    expect(text(copy)).toBe("Copy");
    expect(copy.getAttribute("aria-label")).toBe("Copy the email address of Quiet Bakery");
    await press(copy);
    expect((window.navigator.clipboard.writeText as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("hello@quietbakery.example");
    const said = (q('#outList [data-out-open="3"]') as HTMLElement).closest("tr")!.querySelector(".out-copied");
    expect(text(said)).toBe("Copied.");
    await settle();
    expect(text((q('#outList [data-out-open="3"]') as HTMLElement).closest("tr")!.querySelector(".out-copied"))).toBe("Copied.");
  });

  it("says so when the browser will not copy", async () => {
    businesses = mixedList();
    await openOutreach();
    await press(partBtn("everyone"));
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) }, configurable: true });
    const row = (q('#outList [data-out-open="3"]') as HTMLElement).closest("tr") as HTMLElement;
    await press(row.querySelector("[data-out-copy]") as HTMLElement);
    const said = (q('#outList [data-out-open="3"]') as HTMLElement).closest("tr")!.querySelector(".out-copied") as HTMLElement;
    expect(text(said)).toBe("Could not copy. Select it and copy by hand.");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("shows the latest note, who wrote it and when", async () => {
    businesses = mixedList();
    businesses[3].latestNote = { body: "Rang and spoke to Jo. Try again after their year end.", author: "rowan@example.com", createdAt: "2026-11-03T10:00:00.000Z" };
    await openOutreach();
    const row = (q('#outList [data-out-open="4"]') as HTMLElement).closest("tr") as HTMLElement;
    const note = row.querySelector('td[data-label="Latest note"]') as HTMLElement;
    expect(text(note)).toContain("Rang and spoke to Jo. Try again after their year end.");
    expect(text(note)).toContain("rowan@example.com");
    expect(text(note)).toContain("3 November 2026");
    // A business with none has an empty cell, which the phone layout leaves out.
    const none = (q('#outList [data-out-open="1"]') as HTMLElement).closest("tr")!.querySelector('td[data-label="Latest note"]') as HTMLElement;
    expect(none.innerHTML).toBe("");
  });

  it("puts a note on the page as words, never as markup", async () => {
    businesses = [biz(1, { businessName: "<b>Bold</b> Joinery", latestNote: { body: "<img src=x onerror=alert(1)>", author: "a@example.com", createdAt: "2026-11-03T10:00:00.000Z" } })];
    await openOutreach();
    expect(q("#outList img")).toBeNull();
    expect(q("#outList td b")).toBeNull();
    expect(text(el("outList"))).toContain("<b>Bold</b> Joinery");
  });
});

// The business page hides a phone number until somebody says they have checked it against the
// Telephone Preference Service register, because ringing one that is on it is against the law.
// The list showed the same number to anyone, regardless. It follows the page now: the stricter rule.
describe("a phone number on the list follows the rule on the business page", () => {
  it("never shows a number nobody has checked", async () => {
    businesses = [biz(1, { businessName: "Unchecked Joinery", contactPhone: "01632 960123" })];
    await openOutreach();
    expect(el("outList").innerHTML).not.toContain("01632");
    expect(el("outList").innerHTML).not.toContain("960123");
    expect(text(el("outList"))).toContain("Number hidden until checked");
    expect(q('#outList a[href^="tel:"]')).toBeNull();
  });

  it("shows a number once it has been checked, as something to ring", async () => {
    businesses = [biz(1, { businessName: "Checked Joinery", contactPhone: "01632 960123", ctpsCheckedAt: daysAgo(2), ctpsCheckedBy: ME })];
    await openOutreach();
    const tel = q('#outList a[href^="tel:"]') as HTMLAnchorElement;
    expect(tel.getAttribute("href")).toBe("tel:01632960123");
    expect(text(tel)).toBe("01632 960123");
  });

  it("shows no number anywhere in the view for the unchecked one, whatever is pressed", async () => {
    businesses = [
      biz(1, { businessName: "Unchecked Joinery", contactPhone: "01632 960123", contactEmail: "a@example.com" }),
      biz(2, { businessName: "Checked Motors", contactPhone: "01632 960456", ctpsCheckedAt: daysAgo(2) }),
    ];
    todos = [{ id: 1, kind: "send", businessName: "Unchecked Joinery", reason: "Added, with an address, but never emailed.", action: "Send the invitation", owner: null, daysOverdue: 0 }];
    await openOutreach();
    for (const key of ["todo", "add", "write", "everyone", "going"]) {
      await press(partBtn(key));
      expect(view().innerHTML, key).not.toContain("960123");
    }
    expect(view().innerHTML).toContain("960456");
  });
});

describe("the stylesheet for these two screens keeps the house rules", () => {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("names every rule through one of its two views", () => {
    const flatCss = noComments.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const stray: string[] = [];
    for (const m of flatCss.matchAll(/([^{}]+)\{/g)) {
      const head = m[1].trim();
      if (!head || head.startsWith("@")) continue;
      let depth = 0;
      let one = "";
      const each: string[] = [];
      for (const ch of head) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { each.push(one.trim()); one = ""; } else one += ch;
      }
      each.push(one.trim());
      each.filter((s) => !(s.startsWith("#view-outreach") || s.startsWith("#view-business"))).forEach((s) => stray.push(s));
    }
    expect(stray).toEqual([]);
  });

  it("never uses !important", () => {
    expect(noComments).not.toContain("!important");
  });

  it("never makes a box that scrolls, inside itself or sideways", () => {
    expect(noComments).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  // The fault: what we hold about a business scrolled inside a box 60% of the screen tall.
  it("lets what we hold about a business run to its full length", () => {
    const flat = noComments.split(/\s+/).join(" ");
    const at = flat.indexOf("#view-business .out-disclosure {");
    expect(at).toBeGreaterThan(-1);
    const rule = flat.slice(at, flat.indexOf("}", at));
    expect(rule).toContain("max-height: none");
    expect(rule).toContain("overflow: visible");
  });

  it("moves only transform and opacity, and only for someone happy with motion", () => {
    const outside = noComments.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(outside).not.toMatch(/transition\s*:/);
    expect(outside).not.toMatch(/animation\s*:/);
  });

  it("has no side stripe, and takes the old one off the to do rows and the notes", () => {
    expect(noComments).not.toMatch(/border-left\s*:\s*\d+px solid/);
    const flat = noComments.split(/\s+/).join(" ");
    expect(flat).toContain("#view-outreach .out-todo-open {");
    expect(flat).toContain("#view-business .out-note {");
  });

  it("has no fixed width that could be wider than a phone", () => {
    const widths = [...noComments.matchAll(/[^-]width\s*:\s*(\d+)px/g)].map((m) => Number(m[1]));
    widths.forEach((w) => expect(w).toBeLessThanOrEqual(358));
  });

  it("is loaded after the kit", () => {
    expect(html.indexOf("/assets/css/admin-outreach.css")).toBeGreaterThan(html.indexOf("/assets/css/admin-kit.css"));
  });
});

describe("nothing on the screen was lost", () => {
  it("keeps every id app.js and the older tests use", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const id of [
      "outreach-heading", "outTodoScope", "outTodoCount", "outTodo", "outStats", "outAddForm", "outBusinessName", "outContactName",
      "outContactEmail", "outContactPhone", "outBusinessType", "outOwner", "outSource", "outConsentField", "outConsent",
      "outWarmIntro", "outTags", "outNote", "outWarnings", "outAdd", "outAddStatus", "outPasteText", "outPasteCheck",
      "outPasteAdd", "outPasteStatus", "outPastePreview", "outSendForm", "outSendTo", "outPersonal", "outSigner", "outSend",
      "outSendStatus", "outPreview", "outReports", "outSearch", "outTagFilter", "outExport", "outSearchCount", "outList",
    ]) {
      expect(doc.getElementById(id), id).not.toBeNull();
      expect(doc.getElementById("view-outreach")!.contains(doc.getElementById(id)), id).toBe(true);
    }
  });

  it("keeps every word of help it had", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const words = text(doc.getElementById("view-outreach"));
    for (const phrase of [
      "One business at a time, always by a person.",
      "As soon as you type a name or an email we check whether anyone has already contacted them",
      "The email says this back to them, so pick the one that is actually true.",
      "A sole trader counts as a person in law, not a company",
      "The most useful thing on this form.",
      "A few words to group them by, separated by commas.",
      "Write it as though they will read it one day.",
      "Paste a list, one business per line, from a spreadsheet or an email.",
      "It updates as you type.",
      "What they receive",
      "Worth a look once a month.",
      "Mine and unassigned",
      "Download as a spreadsheet",
    ]) {
      expect(words, phrase).toContain(phrase);
    }
  });
});
