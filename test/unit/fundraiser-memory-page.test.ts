import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderMemoryPage } from "../../src/fundraising/memory-render";
import { renderFundraiserCard } from "../../src/fundraising/render";
import { meter, publicPage, wallEntries, type FundraiserRecord, type WallSourceRow } from "../../src/fundraising/model";

// In memory pages (Jaimie, 2026-10-03): the page is quieter. "In memory of <name>", the dates and a
// photo if there is one, soft colours, no countdown, no banner wishing luck, and the target and how
// close it is only if the family chose to show them. Giving works as on every page. Every message
// waits for staff, and a giver may ask to let the family know. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const TEMPLATE = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const NOW = new Date("2026-10-03T12:00:00Z");

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 9, slug: "ime", path: "raising", kind: "other", kindLabel: "Other", title: "In memory of Margaret Exampleton",
    description: "Margaret loved Christmas.\n\nWe would like to remember her by helping others.", eventDate: null, startTime: null,
    venue: "", town: "Exampleton", targetPence: 100000, public: true, status: "approved", name: "Robin Testperson", email: "robin@example.com",
    phone: "07700 900123", socialLink: null, socialOk: false, wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-09-01T10:00:00.000Z",
    approvedAt: "2026-09-02T10:00:00.000Z", approvedBy: null, updatedAt: "2026-09-02T10:00:00.000Z", updatedBy: null, cardLine: null,
    endTime: null, timeTbc: false, venueAddress: null, venuePostcode: null, access: [], price: null, booking: null, ticketUrl: null,
    ageLimit: null, dressCode: null, included: null, creditName: null, inMemory: true, memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026", memorySetupBy: "family", memoryPermission: true, memoryShowTarget: false, ...over,
  }) as FundraiserRecord;

const row = (over: Partial<WallSourceRow> = {}): WallSourceRow => ({
  donationId: 1, fullName: "Alex Example", anonymous: false, showName: true, showAmount: true, amountPence: 2500, refundedPence: 0,
  message: "Thinking of you all.", hidden: false, createdAt: "2026-10-02T10:00:00.000Z", ...over,
});

function page(over: Partial<FundraiserRecord> = {}, rows: WallSourceRow[] = [row()], opts: { thanks?: { message: boolean; sessionId?: string | null; added?: boolean } } = {}) {
  const f = record(over);
  const p = publicPage(f, meter({ onlinePence: 25000, cashPence: 0, targetPence: f.targetPence }), wallEntries(rows));
  return renderMemoryPage(TEMPLATE, p, { pageUrl: "https://nbcc.test/fundraise/ime", now: NOW, ...opts });
}

describe("an in memory page", () => {
  it("says who it remembers, with the dates", () => {
    const html = page();
    expect(html).toContain('<h1 id="fr-title">In memory of Margaret Exampleton</h1>');
    expect(html).toContain("1948 to 2026");
    expect(html).toContain("<title>In memory of Margaret Exampleton | Night Before Christmas Campaign</title>");
  });

  it("wears the quieter look", () => {
    expect(page()).toContain('class="site-main fr-memory-page"');
  });

  it("shows their photo, if there is one, with words for it", () => {
    expect(page({ imageSrc: "/media/events/12" })).toContain('alt="A photo of Margaret Exampleton"');
    expect(page()).not.toContain('class="fr-memory__photo"');
  });

  it("has no countdown, no banner wishing luck, and nothing festive, even on its date", () => {
    for (const date of ["2026-10-03", "2026-10-04", "2026-10-20"]) {
      const html = page({ eventDate: date });
      expect(html).not.toContain("fr-countdown");
      expect(html).not.toContain("fr-today");
      expect(html).not.toMatch(/Good luck|Today's the day|Tomorrow!|days to go/);
    }
  });

  it("hides the target and how close it is, unless the family chose to show them", () => {
    const hidden = page();
    expect(hidden).toContain("£250");
    expect(hidden).not.toContain("£1,000");
    expect(hidden).not.toContain("fr-meter__percent");
    expect(hidden).not.toContain('role="progressbar"');
    const shown = page({ memoryShowTarget: true });
    expect(shown).toContain("£1,000");
    expect(shown).toContain('role="progressbar"');
  });

  it("takes gifts as every page does, with Gift Aid", () => {
    const html = page();
    expect(html).toContain('id="frGiveForm"');
    expect(html).toContain('data-fundraiser-id="9"');
    expect(html).toContain("Give in memory of Margaret Exampleton");
    expect(html).toContain('id="frGiftAid"');
    expect(html).toContain("embeddedCheckoutModal");
  });

  it("shows gifts and only the messages staff have approved", () => {
    const html = page({}, [row({ donationId: 1, message: "Waiting words", held: true }), row({ donationId: 2, message: "Approved words", held: false })]);
    expect(html).toContain("Gifts and messages");
    expect(html).toContain("Approved words");
    expect(html).not.toContain("Waiting words");
  });

  it("after giving, asks for a message gently, saying staff read each one, and offers to let the family know, unticked", () => {
    const html = page({}, [], { thanks: { message: false, sessionId: "cs_test_abc" } });
    expect(html).toContain('id="frFamilyNotify"');
    expect(html).not.toMatch(/id="frFamilyNotify"[^>]*checked/);
    expect(html).toContain("Let the family know I gave");
    expect(html).toContain("never how much you gave");
    expect(html).toContain("Our team reads every message before it goes on the page.");
  });

  it("after adding a message, says it will show once checked", () => {
    expect(page({}, [], { thanks: { message: false, added: true } })).toContain("Our team will read your message");
  });

  it("escapes what was typed", () => {
    const html = page({ memoryName: "<script>x</script>", memoryDates: "<b>1948</b>" });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<b>1948</b>");
  });

  it("never says families", () => {
    expect(page({}, [row()], { thanks: { message: false, sessionId: "cs_test_abc" } }).toLowerCase()).not.toContain("families");
  });
});

describe("an in memory page's card on Get involved", () => {
  it("says In memory, quietly, and hides the target unless chosen", () => {
    const f = record();
    const card = publicPage(f, meter({ onlinePence: 25000, cashPence: 0, targetPence: 100000 }), []);
    const html = renderFundraiserCard(card, "2026-10-03");
    expect(html).toContain("ev-card--memory");
    expect(html).toContain("In memory of Margaret Exampleton");
    expect(html).not.toContain('<p class="ev-flag fr-flag">Fundraiser</p>');
    expect(html).not.toContain("£1,000");
  });
});

describe("review: amounts stay private", () => {
  it("starts Show how much I gave unticked on an in memory page", () => {
    const html = page({}, [], { thanks: { message: false, sessionId: "cs_test_abc" } });
    expect(html).toMatch(/id="frShowAmount"/);
    expect(html).not.toMatch(/id="frShowAmount"[^>]*checked/);
    expect(html).toContain("If you tick this, we won’t show how much you gave on the page.");
  });

  it("dates each gift on the wall by its day, not how long ago", () => {
    const html = page({}, [row({ createdAt: "2026-10-02T10:15:00.000Z" })]);
    expect(html).toContain('<time datetime="2026-10-02">2 October 2026</time>');
    expect(html).not.toContain("hours ago");
  });
});

describe("audit: sharing names NBCC", () => {
  it("shares as In memory of <name>, giving to the Night Before Christmas Campaign (NBCC)", () => {
    const html = page();
    const text = encodeURIComponent("In memory of Margaret Exampleton, giving to the Night Before Christmas Campaign (NBCC): https://nbcc.test/fundraise/ime");
    expect(html).toContain(`https://wa.me/?text=${text}`);
  });
});
