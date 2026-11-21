// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Newsletter: the composer (Write, Who and Send), TASK-645. The faults that could email real
// supporters wrongly or lose someone's writing, each proved, then the features. Same harness as
// admin-newsletter-screens.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js run against it.
// Every person, address, subject and figure here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Init = { method?: string; body?: string };
type Call = { method: string; path: string; url: string; body: Record<string, unknown> };
type Answer = unknown | ((call: Call) => unknown);
type Failure = { status: number; body?: unknown };

let role = "admin";
let served: Record<string, Answer> = {};
let failing: Record<string, Failure> = {};
let slow: Record<string, number> = {};
let calls: Call[] = [];

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
function row(id: number, subject: string, over: Record<string, unknown> = {}) {
  return {
    id, subject, status: "sent", sentAt: null, recipientCount: null, sentCount: null, failedCount: null, failedEmails: null,
    redactedAt: null, sentBy: "fern@example.com", audience: "Newsletter", deliveredCount: null, clickedCount: null, ...over,
  };
}
const draft = (id: number, subject: string) => row(id, subject, { status: "draft", sentBy: null, audience: null });
const sent = (id: number, subject: string, days: number) =>
  row(id, subject, { sentAt: ago(days), recipientCount: 100, sentCount: 100, failedCount: 0, failedEmails: [], deliveredCount: 97, clickedCount: 10 });

const LISTS = [
  { id: 1, slug: "newsletter", name: "Newsletter", kind: "everyone", visibility: "public", memberCount: 412 },
  { id: 2, slug: "donors", name: "Donors", kind: "donors", visibility: "private", memberCount: 318 },
  { id: 3, slug: "volunteers", name: "Volunteers", kind: "manual", visibility: "private", memberCount: 46 },
];
let DOC: Record<string, unknown> = { blocks: [{ type: "text", variant: 0, data: { text: "Invented words for a newsletter." } }] };

function respond(url: string, init?: Init) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  let body: Record<string, unknown> = {};
  try { body = init?.body ? JSON.parse(init.body) : {}; } catch { body = {}; }
  const call = { method, path, url, body };
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  const failure = failing[method + " " + path] || failing[path];
  if (failure) return j(failure.body ?? { error: "Admin is temporarily unavailable" }, failure.status);
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions: effectivePermissions({ role: role as "admin", permissions: null }) });
  if (path === "/api/admin/whats-new") return j({ areas: [] });
  const key = method + " " + path in served ? method + " " + path : method === "GET" ? path : "";
  if (key in served) {
    const a = served[key];
    return j(typeof a === "function" ? (a as (c: Call) => unknown)(call) : a);
  }
  const one = path.match(/^\/api\/admin\/newsletters\/(\d+)$/);
  if (one && method === "GET") {
    const list = (served["/api/admin/newsletters"] as { id: number }[]) || [];
    const found = list.find((n) => String(n.id) === one[1]);
    return found ? j({ ...found, bodyHtml: "", bodyJson: DOC }) : j({ error: "Newsletter not found" }, 404);
  }
  if (one && method === "PUT") return j({ id: Number(one[1]), subject: body.subject, status: "draft" });
  if (path === "/api/admin/newsletters" && method === "POST") return j({ id: 30, subject: body.subject, status: "draft" }, 201);
  if (path === "/api/admin/newsletters/recipients") {
    const ids = (new URLSearchParams(url.split("?")[1] || "").get("listIds") || "").split(",").filter(Boolean);
    const count = ids.length === 2 ? 431 : ids[0] === "3" ? 44 : 400;
    return j({ count, emails: ["one@example.com", "two@example.com"], audience: ids.map((i) => LISTS.find((l) => String(l.id) === i)?.name).join(" + "), kind: ids.length > 1 ? "multi" : "manual" });
  }
  if (path === "/api/admin/newsletter-templates") return j([]);
  if (path === "/api/admin/subscriber-lists/archived") return j([]);
  if (path === "/api/admin/subscriber-lists") return j(LISTS);
  if (path === "/api/admin/newsletters/suppressions") return j([]);
  if (path === "/api/admin/newsletters/send-jobs/inflight") return j(null);
  if (path === "/api/admin/newsletters/preflight") return j({ findings: [] });
  if (path === "/api/admin/newsletters/preview") return j({ html: "<p>preview</p>" });
  if (/\/send-job$/.test(path)) return j({ error: "No send job" }, 404);
  if (/\/attachments$/.test(path)) return j({ attachments: [] });
  return j({ results: [] });
}

let timers: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  role = "admin";
  served = { "/api/admin/newsletters": [] };
  failing = {};
  slow = {};
  calls = [];
  DOC = { blocks: [{ type: "text", variant: 0, data: { text: "Invented words for a newsletter." } }] };
  timers = vi.spyOn(globalThis, "setTimeout");
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  window.confirm = () => true;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) => {
    const u = String(url);
    const method = ((init as Init | undefined)?.method || "GET").toUpperCase();
    let logged: Record<string, unknown> = {};
    try { logged = (init as Init | undefined)?.body ? JSON.parse((init as Init).body as string) : {}; } catch { logged = {}; }
    calls.push({ method, path: u.split("?")[0], url: u, body: logged }); // when it is asked, not when it is answered
    const ms = slow[method + " " + u.split("?")[0]];
    const reply = () => respond(u, init as Init);
    return ms ? new Promise((r) => setTimeout(() => r(reply()), ms)) : Promise.resolve(reply());
  };
});
afterEach(() => {
  for (const r of timers?.mock.results ?? []) if (r.type === "return") clearTimeout(r.value as ReturnType<typeof setTimeout>);
  timers?.mockRestore();
  timers = null;
});

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const el = (id: string) => document.getElementById(id) as HTMLElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const panel = () => qa("#view-newsletter .nl-panel").filter((p) => !p.hidden).map((p) => p.id);
const got = (method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);
const type = (id: string, value: string) => {
  (el(id) as HTMLInputElement).value = value;
  el(id).dispatchEvent(new Event("input", { bubbles: true }));
};
const AUTOSAVE = 1700; // a little over the composer's quiet moment before it saves

async function open(as = "admin") {
  role = as;
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
  await settle();
}
async function go(panelId: string) {
  (q('#nlSteps [data-nl-panel="' + panelId + '"], .nl-cp-step[data-nl-panel="' + panelId + '"]') as HTMLElement).click();
  await settle();
}
/** Opens one newsletter from All newsletters, where it is written. */
async function editing(id: number, list = [draft(12, "Invented Christmas thank you"), sent(11, "Invented November news", 2)]) {
  served["/api/admin/newsletters"] = list;
  await open();
  await go("nlPanelHistory");
  (q(`#newsletterList [data-edit-newsletter="${id}"]`) as HTMLElement).click();
  await settle();
}
async function chooseAudiences(...ids: number[]) {
  await go("nlPanelWho");
  for (const id of ids) {
    (q(`[data-aud-card="${id}"]`) as HTMLElement).click();
    await settle();
  }
  await wait(250); // the reach count is asked for a moment after the last tick
  await settle();
}

describe("fault 1: it saves as you go, truthfully", () => {
  it("saves a draft a moment after the last change, and says so", async () => {
    await editing(12);
    type("newsletterSubject", "Invented Christmas thank you, changed");
    expect(text(el("nlComposeSaved"))).toBe("Changes not saved yet");
    expect(got("PUT", "/api/admin/newsletters/12").length).toBe(0);
    await wait(AUTOSAVE);
    await settle();
    const puts = got("PUT", "/api/admin/newsletters/12");
    expect(puts.length).toBe(1);
    expect(puts[0].body.subject).toBe("Invented Christmas thank you, changed");
    expect(text(el("nlComposeSaved"))).toBe("Saved just now");
  });

  it("says Saving while the save is on its way, and never starts a second one alongside it", async () => {
    await editing(12);
    slow["PUT /api/admin/newsletters/12"] = 2500;
    type("newsletterSubject", "First change");
    await wait(AUTOSAVE);
    expect(text(el("nlComposeSaved"))).toBe("Saving…");
    type("newsletterSubject", "Second change");
    await wait(AUTOSAVE);
    expect(got("PUT", "/api/admin/newsletters/12").length).toBe(1);
    await wait(1200);
    await settle();
    // The first has landed; what changed meanwhile goes in a second save, after it.
    await wait(AUTOSAVE);
    await settle();
    const puts = got("PUT", "/api/admin/newsletters/12");
    expect(puts.length).toBe(2);
    expect(puts[1].body.subject).toBe("Second change");
  }, 20_000);

  it("creates a brand new one on its first save, and updates it after", async () => {
    await open();
    el("newsletterNew").click();
    await settle();
    if (q("#nlStartScreen [data-start=\"blank\"]")) { (q('#nlStartScreen [data-start="blank"]') as HTMLElement).click(); await settle(); }
    type("newsletterSubject", "A new invented newsletter");
    await wait(AUTOSAVE);
    await settle();
    expect(got("POST", "/api/admin/newsletters").length).toBe(1);
    expect((el("newsletterId") as HTMLInputElement).value).toBe("30");
    type("newsletterSubject", "A new invented newsletter, again");
    await wait(AUTOSAVE);
    await settle();
    expect(got("POST", "/api/admin/newsletters").length).toBe(1);
    expect(got("PUT", "/api/admin/newsletters/30").length).toBe(1);
  });

  it("never saves a newsletter that has been sent", async () => {
    await editing(11);
    type("newsletterSubject", "Typed into a sent one");
    await wait(AUTOSAVE);
    await settle();
    expect(got("PUT", "/api/admin/newsletters/11").length).toBe(0);
  });

  it("says it could not save, and keeps the changes, when the save fails", async () => {
    await editing(12);
    failing["PUT /api/admin/newsletters/12"] = { status: 500 };
    type("newsletterSubject", "A change that will not save");
    await wait(AUTOSAVE);
    await settle();
    expect(text(el("nlComposeSaved"))).toBe("Could not save. Your changes are still here: press Save to try again.");
    expect(el("nlComposeSaved").classList.contains("is-error")).toBe(true);
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("A change that will not save");
  });

  it("says how long ago it saved", async () => {
    await editing(12);
    type("newsletterSubject", "Saved a while back");
    await wait(AUTOSAVE);
    await settle();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60_000 + 5000);
    await go("nlPanelWho");
    await go("nlPanelWrite");
    expect(text(el("nlComposeSaved"))).toBe("Saved 2 minutes ago");
    clock.mockRestore();
  });

  it("says a new one needs a subject line before it can save itself", async () => {
    await open();
    el("newsletterNew").click();
    await settle();
    if (q('#nlStartScreen [data-start="blank"]')) { (q('#nlStartScreen [data-start="blank"]') as HTMLElement).click(); await settle(); }
    (q('#nlPalette button[aria-label="Add Text block"]') as HTMLElement).click();
    await wait(AUTOSAVE);
    await settle();
    expect(got("POST", "/api/admin/newsletters").length).toBe(0);
    expect(text(el("nlComposeSaved"))).toBe("Not saved yet: give it a subject line and it will save itself.");
  });

  it("saves straight away on Close rather than losing the last change", async () => {
    await editing(12);
    type("newsletterSubject", "Changed just before closing");
    el("nlComposeClose").click();
    await settle();
    expect(got("PUT", "/api/admin/newsletters/12").length).toBe(1);
    expect(panel()).toEqual(["nlPanelOverview"]);
  });

  it("asks before Close when the changes cannot be saved, and stays if you say no", async () => {
    await editing(12);
    failing["PUT /api/admin/newsletters/12"] = { status: 500 };
    type("newsletterSubject", "Will not save");
    const asked: string[] = [];
    window.confirm = (m?: string) => { asked.push(String(m)); return false; };
    el("nlComposeClose").click();
    await settle();
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain("could not be saved");
    expect(panel()).toEqual(["nlPanelWrite"]);
  });

  it("asks the browser to warn before leaving the page with changes not yet saved", async () => {
    // Every test runs its own copy of app.js on the same window, so only this copy's listener is asked.
    const mine: EventListener[] = [];
    const add = window.addEventListener.bind(window);
    const spy = vi.spyOn(window, "addEventListener").mockImplementation(((t: string, fn: EventListener, o?: unknown) => {
      if (t === "beforeunload") mine.push(fn);
      return add(t, fn, o as AddEventListenerOptions);
    }) as typeof window.addEventListener);
    await editing(12);
    spy.mockRestore();
    expect(mine.length).toBe(1);
    const leave = () => { const e = new Event("beforeunload", { cancelable: true }); mine[0](e); return e.defaultPrevented; };
    expect(leave()).toBe(false);
    type("newsletterSubject", "Not saved yet");
    expect(leave()).toBe(true);
    await wait(AUTOSAVE);
    await settle();
    expect(leave()).toBe(false);
  });

  it("never reads a newsletter again over work not yet saved when the tab is opened again", async () => {
    await editing(12, [draft(12, "Invented Christmas thank you"), draft(14, "A newer invented draft")]);
    slow["PUT /api/admin/newsletters/12"] = 60_000; // the save is still on its way
    type("newsletterSubject", "Changed, not saved");
    (q('.admin-nav-link[data-view="overview"]') as HTMLElement | null)?.click();
    await settle();
    (q('.admin-nav-link[data-view="newsletter"]') as HTMLElement).click();
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("12");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Changed, not saved");
  });
});

describe("fault 2: the step button on a phone", () => {
  it("sits above the phone's bottom bar, not under it", () => {
    const css = readFileSync(resolve(ROOT, "assets/css/admin-newsletter.css"), "utf8");
    expect(css).toContain("#view-newsletter.is-composing .nl-cp-foot { bottom: calc(92px + env(safe-area-inset-bottom)); z-index: 31; }");
  });
});

describe("fault 3: New newsletter", () => {
  it("is in the composer's top bar, beside the title", () => {
    expect(el("newsletterNew").closest(".nl-cp-bar")).not.toBeNull();
  });

  it("clears the subject, the bar's title, both name fallbacks, the preview text and the blocks", async () => {
    DOC = { merge: { nameFallback: "friend", greetingFallback: "supporter" }, preheader: "An invented line", blocks: (DOC.blocks as unknown[]) };
    await editing(12);
    expect((el("nlNameFallback") as HTMLInputElement).value).toBe("friend");
    el("newsletterNew").click();
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("");
    expect(text(el("nlComposeSubject"))).toBe("Untitled newsletter");
    expect((el("nlNameFallback") as HTMLInputElement).value).toBe("");
    expect((el("nlGreetingFallback") as HTMLInputElement).value).toBe("");
    expect((el("nlPreheader") as HTMLInputElement).value).toBe("");
    expect(qa("#nlCanvas .nl-block").length).toBe(0);
  });

  it("asks first when there are changes it could not save", async () => {
    await editing(12);
    failing["PUT /api/admin/newsletters/12"] = { status: 500 };
    type("newsletterSubject", "Not saved");
    const asked: string[] = [];
    window.confirm = (m?: string) => { asked.push(String(m)); return false; };
    el("newsletterNew").click();
    await settle();
    expect(asked.length).toBe(1);
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Not saved");
  });

  it("starting from the example leaves nothing of the newsletter that was open", async () => {
    DOC = { merge: { nameFallback: "friend", greetingFallback: "supporter" }, blocks: (DOC.blocks as unknown[]) };
    await editing(12);
    el("newsletterTemplate").click();
    await settle();
    expect((el("newsletterId") as HTMLInputElement).value).toBe("");
    expect((el("newsletterSubject") as HTMLInputElement).value).toBe("Winter Update");
    expect(text(el("nlComposeSubject"))).toBe("Winter Update");
    expect((el("nlNameFallback") as HTMLInputElement).value).toBe("");
  });
});

describe("fault 4: Who gets it, one way to choose and one number", () => {
  it("says you may choose more than one, with the role that matches tick boxes", async () => {
    await editing(12);
    await go("nlPanelWho");
    const who = text(el("nlPanelWho"));
    expect(who).not.toContain("Pick one audience");
    expect(who).toContain("Choose one audience or more");
    expect(el("nlAudienceCards").getAttribute("role")).toBe("group");
    expect(qa("#nlAudienceCards [role=checkbox]").length).toBe(3);
  });

  it("never shows the old Send to box beside the cards", async () => {
    await editing(12);
    await go("nlPanelWho");
    expect(el("sendListWrap").hidden).toBe(true);
  });

  it("chooses nothing for you", async () => {
    await editing(12);
    await go("nlPanelWho");
    expect(qa('#nlAudienceCards [aria-checked="true"]').length).toBe(0);
  });

  it("gives one number, the people who will get it counted once each, and no other", async () => {
    await editing(12);
    await chooseAudiences(1, 3);
    const who = text(el("nlPanelWho"));
    expect(text(el("nlReach"))).toContain("431");
    expect(text(el("sendAudienceNote"))).toContain("431 people will get it");
    expect(who).not.toContain("412 people");
    expect(who).not.toContain("— 412");
  });
});

describe("fault 5: Before you send", () => {
  it("names every audience chosen, with the same one number", async () => {
    await editing(12);
    await chooseAudiences(1, 3);
    await go("nlPanelSend");
    const summary = text(el("nlSendSummaryList"));
    expect(summary).toContain("Newsletter and Volunteers");
    expect(summary).toContain("431 people");
    expect(summary).not.toContain("412");
  });

  it("says nobody is chosen yet when nobody is", async () => {
    await editing(12);
    await go("nlPanelSend");
    expect(text(el("nlSendSummaryList"))).toContain("Not chosen yet");
  });
});

describe("fault 6: when it goes, and the confirmation", () => {
  it("does not send at once when Send later has no date: it refuses, and says why beside the button", async () => {
    await editing(12);
    await chooseAudiences(3);
    await go("nlPanelSend");
    el("nlWhenLater").click();
    el("newsletterSend").click();
    await settle();
    expect(q(".nl-modal-overlay")).toBeNull();
    expect(got("POST", "/api/admin/newsletters/12/send").length).toBe(0);
    expect(text(el("nlSendSays"))).toContain("Pick a date and time");
    expect(el("nlSendSays").classList.contains("is-error")).toBe(true);
  });

  it("refuses to send when nobody is chosen, rather than sending to a default", async () => {
    await editing(12);
    await go("nlPanelSend");
    el("newsletterSend").click();
    await settle();
    expect(q(".nl-modal-overlay")).toBeNull();
    expect(text(el("nlSendSays"))).toContain("Choose who gets it");
  });

  it("hides the date box while Send now is chosen, also when a draft opens", async () => {
    await editing(12);
    await go("nlPanelSend");
    expect(el("sendScheduleWrap").hidden).toBe(true);
  });

  it("says who, how many, when and how fast before anything goes", async () => {
    await editing(12);
    await chooseAudiences(1, 3);
    await go("nlPanelSend");
    el("newsletterSend").click();
    await settle();
    const modal = text(q(".nl-modal"));
    expect(modal).toContain("Newsletter and Volunteers");
    expect(modal).toContain("431 people");
    expect(modal).toContain("Straight away");
    expect(modal).toContain("All at once, about 60 a minute");
  });

  it("says the day and time for a later send, and the gentle pace", async () => {
    await editing(12);
    await chooseAudiences(3);
    await go("nlPanelSend");
    el("nlWhenLater").click();
    (el("sendScheduleAt") as HTMLInputElement).value = "2030-11-26T09:00";
    el("sendScheduleAt").dispatchEvent(new Event("input", { bubbles: true }));
    (el("sendRollout") as HTMLInputElement).checked = true;
    el("sendRollout").dispatchEvent(new Event("change", { bubbles: true }));
    el("newsletterSend").click();
    await settle();
    const modal = text(q(".nl-modal"));
    expect(modal).toContain("Tuesday 26 November 2030 at 09:00");
    expect(modal).toContain("Gradually");
    (q(".nl-modal-confirm") as HTMLElement).click();
    await settle();
    const send = got("POST", "/api/admin/newsletters/12/send");
    expect(send.length).toBe(1);
    expect(send[0].body.listIds).toEqual([3]);
    expect(send[0].body.rollout).toBe("gentle");
    expect(typeof send[0].body.scheduledAt).toBe("string");
  });
});
