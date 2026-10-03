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
    expect(posterLogoMm(shared)).toBe(posterLogoMm(plain) - 8);
  });
});
