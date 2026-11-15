// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// Admin > Giving > Business supporters, in the kit's look (2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-supporters.md). Tiles that count and filter, whoever
// needs something first, a card per business that opens in place in three parts, Copy buttons, every
// question asked in the page and every answer said beside the button that was pressed.
// Same harness as admin-business-calls-page.test.ts: admin.html's <body> in jsdom, a fake fetch,
// app.js evaluated against it. Every business, name, address and number here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Row = Record<string, unknown> & { id: number };
/** A business that has been invited and has not answered: nothing for anyone to do. */
function row(id: number, over: Record<string, unknown> = {}): Row {
  return {
    id,
    donor_id: 100 + id,
    donor_name: "Contact " + id,
    business_name: "Business " + id,
    donor_email: "hello" + id + "@example.com",
    monthly_pence: 5000,
    band: "gold",
    created_at: "2026-03-01T10:00:00Z",
    captured_at: null,
    invited_at: "2026-03-02T10:00:00Z",
    perks_sent_at: null,
    credit_name: null,
    website: null,
    socials: null,
    list_on_supporters: false,
    want_social: false,
    want_badge: false,
    want_certificate: false,
    certificate_delivery: null,
    certificate_address: null,
    social_done: false,
    certificate_posted: false,
    thank_you_sent_at: null,
    thank_you_sent_by: null,
    phone: null,
    last_called_at: null,
    last_called_by: null,
    last_call_note: null,
    supporting: true,
    supporting_since: "2026-03-01T10:00:00Z",
    callDue: false,
    callDueOn: "2026-12-15",
    ...over,
  };
}
/** The same business once it has filled in the form. */
const answered = (id: number, over: Record<string, unknown> = {}) => row(id, { captured_at: "2026-03-05T10:00:00Z", ...over });

let rows: Row[] = [];
let listStatus = 200;
let markStatus = 200;
let inviteAnswer: { status: number; body: unknown } = { status: 200, body: { pending: 1, sent: 1, failed: 0, alreadyInvited: false } };
let backfillAnswer: { status: number; body: unknown } = { status: 200, body: { pending: 2, sent: 2, failed: 0 } };
let permissions: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let calls: { url: string; method: string; body: unknown }[] = [];
let copied: string[] = [];
let clipboardWorks = true;

const adminToken = signAdminSession({ sub: 3, email: "fern@example.com", role: "admin", now: new Date(), secret: "s" }).token;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const path = url.split("?")[0];
  const method = (init?.method || "GET").toUpperCase();
  calls.push({ url: path, method, body: init?.body ? JSON.parse(init.body) : null });
  if (path === "/api/admin/login") return j({ token: adminToken, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", fullName: "Fern Example", permissions });
  const mark = path.match(/^\/api\/admin\/fulfilments\/(\d+)\/mark$/);
  if (mark && method === "POST") {
    if (markStatus !== 200) return j({ error: "Admin update is temporarily unavailable" }, markStatus);
    const r = rows.find((x) => x.id === Number(mark[1]))!;
    r[(JSON.parse(init?.body || "{}") as { flag: string }).flag] = true;
    return j({ id: r.id, value: true, record: r });
  }
  const invite = path.match(/^\/api\/admin\/business-supporters\/(\d+)\/send-invite$/);
  if (invite && method === "POST") {
    if (inviteAnswer.status === 200 && (inviteAnswer.body as { sent?: number }).sent) {
      rows.find((x) => x.id === Number(invite[1]))!.invited_at = "2026-11-14T09:00:00Z";
    }
    return j(inviteAnswer.body, inviteAnswer.status);
  }
  if (path === "/api/admin/business-supporters/backfill-invites" && method === "POST") return j(backfillAnswer.body, backfillAnswer.status);
  if (/^\/api\/admin\/fulfilments\/\d+\/history$/.test(path)) return j({ results: [] });
  if (path === "/api/admin/fulfilments") {
    if (listStatus !== 200) return j({ error: "Admin is temporarily unavailable" }, listStatus);
    return j({ results: rows });
  }
  if (/^\/api\/admin\/donors\/\d+$/.test(path)) return j({ fullName: "Contact", email: "c@example.com" });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const view = () => el("view-fulfilments");
const q = (sel: string) => view().querySelector(sel) as HTMLElement | null;
const listCalls = () => calls.filter((c) => c.url === "/api/admin/fulfilments" && c.method === "GET").length;
const posts = () => calls.filter((c) => c.method !== "GET" && c.url !== "/api/admin/login" && !c.url.includes("whats-new"));
const shownIds = () => [...view().querySelectorAll("[data-fulfil-toggle]")].map((b) => Number(b.getAttribute("data-fulfil-toggle")));
const tile = (key: string) => q(`#fulfilmentTiles [data-fx-filter="${key}"]`) as HTMLElement;
const tileCount = (key: string) => tile(key).querySelector(".ak-tile__n")!.textContent;
const face = (id: number) => q(`[data-fulfil-toggle="${id}"]`) as HTMLElement;

async function openSupporters() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  face(id).click();
  await settle();
}

beforeEach(() => {
  rows = [];
  listStatus = 200;
  markStatus = 200;
  inviteAnswer = { status: 200, body: { pending: 1, sent: 1, failed: 0, alreadyInvited: false } };
  backfillAnswer = { status: 200, body: { pending: 2, sent: 2, failed: 0 } };
  permissions = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  copied = [];
  clipboardWorks = true;
  window.sessionStorage.clear();
  window.localStorage.clear();
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  // Nothing on this screen may ask through the browser's own boxes any more.
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        if (!clipboardWorks) return Promise.reject(new Error("refused"));
        copied.push(text);
        return Promise.resolve();
      },
    },
  });
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

// One of each kind of business: 1 is due a call and has a job waiting, 6 has a job waiting, 2 has
// not been invited, 3 has been invited and not answered, 4 and 5 need nothing. Sent in the order the
// server sends them, newest record first.
const oneOfEach = () => [
  answered(6, { want_social: true }),
  answered(5, { want_certificate: true, certificate_delivery: "post", certificate_posted: true }),
  answered(4),
  row(3),
  row(2, { invited_at: null }),
  answered(1, { want_social: true, callDue: true, callDueOn: "2026-09-01" }),
];

describe("the screen in the kit's look", () => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const section = doc.getElementById("view-fulfilments")!;

  it("takes the kit's look, with one plain sentence under its title", () => {
    expect(section.classList.contains("ak")).toBe(true);
    const intro = section.querySelector(".admin-view-intro")!.textContent || "";
    expect(intro).toContain("businesses that give every month");
    expect(intro).not.toMatch(/recognition band|fulfils/);
    // What the old sentence promised is still said: what is marked is kept in the Audit trail.
    expect(intro).toContain("Audit");
  });

  it("is no longer a table in a box that can scroll sideways", () => {
    expect(doc.getElementById("fulfilmentsTable")!.classList.contains("admin-table-wrap")).toBe(false);
  });

  it("starts with its tiles and tools hidden, so nothing is counted before the list has come", () => {
    expect(doc.getElementById("fulfilmentTiles")!.hasAttribute("hidden")).toBe(true);
    expect(doc.getElementById("fulfilmentTools")!.hasAttribute("hidden")).toBe(true);
  });
});

describe("tiles that count and filter", () => {
  it("counts each kind of business", async () => {
    rows = oneOfEach();
    await openSupporters();
    expect(el("fulfilmentTiles").hidden).toBe(false);
    expect(tileCount("call")).toBe("1");
    expect(tileCount("todo")).toBe("2");
    expect(tileCount("waiting")).toBe("1");
    expect(tileCount("invite")).toBe("1");
    expect(tileCount("done")).toBe("2");
    expect(tileCount("all")).toBe("6");
    expect([...el("fulfilmentTiles").querySelectorAll(".ak-tile__name")].map((n) => n.textContent)).toEqual([
      "Time to call", "Things to do", "Waiting for their form", "Invite not sent", "All done", "Everyone",
    ]);
  });

  it("opens on everyone, and shows only the kind whose tile is pressed", async () => {
    rows = oneOfEach();
    await openSupporters();
    expect(tile("all").getAttribute("aria-pressed")).toBe("true");
    expect(shownIds()).toHaveLength(6);
    tile("todo").click();
    expect(shownIds().sort()).toEqual([1, 6]);
    expect(tile("todo").getAttribute("aria-pressed")).toBe("true");
    expect(tile("all").getAttribute("aria-pressed")).toBe("false");
    tile("call").click();
    expect(shownIds()).toEqual([1]);
    tile("invite").click();
    expect(shownIds()).toEqual([2]);
    tile("waiting").click();
    expect(shownIds()).toEqual([3]);
    tile("done").click();
    expect(shownIds().sort()).toEqual([4, 5]);
    tile("all").click();
    expect(shownIds()).toHaveLength(6);
  });

  it("says so when a tile has nobody in it", async () => {
    rows = [answered(4)];
    await openSupporters();
    tile("call").click();
    expect(el("fulfilmentsTable").textContent).toContain("Nobody here just now.");
    expect(tile("call").classList.contains("is-none")).toBe(true);
  });

  it("filters without asking the server again", async () => {
    rows = oneOfEach();
    await openSupporters();
    const before = listCalls();
    tile("todo").click();
    tile("all").click();
    await settle();
    expect(listCalls()).toBe(before);
  });

  it("hides the tiles when the list could not load, rather than counting nobody", async () => {
    listStatus = 500;
    await openSupporters();
    expect(el("fulfilmentTiles").hidden).toBe(true);
    expect(el("fulfilmentTools").hidden).toBe(true);
    expect(el("fulfilmentsTable").textContent).toContain("Business supporters are unavailable.");
  });
});

describe("whoever needs something comes first", () => {
  it("puts a call due first, then jobs, then an invite to send, then the rest", async () => {
    rows = oneOfEach();
    await openSupporters();
    expect(shownIds()).toEqual([1, 6, 2, 3, 5, 4]);
  });

  it("heads the two halves of the list, so it is plain where the work stops", async () => {
    rows = oneOfEach();
    await openSupporters();
    expect([...view().querySelectorAll("#fulfilmentsTable .ak-group")].map((h) => h.textContent)).toEqual([
      "Needs you", "Nothing needed just now",
    ]);
  });
});

describe("the closed card", () => {
  it("is a card that opens in place, not a table row", async () => {
    rows = [row(1)];
    await openSupporters();
    expect(q("#fulfilmentsTable table")).toBeNull();
    expect(face(1).tagName).toBe("BUTTON");
    expect(face(1).getAttribute("aria-expanded")).toBe("false");
    expect(face(1).closest(".ak-item")).not.toBeNull();
  });

  it("says when the next call is due, in words", async () => {
    rows = [row(1, { callDueOn: "2026-12-15" })];
    await openSupporters();
    expect(face(1).textContent).toContain("Next call 15 December");
  });

  it("marks a business whose gift has stopped", async () => {
    rows = [row(1, { supporting: false, callDueOn: null }), row(2)];
    await openSupporters();
    expect(face(1).textContent).toContain("Stopped giving");
    expect(face(1).textContent).not.toContain("Next call");
    expect(face(2).textContent).not.toContain("Stopped giving");
  });

  it("says what they give a month", async () => {
    rows = [row(1, { monthly_pence: 7500 }), row(2, { monthly_pence: null })];
    await openSupporters();
    expect(face(1).textContent).toContain("£75 a month");
    expect(face(2).textContent).not.toContain("a month");
  });

  it("keeps the band, the contact's name and where they are up to", async () => {
    rows = [answered(1, { band: "platinum", want_social: true, want_certificate: true, certificate_delivery: "post" })];
    await openSupporters();
    const text = face(1).textContent || "";
    expect(text).toContain("Business 1");
    expect(text).toContain("Contact 1");
    expect(text).toContain("Platinum");
    expect(text).toContain("2 things to do");
  });
});

describe("opening a business", () => {
  it("opens and closes without reading the whole list again", async () => {
    rows = [answered(1, { want_social: true }), row(2)];
    await openSupporters();
    const before = listCalls();
    await openRow(1);
    expect(face(1).getAttribute("aria-expanded")).toBe("true");
    expect(q('[data-fx-open="1"]')).not.toBeNull();
    await openRow(1);
    expect(face(1).getAttribute("aria-expanded")).toBe("false");
    expect(q('[data-fx-open="1"]')).toBeNull();
    expect(listCalls()).toBe(before);
  });

  it("keeps you on the button you pressed", async () => {
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    expect(document.activeElement).toBe(face(1));
  });

  it("shows one part at a time: what to do, what they asked for, and the history", async () => {
    rows = [answered(1, { want_social: true })];
    await openSupporters();
    await openRow(1);
    const parts = [...view().querySelectorAll('[data-fx-open="1"] [data-akpart]')];
    expect(parts.map((b) => (b.textContent || "").trim())).toEqual(["What to do", "What they asked for", "History"]);
    const body = (key: string) => q(`[data-fx-open="1"] [data-akpart-body="${key}"]`) as HTMLElement;
    expect(body("todo").hidden).toBe(false);
    expect(body("asked").hidden).toBe(true);
    expect(body("history").hidden).toBe(true);
    (q('[data-fx-open="1"] [data-akpart="asked"]') as HTMLElement).click();
    expect(body("todo").hidden).toBe(true);
    expect(body("asked").hidden).toBe(false);
  });

  it("puts every panel in a part, the call and the jobs first", async () => {
    rows = [answered(1, { want_social: true })];
    await openSupporters();
    await openRow(1);
    const heads = (key: string) => [...view().querySelectorAll(`[data-akpart-body="${key}"] h4`)].map((h) => h.textContent);
    expect(heads("todo")).toEqual(["Thank you call", "What to do next", "Their invite"]);
    expect(heads("asked")).toEqual(["What they asked for", "Already done for you", "Thank-you letter"]);
    expect(heads("history")).toEqual(["History"]);
  });

  it("marks the first part when something in it is waiting, and not when nothing is", async () => {
    rows = [answered(1, { want_social: true }), answered(2)];
    await openSupporters();
    await openRow(1);
    expect(q('[data-fx-open="1"] [data-akpart="todo"] .ak-part-dot')).not.toBeNull();
    await openRow(2);
    expect(q('[data-fx-open="2"] [data-akpart="todo"] .ak-part-dot')).toBeNull();
  });

  it("stays on the part you were reading when something is saved", async () => {
    rows = [answered(1, { want_social: true })];
    await openSupporters();
    await openRow(1);
    (q('[data-fx-open="1"] [data-akpart="asked"]') as HTMLElement).click();
    (q('[data-fx-open="1"] [data-akpart="todo"]') as HTMLElement).click();
    (q('[data-fulfil-mark="social_done"]') as HTMLElement).click();
    (q("[data-fulfil-mark-yes]") as HTMLElement).click();
    await settle();
    expect((q('[data-fx-open="1"] [data-akpart-body="todo"]') as HTMLElement).hidden).toBe(false);
  });

  it("gives their email as a link, and says what they give", async () => {
    rows = [row(1, { donor_email: "morag@example.com", monthly_pence: 5000 })];
    await openSupporters();
    await openRow(1);
    const link = q('[data-fx-open="1"] a[href^="mailto:"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("mailto:morag@example.com");
    expect(link.textContent).toBe("morag@example.com");
    expect(q('[data-fx-open="1"]')!.textContent).toContain("£50 a month");
  });

  it("writes its dates as people say them", async () => {
    rows = [answered(1, { captured_at: "2026-03-05T10:00:00Z", thank_you_sent_at: "2026-03-06T08:00:00Z", thank_you_sent_by: "automatic", callDueOn: "2026-12-15" })];
    await openSupporters();
    await openRow(1);
    const text = q('[data-fx-open="1"]')!.textContent || "";
    expect(text).toContain("Form submitted 5 March 2026");
    expect(text).toContain("Sent 6 March 2026");
    expect(text).toContain("Next call due 15 December 2026");
    expect(text).not.toMatch(/\d\d\/\d\d\/\d{4}/);
  });
});

describe("See their giving", () => {
  it("opens the donor's page for someone who may see Donations", async () => {
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    const btn = q('[data-fx-open="1"] [data-donor="101"]') as HTMLElement;
    expect(btn.textContent).toBe("See their giving");
    btn.click();
    await settle();
    expect(el("view-donor").hidden).toBe(false);
  });

  it("is not offered to someone who may not", async () => {
    permissions = { ...effectivePermissions({ role: "admin", permissions: null }), donations: "none" };
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    expect(q('[data-fx-open="1"] [data-donor]')).toBeNull();
  });
});

describe("Copy buttons", () => {
  const full = () =>
    answered(1, {
      credit_name: "Example Bakery of Kilmarnock",
      website: "https://bakery.example.com",
      socials: "@examplebakery",
      want_social: true,
      want_certificate: true,
      certificate_delivery: "post",
      certificate_address: "1 Made Up Street\nExampletown\nKA1 1AA",
    });

  it("copies the address a certificate is posted to, and says so beside the button", async () => {
    rows = [full()];
    await openSupporters();
    await openRow(1);
    const btn = q('[data-fx-copy="address"]') as HTMLElement;
    expect(btn.textContent).toBe("Copy address");
    btn.click();
    await settle();
    expect(copied).toEqual(["1 Made Up Street\nExampletown\nKA1 1AA"]);
    expect(btn.parentElement!.textContent).toContain("Copied.");
  });

  it("copies the credit name, the website and the social accounts", async () => {
    rows = [full()];
    await openSupporters();
    await openRow(1);
    for (const what of ["credit", "website", "socials"]) (q(`[data-fx-copy="${what}"]`) as HTMLElement).click();
    await settle();
    expect(copied).toEqual(["Example Bakery of Kilmarnock", "https://bakery.example.com", "@examplebakery"]);
  });

  it("offers no Copy button where there is nothing to copy", async () => {
    rows = [answered(1, { want_certificate: true, certificate_delivery: "post", certificate_address: null })];
    await openSupporters();
    await openRow(1);
    expect(view().querySelectorAll("[data-fx-copy]")).toHaveLength(0);
    expect(q('[data-fx-open="1"]')!.textContent).toContain("No address given");
  });

  it("says so when the browser will not copy", async () => {
    clipboardWorks = false;
    rows = [full()];
    await openSupporters();
    await openRow(1);
    const btn = q('[data-fx-copy="credit"]') as HTMLElement;
    btn.click();
    await settle();
    const said = btn.parentElement!.querySelector("[data-fx-copied]") as HTMLElement;
    expect(said.textContent).toBe("Could not copy. Select it and copy by hand.");
    expect(said.classList.contains("is-error")).toBe(true);
  });
});

describe("marking a job done", () => {
  const job = () => answered(1, { want_social: true });

  it("asks in the page, naming the job and the business, and writes nothing until yes", async () => {
    rows = [job()];
    await openSupporters();
    await openRow(1);
    (q('[data-fulfil-id="1"][data-fulfil-mark="social_done"]') as HTMLElement).click();
    const ask = q("[data-fx-ask]") as HTMLElement;
    expect(ask.hidden).toBe(false);
    expect(ask.textContent).toContain("Mark “Social post done” as done for Business 1?");
    expect(ask.textContent).toContain("This is recorded against your name and cannot be undone.");
    expect(posts()).toEqual([]);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("puts the question away, having written nothing, on Not yet", async () => {
    rows = [job()];
    await openSupporters();
    await openRow(1);
    (q('[data-fulfil-mark="social_done"]') as HTMLElement).click();
    (q("[data-fx-ask-no]") as HTMLElement).click();
    await settle();
    expect((q("[data-fx-ask]") as HTMLElement).hidden).toBe(true);
    expect((q('[data-fulfil-mark="social_done"]') as HTMLElement).hidden).toBe(false);
    expect(posts()).toEqual([]);
  });

  it("marks it on yes, and says so in the panel the button was in", async () => {
    rows = [job()];
    await openSupporters();
    await openRow(1);
    (q('[data-fulfil-mark="social_done"]') as HTMLElement).click();
    (q("[data-fulfil-mark-yes]") as HTMLElement).click();
    await settle();
    expect(posts()).toEqual([{ url: "/api/admin/fulfilments/1/mark", method: "POST", body: { flag: "social_done" } }]);
    const said = q('[data-fx-open="1"] [data-fx-jobs] [data-fx-status="task"]') as HTMLElement;
    expect(said.textContent).toBe("Marked done, and recorded against your name.");
    expect(said.classList.contains("is-ok")).toBe(true);
    expect(q('[data-fulfil-mark="social_done"]')).toBeNull();
    expect(face(1).getAttribute("aria-expanded")).toBe("true");
    // And for someone not looking at the screen: the same words, from the one status line that stays put.
    expect(el("fulfilmentActionStatus").textContent).toBe("Marked done, and recorded against your name.");
  });

  it("never blanks the list to Loading while it reads it again", async () => {
    rows = [job(), row(2)];
    await openSupporters();
    await openRow(1);
    (q('[data-fulfil-mark="social_done"]') as HTMLElement).click();
    (q("[data-fulfil-mark-yes]") as HTMLElement).click();
    await flush();
    expect(el("fulfilmentsTable").textContent).not.toContain("Loading");
    expect(face(2)).not.toBeNull();
    await settle();
  });

  it("says so in the same panel when it could not be saved, and leaves the job to do", async () => {
    markStatus = 500;
    rows = [job()];
    await openSupporters();
    await openRow(1);
    (q('[data-fulfil-mark="social_done"]') as HTMLElement).click();
    (q("[data-fulfil-mark-yes]") as HTMLElement).click();
    await settle();
    const said = q('[data-fx-jobs] [data-fx-status="task"]') as HTMLElement;
    expect(said.textContent).toBe("Could not update that supporter. Please try again.");
    expect(said.classList.contains("is-error")).toBe(true);
    expect(q('[data-fulfil-mark="social_done"]')).not.toBeNull();
  });
});

describe("sending one business their invite", () => {
  it("says how it went in the invite's own panel, not at the top of the screen", async () => {
    rows = [row(1, { invited_at: null })];
    await openSupporters();
    await openRow(1);
    (q('[data-send-invite="1"]') as HTMLElement).click();
    await settle();
    expect(posts()).toEqual([{ url: "/api/admin/business-supporters/1/send-invite", method: "POST", body: null }]);
    const said = q('[data-fx-open="1"] [data-fx-status="invite"]') as HTMLElement;
    expect(said.textContent).toBe("Invite sent.");
    expect(el("backfillInvitesStatus").textContent).toBe("");
    expect(q('[data-fx-open="1"]')!.textContent).toContain("Invite sent 14 November 2026");
  });

  it("says so there when it could not be sent", async () => {
    inviteAnswer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    rows = [row(1, { invited_at: null })];
    await openSupporters();
    await openRow(1);
    (q('[data-send-invite="1"]') as HTMLElement).click();
    await settle();
    const said = q('[data-fx-open="1"] [data-fx-status="invite"]') as HTMLElement;
    expect(said.textContent).toBe("Could not send that invite. Please try again.");
    expect(said.classList.contains("is-error")).toBe(true);
  });
});

describe("Send catch up invites", () => {
  const two = () => [row(1, { invited_at: null }), row(2, { invited_at: null }), row(3)];

  it("says under the button what it does and how many it will email", async () => {
    rows = two();
    await openSupporters();
    const says = el("backfillInvitesSays").textContent || "";
    expect(says).toContain("2 businesses");
    expect(says).toContain("thank you invite");
    expect((el("backfillInvitesBtn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("says one business, not one businesses", async () => {
    rows = [row(1, { invited_at: null }), row(3)];
    await openSupporters();
    expect(el("backfillInvitesSays").textContent).toContain("1 business ");
  });

  it("has nothing to send, and says so, when every business has had theirs", async () => {
    rows = [row(3)];
    await openSupporters();
    expect((el("backfillInvitesBtn") as HTMLButtonElement).disabled).toBe(true);
    expect(el("backfillInvitesSays").textContent).toContain("Every business has had their invite");
  });

  it("asks first, and sends nothing on Not now", async () => {
    rows = two();
    await openSupporters();
    el("backfillInvitesBtn").click();
    const ask = el("backfillInvitesConfirm");
    expect(ask.hidden).toBe(false);
    expect(ask.textContent).toContain("Email the invite to 2 businesses now?");
    expect(posts()).toEqual([]);
    el("backfillInvitesNo").click();
    await settle();
    expect(ask.hidden).toBe(true);
    expect(posts()).toEqual([]);
  });

  it("sends on yes, and says how many went beside the button", async () => {
    rows = two();
    await openSupporters();
    el("backfillInvitesBtn").click();
    el("backfillInvitesYes").click();
    await settle();
    expect(posts()).toEqual([{ url: "/api/admin/business-supporters/backfill-invites", method: "POST", body: null }]);
    expect(el("backfillInvitesStatus").textContent).toBe("Sent 2 invites.");
    expect(el("backfillInvitesStatus").classList.contains("is-ok")).toBe(true);
    expect(el("backfillInvitesConfirm").hidden).toBe(true);
  });

  it("says how many did not go", async () => {
    backfillAnswer = { status: 200, body: { pending: 2, sent: 1, failed: 1 } };
    rows = two();
    await openSupporters();
    el("backfillInvitesBtn").click();
    el("backfillInvitesYes").click();
    await settle();
    expect(el("backfillInvitesStatus").textContent).toBe("Sent 1 invite. 1 could not be sent: press the button again to try those.");
    expect(el("backfillInvitesStatus").classList.contains("is-error")).toBe(true);
  });

  it("says so when it could not send at all", async () => {
    backfillAnswer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    rows = two();
    await openSupporters();
    el("backfillInvitesBtn").click();
    el("backfillInvitesYes").click();
    await settle();
    expect(el("backfillInvitesStatus").textContent).toBe("Could not send the invites. Please try again.");
    expect(el("backfillInvitesStatus").classList.contains("is-error")).toBe(true);
  });
});

describe("finding a business by name", () => {
  it("shows only the businesses whose name, or contact's name, has what is typed", async () => {
    rows = [row(1, { business_name: "Example Bakery" }), row(2, { business_name: "Example Motors", donor_name: "Morag Sample" }), row(3)];
    await openSupporters();
    expect(el("fulfilmentTools").hidden).toBe(false);
    const box = el("fulfilmentSearch") as HTMLInputElement;
    box.value = "  bak ";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shownIds()).toEqual([1]);
    box.value = "morag";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shownIds()).toEqual([2]);
    box.value = "zzz";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(el("fulfilmentsTable").textContent).toContain("No business matches “zzz”.");
    box.value = "";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(shownIds()).toHaveLength(3);
  });

  it("leaves the tiles counting every business, whatever is typed", async () => {
    rows = oneOfEach();
    await openSupporters();
    const box = el("fulfilmentSearch") as HTMLInputElement;
    box.value = "Business 1";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(tileCount("all")).toBe("6");
  });
});

describe("safety", () => {
  it("escapes what a business typed, wherever it is shown", async () => {
    rows = [answered(1, { business_name: "<img src=x onerror=alert(1)>", credit_name: "<b>bold</b>", donor_email: "a@example.com" })];
    await openSupporters();
    await openRow(1);
    expect(view().querySelector("img")).toBeNull();
    expect(view().querySelector('[data-fx-open="1"] b')).toBeNull();
    expect(face(1).textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
