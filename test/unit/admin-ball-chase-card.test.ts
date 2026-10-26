// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-575: the Festive Ball admin's "Chasing guests and meals" card, first in the Emails section. It
// shows when the next reminder goes, edits the volunteers' chase list, and sends the signed-in person
// a test of each email. Driven in the admin's jsdom harness (admin.html's <body>, a fake fetch, app.js
// evaluated against it), as admin-ball-sections.test.ts does. Every name and address is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: unknown };
let perms: PermissionMap = {};
let calls: Call[] = [];
let chase: Record<string, unknown> = {};
// What PUT and POST answer: a status and a body, so a refusal can be shown.
let putAnswer: { status: number; body: unknown } = { status: 200, body: {} };
let testAnswer: { status: number; body: unknown } = { status: 200, body: { sentTo: ["admin@nbcc"] } };

const SETTINGS = {
  gateOpensAt: null, totalTables: 40, seatsPerTable: 10, heldSeats: 12, salesCloseAt: "2026-10-30T23:00:00Z",
  salesClosed: false, cardFeePercentBp: 150, cardFeeFixedPence: 20, guestDetailsLockAt: "2026-11-04T10:00:00Z",
  menuOptions: "Starter: Cullen skink | Melon", menuNote: "", arrivalTime: "7pm for 7.30pm", includedNote: "", lineUpNote: "",
};

function freshChase(): Record<string, unknown> {
  return {
    recipients: [
      { name: "Amy Example", email: "amy.example@nbcc.scot" },
      { name: "Zed Example", email: "zed.example@nbcc.scot" },
    ],
    deadline: "2026-11-04T10:00:00Z",
    nextRound: { day: "2026-10-28", daysToDeadline: 7, reminders: 23 },
    lastSends: [
      { kind: "reminder", sentOn: "2026-10-26", count: 4 },
      { kind: "list", sentOn: "2026-10-26", count: 1 },
    ],
  };
}

function respond(method: string, path: string, body: unknown) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/overview") return j({ needs: [], failed: [], numbers: [], coming: [] });
  if (method === "GET" && path === "/api/admin/whats-new") return j({ areas: [] });
  if (path === "/api/admin/ball-chase") {
    if (method === "GET") return j(chase);
    if (method === "PUT") {
      // A saved list comes back as the card's own answer.
      if (putAnswer.status === 200) chase = { ...chase, recipients: (body as { recipients: unknown[] }).recipients };
      return j(putAnswer.status === 200 ? chase : putAnswer.body, putAnswer.status);
    }
  }
  if (method === "POST" && path === "/api/admin/ball-chase/test") return j(testAnswer.body, testAnswer.status);
  if (method === "GET" && path === "/api/admin/ball") return j({
    settings: { ...SETTINGS }, gateOpen: true,
    availability: { totalSeats: 400, seatsRemaining: 76, tablesRemaining: 5 },
    dashboard: { seatsSold: 312, totalPence: 3120000, donationsPence: 124050, giftAidablePence: 98000, newsletterOptIns: 57 },
  });
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 8; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const card = () => el("ballChaseCard");
const chaseCalls = (method: string) => calls.filter((c) => c.method === method && c.path === "/api/admin/ball-chase");
const names = () => Array.from(el("ballChaseList").querySelectorAll("li b")).map((b) => b.textContent);
const hiddenWrite = () =>
  Array.from(card().querySelectorAll("[data-chasewrite]")).every((n) => (n as HTMLElement).hidden);

function boot() {
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = () => false;
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });
    return Promise.resolve(respond(method, path, body));
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
}
async function openBall() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="ball"]') as HTMLElement).click();
  await settle();
}
async function press(target: HTMLElement) {
  target.click();
  await settle();
}
async function addPerson(name: string, email: string) {
  (el("ballChaseName") as HTMLInputElement).value = name;
  (el("ballChaseEmail") as HTMLInputElement).value = email;
  await press(el("ballChaseAdd"));
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-26T10:00:00"), toFake: ["Date"] });
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  chase = freshChase();
  putAnswer = { status: 200, body: {} };
  testAnswer = { status: 200, body: { sentTo: ["admin@nbcc"] } };
  window.sessionStorage.clear();
  boot();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the card", () => {
  it("is the first thing in Emails, with its heading and its note", async () => {
    await openBall();
    const first = document.querySelector('[data-ball-part="emails"] .ball-emails > article') as HTMLElement;
    expect(first).toBe(card());
    expect(first.getAttribute("aria-labelledby")).toBe("ballChaseHead");
    expect(el("ballChaseHead").textContent).toBe("Chasing guests and meals");
    expect(first.querySelector(".admin-note")!.textContent).toBe(
      "Automatic. At 8am on the 7th, 5th, 3rd and last day before the guest details deadline, everyone who has paid and still has a seat without a name or a guest who hasn't chosen gets a reminder with a countdown. The chase list goes to the people below on those mornings and on the deadline morning.",
    );
  });

  it("no longer says that nothing sends until you press it", async () => {
    await openBall();
    const intro = document.querySelector('[data-ball-part="emails"] .ball-part-intro') as HTMLElement;
    expect(intro.textContent).toBe(
      "Each of these goes to the people who have paid. Anyone already sent one is skipped. The chasing below is automatic; the others send only when you press them.",
    );
  });

  it("asks the server for the card once, when the screen opens", async () => {
    await openBall();
    expect(chaseCalls("GET")).toHaveLength(1);
  });

  it("says when the next reminder goes and to how many bookers", async () => {
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("Next reminder: Wednesday 28 October, to 23 bookers.");
  });

  it("says it in the singular", async () => {
    chase.nextRound = { day: "2026-11-03", daysToDeadline: 1, reminders: 1 };
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("Next reminder: Tuesday 3 November, to 1 booker.");
  });

  it("says so when nobody needs the next reminder", async () => {
    chase.nextRound = { day: "2026-10-28", daysToDeadline: 7, reminders: 0 };
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("Next reminder: Wednesday 28 October. Nobody needs one right now.");
  });

  it("asks for the deadline when there is none", async () => {
    chase.deadline = null;
    chase.nextRound = null;
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("Set the guest details deadline in Set up to start the reminders.");
  });

  it("says when every round is over", async () => {
    chase.nextRound = null;
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("There are no more reminders before the deadline.");
  });

  it("says what has gone lately", async () => {
    await openBall();
    expect(el("ballChaseLast").textContent).toBe(
      "Sent lately: 4 reminders on Monday 26 October; the chase list on Monday 26 October.",
    );
  });

  it("lists the volunteers, each with a way to take them off", async () => {
    await openBall();
    expect(names()).toEqual(["Amy Example", "Zed Example"]);
    expect(el("ballChaseList").textContent).toContain("amy.example@nbcc.scot");
    expect(el("ballChaseList").querySelectorAll("[data-chaseremove]")).toHaveLength(2);
  });

  it("says when nobody is on the list", async () => {
    chase.recipients = [];
    await openBall();
    expect(el("ballChaseList").textContent).toContain("Nobody on the list yet.");
  });

  it("says it could not load, rather than showing an empty card", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string }) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = String(url).split("?")[0];
      calls.push({ method, path });
      if (path === "/api/admin/ball-chase") {
        return Promise.resolve({ status: 500, ok: false, json: () => Promise.resolve({ error: "Admin is temporarily unavailable" }) });
      }
      return Promise.resolve(respond(method, path, undefined));
    };
    await openBall();
    expect(el("ballChaseNext").textContent).toBe("Could not load the chasing settings. Open Festive Ball again in a moment.");
  });
});

describe("editing the volunteers' list", () => {
  it("saves the list that was changed, and says so", async () => {
    await openBall();
    await press(el("ballChaseList").querySelector('[data-chaseremove="0"]') as HTMLElement);
    await addPerson("Cal Example", "cal.example@nbcc.scot");
    expect(names()).toEqual(["Cal Example", "Zed Example"]);
    await press(el("ballChaseSave"));
    expect(chaseCalls("PUT")).toHaveLength(1);
    expect(chaseCalls("PUT")[0].body).toEqual({
      recipients: [
        { name: "Cal Example", email: "cal.example@nbcc.scot" },
        { name: "Zed Example", email: "zed.example@nbcc.scot" },
      ],
    });
    expect(el("ballChaseMsg").textContent).toBe("Saved.");
    expect(el("ballChaseMsg").classList.contains("is-ok")).toBe(true);
  });

  it("shows the server's refusal inline, as an error and never as err", async () => {
    putAnswer = { status: 400, body: { error: "Only nbcc.scot addresses: this list carries people's phone numbers.", path: [0, "email"] } };
    await openBall();
    await press(el("ballChaseSave"));
    const status = el("ballChaseMsg");
    expect(status.textContent).toContain("Only nbcc.scot addresses: this list carries people's phone numbers.");
    expect(status.textContent).toContain("Amy Example");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(status.classList.contains("is-ok")).toBe(false);
    expect(status.classList.contains("err")).toBe(false);
  });

  it("refuses an address that is not nbcc.scot before it is added", async () => {
    await openBall();
    await addPerson("Some One", "someone@example.com");
    expect(names()).toEqual(["Amy Example", "Zed Example"]);
    expect(el("ballChaseMsg").textContent).toBe("Only nbcc.scot addresses: this list carries people's phone numbers.");
    expect(el("ballChaseMsg").classList.contains("is-error")).toBe(true);
  });

  it("asks for a name, and refuses an address that is already there", async () => {
    await openBall();
    await addPerson("", "cal.example@nbcc.scot");
    expect(el("ballChaseMsg").textContent).toBe("Add their name.");
    await addPerson("Amy Again", "AMY.example@nbcc.scot");
    expect(el("ballChaseMsg").textContent).toBe("That address is already on the list.");
    expect(names()).toEqual(["Amy Example", "Zed Example"]);
  });

  it("stops at ten", async () => {
    chase.recipients = Array.from({ length: 10 }, (_, i) => ({ name: `Person ${String.fromCharCode(65 + i)}`, email: `person${i}@nbcc.scot` }));
    await openBall();
    await addPerson("One More", "one.more@nbcc.scot");
    expect(el("ballChaseMsg").textContent).toBe("The chase list can go to up to 10 people. Remove someone to add another.");
    expect(el("ballChaseList").querySelectorAll("li")).toHaveLength(10);
  });

  it("keeps changes nobody has saved when the screen reloads", async () => {
    await openBall();
    await addPerson("Cal Example", "cal.example@nbcc.scot");
    // Something else on the screen saves, and the whole screen reloads.
    (document.querySelector('[data-ball-section="setup"]') as HTMLElement).click();
    el("ballFeeForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(chaseCalls("GET").length).toBeGreaterThan(1);
    expect(names()).toEqual(["Amy Example", "Cal Example", "Zed Example"]);
  });
});

describe("the two test buttons", () => {
  const posts = () => calls.filter((c) => c.method === "POST" && c.path === "/api/admin/ball-chase/test");

  it("send the test reminder, and say where it went", async () => {
    await openBall();
    const b = el("ballChaseTestReminder");
    expect(b.textContent).toBe("Send me a test reminder");
    await press(b);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body).toEqual({ which: "reminder" });
    expect(el("ballChaseMsg").textContent).toBe("Sent to admin@nbcc. Have a look in your inbox.");
    expect(el("ballChaseMsg").classList.contains("is-ok")).toBe(true);
  });

  it("send the test chase list", async () => {
    await openBall();
    const b = el("ballChaseTestList");
    expect(b.textContent).toBe("Send me a test chase list");
    await press(b);
    expect(posts()[0].body).toEqual({ which: "list" });
  });

  it("say when a test could not be sent, as an error", async () => {
    testAnswer = { status: 500, body: { error: "The test could not be sent. Please try again." } };
    await openBall();
    await press(el("ballChaseTestList"));
    expect(el("ballChaseMsg").textContent).toBe("The test could not be sent. Please try again.");
    expect(el("ballChaseMsg").classList.contains("is-error")).toBe(true);
  });
});

describe("someone who can only look", () => {
  it("sees the card, but none of the controls that change anything", async () => {
    perms = effectivePermissions({ role: "viewer", permissions: null });
    await openBall();
    expect(el("ballChaseNext").textContent).toContain("Next reminder: Wednesday 28 October");
    expect(names()).toEqual(["Amy Example", "Zed Example"]);
    expect(el("ballChaseList").querySelectorAll("[data-chaseremove]")).toHaveLength(0);
    expect(hiddenWrite()).toBe(true);
    // The add form, Save and both test buttons are all marked as write controls.
    for (const id of ["ballChaseAdd", "ballChaseSave", "ballChaseTestReminder", "ballChaseTestList"]) {
      expect(el(id).closest("[data-chasewrite]")).not.toBeNull();
    }
  });

  it("an editor sees them all", async () => {
    await openBall();
    expect(Array.from(card().querySelectorAll("[data-chasewrite]")).every((n) => !(n as HTMLElement).hidden)).toBe(true);
  });
});

describe("the card's own markup", () => {
  it("uses the admin's own look and nothing new", () => {
    const article = new DOMParser().parseFromString(bodyHtml, "text/html").getElementById("ballChaseCard")!;
    expect(article.classList.contains("ball-email")).toBe(true);
    expect(article.querySelector("#ballChaseMsg")!.classList.contains("ty-status")).toBe(true);
    expect(article.querySelector("#ballChaseMsg")!.className).not.toMatch(/\berr\b/);
    expect(article.querySelector("#ballChaseTestReminder")!.className).toContain("btn");
    expect(article.querySelector("#ballChaseSave")!.className).toContain("btn");
  });
});
