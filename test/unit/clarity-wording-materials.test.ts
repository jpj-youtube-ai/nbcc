import { describe, it, expect } from "vitest";
import { ALL_TO_NBCC, meter, type FundraiserRecord } from "../../src/fundraising/model";
import {
  GIFT_AID_NBCC_PART,
  SEND_IT_BACK,
  materialFacts,
  posterLogoMm,
  renderPoster,
  renderSocial,
  renderSponsorForm,
  sponsorRowCounts,
  type MaterialAssets,
} from "../../src/fundraising/materials";

// Clarity audit (Jaimie, 2026-10-03), items 3, 4 and 5 on the printed pieces: a shared poster says
// gifts on the NBCC page all go to NBCC; a shared sponsor form says Gift Aid is only on NBCC's part
// and that only NBCC's share is paid in; every sponsor form with a page tells someone sponsoring
// online not to add their name on paper too. Every name here, the other cause's included, is invented.

const ASSETS: MaterialAssets = { fontCss: "", logo: "data:image/png;base64,TE9HTw==", logoOnDark: "data:image/png;base64,REFSSw==" };
const SPLIT = "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder.";
const PLAIN = { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null };
const ONLINE = "Sponsoring online instead? Give on the page at nbcc.test/fundraise/ssd, and please don&#39;t add your name here as well.";

function facts(over: Partial<FundraiserRecord> = {}) {
  const f = {
    id: 12,
    slug: "ssd",
    path: "raising",
    kind: "santa_dash",
    title: "Sam's Santa Dash",
    description: "Five kilometres in a red suit.",
    eventDate: "2026-12-05",
    startTime: "10:00",
    venue: "North Inch",
    town: "Perth",
    targetPence: 50000,
    public: true,
    status: "approved",
    name: "Sam Example",
    cardLine: null,
    sharesWithOther: true,
    nbccSharePercent: 60,
    otherCauseName: "Kilmarnock Food Larder",
    ...over,
  } as FundraiserRecord;
  return materialFacts(f, meter({ onlinePence: 1000, cashPence: 0, targetPence: 50000 }), {
    pageUrl: "https://nbcc.test/fundraise/ssd",
    getInvolvedUrl: "https://nbcc.test/get-involved",
  });
}

const count = (html: string, words: string) => html.split(words).length - 1;
const pages = (html: string) => html.split('<div class="page landscape').slice(1);
const rows = (html: string, page: number) => (pages(html)[page].match(/<tr class="sf-row">/g) ?? []).length;

describe("a shared poster", () => {
  for (const size of ["a4", "a3", "a5"] as const) {
    it(`the ${size} poster says, after the split statement, that gifts on the NBCC page all go to NBCC`, () => {
      const html = renderPoster(facts(), ASSETS, size);
      expect(html).toContain(`<div class="legal split">${SPLIT} ${ALL_TO_NBCC}</div>`);
      expect(count(html, ALL_TO_NBCC)).toBe(1);
    });
  }

  it("says nothing of it when it is not shared", () => {
    expect(renderPoster(facts(PLAIN), ASSETS)).not.toContain(ALL_TO_NBCC);
  });

  it("says nothing of an NBCC page when there is no page to give on", () => {
    const html = renderPoster(facts({ public: false }), ASSETS);
    expect(html).toContain(SPLIT);
    expect(html).not.toContain(ALL_TO_NBCC);
  });

  it("gives the logo up a little more for the extra words", () => {
    expect(posterLogoMm(facts(), "a4")).toBe(posterLogoMm(facts(PLAIN), "a4") - 8);
    expect(posterLogoMm(facts(), "a3")).toBe(posterLogoMm(facts(PLAIN), "a3") - 8);
    expect(posterLogoMm(facts(), "a5")).toBe(posterLogoMm(facts(PLAIN), "a5") - 14);
    // With no page there are no extra words, so the room is as it was.
    expect(posterLogoMm(facts({ public: false }), "a4")).toBe(posterLogoMm(facts({ ...PLAIN, public: false }), "a4") - 6);
  });
});

describe("the shared pictures to share", () => {
  const data = (html: string) => JSON.parse(/<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}");

  it("hand the drawing the same words, to go after the split statement", () => {
    expect(data(renderSocial(facts(), ASSETS, "")).splitNote).toBe(ALL_TO_NBCC);
  });

  it("hand it none when it is not shared, or has no page", () => {
    expect(data(renderSocial(facts(PLAIN), ASSETS, "")).splitNote).toBeNull();
    expect(data(renderSocial(facts({ public: false }), ASSETS, "")).splitNote).toBeNull();
  });
});

describe("a shared sponsor form", () => {
  it("says, by the declaration, that Gift Aid is only on the part that comes to NBCC", () => {
    expect(GIFT_AID_NBCC_PART).toBe("NBCC can claim Gift Aid only on the part of each gift that comes to NBCC.");
    const html = renderSponsorForm(facts(), ASSETS);
    expect(count(html, GIFT_AID_NBCC_PART)).toBe(2);
    for (const page of pages(html)) {
      expect(page.indexOf(SPLIT)).toBeLessThan(page.indexOf(GIFT_AID_NBCC_PART));
      expect(page.indexOf(GIFT_AID_NBCC_PART)).toBeLessThan(page.indexOf('<p class="sf-decl"'));
    }
  });

  it("asks for NBCC's share to be paid in, by its percentage", () => {
    const html = renderSponsorForm(facts(), ASSETS);
    expect(count(html, "Pay NBCC&#39;s 60% in from your private area at nbcc.scot/fundraise/manage, then post this form to Elves Workshop")).toBe(2);
    expect(html).not.toContain("Pay the money in from your private area");
  });

  it("a form that is not shared says neither", () => {
    const html = renderSponsorForm(facts(PLAIN), ASSETS);
    expect(html).not.toContain(GIFT_AID_NBCC_PART);
    expect(count(html, "Pay the money in from your private area at nbcc.scot/fundraise/manage, then post this form to Elves Workshop")).toBe(2);
    expect(renderSponsorForm(null, ASSETS)).not.toContain(GIFT_AID_NBCC_PART);
  });
});

// Measured in headless Chromium (A4 landscape): the split statement and the Gift Aid line take two
// lines above the declaration, and a long other cause's name wraps "In aid of" onto a second line, so
// page 1 gives up rows for them and the foot and the charity statement stay on the paper.
describe("room on a shared sponsor form", () => {
  const LONG_CAUSE = "The Exampleton and District Community Larder and Warm Space for Everyone Who Needs a Hand Over the Long Winter Months UK";
  const LONG_TITLE = "The Exampleton and District Grand Christmas Sponsored Walk, Swim and Cycle for Everyone, Weatherpermitting".slice(0, 100);

  it("has ten rows on each page with a short name and a short other cause", () => {
    expect(sponsorRowCounts(facts())).toEqual([10, 10]);
    expect(rows(renderSponsorForm(facts(), ASSETS), 0)).toBe(10);
    expect(rows(renderSponsorForm(facts(), ASSETS), 1)).toBe(10);
  });

  it("has nine on page 1 when the other cause's name is long enough to wrap, or the event's name is", () => {
    expect(LONG_CAUSE.length).toBe(120);
    expect(sponsorRowCounts(facts({ otherCauseName: LONG_CAUSE }))).toEqual([9, 10]);
    expect(sponsorRowCounts(facts({ title: LONG_TITLE }))).toEqual([9, 10]);
    expect(sponsorRowCounts(facts({ title: LONG_TITLE, otherCauseName: LONG_CAUSE }))).toEqual([9, 10]);
    expect(sponsorRowCounts(facts({ otherCauseName: "A Cause of Exactly Thirty Chars" }))).toEqual([9, 10]);
    expect(sponsorRowCounts(facts({ otherCauseName: "A Cause of Thirty Characters.." }))).toEqual([10, 10]);
  });

  it("leaves a form that is not shared as it was", () => {
    expect(sponsorRowCounts(facts({ ...PLAIN, title: LONG_TITLE }))).toEqual([11, 11]);
  });
});

describe("every sponsor form", () => {
  it("asks for the form back once the money is paid in", () => {
    expect(SEND_IT_BACK).toBe("Please send this form back to us once you have paid the money in, so we can claim Gift Aid.");
    expect(count(renderSponsorForm(facts(PLAIN), ASSETS), SEND_IT_BACK)).toBe(2);
    expect(count(renderSponsorForm(null, ASSETS), SEND_IT_BACK)).toBe(2);
  });

  it("tells someone sponsoring online, at the top of both pages, not to add their name here as well", () => {
    for (const d of [facts(), facts(PLAIN)]) {
      const html = renderSponsorForm(d, ASSETS);
      expect(count(html, `<div class="sf-online">${ONLINE}</div>`)).toBe(2);
      // In the heading, beside the logo, where there is room: before the declaration and the rows.
      for (const page of pages(html)) expect(page.indexOf(ONLINE)).toBeLessThan(page.indexOf('<div class="sf-fields">'));
    }
  });

  it("says nothing of giving online when there is no page, on the blank form, or in memory of someone", () => {
    expect(renderSponsorForm(facts({ public: false }), ASSETS)).not.toContain("Sponsoring online instead?");
    expect(renderSponsorForm(null, ASSETS)).not.toContain("Sponsoring online instead?");
    const memory = facts({ ...PLAIN, inMemory: true, memoryName: "Alex Example" } as Partial<FundraiserRecord>);
    expect(memory.memory?.name).toBe("Alex Example");
    expect(renderSponsorForm(memory, ASSETS)).not.toContain("Sponsoring online instead?");
  });

  it("keeps every row it had: the line sits in the heading, beside the logo", () => {
    expect(sponsorRowCounts(facts(PLAIN))).toEqual([12, 11]);
    expect(sponsorRowCounts(null)).toEqual([12, 11]);
    expect(rows(renderSponsorForm(facts(PLAIN), ASSETS), 0)).toBe(12);
    expect(rows(renderSponsorForm(facts(PLAIN), ASSETS), 1)).toBe(11);
  });
});
