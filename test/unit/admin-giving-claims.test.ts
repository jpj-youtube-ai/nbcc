// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { givingScreen, settle, el, q, qa, text, press, type Call, type Reply } from "./helpers/giving-screen";

// Admin > Giving > Claims, in the kit's look (docs/superpowers/specs/2026-11-14-admin-refresh-giving.md):
// tiles, a bar of four parts, a pick list with Tick all and a running line, a card per batch whose
// buttons say what they do, and every message said in the page. Every person, postcode and amount
// here is invented.

const ready = (id: number, over: Record<string, unknown> = {}) => ({
  id, donor_id: 100 + id, donor_name: "Rowan Example " + id, amount_pence: 2500, postcode: "KA1 1AA",
  created_at: "2026-11-03T10:00:00.000Z", ...over,
});
const batch = (id: number, over: Record<string, unknown> = {}) => ({
  id, status: "open", submitted_at: null, regulator: "OSCR", charity_number: "SC000000", hmrc_reference: null,
  created_at: "2026-11-01T09:00:00.000Z", donation_count: 12, total_pence: 34000, ...over,
});
const adjustment = (id: number, over: Record<string, unknown> = {}) => ({
  id, donor_id: 300 + id, donor_name: "Isla Example", donor_email: "isla@example.com", amount_pence: 5000,
  refunded_amount_pence: 5000, claim_status: "adjustment_due", claim_batch_id: 4, created_at: "2026-09-01T10:00:00.000Z",
  adjustment_pence: 5000, adjustment_reason: "refund via charge.refunded", ...over,
});

const ELIGIBLE = "/api/admin/claims/eligible";
const BATCHES = "/api/admin/claim-batches";
const ADJUST = "/api/admin/claims/adjustment-due";
const AWAITING = "/api/admin/queues/awaiting-declaration";
const REVIEW = "/api/admin/queues/declaration-review";
const KEEP = "/api/admin/queues/retention-expiry";

// What the pretend server answers, keyed "METHOD path". A function sees the call.
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

beforeEach(() => {
  answers = {};
  confirmSays = [];
  confirmAnswer = true;
  alerts = [];
  window.confirm = (m?: string) => { confirmSays.push(String(m)); return confirmAnswer; };
  window.alert = (m?: string) => { alerts.push(String(m)); };
});

async function open(perms?: Parameters<typeof givingScreen>[1]) {
  const screen = givingScreen(reply, perms);
  screen.giving.openClaims();
  await settle();
  return screen;
}
const tile = (key: string) => q(`#claimsTiles [data-claims-tile="${key}"]`) as HTMLElement;
const partBtn = (key: string) => q(`#claimsParts [data-akpart="${key}"]`) as HTMLElement;
const shown = () => qa("#claimsParts [data-akpart-body]").filter((p) => !p.hidden).map((p) => p.getAttribute("data-akpart-body"));
const ticks = () => qa("#eligibleTable .elig-check") as HTMLInputElement[];
const batchCard = (id: number) => q(`#batchesTable [data-batch="${id}"]`) as HTMLElement;
const batchSays = (id: number) => q(`#batchesTable [data-batch-status="${id}"]`) as HTMLElement;

describe("Claims: the screen", () => {
  it("takes the kit's look and opens with one plain sentence", async () => {
    await open();
    expect(el("view-claims").classList.contains("ak")).toBe(true);
    expect(text(q("#view-claims > h2"))).toBe("Gift Aid claims");
    expect(text(q("#view-claims > .admin-view-intro"))).toContain("it does not file it for you");
  });

  it("keeps the step by step guide, folded, above the bar of parts", async () => {
    await open();
    const guide = q("#view-claims details.admin-guide") as HTMLDetailsElement;
    expect(guide.open).toBe(false);
    expect(text(guide.querySelector("summary"))).toBe("How a Gift Aid claim works, step by step");
    expect(guide.querySelectorAll("ol > li").length).toBe(8);
    expect(guide.compareDocumentPosition(el("claimsParts")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The guide names the buttons as they are now.
    expect(text(guide)).toContain("Download for HMRC");
    expect(text(guide)).toContain("Mark as sent to HMRC");
    expect(text(guide)).not.toContain("Export CSV");
  });

  it("has a bar of four parts, in order, and opens on Ready to claim alone", async () => {
    await open();
    expect(qa("#claimsParts [data-akpart]").map((b) => b.getAttribute("data-akpart"))).toEqual(["ready", "batches", "repay", "declarations"]);
    expect(text(partBtn("ready"))).toContain("Ready to claim");
    expect(text(partBtn("batches"))).toContain("Claims");
    expect(text(partBtn("repay"))).toContain("To repay");
    expect(text(partBtn("declarations"))).toContain("Declarations");
    expect(shown()).toEqual(["ready"]);
    expect(partBtn("ready").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the part a button on the bar is for, and only that one", async () => {
    await open();
    await press(partBtn("repay"));
    expect(shown()).toEqual(["repay"]);
  });

  it("stays on the part you were on when the screen is opened again", async () => {
    const screen = await open();
    await press(partBtn("batches"));
    screen.giving.openClaims();
    await settle();
    expect(shown()).toEqual(["batches"]);
  });
});

describe("Claims: the tiles", () => {
  beforeEach(() => {
    answers["GET " + ELIGIBLE] = list([ready(1, { amount_pence: 30000 }), ready(2, { amount_pence: 2500 }), ready(3, { amount_pence: 1500 })]);
    answers["GET " + BATCHES] = list([batch(9), batch(8, { status: "submitted", submitted_at: "2026-10-02T09:00:00.000Z" }), batch(7, { status: "submitted" })]);
    answers["GET " + ADJUST] = list([adjustment(1)]);
    answers["GET " + AWAITING] = list([{ id: 1 }, { id: 2 }]);
    answers["GET " + REVIEW] = list([{ id: 1 }]);
    answers["GET " + KEEP] = list([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it("has one tile for each of the seven things, with its count", async () => {
    await open();
    const counts = Object.fromEntries(
      qa("#claimsTiles [data-claims-tile]").map((t) => [t.getAttribute("data-claims-tile"), text(t.querySelector(".ak-tile__n"))]),
    );
    expect(counts).toEqual({ ready: "3", open: "1", sent: "2", repay: "1", awaiting: "2", review: "1", keep: "4" });
    expect(text(tile("ready").querySelector(".ak-tile__name"))).toBe("Ready to claim");
    expect(text(tile("open").querySelector(".ak-tile__name"))).toBe("Being put together");
    expect(text(tile("sent").querySelector(".ak-tile__name"))).toBe("Sent to HMRC");
    expect(text(tile("repay").querySelector(".ak-tile__name"))).toBe("To repay");
  });

  it("says on Ready to claim how much was given and about how much comes back at 25p in the pound", async () => {
    await open();
    expect(text(tile("ready").querySelector(".ak-tile__says"))).toBe("£340 given, about £85 to claim back");
  });

  it("lets a tile with nothing in it step back", async () => {
    answers["GET " + ADJUST] = list([]);
    await open();
    expect(tile("repay").classList.contains("is-none")).toBe(true);
    expect(tile("ready").classList.contains("is-none")).toBe(false);
  });

  it("says a count could not be loaded, never 0, when its list failed", async () => {
    answers["GET " + REVIEW] = DOWN;
    await open();
    expect(text(tile("review").querySelector(".ak-tile__n"))).toBe("?");
    expect(text(tile("review"))).toContain("Could not be loaded");
  });

  it("opens the part a tile is about when the tile is pressed", async () => {
    await open();
    await press(tile("sent"));
    expect(shown()).toEqual(["batches"]);
    await press(tile("review"));
    expect(shown()).toEqual(["declarations"]);
    await press(tile("repay"));
    expect(shown()).toEqual(["repay"]);
    await press(tile("ready"));
    expect(shown()).toEqual(["ready"]);
  });

  it("puts a dot on each part with something waiting, and none on a part with nothing", async () => {
    answers["GET " + ADJUST] = list([]);
    await open();
    expect(el("claimsDotReady").hidden).toBe(false);
    expect(el("claimsDotBatches").hidden).toBe(false);
    expect(el("claimsDotRepay").hidden).toBe(true);
    expect(el("claimsDotDeclarations").hidden).toBe(false);
  });
});

describe("Claims: ready to claim", () => {
  it("draws a row for each donation: who, how much, the postcode, the date in words and its number", async () => {
    answers["GET " + ELIGIBLE] = list([ready(412)]);
    await open();
    const row = q("#eligibleTable .gv-row:not(.gv-row--head)") as HTMLElement;
    expect(text(row)).toContain("Rowan Example 412");
    expect(text(row)).toContain("£25");
    expect(text(row)).toContain("KA1 1AA");
    expect(text(row)).toContain("3 November 2026");
    expect(text(row)).toContain("412");
    expect(ticks()[0].getAttribute("aria-label")).toContain("Select donation 412");
  });

  it("puts a name from the server on the page as words, never as markup", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1, { donor_name: '<img src=x onerror="window.hacked=1">' })]);
    await open();
    expect(q("#eligibleTable img")).toBeNull();
    expect(text(el("eligibleTable"))).toContain("<img src=x");
  });

  it("makes the name a button that opens the donor, for someone who may open Donations", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    await open();
    const name = q('#eligibleTable [data-donor="101"]') as HTMLElement;
    expect(name.tagName).toBe("BUTTON");
    expect(text(name)).toBe("Rowan Example 1");
  });

  it("leaves the name as words for someone who may not open Donations", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    await open({ claims: "edit", donations: "none" });
    expect(q("#eligibleTable [data-donor]")).toBeNull();
    expect(text(el("eligibleTable"))).toContain("Rowan Example 1");
  });

  it("says none are ticked to begin with", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1), ready(2)]);
    await open();
    expect(el("eligibleActions").hidden).toBe(false);
    expect(text(el("eligTally"))).toBe("None ticked yet.");
  });

  it("keeps a running line of how many are ticked, what they gave and about what comes back", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1), ready(2, { amount_pence: 1000 })]);
    await open();
    ticks()[0].click();
    await settle();
    expect(text(el("eligTally"))).toBe("1 ticked, £25 given, about £6.25 to claim back");
    ticks()[1].click();
    await settle();
    expect(text(el("eligTally"))).toBe("2 ticked, £35 given, about £8.75 to claim back");
  });

  it("ticks every donation with Tick all, and unticks them all with the same button", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1, { amount_pence: 30000 }), ready(2), ready(3, { amount_pence: 1500 })]);
    await open();
    expect(text(el("eligTickAll"))).toBe("Tick all");
    await press(el("eligTickAll"));
    expect(ticks().every((t) => t.checked)).toBe(true);
    expect(text(el("eligTally"))).toBe("3 ticked, £340 given, about £85 to claim back");
    expect(text(el("eligTickAll"))).toBe("Untick all");
    await press(el("eligTickAll"));
    expect(ticks().some((t) => t.checked)).toBe(false);
    expect(text(el("eligTally"))).toBe("None ticked yet.");
  });

  it("warns when more than 1,000 would go in one batch, the most HMRC's spreadsheet takes", async () => {
    answers["GET " + ELIGIBLE] = list(Array.from({ length: 1001 }, (_, i) => ready(i + 1)));
    await open();
    await press(el("eligTickAll"));
    expect(el("eligLimit").hidden).toBe(false);
    expect(text(el("eligLimit"))).toContain("1,001");
    expect(text(el("eligLimit"))).toContain("1,000");
    ticks()[0].click();
    await settle();
    expect(el("eligLimit").hidden).toBe(true);
  });

  it("counts what the chosen batch already holds towards the 1,000", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1), ready(2), ready(3)]);
    answers["GET " + BATCHES] = list([batch(7, { donation_count: 998 })]);
    await open();
    await press(el("eligTickAll"));
    expect(el("eligLimit").hidden).toBe(true);
    const pick = el("assignBatchSelect") as HTMLSelectElement;
    pick.value = "7";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(el("eligLimit").hidden).toBe(false);
    expect(text(el("eligLimit"))).toContain("1,001");
  });

  it("offers a new batch, then each batch still being put together, to add to", async () => {
    answers["GET " + BATCHES] = list([batch(9), batch(8, { status: "submitted" }), batch(6)]);
    await open();
    const options = Array.from((el("assignBatchSelect") as HTMLSelectElement).options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([["new", "New batch"], ["9", "Batch 9"], ["6", "Batch 6"]]);
  });

  it("says in the page to tick one first, and asks the server for nothing, when none are ticked", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    const screen = await open();
    await press(el("assignBtn"));
    expect(text(el("eligStatus"))).toBe("Tick at least one donation first.");
    expect(el("eligStatus").classList.contains("is-error")).toBe(true);
    expect(screen.writes()).toEqual([]);
    expect(alerts).toEqual([]);
  });

  it("starts a new batch, adds the ticked donations and says what it did", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1), ready(2), ready(3)]);
    answers["POST " + BATCHES] = { status: 201, body: { batchId: 9 } };
    answers["POST " + BATCHES + "/9/donations"] = (c) => ({ body: { assigned: (c.body as { donationIds: number[] }).donationIds, failed: [] } });
    const screen = await open();
    ticks()[0].click();
    ticks()[2].click();
    await press(el("assignBtn"));
    expect(screen.writes().map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", BATCHES, {}],
      ["POST", BATCHES + "/9/donations", { donationIds: [1, 3] }],
    ]);
    expect(text(el("eligStatus"))).toBe("Added 2 donations to batch 9.");
    expect(el("eligStatus").classList.contains("is-ok")).toBe(true);
    expect(alerts).toEqual([]);
  });

  it("reads the lists again afterwards, so what was added has left the ready list", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    answers["POST " + BATCHES] = { status: 201, body: { batchId: 9 } };
    answers["POST " + BATCHES + "/9/donations"] = { body: { assigned: [1], failed: [] } };
    const screen = await open();
    ticks()[0].click();
    const before = screen.calls.filter((c) => c.method === "GET" && c.path === ELIGIBLE).length;
    await press(el("assignBtn"));
    expect(screen.calls.filter((c) => c.method === "GET" && c.path === ELIGIBLE).length).toBe(before + 1);
    expect(text(el("eligStatus"))).toBe("Added 1 donation to batch 9.");
  });

  it("adds to a batch already being put together without starting another", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    answers["GET " + BATCHES] = list([batch(7)]);
    answers["POST " + BATCHES + "/7/donations"] = { body: { assigned: [1], failed: [] } };
    const screen = await open();
    (el("assignBatchSelect") as HTMLSelectElement).value = "7";
    ticks()[0].click();
    await press(el("assignBtn"));
    expect(screen.writes().map((c) => c.path)).toEqual([BATCHES + "/7/donations"]);
    expect(text(el("eligStatus"))).toBe("Added 1 donation to batch 7.");
  });

  it("says how many could not be added, and why, in plain words", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1), ready(2), ready(3)]);
    answers["GET " + BATCHES] = list([batch(7)]);
    answers["POST " + BATCHES + "/7/donations"] = {
      body: { assigned: [1], failed: [{ id: 2, reason: "already_batched" }, { id: 3, reason: "not_eligible" }] },
    };
    await open();
    (el("assignBatchSelect") as HTMLSelectElement).value = "7";
    await press(el("eligTickAll"));
    await press(el("assignBtn"));
    expect(text(el("eligStatus"))).toBe("Added 1 donation to batch 7. 2 could not be added (1 already in a batch, 1 no longer ready to claim).");
    expect(text(el("eligStatus"))).not.toContain("already_batched");
    expect(el("eligStatus").classList.contains("is-error")).toBe(true);
  });

  it("says nothing was added when a new batch could not be started", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    answers["POST " + BATCHES] = DOWN;
    const screen = await open();
    ticks()[0].click();
    await press(el("assignBtn"));
    expect(text(el("eligStatus"))).toBe("A new batch could not be started, so nothing was added.");
    expect(el("eligStatus").classList.contains("is-error")).toBe(true);
    expect(screen.writes().map((c) => c.path)).toEqual([BATCHES]);
  });

  it("names the batch it started when the donations then could not be added to it", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    answers["POST " + BATCHES] = { status: 201, body: { batchId: 9 } };
    answers["POST " + BATCHES + "/9/donations"] = DOWN;
    await open();
    ticks()[0].click();
    await press(el("assignBtn"));
    expect(text(el("eligStatus"))).toBe("Batch 9 was started, but the donations could not be added to it. Choose Batch 9 above and try again.");
    expect(el("eligStatus").classList.contains("is-error")).toBe(true);
  });

  it("has no tick boxes and no Add to batch for someone who may only look", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    await open({ claims: "view", donations: "view" });
    expect(ticks()).toEqual([]);
    expect(el("eligibleActions").hidden).toBe(true);
    expect(text(el("eligibleTable"))).toContain("Rowan Example 1");
  });

  it("says nothing is waiting, and puts the Add to batch bar away, when the list is empty", async () => {
    await open();
    expect(text(el("eligibleTable"))).toBe("No donations are waiting to be claimed.");
    expect(el("eligibleActions").hidden).toBe(true);
  });

  it("says the list could not be loaded, rather than that nothing is waiting", async () => {
    answers["GET " + ELIGIBLE] = DOWN;
    await open();
    expect(text(el("eligibleTable"))).toBe("Donations waiting to be claimed are unavailable.");
    expect(el("eligibleActions").hidden).toBe(true);
  });
});

describe("Claims: the batches", () => {
  it("draws a card for each batch, its state in plain words and never the database's", async () => {
    answers["GET " + BATCHES] = list([
      batch(9),
      batch(8, { status: "submitted", submitted_at: "2026-10-02T09:00:00.000Z" }),
      batch(4, { status: "adjustment_due", submitted_at: "2026-06-02T09:00:00.000Z" }),
    ]);
    await open();
    expect(text(batchCard(9).querySelector(".admin-pill"))).toBe("Being put together");
    expect(text(batchCard(8).querySelector(".admin-pill"))).toBe("Sent to HMRC");
    expect(text(batchCard(4).querySelector(".admin-pill"))).toBe("To repay");
    const all = text(el("batchesTable"));
    expect(all).not.toContain("submitted");
    expect(all).not.toContain("adjustment_due");
    expect(all).not.toMatch(/\bopen\b/);
  });

  it("says how many donations a batch holds, what they gave, about what comes back, and its dates in words", async () => {
    answers["GET " + BATCHES] = list([batch(8, { status: "submitted", submitted_at: "2026-10-02T09:00:00.000Z", hmrc_reference: "REF-INVENTED" })]);
    await open();
    const card = text(batchCard(8));
    expect(card).toContain("Batch 8");
    // Sent already, so no "about £X to claim back": that is only for a batch still being put together.
    expect(card).toContain("12 donations, £340 given");
    expect(card).not.toContain("to claim back");
    expect(card).toContain("1 November 2026");
    expect(card).toContain("2 October 2026");
    expect(card).toContain("REF-INVENTED");
  });

  it("offers Download for HMRC on every batch and Mark as sent to HMRC only on one being put together", async () => {
    answers["GET " + BATCHES] = list([batch(9), batch(8, { status: "submitted" })]);
    await open();
    expect(text(q('[data-export-batch="9"]'))).toBe("Download for HMRC");
    expect(text(q('[data-export-batch="8"]'))).toBe("Download for HMRC");
    expect(text(q('[data-submit-batch="9"]'))).toBe("Mark as sent to HMRC");
    expect(q('[data-submit-batch="8"]')).toBeNull();
    const all = text(el("batchesTable"));
    expect(all).not.toContain("Export CSV");
    expect(all).not.toMatch(/\bSubmit\b/);
  });

  it("says under Mark as sent to HMRC that it only records, and sends nothing", async () => {
    answers["GET " + BATCHES] = list([batch(9)]);
    await open();
    const says = text(batchCard(9).querySelector(".ak-says"));
    expect(says).toContain("only records");
    expect(says).toContain("sends nothing to HMRC");
    expect(says).toContain("cannot be undone");
  });

  it("offers neither button to someone who may only look", async () => {
    answers["GET " + BATCHES] = list([batch(9)]);
    await open({ claims: "view" });
    expect(q("[data-export-batch]")).toBeNull();
    expect(q("[data-submit-batch]")).toBeNull();
    expect(text(batchCard(9))).toContain("Being put together");
  });

  it("asks first, with a question that says it only records, and does nothing on No", async () => {
    answers["GET " + BATCHES] = list([batch(9)]);
    const screen = await open();
    confirmAnswer = false;
    await press(q('[data-submit-batch="9"]'));
    expect(confirmSays).toHaveLength(1);
    expect(confirmSays[0]).toContain("batch 9");
    expect(confirmSays[0]).toContain("only records");
    expect(confirmSays[0]).not.toContain("Submit claim batch");
    expect(screen.writes()).toEqual([]);
  });

  it("marks the batch as sent and says so in its card", async () => {
    let sent = false;
    answers["GET " + BATCHES] = () => list([batch(9, sent ? { status: "submitted", submitted_at: "2026-11-14T12:00:00.000Z" } : {})]);
    answers["POST " + BATCHES + "/9/submit"] = () => { sent = true; return { body: { submitted: true, batchId: 9 } }; };
    const screen = await open();
    await press(q('[data-submit-batch="9"]'));
    expect(screen.writes().map((c) => c.path)).toEqual([BATCHES + "/9/submit"]);
    expect(text(batchSays(9))).toBe("Batch 9 is marked as sent to HMRC.");
    expect(batchSays(9).classList.contains("is-ok")).toBe(true);
    expect(text(batchCard(9).querySelector(".admin-pill"))).toBe("Sent to HMRC");
  });

  it("says a batch had already been marked when the server refuses", async () => {
    answers["GET " + BATCHES] = list([batch(9)]);
    answers["POST " + BATCHES + "/9/submit"] = { status: 409, body: { error: "Claim batch cannot be submitted: not_open" } };
    await open();
    await press(q('[data-submit-batch="9"]'));
    expect(text(batchSays(9))).toBe("Batch 9 has already been marked as sent.");
    expect(batchSays(9).classList.contains("is-error")).toBe(true);
    expect(text(batchSays(9))).not.toContain("not_open");
  });

  it("says nothing was changed when marking as sent fails", async () => {
    answers["GET " + BATCHES] = list([batch(9)]);
    answers["POST " + BATCHES + "/9/submit"] = DOWN;
    await open();
    await press(q('[data-submit-batch="9"]'));
    expect(text(batchSays(9))).toBe("Batch 9 could not be marked as sent. Nothing was changed.");
    expect(batchSays(9).classList.contains("is-error")).toBe(true);
  });

  describe("the download", () => {
    let made: string[] = [];
    let clicked: string[] = [];
    beforeEach(() => {
      made = [];
      clicked = [];
      (window.URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => { made.push("blob"); return "blob:made"; });
      (window.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { clicked.push(this.download); };
    });
    const CSV = "Title,First name,Last name,House name/number,Postcode,Donation date,Amount\r\n,Rowan,Example,12,KA1 1AA,03/11/26,25.00\r\n,Isla,Example,3,KA2 2BB,04/11/26,10.00\r\n";

    it("hands over the batch's file under its old name and says how many donations are in it", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 2 })]);
      answers["GET " + BATCHES + "/9/export"] = { text: CSV };
      await open();
      await press(q('[data-export-batch="9"]'));
      expect(clicked).toEqual(["claim-batch-9.csv"]);
      expect(text(batchSays(9))).toBe("Downloaded claim-batch-9.csv with 2 donations.");
      expect(batchSays(9).classList.contains("is-ok")).toBe(true);
    });

    it("hands over no file when the server refuses, and says why in the batch's card", async () => {
      answers["GET " + BATCHES] = list([batch(9)]);
      answers["GET " + BATCHES + "/9/export"] = { status: 500, body: { error: "Export is temporarily unavailable" }, text: '{"error":"Export is temporarily unavailable"}' };
      await open();
      await press(q('[data-export-batch="9"]'));
      expect(clicked).toEqual([]);
      expect(made).toEqual([]);
      expect(batchSays(9).classList.contains("is-error")).toBe(true);
      expect(text(batchSays(9))).toContain("Batch 9 could not be downloaded, so no file was made.");
      expect(text(batchSays(9))).toContain("house name or number");
    });

    it("says it is not in your access, with no file, on a 403", async () => {
      answers["GET " + BATCHES] = list([batch(9)]);
      answers["GET " + BATCHES + "/9/export"] = { status: 403, body: { error: "forbidden" } };
      await open();
      await press(q('[data-export-batch="9"]'));
      expect(clicked).toEqual([]);
      expect(text(batchSays(9))).toBe("Downloading a claim is not part of your access, so no file was made.");
    });

    it("says when the file holds fewer donations than the batch, and which are left out", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 3 })]);
      answers["GET " + BATCHES + "/9/export"] = { text: CSV };
      await open();
      await press(q('[data-export-batch="9"]'));
      expect(clicked).toEqual(["claim-batch-9.csv"]);
      expect(text(batchSays(9))).toBe(
        "Downloaded claim-batch-9.csv with 2 of this batch’s 3 donations. Donations from outside the UK and ones refunded in full are left out of the file.",
      );
    });

    it("makes no file for a batch with nothing in it", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 0, total_pence: 0 })]);
      answers["GET " + BATCHES + "/9/export"] = { text: "Title,First name,Last name,House name/number,Postcode,Donation date,Amount\r\n" };
      await open();
      await press(q('[data-export-batch="9"]'));
      expect(clicked).toEqual([]);
      expect(text(batchSays(9))).toBe("Batch 9 has no donations that can go in the file, so no file was made.");
    });
  });

  describe("the donations in a batch", () => {
    const inside = (id: number, over: Record<string, unknown> = {}) => ({
      id, donor_id: 200 + id, donor_name: "Morag Example " + id, amount_pence: 2000, refunded_amount_pence: 0,
      postcode: "KA3 3CC", created_at: "2026-10-20T10:00:00.000Z", claim_status: "batched", ...over,
    });

    it("opens them in place the first time the batch's button is pressed", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 2 })]);
      answers["GET " + BATCHES + "/9/donations"] = list([inside(31), inside(32, { refunded_amount_pence: 500 })]);
      const screen = await open();
      const toggle = q('[data-batch-open="9"]') as HTMLElement;
      expect(text(toggle)).toBe("See the 2 donations");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await press(toggle);
      expect(screen.calls.filter((c) => c.path === BATCHES + "/9/donations").length).toBe(1);
      const now = q('[data-batch-open="9"]') as HTMLElement;
      expect(now.getAttribute("aria-expanded")).toBe("true");
      const body = el(now.getAttribute("aria-controls") as string);
      expect(body.hidden).toBe(false);
      expect(text(body)).toContain("Morag Example 31");
      expect(text(body)).toContain("£20");
      expect(text(body)).toContain("20 October 2026");
      expect(text(body)).toContain("£5 of it refunded");
      expect(q('[data-batch="9"] [data-donor="231"]')).not.toBeNull();
    });

    it("has nothing in it that takes a donation out or deletes the batch", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 1 })]);
      answers["GET " + BATCHES + "/9/donations"] = list([inside(31)]);
      await open();
      await press(q('[data-batch-open="9"]'));
      const words = qa('[data-batch="9"] button').map((b) => text(b).toLowerCase());
      expect(words.some((w) => w.includes("remove") || w.includes("delete") || w.includes("take out"))).toBe(false);
    });

    it("folds them away again without asking the server twice", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 1 })]);
      answers["GET " + BATCHES + "/9/donations"] = list([inside(31)]);
      const screen = await open();
      await press(q('[data-batch-open="9"]'));
      await press(q('[data-batch-open="9"]'));
      const toggle = q('[data-batch-open="9"]') as HTMLElement;
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(el(toggle.getAttribute("aria-controls") as string).hidden).toBe(true);
      await press(q('[data-batch-open="9"]'));
      expect(screen.calls.filter((c) => c.path === BATCHES + "/9/donations").length).toBe(1);
    });

    it("says they could not be loaded when the server fails", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 1 })]);
      answers["GET " + BATCHES + "/9/donations"] = DOWN;
      await open();
      await press(q('[data-batch-open="9"]'));
      const toggle = q('[data-batch-open="9"]') as HTMLElement;
      expect(text(el(toggle.getAttribute("aria-controls") as string))).toBe("The donations in this batch could not be loaded.");
    });

    it("has no button to open a batch with nothing in it, and says it is empty", async () => {
      answers["GET " + BATCHES] = list([batch(9, { donation_count: 0, total_pence: 0 })]);
      await open();
      expect(q('[data-batch-open="9"]')).toBeNull();
      expect(text(batchCard(9))).toContain("No donations in it yet");
    });
  });

  it("says there are none, and says so differently when they could not be loaded", async () => {
    await open();
    expect(text(el("batchesTable"))).toBe("No claim batches.");
    answers["GET " + BATCHES] = DOWN;
    await open();
    expect(text(el("batchesTable"))).toBe("Claim batches are unavailable.");
  });
});

describe("Claims: to repay", () => {
  it("lists each refunded donation with its figures and a reason in plain words", async () => {
    answers["GET " + ADJUST] = list([adjustment(55)]);
    await open();
    const row = q("#adjustmentTable tbody tr") as HTMLElement;
    expect(text(row)).toContain("Isla Example");
    expect(text(row)).toContain("£50");
    expect(text(row)).toContain("The donation was refunded");
    expect(text(row)).not.toContain("charge.refunded");
    expect(text(row)).toContain("Batch 4");
    expect(text(row)).toContain("55");
    expect(q('#adjustmentTable [data-donor="355"]')).not.toBeNull();
    expect(qa("#adjustmentTable thead th").map((th) => text(th))).toEqual(["Donor", "Amount", "Adjustment", "Reason", "Claimed in", "Donation"]);
  });

  it("is a card per row on a phone, each cell named from its column", async () => {
    answers["GET " + ADJUST] = list([adjustment(55)]);
    await open();
    expect((q("#adjustmentTable table") as HTMLElement).classList.contains("ak-cards")).toBe(true);
    expect(qa("#adjustmentTable tbody td").map((td) => td.getAttribute("data-label"))).toContain("Adjustment");
  });

  it("keeps a reason it has no plain words for as it came", async () => {
    answers["GET " + ADJUST] = list([adjustment(55, { adjustment_reason: "Typed by hand" })]);
    await open();
    expect(text(q("#adjustmentTable tbody tr"))).toContain("Typed by hand");
  });

  it("does not change what the explanation of the adjustment box claims", async () => {
    await open();
    const help = text(q('#claimsParts [data-akpart-body="repay"] .admin-help'));
    expect(help).toContain("Enter each amount in the adjustment box on your next Charities Online claim so HMRC reclaims the overpaid tax; no separate payment is needed.");
  });

  it("says there are none, and says so differently when they could not be loaded", async () => {
    await open();
    expect(text(el("adjustmentTable"))).toBe("No adjustments due.");
    answers["GET " + ADJUST] = DOWN;
    await open();
    expect(text(el("adjustmentTable"))).toBe("Adjustments are unavailable.");
  });
});

describe("Claims: the declarations the Overview sends people here for", () => {
  it("lists the declarations that have not come back, without the link's secret", async () => {
    answers["GET " + AWAITING] = list([
      { id: 71, donor_id: 9, donor_name: "Fergus Example", donor_email: "fergus@example.com", declaration_status: "sent", declaration_token: "tok-invented-secret", amount_pence: 4000, created_at: "2026-10-28T10:00:00.000Z" },
      { id: 72, donor_id: 10, donor_name: "Ailsa Example", donor_email: null, declaration_status: "undelivered", declaration_token: "tok-other", amount_pence: 1000, created_at: "2026-10-29T10:00:00.000Z" },
    ]);
    await open();
    const rows = qa("#claimsAwaiting tbody tr");
    expect(text(rows[0])).toContain("Fergus Example");
    expect(text(rows[0])).toContain("fergus@example.com");
    expect(text(rows[0])).toContain("Sent, not yet confirmed");
    expect(text(rows[0])).toContain("£40");
    expect(text(rows[0])).toContain("28 October 2026");
    expect(text(rows[1])).toContain("Could not be delivered");
    expect(text(rows[1])).not.toContain("undelivered");
    expect(el("claimsAwaiting").innerHTML).not.toContain("tok-invented-secret");
    expect(q('#claimsAwaiting [data-donor="9"]')).not.toBeNull();
  });

  it("lists the declarations due a review, with when each was made and since when it has been due", async () => {
    answers["GET " + REVIEW] = list([
      { id: 5, donor_id: 12, first_name: "Catriona", last_name: "Example", createdAt: "2024-03-04T10:00:00.000Z", reviewDueSince: "2026-03-04T10:00:00.000Z" },
    ]);
    await open();
    const row = text(q("#claimsReview tbody tr"));
    expect(row).toContain("Catriona Example");
    expect(row).toContain("4 March 2024");
    expect(row).toContain("4 March 2026");
    expect(q('#claimsReview [data-donor="12"]')).not.toBeNull();
  });

  it("lists the records reaching the end of their keep date, in plain words", async () => {
    answers["GET " + KEEP] = list([
      { id: 6, donor_id: 13, first_name: "Hamish", last_name: "Example", scope: "all_donations", retentionExpiry: "2026-04-05T00:00:00.000Z", flag: "expired" },
      { id: 7, donor_id: 14, first_name: "Eilidh", last_name: "Example", scope: "this_donation", retentionExpiry: "2027-04-05T00:00:00.000Z", flag: "expiring" },
    ]);
    await open();
    const rows = qa("#claimsKeep tbody tr").map((r) => text(r));
    expect(rows[0]).toContain("Hamish Example");
    expect(rows[0]).toContain("5 April 2026");
    expect(rows[0]).toContain("Keep date has passed");
    expect(rows[0]).toContain("Every donation they make");
    expect(rows[1]).toContain("5 April 2027");
    expect(rows[1]).toContain("Within six months");
    expect(rows[1]).toContain("One donation");
    expect(rows.join(" ")).not.toContain("expiring");
    expect(rows.join(" ")).not.toContain("all_donations");
  });

  it("says when a list has nothing in it", async () => {
    await open();
    expect(text(el("claimsAwaiting"))).toBe("No declarations are waiting to come back.");
    expect(text(el("claimsReview"))).toBe("No declarations are due a review.");
    expect(text(el("claimsKeep"))).toBe("No records are near the end of their keep date.");
  });

  it("says when a list could not be loaded, rather than that it is empty", async () => {
    answers["GET " + AWAITING] = DOWN;
    answers["GET " + REVIEW] = DOWN;
    answers["GET " + KEEP] = DOWN;
    await open();
    expect(text(el("claimsAwaiting"))).toBe("Declarations that have not come back are unavailable.");
    expect(text(el("claimsReview"))).toBe("Declarations due a review are unavailable.");
    expect(text(el("claimsKeep"))).toBe("Records near the end of their keep date are unavailable.");
  });
});

describe("Claims: nothing is said in a pop-up", () => {
  it("never calls alert, whatever is pressed", async () => {
    answers["GET " + ELIGIBLE] = list([ready(1)]);
    answers["GET " + BATCHES] = list([batch(9)]);
    answers["POST " + BATCHES + "/9/submit"] = DOWN;
    answers["GET " + BATCHES + "/9/export"] = DOWN;
    await open();
    await press(el("assignBtn"));
    await press(q('[data-submit-batch="9"]'));
    await press(q('[data-export-batch="9"]'));
    expect(alerts).toEqual([]);
  });
});
