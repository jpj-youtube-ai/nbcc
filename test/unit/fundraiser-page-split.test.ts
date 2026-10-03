import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderFundraiserPage } from "../../src/fundraising/render";
import { meter, type PublicPage } from "../../src/fundraising/model";

// Jaimie, 2026-10-03: a fundraiser sharing what it raises with another cause says so on its page,
// with the statement the Charities and Benevolent Fundraising (Scotland) Regulations 2009 ask for,
// beside the Give button; and the give form says, briefly, that money given on the page is NBCC's
// share. Every name here, the other cause's included, is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const STATEMENT = "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder.";

const page = (over: Partial<PublicPage> = {}): PublicPage => ({
  id: 41,
  slug: "robins-santa-dash",
  path: "raising",
  kind: "santa_dash",
  kindLabel: "A Santa dash",
  title: "Robin's Santa Dash",
  description: "Five kilometres in a red suit.",
  eventDate: null,
  startTime: null,
  venue: "",
  town: "Exampleton",
  imageSrc: null,
  organisedBy: "Robin Q.",
  url: "/fundraise/robins-santa-dash",
  meter: meter({ onlinePence: 0, cashPence: 0, targetPence: 25000 }),
  wall: [],
  giving: { fundraiserId: 41, minimumPence: 200 },
  finished: false,
  split: { nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder", statement: STATEMENT },
  ...over,
});

const render = (p: PublicPage) =>
  renderFundraiserPage(template, p, { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(Date.UTC(2026, 9, 2)) });

const SHARE_LINE = "Donations on this page go to NBCC as our share.";

describe("a fundraiser shared with another cause", () => {
  it("says the split beside the Give button", () => {
    const html = render(page());
    const summary = html.slice(html.indexOf("fr-summary"), html.indexOf("fr-summary__give"));
    expect(summary).toContain(STATEMENT);
  });

  it("says, near the give form, that gifts here are NBCC's share", () => {
    const html = render(page());
    const give = html.slice(html.indexOf('id="give"'), html.indexOf('id="frGiveForm"'));
    expect(give).toContain(SHARE_LINE);
  });

  it("says both on a finished page too", () => {
    const html = render(page({ finished: true }));
    expect(html).toContain(STATEMENT);
    expect(html).toContain(SHARE_LINE);
  });

  it("escapes the other cause's name, as everything typed is", () => {
    const html = render(page({ split: { nbccSharePercent: 60, otherCauseName: "Kids & Co <Larder>", statement: "60% ... The rest goes to Kids & Co <Larder>." } }));
    expect(html).toContain("Kids &amp; Co &lt;Larder&gt;");
    expect(html).not.toContain("<Larder>");
  });
});

describe("a fundraiser not shared", () => {
  it("says neither", () => {
    for (const split of [null, undefined]) {
      const html = render(page({ split }));
      expect(html).not.toContain("of what we raise goes to");
      expect(html).not.toContain(SHARE_LINE);
    }
  });
});
