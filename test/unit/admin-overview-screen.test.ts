// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// The Overview in the Donations look (2026-11-12, docs/superpowers/specs/2026-11-12-overview-contact-phone-menu-design.md).
//
// Jaimie saw it mocked up beside today's and said "look great go for it!". On a 375px phone the
// Overview was 5.3 screens long: each "Needs you" line was a sentence over a pale button on a row of
// its own, and five recent donations, drawn as a table, took nearly two screens. Now each line is a
// card that is its own button, the count large at the front the way Donations leads with the amount.
//
// Same harness as admin-app.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js evaluated
// against it. Every name, figure and address is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const css = readFileSync(resolve(ROOT, "assets/css/admin-overview.css"), "utf8");
const appSrc = readFileSync(resolve(ROOT, "assets/js/admin/app.js"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];
const token = signAdminSession({ sub: 3, email: "admin@nbcc", role: "admin", now: new Date(), secret: "s" }).token;

const XSS = "<img src=x onerror=alert(1)>";
const NOW = new Date().toISOString();

let served: Record<string, unknown> = {};
function respond(url: string) {
  const j = (body: unknown, status = 200) => ({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const path = url.split("?")[0];
  if (path === "/api/admin/login") return j({ token, user: { email: "admin@nbcc", role: "admin" } });
  if (path in served) return j(served[path]);
  if (path === "/api/admin/me") return j({ email: "admin@nbcc", permissions: effectivePermissions({ role: "admin", permissions: null }) });
  return j({ results: [] });
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const el = (id: string) => document.getElementById(id) as HTMLElement;
async function signIn() {
  (el("adminEmail") as HTMLInputElement).value = "admin@nbcc";
  (el("adminPassword") as HTMLInputElement).value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
}

const need = (over: Record<string, unknown>) => ({
  level: 2, key: "contactWaiting", count: 3, words: "contact messages are waiting for a reply",
  text: "3 contact messages are waiting for a reply", view: "contact", button: "Contact form", ...over,
});
const overview = (over: Record<string, unknown> = {}) => ({ updatedAt: NOW, needs: [], numbers: [], comingUp: [], failed: [], ...over });

beforeEach(() => {
  served = { "/api/admin/overview": overview(), "/api/admin/donations": { results: [] } };
  window.sessionStorage.clear();
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminGiftLog: unknown }).AdminGiftLog = GiftLog.createGiftLog(document, window);
  window.confirm = () => true;
  (window as unknown as { formatReceived: (s: string) => string }).formatReceived = (s) => String(s);
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown) => Promise.resolve(respond(String(url)));
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
});

describe("Needs you", () => {
  it("draws each line as one card that is the button, the count first", async () => {
    served["/api/admin/overview"] = overview({ needs: [need({ level: 1, key: "transfersOverdue", count: 2, words: "bank transfers are overdue", view: "ball", button: "Festive Ball" })] });
    await signIn();
    const card = el("overviewNeeds").querySelector("button.ov-need") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.getAttribute("data-ov-view")).toBe("ball");
    expect(card.getAttribute("data-ov-key")).toBe("transfersOverdue");
    expect(card.querySelector(".ov-need__count")!.textContent).toBe("2");
    expect(card.querySelector(".ov-need__words")!.textContent).toBe("bank transfers are overdue");
    expect(card.querySelector(".ov-need__where")!.textContent).toBe("Festive Ball");
  });

  it("groups the lines under Urgent, Waiting on you and Coming due, leaving out a group with none", async () => {
    served["/api/admin/overview"] = overview({
      needs: [need({ level: 1, key: "transfersOverdue" }), need({ level: 3, key: "gasdsDeadline" })],
    });
    await signIn();
    const heads = [...el("overviewNeeds").querySelectorAll(".ov-group")].map((h) => h.textContent!.trim());
    expect(heads).toEqual(["Urgent", "Coming due"]);
  });

  it("marks an urgent card so it can be told apart without reading", async () => {
    served["/api/admin/overview"] = overview({ needs: [need({ level: 1 }), need({ level: 2, key: "storiesNew" })] });
    await signIn();
    const cards = [...el("overviewNeeds").querySelectorAll(".ov-need")];
    expect(cards[0].classList.contains("ov-need--urgent")).toBe(true);
    expect(cards[1].classList.contains("ov-need--urgent")).toBe(false);
  });

  // An older server, mid-deploy, sends the sentence without the count. It still reads.
  it("shows the sentence alone when a line has no count", async () => {
    served["/api/admin/overview"] = overview({ needs: [{ level: 2, key: "contactWaiting", text: "3 contact messages are waiting", view: "contact", button: "Contact form" }] });
    await signIn();
    const card = el("overviewNeeds").querySelector(".ov-need") as HTMLElement;
    expect(card.querySelector(".ov-need__count")).toBeNull();
    expect(card.textContent).toContain("3 contact messages are waiting");
  });

  it("opens the screen that deals with it", async () => {
    served["/api/admin/overview"] = overview({ needs: [need({})] });
    await signIn();
    (el("overviewNeeds").querySelector(".ov-need") as HTMLElement).click();
    await settle();
    expect(el("view-contact").hidden).toBe(false);
  });

  it("names Get involved, not the old tab, on a fundraising line", async () => {
    served["/api/admin/overview"] = overview({ needs: [need({ key: "signups", view: "fundraising", button: "Fundraising" })] });
    await signIn();
    expect(el("overviewNeeds").querySelector(".ov-need__where")!.textContent).toBe("Get involved");
  });

  it("says how many things need you above the cards, and nothing when none do", async () => {
    served["/api/admin/overview"] = overview({ needs: [need({}), need({ key: "storiesNew" })] });
    await signIn();
    expect(el("overviewSummary").textContent).toBe("2 things need you.");
  });

  it("keeps the quiet-day line, word for word", async () => {
    await signIn();
    expect(el("overviewNeeds").textContent).toContain("Nothing needs you right now.");
    expect(el("overviewSummary").textContent).toBe("");
  });
});

describe("How we are doing", () => {
  const money = { key: "money", title: "Money in", headline: "£4,210 this month so far", figure: "£4,210", rest: "this month so far", detail: "£3,900 by this time last month.", view: "donations", button: "Donations" };

  it("draws each line as a scoreboard tile, the figure large", async () => {
    served["/api/admin/overview"] = overview({ numbers: [money] });
    await signIn();
    const tile = el("overviewNumbers").querySelector("button.ov-tile") as HTMLElement;
    expect(tile.getAttribute("data-ov-view")).toBe("donations");
    expect(tile.querySelector(".ov-tile__name")!.textContent).toBe("Money in");
    expect(tile.querySelector(".ov-tile__figure")!.textContent).toBe("£4,210");
    expect(tile.querySelector(".ov-tile__rest")!.textContent).toBe("this month so far");
    expect(tile.querySelector(".ov-tile__detail")!.textContent).toBe("£3,900 by this time last month.");
  });

  it("falls back to the whole headline when a line has no figure", async () => {
    const old: Record<string, unknown> = { ...money };
    delete old.figure;
    delete old.rest;
    served["/api/admin/overview"] = overview({ numbers: [old] });
    await signIn();
    expect(el("overviewNumbers").querySelector(".ov-tile__figure")!.textContent).toBe("£4,210 this month so far");
  });
});

describe("Coming up", () => {
  it("draws slim cards under day headings, each opening its screen", async () => {
    served["/api/admin/overview"] = overview({
      comingUp: [{ label: "Today", items: [{ when: "7:30pm", text: "Quiz night", view: "events", button: "Events" }] }],
    });
    await signIn();
    expect(el("overviewComing").querySelector(".ov-day-label")!.textContent).toBe("Today");
    const card = el("overviewComing").querySelector("button.ov-event") as HTMLElement;
    expect(card.querySelector(".ov-event-when")!.textContent).toBe("7:30pm");
    expect(card.querySelector(".ov-event-text")!.textContent).toBe("Quiz night");
    expect(card.getAttribute("data-ov-view")).toBe("events");
  });
});

describe("Recent donations", () => {
  const gift = (over: Record<string, unknown> = {}) => ({
    id: 41, donor_id: 7, donor_name: "Morag Kerr", amount_pence: 2500, mode: "once", plan: null, gift_aid: true,
    claim_status: "eligible", payment_status: "paid", refunded_amount_pence: 0, created_at: NOW, ...over,
  });

  it("draws gift cards, not a table", async () => {
    served["/api/admin/donations"] = { results: [gift(), gift({ id: 42, donor_name: "Callum Reid", amount_pence: 1050, gift_aid: false, mode: "monthly" })] };
    await signIn();
    expect(el("overviewRecent").querySelector("table")).toBeNull();
    const cards = el("overviewRecent").querySelectorAll(".ov-gift");
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector(".ov-gift__amount")!.textContent).toBe("£25");
    expect(cards[1].querySelector(".ov-gift__amount")!.textContent).toBe("£10.50");
    expect(cards[0].querySelector(".ov-gift__name")!.textContent).toBe("Morag Kerr");
  });

  it("marks Gift Aid, a monthly gift, where it came from, and a payment that is not plainly paid", async () => {
    served["/api/admin/donations"] = { results: [gift({ mode: "monthly", source: "red_bag", payment_status: "failed" })] };
    await signIn();
    const marks = el("overviewRecent").querySelector(".ov-gift__marks")!.textContent!;
    expect(marks).toContain("Gift Aid");
    expect(marks).toContain("Monthly");
    expect(marks).toContain("Red Bag");
    expect(marks).toContain("Failed");
  });

  it("says nothing about payment when it simply went through", async () => {
    served["/api/admin/donations"] = { results: [gift()] };
    await signIn();
    expect(el("overviewRecent").querySelector(".ov-gift__marks")!.textContent).not.toContain("Paid");
  });

  it("opens the donor, as the row's View did", async () => {
    served["/api/admin/donations"] = { results: [gift()] };
    await signIn();
    expect(el("overviewRecent").querySelector("button.ov-gift")!.getAttribute("data-donor")).toBe("7");
  });

  it("offers every donation from the foot of the list", () => {
    const see = document.querySelector('[data-ov-view="donations"].ov-see-all');
    expect(see?.textContent?.trim()).toBe("See them all");
  });

  // The Overview has its own cards now; Search still shares the old table and keeps it.
  it("leaves Search's donations table alone", async () => {
    served["/api/admin/search/donations"] = { results: [gift()] };
    await signIn();
    (document.querySelector('.admin-nav-link[data-view="search"]') as HTMLElement).click();
    (document.querySelector('[data-kind="donations"]') as HTMLElement).click();
    (el("searchQuery") as HTMLInputElement).value = "Morag";
    el("searchForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    await settle();
    expect(el("searchResults").querySelector("table")).not.toBeNull();
  });
});

// Review Focus 5: anything a person typed, and anything the server words, is shown as text.
describe("See them all", () => {
  it("is there for someone who may see Donations", async () => {
    await signIn();
    expect((document.querySelector("#view-overview .ov-see-all") as HTMLElement).hidden).toBe(false);
  });

  // A button to a screen that would only say no is a button that looks tappable and is not.
  it("is not there for someone who may not", async () => {
    const perms = effectivePermissions({ role: "admin", permissions: null }) as unknown as Record<string, unknown>;
    served["/api/admin/me"] = { email: "admin@nbcc", permissions: { ...perms, donations: "none" } };
    await signIn();
    expect((document.querySelector("#view-overview .ov-see-all") as HTMLElement).hidden).toBe(true);
  });
});

describe("markup in the data is shown as text", () => {
  it.each([
    ["a need's words", { needs: [need({ words: XSS })] }, "overviewNeeds"],
    ["a need's screen", { needs: [need({ button: XSS })] }, "overviewNeeds"],
    ["a figure", { numbers: [{ key: "money", title: "x", headline: XSS, figure: XSS, rest: "", detail: "", view: "donations", button: "Donations" }] }, "overviewNumbers"],
    ["a coming-up line", { comingUp: [{ label: "Today", items: [{ when: "1pm", text: XSS, view: "events", button: "Events" }] }] }, "overviewComing"],
  ])("in %s", async (_what, data, id) => {
    served["/api/admin/overview"] = overview(data as Record<string, unknown>);
    await signIn();
    expect(el(id).querySelector("img")).toBeNull();
    expect(el(id).textContent).toContain(XSS);
  });

  it("in a donor's name", async () => {
    served["/api/admin/donations"] = { results: [{ id: 1, donor_id: 2, donor_name: XSS, amount_pence: 100, created_at: NOW, payment_status: "paid" }] };
    await signIn();
    expect(el("overviewRecent").querySelector("img")).toBeNull();
    expect(el("overviewRecent").textContent).toContain(XSS);
  });
});

describe("the layout", () => {
  it("puts Needs you beside the rest on a wide screen, and one above the other on a phone", () => {
    expect(document.querySelector(".ov-cols > .ov-side")).not.toBeNull();
    expect(css).toMatch(/@media \(min-width: 1000px\)\s*\{[^}]*\.ov-cols\s*\{[^}]*grid-template-columns/);
  });

  it("uses the gift log's ink edge and its hard shadow that presses in", () => {
    expect(css).toContain("#3A0B0B");
    expect(css).toMatch(/\.ov-need:active\s*\{[^}]*translate/);
  });

  // Read the declarations, not the comments: the stylesheet's own header names the rule it keeps.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  it("keeps to the house rules: no !important, and nothing scrolls inside a box", () => {
    expect(rules).not.toContain("!important");
    expect(rules).not.toMatch(/overflow(-y)?:\s*(auto|scroll)/);
  });

  // The Festive Ball screen draws its own Needs you list with the old .ov-need, .ov-clear and
  // .ov-failed classes. Not one rule here may reach it.
  it("scopes every rule to the Overview, so none reaches the Festive Ball's own list", () => {
    const selectors = rules.match(/[^{}]+(?=\{)/g)!.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
    const ovSelectors = selectors.filter((s) => /\.ov-/.test(s));
    expect(ovSelectors.length).toBeGreaterThan(20);
    for (const s of ovSelectors) expect(s, s).toMatch(/^#view-overview /);
  });
});
