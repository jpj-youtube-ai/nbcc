// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions, type PermissionMap } from "../../src/admin/permissions";

// TASK-NNN: removing an address from the Email audit's red band, in the admin's jsdom harness
// (admin.html's <body>, a fake fetch, app.js evaluated against it). The fake server answers as
// the two routes do: a removal hides an address's problems from the band, a stop blocks it unless
// it was blocked already, and a put back undoes only what the removal did. Every address, name
// and subject here is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

type Call = { method: string; path: string; body?: string };
type Row = {
  id: number; kind: string; recipient: string; recipientName: string | null; subject: string; status: string;
  error: string | null; deliveryStatus: string | null; deliveryAt: string | null; deliveryDetail: string | null; createdAt: string;
};
type Removal = { kind: "stop" | "tidy"; by: string; at: string; blocked: boolean };

let perms: PermissionMap = {};
let calls: Call[] = [];
let log: Row[] = [];
let removals: Record<string, Removal> = {};
let blocked: Record<string, string> = {}; // address -> why it is blocked
let postAnswer: "ok" | "down" | number = "ok";
let gate: Promise<void> | null = null;
let openGate: () => void = () => undefined;
const holdPosts = () => {
  gate = new Promise<void>((r) => {
    openGate = r;
  });
};

const REMOVED_AT = "2026-10-05T10:00:00Z";
const row = (id: number, recipient: string, over: Partial<Row> = {}): Row => ({
  id, kind: "newsletter", recipient, recipientName: null, subject: "Winter update", status: "sent", error: null,
  deliveryStatus: null, deliveryAt: null, deliveryDetail: null, createdAt: `2026-10-0${(id % 4) + 1}T09:00:00Z`, ...over,
});
const isProblem = (r: Row) => r.status === "failed" || r.deliveryStatus === "bounced" || r.deliveryStatus === "complained";
const isOwn = (email: string) => /@([a-z0-9.-]+\.)?nbcc\.scot$/i.test(email);

function respond(method: string, path: string, body?: string) {
  const j = (payload: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: perms });
  if (path === "/api/admin/email-log" && method === "GET") {
    const mark = (r: Row) => {
      const rm = isProblem(r) ? removals[r.recipient] : undefined;
      return { ...r, removedAt: rm ? rm.at : null, removedBy: rm ? rm.by : null, removedKind: rm ? rm.kind : null };
    };
    return j({
      results: log.map(mark),
      total: log.length,
      failures: log.filter((r) => isProblem(r) && !removals[r.recipient]).map(mark),
    });
  }
  if (path === "/api/admin/email-log/remove" || path === "/api/admin/email-log/put-back") {
    if (postAnswer === "down") throw new TypeError("Failed to fetch");
    if (postAnswer !== "ok") return j({ error: "Admin is temporarily unavailable" }, postAnswer);
    const sent = JSON.parse(body || "{}") as { email: string; stop?: boolean };
    if (path.endsWith("/remove")) {
      if (sent.stop && isOwn(sent.email)) return j({ error: "The charity's own addresses are never blocked" }, 400);
      const blockedNow = Boolean(sent.stop) && !blocked[sent.email];
      if (blockedNow) blocked[sent.email] = "manual";
      removals[sent.email] = { kind: sent.stop ? "stop" : "tidy", by: "admin@nbcc", at: REMOVED_AT, blocked: blockedNow };
      return j({ removed: true, stopped: Boolean(sent.stop), blockedNow });
    }
    const rm = removals[sent.email];
    if (!rm) return j({ error: "That address has not been removed" }, 404);
    delete removals[sent.email];
    const unblocked = rm.blocked && blocked[sent.email] === "manual";
    if (unblocked) delete blocked[sent.email];
    return j({ putBack: true, unblocked, stillBlocked: Boolean(blocked[sent.email]) });
  }
  return j({ results: [] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) await flush();
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
const band = () => el("emailAuditFailures");
const blocks = () => Array.from(band().querySelectorAll(".email-fail-item")) as HTMLElement[];
const blockOf = (email: string) => blocks().find((b) => b.getAttribute("data-audit-address") === email) as HTMLElement;
const stopBtn = (email: string) => blockOf(email).querySelector("[data-audit-stop]") as HTMLElement;
const tidyBtn = (email: string) => blockOf(email).querySelector("[data-audit-tidy]") as HTMLElement;
const said = () => el("emailAuditSaid");
// What the line says, without the words of the Put back button inside it.
const saidWords = () => Array.from(said().childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
const saidUndo = () => said().querySelector("[data-audit-putback]") as HTMLElement | null;
const listRows = () => Array.from(document.querySelectorAll("#emailAuditTable tbody tr")) as HTMLElement[];
const posts = () => calls.filter((c) => c.method === "POST" && c.path.startsWith("/api/admin/email-log/"));

async function openAudit() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (document.querySelector('.admin-nav-link[data-view="email-audit"]') as HTMLElement).click();
  await settle();
}
async function press(target: HTMLElement) {
  target.click();
  await settle();
}

let confirmSays: string[] = [];
let confirmAnswer = true;

beforeEach(() => {
  perms = effectivePermissions({ role: "admin", permissions: null });
  calls = [];
  removals = {};
  blocked = {};
  postAnswer = "ok";
  gate = null;
  confirmSays = [];
  confirmAnswer = true;
  // Newest first, as the server sends them. Ada has two problems and one email that arrived.
  log = [
    row(7, "ada@example.org", { recipientName: "Ada Example", deliveryStatus: "bounced", deliveryDetail: "550 no such user" }),
    row(6, "bo@example.org", { kind: "receipt", subject: "Your receipt", status: "failed", error: "SES send responded 400" }),
    row(5, "events@nbcc.scot", { kind: "fundraisePledgeStaff", subject: "A pledge to check", deliveryStatus: "bounced" }),
    row(4, "ada@example.org", { recipientName: "Ada Example", kind: "thankYou", subject: "Thank you", deliveryStatus: "complained" }),
    row(3, "ada@example.org", { recipientName: "Ada Example", subject: "Autumn update", deliveryStatus: "delivered" }),
  ];
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  window.confirm = (message?: string) => {
    confirmSays.push(String(message));
    return confirmAnswer;
  };
  window.alert = () => undefined;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: { method?: string; body?: string }) => {
    const method = (init?.method || "GET").toUpperCase();
    const path = String(url).split("?")[0];
    calls.push({ method, path, body: init?.body });
    const answer = () => {
      try {
        return Promise.resolve(respond(method, path, init?.body));
      } catch (err) {
        return Promise.reject(err);
      }
    };
    return method === "POST" && path.startsWith("/api/admin/email-log/") && gate ? gate.then(answer) : answer();
  };
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("the red band, one block an address", () => {
  it("counts the problems in its heading, as before", async () => {
    await openAudit();
    expect((band().querySelector("h3") as HTMLElement).textContent).toBe("Needs a look: 4 problems in the last 14 days");
  });

  it("lists each address once, newest problem first, with its name", async () => {
    await openAudit();
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toEqual(["ada@example.org", "bo@example.org", "events@nbcc.scot"]);
    const who = blockOf("ada@example.org").querySelector(".email-fail-address") as HTMLElement;
    expect(who.textContent).toContain("ada@example.org");
    expect(who.textContent).toContain("Ada Example");
  });

  it("puts every problem of an address under it: what happened, which email, when and why", async () => {
    await openAudit();
    const problems = Array.from(blockOf("ada@example.org").querySelectorAll(".email-fail-problems > li")).map((li) => li.textContent);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("Bounced");
    expect(problems[0]).toContain("Newsletter");
    expect(problems[0]).toContain("Winter update");
    expect(problems[0]).toContain(helpers.fmtDate("2026-10-04T09:00:00Z"));
    expect(problems[0]).toContain("550 no such user");
    expect(problems[1]).toContain("Marked as spam");
    expect(problems[1]).toContain("Thank you");
    // An email that arrived is not a problem and is not in the band.
    expect(band().textContent).not.toContain("Autumn update");
  });

  it("gives each address Remove and stop emails as the button and Just tidy away as the quieter link", async () => {
    await openAudit();
    expect(stopBtn("ada@example.org").textContent).toBe("Remove and stop emails");
    expect(stopBtn("ada@example.org").className).toBe("admin-btn");
    expect(tidyBtn("ada@example.org").textContent).toBe("Just tidy away");
    expect(tidyBtn("ada@example.org").className).toBe("admin-link");
  });

  // Blocking events@ would stop the charity's own notes to itself.
  it("offers one of the charity's own addresses Tidy away only, and says why", async () => {
    await openAudit();
    const own = blockOf("events@nbcc.scot");
    expect(own.querySelector("[data-audit-stop]")).toBeNull();
    expect((own.querySelector("[data-audit-tidy]") as HTMLElement).textContent).toBe("Tidy away");
    expect(own.textContent).toContain("One of the charity's own addresses, so it is never blocked.");
  });

  it("shows the blocks and nothing to press to someone who may only view the Email audit", async () => {
    perms = { overview: "view", "email-audit": "view" };
    await openAudit();
    expect(blocks()).toHaveLength(3);
    expect(band().querySelectorAll("button")).toHaveLength(0);
  });

  it("has no band at all when nothing is wrong", async () => {
    log = [row(3, "ada@example.org", { deliveryStatus: "delivered" })];
    await openAudit();
    expect(band().innerHTML).toBe("");
  });
});

describe("Just tidy away", () => {
  it("sends the address, not to be stopped, with no question asked", async () => {
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    expect(confirmSays).toEqual([]);
    expect(posts()).toEqual([
      { method: "POST", path: "/api/admin/email-log/remove", body: '{"email":"ada@example.org","stop":false}' },
    ]);
  });

  it("takes the address out of the band and says what was done, with a way to put it back", async () => {
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toEqual(["bo@example.org", "events@nbcc.scot"]);
    expect((band().querySelector("h3") as HTMLElement).textContent).toBe("Needs a look: 2 problems in the last 14 days");
    expect(saidWords()).toBe("Tidied away ada@example.org.");
    expect(said().className).toBe("ty-status is-ok");
    expect((saidUndo() as HTMLElement).textContent).toBe("Put back");
    expect((saidUndo() as HTMLElement).getAttribute("data-audit-putback")).toBe("ada@example.org");
  });

  it("works for one of the charity's own addresses", async () => {
    await openAudit();
    await press(tidyBtn("events@nbcc.scot"));
    expect(posts()[0].body).toBe('{"email":"events@nbcc.scot","stop":false}');
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toEqual(["ada@example.org", "bo@example.org"]);
  });

  it.each([500, "down" as const])("says so, and leaves the band as it was, when it could not be done (%s)", async (answer) => {
    postAnswer = answer;
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    expect(saidWords()).toBe("Could not do that. Please try again.");
    expect(said().className).toBe("ty-status is-error");
    expect(saidUndo()).toBeNull();
    expect(blocks()).toHaveLength(3);
  });

  it("sends one request for a double press, and shows the screen is busy until the answer", async () => {
    await openAudit();
    holdPosts();
    const btn = tidyBtn("ada@example.org");
    btn.click();
    btn.click();
    tidyBtn("bo@example.org").click();
    await settle();
    expect(posts()).toHaveLength(1);
    expect(el("view-email-audit").getAttribute("aria-busy")).toBe("true");
    openGate();
    await settle();
    expect(posts()).toHaveLength(1);
    expect(el("view-email-audit").hasAttribute("aria-busy")).toBe(false);
  });
});

describe("Remove and stop emails", () => {
  it("asks first: the address, what stops, what still goes, and how many problems leave", async () => {
    confirmAnswer = false;
    await openAudit();
    await press(stopBtn("ada@example.org"));
    expect(confirmSays).toHaveLength(1);
    expect(confirmSays[0]).toContain("Stop emailing ada@example.org?");
    expect(confirmSays[0]).toContain("Newsletters and fundraising emails will no longer go to this address.");
    expect(confirmSays[0]).toContain("Receipts, booking confirmations and sign in codes still will.");
    expect(confirmSays[0]).toContain("Its 2 problems leave this list.");
    expect(confirmSays[0]).toContain("You can put it back");
  });

  it("does nothing when the answer is no", async () => {
    confirmAnswer = false;
    await openAudit();
    await press(stopBtn("ada@example.org"));
    expect(posts()).toEqual([]);
    expect(blocks()).toHaveLength(3);
    expect(said().textContent).toBe("");
  });

  it("says problem, not problems, for one", async () => {
    confirmAnswer = false;
    await openAudit();
    await press(stopBtn("bo@example.org"));
    expect(confirmSays[0]).toContain("Its 1 problem leaves this list.");
  });

  it("on yes, sends the address to be stopped, takes it out of the band and says what was done", async () => {
    await openAudit();
    await press(stopBtn("ada@example.org"));
    expect(posts()).toEqual([
      { method: "POST", path: "/api/admin/email-log/remove", body: '{"email":"ada@example.org","stop":true}' },
    ]);
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toEqual(["bo@example.org", "events@nbcc.scot"]);
    expect(saidWords()).toBe("Removed ada@example.org and stopped emails to it.");
    expect((saidUndo() as HTMLElement).getAttribute("data-audit-putback")).toBe("ada@example.org");
  });

  // Its mail had already bounced for good, so it was blocked before staff pressed anything.
  it("says emails were already stopped when the address was blocked before", async () => {
    blocked["ada@example.org"] = "bounced";
    await openAudit();
    await press(stopBtn("ada@example.org"));
    expect(saidWords()).toBe("Removed ada@example.org. Emails to it were already stopped.");
  });

  it("moves the keyboard to the line that says what was done, since the button pressed is gone", async () => {
    await openAudit();
    stopBtn("ada@example.org").focus();
    await press(stopBtn("ada@example.org"));
    expect(document.activeElement).toBe(said());
  });
});

describe("the full list keeps everything", () => {
  const rowsTo = (email: string) => listRows().filter((tr) => (tr.textContent || "").includes(email));

  it("still lists every email, removed or not", async () => {
    await openAudit();
    await press(stopBtn("ada@example.org"));
    expect(listRows()).toHaveLength(5);
    expect(rowsTo("ada@example.org")).toHaveLength(3);
  });

  it("says under a removed problem's status who removed it, when and how, with Put back", async () => {
    await openAudit();
    await press(stopBtn("ada@example.org"));
    const first = rowsTo("ada@example.org")[0];
    expect(first.textContent).toContain(`Removed, emails stopped, by admin@nbcc on ${helpers.fmtDate(REMOVED_AT)}`);
    expect((first.querySelector("[data-audit-putback]") as HTMLElement).textContent).toBe("Put back");
    expect((first.querySelector("[data-audit-putback]") as HTMLElement).getAttribute("data-audit-putback")).toBe("ada@example.org");
  });

  it("says Tidied away for a tidy", async () => {
    await openAudit();
    await press(tidyBtn("bo@example.org"));
    expect(rowsTo("bo@example.org")[0].textContent).toContain(`Tidied away by admin@nbcc on ${helpers.fmtDate(REMOVED_AT)}`);
  });

  it("marks only the problems, never an email that arrived", async () => {
    await openAudit();
    await press(stopBtn("ada@example.org"));
    const arrived = rowsTo("ada@example.org").find((tr) => (tr.textContent || "").includes("Autumn update")) as HTMLElement;
    expect(arrived.textContent).not.toContain("Removed");
    expect(arrived.querySelector("[data-audit-putback]")).toBeNull();
  });

  it("shows the mark and no Put back to someone who may only view", async () => {
    removals["bo@example.org"] = { kind: "tidy", by: "admin@nbcc", at: REMOVED_AT, blocked: false };
    perms = { overview: "view", "email-audit": "view" };
    await openAudit();
    expect(rowsTo("bo@example.org")[0].textContent).toContain("Tidied away by admin@nbcc");
    expect(document.querySelectorAll("#view-email-audit [data-audit-putback]")).toHaveLength(0);
  });
});

describe("Put back", () => {
  it("from the line that says what was done: sends the address, and its problems return to the band", async () => {
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    await press(saidUndo() as HTMLElement);
    expect(posts()[1]).toEqual({ method: "POST", path: "/api/admin/email-log/put-back", body: '{"email":"ada@example.org"}' });
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toEqual(["ada@example.org", "bo@example.org", "events@nbcc.scot"]);
    expect(saidWords()).toBe("Put back ada@example.org.");
    expect(saidUndo()).toBeNull();
  });

  it("from a row in the full list", async () => {
    removals["bo@example.org"] = { kind: "tidy", by: "admin@nbcc", at: REMOVED_AT, blocked: false };
    await openAudit();
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).not.toContain("bo@example.org");
    await press(document.querySelector('#emailAuditTable [data-audit-putback="bo@example.org"]') as HTMLElement);
    expect(posts()).toEqual([{ method: "POST", path: "/api/admin/email-log/put-back", body: '{"email":"bo@example.org"}' }]);
    expect(blocks().map((b) => b.getAttribute("data-audit-address"))).toContain("bo@example.org");
  });

  it("says emails are no longer stopped when it unblocked the address", async () => {
    await openAudit();
    await press(stopBtn("ada@example.org"));
    await press(saidUndo() as HTMLElement);
    expect(saidWords()).toBe("Put back ada@example.org. Emails to it are no longer stopped.");
  });

  it("says the address is still blocked, and where to unblock it, when the block was not this removal's", async () => {
    blocked["ada@example.org"] = "bounced";
    await openAudit();
    await press(stopBtn("ada@example.org"));
    await press(saidUndo() as HTMLElement);
    expect(saidWords()).toBe(
      "Put back ada@example.org. It is still blocked, because its mail bounced or it marked us as spam. To unblock it, go to Newsletter, Blocked addresses.",
    );
  });

  it("says so when it could not be put back", async () => {
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    postAnswer = 500;
    await press(saidUndo() as HTMLElement);
    expect(saidWords()).toBe("Could not do that. Please try again.");
    expect(said().className).toBe("ty-status is-error");
    expect(blocks()).toHaveLength(2);
  });
});

describe("what was said does not outstay its moment", () => {
  it("is cleared when the list is loaded again for another reason", async () => {
    await openAudit();
    await press(tidyBtn("ada@example.org"));
    expect(said().textContent).not.toBe("");
    el("emailAuditFilters").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(said().textContent).toBe("");
    expect(said().className).toBe("ty-status");
  });
});

describe("its styles", () => {
  // In one form, whatever the spacing: no comments, no space around the punctuation.
  const css = readFileSync(resolve(ROOT, "assets/css/admin.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,>])\s*/g, "$1");
  const rule = (selector: string) => {
    const at = css.indexOf(selector + "{");
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  // A block is a row that wraps: the address, then what can be pressed. On a phone the two sit
  // one above the other, and nothing is ever wider than the screen.
  it("lets a block's address and its controls wrap", () => {
    expect(rule(".email-fail-who")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".email-fail-actions")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("breaks a long address rather than pushing the band wider", () => {
    expect(rule(".email-fail-address")).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("gives both controls a target a thumb can hit", () => {
    expect(rule(".email-fail-actions .admin-btn,.email-fail-actions .admin-link")).toMatch(/min-height:\s*44px/);
  });

  it("shows that a press is being saved", () => {
    expect(rule('#view-email-audit[aria-busy="true"] [data-audit-stop],#view-email-audit[aria-busy="true"] [data-audit-tidy],#view-email-audit[aria-busy="true"] [data-audit-putback]')).toMatch(/cursor:\s*progress/);
  });

  // .ty-status keeps a line of room while it is empty, so its words do not push the band down
  // under the pointer when they arrive.
  it("keeps room for the line that says what was done, above the band", () => {
    expect(html).toMatch(/<p class="ty-status" id="emailAuditSaid" role="status" aria-live="polite" tabindex="-1"><\/p>\s*<div id="emailAuditFailures"/);
    expect(rule(".ty-status")).toMatch(/min-height:/);
  });
});
