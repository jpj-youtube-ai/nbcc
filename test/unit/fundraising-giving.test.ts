import { describe, it, expect } from "vitest";
import {
  giftAidPence,
  giftAidOnGifts,
  hasPage,
  isListed,
  isCheckoutSessionId,
  meter,
  publicPage,
  wallEntries,
  wallMessageSchema,
  wallStepVerdict,
  type FundraiserRecord,
  type GiftForSession,
  type WallSourceRow,
} from "../../src/fundraising/model";
import { renderFundraiserCard, renderFundraiserPage, renderMeter } from "../../src/fundraising/render";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// TASK-502: giving on a fundraiser's page. Gift Aid shown (never counted), the message added after
// paying, and finished pages that still take gifts. Pure rules and the drawn page, no database.
// Every name, address and number here is invented.

const row = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 1,
  fullName: "Alex Example",
  anonymous: false,
  showName: true,
  showAmount: true,
  amountPence: 2000,
  refundedPence: 0,
  message: null,
  hidden: false,
  createdAt: "2026-10-01T10:00:00.000Z",
  giftAid: false,
  ...over,
});

describe("the Gift Aid on one gift", () => {
  it("is a quarter of the gift, the basic rate value", () => {
    expect(giftAidPence(2000)).toBe(500);
    expect(giftAidPence(10000)).toBe(2500);
  });

  it("is rounded down to whole pence, so it is never overstated", () => {
    expect(giftAidPence(2550)).toBe(637);
    expect(giftAidPence(201)).toBe(50);
    expect(giftAidPence(3)).toBe(0);
  });

  it("is nothing for nothing, or for a negative", () => {
    expect(giftAidPence(0)).toBe(0);
    expect(giftAidPence(-400)).toBe(0);
  });
});

describe("the Gift Aid under the meter", () => {
  it("adds up the gifts that claimed it, on what is left after any refund", () => {
    const rows = [
      row({ donationId: 1, amountPence: 2000, giftAid: true }),
      row({ donationId: 2, amountPence: 10000, refundedPence: 4000, giftAid: true }),
      row({ donationId: 3, amountPence: 5000, giftAid: false }),
    ];
    expect(giftAidOnGifts(rows)).toBe(500 + 1500);
  });

  it("leaves out a gift refunded in full", () => {
    expect(giftAidOnGifts([row({ amountPence: 2000, refundedPence: 2000, giftAid: true })])).toBe(0);
  });

  it("still counts a gift whose amount is hidden on the wall, as the raised figure does", () => {
    expect(giftAidOnGifts([row({ amountPence: 4000, showAmount: false, giftAid: true })])).toBe(1000);
  });

  it("never counts money the organiser paid in", () => {
    expect(giftAidOnGifts([row({ amountPence: 8000, giftAid: true, paidIn: true })])).toBe(0);
  });

  it("is carried on the meter, and never changes the raised figure, the target or the percentage", () => {
    const plain = meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000 });
    const withAid = meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000, giftAidPence: 4500 });
    expect(withAid.giftAidPence).toBe(4500);
    expect(plain.giftAidPence).toBe(0);
    expect({ ...withAid, giftAidPence: 0 }).toEqual(plain);
    expect(withAid.raisedPence).toBe(50000);
    expect(withAid.percent).toBe(50);
  });

  it("is never below nothing", () => {
    expect(meter({ onlinePence: 0, cashPence: 0, targetPence: null, giftAidPence: -5 }).giftAidPence).toBe(0);
  });
});

describe("the Gift Aid on the wall", () => {
  it("shows beside the amount for a gift that claimed it", () => {
    const [entry] = wallEntries([row({ amountPence: 2000, giftAid: true })]);
    expect(entry.amountPence).toBe(2000);
    expect(entry.giftAidPence).toBe(500);
  });

  it("is on what is left after a part refund", () => {
    const [entry] = wallEntries([row({ amountPence: 4000, refundedPence: 2000, giftAid: true })]);
    expect(entry.giftAidPence).toBe(500);
  });

  it("is never shown when the amount is hidden", () => {
    const [entry] = wallEntries([row({ showAmount: false, giftAid: true })]);
    expect(entry.amountPence).toBeNull();
    expect(entry.giftAidPence).toBeNull();
  });

  it("is not shown for a gift without it", () => {
    expect(wallEntries([row({ giftAid: false })])[0].giftAidPence).toBeNull();
  });

  it("is never on the wall for money paid in, which is never on the wall at all", () => {
    expect(wallEntries([row({ giftAid: true, paidIn: true })])).toEqual([]);
  });
});

describe("drawing the Gift Aid", () => {
  it("puts + £45 Gift Aid under the meter's total", () => {
    const html = renderMeter(meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000, giftAidPence: 4500 }));
    expect(html).toContain('<p class="fr-meter__giftaid">+ £45 Gift Aid</p>');
    expect(html.indexOf("fr-meter__giftaid")).toBeGreaterThan(html.indexOf("fr-meter__figures"));
  });

  it("writes pounds and pence with thousands, like £1,234.50", () => {
    const html = renderMeter(meter({ onlinePence: 900000, cashPence: 0, targetPence: null, giftAidPence: 123450 }));
    expect(html).toContain("+ £1,234.50 Gift Aid");
  });

  it("leaves the line out when there is none", () => {
    expect(renderMeter(meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000 }))).not.toContain("Gift Aid");
  });

  it("keeps the raised figure and the percentage exactly as they were", () => {
    const before = renderMeter(meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000 }));
    const after = renderMeter(meter({ onlinePence: 50000, cashPence: 0, targetPence: 100000, giftAidPence: 4500 }));
    expect(after.replace('<p class="fr-meter__giftaid">+ £45 Gift Aid</p>', "")).toBe(before);
  });
});

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 41,
    slug: "robins-santa-dash",
    path: "raising",
    kind: "santa_dash",
    title: "Robin's Santa Dash",
    description: "Five kilometres in a red suit.",
    eventDate: null,
    startTime: null,
    venue: "",
    town: "Exampleton",
    targetPence: 25000,
    public: true,
    status: "approved",
    name: "Robin Quill",
    email: "robin.quill@example.com",
    phone: "07700 900111",
    imageSrc: null,
    access: [],
    ...over,
  }) as FundraiserRecord;

describe("a finished fundraiser", () => {
  it("keeps its page, when it had one", () => {
    expect(hasPage(record({ status: "finished" }))).toBe(true);
    expect(hasPage(record({ status: "approved" }))).toBe(true);
  });

  // Event pages: a finished public event keeps its page too (test/unit/event-pages-model.test.ts).
  it("has no page if it was never public, or was never approved", () => {
    expect(hasPage(record({ status: "finished", public: false }))).toBe(false);
    expect(hasPage(record({ status: "finished", path: "event" }))).toBe(true);
    expect(hasPage(record({ status: "new" }))).toBe(false);
    expect(hasPage(record({ status: "declined" }))).toBe(false);
  });

  it("is not listed on Get involved", () => {
    expect(isListed(record({ status: "finished" }), "2026-10-02")).toBe(false);
  });

  it("says so on its public page data", () => {
    const m = meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 });
    expect(publicPage(record({ status: "finished" }), m, []).finished).toBe(true);
    expect(publicPage(record(), m, []).finished).toBe(false);
  });
});

describe("a Stripe checkout session id", () => {
  it("looks like one of Stripe's", () => {
    expect(isCheckoutSessionId("cs_test_a1B2c3D4e5F6g7H8")).toBe(true);
    expect(isCheckoutSessionId("cs_live_a1B2c3D4e5F6g7H8")).toBe(true);
    expect(isCheckoutSessionId("cs_preview_3")).toBe(true);
  });

  it("refuses anything else, including Stripe's own unfilled placeholder", () => {
    for (const bad of ["", "{CHECKOUT_SESSION_ID}", "pi_123", "cs_", "cs_<script>", "cs_a b", `cs_${"a".repeat(300)}`]) {
      expect(isCheckoutSessionId(bad), bad).toBe(false);
    }
    expect(isCheckoutSessionId(undefined)).toBe(false);
    expect(isCheckoutSessionId(["cs_test_1"])).toBe(false);
  });
});

const gift = (over: Partial<GiftForSession> = {}): GiftForSession => ({
  donationId: 55,
  fundraiserId: 41,
  paidIn: false,
  paymentStatus: "paid",
  message: null,
  wallAddedAt: null,
  ...over,
});

describe("whether a giver may add to the wall after paying", () => {
  it("may, once, for a paid gift on this fundraiser", () => {
    expect(wallStepVerdict(gift(), 41)).toBe("ok");
  });

  it("may for a Direct Debit still settling: it only shows once it is paid", () => {
    expect(wallStepVerdict(gift({ paymentStatus: "pending" }), 41)).toBe("ok");
  });

  it("may not for a gift on another fundraiser, or one not linked to any", () => {
    expect(wallStepVerdict(gift({ fundraiserId: 42 }), 41)).toBe("not_found");
    expect(wallStepVerdict(gift({ fundraiserId: null }), 41)).toBe("not_found");
  });

  it("may not for money the organiser paid in", () => {
    expect(wallStepVerdict(gift({ paidIn: true }), 41)).toBe("paid_in");
  });

  it("may not for a payment that failed", () => {
    expect(wallStepVerdict(gift({ paymentStatus: "failed" }), 41)).toBe("unpaid");
  });

  it("may not twice, nor over a message left when paying", () => {
    expect(wallStepVerdict(gift({ wallAddedAt: "2026-10-02T10:00:00.000Z" }), 41)).toBe("already");
    expect(wallStepVerdict(gift({ message: "Go Robin" }), 41)).toBe("already");
  });

  it("knows nothing yet when the payment has not been recorded", () => {
    expect(wallStepVerdict(null, 41)).toBe("not_recorded");
  });
});

describe("what a giver sends to the wall", () => {
  const ok = { sessionId: "cs_test_a1B2c3D4", message: "  Go Robin!  ", showName: true, showAmount: false };

  it("takes a message of up to 200 characters, tidied, and the two choices", () => {
    const parsed = wallMessageSchema.parse(ok);
    expect(parsed).toEqual({ sessionId: "cs_test_a1B2c3D4", message: "Go Robin!", showName: true, showAmount: false });
  });

  it("takes no message at all, as an empty one", () => {
    expect(wallMessageSchema.parse({ ...ok, message: "   " }).message).toBe("");
    expect(wallMessageSchema.parse({ sessionId: ok.sessionId }).message).toBe("");
  });

  // Jaimie, 2026-10-02: a name stays off the wall unless the giver chooses to show it (they never saw
  // a name choice before paying). The amount still shows unless asked not to.
  it("keeps the name off unless asked, and shows the amount unless asked not to", () => {
    const parsed = wallMessageSchema.parse({ sessionId: ok.sessionId, message: "Hi" });
    expect(parsed.showName).toBe(false);
    expect(parsed.showAmount).toBe(true);
  });

  it("refuses more than 200 characters", () => {
    expect(wallMessageSchema.safeParse({ ...ok, message: "a".repeat(201) }).success).toBe(false);
  });

  it("refuses rude words, with friendly words beside the message", () => {
    const r = wallMessageSchema.safeParse({ ...ok, message: "you bastard" });
    expect(r.success).toBe(false);
    expect(r.success ? null : r.error.issues[0]).toMatchObject({
      path: ["message"],
      message: "Please choose different words for your message on the supporter wall.",
    });
  });

  it("refuses a missing or made up session", () => {
    expect(wallMessageSchema.safeParse({ ...ok, sessionId: undefined }).success).toBe(false);
    expect(wallMessageSchema.safeParse({ ...ok, sessionId: "{CHECKOUT_SESSION_ID}" }).success).toBe(false);
  });
});

// --- the page --------------------------------------------------------------------------------------

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const PAGE_URL = "https://nbcc.test/fundraise/robins-santa-dash";
const now = new Date("2026-10-02T12:00:00.000Z");

function draw(over: Partial<FundraiserRecord> = {}, rows: WallSourceRow[] = [], opts: Record<string, unknown> = {}) {
  const m = meter({ onlinePence: 30000, cashPence: 2000, targetPence: 25000, giftAidPence: 4500 });
  return renderFundraiserPage(template, publicPage(record(over), m, wallEntries(rows)), { pageUrl: PAGE_URL, now, ...opts });
}

describe("the wall, drawn", () => {
  it("shows £20 + £5 Gift Aid for a gift that claimed it", () => {
    const html = draw({}, [row({ amountPence: 2000, giftAid: true })]);
    expect(html).toContain('<span class="fr-wall__amount">£20 <span class="fr-wall__giftaid">+ £5 Gift Aid</span></span>');
  });

  it("shows just the amount without it", () => {
    const html = draw({}, [row({ amountPence: 2000 })]);
    expect(html).toContain('<span class="fr-wall__amount">£20</span>');
  });
});

describe("a fundraiser card on Get involved", () => {
  it("shows the Gift Aid under its meter too", () => {
    const m = meter({ onlinePence: 30000, cashPence: 0, targetPence: 50000, giftAidPence: 4500 });
    const html = renderFundraiserCard({ ...publicPage(record(), m, []) });
    expect(html).toContain("+ £45 Gift Aid");
  });
});

describe("the give form", () => {
  it("asks only what the donate page asks: no message, and no name or amount choices", () => {
    const html = draw();
    const form = html.slice(html.indexOf('id="frGiveForm"'), html.indexOf("</form>", html.indexOf('id="frGiveForm"')));
    expect(form).not.toContain("frMessage");
    expect(form).not.toContain("frShowName");
    expect(form).not.toContain("frShowAmount");
    for (const id of ["frOwnAmount", "frGiftAid", "frCoverFee", "frFirstName", "frSurname", "frEmail", "frEmailConsent"]) {
      expect(form, id).toContain(`id="${id}"`);
    }
  });
});

describe("a finished fundraiser's page", () => {
  it("says it has finished, with its total, and still takes gifts", () => {
    const html = draw({ status: "finished" });
    expect(html).toContain("Finished, thank you");
    expect(html).toContain("£320");
    expect(html).toContain("You can still give");
    expect(html).toContain('id="frGiveForm"');
    expect(html).toContain('aria-valuenow="100"');
  });

  it("is drawn as before while it is still going", () => {
    const html = draw();
    expect(html).not.toContain("Finished, thank you");
    expect(html).not.toContain("You can still give");
  });
});

describe("the thank you after paying", () => {
  it("offers the optional step to add to the wall, tied to the session", () => {
    const html = draw({}, [], { thanks: { message: false, sessionId: "cs_test_a1B2c3D4" } });
    expect(html).toContain("data-thanks-panel");
    expect(html).toContain("Add a message to Robin's wall");
    expect(html).toContain("(optional)");
    expect(html).toContain('data-session-id="cs_test_a1B2c3D4"');
    expect(html).toContain('data-slug="robins-santa-dash"');
    expect(html).toContain('id="frMessage"');
    expect(html).toContain('maxlength="200"');
    expect(html).toContain("Show my name");
    expect(html).toContain("Stay anonymous");
    expect(html).toContain("Show how much I gave");
    expect(html).toContain("No thanks");
    expect(html).toMatch(/id="frShowNameYes"[^>]*checked/);
    expect(html).toMatch(/id="frShowAmount"[^>]*checked/);
  });

  it("is a plain thank you without a session", () => {
    const html = draw({}, [], { thanks: { message: false } });
    expect(html).toContain("data-thanks-panel");
    expect(html).not.toContain("data-wall-step");
    expect(html).not.toContain('id="frMessage"');
  });

  it("says thank you once they have added to the wall", () => {
    const html = draw({}, [], { thanks: { message: false, added: true } });
    expect(html).toContain("We have added that to Robin's wall.");
    expect(html).toContain('href="#fr-wall-heading"');
    expect(html).not.toContain("data-wall-step");
  });

  it("never shows a giver's email or name", () => {
    const html = draw({}, [row({ fullName: "Alex Example", showName: false })], { thanks: { message: false, sessionId: "cs_test_a1B2c3D4" } });
    expect(html).not.toContain("Alex");
    expect(html).not.toContain("robin.quill@example.com");
  });
});
