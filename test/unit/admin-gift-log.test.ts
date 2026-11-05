// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

// The Donations gift log (assets/js/admin/gift-log.js; Task 4 of
// docs/superpowers/plans/2026-11-05-donations-screen.md): the scoreboard's figures, the filter chips,
// the day by day cards and each card's click down, drawn into the real #view-donations of admin.html
// in jsdom. app.js reads the filters and pages the list (admin-app.test.ts, admin-red-bag.test.ts);
// this file is what gift-log.js draws from what it is handed. Every name and figure is invented.

const require = createRequire(import.meta.url);
const ROOT = resolve(__dirname, "../..");
const html = readFileSync(resolve(ROOT, "admin.html"), "utf8");
const helpers = require(resolve(ROOT, "assets/js/admin/helpers.js"));
const GiftLog = require(resolve(ROOT, "assets/js/admin/gift-log.js"));
const bodyHtml = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || ["", ""])[1];

type Row = Record<string, unknown>;
const gift = (over: Row = {}): Row => ({
  kind: "donation", id: 11, donor_id: 5, donor_name: "Rowan Example", donor_email: "rowan@example.com",
  mode: "once", plan: null, amount_pence: 2500, currency: "GBP", gift_aid: false, claim_status: "not_eligible",
  payment_status: "paid", payment_channel: "online", refunded_amount_pence: 0, created_at: "2026-11-05T14:34:00Z",
  source: null, invoice_id: null, elf_reference: null, elf_family_id: null, entry_pence: null, gift_pence: null,
  business_name: null, given_on_label: "Donate page", paid_by_label: null, ...over,
});
const elfRow = (over: Row = {}): Row => ({
  ...gift(), kind: "elf", id: 41, donor_id: null, donor_name: "Sam Example", amount_pence: 1500, gift_aid: true,
  source: "elf_school", elf_reference: "EDS-K4F9Q2", elf_family_id: 1234, entry_pence: 1000, gift_pence: 500,
  given_on_label: "Elf Detective School", paid_by_label: null, ...over,
});
const details = (over: Row = {}): Row => ({
  kind: "donation", id: 11, reference: "NBCC-000011", createdAt: "2026-11-05T14:34:00Z",
  gift: { amountPence: 2500, feeCoverPence: 84, totalChargedPence: 2584, currency: "GBP", mode: "once", plan: null, paymentStatus: "paid", paymentChannel: "online", source: null },
  payment: { method: "card", wallet: "apple_pay", cardBrand: "visa", cardLast4: "4242", cardCountry: "GB", checkedAt: "2026-11-05T14:35:00Z",
    stripe: { paymentIntentId: "pi_test_1", chargeId: "ch_test_1", sessionId: "cs_test_1", subscriptionId: null, dashboardUrl: "https://dashboard.stripe.com/test/payments/pi_test_1" } },
  arrival: { channel: "qr", source: null, campaign: "c12", givenOn: "/donate" },
  giftAid: { giftAid: true, claimStatus: "batched", declarationStatus: "valid", gasdsEligible: false,
    declaration: { id: 3, scope: "all", madeAt: "2026-11-05T14:33:00Z", revoked: false, revokedAt: null },
    batch: { id: 7, status: "submitted", submittedAt: "2026-11-20T10:00:00Z" } },
  refunds: { refundedPence: 0, events: [] },
  donor: { id: 5, name: "Rowan Example", email: "rowan@example.com", emailConsent: true, donorType: "individual",
    businessName: null, billingAddress: null, billingPostcode: null, otherGifts: { count: 2, totalPence: 4000 } },
  links: { fundraiser: { id: 4, title: "Sam's Santa Dash", slug: "sams-santa-dash", path: "/fundraise/sams-santa-dash" },
    pledgeId: null, invoice: null, elfFamilyId: null },
  labels: { givenOnLabel: "Sam's Santa Dash", arrivalLabel: "QR code: Donate billboard, High Street", paidByLabel: "Apple Pay (Visa ending 4242)" },
  ...over,
});

const NOW = new Date("2026-11-05T18:00:00Z"); // a Thursday
const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 4; i++) await flush(); };
const el = (id: string) => document.getElementById(id) as HTMLElement;
let log: ReturnType<typeof GiftLog.createGiftLog>;
const wrap = () => el("donationsTable");
const cards = () => Array.from(wrap().querySelectorAll<HTMLElement>(".gl-gift"));
const face = (card: Element) => card.querySelector(".gl-gift__face") as HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML = bodyHtml;
  (window as unknown as { AdminHelpers: unknown }).AdminHelpers = helpers;
  log = GiftLog.createGiftLog(document, window);
});

describe("the words for when", () => {
  it("gives the time as a person says it, in UK time", () => {
    expect(GiftLog.timeLabel("2026-11-05T14:34:00Z")).toBe("2:34pm");
    expect(GiftLog.timeLabel("2026-07-01T09:05:00Z")).toBe("10:05am"); // summer time
    expect(GiftLog.timeLabel("2026-11-05T00:07:00Z")).toBe("12:07am");
    expect(GiftLog.timeLabel("not a date")).toBe("");
  });

  it("heads each day Today, Yesterday, or by its name, in UK time", () => {
    expect(GiftLog.dayLabel("2026-11-05T09:00:00Z", NOW)).toBe("Today");
    expect(GiftLog.dayLabel("2026-11-04T23:59:00Z", NOW)).toBe("Yesterday");
    expect(GiftLog.dayLabel("2026-11-01T12:00:00Z", NOW)).toBe("Sunday 1 November");
    // After the clocks go back the UK is on GMT, so 11:30pm UTC is still the same day.
    expect(GiftLog.dayLabel("2026-10-31T23:30:00Z", NOW)).toBe("Saturday 31 October");
    // Summer time: 11:30pm UTC on 30 June is 12:30am on 1 July in the UK.
    expect(GiftLog.dayLabel("2026-06-30T23:30:00Z", NOW)).toBe("Wednesday 1 July");
    expect(GiftLog.dayLabel("2025-12-24T12:00:00Z", NOW)).toBe("Wednesday 24 December 2025");
  });
});

describe("the log", () => {
  it("groups the gifts under day headings, newest first, as they were given", () => {
    log.drawLog(wrap(), [gift({ id: 3 }), gift({ id: 2, created_at: "2026-11-05T09:00:00Z" }), gift({ id: 1, created_at: "2026-11-04T10:00:00Z" })], { now: NOW });
    const days = Array.from(wrap().querySelectorAll(".gl-day"));
    expect(days.map((d) => d.querySelector(".gl-day__head")?.textContent)).toEqual(["Today", "Yesterday"]);
    expect(days[0].querySelectorAll(".gl-gift")).toHaveLength(2);
    expect(cards().map((c) => c.getAttribute("data-id"))).toEqual(["3", "2", "1"]);
    // No table: cards, and nothing in them scrolls.
    expect(wrap().querySelector("table")).toBeNull();
  });

  it("shows the amount large, the donor, the time, where it was given and how it was paid", () => {
    log.drawLog(wrap(), [gift({ amount_pence: 1050, given_on_label: "Fill a Red Bag", paid_by_label: "Apple Pay (Visa ending 4242)" })], { now: NOW });
    const card = cards()[0];
    expect(card.querySelector(".gl-gift__amount")?.textContent).toBe("£10.50");
    expect(card.querySelector(".gl-gift__name")?.textContent).toBe("Rowan Example");
    expect(card.querySelector("time")?.textContent).toBe("2:34pm");
    expect(card.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-05T14:34:00Z");
    expect(card.querySelector(".gl-badge--place")?.textContent).toBe("Fill a Red Bag");
    expect(card.querySelector(".gl-badge--pay")?.textContent).toBe("Apple Pay (Visa ending 4242)");
  });

  it("leaves out the paid by badge when it is not known", () => {
    log.drawLog(wrap(), [gift()], { now: NOW });
    expect(cards()[0].querySelector(".gl-badge--pay")).toBeNull();
  });

  it("marks monthly, Gift Aid and anything not plainly paid, in the Payment words", () => {
    log.drawLog(wrap(), [
      gift({ id: 1, mode: "monthly", plan: "silver", gift_aid: true }),
      gift({ id: 2, payment_status: "failed" }),
      gift({ id: 3, payment_status: "pending" }),
      gift({ id: 4, refunded_amount_pence: 2500 }),
      gift({ id: 5, refunded_amount_pence: 500 }),
    ], { now: NOW });
    const marks = cards().map((c) => Array.from(c.querySelectorAll(".gl-mark")).map((m) => m.textContent));
    expect(marks).toEqual([["Monthly", "Gift Aid"], ["Failed"], ["Pending"], ["Refunded"], ["Partly refunded"]]);
    expect(cards()[1].querySelector(".gl-mark.is-error")).not.toBeNull();
  });

  it("draws an Elf Detective School payment as a card too, with its reference, entry and gift", () => {
    log.drawLog(wrap(), [elfRow(), elfRow({ id: 42, elf_reference: "EDS-P9M4X1", amount_pence: 500, entry_pence: 500, gift_pence: 0 })], { now: NOW });
    const [a, b] = cards();
    expect(a.getAttribute("data-kind")).toBe("elf");
    expect(a.textContent).toContain("EDS-K4F9Q2");
    expect(a.querySelector(".gl-badge--place")?.textContent).toBe("Elf Detective School");
    expect(a.textContent).toContain("Entry £10, gift £5");
    expect(b.textContent).toContain("Entry £5");
    expect(b.textContent).not.toContain("gift £0");
  });

  it("names a business giver under the donor", () => {
    log.drawLog(wrap(), [gift({ business_name: "Bramble Cafe Ltd" })], { now: NOW });
    expect(cards()[0].querySelector(".gl-gift__meta")?.textContent).toContain("Bramble Cafe Ltd");
  });

  it("puts the New pill on the rows it is told are new", () => {
    log.drawLog(wrap(), [gift({ id: 1 }), gift({ id: 2 })], { now: NOW, isNew: (r: Row) => r.id === 1 });
    expect(cards()[0].querySelector(".admin-new-pill")).not.toBeNull();
    expect(cards()[1].querySelector(".admin-new-pill")).toBeNull();
  });

  it("says plainly when there is nothing to show", () => {
    log.drawLog(wrap(), [], { empty: "No Fill a Red Bag gifts yet." });
    expect(wrap().textContent).toBe("No Fill a Red Bag gifts yet.");
    log.drawLog(wrap(), [], {});
    expect(wrap().textContent).toBe("No donations yet.");
  });

  it("puts what it is given on the page as text, never as markup", () => {
    log.drawLog(wrap(), [gift({ donor_name: "<img src=x onerror=alert(1)>", given_on_label: "<b>x</b>" })], { now: NOW });
    expect(wrap().querySelector("img, b")).toBeNull();
    expect(cards()[0].querySelector(".gl-gift__name")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("the click down", () => {
  it("opens a gift in place, asks for its details once, and closes again", async () => {
    const ask = vi.fn(() => Promise.resolve(details()));
    log.drawLog(wrap(), [gift()], { now: NOW, details: ask });
    const button = face(cards()[0]);
    const more = el(button.getAttribute("aria-controls")!);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(more.hidden).toBe(true);
    button.click();
    await settle();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(more.hidden).toBe(false);
    expect(ask).toHaveBeenCalledWith("donation", 11);
    button.click();
    expect(more.hidden).toBe(true);
    button.click();
    await settle();
    expect(ask).toHaveBeenCalledTimes(1);
    // No pop up: it opens inside the card.
    expect(cards()[0].contains(more)).toBe(true);
    expect(document.querySelector("dialog, [role=dialog]")).toBeNull();
  });

  it("shows everything we know, in plain groups", async () => {
    log.drawLog(wrap(), [gift()], { now: NOW, details: () => Promise.resolve(details()) });
    face(cards()[0]).click();
    await settle();
    const more = cards()[0].querySelector(".gl-more") as HTMLElement;
    const heads = Array.from(more.querySelectorAll(".gl-group__head")).map((h) => h.textContent);
    expect(heads).toEqual(["The gift", "How it was paid", "Where it came from", "Gift Aid", "The donor"]);
    const fact = (name: string) =>
      Array.from(more.querySelectorAll(".gl-fact")).find((f) => f.querySelector("dt")?.textContent === name)?.querySelector("dd")?.textContent;
    expect(fact("Amount")).toBe("£25");
    expect(fact("Card fee cover")).toBe("£0.84 on top");
    expect(fact("Total charged")).toBe("£25.84");
    expect(fact("Type")).toBe("One off");
    expect(fact("Recorded")).toBe("Thursday 5 November 2026 at 2:34pm");
    expect(fact("Our reference")).toBe("NBCC-000011");
    expect(fact("Paid by")).toBe("Apple Pay (Visa ending 4242)");
    expect(fact("Card from")).toBe("United Kingdom");
    expect(fact("Given on")).toBe("Sam's Santa Dash");
    expect(fact("Came from")).toBe("QR code: Donate billboard, High Street");
    expect(fact("Giving page")).toBe("/donate");
    expect(fact("Gift Aid")).toBe("Yes, declared");
    expect(fact("Claim")).toBe("In a claim batch");
    expect(fact("Claim batch")).toBe("Batch 7, submitted 20 November 2026");
    expect(fact("Email")).toBe("rowan@example.com");
    expect(fact("Emails from us")).toBe("Yes");
    expect(fact("Other gifts")).toBe("2 more gifts from this email address, £40 in all");
    // No refunds, so no Refunds group.
    expect(more.textContent).not.toContain("Refunded");
  });

  it("offers the donor, the fundraiser's page and Stripe", async () => {
    log.drawLog(wrap(), [gift()], { now: NOW, details: () => Promise.resolve(details()) });
    face(cards()[0]).click();
    await settle();
    const more = cards()[0].querySelector(".gl-more") as HTMLElement;
    expect(more.querySelector("[data-donor]")?.getAttribute("data-donor")).toBe("5");
    expect(more.querySelector("[data-donor]")?.textContent).toBe("Open the donor");
    const links = Array.from(more.querySelectorAll<HTMLAnchorElement>("a")).map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toContainEqual(["The fundraiser's page", "/fundraise/sams-santa-dash"]);
    expect(links).toContainEqual(["See it in Stripe", "https://dashboard.stripe.com/test/payments/pi_test_1"]);
    const stripe = Array.from(more.querySelectorAll("a")).find((a) => a.textContent === "See it in Stripe")!;
    expect(stripe.getAttribute("rel")).toContain("noopener");
  });

  it("lets you open the donor straight away, before the details have come", () => {
    log.drawLog(wrap(), [gift()], { now: NOW, details: () => new Promise(() => {}) });
    face(cards()[0]).click();
    expect(cards()[0].querySelector(".gl-more [data-donor]")).not.toBeNull();
    expect(cards()[0].querySelector(".gl-more")?.textContent).toContain("Loading");
  });

  it("says when a thing was not noted, and since when we note it", async () => {
    const old = details({
      createdAt: "2026-10-02T11:00:00Z",
      arrival: { channel: null, source: null, campaign: null, givenOn: null },
      labels: { givenOnLabel: "Donate page", arrivalLabel: null, paidByLabel: null },
      payment: { method: null, wallet: null, cardBrand: null, cardLast4: null, cardCountry: null, checkedAt: "2026-11-06T09:00:00Z", stripe: { paymentIntentId: null, chargeId: null, sessionId: null, subscriptionId: null, dashboardUrl: null } },
    });
    log.drawLog(wrap(), [gift({ created_at: "2026-10-02T11:00:00Z" })], { now: NOW, details: () => Promise.resolve(old) });
    face(cards()[0]).click();
    await settle();
    const more = cards()[0].querySelector(".gl-more") as HTMLElement;
    expect(more.textContent).toContain("Not noted (we started noting this on 6 November 2026)");
    expect(more.querySelector("a[href*='stripe']")).toBeNull();
  });

  it("shows the refunds when there were some", async () => {
    const refunded = details({ refunds: { refundedPence: 1000, events: [{ at: "2026-11-07T10:00:00Z", totalRefundedPence: 1000, dispute: false }] } });
    log.drawLog(wrap(), [gift({ refunded_amount_pence: 1000 })], { now: NOW, details: () => Promise.resolve(refunded) });
    face(cards()[0]).click();
    await settle();
    const group = Array.from(cards()[0].querySelectorAll(".gl-group")).find((g) => g.querySelector(".gl-group__head")?.textContent === "Refunds")!;
    expect(group.textContent).toContain("£10 of £25");
    expect(group.textContent).toContain("7 November 2026");
  });

  it("opens an elf payment's family in Head Elf HQ, for someone who may", async () => {
    const elfDetails = {
      kind: "elf", id: 41, reference: "EDS-K4F9Q2", createdAt: "2026-11-05T14:34:00Z",
      gift: { amountPence: 1500, entryPence: 1000, giftPence: 500, feeCoverPence: 0, totalChargedPence: 1500, currency: "GBP", mode: "once", paymentStatus: "paid", paymentChannel: "online", detectives: 2 },
      payment: { stripe: { sessionId: "cs_test_9" } },
      giftAid: { giftAid: true, declaration: null },
      family: { id: 1234, name: "Sam Example", email: "sam@example.org" },
      links: { elfFamilyId: 1234 },
      labels: { givenOnLabel: "Elf Detective School", arrivalLabel: null, paidByLabel: null },
    };
    const ask = vi.fn(() => Promise.resolve(elfDetails));
    log.drawLog(wrap(), [elfRow()], { now: NOW, details: ask, canOpenElf: true });
    face(cards()[0]).click();
    await settle();
    expect(ask).toHaveBeenCalledWith("elf", 41);
    const more = cards()[0].querySelector(".gl-more") as HTMLElement;
    expect(more.querySelector("[data-elf-family]")?.getAttribute("data-elf-family")).toBe("1234");
    expect(more.querySelector("[data-elf-family]")?.textContent).toBe("Open in Head Elf HQ");
    expect(more.querySelector("[data-donor]")).toBeNull();
    expect(Array.from(more.querySelectorAll(".gl-group__head")).map((h) => h.textContent)).toEqual(["The payment", "Gift Aid", "The family"]);
    expect(more.textContent).toContain("Detectives2");

    log.drawLog(wrap(), [elfRow()], { now: NOW, details: ask, canOpenElf: false });
    face(cards()[0]).click();
    await settle();
    expect(cards()[0].querySelector("[data-elf-family]")).toBeNull();
  });

  it("says so when the details could not load, and tries again the next time", async () => {
    const ask = vi.fn().mockReturnValueOnce(Promise.reject(new Error("down"))).mockReturnValue(Promise.resolve(details()));
    log.drawLog(wrap(), [gift()], { now: NOW, details: ask });
    const button = face(cards()[0]);
    button.click();
    await settle();
    const status = cards()[0].querySelector(".gl-more .is-error");
    expect(status?.textContent).toBe("These details could not load. Close the gift and open it again to try once more.");
    expect(cards()[0].querySelector(".gl-more .err")).toBeNull();
    button.click();
    button.click();
    await settle();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(cards()[0].querySelector(".gl-more .is-error")).toBeNull();
    expect(cards()[0].querySelector(".gl-group")).not.toBeNull();
  });

  it("copes with a details answer missing its parts", async () => {
    log.drawLog(wrap(), [gift()], { now: NOW, details: () => Promise.resolve({ results: [] }) });
    face(cards()[0]).click();
    await settle();
    expect(cards()[0].querySelector(".gl-more [data-donor]")).not.toBeNull();
    expect(cards()[0].querySelector(".gl-more .is-error")).toBeNull();
  });
});

describe("the scoreboard", () => {
  const TOTALS = {
    totals: {
      redBag: { month: { pence: 41240, gifts: 19 }, all: { pence: 196000, gifts: 87 } },
      elfSchool: { month: { pence: 148600, gifts: 1 }, all: { pence: 148600, gifts: 128 } },
    },
    lines: [
      { key: "redBag", name: "Fill a Red Bag", month: "£412 from 19 gifts", all: "£1,960 from 87 gifts" },
      { key: "elfSchool", name: "Elf Detective School", month: "£1,486 from 1 payment", all: "£1,486 from 128 payments" },
      { key: "donatePage", name: "Donate page", month: "£2,130 from 64 gifts", all: "£31,400 from 902 gifts" },
      { key: "nothing", name: "Not a tile", month: "£1 from 1 gift", all: "£1 from 1 gift" },
    ],
  };
  const score = (key: string) => document.querySelector(`[data-gl-score="${key}"]`) as HTMLElement;

  it("is one tile per place, each the place's own tick box", () => {
    const tiles = Array.from(document.querySelectorAll<HTMLLabelElement>("#donationsSources .gl-tile"));
    expect(tiles.map((t) => t.querySelector(".gl-tile__name")?.textContent)).toEqual([
      "Fill a Red Bag", "Festive Ball", "Red bags at the Ball", "Invoices", "Elf Detective School", "Donate page", "Fundraiser pages", "Card reader",
    ]);
    expect(tiles.map((t) => t.querySelector("input")?.id)).toEqual([
      "donationsRedBagFilter", "donationsBallFilter", "donationsBallBagsFilter", "donationsInvoiceFilter", "donationsElfFilter",
      "donationsDonatePageFilter", "donationsFundraiserFilter", "donationsCardReaderFilter",
    ]);
    for (const t of tiles) expect(t.querySelector("input")?.type).toBe("checkbox");
  });

  it("shows this month large and all time beneath, from the server's figures and words", () => {
    expect(log.drawScores(TOTALS)).toBe(true);
    expect(score("redBag").querySelector(".gl-tile__sum")?.textContent).toBe("£412");
    expect(score("redBag").querySelector(".gl-tile__count")?.textContent).toBe("19 gifts this month");
    expect(score("redBag").querySelector(".gl-tile__all")?.textContent).toBe("£1,960 from 87 gifts in all");
    expect(score("elfSchool").querySelector(".gl-tile__count")?.textContent).toBe("1 payment this month");
    // A line without its figures still says what the server said.
    expect(score("donatePage").textContent).toBe("£2,130 from 64 gifts this month£31,400 from 902 gifts in all");
    expect(score("ball").textContent).toBe("");
  });

  it("treats an answer with no lines as a failure, and can be emptied", () => {
    expect(log.drawScores({ results: [] })).toBe(false);
    log.drawScores(TOTALS);
    log.clearScores();
    expect(score("redBag").textContent).toBe("");
  });

  it("escapes what it is given", () => {
    log.drawScores({ lines: [{ key: "redBag", name: "x", month: "<img src=x>", all: "<b>y</b>" }] });
    expect(document.querySelector("#donationsSources img, #donationsSources b")).toBeNull();
  });
});

describe("the filter chips", () => {
  const box = () => el("donationsChips");
  const chips = () => Array.from(box().querySelectorAll(".gl-chip")).map((c) => c.querySelector(".gl-chip__words")?.textContent);
  const set = (id: string, value: string) => { (el(id) as HTMLInputElement).value = value; };

  it("has every filter the plan asks for, with its old ids kept", () => {
    for (const id of ["donationsSearch", "donationsFrom", "donationsTo", "donationsModeFilter", "donationsMethodFilter", "donationsCameFilter", "donationsGiftAidFilter", "donationsPaymentFilter", "donationsClaimFilter"]) {
      expect(el(id), id).not.toBeNull();
    }
    const values = (id: string) => Array.from((el(id) as HTMLSelectElement).options).map((o) => o.value);
    expect(values("donationsMethodFilter")).toEqual(["", "card", "apple_pay", "google_pay", "bacs_debit", "bank_transfer", "card_present"]);
    expect(values("donationsCameFilter")).toEqual(["", "qr", "email", "newsletter", "social", "search", "other_websites", "direct", "site", "unknown"]);
    expect(values("donationsGiftAidFilter")).toEqual(["", "yes", "no"]);
    expect(values("donationsPaymentFilter")).toEqual(["", "paid", "pending", "failed", "refunded"]);
    expect(values("donationsClaimFilter")).toEqual(["", "eligible", "batched", "claimed", "not_eligible"]);
  });

  it("shows nothing while no filter is on", () => {
    log.drawChips(box());
    expect(box().hidden).toBe(true);
  });

  it("shows each filter that is on as a chip, in plain words", () => {
    set("donationsSearch", "  rowan ");
    set("donationsFrom", "2026-11-01");
    set("donationsMethodFilter", "apple_pay");
    set("donationsCameFilter", "qr");
    (el("donationsRedBagFilter") as HTMLInputElement).checked = true;
    log.drawChips(box());
    expect(box().hidden).toBe(false);
    expect(chips()).toEqual(["Given on: Fill a Red Bag", "Name or email: rowan", "From 1 November 2026", "Paid by: Apple Pay", "Came from: QR code"]);
    expect(box().querySelector(".gl-chip__x")?.getAttribute("aria-label")).toBe("Remove Given on: Fill a Red Bag");
  });

  it("takes a filter off with its cross, as a person would, and the list is read again", () => {
    set("donationsMethodFilter", "apple_pay");
    set("donationsCameFilter", "qr");
    log.drawChips(box());
    const changed = vi.fn();
    el("donationsMethodFilter").addEventListener("change", changed);
    (box().querySelector(".gl-chip__x") as HTMLButtonElement).click();
    expect((el("donationsMethodFilter") as HTMLSelectElement).value).toBe("");
    expect((el("donationsCameFilter") as HTMLSelectElement).value).toBe("qr");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("clears every filter at once, reading the list again once", () => {
    set("donationsMethodFilter", "apple_pay");
    set("donationsTo", "2026-11-05");
    (el("donationsElfFilter") as HTMLInputElement).checked = true;
    log.drawChips(box());
    const changed = vi.fn();
    el("view-donations").addEventListener("change", changed);
    const clear = Array.from(box().querySelectorAll("button")).find((b) => b.textContent === "Clear all") as HTMLButtonElement;
    clear.click();
    expect((el("donationsMethodFilter") as HTMLSelectElement).value).toBe("");
    expect((el("donationsTo") as HTMLInputElement).value).toBe("");
    expect((el("donationsElfFilter") as HTMLInputElement).checked).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("its stylesheet", () => {
  const CSS = readFileSync(resolve(ROOT, "assets/css/admin-donations.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = (css: string) => {
    const out: { at: string; selector: string; body: string }[] = [];
    let i = 0;
    const walk = (at: string, end: number) => {
      while (i < end) {
        const open = css.indexOf("{", i);
        if (open < 0 || open >= end) break;
        const head = css.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === "{") depth++;
          else if (css[j] === "}") depth--;
          j++;
        }
        if (/^@(media|supports|container)/.test(head)) {
          i = open + 1;
          walk(head, j - 1);
          i = j;
        } else {
          out.push({ at, selector: head, body: css.slice(open + 1, j - 1) });
          i = j;
        }
      }
    };
    walk("", css.length);
    return out;
  };
  const all = blocks(CSS);

  it("is linked after the admin's own stylesheet", () => {
    expect(html).toContain('<link rel="stylesheet" href="/assets/css/admin-donations.css" />');
    expect(html.indexOf("admin-donations.css")).toBeGreaterThan(html.indexOf("/assets/css/admin.css"));
    expect(html).toContain('<script defer src="/assets/js/admin/gift-log.js"></script>');
  });

  it("names only its own pieces", () => {
    for (const r of all) {
      if (r.selector.startsWith("@keyframes")) continue;
      for (const s of r.selector.split(",").map((x) => x.trim())) {
        expect(s.startsWith(".gl-") || s.startsWith("#view-donations"), s).toBe(true);
      }
    }
  });

  it("never needs !important, never scrolls inside a box, and has no side stripes or gradient text", () => {
    expect(CSS).not.toMatch(/!important/);
    expect(CSS).not.toMatch(/overflow(-[xy])?\s*:\s*(auto|scroll)/);
    expect(CSS).not.toMatch(/border-(left|right)\s*:\s*([2-9]|\d{2,}|[1-9]\.\d)/);
    expect(CSS).not.toMatch(/background-clip\s*:\s*text/);
  });

  it("moves only for someone happy with motion, and only by transform and opacity", () => {
    for (const r of all.filter((x) => /(^|;|\s)(animation|transition)\s*:/.test(x.body))) {
      expect(r.at, r.selector).toMatch(/prefers-reduced-motion:\s*no-preference/);
      const moved = /(?:^|;|\s)transition\s*:\s*([^;]+)/.exec(r.body)?.[1];
      if (moved) for (const part of moved.split(",")) expect(part.trim().split(/\s+/)[0], r.selector).toMatch(/^(transform|opacity|background-color|box-shadow)$/);
    }
    for (const f of all.filter((r) => r.selector.startsWith("@keyframes"))) {
      expect(f.at).toMatch(/prefers-reduced-motion:\s*no-preference/);
      for (const p of [...f.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1])) expect(["transform", "opacity"]).toContain(p);
    }
  });

  it("draws in Head Elf HQ's colours, with a deep maroon ink rather than black", () => {
    expect(CSS).toContain("--gl-ink: #3A0B0B");
    expect(CSS).toContain("--gl-maroon: #800000");
    expect(CSS).not.toMatch(/#000(000)?\b/i);
  });

  it("lays the log out by its own width", () => {
    expect(CSS).toMatch(/container-type:\s*inline-size/);
    expect(all.some((r) => r.at.startsWith("@container"))).toBe(true);
  });
});
