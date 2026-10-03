// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Profile pictures (Jaimie, 2026-10-03): the photos organisers send, in Admin > Fundraising, in the
// admin's jsdom harness (as admin-fundraising-news-panel.test.ts): a "Photos to check" pill on a sign
// up with photos waiting, and a "Photos from the organiser" panel in the open sign up with each photo
// (fetched with the admin's own sign in, as a waiting photo has no public address) shown as the page
// will show it, Approve and Don't use (with an optional note the organiser sees), and Take it off for
// a round photo in use. Every name here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Rec = Record<string, unknown> & { id: number };
const fundraiser = (id: number, over: Record<string, unknown> = {}): Rec => ({
  id,
  slug: "test-walk-" + id,
  path: "raising",
  kind: "run_walk",
  kindLabel: "A run or walk",
  title: "Test Walk " + id,
  description: "Ten miles.",
  eventDate: "2026-12-05",
  startTime: null,
  venue: "",
  town: "Testtown",
  targetPence: 25000,
  public: true,
  status: "approved",
  name: "Robin Example",
  email: "robin@example.com",
  phone: "07700 900123",
  socialLink: null,
  socialOk: false,
  wants: { leaflets: 0, buckets: 0, shoutOut: false, attend: false },
  postAddress: null,
  newsletterOk: false,
  imageSrc: null,
  declinedReason: null,
  createdAt: "2026-09-20T10:00:00.000Z",
  approvedAt: "2026-09-21T10:00:00.000Z",
  approvedBy: "admin:fern@example.com",
  updatedAt: "2026-09-21T10:00:00.000Z",
  updatedBy: null,
  pageUrl: "https://nbcc.scot/fundraise/test-walk-" + id,
  ...over,
});
const meter = { raisedPence: 0, onlinePence: 0, cashPence: 0, targetPence: 25000, percent: 0, barPercent: 0, overTarget: false };

type Pic = Record<string, unknown> & { id: number; status: string; kind: string };
const pic = (id: number, over: Record<string, unknown> = {}): Pic => ({
  id,
  kind: "profile",
  status: "pending",
  statusWords: "Waiting for us to check",
  createdAt: "2026-11-20T10:00:00.000Z",
  photoUrl: `/api/admin/fundraisers/1/pictures/${id}/photo`,
  note: null,
  width: 400,
  height: 400,
  decidedAt: null,
  decidedBy: null,
  ...over,
});

let records: Rec[] = [];
let pictures: Record<number, Pic[]> = {};
let perms: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let role = "admin";
let calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
let picsFail = false;

function respond(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    blob: () => Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path, body, auth: (init?.headers && init.headers.Authorization) || null });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role: role as "admin", now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: perms });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/fundraising/settings") return j({ pageOn: true, updatedAt: null, updatedBy: null });
  if (path === "/api/admin/fundraising/pictures-waiting") {
    const counts: Record<number, number> = {};
    for (const [id, list] of Object.entries(pictures)) {
      const n = list.filter((p) => p.status === "pending").length;
      if (n) counts[Number(id)] = n;
    }
    return j({ counts });
  }
  if (path === "/api/admin/fundraisers" && method === "GET") {
    return j({ pageOn: true, fundraisers: records.map((f) => ({ ...f, meter, editWaiting: false })) });
  }
  const m = path.match(/^\/api\/admin\/fundraisers\/(\d+)(\/.*)?$/);
  if (!m) return j({ results: [] });
  const id = Number(m[1]);
  const rest = m[2] || "";
  const f = records.find((r) => r.id === id);
  if (!f) return j({ error: "That no longer exists" }, 404);
  if (rest === "" && method === "GET") return j({ fundraiser: f, meter, waitingEdit: null, editWaiting: false, edits: [], cash: [], wall: [] });
  if (rest === "/history") return j({ history: [] });
  if (rest === "/news") return j({ updates: [] });
  if (rest === "/pictures") return picsFail ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ pictures: pictures[id] || [], title: f.title, organisedBy: "Robin E." });
  if (/^\/pictures\/\d+\/photo$/.test(rest)) return j({});
  const del = rest.match(/^\/pictures\/(\d+)\/delete$/);
  if (del && method === "POST") {
    pictures[id] = (pictures[id] || []).filter((x) => x.id !== Number(del[1]));
    return j({ deleted: true });
  }
  const d = rest.match(/^\/pictures\/(\d+)\/(approve|decline|remove)$/);
  if (d && method === "POST") {
    const p = (pictures[id] || []).find((x) => x.id === Number(d[1]))!;
    const to = { approve: "approved", decline: "declined", remove: "removed" }[d[2]]!;
    Object.assign(p, { status: to, decidedBy: "admin:fern@example.com", note: d[2] === "decline" ? (body && body.reason) || null : p.note });
    if (d[2] === "approve" && p.kind === "main") f.imageSrc = "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    if (d[2] === "remove" && p.kind === "main") f.imageSrc = null;
    return j({ picture: p });
  }
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
const panel = () => q("#frPics");
const item = (id: number) => panel()!.querySelector(`[data-frpicitem="${id}"]`);
const posts = () => calls.filter((c) => c.method === "POST" && /\/pictures\//.test(c.path));

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

let confirmed: string[] = [];
let confirmAnswer = true;

beforeEach(() => {
  records = [fundraiser(1), fundraiser(2)];
  pictures = {
    1: [
      pic(41),
      pic(40, { status: "approved", statusWords: "On your page" }),
      pic(39, { kind: "main" }),
      pic(38, { status: "replaced", statusWords: "Replaced by a newer one" }),
    ],
  };
  perms = effectivePermissions({ role: "admin", permissions: null });
  role = "admin";
  calls = [];
  picsFail = false;
  confirmed = [];
  confirmAnswer = true;
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (msg?: string) => {
    confirmed.push(String(msg));
    return confirmAnswer;
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

describe("the Photos to check pill", () => {
  it("is on a sign up with photos waiting, and not on one without", async () => {
    await openFundraising();
    expect(row(1)?.querySelector(".fr-pics-pill")?.textContent).toBe("Photos to check");
    expect(row(2)?.querySelector(".fr-pics-pill")).toBeNull();
  });
});

describe("the Photos from the organiser panel", () => {
  it("shows each photo, waiting ones first, and not the ones a newer one replaced", async () => {
    await openFundraising();
    await openRow(1);
    const p = panel()!;
    expect(p.closest("section")?.querySelector("h4")?.textContent).toBe("Photos from the organiser");
    const ids = Array.from(p.querySelectorAll("[data-frpicitem]")).map((i) => i.getAttribute("data-frpicitem"));
    expect(ids).toEqual(["41", "39", "40"]);
    expect(text(item(41))).toContain("Round photo");
    expect(text(item(41))).toContain("Waiting for you to check");
    expect(text(item(39))).toContain("Main photo");
    expect(text(item(40))).toContain("In use on the page");
  });

  it("shows a round photo as the page will, beside the name, fetched with the admin's own sign in", async () => {
    await openFundraising();
    await openRow(1);
    const photoCall = calls.find((c) => c.path === "/api/admin/fundraisers/1/pictures/41/photo");
    expect(photoCall?.auth).toMatch(/^Bearer /);
    const img = item(41)!.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toMatch(/^data:image\/jpeg;base64,/);
    expect(img.className).toContain("fr-pic-round");
    expect(text(item(41))).toContain("Organised by Robin E.");
    expect((item(39)!.querySelector("img") as HTMLImageElement).className).toContain("fr-pic-main");
  });

  it("says when there are none yet", async () => {
    await openFundraising();
    await openRow(2);
    expect(text(panel())).toContain("No photos from the organiser yet.");
  });

  it("says when they could not load, and the rest of the sign up still shows", async () => {
    picsFail = true;
    await openFundraising();
    await openRow(1);
    expect(text(panel())).toContain("The photos could not load just now.");
    expect(q("#frHistory")).not.toBeNull();
  });

  it("approves a round photo after asking, and says it is on the page", async () => {
    await openFundraising();
    await openRow(1);
    (item(41)!.querySelector('[data-frpic="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toContain("beside their name on their page straight away");
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/pictures/41/approve"]);
    expect(text(q("#frPicsStatus"))).toBe("Approved. It is on their page now.");
    expect(text(item(41))).toContain("In use on the page");
    expect(row(1)?.querySelector(".fr-pics-pill")).not.toBeNull(); // the main photo still waits
  });

  it("approving a main photo makes it the page's photo, and the page photo panel shows it", async () => {
    await openFundraising();
    await openRow(1);
    (item(39)!.querySelector('[data-frpic="approve"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toContain("the photo at the top of their page");
    expect(q(".fr-detail img.fr-photo")?.getAttribute("src")).toBe("/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d");
  });

  it("sends nothing when the question is answered no", async () => {
    confirmAnswer = false;
    await openFundraising();
    await openRow(1);
    (item(41)!.querySelector('[data-frpic="approve"]') as HTMLElement).click();
    await settle();
    expect(posts()).toEqual([]);
  });

  it("does not use one, with the note for the organiser", async () => {
    await openFundraising();
    await openRow(1);
    const note = item(41)!.querySelector("[data-frpicnote]") as HTMLTextAreaElement;
    expect(text(item(41)!.querySelector(`label[for="${note.id}"]`))).toBe("A note for the organiser (optional). They see it in their private area.");
    note.value = "Could you send one with just you in it?";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    (item(41)!.querySelector('[data-frpic="decline"]') as HTMLElement).click();
    await settle();
    expect(posts()[0]).toMatchObject({ path: "/api/admin/fundraisers/1/pictures/41/decline", body: { reason: "Could you send one with just you in it?" } });
    expect(text(item(41))).toContain("Not used");
    expect(text(item(41))).toContain("Could you send one with just you in it?");
  });

  it("has a checklist for staff", async () => {
    await openFundraising();
    await openRow(1);
    expect(text(panel())).toContain(
      "Check: it is them or their day; everyone in it looks happy to be there; no child is named or shown in school uniform; no address, car number plate or anything private shows.",
    );
  });

  it("takes a main photo in use off the page too, and the page photo panel no longer shows it", async () => {
    pictures[1][2] = pic(39, { kind: "main", status: "approved", statusWords: "On your page" });
    records[0].imageSrc = "/media/events/1b5c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d";
    await openFundraising();
    await openRow(1);
    (item(39)!.querySelector('[data-frpic="remove"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toContain("comes off their page straight away");
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/pictures/39/remove"]);
    expect(text(item(39))).toContain("Taken off the page");
    expect(q(".fr-detail img.fr-photo")).toBeNull();
  });

  it("lets an admin delete a photo for good, after asking", async () => {
    await openFundraising();
    await openRow(1);
    (item(40)!.querySelector('[data-frpic="delete"]') as HTMLElement).click();
    await settle();
    expect(confirmed.pop()).toContain("Delete this photo for good?");
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/pictures/40/delete"]);
    expect(item(40)).toBeNull();
    expect(text(q("#frPicsStatus"))).toBe("Deleted for good.");
  });

  it("offers deleting for good only to an admin", async () => {
    asRole("editor");
    await openFundraising();
    await openRow(1);
    expect(panel()!.querySelector('[data-frpic="delete"]')).toBeNull();
    expect(panel()!.querySelector('[data-frpic="approve"]')).not.toBeNull();
  });

  it("says when only the record of a photo is left", async () => {
    pictures[1].push(pic(37, { status: "declined", statusWords: "Not used", photoUrl: null }));
    await openFundraising();
    await openRow(1);
    expect(text(item(37))).toContain("The photo itself has been deleted. Only this record of it is kept.");
  });

  it("takes a round photo in use off the page", async () => {
    await openFundraising();
    await openRow(1);
    (item(40)!.querySelector('[data-frpic="remove"]') as HTMLElement).click();
    await settle();
    expect(posts().map((c) => c.path)).toEqual(["/api/admin/fundraisers/1/pictures/40/remove"]);
    expect(text(item(40))).toContain("Taken off the page");
  });

  it("lets someone who can only look see the photos, with no buttons", async () => {
    asRole("viewer");
    await openFundraising();
    await openRow(1);
    expect(panel()!.querySelectorAll("[data-frpicitem]").length).toBe(3);
    expect(panel()!.querySelector("[data-frpic]")).toBeNull();
    expect(panel()!.querySelector("[data-frpicnote]")).toBeNull();
  });
});
