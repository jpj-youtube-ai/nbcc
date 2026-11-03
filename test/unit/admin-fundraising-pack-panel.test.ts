// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";
import { applyPackAction, packActionSchema, packToSend, packView, type PackSubject, type StoredPack } from "../../src/fundraising/welcome-pack";

// Each test loads the whole admin page afresh in jsdom: quick alone, but past the usual 5 seconds
// under a full parallel run (as admin-fundraising-page.test.ts).
vi.setConfig({ testTimeout: 20_000 });

// Welcome packs on Admin > Fundraising, in the admin's jsdom harness (as
// admin-fundraising-signup-tidy.test.ts): each approved sign up has a Welcome pack panel with a tick
// list, the address to post it to, who signs the letter, the print buttons and Pack sent; the list
// has a "Pack to send" pill and a "Packs to send" filter. A fake fetch stands in for the API, and
// works out each pack with the server's own rules (src/fundraising/welcome-pack.ts). Every person,
// place and number is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const NONE = { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, qrCount: 0, envelopeCount: 0, shoutOut: false, attend: false };
type Rec = Record<string, unknown> & { id: number };
function fundraiser(id: number, over: Record<string, unknown> = {}): Rec {
  return {
    id, slug: "pk-" + id, path: "raising", kind: "walk", kindLabel: "Walk", title: "Robin's Walk",
    description: "Five miles.", eventDate: null, startTime: null, venue: "", town: "Testtown", targetPence: 50000, public: true,
    status: "approved", name: "Robin Example", firstName: "Robin", lastName: "Example", email: "robin@example.com", phone: "07700 900123",
    socialLink: null, socialOk: false, wants: { ...NONE }, postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null,
    createdAt: "2026-09-20T10:00:00.000Z", approvedAt: "2026-09-21T10:00:00.000Z", approvedBy: "admin:fern@example.com",
    updatedAt: "2026-09-21T10:00:00.000Z", updatedBy: null, pageUrl: "https://nbcc.scot/fundraise/pk-" + id, finishedRequestedAt: null,
    offListAt: null, offListBy: null, inMemory: false, isSporting: null, tshirtSize: null, tshirtAskedAt: null, tshirtAskedBy: null,
    postLine1: "1 Example Road", postLine2: null, postTown: "Exampleton", postPostcode: "EX1 1EX", teamId: null,
    ...over,
  };
}
const meter = { raisedPence: 6000, onlinePence: 6000, cashPence: 0, targetPence: 50000, percent: 12, barPercent: 12, overTarget: false };

let records: Rec[] = [];
let stored: Map<number, StoredPack> = new Map();
let mySigner: { name: string; role: string | null } | null = null;
let packsDown = false;
let perms: PermissionMap;
let role = "admin";
let calls: { method: string; path: string; query: string; body: unknown }[] = [];
let opened: string[] = [];
let requestsRead = 0;

const view = (f: Rec) => packView(f as unknown as PackSubject, stored.get(f.id) ?? null, null);

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve("<!doctype html><title>x</title>"),
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
  if (path === "/api/admin/fundraisers" && method === "GET") return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  if (path === "/api/admin/fundraising/team") return j({ today: "2026-10-03", me: 3, calls: {}, prompts: {}, invites: [], signers: [] });
  if (path === "/api/admin/fundraising/summary") return j({ recipients: [], lastWeek: null });
  if (path === "/api/admin/fundraising/requests") {
    requestsRead += 1;
    return j({ today: "2026-10-03", requests: {}, toDo: {}, notBack: {}, totals: {} });
  }
  if (path === "/api/admin/fundraising/categories") return j({ categories: [] });
  if (path === "/api/admin/fundraising/packs") {
    if (packsDown) return j({ error: "Admin is temporarily unavailable" }, 500);
    const packs: Record<string, unknown> = {};
    const toSend: Record<string, true> = {};
    const sent = new Set([...stored].filter(([, p]) => p.sentAt).map(([id]) => id));
    for (const f of records) {
      const v = view(f);
      if (!v) continue;
      packs[String(f.id)] = v;
      if (packToSend(f as unknown as PackSubject, sent)) toSend[String(f.id)] = true;
    }
    return j({ packs, toSend, mySigner });
  }
  const pack = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/pack$/);
  if (pack && method === "POST") {
    const f = records.find((x) => String(x.id) === pack[1])!;
    const parsed = packActionSchema.safeParse(body);
    if (!parsed.success) return j({ error: "Some of it needs another look", fields: { reason: parsed.error.issues[0].message } }, 400);
    const result = applyPackAction(view(f)!, parsed.data);
    if (!result.ok) return j({ error: result.message }, result.reason === "conflict" ? 409 : 404);
    const p: StoredPack = stored.get(f.id) ?? { sentAt: null, sentBy: null, signer: null, signerRole: null, items: [] };
    const c = result.change;
    if (!c) return j({ pack: view(f), words: "", requests: [] });
    if (c.type === "tick" || c.type === "skip") {
      p.items = p.items.filter((i) => i.key !== c.key).concat({
        key: c.key, label: c.label, quantity: c.quantity, tickedAt: c.type === "tick" ? "2026-10-03T10:00:00.000Z" : null,
        tickedBy: "admin:fern@example.com", skippedReason: c.type === "skip" ? c.reason : null,
      });
    } else if (c.type === "untick") p.items = p.items.filter((i) => i.key !== c.key);
    else if (c.type === "send") Object.assign(p, { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com" });
    else if (c.type === "undo") Object.assign(p, { sentAt: null, sentBy: null });
    else {
      Object.assign(p, { signer: c.name, signerRole: c.role });
      mySigner = { name: c.name, role: c.role };
    }
    stored.set(f.id, p);
    // As the server does: ticking something they asked for marks its request too.
    const requests = c.type === "tick" && c.key === "posters_a4" ? ["Posters: sent (by post)"] : [];
    return j({ pack: view(f), words: result.words, requests });
  }
  const print = path.match(/^\/api\/admin\/fundraisers\/(\d+)\/pack\/print$/);
  if (print) return j({});
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const f = records.find((x) => x.id === Number(m[1]))!;
  const rest = m[2] || "";
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/thanks") return j({ thanks: [] });
  if (rest === "/news") return j({ updates: [] });
  if (rest === "/scans") return j({ scans: [] });
  return j({ error: "not here" }, 404);
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 12; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const row = (id: number) => q(`#frList tr[data-frtoggle="${id}"]`);
const panel = () => q("[data-frpack]") as HTMLElement;
const tick = (key: string) => q(`[data-frpacktick="${key}"]`) as HTMLInputElement;
const posts = () => calls.filter((c) => c.method === "POST" && /\/pack$/.test(c.path));

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
async function press(node: Element | null) {
  expect(node, "the control is there").toBeTruthy();
  (node as HTMLElement).click();
  await settle();
}
async function setTick(key: string, on: boolean) {
  const box = tick(key);
  box.checked = on;
  box.dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
}
function asRole(r: "admin" | "editor" | "viewer") {
  role = r;
  perms = effectivePermissions({ role: r, permissions: null });
}
// What each thing was called when it was ticked: a tick only counts while the list still says the same.
const WORDS: Record<string, string> = { letter: "Welcome letter", sponsor_form: "Sponsor form", posters_a4: "10 A4 posters", tshirt: "NBCC T-shirt, Adult M" };
const tickedItem = (key: string, quantity: number | null = null, label = WORDS[key] ?? key) => ({
  key, label, quantity, tickedAt: "2026-10-03T10:00:00.000Z", tickedBy: "admin:fern@example.com", skippedReason: null,
});

beforeEach(() => {
  records = [
    fundraiser(1, { isSporting: true, tshirtSize: "adult_m", wants: { ...NONE, posterCount: 10 } }),
    fundraiser(2, { status: "new", title: "Sam's New Quiz" }),
    fundraiser(3, { isSporting: true, tshirtSize: null, title: "Sam's Santa Dash" }),
    fundraiser(4, { inMemory: true, memoryName: "Margaret Exampleton", title: "In memory of Margaret Exampleton", wants: { ...NONE, envelopeCount: 30, qrCount: 20 } }),
    fundraiser(5, { path: "event", title: "Exampleton Quiz Night" }),
  ];
  stored = new Map();
  mySigner = null;
  packsDown = false;
  asRole("admin");
  calls = [];
  opened = [];
  requestsRead = 0;
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.prompt = () => "";
  window.alert = () => undefined;
  window.open = ((u: string) => {
    opened.push(String(u));
    return null;
  }) as unknown as typeof window.open;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:pack";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string } | undefined));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the list", () => {
  it("marks each approved sign up whose pack is still to send, and counts them on the filter", async () => {
    await openFundraising();
    expect(text(row(1)!.querySelector(".fr-pack-pill"))).toBe("Pack to send");
    expect(row(2)!.querySelector(".fr-pack-pill")).toBeNull();
    expect(text(row(4)!.querySelector(".fr-pack-pill"))).toBe("Things to send");
    const filter = q('[data-frfilter="packs"]')!;
    expect(text(filter)).toBe("Packs to send (4)");
    await press(filter);
    expect(qa("#frList tr[data-frtoggle]").map((r) => r.getAttribute("data-frtoggle"))).toEqual(["1", "3", "4", "5"]);
  });

  it("drops the pill once the pack is sent", async () => {
    stored.set(5, { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", signer: null, signerRole: null, items: [tickedItem("letter")] });
    await openFundraising();
    expect(row(5)!.querySelector(".fr-pack-pill")).toBeNull();
    expect(text(q('[data-frfilter="packs"]'))).toBe("Packs to send (3)");
  });
});

describe("the Welcome pack panel", () => {
  it("lists what is in this page's pack, each with a tick box, and starts To pack", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector("h4"))).toBe("Welcome pack");
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("To pack");
    expect(text(panel().querySelector(".fr-pack-count"))).toBe("0 of 4 in the pack");
    expect(qa(".fr-pack-item .fr-pack-words").map(text)).toEqual(["Welcome letter", "10 A4 posters", "Sponsor form", "NBCC T-shirt, Adult M"]);
    expect(qa("[data-frpacktick]").every((b) => !(b as HTMLInputElement).checked && !(b as HTMLInputElement).disabled)).toBe(true);
    expect((q("[data-frpacksend]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says that ticking something they asked for also marks its request as done", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fx-help"))).toBe(
      "Everything this page gets in the post. Tick each thing as it goes in, then mark the pack as sent. Ticking something they asked for also marks the request as done.",
    );
    const before = requestsRead;
    await setTick("posters_a4", true);
    // What staff saw goes with the tick, so the server can refuse one for something that has changed.
    expect(posts()[0].body).toEqual({ action: "tick", key: "posters_a4", words: "10 A4 posters", quantity: 10 });
    expect(text(el("frPackStatus"))).toBe("Ticked. Also changed in Requests: Posters: sent (by post).");
    // The Requests part is read again, so it shows the same.
    expect(requestsRead).toBeGreaterThan(before);
  });

  it("says what a tick was for when the sign up has changed since, so it can be ticked again", async () => {
    stored.set(1, { sentAt: null, sentBy: null, signer: null, signerRole: null, items: [tickedItem("posters_a4", 4, "4 A4 posters"), tickedItem("tshirt", null, "NBCC T-shirt, Adult L")] });
    await openFundraising();
    await openRow(1);
    expect(tick("posters_a4").checked).toBe(false);
    expect(tick("posters_a4").disabled).toBe(false);
    expect(text(q('[data-frpackitem="posters_a4"] .fr-pack-who'))).toBe("It was ticked for 4 A4 posters. They now want 10 A4 posters, so it needs ticking again.");
    expect(text(q('[data-frpackitem="tshirt"] .fr-pack-who'))).toBe("It was ticked for size Adult L. They now want Adult M, so it needs ticking again.");
  });

  it("shows the page as it stands when a tick is refused because the list has changed", async () => {
    await openFundraising();
    await openRow(1);
    // They ask for 12 while the page is open: the box on screen still says 10.
    records[0] = fundraiser(1, { isSporting: true, tshirtSize: "adult_m", wants: { ...NONE, posterCount: 12 } });
    await setTick("posters_a4", true);
    expect(text(el("frPackStatus"))).toBe("This has changed since you opened the page. Check the list and tick it again.");
    expect(text(q('[data-frpackitem="posters_a4"] .fr-pack-words'))).toBe("12 A4 posters");
    expect(tick("posters_a4").checked).toBe(false);
  });

  it("asks for a T-shirt left out while it waited to be ticked, once their size has come in", async () => {
    const leftOut = { key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" };
    stored.set(1, { sentAt: null, sentBy: null, signer: null, signerRole: null, items: [tickedItem("letter"), tickedItem("posters_a4", 10), tickedItem("sponsor_form"), leftOut] });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Part packed");
    expect(tick("tshirt").disabled).toBe(false);
    expect(text(q('[data-frpackitem="tshirt"] .fr-pack-who'))).toBe("Their size has come in: Adult M. Tick it when the T-shirt goes in.");
    expect((q("[data-frpacksend]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("flags it on a pack sent before their size came in, which stays Sent", async () => {
    const leftOut = { key: "tshirt", label: "Waiting for T-shirt size", quantity: null, tickedAt: null, tickedBy: "admin:fern@example.com", skippedReason: "Sending it later" };
    stored.set(1, { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", signer: null, signerRole: null, items: [tickedItem("letter"), tickedItem("posters_a4", 10), tickedItem("sponsor_form"), leftOut] });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Sent");
    expect(text(panel().querySelector(".fr-pack-changed"))).toBe("Changed since it was sent");
    expect(text(q('[data-frpackitem="tshirt"] .fr-pack-who'))).toBe("Left out: Sending it later (fern@example.com). Their size has come in since the pack was sent: Adult M.");
    expect(text(panel().querySelector(".fr-pack-count"))).toBe("3 of 4 in, 1 left out");
  });

  it("says what went in a sent pack and is no longer asked for", async () => {
    records[0] = fundraiser(1, { isSporting: true, tshirtSize: "adult_m" }); // no posters asked for now
    stored.set(1, { sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", signer: null, signerRole: null, items: [tickedItem("letter"), tickedItem("posters_a4", 10), tickedItem("sponsor_form"), tickedItem("tshirt")] });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-changed"))).toBe("Changed since it was sent");
    expect(qa(".fr-pack-gone li").map(text)).toEqual(["No longer asked for: 10 A4 posters (it went in the pack)."]);
  });

  it("keeps a sent pack Sent when the sign up changes afterwards, with a small flag", async () => {
    stored.set(1, {
      sentAt: "2026-10-04T09:00:00.000Z", sentBy: "admin:fern@example.com", signer: null, signerRole: null,
      items: [tickedItem("letter"), tickedItem("posters_a4", 4, "4 A4 posters"), tickedItem("sponsor_form"), tickedItem("tshirt")],
    });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Sent");
    expect(text(panel().querySelector(".fr-pack-changed"))).toBe("Changed since it was sent");
    expect(tick("posters_a4").checked).toBe(true);
    expect(text(q('[data-frpackitem="posters_a4"] .fr-pack-who'))).toMatch(/Changed since it was sent: it went as 4 A4 posters\.$/);
    expect(row(1)!.querySelector(".fr-pack-pill")).toBeNull();
  });

  it("shows the address ready to copy: their name, each line, the town and the postcode", async () => {
    await openFundraising();
    await openRow(1);
    expect(qa("#frPackAddress span").map(text)).toEqual(["Robin Example", "1 Example Road", "Exampleton", "EX1 1EX"]);
    expect(q("[data-frpackcopy]")).toBeTruthy();
  });

  it("warns when they gave no address", async () => {
    records[0] = fundraiser(1, { postLine1: null, postTown: null, postPostcode: null });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-address"))).toContain("No address given. Ask them where to post it.");
    expect(q("[data-frpackcopy]")).toBeNull();
  });

  it("ticks a thing, and says who ticked it and when", async () => {
    await openFundraising();
    await openRow(1);
    await setTick("letter", true);
    expect(posts()[0]).toMatchObject({ path: "/api/admin/fundraisers/1/pack", body: { action: "tick", key: "letter" } });
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Part packed");
    expect(tick("letter").checked).toBe(true);
    expect(text(q('[data-frpackitem="letter"] .fr-pack-who'))).toMatch(/^Ticked by fern@example.com on /);
    await setTick("letter", false);
    expect(posts()[1].body).toEqual({ action: "untick", key: "letter" });
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("To pack");
  });

  it("leaves a thing out only with a reason, and can put it back", async () => {
    await openFundraising();
    await openRow(1);
    await press(q('[data-frpackskip="sponsor_form"]'));
    const form = q("#frPackSkipForm") as HTMLFormElement;
    expect(text(form.querySelector("label"))).toBe("Why is it being left out?");
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(posts()).toHaveLength(0);
    expect(text(el("frPackStatus"))).toBe("Say why it is being left out.");
    (q("#frPackSkipReason") as HTMLInputElement).value = "They have one";
    q("#frPackSkipForm")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(posts()[0].body).toEqual({ action: "skip", key: "sponsor_form", words: "Sponsor form", quantity: null, reason: "They have one" });
    // Left out is not in the pack: the count says so.
    expect(text(panel().querySelector(".fr-pack-count"))).toBe("0 of 4 in, 1 left out");
    expect(text(q('[data-frpackitem="sponsor_form"] .fr-pack-who'))).toMatch(/^Left out: They have one/);
    expect(tick("sponsor_form").disabled).toBe(true);
    await press(q('[data-frpackback="sponsor_form"]'));
    expect(posts()[1].body).toEqual({ action: "untick", key: "sponsor_form" });
  });

  it("offers Pack sent once everything is ticked, then shows the date and who, with Undo", async () => {
    stored.set(1, { sentAt: null, sentBy: null, signer: null, signerRole: null, items: [tickedItem("letter"), tickedItem("posters_a4", 10), tickedItem("sponsor_form")] });
    await openFundraising();
    await openRow(1);
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Part packed");
    await setTick("tshirt", true);
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Ready to send");
    const send = q("[data-frpacksend]") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(text(send)).toBe("Pack sent");
    await press(send);
    expect(posts()[1].body).toEqual({ action: "send" });
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Sent");
    expect(text(panel().querySelector(".fr-pack-sent"))).toMatch(/^Sent on .* by fern@example.com$/);
    expect(qa("[data-frpacktick]").every((b) => (b as HTMLInputElement).disabled)).toBe(true);
    expect(row(1)!.querySelector(".fr-pack-pill")).toBeNull();
    await press(q("[data-frpackundo]"));
    expect(posts()[2].body).toEqual({ action: "undo" });
    expect(text(panel().querySelector(".fr-pack-state"))).toBe("Ready to send");
  });

  it("shows Waiting for T-shirt size, not tickable, with the button to ask them", async () => {
    await openFundraising();
    await openRow(3);
    const item = q('[data-frpackitem="tshirt"]')!;
    expect(text(item.querySelector(".fr-pack-words"))).toBe("Waiting for T-shirt size");
    expect(tick("tshirt").disabled).toBe(true);
    expect(text(item.querySelector("[data-frtshirtask]"))).toBe("Ask them for their T-shirt size");
    await press(item.querySelector("[data-frtshirtask]"));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/admin/fundraisers/3/tshirt-ask")).toBe(true);
  });

  it("has no panel for a sign up that is not approved", async () => {
    await openFundraising();
    await openRow(2);
    expect(q("[data-frpack]")).toBeNull();
  });

  it("says so when the packs cannot load", async () => {
    packsDown = true;
    await openFundraising();
    await openRow(1);
    expect(text(panel())).toContain("The welcome pack could not load just now.");
    expect(q("[data-frpacktick]")).toBeNull();
  });
});

describe("who signs the letter, and printing", () => {
  it("offers the Signed by list, starting with whoever this staff member chose last", async () => {
    mySigner = { name: helpers.SIGNERS[2].name, role: helpers.SIGNERS[2].role };
    await openFundraising();
    await openRow(1);
    const select = el("frPackSigner") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(helpers.SIGNERS.map((s: { name: string }) => s.name));
    expect(select.value).toBe(helpers.SIGNERS[2].name);
    expect(text(q('label[for="frPackSigner"]'))).toBe("Signed by");
  });

  it("keeps a change of signer for this pack", async () => {
    await openFundraising();
    await openRow(1);
    const select = el("frPackSigner") as HTMLSelectElement;
    select.value = helpers.SIGNERS[1].name;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(posts()[0].body).toEqual({ action: "signer", name: helpers.SIGNERS[1].name, role: helpers.SIGNERS[1].role });
    expect((el("frPackSigner") as HTMLSelectElement).value).toBe(helpers.SIGNERS[1].name);
  });

  it("prints the whole pack as one page, keeping who signs it first", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(q('[data-frpackprint="all"]'))).toBe("Print welcome pack");
    await press(q('[data-frpackprint="all"]'));
    expect(posts()[0].body).toEqual({ action: "signer", name: helpers.SIGNERS[0].name, role: helpers.SIGNERS[0].role });
    const got = calls.filter((c) => c.path === "/api/admin/fundraisers/1/pack/print");
    expect(got).toHaveLength(1);
    expect(got[0].query).toBe("");
    expect(opened.length).toBeGreaterThan(0);
  });

  it("prints the letter on its own", async () => {
    stored.set(1, { sentAt: null, sentBy: null, signer: helpers.SIGNERS[0].name, signerRole: helpers.SIGNERS[0].role, items: [] });
    await openFundraising();
    await openRow(1);
    expect(text(q('[data-frpackprint="letter"]'))).toBe("Print letter only");
    await press(q('[data-frpackprint="letter"]'));
    expect(posts()).toHaveLength(0);
    expect(calls.find((c) => c.path === "/api/admin/fundraisers/1/pack/print")!.query).toBe("part=letter");
  });
});

describe("in memory", () => {
  it("is titled Things to send, lists exactly what they asked for, and says whose address it may be", async () => {
    await openFundraising();
    await openRow(4);
    expect(text(panel().querySelector("h4"))).toBe("Things to send");
    expect(qa(".fr-pack-item .fr-pack-words").map(text)).toEqual(["Covering note", "20 QR cards for the order of service", "30 collection envelopes"]);
    expect(text(panel().querySelector(".fr-pack-address"))).toContain("This can be the funeral director's address.");
    // Nothing of theirs to print but the note: one button.
    expect(q('[data-frpackprint="all"]')).toBeNull();
    expect(text(q('[data-frpackprint="letter"]'))).toBe("Print the note");
    expect(text(q("[data-frpacksend]"))).toBe("Sent");
    expect(text(panel())).not.toMatch(/T-shirt|Welcome letter|welcome pack/i);
  });
});

describe("in memory, with posters", () => {
  it("offers the note with their posters, or the note on its own", async () => {
    records[3] = fundraiser(4, { inMemory: true, memoryName: "Margaret Exampleton", wants: { ...NONE, envelopeCount: 30, posterCount: 3 } });
    await openFundraising();
    await openRow(4);
    expect(text(q('[data-frpackprint="all"]'))).toBe("Print the note and posters");
    expect(text(q('[data-frpackprint="letter"]'))).toBe("Print note only");
  });
});

describe("a viewer", () => {
  it("reads the list and can print, but cannot tick, leave out, choose who signs or mark it sent", async () => {
    asRole("viewer");
    stored.set(1, { sentAt: null, sentBy: null, signer: helpers.SIGNERS[1].name, signerRole: helpers.SIGNERS[1].role, items: [tickedItem("letter")] });
    await openFundraising();
    await openRow(1);
    expect(qa(".fr-pack-item .fr-pack-words")).toHaveLength(4);
    expect(qa("[data-frpacktick]").every((b) => (b as HTMLInputElement).disabled)).toBe(true);
    expect(tick("letter").checked).toBe(true);
    expect(q("[data-frpackskip]")).toBeNull();
    expect(q("[data-frpacksend]")).toBeNull();
    expect(q("#frPackSigner")).toBeNull();
    expect(text(panel().querySelector(".fr-pack-sign"))).toBe("Signed by " + helpers.SIGNERS[1].name);
    await press(q('[data-frpackprint="all"]'));
    expect(posts()).toHaveLength(0);
    expect(calls.some((c) => c.path === "/api/admin/fundraisers/1/pack/print")).toBe(true);
  });
});
