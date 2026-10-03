import { describe, it, expect } from "vitest";
import { meter, type FundraiserRecord } from "../../src/fundraising/model";
import { MATERIALS_STATEMENT } from "../../src/legal/registration";
import {
  materialFacts,
  posterLogoMm,
  renderCertificate,
  renderEverything,
  renderPoster,
  renderSocial,
  renderSponsorForm,
  type MaterialAssets,
} from "../../src/fundraising/materials";

// Jaimie, 2026-10-03: a fundraiser sharing what it raises with another cause carries the statement
// the Charities and Benevolent Fundraising (Scotland) Regulations 2009 ask for, on every material
// that carries the charity statement: the posters, the leaflet, the sponsor form, the certificate and
// the pictures to share. The charity statement itself stays word for word. Every name here, the
// other cause's included, is invented.

const ASSETS: MaterialAssets = { fontCss: "", logo: "data:image/png;base64,TE9HTw==", logoOnDark: "data:image/png;base64,REFSSw==" };
const SPLIT = "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder.";
const escapedStatement = MATERIALS_STATEMENT.replace(/'/g, "&#39;");

function facts(over: Partial<FundraiserRecord> = {}) {
  const f = {
    id: 12,
    slug: "sams-santa-dash",
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

describe("the facts every piece is drawn from", () => {
  it("carry the split statement when it is shared", () => {
    expect(facts().splitStatement).toBe(SPLIT);
  });

  it("carry none when it is not, or for a sign up from before", () => {
    expect(facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }).splitStatement).toBeNull();
    expect(facts({ sharesWithOther: undefined, nbccSharePercent: undefined, otherCauseName: undefined }).splitStatement).toBeNull();
  });
});

describe("every printed piece", () => {
  for (const size of ["a4", "a3", "a5"] as const) {
    it(`the ${size} poster carries it, with the charity statement still word for word`, () => {
      const html = renderPoster(facts(), ASSETS, size);
      expect(count(html, SPLIT)).toBe(1);
      expect(count(html, escapedStatement)).toBe(1);
      // Above the charity statement, in the foot.
      expect(html.indexOf(SPLIT)).toBeLessThan(html.indexOf(escapedStatement));
    });
  }

  it("the sponsor form carries it on both pages, beside who it is in aid of", () => {
    const html = renderSponsorForm(facts(), ASSETS);
    expect(count(html, SPLIT)).toBe(2);
    expect(count(html, escapedStatement)).toBe(2);
    // Before the declaration a sponsor signs, so they read it before they give.
    expect(html.indexOf(SPLIT)).toBeLessThan(html.indexOf('<p class="sf-decl"'));
  });

  it("the sponsor form says it is in aid of both, matching the split line", () => {
    const html = renderSponsorForm(facts(), ASSETS);
    const inAid = /<span class="k">In aid of<\/span><span class="v wide">([^<]*)<\/span>/.exec(html)?.[1];
    expect(inAid).toBe("Night Before Christmas Campaign (NBCC), Scottish Charity SC047995, and Kilmarnock Food Larder");
    const escaped = renderSponsorForm(facts({ otherCauseName: "Kids & Co <Larder>" }), ASSETS);
    expect(escaped).toContain("Scottish Charity SC047995, and Kids &amp; Co &lt;Larder&gt;</span>");
    const plain = renderSponsorForm(facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }), ASSETS);
    expect(/<span class="k">In aid of<\/span><span class="v wide">([^<]*)<\/span>/.exec(plain)?.[1]).toBe(
      "Night Before Christmas Campaign (NBCC), Scottish Charity SC047995",
    );
  });

  it("the certificate carries it", () => {
    const html = renderCertificate(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", preview: false });
    expect(count(html, SPLIT)).toBe(1);
  });

  it("everything on one page carries it on every printed page", () => {
    const all = renderEverything(facts({ status: "finished" }), ASSETS, { date: "1 January 2027", script: "" });
    // The printed pages, before the pictures' data (which carries it too, for the zip).
    const html = all.slice(0, all.indexOf('<script type="application/json"'));
    expect(count(html, SPLIT)).toBe(count(html, escapedStatement));
    expect(count(html, SPLIT)).toBe(6);
  });

  it("the blank sponsor form, for anyone, carries none", () => {
    expect(renderSponsorForm(null, ASSETS)).not.toContain("of what we raise goes to");
  });

  it("nothing is added when it is not shared", () => {
    const d = facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null });
    for (const html of [renderPoster(d, ASSETS), renderSponsorForm(d, ASSETS), renderEverything(d, ASSETS, { date: "x", script: "" })]) {
      expect(html).not.toContain("of what we raise goes to");
    }
  });

  it("the other cause's name is escaped, as everything typed is", () => {
    const html = renderPoster(facts({ otherCauseName: "Kids & Co <Larder>" }), ASSETS);
    expect(html).toContain("The rest goes to Kids &amp; Co &lt;Larder&gt;.");
    expect(html).not.toContain("<Larder>");
  });
});

describe("the pictures to share", () => {
  it("hand the drawing the split statement too", () => {
    const html = renderSocial(facts(), ASSETS, "");
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json).split).toBe(SPLIT);
  });

  it("hand it nothing when it is not shared", () => {
    const html = renderSocial(facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }), ASSETS, "");
    const json = /<script type="application\/json" id="socialData">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(JSON.parse(json).split).toBeNull();
  });
});

describe("room on the poster", () => {
  it("gives the logo up a little, so the split statement fits without moving the QR code", () => {
    const shared = facts();
    const plain = facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null });
    expect(posterLogoMm(shared)).toBe(posterLogoMm(plain) - 6);
  });
});

// Review fix: everything still fits the paper in the worst case (the longest title, card line and
// other cause's name the form takes, with a date, a place and a target), so nothing is cut off or
// covers the charity statement (.page{overflow:hidden}). Checked in a real browser by printing; these
// pin the layout choices that make the room.
describe("the worst case still fits", () => {
  const WORST = {
    title: "The Exampleton and District Grand Christmas Sponsored Walk, Swim and Cycle for Everyone, Weatherpermitting".slice(0, 100),
    cardLine: "A long day of walking, swimming and cycling right round the whole of Exampleton and back again, with soup and a raffle at the end",
    venue: "The Exampleton Community Centre Main Hall",
    town: "Exampleton by the Sea",
    targetPence: 10_000_000,
    name: "Alexandra Bartholomew Example Testperson Longname",
    otherCauseName: "The Exampleton and District Community Larder and Warm Space for Everyone Who Needs a Hand Over the Long Winter Months UK",
  };
  const worst = (over: Partial<FundraiserRecord> = {}) => facts({ ...WORST, ...over });
  const plainWorst = () => worst({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null });

  it("uses the longest answers the form takes", () => {
    expect(WORST.title.length).toBe(100);
    expect(WORST.cardLine.length).toBeGreaterThan(110);
    expect(WORST.otherCauseName.length).toBe(120);
  });

  it("lets the poster's logo go smaller than its usual least when there is a split, most of all on the leaflet", () => {
    expect(posterLogoMm(plainWorst(), "a4")).toBe(40);
    expect(posterLogoMm(worst(), "a4")).toBe(34);
    expect(posterLogoMm(worst(), "a3")).toBe(34);
    expect(posterLogoMm(worst(), "a5")).toBe(28);
    expect(posterLogoMm(worst(), "a5")).toBeLessThan(38);
    // A short poster with a split still has a big logo.
    expect(posterLogoMm(facts(), "a4")).toBeGreaterThan(50);
  });

  it("draws each poster size's logo at its own height, and a slightly smaller QR code on a shared leaflet", () => {
    const html = renderEverything(worst({ status: "approved" }), ASSETS, { date: "x", script: "" });
    expect(html).toContain(".size-a5 .p-logo{height:28mm}");
    expect(html).toContain(".size-a4 .p-logo{height:34mm}");
    expect(html).toMatch(/\.size-a5\.has-split \.p-qr svg\{width:58mm;height:58mm\}/);
    expect(renderPoster(worst(), ASSETS, "a5")).toContain('class="page size-a5 poster has-split"');
    expect(renderPoster(plainWorst(), ASSETS, "a5")).toContain('class="page size-a5 poster"');
  });

  // Event clarity review: an event's poster says how to get in, a line under the target, so the logo
  // gives way to it: 8mm for a line, 6mm more for one long enough to wrap. Checked in headless
  // Chromium at A5, A4 and A3: the address stays inside the gold frame and the QR code clear of it.
  const DOOR = { path: "event" as const, booking: "door" as const, price: "£5" };
  const AWAY = {
    path: "event" as const,
    booking: "away" as const,
    price: "£12.50 adults, £6 children, under 5s free",
    ticketUrl: "https://www.a-very-long-ticket-seller-name.example.co.uk/e/1",
  };
  const plain = { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null };

  it("makes room for an event's entry line, without a split", () => {
    expect(worst({ ...DOOR, ...plain }).entry).toBe("Entry: £5, paid on the door");
    expect(posterLogoMm(worst({ ...DOOR, ...plain }), "a4")).toBe(32);
    expect(posterLogoMm(worst({ ...AWAY, ...plain }), "a4")).toBe(26);
    expect(posterLogoMm(worst({ ...AWAY, ...plain }), "a5")).toBe(26);
  });

  it("makes room for an event's entry line, with a split", () => {
    expect(posterLogoMm(worst(DOOR), "a4")).toBe(26);
    expect(posterLogoMm(worst(DOOR), "a5")).toBe(20);
    expect(posterLogoMm(worst(AWAY), "a3")).toBe(20);
    expect(posterLogoMm(worst(AWAY), "a5")).toBe(14);
  });

  it("still gives a short event's poster a big logo", () => {
    expect(posterLogoMm(facts({ ...DOOR, ...plain }), "a4")).toBe(56);
  });

  it("keeps the pledge to one smaller line when there is a split", () => {
    expect(renderPoster(worst(), ASSETS)).toMatch(/\.has-split \.p-foot \.pledge\{font-size:11pt/);
  });

  const rows = (html: string, page: number) => {
    const pages = html.split('<div class="page landscape').slice(1);
    return [...pages[page].matchAll(/<tr class="sf-row"><td class="n">(\d+)<\/td>/g)].map((m) => Number(m[1]));
  };

  it("gives the sponsor form a row less on each page for the split, and fewer on page 1 for a long name", () => {
    const html = renderSponsorForm(worst(), ASSETS);
    expect(rows(html, 0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows(html, 1)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    // A split with a short name: a row less on each page.
    expect(rows(renderSponsorForm(facts(), ASSETS), 0)).toHaveLength(11);
    expect(rows(renderSponsorForm(facts(), ASSETS), 1)).toHaveLength(10);
    const plain = renderSponsorForm(plainWorst(), ASSETS);
    expect(rows(plain, 0)).toHaveLength(11);
    expect(rows(plain, 1)).toHaveLength(11);
    // A short name and no split: the 12 and 11 rows it always had.
    const short = renderSponsorForm(facts({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }), ASSETS);
    expect(rows(short, 0)).toHaveLength(12);
    expect(rows(short, 1)).toHaveLength(11);
    expect(renderSponsorForm(null, ASSETS).match(/<tr class="sf-row">/g)).toHaveLength(23);
  });

  it("draws a long event name smaller on the sponsor form, so it wraps less", () => {
    expect(renderSponsorForm(worst(), ASSETS)).toContain('<span class="v long">');
    expect(renderSponsorForm(facts(), ASSETS)).not.toContain('<span class="v long">');
  });

  it("draws the certificate closer set when there is a split or a long name, so the statement stays inside its border", () => {
    const cert = (d: ReturnType<typeof facts>) => renderCertificate(d, ASSETS, { date: "1 January 2027", preview: false });
    expect(cert(worst({ status: "finished" }))).toContain('class="page landscape cert c-tight"');
    expect(cert(plainWorst())).toContain('class="page landscape cert c-tight"');
    expect(cert(facts({ status: "finished", sharesWithOther: false, nbccSharePercent: null, otherCauseName: null, name: "Sam Example" }))).toContain(
      'class="page landscape cert"',
    );
  });
});
