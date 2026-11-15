// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { givingScreen, settle, el, q, qa, text, press, Giving, type Call, type Reply } from "./helpers/giving-screen";

// Admin > Giving > GASDS, in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-giving.md):
// every small donation not yet claimed, a card per tax year with its total and deadline, tiles that
// filter, marks that ask first and can be undone, and the three figures with a plain line each.
// Every name and amount here is invented.

const QUEUE = "/api/admin/queues/gasds-deadline";
const POOL = "/api/admin/queues/gasds-pool";
const LATELY = "/api/admin/queues/gasds-claimed";
const MARK = QUEUE + "/mark-claimed";
const UNMARK = QUEUE + "/unmark-claimed";

// Tax year 6 April 2023 to 5 April 2024: its two years ran out on 5 April 2026.
const late = (id: number, pence = 500) => ({
  id, donor_id: 500, full_name: "Card reader", amountPence: pence, collectedAt: "2023-12-10T19:00:00.000Z",
  gasdsDeadline: "2026-04-05T00:00:00.000Z", flag: "expired",
});
// Tax year 6 April 2024 to 5 April 2025: claim by 5 April 2027.
const soon = (id: number, pence = 800) => ({
  id, donor_id: 500, full_name: "Card reader", amountPence: pence, collectedAt: "2024-06-01T12:00:00.000Z",
  gasdsDeadline: "2027-04-05T00:00:00.000Z", flag: "expiring",
});
// Tax year 6 April 2026 to 5 April 2027: claim by 5 April 2029.
const later = (id: number, pence = 1250) => ({
  id, donor_id: 501, full_name: "Bucket night, Example Road", amountPence: pence, collectedAt: "2026-08-01T12:00:00.000Z",
  gasdsDeadline: "2029-04-05T00:00:00.000Z", flag: "later",
});
const mark = (auditId: number, over: Record<string, unknown> = {}) => ({
  auditId, actor: "admin:fern@example.com", at: "2026-11-03T10:15:00.000Z", donationIds: [41, 42, 43], count: 3,
  totalPence: 2400, stillClaimedIds: [41, 42, 43], ...over,
});

let answers: Record<string, Reply | ((c: Call) => Reply)> = {};
const list = (rows: unknown[]): Reply => ({ body: { results: rows } });
const DOWN: Reply = { status: 500, body: { error: "Admin is temporarily unavailable" } };
const reply = (call: Call) => {
  const a = answers[call.method + " " + call.path];
  return typeof a === "function" ? a(call) : a;
};

let confirmSays: string[] = [];
let confirmAnswer = true;
let alerts: string[] = [];
let copied: string[] = [];
let copyWorks = true;
let downloads: string[] = [];

beforeEach(() => {
  answers = { ["GET " + POOL]: { body: { year: 2026, gasdsPoolTotalPence: 123400, giftAidClaimedPence: 56000, remainingHeadroomPence: 76600 } } };
  confirmSays = [];
  confirmAnswer = true;
  alerts = [];
  copied = [];
  copyWorks = true;
  downloads = [];
  window.confirm = (m?: string) => { confirmSays.push(String(m)); return confirmAnswer; };
  window.alert = (m?: string) => { alerts.push(String(m)); };
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => (copyWorks ? (copied.push(t), Promise.resolve()) : Promise.reject(new Error("no"))) },
  });
  (window.URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:made");
  (window.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { downloads.push(this.download); };
});

async function open(perms?: Parameters<typeof givingScreen>[1]) {
  const screen = givingScreen(reply, perms ?? { gasds: "edit", donations: "view" });
  screen.giving.openGasds();
  await settle();
  return screen;
}
const years = () => qa("#gasdsTable [data-gasds-year]");
const year = (end: number) => q(`#gasdsTable [data-gasds-year="${end}"]`) as HTMLElement;
const filter = (key: string) => q(`#gasdsFilters [data-gasds-filter="${key}"]`) as HTMLElement;
const yearSays = (end: number) => q(`#gasdsTable [data-gasds-status="${end}"]`) as HTMLElement;

describe("the tax year a small donation belongs to", () => {
  it("is the one its two year deadline was worked out from", () => {
    expect(Giving.taxYearEnd({ gasdsDeadline: "2027-04-05T00:00:00.000Z" })).toBe(2025);
    expect(Giving.taxYearWords(2025)).toBe("6 April 2024 to 5 April 2025");
  });

  it("is worked out from the day it was collected when there is no deadline to go by", () => {
    expect(Giving.taxYearEnd({ collectedAt: "2025-04-05T12:00:00.000Z" })).toBe(2025);
    expect(Giving.taxYearEnd({ collectedAt: "2025-04-06T12:00:00.000Z" })).toBe(2026);
  });

  it("groups donations by tax year, the nearest deadline first and the ones too late last", () => {
    const groups = Giving.groupByTaxYear([later(1), late(2), soon(3), soon(4, 200), late(5)]);
    expect(groups.map((g: { endYear: number }) => g.endYear)).toEqual([2025, 2027, 2024]);
    expect(groups[0]).toMatchObject({ endYear: 2025, count: 2, totalPence: 1000, flag: "expiring", deadline: "2027-04-05T00:00:00.000Z" });
    expect(groups[2]).toMatchObject({ endYear: 2024, count: 2, totalPence: 1000, flag: "expired" });
  });
});

describe("GASDS: the screen", () => {
  it("takes the kit's look, and its opening sentence says the acronym in words", async () => {
    await open();
    expect(el("view-gasds").classList.contains("ak")).toBe(true);
    expect(text(q("#view-gasds > .admin-view-intro"))).toContain("Gift Aid Small Donations Scheme");
    expect(text(q("#view-gasds > .admin-view-intro"))).toContain("two years");
  });

  it("asks for every small donation not yet claimed, not only those near the deadline", async () => {
    const screen = await open();
    const asked = screen.calls.find((c) => c.path === QUEUE) as Call;
    expect(asked.query).toBe("all=1");
  });

  it("says the list could not be loaded, and puts its buttons away", async () => {
    answers["GET " + QUEUE] = DOWN;
    await open();
    expect(text(el("gasdsTable"))).toBe("GASDS donations are unavailable.");
    expect(el("gasdsActions").hidden).toBe(true);
    expect(text(filter("all").querySelector(".ak-tile__n"))).toBe("?");
  });

  it("says when nothing is waiting, and puts its buttons away", async () => {
    await open();
    expect(text(el("gasdsTable"))).toBe("No small donations are waiting to be marked as claimed.");
    expect(el("gasdsActions").hidden).toBe(true);
  });
});

describe("GASDS: a card for each tax year", () => {
  beforeEach(() => {
    answers["GET " + QUEUE] = list([late(1), late(2), soon(11), soon(12, 700), soon(13, 950), later(21)]);
  });

  it("names the tax year, how many small donations, their total and the day to claim by", async () => {
    await open();
    const card = text(year(2025));
    expect(card).toContain("6 April 2024 to 5 April 2025");
    expect(card).toContain("3 small donations, £24.50 in all");
    expect(card).toContain("Claim by 5 April 2027");
  });

  it("puts the nearest deadline first and the years already too late last", async () => {
    await open();
    expect(years().map((y) => y.getAttribute("data-gasds-year"))).toEqual(["2025", "2027", "2024"]);
  });

  it("says where each year stands in plain words, never the database's", async () => {
    await open();
    expect(text(year(2025).querySelector(".admin-pill"))).toBe("Deadline within six months");
    expect(text(year(2024).querySelector(".admin-pill"))).toBe("Too late to claim");
    expect(year(2027).querySelector(".admin-pill")).toBeNull();
    const all = text(el("gasdsTable"));
    expect(all).not.toContain("expired");
    expect(all).not.toContain("expiring");
    expect(all).not.toContain("later");
  });

  it("draws a year that is too late quietly, and says its deadline has gone", async () => {
    await open();
    expect(year(2024).classList.contains("gv-year--late")).toBe(true);
    expect(year(2025).classList.contains("gv-year--late")).toBe(false);
    expect(text(year(2024))).toContain("The deadline was 5 April 2026");
  });

  it("says under Mark all what it does, that it claims nothing, and how to undo it", async () => {
    await open();
    expect(text(q('[data-gasds-mark-all="2025"]'))).toBe("Mark all 3 as claimed");
    const says = text(year(2025).querySelector(".ak-says"));
    expect(says).toContain("only records");
    expect(says).toContain("claims nothing");
    expect(says).toContain("Marked as claimed lately");
  });

  it("has no way to mark anything, and no tick boxes, for someone who may only look", async () => {
    await open({ gasds: "view" });
    expect(q("[data-gasds-mark-all]")).toBeNull();
    expect(text(q('[data-gasds-open="2025"]'))).toBe("See the 3 donations");
    await press(q('[data-gasds-open="2025"]'));
    expect(qa("#gasdsTable .gasds-check")).toEqual([]);
    expect(el("markGasdsBtn")).toBeNull();
    expect(text(year(2025))).toContain("1 June 2024");
  });
});

describe("GASDS: the tiles that filter", () => {
  beforeEach(() => {
    answers["GET " + QUEUE] = list([late(1), late(2), soon(11), soon(12, 700), soon(13, 950), later(21)]);
  });

  it("gives each its count and its total", async () => {
    await open();
    expect(text(filter("all").querySelector(".ak-tile__n"))).toBe("6");
    expect(text(filter("all").querySelector(".ak-tile__name"))).toBe("Not yet claimed");
    expect(text(filter("all").querySelector(".ak-tile__says"))).toContain("£47 in all");
    expect(text(filter("soon").querySelector(".ak-tile__n"))).toBe("3");
    expect(text(filter("soon").querySelector(".ak-tile__name"))).toBe("Deadline within six months");
    expect(text(filter("soon").querySelector(".ak-tile__says"))).toContain("£24.50 in all");
    expect(text(filter("late").querySelector(".ak-tile__n"))).toBe("2");
    expect(text(filter("late").querySelector(".ak-tile__name"))).toBe("Too late to claim");
    expect(text(filter("late").querySelector(".ak-tile__says"))).toContain("£10");
  });

  it("opens on everything not yet claimed, and draws Too late to claim quietly", async () => {
    await open();
    expect(filter("all").getAttribute("aria-pressed")).toBe("true");
    expect(filter("all").classList.contains("is-active")).toBe(true);
    expect(filter("late").classList.contains("gv-tile--quiet")).toBe(true);
    expect(filter("soon").classList.contains("gv-tile--quiet")).toBe(false);
  });

  it("shows only the years a pressed tile is about", async () => {
    await open();
    await press(filter("late"));
    expect(years().map((y) => y.getAttribute("data-gasds-year"))).toEqual(["2024"]);
    expect(filter("late").getAttribute("aria-pressed")).toBe("true");
    expect(filter("all").getAttribute("aria-pressed")).toBe("false");
    await press(filter("soon"));
    expect(years().map((y) => y.getAttribute("data-gasds-year"))).toEqual(["2025"]);
    await press(filter("all"));
    expect(years().length).toBe(3);
  });

  it("says so when a tile has nothing behind it", async () => {
    answers["GET " + QUEUE] = list([later(21)]);
    await open();
    await press(filter("soon"));
    expect(text(el("gasdsTable"))).toBe("No small donations have a deadline within six months.");
    await press(filter("late"));
    expect(text(el("gasdsTable"))).toBe("No small donations are too late to claim.");
  });
});

describe("GASDS: copying a tax year's total", () => {
  beforeEach(() => {
    answers["GET " + QUEUE] = list([soon(11), soon(12, 700), soon(13, 950)]);
  });

  it("copies the figure to type into HMRC's form and says so in the year's card", async () => {
    await open();
    await press(q('[data-gasds-copy="2025"]'));
    expect(copied).toEqual(["24.50"]);
    expect(text(yearSays(2025))).toBe("Copied 24.50, the total for 6 April 2024 to 5 April 2025.");
    expect(yearSays(2025).classList.contains("is-ok")).toBe(true);
  });

  it("says the figure when the browser will not copy it", async () => {
    copyWorks = false;
    await open();
    await press(q('[data-gasds-copy="2025"]'));
    expect(text(yearSays(2025))).toBe("Could not copy it. The total is 24.50.");
    expect(yearSays(2025).classList.contains("is-error")).toBe(true);
  });
});

describe("GASDS: marking a whole tax year as claimed", () => {
  // As the real server does: once marked, a donation is no longer in the list.
  let marked: number[] = [];
  beforeEach(() => {
    marked = [];
    const all = [soon(11), soon(12, 700), soon(13, 950), later(21)];
    answers["GET " + QUEUE] = () => list(all.filter((r) => !marked.includes(r.id)));
    answers["POST " + MARK] = (c) => {
      const ids = (c.body as { donationIds: number[] }).donationIds;
      marked.push(...ids);
      return { body: { claimed: ids.length, claimedIds: ids } };
    };
  });

  it("asks first, naming how many, which tax year and what to have done, and does nothing on No", async () => {
    const screen = await open();
    confirmAnswer = false;
    await press(q('[data-gasds-mark-all="2025"]'));
    expect(confirmSays).toHaveLength(1);
    expect(confirmSays[0]).toContain("all 3 small donations");
    expect(confirmSays[0]).toContain("6 April 2024 to 5 April 2025");
    expect(confirmSays[0]).toContain("£24.50");
    expect(screen.writes()).toEqual([]);
  });

  it("marks every donation in the year, and says what happened where the card was", async () => {
    const screen = await open();
    await press(q('[data-gasds-mark-all="2025"]'));
    expect(screen.writes().map((c) => [c.path, c.body])).toEqual([[MARK, { donationIds: [11, 12, 13] }]]);
    expect(text(yearSays(2025))).toBe("Marked 3 small donations as claimed. If that was a mistake, undo it under Marked as claimed lately.");
    expect(yearSays(2025).classList.contains("is-ok")).toBe(true);
    expect(q('[data-gasds-mark-all="2025"]')).toBeNull();
    expect(alerts).toEqual([]);
  });

  it("takes them off the tiles' counts, and reads what was marked lately again", async () => {
    const screen = await open();
    const before = screen.calls.filter((c) => c.path === LATELY).length;
    await press(q('[data-gasds-mark-all="2025"]'));
    expect(text(filter("all").querySelector(".ak-tile__n"))).toBe("1");
    expect(text(filter("soon").querySelector(".ak-tile__n"))).toBe("0");
    expect(screen.calls.filter((c) => c.path === LATELY).length).toBe(before + 1);
  });

  it("says how many were marked when some already had been", async () => {
    answers["POST " + MARK] = () => { marked.push(11, 12, 13); return { body: { claimed: 2, claimedIds: [11, 12] } }; };
    await open();
    await press(q('[data-gasds-mark-all="2025"]'));
    expect(text(yearSays(2025))).toContain("Marked 2 of the 3 as claimed.");
  });

  it("says nothing was changed, and leaves the year as it was, when the server fails", async () => {
    answers["POST " + MARK] = DOWN;
    await open();
    await press(q('[data-gasds-mark-all="2025"]'));
    expect(text(yearSays(2025))).toBe("Could not mark those donations as claimed. Nothing was changed.");
    expect(yearSays(2025).classList.contains("is-error")).toBe(true);
    expect(q('[data-gasds-mark-all="2025"]')).not.toBeNull();
    expect(alerts).toEqual([]);
  });
});

describe("GASDS: ticking them off one by one", () => {
  let marked: number[] = [];
  beforeEach(() => {
    marked = [];
    const all = [soon(11), soon(12, 700), soon(13, 950), later(21), later(22)];
    answers["GET " + QUEUE] = () => list(all.filter((r) => !marked.includes(r.id)));
    answers["POST " + MARK] = (c) => {
      const ids = (c.body as { donationIds: number[] }).donationIds;
      marked.push(...ids);
      return { body: { claimed: ids.length, claimedIds: ids } };
    };
  });
  const boxes = () => qa("#gasdsTable .gasds-check") as HTMLInputElement[];

  it("opens a year's donations in place, each with a tick box, who, how much and the day it was collected", async () => {
    await open();
    const toggle = q('[data-gasds-open="2025"]') as HTMLElement;
    expect(text(toggle)).toBe("Tick them off one by one");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await press(toggle);
    expect((q('[data-gasds-open="2025"]') as HTMLElement).getAttribute("aria-expanded")).toBe("true");
    expect(boxes().map((b) => b.value)).toEqual(["11", "12", "13"]);
    expect(boxes()[0].getAttribute("aria-label")).toContain("Select donation 11");
    const rows = text(year(2025));
    expect(rows).toContain("Card reader");
    expect(rows).toContain("£8");
    expect(rows).toContain("1 June 2024");
    expect(q('#gasdsTable [data-donor="500"]')).not.toBeNull();
  });

  it("keeps one year open at a time", async () => {
    await open();
    await press(q('[data-gasds-open="2025"]'));
    await press(q('[data-gasds-open="2027"]'));
    expect(boxes().map((b) => b.value)).toEqual(["21", "22"]);
    expect((q('[data-gasds-open="2025"]') as HTMLElement).getAttribute("aria-expanded")).toBe("false");
    await press(q('[data-gasds-open="2027"]'));
    expect(boxes()).toEqual([]);
  });

  it("keeps a running line of how many are ticked and their total", async () => {
    await open();
    await press(q('[data-gasds-open="2025"]'));
    expect(text(el("gasdsTally"))).toBe("None ticked yet.");
    boxes()[0].click();
    boxes()[2].click();
    await settle();
    expect(text(el("gasdsTally"))).toBe("2 ticked, £17.50 in all");
  });

  it("says in the page to tick one first, and asks the server for nothing", async () => {
    const screen = await open();
    await press(q('[data-gasds-open="2025"]'));
    await press(el("markGasdsBtn"));
    expect(text(yearSays(2025))).toBe("Tick at least one donation first.");
    expect(yearSays(2025).classList.contains("is-error")).toBe(true);
    expect(screen.writes()).toEqual([]);
    expect(confirmSays).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it("asks first, then marks only the ticked ones and says so, leaving the rest in the year", async () => {
    const screen = await open();
    await press(q('[data-gasds-open="2025"]'));
    boxes()[0].click();
    boxes()[2].click();
    await press(el("markGasdsBtn"));
    expect(confirmSays[0]).toContain("2 ticked small donations");
    expect(screen.writes().map((c) => [c.path, c.body])).toEqual([[MARK, { donationIds: [11, 13] }]]);
    expect(text(yearSays(2025))).toBe("Marked 2 small donations as claimed. If that was a mistake, undo it under Marked as claimed lately.");
    expect(text(year(2025))).toContain("1 small donation, £7 in all");
    expect(boxes().map((b) => b.value)).toEqual(["12"]);
  });

  it("does nothing when the question is answered No", async () => {
    const screen = await open();
    await press(q('[data-gasds-open="2025"]'));
    boxes()[0].click();
    confirmAnswer = false;
    await press(el("markGasdsBtn"));
    expect(screen.writes()).toEqual([]);
    expect(boxes()[0].checked).toBe(true);
  });
});

describe("GASDS: Download this list", () => {
  it("hands over a spreadsheet of what is showing and says how many are in it", async () => {
    answers["GET " + QUEUE] = list([late(1), soon(11), soon(12, 700)]);
    await open();
    expect(el("gasdsActions").hidden).toBe(false);
    await press(filter("soon"));
    await press(el("gasdsDownload"));
    expect(downloads).toEqual(["small-donations-not-yet-claimed.csv"]);
    expect(text(el("gasdsStatus"))).toBe("Downloaded small-donations-not-yet-claimed.csv with 2 small donations.");
    expect(el("gasdsStatus").classList.contains("is-ok")).toBe(true);
  });

  it("puts each donation's number, name, amount, dates and tax year in the file", () => {
    const rows = Giving.gasdsSheet([soon(11)]);
    expect(rows[0]).toEqual(["Donation", "Name", "Amount (£)", "Collected", "Tax year", "Claim by", "Where it stands"]);
    expect(rows[1]).toEqual([11, "Card reader", 8, "1 June 2024", "6 April 2024 to 5 April 2025", "5 April 2027", "Deadline within six months"]);
  });

  it("is there for someone who may only look", async () => {
    answers["GET " + QUEUE] = list([soon(11)]);
    await open({ gasds: "view" });
    expect(el("gasdsActions").hidden).toBe(false);
    expect(el("gasdsDownload").hidden).toBe(false);
  });
});

describe("GASDS: what was marked as claimed lately", () => {
  it("says who marked how many, how much and when", async () => {
    answers["GET " + LATELY] = list([mark(900)]);
    await open();
    const row = text(q('#gasdsRecent [data-gasds-mark="900"]'));
    expect(row).toContain("3 small donations, £24");
    expect(row).toContain("fern@example.com");
    expect(row).not.toContain("admin:");
    expect(row).toContain("3 November 2026");
    expect(text(q('[data-gasds-undo="900"]'))).toBe("Undo");
  });

  it("asks first, then puts the donations back and says so", async () => {
    let undone = false;
    answers["GET " + LATELY] = () => list([mark(900, undone ? { stillClaimedIds: [] } : {})]);
    answers["POST " + UNMARK] = () => { undone = true; return { body: { unclaimed: 3, unclaimedIds: [41, 42, 43] } }; };
    const screen = await open();
    const before = screen.calls.filter((c) => c.path === QUEUE).length;
    await press(q('[data-gasds-undo="900"]'));
    expect(confirmSays[0]).toContain("3 small donations");
    expect(screen.writes().map((c) => [c.path, c.body])).toEqual([[UNMARK, { donationIds: [41, 42, 43] }]]);
    expect(text(q('#gasdsRecent [data-gasds-mark-status="900"]'))).toBe("Put 3 small donations back in the list.");
    expect(q('[data-gasds-undo="900"]')).toBeNull();
    expect(screen.calls.filter((c) => c.path === QUEUE).length).toBe(before + 1);
  });

  it("does nothing when the question is answered No", async () => {
    answers["GET " + LATELY] = list([mark(900)]);
    const screen = await open();
    confirmAnswer = false;
    await press(q('[data-gasds-undo="900"]'));
    expect(screen.writes()).toEqual([]);
  });

  it("only undoes the donations still marked by that mark, and says how many", async () => {
    answers["GET " + LATELY] = list([mark(900, { stillClaimedIds: [42] })]);
    answers["POST " + UNMARK] = { body: { unclaimed: 1, unclaimedIds: [42] } };
    const screen = await open();
    expect(text(q('[data-gasds-undo="900"]'))).toBe("Undo the 1 still marked");
    await press(q('[data-gasds-undo="900"]'));
    expect(screen.writes()[0].body).toEqual({ donationIds: [42] });
  });

  it("has no Undo on a mark with nothing left to undo, and says it was undone", async () => {
    answers["GET " + LATELY] = list([mark(900, { stillClaimedIds: [] })]);
    await open();
    expect(q('[data-gasds-undo="900"]')).toBeNull();
    expect(text(q('#gasdsRecent [data-gasds-mark="900"]'))).toContain("Undone since");
  });

  it("says nothing was changed when the undo fails", async () => {
    answers["GET " + LATELY] = list([mark(900)]);
    answers["POST " + UNMARK] = DOWN;
    await open();
    await press(q('[data-gasds-undo="900"]'));
    const says = q('#gasdsRecent [data-gasds-mark-status="900"]') as HTMLElement;
    expect(text(says)).toBe("Could not undo that. Nothing was changed.");
    expect(says.classList.contains("is-error")).toBe(true);
  });

  it("has no Undo for someone who may only look", async () => {
    answers["GET " + LATELY] = list([mark(900)]);
    await open({ gasds: "view" });
    expect(q("[data-gasds-undo]")).toBeNull();
    expect(text(el("gasdsRecent"))).toContain("fern@example.com");
  });

  it("says when nothing has been marked, and says so differently when it could not be loaded", async () => {
    await open();
    expect(text(el("gasdsRecent"))).toBe("Nothing has been marked as claimed yet.");
    answers["GET " + LATELY] = DOWN;
    await open();
    expect(text(el("gasdsRecent"))).toBe("What was marked lately could not be loaded.");
  });
});

describe("GASDS: this year's three figures", () => {
  it("draws each as a tile, under the name it always had, with a plain line saying what it is", async () => {
    await open();
    const tiles = qa("#gasdsPool .ak-tile");
    expect(tiles.map((t) => text(t.querySelector(".ak-tile__n")))).toEqual(["£1234", "£560", "£766"]);
    expect(tiles.map((t) => text(t.querySelector(".ak-tile__name")))).toEqual([
      "Small donations pool (2026)", "Gift Aid claimed this year", "Remaining GASDS headroom",
    ]);
    tiles.forEach((t) => expect(text(t.querySelector(".ak-tile__says")).length).toBeGreaterThan(20));
  });

  it("promises nothing about the headroom figure: it says to check it with the treasurer", async () => {
    await open();
    expect(text(qa("#gasdsPool .ak-tile")[2].querySelector(".ak-tile__says"))).toContain("treasurer");
  });

  it("says the figures could not be loaded, rather than showing noughts", async () => {
    answers["GET " + POOL] = DOWN;
    await open();
    expect(text(el("gasdsPool"))).toBe("The small donations pool is unavailable.");
  });
});

describe("GASDS: how the scheme works", () => {
  it("is folded away, uses the rules the site works to, and ends that it is not tax advice with HMRC's own page", async () => {
    await open();
    const fold = el("gasdsHow") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(text(fold.querySelector("summary"))).toBe("How the small donations scheme works");
    const words = text(fold);
    expect(words).toContain("£30 or less");
    expect(words).toContain("£8,000");
    expect(words).toContain("ten times");
    expect(words).toContain("Two years");
    expect(words).toContain("This is not tax advice.");
    const link = fold.querySelector("a") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://www.gov.uk/claim-gift-aid/small-donations-scheme");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
