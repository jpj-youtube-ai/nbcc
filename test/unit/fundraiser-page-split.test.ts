import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fundraiserEventRecord, renderFundraiserCard, renderFundraiserPage } from "../../src/fundraising/render";
import { renderCard } from "../../src/events/render";
import { meter, publicCard, type FundraiserRecord, type PublicPage } from "../../src/fundraising/model";

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

const SHARE_LINE = "Everything given on this page goes to NBCC, as NBCC's share.";

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

// Review fix: the hosting an event path has no page, so its card on Get involved is where the public
// sees it; a raising money card says it too, beside its way in. Built field by field by publicCard.
describe("the cards on Get involved", () => {
  const record = (over: Partial<FundraiserRecord> = {}) =>
    ({
      id: 7, slug: "eqn", path: "event", kind: "quiz", kindLabel: "Quiz", title: "Exampleton Quiz Night", description: "Eight rounds.",
      eventDate: "2026-12-05", startTime: "19:30", venue: "Example Hall", town: "Exampleton", targetPence: null, public: true,
      status: "approved", name: "Sam Sample", imageSrc: null, cardLine: "Eight rounds and a raffle.", access: [], booking: "free",
      sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder",
      ...over,
    }) as FundraiserRecord;
  const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });

  it("carry the split when it is shared, and nothing when not", () => {
    expect(publicCard(record(), m).split?.statement).toBe(STATEMENT);
    expect(publicCard(record({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }), m).split).toBeNull();
  });

  it("an event's card says the split, escaped", () => {
    const html = renderCard(fundraiserEventRecord(publicCard(record(), m))!);
    expect(html).toContain(STATEMENT);
    const odd = renderCard(fundraiserEventRecord(publicCard(record({ otherCauseName: "Kids & Co <Larder>" }), m))!);
    expect(odd).toContain("The rest goes to Kids &amp; Co &lt;Larder&gt;.");
    expect(odd).not.toContain("<Larder>");
  });

  it("an event's card not shared says what it always did", () => {
    const html = renderCard(fundraiserEventRecord(publicCard(record({ sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }), m))!);
    expect(html).toContain("A community event raising money for NBCC.");
    expect(html).not.toContain("of what we raise goes to");
  });

  it("a raising money card says the split too, escaped", () => {
    const raising = record({ path: "raising", targetPence: 50000, otherCauseName: "Kids & Co <Larder>" });
    const html = renderFundraiserCard(publicCard(raising, m));
    expect(html).toContain('<p class="fr-card__split">60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kids &amp; Co &lt;Larder&gt;.</p>');
    expect(renderFundraiserCard(publicCard({ ...raising, sharesWithOther: false, nbccSharePercent: null, otherCauseName: null }, m))).not.toContain("fr-card__split");
  });
});
