import { describe, it, expect } from "vitest";
import { ALL_TO_NBCC, meter, type FundraiserRecord } from "../../src/fundraising/model";
import {
  GIFT_AID_NBCC_PART,
  posterAddressPt,
  posterQrMm,
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
    // Review: the words can take the foot a line further: 3.8mm on the A4 and A3 design. On the
    // leaflet the room made for the split already holds most of it.
    expect(posterLogoMm(facts(), "a4")).toBe(posterLogoMm(facts(PLAIN), "a4") - 10);
    expect(posterLogoMm(facts(), "a3")).toBe(posterLogoMm(facts(PLAIN), "a3") - 10);
    expect(posterLogoMm(facts(), "a5")).toBe(posterLogoMm(facts(PLAIN), "a5") - 14);
    // With no page there are no extra words, so the room is as it was.
    expect(posterLogoMm(facts({ public: false }), "a4")).toBe(posterLogoMm(facts({ ...PLAIN, public: false }), "a4") - 6);
  });
});

// Review (PR #655): the worst cases ran the address into the foot, on main too (a long event, most of
// all on the leaflet). Measured over a grid in headless Chromium (10,368 posters: 9 title lengths, 6
// line lengths, 4 address lengths, 4 splits, 3 ways in, with and without the date, place and target,
// at A5 and A4), every one now fits, by two rules these pin:
//   - posterLogoMm is the most the logo may be; the page then gives the logo up, never the QR code or
//     the address, when the words above take more room than the sums allow for (down to 10mm);
//   - where even a 10mm logo would not do, the QR code is drawn a little smaller (posterQrMm).
describe("room on the poster, measured", () => {
  const DOOR = { path: "event" as const, booking: "door" as const, price: "£5" };
  const AWAY = {
    path: "event" as const,
    booking: "away" as const,
    price: "£12.50 adults, £6 children, under 5s free",
    ticketUrl: "https://www.a-very-long-ticket-seller-name.example.co.uk/e/1",
  };

  it("lets the logo give way, and nothing else", () => {
    const html = renderPoster(facts(), ASSETS);
    expect(html).toContain(".p-body>*{flex-shrink:0}");
    expect(html).toMatch(/\.p-logo\{[^}]*flex:0 1 auto;min-height:10mm;object-fit:contain\}/);
    expect(html).toMatch(/\.p-scan\{flex:1 0 auto;/);
    // The rule that lets the logo shrink comes after the one that stops everything else shrinking.
    expect(html.indexOf(".p-body>*{flex-shrink:0}")).toBeLessThan(html.indexOf(".p-logo{"));
  });

  it("draws the QR code at 66mm on the poster, smaller only for a shared event or a long way in", () => {
    for (const size of ["a4", "a3"] as const) {
      expect(posterQrMm(facts(PLAIN), size)).toBe(66);
      expect(posterQrMm(facts(), size)).toBe(66);
      expect(posterQrMm(facts({ ...PLAIN, ...DOOR }), size)).toBe(66);
      expect(posterQrMm(facts({ ...PLAIN, ...AWAY }), size)).toBe(62);
      expect(posterQrMm(facts(DOOR), size)).toBe(58);
      expect(posterQrMm(facts(AWAY), size)).toBe(58);
    }
  });

  it("draws it smaller on the leaflet, where the foot's words are bigger", () => {
    expect(posterQrMm(facts(PLAIN), "a5")).toBe(66);
    expect(posterQrMm(facts(), "a5")).toBe(58);
    expect(posterQrMm(facts({ ...PLAIN, ...DOOR }), "a5")).toBe(62);
    expect(posterQrMm(facts({ ...PLAIN, ...AWAY }), "a5")).toBe(56);
    expect(posterQrMm(facts(DOOR), "a5")).toBe(54);
    expect(posterQrMm(facts(AWAY), "a5")).toBe(48);
  });

  it("writes each paper's QR code size into the page", () => {
    const html = renderPoster(facts(AWAY), ASSETS, "a5");
    expect(html).toContain(".size-a5 .p-qr svg{width:48mm;height:48mm}");
    expect(html).toContain(".size-a4 .p-qr svg{width:58mm;height:58mm}");
    expect(renderPoster(facts(PLAIN), ASSETS)).toContain(".size-a4 .p-qr svg{width:66mm;height:66mm}");
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
    expect(count(html, "Pay NBCC&#39;s 60% in from your private area at nbcc.scot/fundraise/manage, then post this form to The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE,")).toBe(2);
    expect(html).not.toContain("Pay the money in from your private area");
  });

  it("a form that is not shared says neither", () => {
    const html = renderSponsorForm(facts(PLAIN), ASSETS);
    expect(html).not.toContain(GIFT_AID_NBCC_PART);
    expect(count(html, "Pay the money in from your private area at nbcc.scot/fundraise/manage, then post this form to The Elves' Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE,")).toBe(2);
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
    // Review: "In aid of" wraps from about 45 characters in ordinary letters, and from 39 in the widest
    // (capital Ws and Ms, measured), so that is where page 1 gives up the row.
    expect(sponsorRowCounts(facts({ otherCauseName: "x".repeat(39) }))).toEqual([9, 10]);
    expect(sponsorRowCounts(facts({ otherCauseName: "x".repeat(38) }))).toEqual([10, 10]);
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

  // Review: a long address (staff can set up to 60 characters) breaks inside itself, so the line is
  // never more than two lines and the heading never grows past the logo.
  it("lets a long address break, so the heading keeps its height", () => {
    expect(renderSponsorForm(facts(PLAIN), ASSETS)).toMatch(/\.sf-head \.sf-online\{[^}]*overflow-wrap:anywhere[^}]*max-width:165mm/);
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

// Review (PR #655): staff can give a page an address of up to 60 characters. At the usual size it
// wrapped onto a second and third line and pushed the address out of the frame, so a long address is
// drawn smaller and stays on one line (measured in headless Chromium).
describe("a long page address on a poster", () => {
  const withSlug = (n: number) => {
    const slug = "teadgcswsacfewmmwwmmwwabcdefghijklmnopqrstuvwxyzabmmwwmmwwmm".slice(0, n);
    const f = { id: 1, slug, path: "raising", kind: "walk", title: "Sam's Walk", description: "A walk.", eventDate: null, startTime: null, venue: "", town: "",
      targetPence: null, public: true, status: "approved", name: "Sam Example", cardLine: null } as unknown as FundraiserRecord;
    return materialFacts(f, meter({ onlinePence: 0, cashPence: 0, targetPence: null }), { pageUrl: `https://nbcc.test/fundraise/${slug}`, getInvolvedUrl: "https://nbcc.test/get-involved" });
  };

  it("is the usual size for the short addresses pages are given", () => {
    expect(posterAddressPt(withSlug(3).linkWords)).toBe(12);
    expect(posterAddressPt(withSlug(30).linkWords)).toBe(12);
    expect(renderPoster(withSlug(30), ASSETS)).toContain('<div class="p-address" style="font-size:12pt">');
  });

  it("is smaller as it grows, so it stays on one line", () => {
    expect(posterAddressPt(withSlug(45).linkWords)).toBe(10);
    expect(posterAddressPt(withSlug(60).linkWords)).toBe(8.4);
    expect(renderPoster(withSlug(60), ASSETS)).toContain('<div class="p-address" style="font-size:8.4pt">');
    expect(posterAddressPt(null)).toBe(12);
  });
});

// Review (PR #655): a page in memory of someone is untouched by this change.
describe("in memory of someone, shared with another cause", () => {
  const memory = () => facts({ inMemory: true, memoryName: "Alex Example" } as Partial<FundraiserRecord>);
  const data = (html: string) => JSON.parse(/<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "{}");

  it("the posters keep just the split statement", () => {
    expect(memory().memory?.name).toBe("Alex Example");
    for (const size of ["a4", "a3", "a5"] as const) {
      const html = renderPoster(memory(), ASSETS, size);
      expect(html).toContain(`<div class="legal split">${SPLIT}</div>`);
      expect(html).not.toContain(ALL_TO_NBCC);
    }
  });

  it("the pictures to share are handed no extra words", () => {
    expect(data(renderSocial(memory(), ASSETS, "")).split).toBe(SPLIT);
    expect(data(renderSocial(memory(), ASSETS, "")).splitNote).toBeNull();
  });

  it("the poster's logo gives up nothing more than it did", () => {
    const plain = facts({ ...PLAIN, inMemory: true, memoryName: "Alex Example" } as Partial<FundraiserRecord>);
    expect(posterLogoMm(memory(), "a4")).toBe(posterLogoMm(plain, "a4") - 6);
  });
});

// Review (PR #655): with an address of up to 60 characters the line in the sponsor form's heading ran
// to a third line and pushed the foot off the paper. A long address is drawn a little smaller there.
describe("a long page address on the sponsor form", () => {
  const withSlug = (slug: string) =>
    materialFacts(
      { id: 1, slug, path: "raising", kind: "walk", title: "Sam's Walk", description: "A walk.", eventDate: null, startTime: null, venue: "", town: "",
        targetPence: null, public: true, status: "approved", name: "Sam Example", cardLine: null } as unknown as FundraiserRecord,
      meter({ onlinePence: 0, cashPence: 0, targetPence: null }),
      { pageUrl: `https://nbcc.test/fundraise/${slug}`, getInvolvedUrl: "https://nbcc.test/get-involved" },
    );

  const sharedParts = (over: Partial<FundraiserRecord>) => {
    const d = facts(over);
    return { splitStatement: d.splitStatement, otherCauseName: d.otherCauseName, nbccSharePercent: d.nbccSharePercent };
  };

  it("draws the line at its usual size for a short address, and smaller for a long one", () => {
    expect(renderSponsorForm(withSlug("sw"), ASSETS)).toContain('<div class="sf-online">Sponsoring online instead?');
    const long = renderSponsorForm(withSlug("m".repeat(60)), ASSETS);
    expect(count(long, '<div class="sf-online is-long">Sponsoring online instead?')).toBe(2);
    expect(long).toMatch(/\.sf-head \.sf-online\.is-long\{font-size:7pt\}/);
  });

  it("still takes a third line there, so a shared form's second page gives up a row for it", () => {
    const shared = { sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder" };
    const long = { ...withSlug("m".repeat(60)), ...sharedParts(shared) };
    expect(sponsorRowCounts(long)).toEqual([10, 9]);
    expect(sponsorRowCounts({ ...withSlug("sw"), ...sharedParts(shared) })).toEqual([10, 10]);
    // A form that is not shared has the room already.
    expect(sponsorRowCounts(withSlug("m".repeat(60)))).toEqual([12, 11]);
  });
});
