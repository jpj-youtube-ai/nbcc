// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-491: the call reminders on Admin > Business supporters, in the page itself.
//   - a "Time to call" pill beside each business that is due a call;
//   - a line above the list saying how many are due (hidden while loading or failed);
//   - a Call panel in a business's details: their number as a tap to call link, when they were last
//     called, by whom and the note; a box to add or change the number; and Mark as called.
// Same harness as admin-could-not-load.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js
// evaluated against it. Every business, name and number here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Row = Record<string, unknown> & { id: number };
function row(id: number, over: Record<string, unknown> = {}): Row {
  return {
    id,
    donor_id: 100 + id,
    donor_name: "Contact " + id,
    business_name: "Business " + id,
    band: "gold",
    created_at: "2026-03-01T10:00:00Z",
    captured_at: null,
    invited_at: "2026-03-02T10:00:00Z",
    phone: null,
    last_called_at: null,
    last_called_by: null,
    last_call_note: null,
    supporting: true,
    supporting_since: "2026-03-01T10:00:00Z",
    callDue: false,
    callDueOn: "2026-12-01",
    ...over,
  };
}

let rows: Row[] = [];
let listStatus = 200;
let callStatus = 200;
let phoneStatus = 200;
let permissions: PermissionMap = effectivePermissions({ role: "admin", permissions: null });
let posted: { url: string; method: string; body: unknown }[] = [];
let history: unknown[] = [];

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
  if (path === "/api/admin/login") return j({ token: adminToken, user: { email: "fern@example.com", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "fern@example.com", fullName: "Fern Example", permissions });
  const call = path.match(/^\/api\/admin\/fulfilments\/(\d+)\/calls$/);
  if (call && method === "POST") {
    const body = JSON.parse(init?.body || "{}");
    posted.push({ url: path, method, body });
    if (callStatus !== 200) return j({ error: "Admin update is temporarily unavailable" }, callStatus);
    const r = rows.find((x) => x.id === Number(call[1]))!;
    Object.assign(r, {
      last_called_at: "2026-10-02T11:00:00Z",
      last_called_by: "fern@example.com",
      last_call_note: body.note ?? null,
      callDue: false,
      callDueOn: "2027-01-02",
    });
    return j({ call: { called_by: "fern@example.com", note: body.note ?? null } });
  }
  const phone = path.match(/^\/api\/admin\/fulfilments\/(\d+)\/phone$/);
  if (phone && method === "PUT") {
    const body = JSON.parse(init?.body || "{}");
    posted.push({ url: path, method, body });
    if (phoneStatus !== 200) {
      return j({ error: "That phone number does not look right. Use digits, spaces, + ( ) and -, up to 40 characters." }, phoneStatus);
    }
    const r = rows.find((x) => x.id === Number(phone[1]))!;
    r.phone = body.phone.trim() || null;
    return j({ id: r.id, phone: r.phone });
  }
  if (/^\/api\/admin\/fulfilments\/\d+\/history$/.test(path)) return j({ results: history });
  if (path === "/api/admin/fulfilments") {
    if (listStatus !== 200) return j({ error: "Admin is temporarily unavailable" }, listStatus);
    return j({ results: rows });
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const countLine = () => el("fulfilmentCallCount");

async function openSupporters() {
  (el("adminEmail") as HTMLInputElement).value = "fern@example.com";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="fulfilments"]') as HTMLElement).click();
  await settle();
}
async function openRow(id: number) {
  (document.querySelector(`[data-fulfil-toggle="${id}"]`) as HTMLElement).click();
  await settle();
}
const pillFor = (id: number) =>
  document.querySelector(`[data-fulfil-toggle="${id}"] .fx-call-pill`) as HTMLElement | null;

beforeEach(() => {
  rows = [];
  listStatus = 200;
  callStatus = 200;
  phoneStatus = 200;
  posted = [];
  history = [];
  permissions = effectivePermissions({ role: "admin", permissions: null });
  window.sessionStorage.clear();
  window.localStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => true;
  window.prompt = () => "";
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the Time to call pill", () => {
  it("shows beside a business that is due, and not beside one that is not", async () => {
    rows = [row(1, { callDue: true, callDueOn: "2026-09-01" }), row(2)];
    await openSupporters();
    expect(pillFor(1)?.textContent).toBe("Time to call");
    expect(pillFor(1)?.classList.contains("admin-pill")).toBe(true);
    expect(pillFor(2)).toBeNull();
  });

  it("is the admin's own pill, not the green New pill", async () => {
    rows = [row(1, { callDue: true })];
    await openSupporters();
    expect(pillFor(1)?.classList.contains("admin-new-pill")).toBe(false);
    expect(css).toMatch(/\.admin-pill\.is-call-due\{/);
  });
});

describe("the count line above the list", () => {
  it("counts the businesses due a call", async () => {
    rows = [row(1, { callDue: true }), row(2, { callDue: true }), row(3, { callDue: true }), row(4)];
    await openSupporters();
    expect(countLine().hidden).toBe(false);
    expect(countLine().textContent).toBe("3 businesses are due a call");
  });

  it("says one business, not one businesses", async () => {
    rows = [row(1, { callDue: true }), row(2)];
    await openSupporters();
    expect(countLine().textContent).toBe("1 business is due a call");
  });

  it("says No calls due when there are none", async () => {
    rows = [row(1), row(2)];
    await openSupporters();
    expect(countLine().textContent).toBe("No calls due");
  });

  it("sits above the list", () => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const line = doc.getElementById("fulfilmentCallCount")!;
    const table = doc.getElementById("fulfilmentsTable")!;
    expect(line.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.hasAttribute("hidden")).toBe(true);
  });

  it("is hidden when the list could not load, rather than saying nobody is due", async () => {
    listStatus = 500;
    await openSupporters();
    expect(countLine().hidden).toBe(true);
    expect(el("fulfilmentsTable").textContent).toMatch(/unavailable/i);
  });
});

describe("the Call panel", () => {
  it("shows the number as a tap to call link", async () => {
    rows = [row(1, { phone: "+44 (0)131 496-0000" })];
    await openSupporters();
    await openRow(1);
    const link = document.querySelector('[data-call-panel="1"] a[href^="tel:"]') as HTMLAnchorElement;
    expect(link.textContent).toBe("+44 (0)131 496-0000");
    // Dialled from abroad the (0) is left out, so the link leaves it out too.
    expect(link.getAttribute("href")).toBe("tel:+441314960000");
  });

  it("says so when there is no number yet", async () => {
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    const panel = document.querySelector('[data-call-panel="1"]') as HTMLElement;
    expect(panel.textContent).toContain("No phone number yet");
    expect(panel.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("shows when they were last called, by whom, and the note", async () => {
    rows = [row(1, {
      last_called_at: "2026-09-15T10:00:00Z",
      last_called_by: "fern@example.com",
      last_call_note: "Asked about the ball",
      callDueOn: "2026-12-15",
    })];
    await openSupporters();
    await openRow(1);
    const text = (document.querySelector('[data-call-panel="1"]') as HTMLElement).textContent || "";
    expect(text).toContain("15/09/2026");
    expect(text).toContain("fern@example.com");
    expect(text).toContain("Asked about the ball");
    expect(text).toContain("15/12/2026");
  });

  it("shows the UK day of the call the server gives, not the UTC one", async () => {
    rows = [row(1, { last_called_at: "2026-06-30T23:30:00Z", lastCalledOn: "2026-07-01", callDueOn: "2026-10-01" })];
    await openSupporters();
    await openRow(1);
    const text = (document.querySelector('[data-call-panel="1"]') as HTMLElement).textContent || "";
    expect(text).toContain("01/07/2026");
    expect(text).not.toContain("30/06/2026");
  });

  it("says they have not been called yet", async () => {
    rows = [row(1, { callDue: true, callDueOn: "2026-09-01" })];
    await openSupporters();
    await openRow(1);
    const text = (document.querySelector('[data-call-panel="1"]') as HTMLElement).textContent || "";
    expect(text).toContain("Not called yet");
    expect(text).toContain("Time to call");
  });

  it("says no call is needed once their gift has stopped", async () => {
    rows = [row(1, { supporting: false, callDue: false, callDueOn: null })];
    await openSupporters();
    await openRow(1);
    const text = (document.querySelector('[data-call-panel="1"]') as HTMLElement).textContent || "";
    expect(text).toMatch(/no calls needed/i);
  });

  it("escapes what it shows", async () => {
    rows = [row(1, { last_called_at: "2026-09-15T10:00:00Z", last_call_note: "<img src=x onerror=alert(1)>" })];
    await openSupporters();
    await openRow(1);
    const panel = document.querySelector('[data-call-panel="1"]') as HTMLElement;
    expect(panel.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(panel.querySelector("img")).toBeNull();
  });

  it("marking as called sends the note, clears the pill and the count, and says what happens next", async () => {
    rows = [row(1, { callDue: true, callDueOn: "2026-09-01" }), row(2)];
    await openSupporters();
    await openRow(1);
    (document.querySelector('[data-call-panel="1"] textarea[name="note"]') as HTMLTextAreaElement).value = "  Very happy  ";
    (document.querySelector('[data-call-panel="1"] form[data-call-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(posted).toEqual([{ url: "/api/admin/fulfilments/1/calls", method: "POST", body: { note: "Very happy" } }]);
    expect(pillFor(1)).toBeNull();
    expect(countLine().textContent).toBe("No calls due");
    const text = (document.querySelector('[data-call-panel="1"]') as HTMLElement).textContent || "";
    expect(text).toContain("Very happy");
    expect(text).toContain("02/01/2027");
    expect(text).toMatch(/call recorded/i);
  });

  it("sends no note when the box is left empty", async () => {
    rows = [row(1, { callDue: true })];
    await openSupporters();
    await openRow(1);
    (document.querySelector('[data-call-panel="1"] form[data-call-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(posted[0].body).toEqual({});
  });

  it("does nothing if the confirm is cancelled", async () => {
    window.confirm = () => false;
    rows = [row(1, { callDue: true })];
    await openSupporters();
    await openRow(1);
    (document.querySelector('[data-call-panel="1"] form[data-call-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(posted).toEqual([]);
  });

  it("keeps the pill and the note, and says so, when the call could not be recorded", async () => {
    callStatus = 500;
    rows = [row(1, { callDue: true })];
    await openSupporters();
    await openRow(1);
    const note = document.querySelector('[data-call-panel="1"] textarea[name="note"]') as HTMLTextAreaElement;
    note.value = "Left a message";
    (document.querySelector('[data-call-panel="1"] form[data-call-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(pillFor(1)?.textContent).toBe("Time to call");
    expect(note.value).toBe("Left a message");
    expect((document.querySelector('[data-call-panel="1"] [data-call-status]') as HTMLElement).textContent).toMatch(
      /could not record/i,
    );
  });

  it("limits the note to 500 characters", async () => {
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    const note = document.querySelector('[data-call-panel="1"] textarea[name="note"]') as HTMLTextAreaElement;
    expect(note.getAttribute("maxlength")).toBe("500");
  });

  it("saves a phone number and shows it as a link", async () => {
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    (document.querySelector('[data-call-panel="1"] input[name="phone"]') as HTMLInputElement).value = "0131 496 0000";
    (document.querySelector('[data-call-panel="1"] form[data-phone-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(posted).toEqual([{ url: "/api/admin/fulfilments/1/phone", method: "PUT", body: { phone: "0131 496 0000" } }]);
    const link = document.querySelector('[data-call-panel="1"] a[href^="tel:"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("tel:01314960000");
  });

  it("shows the server's reason when a number is refused, keeping what was typed", async () => {
    phoneStatus = 400;
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    const input = document.querySelector('[data-call-panel="1"] input[name="phone"]') as HTMLInputElement;
    input.value = "call reception";
    (document.querySelector('[data-call-panel="1"] form[data-phone-form]') as HTMLFormElement).dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );
    await settle();
    expect(input.value).toBe("call reception");
    expect((document.querySelector('[data-call-panel="1"] [data-phone-status]') as HTMLElement).textContent).toContain(
      "does not look right",
    );
  });

  it("offers no buttons to somebody who may only look", async () => {
    // A viewer granted business-supporters:view sees the panel but cannot write.
    permissions = { ...effectivePermissions({ role: "viewer", permissions: null }), "business-supporters": "view" };
    rows = [row(1, { phone: "0131 496 0000", callDue: true })];
    await openSupporters();
    await openRow(1);
    expect(document.querySelector('[data-call-panel="1"] form')).toBeNull();
    expect(document.querySelector('[data-call-panel="1"] a[href^="tel:"]')).not.toBeNull();
  });
});

describe("History", () => {
  it("names a call, with its note, and a phone change", async () => {
    history = [
      { id: 2, actor: "admin:fern@example.com", action: "fulfilment.called", data: { note: "Very happy" }, created_at: "2026-10-02T11:00:00Z" },
      { id: 1, actor: "admin:fern@example.com", action: "fulfilment.phone", data: { phone: "0131 496 0000", previous: null }, created_at: "2026-10-01T11:00:00Z" },
      { id: 0, actor: "migration:TASK-491", action: "fulfilment.phone", data: { phone: "0131 496 0002", source: "outreach" }, created_at: "2026-09-30T11:00:00Z" },
    ];
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    const text = (document.querySelector('[data-fulfil-history="1"]') as HTMLElement).textContent || "";
    expect(text).toContain("Called them");
    expect(text).toContain("Very happy");
    expect(text).toContain("Phone number set to 0131 496 0000");
    expect(text).toContain("Phone number copied from Contact businesses");
    expect(text).not.toContain("fulfilment.");
  });

  it("names a removed number", async () => {
    history = [{ id: 1, actor: "admin:fern@example.com", action: "fulfilment.phone", data: { phone: null, previous: "0131 496 0000" }, created_at: "2026-10-01T11:00:00Z" }];
    rows = [row(1)];
    await openSupporters();
    await openRow(1);
    expect((document.querySelector('[data-fulfil-history="1"]') as HTMLElement).textContent).toContain("Phone number removed");
  });
});

describe("plain words", () => {
  it("uses no dashes between words in what it shows", async () => {
    rows = [row(1, { callDue: true, phone: "0131 496 0000", last_called_at: "2026-06-01T10:00:00Z", last_called_by: "fern@example.com" })];
    await openSupporters();
    await openRow(1);
    const panel = (document.querySelector('[data-call-panel="1"]') as HTMLElement).cloneNode(true) as HTMLElement;
    // The phone number itself may contain a dash; everything else may not.
    panel.querySelectorAll("a[href^='tel:']").forEach((a) => a.remove());
    panel.querySelectorAll("input,textarea").forEach((i) => i.remove());
    const words = (panel.textContent || "") + countLine().textContent;
    expect(words).not.toMatch(/[–—]/);
    expect(words).not.toMatch(/[A-Za-z]-[A-Za-z]/);
  });
});
