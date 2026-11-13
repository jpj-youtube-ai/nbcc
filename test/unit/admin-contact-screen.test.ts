// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// The Contact form in the Donations look (2026-11-12, docs/superpowers/specs/2026-11-12-overview-contact-phone-menu-design.md).
//
// On a 375px phone the old six-column table broke every word letter by letter ("REC/EIVE/D",
// "Vie/w"): 624px per message, unreadable. Now each message is a card under a day heading, and it
// opens where it is, the way a gift opens in Donations, rather than on a separate screen. Jaimie
// chose that on 12 Nov after seeing it mocked up.
//
// Same harness as admin-app.test.ts. Every name, address and message is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-overview.css"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const XSS = "<img src=x onerror=alert(1)>";

const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
const msg = (id: number, over: Record<string, unknown> = {}) => ({
  id, first_name: "Morag", last_name: "Kerr", email: `m${id}@example.com`, phone: null,
  message: "Hi, our school would love to do a collection for you this year.", status: "new",
  replied_by: null, replied_at: null, replied_summary: null, created_at: daysAgo(0), ...over,
});

let role = "admin";
let list: unknown[] = [];
let detailFails = false;
let patches: string[] = [];
let requested: string[] = [];
let listFails = false;
// A message's details held back until released, to put two replies in the order a slow network might.
let held: Record<number, Promise<void>> = {};

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body), text: () => Promise.resolve(""), headers: { get: () => "application/json" },
  });
  requested.push(url);
  const path = url.split("?")[0];
  const method = (init?.method || "GET").toUpperCase();
  const token = signAdminSession({ sub: 3, email: "a@nbcc", role, now: new Date(), secret: "s" }).token;
  if (path === "/api/admin/login") return j({ token, user: { email: "a@nbcc", role } });
  if (path === "/api/admin/me") return j({ email: "a@nbcc", permissions: effectivePermissions({ role, permissions: null }) });
  if (path === "/api/admin/contact") return listFails ? j({ error: "Admin is temporarily unavailable" }, 500) : j({ results: list });
  const one = /^\/api\/admin\/contact\/(\d+)$/.exec(path);
  if (one) {
    if (method === "PATCH") {
      patches.push(init?.body || "");
      const row = (list as Array<{ id: number }>).find((r) => r.id === Number(one[1]));
      const status = JSON.parse(init?.body || "{}").status;
      return j({ ...row, status, replied_by: status === "replied" ? "jaimie@nbcc.scot" : null, replied_at: status === "replied" ? "2026-09-22T13:03:00.000Z" : null });
    }
    if (detailFails) return j({ error: "Admin is temporarily unavailable" }, 500);
    return j((list as Array<{ id: number }>).find((r) => r.id === Number(one[1])));
  }
  return j({ results: [] });
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const card = (id: number) => document.querySelector(`.ct-msg[data-ct-id="${id}"]`) as HTMLElement;
const summary = (id: number) => card(id).querySelector("button.ct-msg__summary") as HTMLElement;
async function openContactForm() {
  (el("adminEmail") as HTMLInputElement).value = "a@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="contact"]') as HTMLElement).click();
  await settle();
}

beforeEach(() => {
  role = "admin";
  list = [];
  detailFails = false;
  patches = [];
  requested = [];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminGiftLog: unknown }).AdminGiftLog = GiftLog.createGiftLog(document, window);
  window.confirm = () => true;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => "received " + String(s);
  (window as unknown as { buildGmailReplyUrl: () => string }).buildGmailReplyUrl = () => "https://mail.google.com/x";
  listFails = false;
  held = {};
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) => {
    const one = /^\/api\/admin\/contact\/(\d+)$/.exec(String(url));
    const wait = one && !(init as { method?: string } | undefined)?.method ? held[Number(one[1])] : undefined;
    return (wait || Promise.resolve()).then(() => respond(String(url), init as { method?: string; body?: string }));
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the list", () => {
  it("draws each message as a card, not a table row", async () => {
    list = [msg(700), msg(701, { first_name: "Callum", last_name: "Reid" })];
    await openContactForm();
    expect(el("contactTable").querySelector("table")).toBeNull();
    expect(el("contactTable").querySelectorAll(".ct-msg")).toHaveLength(2);
    expect(card(701).querySelector(".ct-msg__name")!.textContent).toBe("Callum Reid");
  });

  it("puts the messages under day headings, as Donations puts gifts", async () => {
    list = [msg(1, { created_at: daysAgo(0) }), msg(2, { created_at: daysAgo(1) }), msg(3, { created_at: daysAgo(1) })];
    await openContactForm();
    const heads = [...el("contactTable").querySelectorAll(".ct-day")].map((h) => h.textContent);
    expect(heads).toEqual(["Today", "Yesterday"]);
  });

  it("shows the first lines of the message on the card", async () => {
    list = [msg(1)];
    await openContactForm();
    expect(card(1).querySelector(".ct-msg__snippet")!.textContent).toContain("our school would love");
  });

  it("marks a waiting message, and says who replied to a replied one", async () => {
    // repliedSummary (src/contact/enquiry-summary.ts) sends "by <email>, <day> <month> <time>".
    list = [msg(1), msg(2, { status: "replied", replied_summary: "by pretend@example.com, 22 Sep 14:03" })];
    await openContactForm();
    expect(card(1).classList.contains("ct-msg--waiting")).toBe(true);
    expect(card(2).classList.contains("ct-msg--waiting")).toBe(false);
    expect(card(2).querySelector(".ct-mark--done")!.textContent).toBe("Replied");
    expect(card(2).querySelector(".ct-msg__mark")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Replied by pretend@example.com, 22 Sep 14:03");
  });

  it("says Replied on its own when the server has no more to say", async () => {
    list = [msg(2, { status: "replied", replied_summary: null })];
    await openContactForm();
    expect(card(2).querySelector(".ct-msg__mark")!.textContent!.trim()).toBe("Replied");
  });

  // TASK-476: never last load's numbers under a message that says nothing could load.
  it("clears the counts when the list could not load", async () => {
    list = [msg(1), msg(2)];
    await openContactForm();
    listFails = true;
    (document.querySelector('.admin-nav-link[data-view="contact"]') as HTMLElement).click();
    await settle();
    expect(el("contactTable").textContent).toContain("Enquiries are unavailable.");
    for (const c of document.querySelectorAll("#contactStatusFilter .ct-seg__count")) expect(c.textContent).toBe("");
    expect(el("ctWaitingLine").textContent).toBe("");
  });

  // Opening a message used to redraw the list, and a live list read the whole inbox out each time.
  it("is not a live region, so opening a message does not read out the inbox", () => {
    expect(el("contactTable").hasAttribute("aria-live")).toBe(false);
  });

  it("keeps the words for an empty inbox and for one that could not load", async () => {
    await openContactForm();
    expect(el("contactTable").textContent).toContain("No enquiries yet.");
  });
});

describe("the filter", () => {
  it("shows All, Waiting and Replied as tiles with their counts, from one fetch", async () => {
    list = [msg(1), msg(2), msg(3, { status: "replied" })];
    await openContactForm();
    const tiles = [...document.querySelectorAll("#contactStatusFilter .ct-seg")];
    expect(tiles.map((t) => t.querySelector(".ct-seg__count")!.textContent)).toEqual(["3", "2", "1"]);
    expect(tiles.map((t) => t.querySelector(".ct-seg__name")!.textContent)).toEqual(["All", "Waiting", "Replied"]);
    expect(requested.filter((u) => u.startsWith("/api/admin/contact?"))).toEqual([]);
  });

  it("shows only the waiting ones when Waiting is pressed, and says which is pressed", async () => {
    list = [msg(1), msg(2, { status: "replied" })];
    await openContactForm();
    (document.querySelector('#contactStatusFilter [data-status="new"]') as HTMLElement).click();
    await settle();
    expect(el("contactTable").querySelectorAll(".ct-msg")).toHaveLength(1);
    expect(document.querySelector('#contactStatusFilter [data-status="new"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('#contactStatusFilter [data-status=""]')!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("a message opens where it is", () => {
  it("opens in place, with its email, when it came, the whole message and the actions", async () => {
    list = [msg(700), msg(701, { email: "callum.reid@example.com", phone: "07700 900123" })];
    await openContactForm();
    summary(701).click();
    await settle();
    const detail = card(701).querySelector("#contactDetail") as HTMLElement;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain("callum.reid@example.com");
    expect(detail.textContent).toContain("07700 900123");
    expect(detail.textContent).toContain("received");
    expect(el("contactReplyBtn")).not.toBeNull();
    expect(summary(701).getAttribute("aria-expanded")).toBe("true");
    // Still on the Contact form, not a separate screen.
    expect(el("view-contact").hidden).toBe(false);
  });

  it("closes the first message when a second is opened, so there is only ever one", async () => {
    list = [msg(700), msg(701)];
    await openContactForm();
    summary(700).click();
    await settle();
    summary(701).click();
    await settle();
    expect(document.querySelectorAll("#contactDetail")).toHaveLength(1);
    expect(card(701).querySelector("#contactDetail")).not.toBeNull();
    expect(summary(700).getAttribute("aria-expanded")).toBe("false");
  });

  it("closes again when its own card is pressed a second time", async () => {
    list = [msg(700)];
    await openContactForm();
    summary(700).click();
    await settle();
    summary(700).click();
    await settle();
    expect(document.querySelector("#contactDetail")).toBeNull();
  });

  // Review Focus 1: an action inside the opened card must not bubble up and re-open the card.
  it("does not redraw an open message when one of its actions is pressed", async () => {
    list = [msg(700)];
    await openContactForm();
    summary(700).click();
    await settle();
    const before = card(700).querySelector("#contactDetail");
    (window as unknown as { open: () => void }).open = () => undefined;
    el("contactReplyBtn").click();
    await settle();
    expect(card(700).querySelector("#contactDetail")).toBe(before);
  });

  it("marks it replied in place, and the card and the counts follow", async () => {
    list = [msg(700), msg(701)];
    await openContactForm();
    summary(700).click();
    await settle();
    el("contactMarkRepliedBtn").click();
    await settle();
    expect(patches).toEqual([JSON.stringify({ status: "replied" })]);
    expect(el("contactActionStatus").textContent).toBe("Marked as replied");
    expect(card(700).classList.contains("ct-msg--waiting")).toBe(false);
    expect(document.querySelector('#contactStatusFilter [data-status="new"] .ct-seg__count')!.textContent).toBe("1");
    // As a reload would draw it: the server's words, in UK time (14:03 in September is BST).
    expect(card(700).querySelector(".ct-msg__mark")!.textContent!.replace(/\s+/g, " ").trim()).toBe("Replied by jaimie@nbcc.scot, 22 Sep 14:03");
  });

  it("keeps your place: the card you pressed stays the same card, with the focus on it", async () => {
    list = [msg(700), msg(701)];
    await openContactForm();
    const before = summary(701);
    before.focus();
    before.click();
    await settle();
    expect(summary(701)).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(before.getAttribute("aria-expanded")).toBe("true");
    before.click();
    await settle();
    expect(summary(701)).toBe(before);
    expect(before.getAttribute("aria-expanded")).toBe("false");
  });

  it("never shows one message's details in another's card, whichever reply comes back first", async () => {
    list = [msg(700, { email: "first@example.com" }), msg(701, { email: "second@example.com" })];
    await openContactForm();
    let release = () => {};
    held[700] = new Promise<void>((r) => { release = r; });
    summary(700).click();
    await settle();
    summary(701).click();
    await settle();
    release();
    await settle();
    expect(card(700).querySelector(".ct-msg__more")).toBeNull();
    expect(el("contactDetail").textContent).toContain("second@example.com");
    expect(el("contactDetail").textContent).not.toContain("first@example.com");
  });

  it("puts a reply that comes back after you moved on only on its own card", async () => {
    list = [msg(700), msg(701)];
    await openContactForm();
    summary(700).click();
    await settle();
    el("contactMarkRepliedBtn").click();
    summary(701).click();
    await settle();
    expect(card(700).classList.contains("ct-msg--waiting")).toBe(false);
    expect(el("contactActionStatus").textContent).toBe("");
    expect(el("contactMarkRepliedBtn")).not.toBeNull();
  });

  // The Search screen's kind buttons used to answer every segmented button on the page, so pressing
  // one took the pressed look off the Contact form's chosen tile.
  it("keeps the chosen tile pressed when a button on another screen is pressed", async () => {
    list = [msg(1)];
    await openContactForm();
    const waiting = document.querySelector('#contactStatusFilter [data-status="new"]') as HTMLElement;
    waiting.click();
    (document.querySelector('[data-kind="declarations"]') as HTMLElement).click();
    expect(waiting.classList.contains("is-active")).toBe(true);
  });

  it("says so in place when a message could not be loaded", async () => {
    list = [msg(4)];
    detailFails = true;
    await openContactForm();
    summary(4).click();
    await settle();
    expect(el("contactDetail").textContent).toContain("Could not load this enquiry. Please try again.");
  });

  it("offers Restore and Erase only on an archived message, as before", async () => {
    list = [msg(5, { archived_at: daysAgo(2) })];
    await openContactForm();
    summary(5).click();
    await settle();
    expect(el("contactArchiveBtn").hidden).toBe(true);
    expect(el("contactRestoreBtn").hidden).toBe(false);
    expect(el("contactEraseBtn").hidden).toBe(false);
  });

  it("offers no actions to someone who may only look", async () => {
    role = "viewer";
    list = [msg(6)];
    await openContactForm();
    summary(6).click();
    await settle();
    expect(document.getElementById("contactReplyBtn")).toBeNull();
    expect(el("contactDetail").textContent).toContain("m6@example.com");
  });
});

describe("markup in a message is shown as text", () => {
  it.each([
    ["a name", { first_name: XSS }],
    ["a message", { message: XSS }],
    ["a reply note", { status: "replied", replied_summary: XSS }],
  ])("in %s", async (_what, over) => {
    list = [msg(9, over)];
    await openContactForm();
    expect(el("contactTable").querySelector("img")).toBeNull();
    summary(9).click();
    await settle();
    expect(el("contactTable").querySelector("img")).toBeNull();
  });
});

describe("the styling", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  it("has a rule for every piece it draws", () => {
    for (const cls of ["ct-msg", "ct-msg__summary", "ct-msg__snippet", "ct-day", "ct-seg", "ct-facts", "ct-act"]) {
      expect(rules, cls).toMatch(new RegExp(`\\.${cls}\\b`));
    }
  });

  it("keeps the opened message's full text in the page, never in a box that scrolls", () => {
    expect(rules).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
  });
});
