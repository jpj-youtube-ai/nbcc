// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { signAdminSession } from "../../src/admin/session";
import { effectivePermissions } from "../../src/admin/permissions";

// Admin > Thank you, in the kit's look (2026-11-14,
// docs/superpowers/specs/2026-11-14-admin-refresh-thanks.md). The screen in three parts (Who to thank,
// Write the letter, Letters sent), and the four faults it had: it said "Sent" when the email had
// failed, a second press sent the same letter again, the letter could not be read on a phone, and
// the history stopped at 50.
//
// Same harness as admin-could-not-load.test.ts: admin.html's <body> in jsdom, a fake fetch, app.js
// evaluated against it. Every person, address and amount here is invented.

vi.setConfig({ testTimeout: 20_000 });

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");
const html = read("admin.html");
const appSrc = read("assets/js/admin/app.js");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const Kit = require(resolve(ROOT, "assets/js/admin/kit.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Row = Record<string, unknown>;
const donor = (donorId: number, name: string, over: Row = {}): Row => ({
  donorId, name, email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com", maxGiftPence: 150000, giftAided: false,
  anonymous: false, alreadyThanked: false, lastThankedAt: null, givenSinceThankedPence: null, giftsSinceThanked: null,
  sendState: "ready", ...over,
});
const letter = (id: number, name: string, over: Row = {}): Row => ({
  id, donorId: id + 100, thankYouName: name, addressedTo: name.split(" ")[0], recipientEmail: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com",
  giftType: "money", giftAmountPence: 120000, giftInKind: null, giftAided: false, personalMessage: null,
  signedByName: "Fern Example", signedByRole: "Trustee", sentBy: "fern@example.com", ccEmail: null,
  sentAt: "2026-11-03T10:00:00.000Z", printUrl: "https://portal.example.com/thank-you/letter/token-" + id, ...over,
});

let eligible: Row[] = [];
let sent: Row[] = [];
let permissions: Record<string, string> = {};
let role = "admin";
let calls: { method: string; url: string; body: Row | null }[] = [];
// What the send answers: a status and a body, or a promise of one (to hold a send open).
let sendAnswer: () => { status: number; body: Row } | Promise<{ status: number; body: Row }>;
let deleteStatus = 200;
let sentFails = false;

function respond(url: string, init?: { method?: string; body?: string }) {
  const j = (body: unknown, status = 200) => ({
    status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body), text: () => Promise.resolve(""),
    headers: { get: () => "application/json" },
  });
  const method = (init?.method || "GET").toUpperCase();
  const path = url.split("?")[0];
  calls.push({ method, url, body: init?.body ? (JSON.parse(init.body) as Row) : null });
  if (path === "/api/admin/login") {
    const token = signAdminSession({ sub: 3, email: "fern@example.com", role, now: new Date(), secret: "s" }).token;
    return j({ token, user: { email: "fern@example.com", role } });
  }
  if (path === "/api/admin/me") return j({ email: "fern@example.com", permissions });
  if (path === "/api/admin/thank-you/eligible") return j({ thresholdPence: 100000, results: eligible });
  if (path === "/api/admin/thank-you/sent" && method === "GET") {
    if (sentFails) return j({ error: "Admin is temporarily unavailable" }, 500);
    const q = new URLSearchParams(url.split("?")[1] || "");
    const limit = Number(q.get("limit")) || 50;
    const offset = Number(q.get("offset")) || 0;
    return j({ results: sent.slice(offset, offset + limit), total: sent.length });
  }
  if (path === "/api/admin/thank-you/send") {
    return Promise.resolve(sendAnswer()).then((a) => j(a.body, a.status));
  }
  if (path.startsWith("/api/admin/thank-you/sent/") && method === "DELETE") {
    if (deleteStatus !== 200) return j({ error: "Admin is temporarily unavailable" }, deleteStatus);
    sent = sent.filter((r) => String(r.id) !== path.split("/").pop());
    return j({ deleted: true });
  }
  return j({ results: [] });
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = (node: Element | null) => ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
const view = () => el("view-thank-you");
const shownParts = () => qa("#view-thank-you [data-akpart-body]").filter((p) => !p.hidden).map((p) => p.getAttribute("data-akpart-body"));
const posts = () => calls.filter((c) => c.method === "POST" && c.url === "/api/admin/thank-you/send");
const type = (id: string, value: string) => {
  input(id).value = value;
  input(id).dispatchEvent(new Event("input", { bubbles: true }));
  input(id).dispatchEvent(new Event("change", { bubbles: true }));
};

function boot() {
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  (window as unknown as { AdminKit: unknown }).AdminKit = Kit;
  // eslint-disable-next-line no-eval
  (0, eval)(appSrc);
}
async function openScreen() {
  input("adminEmail").value = "fern@example.com";
  input("adminPassword").value = "pw";
  el("loginForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  await settle();
  (q('.admin-nav-link[data-view="thank-you"]') as HTMLElement).click();
  await settle();
}
/** Press Write (or Thank again) on a donor in the list. */
async function write(donorId: number) {
  (q(`#tyEligibleTable [data-ty-donor="${donorId}"]`) as HTMLElement).click();
  await settle();
}
/** Press Send, and say yes to the question if the screen asks one. */
async function pressSend() {
  el("tySend").click();
  await settle();
  const yes = el("tyAskYes");
  if (yes && !el("tyAsk").hidden) {
    yes.click();
    await settle();
  }
}

beforeEach(() => {
  eligible = [];
  sent = [];
  permissions = effectivePermissions({ role: "admin", permissions: null }) as unknown as Record<string, string>;
  role = "admin";
  calls = [];
  sendAnswer = () => ({ status: 201, body: { id: 77, giftSummary: "£1500.00", emailed: true } });
  deleteStatus = 200;
  sentFails = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = function () {};
  window.confirm = () => true;
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: unknown, init?: unknown) =>
    Promise.resolve(respond(String(url), init as { method?: string; body?: string }));
  boot();
});

// ---------------------------------------------------------------------------------------------
// The four faults
// ---------------------------------------------------------------------------------------------

describe("fault: it said Sent when the email had failed", () => {
  beforeEach(async () => {
    eligible = [donor(7, "Rowan Example"), donor(8, "Sam Example", { maxGiftPence: 120000 })];
    await openScreen();
    await write(7);
  });

  it("says in the page that the email did not go and that nothing was recorded", async () => {
    sendAnswer = () => ({ status: 502, body: { error: "The email could not be sent. Nothing has been recorded.", emailed: false, recorded: false } });
    await pressSend();
    const status = el("tyStatus");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(text(status)).toContain("The email to rowan.example@example.com did not go");
    expect(text(status)).toContain("Rowan Example has not been marked as thanked");
    expect(text(status)).not.toContain("Sent");
  });

  it("leaves the letter as it was typed, to try again", async () => {
    type("tyPersonal", "It meant a great deal.");
    sendAnswer = () => ({ status: 502, body: { error: "The email could not be sent. Nothing has been recorded.", emailed: false, recorded: false } });
    await pressSend();
    expect(input("tyName").value).toBe("Rowan Example");
    expect(input("tyEmail").value).toBe("rowan.example@example.com");
    expect(input("tyPersonal").value).toBe("It meant a great deal.");
    expect(input("tyDonorId").value).toBe("7");
  });

  it("does not show the donor as thanked when the server did not mark them", async () => {
    sendAnswer = () => ({ status: 502, body: { error: "The email could not be sent. Nothing has been recorded.", emailed: false, recorded: false } });
    await pressSend();
    const card = q('#tyEligibleTable [data-ty-row="7"]');
    expect(text(card)).toContain("Ready");
    expect(text(card)).not.toContain("Thanked");
    expect(text(el("tyNext"))).toBe("");
  });

  it("never says Sent for a reply that says the email did not go, whatever its status", async () => {
    sendAnswer = () => ({ status: 201, body: { id: 77, giftSummary: "£1500.00", emailed: false } });
    await pressSend();
    expect(el("tyStatus").classList.contains("is-error")).toBe(true);
    expect(text(el("tyStatus"))).toContain("did not go");
    expect(text(el("tyStatus"))).not.toContain("Sent");
  });

  it("says a plain could not send, and keeps the letter, when the server is down", async () => {
    sendAnswer = () => ({ status: 500, body: { error: "Admin is temporarily unavailable" } });
    await pressSend();
    expect(el("tyStatus").classList.contains("is-error")).toBe(true);
    expect(text(el("tyStatus"))).toContain("Could not send the letter");
    expect(input("tyName").value).toBe("Rowan Example");
  });
});

describe("the email went but no record was kept", () => {
  beforeEach(async () => {
    eligible = [donor(7, "Rowan Example"), donor(8, "Sam Example", { maxGiftPence: 120000 })];
    await openScreen();
    await write(7);
    sendAnswer = () => ({ status: 500, body: { error: "The email went, but no record was kept.", emailed: true, recorded: false } });
    await pressSend();
  });

  it("says the email went and not to send it again", () => {
    const status = el("tyStatus");
    expect(status.classList.contains("is-error")).toBe(true);
    expect(text(status)).toContain("The email went, but we could not keep a record of it. Do not send it again; check the donor's inbox with them if unsure.");
    expect(text(status)).not.toContain("try again");
  });

  it("offers no easy way to send it again: the form is cleared and a second press sends nothing", async () => {
    expect(input("tyName").value).toBe("");
    expect(input("tyEmail").value).toBe("");
    expect(input("tyDonorId").value).toBe("");
    el("tySend").click();
    await settle();
    expect(el("tyAsk").hidden).toBe(true);
    expect(posts().length).toBe(1);
    expect(text(el("tyStatus"))).toContain("Do not send it again");
    expect(text(el("tyNext"))).toBe("");
  });
});

describe("fault: a second press sent the same letter again", () => {
  beforeEach(async () => {
    eligible = [donor(7, "Rowan Example"), donor(8, "Sam Example", { maxGiftPence: 120000 })];
    await openScreen();
    await write(7);
  });

  it("clears the form once the letter has gone", async () => {
    type("tyPersonal", "It meant a great deal.");
    await pressSend();
    expect(posts().length).toBe(1);
    expect(input("tyName").value).toBe("");
    expect(input("tyDear").value).toBe("");
    expect(input("tyEmail").value).toBe("");
    expect(input("tyPersonal").value).toBe("");
    expect(input("tyDonorId").value).toBe("");
  });

  it("says who was thanked, beside the button", async () => {
    await pressSend();
    const status = el("tyStatus");
    expect(status.classList.contains("is-ok")).toBe(true);
    expect(text(status)).toContain("Rowan Example");
    expect(text(status)).toContain("rowan.example@example.com");
    expect(el("tySend").parentElement!.parentElement!.contains(status)).toBe(true);
  });

  it("sends nothing on a second press", async () => {
    await pressSend();
    await pressSend();
    expect(posts().length).toBe(1);
  });

  it("sends once when the yes is pressed twice before the server answers", async () => {
    let finish: (a: { status: number; body: Row }) => void = () => {};
    sendAnswer = () => new Promise((r) => { finish = r; });
    el("tySend").click();
    await settle();
    el("tyAskYes").click();
    el("tyAskYes").click();
    el("tySend").click();
    await settle();
    expect(posts().length).toBe(1);
    finish({ status: 201, body: { id: 77, giftSummary: "£1500.00", emailed: true } });
    await settle();
    expect(posts().length).toBe(1);
    expect(text(el("tyStatus"))).toContain("Rowan Example");
  });
});

describe("fault: the letter could not be read on a phone", () => {
  const onAPhone = () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({ matches: query.includes("max-width"), media: query });
  };
  const width = (px: number) => Object.defineProperty(el("tyPaperWrap"), "clientWidth", { value: px, configurable: true });

  it("shows the words at normal size, not the shrunken sheet, on a phone", async () => {
    onAPhone();
    eligible = [donor(7, "Rowan Example")];
    await openScreen();
    width(358);
    await write(7);
    expect(el("tyPaperWrap").getAttribute("data-view")).toBe("read");
    expect(el("tyPaper").style.transform).toBe("");
    expect(el("tyPaperWrap").style.height).toBe("");
    expect(text(el("tyViewToggle"))).toBe("See it as a page");
  });

  it("shows the A4 sheet, fitted to the screen, on See it as a page, and comes back", async () => {
    onAPhone();
    eligible = [donor(7, "Rowan Example")];
    await openScreen();
    width(358);
    await write(7);
    el("tyViewToggle").click();
    expect(el("tyPaperWrap").getAttribute("data-view")).toBe("page");
    expect(el("tyPaper").style.transform).toContain("scale(0.45");
    expect(text(el("tyViewToggle"))).toBe("Read it at normal size");
    el("tyViewToggle").click();
    expect(el("tyPaperWrap").getAttribute("data-view")).toBe("read");
    expect(el("tyPaper").style.transform).toBe("");
  });

  it("opens on the sheet on a laptop, and fits it when the part is shown", async () => {
    eligible = [donor(7, "Rowan Example")];
    await openScreen();
    // Hidden parts have no width: the sheet can only be fitted once Write the letter is showing.
    width(600);
    await write(7);
    expect(shownParts()).toEqual(["write"]);
    expect(el("tyPaperWrap").getAttribute("data-view")).toBe("page");
    expect(el("tyPaper").style.transform).toContain("scale(0.75");
  });

  it("gives the reading layout words of 16px, in one column, in its own stylesheet", () => {
    const css = read("assets/css/admin-thanks.css");
    const rule = (start: string) => {
      const at = css.indexOf(start);
      expect(at, start).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    expect(rule('#view-thank-you .ty-paper-wrap[data-view="read"] .ty-letter-body p {')).toContain("font-size: 1rem");
    expect(rule('#view-thank-you .ty-paper-wrap[data-view="read"] .ty-page {')).toContain("width: auto");
    expect(rule('#view-thank-you .ty-paper-wrap[data-view="read"] .ty-paper {')).toContain("transform: none");
  });
});

describe("fault: the history stopped at 50", () => {
  beforeEach(async () => {
    sent = Array.from({ length: 120 }, (_, i) => letter(500 - i, "Donor " + (i + 1) + " Example"));
    await openScreen();
    (q('#tyParts [data-akpart="sent"]') as HTMLElement).click();
    await settle();
  });

  it("shows the first 50 and says how many there are in all", () => {
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(50);
    expect(text(el("tySentCount"))).toContain("50 of 120");
    expect(el("tySentMore").hidden).toBe(false);
  });

  it("fetches the next 50 on Show more and adds them under the first", async () => {
    el("tySentMore").click();
    await settle();
    expect(calls.some((c) => c.url.includes("/api/admin/thank-you/sent?") && c.url.includes("offset=50"))).toBe(true);
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(100);
    expect(text(qa("#tySentTable [data-ty-sent]")[0])).toContain("Donor 1 Example");
    expect(text(el("tySentCount"))).toContain("100 of 120");
  });

  it("takes the button away once every letter is showing", async () => {
    el("tySentMore").click();
    await settle();
    el("tySentMore").click();
    await settle();
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(120);
    expect(el("tySentMore").hidden).toBe(true);
  });

  it("says so beside the button when more could not be fetched, and keeps what is there", async () => {
    sentFails = true;
    el("tySentMore").click();
    await settle();
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(50);
    expect(text(el("tySentSaid"))).toContain("Could not load more letters");
    expect(el("tySentSaid").classList.contains("is-error")).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------

describe("the screen, in the kit's look and in three parts", () => {
  it("takes the kit's look and opens with one plain sentence", () => {
    expect(view().classList.contains("ak")).toBe(true);
    expect(text(q("#view-thank-you > h2"))).toBe("Thank you letters");
    expect(text(q("#view-thank-you > .admin-view-intro"))).toContain("Write a personal thank you letter");
  });

  it("has a bar of three parts and opens on Who to thank", async () => {
    await openScreen();
    expect(qa("#tyParts .ak-part-btn").map((b) => text(b))).toEqual(["Who to thank", "Write the letter", "Letters sent"]);
    expect(shownParts()).toEqual(["who"]);
  });

  it("shows one part at a time", async () => {
    await openScreen();
    (q('#tyParts [data-akpart="sent"]') as HTMLElement).click();
    expect(shownParts()).toEqual(["sent"]);
    (q('#tyParts [data-akpart="write"]') as HTMLElement).click();
    expect(shownParts()).toEqual(["write"]);
  });

  it("names every field for a screen reader", () => {
    const unnamed = qa("#view-thank-you input, #view-thank-you select, #view-thank-you textarea").filter((f) => {
      if (f.getAttribute("type") === "hidden") return false;
      const id = f.getAttribute("id");
      const labelled = (id && document.querySelector('label[for="' + id + '"]')) || f.closest("label") || f.getAttribute("aria-label");
      return !id || !labelled;
    });
    expect(unnamed.map((f) => f.outerHTML.slice(0, 60))).toEqual([]);
  });

  it("uses no word a volunteer would have to look up", () => {
    const words = text(view());
    ["threshold", "prefill", "Compose", "branded", "Monetary", "uplift", "Opted out"].forEach((w) => expect(words, w).not.toContain(w));
    // "CC" the email word, not the letters inside "NBCC".
    expect(words.split(/[^A-Za-z]+/)).not.toContain("CC");
  });
});

describe("Who to thank", () => {
  beforeEach(() => {
    eligible = [
      donor(7, "Rowan Example", { maxGiftPence: 250000, giftAided: true }),
      donor(8, "Sam Example", { maxGiftPence: 150000, alreadyThanked: true, lastThankedAt: "2026-11-03T10:00:00.000Z", givenSinceThankedPence: 27500, giftsSinceThanked: 2 }),
      donor(9, "Morag Example", { maxGiftPence: 120000, email: null, sendState: "no_email" }),
      donor(10, "Kit Example", { maxGiftPence: 110000, sendState: "opted_out", anonymous: true }),
      donor(11, "Ash Example", { maxGiftPence: 100000 }),
    ];
  });
  const tile = (key: string) => q(`#tyTiles [data-ty-filter="${key}"]`) as HTMLElement;
  const rows = () => qa("#tyEligibleTable [data-ty-row]").map((r) => r.getAttribute("data-ty-row"));

  it("counts who is ready, who has been thanked and who cannot be emailed, on tiles", async () => {
    await openScreen();
    expect(text(tile("ready"))).toContain("2");
    expect(text(tile("ready"))).toContain("Ready to thank");
    expect(text(tile("thanked"))).toContain("1");
    expect(text(tile("thanked"))).toContain("Thanked");
    expect(text(tile("blocked"))).toContain("2");
    expect(text(tile("blocked"))).toContain("Cannot be emailed");
    expect(text(el("tyEligibleCount"))).toBe("5 listed · 2 ready");
  });

  it("opens on the people ready to thank, and says so", async () => {
    await openScreen();
    expect(tile("ready").getAttribute("aria-pressed")).toBe("true");
    expect(rows()).toEqual(["7", "11"]);
    expect(text(el("tyShowing"))).toContain("ready to thank");
    expect(q("#tyParts #tyWhoDot")!.hidden).toBe(false);
  });

  it("opens on everyone when nobody is waiting", async () => {
    eligible = eligible.filter((r) => r.donorId === 8 || r.donorId === 9);
    await openScreen();
    expect(rows()).toEqual(["8", "9"]);
    expect(tile("ready").getAttribute("aria-pressed")).toBe("false");
    expect(q("#tyParts #tyWhoDot")!.hidden).toBe(true);
  });

  it("filters by a tile, and shows everyone when it is pressed again or on Show everyone", async () => {
    await openScreen();
    tile("blocked").click();
    expect(rows()).toEqual(["9", "10"]);
    expect(tile("blocked").getAttribute("aria-pressed")).toBe("true");
    expect(tile("ready").getAttribute("aria-pressed")).toBe("false");
    tile("blocked").click();
    expect(rows()).toEqual(["7", "8", "9", "10", "11"]);
    tile("thanked").click();
    expect(rows()).toEqual(["8"]);
    el("tyShowAll").click();
    expect(rows()).toEqual(["7", "8", "9", "10", "11"]);
    expect(el("tyShowAll").hidden).toBe(true);
  });

  it("keeps the tile chosen when the list is read again", async () => {
    await openScreen();
    tile("thanked").click();
    el("tyRefresh").click();
    await settle();
    expect(rows()).toEqual(["8"]);
  });

  it("draws each donor as a card with the amount large", async () => {
    await openScreen();
    const card = q('#tyEligibleTable [data-ty-row="7"]')!;
    expect(card.classList.contains("ak-card")).toBe(true);
    expect(text(card.querySelector(".tyr-donor__amount"))).toContain("£2500");
    expect(text(card)).toContain("Rowan Example");
    expect(text(card)).toContain("rowan.example@example.com");
    expect(text(card)).toContain("Gift Aided");
    expect(text(card.querySelector("[data-ty-donor]"))).toBe("Write");
    expect(q("#tyEligibleTable table")).toBeNull();
  });

  it("says when they were thanked, what they have given since, and offers Thank again", async () => {
    await openScreen();
    el("tyShowAll").click();
    const card = q('#tyEligibleTable [data-ty-row="8"]')!;
    expect(text(card)).toContain("Thanked 3 November 2026");
    expect(text(card)).toContain("Has given £275 in 2 gifts since then");
    expect(text(card.querySelector("[data-ty-donor]"))).toBe("Thank again");
  });

  it("says one gift, and says nothing new when they have not given since", async () => {
    eligible = [
      donor(8, "Sam Example", { alreadyThanked: true, lastThankedAt: "2026-11-03T10:00:00.000Z", givenSinceThankedPence: 5000, giftsSinceThanked: 1 }),
      donor(12, "Blair Example", { alreadyThanked: true, lastThankedAt: "2026-10-01T10:00:00.000Z", givenSinceThankedPence: 0, giftsSinceThanked: 0 }),
    ];
    await openScreen();
    expect(text(q('#tyEligibleTable [data-ty-row="8"]'))).toContain("Has given £50 in 1 gift since then");
    expect(text(q('#tyEligibleTable [data-ty-row="12"]'))).toContain("Nothing new since then");
  });

  it("says plainly what can be done for someone with no email address", async () => {
    await openScreen();
    tile("blocked").click();
    const card = q('#tyEligibleTable [data-ty-row="9"]')!;
    expect(text(card)).toContain("No email address");
    expect(text(card)).toContain("add it on their donor page");
    expect(text(card)).toContain("by post or by phone");
    expect(card.querySelector("[data-ty-donor]")).toBeNull();
  });

  it("says plainly what can be done for someone who does not want emails", async () => {
    await openScreen();
    tile("blocked").click();
    const card = q('#tyEligibleTable [data-ty-row="10"]')!;
    expect(text(card)).toContain("Does not want emails");
    expect(text(card)).toContain("Thank them by post, by phone or in person");
    expect(card.querySelector("[data-ty-donor]")).toBeNull();
  });

  it("marks someone who asked to stay anonymous", async () => {
    await openScreen();
    el("tyShowAll").click();
    expect(text(q('#tyEligibleTable [data-ty-row="10"]'))).toContain("Asked to stay anonymous");
    expect(text(q('#tyEligibleTable [data-ty-row="7"]'))).not.toContain("anonymous");
  });

  it("opens the donor's page from their name, for someone who may open Donations", async () => {
    await openScreen();
    const name = q('#tyEligibleTable [data-ty-row="7"] .tyr-donor__name') as HTMLElement;
    expect(name.tagName).toBe("BUTTON");
    expect(name.getAttribute("data-donor")).toBe("7");
    name.click();
    await settle();
    expect(el("view-donor").hidden).toBe(false);
    expect(calls.some((c) => c.url === "/api/admin/donors/7")).toBe(true);
  });

  it("leaves the name as words for someone who may not open Donations", async () => {
    permissions = { ...permissions, donations: "none" };
    await openScreen();
    const name = q('#tyEligibleTable [data-ty-row="7"] .tyr-donor__name') as HTMLElement;
    expect(name.tagName).not.toBe("BUTTON");
    expect(name.hasAttribute("data-donor")).toBe(false);
    expect(text(name)).toBe("Rowan Example");
  });

  it("offers nothing to write with to someone who may only look", async () => {
    role = "viewer";
    permissions = effectivePermissions({ role: "viewer", permissions: null }) as unknown as Record<string, string>;
    await openScreen();
    el("tyShowAll").click();
    expect(qa("#tyEligibleTable [data-ty-row]").length).toBe(5);
    expect(qa("#tyEligibleTable [data-ty-donor]").length).toBe(0);
    expect(el("tySend").hidden).toBe(true);
  });

  it("puts a name from the server on the page as words, never as markup", async () => {
    eligible = [donor(7, '<img src=x onerror="window.hacked=1">Rowan')];
    await openScreen();
    expect(q("#tyEligibleTable img")).toBeNull();
    expect(text(q('#tyEligibleTable [data-ty-row="7"]'))).toContain("<img src=x");
  });

  it("says nobody is waiting when the chosen tile has nobody in it", async () => {
    eligible = [donor(8, "Sam Example", { alreadyThanked: true, lastThankedAt: "2026-11-03T10:00:00.000Z" })];
    await openScreen();
    tile("ready").click();
    expect(text(el("tyEligibleTable"))).toContain("Nobody is waiting to be thanked.");
  });
});

describe("the amount in Single donation over is remembered on this device", () => {
  it("asks for the amount typed, and keeps it", async () => {
    await openScreen();
    type("tyThreshold", "500");
    await settle();
    expect(calls.some((c) => c.url === "/api/admin/thank-you/eligible?threshold=50000")).toBe(true);
    expect(window.localStorage.getItem("nbcc_ty_over")).toBe("500");
  });

  it("opens on the amount kept last time", async () => {
    window.localStorage.setItem("nbcc_ty_over", "250");
    await openScreen();
    expect(input("tyThreshold").value).toBe("250");
    expect(calls.some((c) => c.url === "/api/admin/thank-you/eligible?threshold=25000")).toBe(true);
  });

  it("keeps a number only, and ignores anything else it finds", async () => {
    window.localStorage.setItem("nbcc_ty_over", '<b>lots</b>');
    await openScreen();
    expect(input("tyThreshold").value).toBe("1000");
    type("tyThreshold", "plenty");
    await settle();
    expect(window.localStorage.getItem("nbcc_ty_over")).toBe(null);
  });
});

describe("Write the letter", () => {
  beforeEach(async () => {
    eligible = [
      donor(7, "Rowan Example", { maxGiftPence: 250000, giftAided: true }),
      donor(8, "Sam Example", { maxGiftPence: 150000, alreadyThanked: true, lastThankedAt: "2026-11-03T10:00:00.000Z", givenSinceThankedPence: 0, giftsSinceThanked: 0 }),
      donor(11, "Ash Example", { maxGiftPence: 100000 }),
    ];
    await openScreen();
  });

  it("takes you to the letter on Write, filled in, with a line saying whose it is", async () => {
    await write(7);
    expect(shownParts()).toEqual(["write"]);
    expect(text(el("tyFor"))).toContain("This letter is for Rowan Example");
    expect(input("tyName").value).toBe("Rowan Example");
    expect(input("tyEmail").value).toBe("rowan.example@example.com");
    expect(input("tyAmount").value).toBe("2500");
    expect(input("tyGiftAid").checked).toBe(true);
    expect(text(el("tyPTitle"))).toBe("Thank you, Rowan Example.");
  });

  it("says a new letter is not tied to anyone, and unties one that was", async () => {
    await write(7);
    el("tyForNew").click();
    expect(input("tyDonorId").value).toBe("");
    expect(input("tyName").value).toBe("");
    expect(text(el("tyFor"))).toContain("new letter");
    expect(text(el("tyFor"))).not.toContain("Rowan Example");
  });

  it("starts a new letter from the list, in the Write part", async () => {
    await write(7);
    (q('#tyParts [data-akpart="who"]') as HTMLElement).click();
    el("tyNew").click();
    expect(shownParts()).toEqual(["write"]);
    expect(input("tyDonorId").value).toBe("");
    expect(text(el("tyFor"))).toContain("new letter");
  });

  it("says under Send what it does, with the address it will go to", async () => {
    await write(7);
    expect(text(el("tySays"))).toBe("Emails this letter to rowan.example@example.com now and keeps a record.");
    type("tyEmail", "rowan@example.org");
    expect(text(el("tySays"))).toBe("Emails this letter to rowan@example.org now and keeps a record.");
    type("tyEmail", "");
    expect(text(el("tySays"))).toContain("Add their email address");
  });

  it("asks first, in the page, and sends nothing until the answer is yes", async () => {
    await write(7);
    el("tySend").click();
    await settle();
    expect(posts().length).toBe(0);
    expect(el("tyAsk").hidden).toBe(false);
    expect(text(el("tyAskText"))).toContain("Email this letter to Rowan Example at rowan.example@example.com now?");
    el("tyAskNo").click();
    await settle();
    expect(el("tyAsk").hidden).toBe(true);
    expect(posts().length).toBe(0);
    el("tySend").click();
    el("tyAskYes").click();
    await settle();
    expect(posts().length).toBe(1);
    expect(posts()[0].body).toMatchObject({ donorId: 7, thankYouName: "Rowan Example", recipientEmail: "rowan.example@example.com", giftType: "money", giftAmountPence: 250000, giftAided: true });
  });

  it("does not ask, and says what is missing, when the letter has no name or no address", async () => {
    el("tyNew").click();
    el("tySend").click();
    await settle();
    expect(el("tyAsk").hidden).toBe(true);
    expect(el("tyStatus").classList.contains("is-error")).toBe(true);
    expect(text(el("tyStatus"))).toContain("name");
    type("tyName", "Example Bakery");
    type("tyDear", "Morag");
    type("tyAmount", "50");
    type("tyEmail", "not an address");
    el("tySend").click();
    await settle();
    expect(el("tyAsk").hidden).toBe(true);
    expect(text(el("tyStatus"))).toContain("email address");
    expect(posts().length).toBe(0);
  });

  it("warns clearly when this donor has already been thanked", async () => {
    el("tyShowAll").click();
    await write(8);
    expect(el("tyAgain").hidden).toBe(false);
    expect(text(el("tyAgain"))).toContain("Sam Example was already sent a thank you on 3 November 2026");
    el("tySend").click();
    await settle();
    expect(text(el("tyAskText"))).toContain("again");
  });

  it("shows no warning for someone not yet thanked, or for a new letter", async () => {
    await write(7);
    expect(el("tyAgain").hidden).toBe(true);
    el("tyNew").click();
    expect(el("tyAgain").hidden).toBe(true);
  });

  it("says who is next once the letter has gone, and starts theirs on a press", async () => {
    await write(7);
    // The server now has Rowan as thanked.
    sendAnswer = () => {
      eligible = eligible.map((r) => (r.donorId === 7 ? { ...r, alreadyThanked: true, lastThankedAt: "2026-11-14T10:00:00.000Z" } : r));
      return { status: 201, body: { id: 77, giftSummary: "£2500.00 (Gift Aided)", emailed: true } };
    };
    await pressSend();
    expect(text(el("tyNext"))).toContain("Next to thank: Ash Example");
    (el("tyNext").querySelector("[data-ty-donor]") as HTMLElement).click();
    await settle();
    expect(input("tyName").value).toBe("Ash Example");
    expect(text(el("tyFor"))).toContain("This letter is for Ash Example");
    expect(text(el("tyStatus"))).toBe("");
    expect(text(el("tyNext"))).toBe("");
  });

  it("says nobody else is waiting when that was the last", async () => {
    eligible = [donor(7, "Rowan Example")];
    el("tyRefresh").click();
    await settle();
    await write(7);
    sendAnswer = () => {
      eligible = [donor(7, "Rowan Example", { alreadyThanked: true, lastThankedAt: "2026-11-14T10:00:00.000Z" })];
      return { status: 201, body: { id: 77, giftSummary: "£1500.00", emailed: true } };
    };
    await pressSend();
    expect(text(el("tyNext"))).toContain("Nobody else is waiting to be thanked");
  });

  it("sends a gift in kind with what was given and no amount", async () => {
    el("tyNew").click();
    el("tyGtKind").click();
    expect(el("tyWrapAmount").hidden).toBe(true);
    expect(el("tyWrapInKind").hidden).toBe(false);
    type("tyName", "Example Bakery");
    type("tyDear", "Morag");
    type("tyInKind", "200 mince pies");
    type("tyEmail", "morag@example.com");
    type("tyCc", "");
    expect(text(el("tyPCallout"))).toContain("200 mince pies");
    await pressSend();
    expect(posts()[0].body).toMatchObject({ donorId: null, giftType: "in_kind", giftAmountPence: null, giftInKind: "200 mince pies", giftAided: false, ccEmail: null });
  });

  it("keeps the letter on the screen in step with the form", async () => {
    await write(7);
    type("tyDear", "Rowan and family");
    type("tyPersonal", "It meant a great deal.");
    type("tyDate", "1 December 2026");
    expect(text(el("tyPSalutation"))).toBe("Dear Rowan and family,");
    expect(text(el("tyPPersonal"))).toBe("It meant a great deal.");
    expect(text(el("tyPDate"))).toBe("1 December 2026");
    expect(text(el("tyPCallout"))).toContain("HMRC adds 25%");
  });
});

describe("Letters sent", () => {
  beforeEach(async () => {
    sent = [
      letter(31, "Rowan Example", { giftAmountPence: 250000, giftAided: true, ccEmail: "colleague@example.com", personalMessage: "It meant a great deal.", sentAt: "2026-11-12T09:00:00.000Z" }),
      letter(30, "Example Bakery", { addressedTo: "Morag", giftType: "in_kind", giftAmountPence: null, giftInKind: "200 mince pies", sentBy: "automatic", signedByRole: null }),
      letter(29, "Sam Example", { recipientEmail: "sam@example.org" }),
    ];
    await openScreen();
    (q('#tyParts [data-akpart="sent"]') as HTMLElement).click();
    await settle();
  });
  const card = (id: number) => q(`#tySentTable [data-ty-sent="${id}"]`) as HTMLElement;
  const open = (id: number) => (card(id).querySelector(".ak-item__face") as HTMLElement).click();

  it("draws each letter as a card: who, the gift and the date", () => {
    expect(q("#tySentTable table")).toBeNull();
    const face = card(31).querySelector(".ak-item__face") as HTMLElement;
    expect(face.getAttribute("aria-expanded")).toBe("false");
    expect(text(face)).toContain("Rowan Example");
    expect(text(face)).toContain("£2500");
    expect(text(face)).toContain("Gift Aided");
    expect(text(face)).toContain("12 November 2026");
    expect(text(card(30).querySelector(".ak-item__face"))).toContain("Gift in kind: 200 mince pies");
  });

  it("opens in place with everything about the letter, the personal message too", () => {
    open(31);
    const more = card(31).querySelector(".ak-item__more") as HTMLElement;
    expect(more.hidden).toBe(false);
    expect(card(31).querySelector(".ak-item__face")!.getAttribute("aria-expanded")).toBe("true");
    const words = text(more);
    ["Addressed to", "Rowan", "Email", "rowan.example@example.com", "Copied to", "colleague@example.com", "Signed by", "Fern Example", "Trustee",
      "Sent by", "fern@example.com", "Personal message", "It meant a great deal."].forEach((w) => expect(words, w).toContain(w));
    const link = more.querySelector("a[href]") as HTMLAnchorElement;
    expect(text(link)).toBe("View letter");
    expect(link.getAttribute("href")).toBe("https://portal.example.com/thank-you/letter/token-31");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("closes again, and only one is open at a time", () => {
    open(31);
    open(29);
    expect((card(31).querySelector(".ak-item__more") as HTMLElement).hidden).toBe(true);
    expect((card(29).querySelector(".ak-item__more") as HTMLElement).hidden).toBe(false);
    open(29);
    expect((card(29).querySelector(".ak-item__more") as HTMLElement).hidden).toBe(true);
  });

  it("says nobody was copied and no message was added, and that a letter went automatically", () => {
    open(30);
    const words = text(card(30).querySelector(".ak-item__more"));
    expect(words).toContain("Copied to Nobody");
    expect(words).toContain("Personal message None");
    expect(words).toContain("Automatically, by the website");
  });

  it("copies the link to the letter and says so in the card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
    open(31);
    (card(31).querySelector("[data-ty-copy]") as HTMLElement).click();
    await settle();
    expect(writeText).toHaveBeenCalledWith("https://portal.example.com/thank-you/letter/token-31");
    expect(text(card(31).querySelector("[data-ty-said]"))).toContain("Link copied");
  });

  it("says so when the link could not be copied", async () => {
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    open(31);
    (card(31).querySelector("[data-ty-copy]") as HTMLElement).click();
    await settle();
    const said = card(31).querySelector("[data-ty-said]") as HTMLElement;
    expect(text(said)).toContain("Could not copy the link");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("finds a letter by name, email or what was given", () => {
    type("tySentSearch", "bakery");
    expect(qa("#tySentTable [data-ty-sent]").map((c) => c.getAttribute("data-ty-sent"))).toEqual(["30"]);
    type("tySentSearch", "sam@example.org");
    expect(qa("#tySentTable [data-ty-sent]").map((c) => c.getAttribute("data-ty-sent"))).toEqual(["29"]);
    type("tySentSearch", "mince");
    expect(qa("#tySentTable [data-ty-sent]").map((c) => c.getAttribute("data-ty-sent"))).toEqual(["30"]);
    type("tySentSearch", "nobody at all");
    expect(text(el("tySentTable"))).toContain("No letter matches that.");
    type("tySentSearch", "");
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(3);
  });

  it("asks before deleting, in the card, and deletes nothing on Keep it", async () => {
    open(31);
    (card(31).querySelector("[data-ty-delete]") as HTMLElement).click();
    const ask = card(31).querySelector("[data-ty-delete-ask]") as HTMLElement;
    expect(ask.hidden).toBe(false);
    expect(text(ask)).toContain('Delete the thank-you letter to "Rowan Example" from the history? This cannot be undone.');
    (card(31).querySelector("[data-ty-delete-no]") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect((card(31).querySelector("[data-ty-delete-ask]") as HTMLElement).hidden).toBe(true);
  });

  it("deletes on yes, takes the card away and says which letter went", async () => {
    open(31);
    (card(31).querySelector("[data-ty-delete]") as HTMLElement).click();
    (card(31).querySelector("[data-ty-delete-yes]") as HTMLElement).click();
    await settle();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/admin/thank-you/sent/31")).toBe(true);
    expect(card(31)).toBeNull();
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(2);
    // Said in the place the card was, where the person was looking.
    expect(text(q("#tySentTable [data-ty-gone]"))).toContain("The letter to Rowan Example was deleted.");
  });

  it("says so in the card when a delete fails, and leaves the list as it was", async () => {
    deleteStatus = 500;
    open(31);
    (card(31).querySelector("[data-ty-delete]") as HTMLElement).click();
    (card(31).querySelector("[data-ty-delete-yes]") as HTMLElement).click();
    await settle();
    expect(qa("#tySentTable [data-ty-sent]").length).toBe(3);
    const said = card(31).querySelector("[data-ty-said]") as HTMLElement;
    expect(text(said)).toContain("Could not delete that letter. Please try again.");
    expect(said.classList.contains("is-error")).toBe(true);
  });

  it("offers no Delete to someone who may only look", async () => {
    role = "viewer";
    permissions = effectivePermissions({ role: "viewer", permissions: null }) as unknown as Record<string, string>;
    window.sessionStorage.clear();
    boot();
    await openScreen();
    (q('#tyParts [data-akpart="sent"]') as HTMLElement).click();
    open(31);
    expect(card(31).querySelector("[data-ty-delete]")).toBeNull();
    expect(card(31).querySelector("a[href]")).not.toBeNull();
  });

  it("puts a name from the server on the page as words, never as markup", async () => {
    sent = [letter(40, '<img src=x onerror="window.hacked=1">Rowan', { personalMessage: "<b>bold</b>" })];
    (q('.admin-nav-link[data-view="ticker"]') as HTMLElement).click();
    (q('.admin-nav-link[data-view="thank-you"]') as HTMLElement).click();
    await settle();
    open(40);
    expect(q("#tySentTable img")).toBeNull();
    expect(q("#tySentTable .ak-item__more b")).toBeNull();
    expect(text(card(40))).toContain("<b>bold</b>");
  });
});

// ---------------------------------------------------------------------------------------------
// The letter on the screen, and the stylesheet
// ---------------------------------------------------------------------------------------------

describe("the letter on the screen says what the printed letter says", () => {
  // The screen's letter is a copy of the page a donor prints (src/thank-you/letter-page.ts). Nothing
  // kept the two in step, so one could be reworded and the other would go on showing the old words.
  const page = read("src/thank-you/letter-page.ts");
  const fixed = () => qa("#tyPaper .ty-letter-body > p").filter((p) => !p.id).map((p) => text(p));

  it("has the print page's three fixed paragraphs, word for word", () => {
    expect(fixed().length).toBe(3);
    fixed().forEach((words) => expect(page, words).toContain(words));
  });

  it("signs off as the print page does", () => {
    expect(page).toContain("<p>With warmest thanks,</p>");
    expect(text(q("#tyPaper .ty-signoff p"))).toBe("With warmest thanks,");
  });
});

describe("the screen's own stylesheet keeps the house rules", () => {
  const css = read("assets/css/admin-thanks.css");
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = () => {
    const out: string[] = [];
    const flat = noComments.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const m of flat.matchAll(/([^{}]+)\{/g)) {
      const head = m[1].trim();
      if (!head || head.startsWith("@")) continue;
      let depth = 0;
      let one = "";
      for (const ch of head) {
        if (ch === "(") depth++;
        if (ch === ")") depth--;
        if (ch === "," && depth === 0) { out.push(one.trim()); one = ""; } else one += ch;
      }
      out.push(one.trim());
    }
    return out;
  };

  it("names every rule through this screen, so the borrowed ty- classes are untouched elsewhere", () => {
    expect(selectors().length).toBeGreaterThan(20);
    expect(selectors().filter((s) => !s.startsWith("#view-thank-you"))).toEqual([]);
  });

  it("never uses !important, and never makes a box that scrolls", () => {
    expect(noComments).not.toContain("!important");
    expect(/overflow(-x|-y)?\s*:\s*(auto|scroll)/.test(noComments)).toBe(false);
  });

  it("moves only transform and opacity, and only for someone happy with motion", () => {
    const outside = noComments.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "");
    expect(/transition\s*:/.test(outside)).toBe(false);
    expect(/animation\s*:/.test(outside)).toBe(false);
  });

  it("has no side stripe and no gradient words", () => {
    expect(/border-left\s*:\s*\d+px solid/.test(noComments)).toBe(false);
    expect(noComments).not.toContain("background-clip: text");
  });

  it("is loaded straight after the outreach sheet, over the kit", () => {
    const at = (needle: string) => {
      const i = html.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("/assets/css/admin-thanks.css")).toBeGreaterThan(at("/assets/css/admin-outreach.css"));
    expect(at("/assets/css/admin-thanks.css")).toBeGreaterThan(at("/assets/css/admin-kit.css"));
  });

  it("gives the donor's name a finger's height where it is a button", () => {
    const at = noComments.indexOf("#view-thank-you button.tyr-donor__name {");
    expect(at).toBeGreaterThan(-1);
    expect(noComments.slice(at, noComments.indexOf("}", at))).toContain("min-height: 44px");
  });
});

// ---------------------------------------------------------------------------------------------
// Workshop drop-offs: Write a thank you letter (assets/js/admin/drop-offs.js) opens this screen
// ---------------------------------------------------------------------------------------------

describe("a letter for somebody who dropped something off at the workshop", () => {
  it("opens Thank you with a new gift in kind letter, filled in with them and what they brought", async () => {
    await openScreen();
    (q('.admin-nav-link[data-view="drop-offs"]') as HTMLElement).click();
    await settle();
    const bridge = (window as unknown as { AdminThankYou: { writeInKind: (p: unknown) => void } }).AdminThankYou;
    bridge.writeInKind({ name: "Robin Example", email: "robin@example.com", brought: "Two bags of selection boxes" });
    await settle();
    expect(view().hidden).toBe(false);
    expect(input("tyName").value).toBe("Robin Example");
    expect(input("tyDear").value).toBe("Robin");
    expect(input("tyEmail").value).toBe("robin@example.com");
    expect(input("tyInKind").value).toBe("Two bags of selection boxes");
    expect(el("tyGtKind").getAttribute("aria-pressed")).toBe("true");
    expect(input("tyDonorId").value).toBe("");
    expect(shownParts()).toContain("write");
    expect(text(el("tySays"))).toContain("Emails this letter to robin@example.com");
  });

  it("does nothing for someone who cannot send letters", async () => {
    permissions = { ...permissions, "thank-you": "view" };
    await openScreen();
    const bridge = (window as unknown as { AdminThankYou: { writeInKind: (p: unknown) => void } }).AdminThankYou;
    bridge.writeInKind({ name: "Robin Example", email: "robin@example.com", brought: "Hats" });
    await settle();
    expect(input("tyName").value).toBe("");
  });
});
