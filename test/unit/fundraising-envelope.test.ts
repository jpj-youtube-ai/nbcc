import { describe, it, expect } from "vitest";
import { ENVELOPE_DECLARATION, ENVELOPE_PAPER, envelopeFacts, renderEnvelope } from "../../src/fundraising/envelope";
import { materialAssets } from "../../src/fundraising/materials";
import { SINGLE_DONATION_WORDING } from "../../src/declarations/wording";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";
import type { FundraiserRecord } from "../../src/fundraising/model";
import { escapeHtml } from "../../src/events/render";

// In memory pages (Jaimie, 2026-10-03): funeral collection envelopes, printed from the admin and from
// the organiser's private area. A DL envelope (110 x 220mm, the common size for collection and Gift
// Aid envelopes), printed on its front: "In memory of <name>", the dates, the QR code to the page,
// a Gift Aid declaration for a single gift (HMRC's model, with the same liability sentence as the
// give form's), the boxes HMRC needs (name, home address, postcode), a tick box, and NBCC's charity
// statement word for word. Every name here is invented.

const record = (over: Partial<FundraiserRecord> = {}): FundraiserRecord =>
  ({
    id: 9, slug: "ime", path: "raising", kind: "other", title: "In memory of Margaret Exampleton", description: "", eventDate: null,
    startTime: null, venue: "", town: "", targetPence: null, public: true, status: "approved", name: "Sam Sample", email: "sam@example.com",
    phone: "07700 900456", socialLink: null, socialOk: false, wants: { posterCount: 0, leafletCount: 0, bucketCount: 0, tinCount: 0, leaflets: 0, buckets: 0, shoutOut: false, attend: false },
    postAddress: null, newsletterOk: false, imageSrc: null, declinedReason: null, createdAt: "2026-10-02T10:00:00.000Z", approvedAt: null,
    approvedBy: null, updatedAt: "2026-10-02T10:00:00.000Z", updatedBy: null, inMemory: true, memoryName: "Margaret Exampleton",
    memoryDates: "1948 to 2026", memorySetupBy: "family", memoryPermission: true, ...over,
  }) as FundraiserRecord;

const urls = { pageUrl: "https://nbcc.test/fundraise/ime" };

describe("the Gift Aid declaration on the envelope", () => {
  it("is HMRC's model declaration for a single gift, with an amount, and the give form's liability sentence", () => {
    expect(ENVELOPE_DECLARATION).toMatch(/^I want to Gift Aid my donation of £_+ to the Night Before Christmas Campaign\. /);
    const liability = SINGLE_DONATION_WORDING.wording_snapshot.slice(SINGLE_DONATION_WORDING.wording_snapshot.indexOf("I am a UK taxpayer"));
    expect(ENVELOPE_DECLARATION.endsWith(liability)).toBe(true);
  });
});

describe("the envelope", () => {
  const facts = envelopeFacts(record(), urls);
  const html = renderEnvelope(facts, materialAssets());

  it("is a DL envelope, printed on its front, one to a page", () => {
    expect(ENVELOPE_PAPER).toEqual({ name: "DL", widthMm: 220, heightMm: 110 });
    expect(html).toContain("@page{size:220mm 110mm;margin:0}");
    expect(html).toContain("DL");
  });

  it("says who it remembers, with the dates", () => {
    expect(html).toContain("In memory of");
    expect(html).toContain("Margaret Exampleton");
    expect(html).toContain("1948 to 2026");
  });

  it("carries the QR code to the page, and the address in words", () => {
    expect(html).toMatch(/<svg[^>]*>/);
    expect(html).toContain("nbcc.test/fundraise/ime");
  });

  it("asks for everything HMRC needs, with a tick box", () => {
    expect(html).toContain(escapeHtml(ENVELOPE_DECLARATION));
    for (const box of ["Full name", "Home address", "Postcode", "Date"]) expect(html).toContain(box);
    expect(html).toContain('class="e-tick"');
    expect(html).toContain("Please tell us if you want to cancel this declaration");
  });

  it("carries NBCC's charity statement word for word", () => {
    expect(html).toContain(escapeHtml(MATERIALS_STATEMENT));
  });

  it("escapes what was typed", () => {
    const h = renderEnvelope(envelopeFacts(record({ memoryName: "<script>x</script>", memoryDates: "<b>1948</b>" }), urls), materialAssets());
    expect(h).not.toContain("<script>x</script>");
    expect(h).not.toContain("<b>1948</b>");
  });

  it("without a page to link to, has no QR code but still the declaration", () => {
    const h = renderEnvelope(envelopeFacts(record({ public: false }), urls), materialAssets());
    expect(h).not.toMatch(/<svg[^>]*role="img"/);
    expect(h).toContain("I want to Gift Aid my donation of");
  });

  it("never says families", () => {
    expect(html.toLowerCase()).not.toContain("families");
  });
});

describe("the other printed pieces of an in memory page", () => {
  it("leave the target off when the family chose to hide it", async () => {
    const { materialFacts } = await import("../../src/fundraising/materials");
    const { meter } = await import("../../src/fundraising/model");
    const m = meter({ onlinePence: 0, cashPence: 0, targetPence: 50000 });
    const u = { pageUrl: "https://nbcc.test/fundraise/ime", getInvolvedUrl: "https://nbcc.test/get-involved" };
    expect(materialFacts(record({ targetPence: 50000, memoryShowTarget: false }), m, u).targetPence).toBeNull();
    expect(materialFacts(record({ targetPence: 50000, memoryShowTarget: true }), m, u).targetPence).toBe(50000);
    expect(materialFacts(record({ targetPence: 50000, inMemory: false }), m, u).targetPence).toBe(50000);
  });
});

describe("review: how the envelopes come back to us", () => {
  it("asks the giver to seal it and hand it back, as the envelopes go to NBCC unopened", async () => {
    const { ENVELOPE_RETURN } = await import("../../src/fundraising/envelope");
    expect(ENVELOPE_RETURN).toBe("Please seal your envelope and hand it back to the person collecting. All envelopes are posted to NBCC unopened, so we can claim Gift Aid.");
    expect(renderEnvelope(envelopeFacts(record(), urls), materialAssets())).toContain(escapeHtml(ENVELOPE_RETURN));
  });

  it("tells whoever prints them to post them to us sealed, at our address, rather than paying the cash in", async () => {
    const { ENVELOPE_POST_BACK } = await import("../../src/fundraising/envelope");
    expect(ENVELOPE_POST_BACK).toBe(
      "Please post the sealed envelopes to us unopened at The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE (or hand them in), rather than paying the cash in online, so we can claim Gift Aid on them.",
    );
    expect(renderEnvelope(envelopeFacts(record(), urls), materialAssets())).toContain(escapeHtml(ENVELOPE_POST_BACK));
  });

  it("carries a small reference to the page, and the own money line by the declaration", async () => {
    const { ENVELOPE_OWN_MONEY } = await import("../../src/fundraising/envelope");
    const html = renderEnvelope(envelopeFacts(record(), urls), materialAssets());
    expect(html).toContain("Ref: ime");
    expect(ENVELOPE_OWN_MONEY).toBe("This gift is my own money. It is not from a collection, a company or a group.");
    expect(html).toContain(escapeHtml(ENVELOPE_OWN_MONEY));
    expect(html).toContain(escapeHtml(ENVELOPE_DECLARATION));
  });
});

describe("review: no certificate of thanks for an in memory page", () => {
  it("is left out of Download everything", async () => {
    const { materialFacts, renderEverything } = await import("../../src/fundraising/materials");
    const { meter } = await import("../../src/fundraising/model");
    const m = meter({ onlinePence: 1000, cashPence: 0, targetPence: null });
    const u = { pageUrl: "https://nbcc.test/fundraise/ime", getInvolvedUrl: "https://nbcc.test/get-involved" };
    const html = renderEverything(materialFacts(record({ status: "finished" }), m, u), materialAssets(), { date: "3 October 2026", script: "" });
    expect(html).not.toContain("Certificate of thanks");
    expect(html).not.toMatch(/class="page[^"]*cert/);
  });
});
