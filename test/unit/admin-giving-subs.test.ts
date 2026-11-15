// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { givingScreen, settle, el, q, qa, text, press, Giving, type Call, type Reply } from "./helpers/giving-screen";

// Admin > Giving > Subscriptions, in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-giving.md):
// a card per person with plain words for what has happened and the means to get in touch, tiles that
// show or hide each group, and one name ("monthly gift") for the thing. Every person, address and
// number here is invented.

const DUNNING = "/api/admin/subscriptions/dunning";

const gift = (id: number, over: Record<string, unknown> = {}) => ({
  id, donor_id: 600 + id, donor_name: "Rowan Example " + id, donor_email: `rowan${id}@example.com`,
  stripe_subscription_id: "sub_invented_" + id, status: "past_due", failed_attempts: 2, lapsed_at: null, cancelled_at: null,
  updated_at: "2026-11-03T10:00:00.000Z", monthly_pence: 1000, first_paid_at: "2024-03-04T09:00:00.000Z", phone: null, ...over,
});
const failing = (id: number, over = {}) => gift(id, over);
const stopped = (id: number, over = {}) => gift(id, { status: "lapsed", failed_attempts: 4, lapsed_at: "2026-10-20T08:00:00.000Z", ...over });
const cancelled = (id: number, over = {}) => gift(id, { status: "active", failed_attempts: 0, cancelled_at: "2026-09-12T08:00:00.000Z", ...over });
const normal = (id: number, over = {}) => gift(id, { status: "active", failed_attempts: 0, ...over });

let answer: Reply | undefined;
let copied: string[] = [];
let copyWorks = true;
let alerts: string[] = [];
const reply = (call: Call) => (call.path === DUNNING ? answer : undefined);
const list = (rows: unknown[]): Reply => ({ body: { results: rows } });

beforeEach(() => {
  answer = undefined;
  copied = [];
  copyWorks = true;
  alerts = [];
  window.alert = (m?: string) => { alerts.push(String(m)); };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => (copyWorks ? (copied.push(t), Promise.resolve()) : Promise.reject(new Error("no"))) },
  });
});

async function open(perms?: Parameters<typeof givingScreen>[1]) {
  const screen = givingScreen(reply, perms ?? { subscriptions: "view", donations: "view" });
  screen.giving.openSubs();
  await settle();
  return screen;
}
const tile = (key: string) => q(`#subsFilters [data-subs-filter="${key}"]`) as HTMLElement;
const card = (id: number) => q(`#subsTable [data-sub="${id}"]`) as HTMLElement;
const cards = () => qa("#subsTable [data-sub]").map((c) => Number(c.getAttribute("data-sub")));
const groups = () => qa("#subsTable .ak-group").map((g) => text(g));

describe("what has happened to a monthly gift, in plain words", () => {
  it("says how many times the card has failed and that Stripe is still trying", () => {
    expect(Giving.subscriptionWords(failing(1, { failed_attempts: 1 }))).toBe("Card failed once. Stripe is still trying.");
    expect(Giving.subscriptionWords(failing(1, { failed_attempts: 2 }))).toBe("Card failed twice. Stripe is still trying.");
    expect(Giving.subscriptionWords(failing(1, { failed_attempts: 3 }))).toBe("Card failed 3 times. Stripe is still trying.");
    expect(Giving.subscriptionWords(failing(1, { failed_attempts: 0 }))).toBe("Card failed. Stripe is still trying.");
  });

  it("says when a gift stopped and after how many tries", () => {
    expect(Giving.subscriptionWords(stopped(1))).toBe("Stopped on 20 October 2026 after 4 tries.");
    expect(Giving.subscriptionWords(stopped(1, { failed_attempts: 1 }))).toBe("Stopped on 20 October 2026 after 1 try.");
    expect(Giving.subscriptionWords(stopped(1, { failed_attempts: 0 }))).toBe("Stopped on 20 October 2026.");
    expect(Giving.subscriptionWords(stopped(1, { lapsed_at: null }))).toBe("Stopped after 4 tries.");
  });

  it("says when someone cancelled, whatever the payment state says", () => {
    expect(Giving.subscriptionWords(cancelled(1))).toBe("They cancelled on 12 September 2026.");
    expect(Giving.subscriptionWords(cancelled(1, { status: "past_due" }))).toBe("They cancelled on 12 September 2026.");
  });

  it("says a healthy gift is paying as normal", () => {
    expect(Giving.subscriptionWords(normal(1))).toBe("Paying as normal.");
  });

  it("sorts each gift into one of four groups", () => {
    expect([failing(1), stopped(2), cancelled(3), normal(4)].map(Giving.subscriptionGroup)).toEqual(["failing", "stopped", "cancelled", "normal"]);
    expect(Giving.subscriptionGroup(cancelled(3, { status: "lapsed" }))).toBe("cancelled");
    expect(Giving.subscriptionGroup(undefined)).toBe("normal");
  });
});

describe("Subscriptions: the screen", () => {
  it("takes the kit's look and keeps its title and its opening sentence", async () => {
    await open();
    expect(el("view-subscriptions").classList.contains("ak")).toBe(true);
    expect(text(q("#view-subscriptions > h2"))).toBe("Monthly gifts that need attention");
    expect(text(q("#view-subscriptions > .admin-view-intro"))).toContain("a short note or a call usually puts it right");
  });

  it("calls the thing a monthly gift throughout, never a subscription", async () => {
    await open();
    expect(text(el("view-subscriptions")).toLowerCase()).not.toContain("subscription");
    answer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await open();
    expect(text(el("view-subscriptions")).toLowerCase()).not.toContain("subscription");
  });

  it("has a way across to everyone giving monthly, for someone who may open that screen", async () => {
    await open();
    const across = q('#view-subscriptions [data-goto-section="monthly"]') as HTMLElement;
    expect(text(across)).toBe("See everyone giving monthly");
    expect(el("subsAcross").hidden).toBe(false);
  });

  it("puts that away for someone who may not open Monthly givers", async () => {
    await open({ subscriptions: "view", donations: "none" });
    expect(el("subsAcross").hidden).toBe(true);
  });

  it("says Loading each time it is opened, until the answer arrives", async () => {
    answer = list([failing(1)]);
    const screen = await open();
    expect(cards()).toEqual([1]);
    screen.giving.openSubs();
    expect(text(el("subsTable"))).toBe("Loading…");
    await settle();
    expect(cards()).toEqual([1]);
  });

  it("says there are none, and says so differently when they could not be loaded", async () => {
    await open();
    expect(text(el("subsTable"))).toBe("No monthly gifts need attention.");
    answer = { status: 500, body: { error: "Admin is temporarily unavailable" } };
    await open();
    expect(text(el("subsTable"))).toBe("Monthly gifts that need attention are unavailable.");
    expect(text(tile("failing").querySelector(".ak-tile__n"))).toBe("?");
  });
});

describe("Subscriptions: the tiles", () => {
  beforeEach(() => {
    answer = list([failing(1), failing(2), stopped(3), cancelled(4), normal(5), normal(6), normal(7)]);
  });

  it("has four, each with its count", async () => {
    await open();
    expect(qa("#subsFilters [data-subs-filter]").map((t) => [text(t.querySelector(".ak-tile__name")), text(t.querySelector(".ak-tile__n"))])).toEqual([
      ["Card failing", "2"], ["Stopped", "1"], ["Cancelled", "1"], ["Back to normal", "3"],
    ]);
  });

  it("opens showing the two that need someone: card failing and stopped", async () => {
    await open();
    expect(tile("failing").getAttribute("aria-pressed")).toBe("true");
    expect(tile("stopped").getAttribute("aria-pressed")).toBe("true");
    expect(tile("cancelled").getAttribute("aria-pressed")).toBe("false");
    expect(tile("normal").getAttribute("aria-pressed")).toBe("false");
    expect(cards()).toEqual([1, 2, 3]);
    expect(groups()).toEqual(["Card failing", "Stopped"]);
  });

  it("shows a group when its tile is pressed and puts it away when pressed again", async () => {
    await open();
    await press(tile("cancelled"));
    expect(cards()).toEqual([1, 2, 3, 4]);
    expect(tile("cancelled").classList.contains("is-active")).toBe(true);
    await press(tile("failing"));
    expect(cards()).toEqual([3, 4]);
    expect(tile("failing").getAttribute("aria-pressed")).toBe("false");
    await press(tile("normal"));
    expect(groups()).toEqual(["Stopped", "Cancelled", "Back to normal"]);
  });

  it("says to choose a tile when none is pressed", async () => {
    await open();
    await press(tile("failing"));
    await press(tile("stopped"));
    expect(text(el("subsTable"))).toBe("Choose a tile above to see its monthly gifts.");
  });

  it("says nothing needs attention when the two it opens on are empty, though others have gifts", async () => {
    answer = list([cancelled(4), normal(5)]);
    await open();
    expect(text(el("subsTable"))).toBe("No monthly gifts need attention.");
    expect(text(tile("cancelled").querySelector(".ak-tile__n"))).toBe("1");
    expect(tile("failing").classList.contains("is-none")).toBe(true);
  });
});

describe("Subscriptions: a card for each person", () => {
  it("says who, the state as a pill as before, and what has happened in plain words", async () => {
    answer = list([failing(1), stopped(3), cancelled(4), normal(5)]);
    await open();
    await press(tile("cancelled"));
    await press(tile("normal"));
    expect(text(card(1))).toContain("Rowan Example 1");
    expect(text(card(1).querySelector(".admin-pill"))).toBe("At risk");
    expect(card(1).querySelector(".admin-pill")!.classList.contains("admin-pill--past_due")).toBe(true);
    expect(text(card(1))).toContain("Card failed twice. Stripe is still trying.");
    expect(text(card(3).querySelector(".admin-pill"))).toBe("Lapsed");
    expect(text(card(3))).toContain("Stopped on 20 October 2026 after 4 tries.");
    expect(text(card(4).querySelector(".admin-pill"))).toBe("Cancelled");
    expect(text(card(4))).toContain("They cancelled on 12 September 2026.");
    expect(text(card(5).querySelector(".admin-pill"))).toBe("Active");
    expect(text(el("subsTable"))).not.toContain("past_due");
  });

  it("says what they give and since when, when it last changed, and its number", async () => {
    answer = list([failing(12)]);
    await open();
    const words = text(card(12));
    expect(words).toContain("£10 a month since March 2024.");
    expect(words).toContain("Last changed 3 November 2026.");
    expect(words).toContain("Monthly gift number 12.");
  });

  it("leaves out what they give when no payment is on record", async () => {
    answer = list([failing(12, { monthly_pence: null, first_paid_at: null })]);
    await open();
    expect(text(card(12))).not.toContain("a month");
    expect(text(card(12))).toContain("Last changed 3 November 2026.");
  });

  it("shows their email with Copy email and Email them", async () => {
    answer = list([failing(1)]);
    await open();
    expect(text(card(1))).toContain("rowan1@example.com");
    const mail = card(1).querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    expect(text(mail)).toBe("Email them");
    expect(mail.getAttribute("href")).toBe("mailto:rowan1@example.com");
    await press(card(1).querySelector('[data-sub-copy="1"]'));
    expect(copied).toEqual(["rowan1@example.com"]);
    const says = card(1).querySelector('[data-sub-status="1"]') as HTMLElement;
    expect(text(says)).toBe("Copied rowan1@example.com.");
    expect(says.classList.contains("is-ok")).toBe(true);
    expect(alerts).toEqual([]);
  });

  it("says the address when the browser will not copy it", async () => {
    answer = list([failing(1)]);
    copyWorks = false;
    await open();
    await press(card(1).querySelector('[data-sub-copy="1"]'));
    const says = card(1).querySelector('[data-sub-status="1"]') as HTMLElement;
    expect(text(says)).toBe("Could not copy it. Their email is rowan1@example.com.");
    expect(says.classList.contains("is-error")).toBe(true);
  });

  it("says there is no email on record, and offers neither button, when there is none", async () => {
    answer = list([failing(1, { donor_email: null })]);
    await open();
    expect(text(card(1))).toContain("No email address on record.");
    expect(card(1).querySelector('a[href^="mailto:"]')).toBeNull();
    expect(card(1).querySelector("[data-sub-copy]")).toBeNull();
  });

  it("gives a number to ring where one is held, and nothing where it is not", async () => {
    answer = list([failing(1, { phone: "01632 960123" }), failing(2)]);
    await open();
    const call = card(1).querySelector('a[href^="tel:"]') as HTMLAnchorElement;
    expect(text(call)).toBe("Call 01632 960123");
    expect(call.getAttribute("href")).toBe("tel:01632960123");
    expect(card(2).querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("opens their page for someone who may open Donations, and not for someone who may not", async () => {
    answer = list([failing(1)]);
    await open();
    expect(text(card(1).querySelector('[data-donor="601"]'))).toBe("Open their page");
    await open({ subscriptions: "view", donations: "none" });
    expect(card(1).querySelector("[data-donor]")).toBeNull();
  });

  it("puts a name or an address from the server on the page as words, never as markup", async () => {
    answer = list([failing(1, { donor_name: '<img src=x onerror="window.hacked=1">', donor_email: '"><script>window.hacked=1</script>@example.com' })]);
    await open();
    expect(q("#subsTable img")).toBeNull();
    expect(q("#subsTable script")).toBeNull();
    expect(text(card(1))).toContain("<img src=x");
  });

  it("lists a group's people with the latest change first, as the server sends them", async () => {
    answer = list([failing(9), failing(2), failing(5)]);
    await open();
    expect(cards()).toEqual([9, 2, 5]);
  });
});
