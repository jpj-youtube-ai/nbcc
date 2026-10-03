import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { fundraiserEventRecord, renderFundraiserCard, renderFundraiserPage, type FundraiserPageOptions } from "../../src/fundraising/render";
import { renderMemoryPage } from "../../src/fundraising/memory-render";
import { renderCard } from "../../src/events/render";
import { ALL_TO_NBCC, meter, publicCard, type FundraiserRecord, type PublicPage } from "../../src/fundraising/model";

// Clarity audit (Jaimie, 2026-10-03), items 3, 5 and 8: what the give box says on a page raising
// money, a team page and a team member's page, so nobody thinks a gift is split with another cause,
// sponsors the same person twice (online and on paper), or misses that a team's total is everyone's.
// Events and pages in memory of someone keep their own words. Every name here is invented.

const ROOT = resolve(__dirname, "../..");
const template = readFileSync(resolve(ROOT, "fundraiser.html"), "utf8");
const STATEMENT = "60% of what we raise goes to the Night Before Christmas Campaign, Scottish Charity SC047995. The rest goes to Kilmarnock Food Larder.";
const SPLIT = { nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder", statement: STATEMENT };

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
  split: null,
  ...over,
});

const OPTS: FundraiserPageOptions = { pageUrl: "https://nbcc.test/fundraise/robins-santa-dash", now: new Date(Date.UTC(2026, 9, 2)) };
const doc = (p: PublicPage, opts: Partial<FundraiserPageOptions> = {}) =>
  new JSDOM(renderFundraiserPage(template, p, { ...OPTS, ...opts })).window.document;
/** The lines of the give box, above the form. */
const giveLines = (d: Document) => [...d.querySelectorAll(".fr-give .give-main > .give-step-sub")].map((e) => e.textContent);
const MEMBER = { team: { factsHtml: '<p class="fr-team-of">Part of the team <a href="/fundraise/ej">Exampleton Juniors</a></p>' } };
const TEAM = { teamName: "Exampleton Juniors", title: "Exampleton Juniors", organisedBy: "Robin Q." };

describe("shared with another cause: the give box", () => {
  it("says every gift on the page is NBCC's, and who to ask about the other cause", () => {
    expect(giveLines(doc(page({ split: SPLIT })))).toContain(
      "Everything you give on this page goes to NBCC. Robin is collecting Kilmarnock Food Larder's share separately, so if you'd like to support Kilmarnock Food Larder too, please ask Robin how.",
    );
  });

  it("no longer says \"as NBCC's share\"", () => {
    expect(renderFundraiserPage(template, page({ split: SPLIT }), OPTS)).not.toContain("as NBCC's share");
  });

  it("says it on a finished page too", () => {
    expect(giveLines(doc(page({ split: SPLIT, finished: true }))).join(" ")).toContain("Robin is collecting Kilmarnock Food Larder's share separately");
  });

  it("names the team on a team page", () => {
    expect(giveLines(doc(page({ ...TEAM, split: SPLIT })))).toContain(
      "Everything you give on this page goes to NBCC. Exampleton Juniors is collecting Kilmarnock Food Larder's share separately, so if you'd like to support Kilmarnock Food Larder too, please ask Exampleton Juniors how.",
    );
  });

  it("says \"the organiser\" when the organiser's name is a group's, not a person's", () => {
    for (const organisedBy of ["The R.", "Anonymous", "4th E."]) {
      expect(giveLines(doc(page({ split: SPLIT, organisedBy })))).toContain(
        "Everything you give on this page goes to NBCC. The organiser is collecting Kilmarnock Food Larder's share separately, so if you'd like to support Kilmarnock Food Larder too, please ask the organiser how.",
      );
    }
  });

  it("gives a cause whose name ends in s just the apostrophe, and escapes what was typed", () => {
    const html = renderFundraiserPage(template, page({ split: { ...SPLIT, otherCauseName: "Kids & Co <Pals>" } }), OPTS);
    expect(html).toContain("Robin is collecting Kids &amp; Co &lt;Pals&gt;&#39;s share separately");
    expect(html).not.toContain("<Pals>");
    expect(giveLines(doc(page({ split: { ...SPLIT, otherCauseName: "Exampleton Friends" } }))).join(" ")).toContain("Exampleton Friends' share separately");
  });

  it("says nothing of it when the page is not shared", () => {
    const html = renderFundraiserPage(template, page(), OPTS);
    expect(html).not.toContain("Everything you give on this page");
    expect(html).not.toContain("share separately");
  });

  it("leaves an event's own line as it was", () => {
    const d = doc(page({ path: "event", booking: "door", price: "£5", split: SPLIT, organisedBy: "The Red Lion" }));
    expect(d.querySelector(".fr-give .fr-give-share")?.textContent).toBe("Everything you give on this page goes to NBCC.");
  });
});

describe("online or on paper: the give box", () => {
  const PAPER =
    "Giving here is sponsoring Robin. Already on Robin's paper sponsor form? Then please just hand Robin the money, so it isn't counted twice.";

  it("tells a sponsor already on the paper form to hand the money over instead", () => {
    expect(giveLines(doc(page()))).toContain(PAPER);
    expect(giveLines(doc(page({ finished: true })))).toContain(PAPER);
  });

  it("speaks of the team on a team page", () => {
    expect(giveLines(doc(page(TEAM)))).toContain(
      "Giving here is sponsoring the team. Already on a paper sponsor form for the team? Then please just hand the money to whoever has the form, so it isn't counted twice.",
    );
  });

  it("names the member on a member page", () => {
    expect(giveLines(doc(page(), MEMBER))).toContain(PAPER);
  });

  it("says \"the organiser\" when there is no first name to use", () => {
    expect(giveLines(doc(page({ organisedBy: "Anonymous" })))).toContain(
      "Giving here is sponsoring the organiser. Already on the organiser's paper sponsor form? Then please just hand the organiser the money, so it isn't counted twice.",
    );
  });

  it("is not on an event's page", () => {
    const html = renderFundraiserPage(template, page({ path: "event", booking: "door", price: "£5", organisedBy: "The Red Lion" }), OPTS);
    expect(html).not.toContain("paper sponsor form");
  });

  it("is not on a page in memory of someone", () => {
    const memory = page({ memory: { name: "Alex Example", dates: null, showTarget: false } as PublicPage["memory"] });
    expect(renderMemoryPage(template, memory, OPTS)).not.toContain("paper sponsor form");
  });
});

describe("teams: the give box and the meter", () => {
  it("a team page says a gift counts towards the team, and where to sponsor one person", () => {
    expect(giveLines(doc(page(TEAM)))[0]).toBe(
      "Your donation goes to NBCC and counts towards the team's total. To sponsor one person, give on their own page: you'll find everyone under The team.",
    );
  });

  it("a member page says a gift counts towards theirs and the team's", () => {
    expect(giveLines(doc(page(), MEMBER))[0]).toBe("Your donation goes to NBCC and counts towards Robin's total, and the team's total too.");
  });

  it("a page on no team says what it always did", () => {
    expect(giveLines(doc(page()))[0]).toBe("Your donation goes to NBCC and counts towards Robin's total.");
  });

  it("a team page says, under its meter, that it includes what the members raised", () => {
    const d = doc(page(TEAM));
    expect(d.querySelector(".fr-summary .fr-meter__paidin")?.textContent).toBe("Includes everything the team members have raised.");
    expect(doc(page()).querySelector(".fr-summary .fr-meter__paidin")).toBeNull();
    expect(doc(page(), MEMBER).querySelector(".fr-summary .fr-meter__paidin")).toBeNull();
  });
});

describe("shared with another cause: the cards on Get involved", () => {
  const record = (over: Partial<FundraiserRecord> = {}) =>
    ({
      id: 7, slug: "eqn", path: "event", kind: "quiz", kindLabel: "Quiz", title: "Exampleton Quiz Night", description: "Eight rounds.",
      eventDate: "2026-12-05", startTime: "19:30", venue: "Example Hall", town: "Exampleton", targetPence: null, public: true,
      status: "approved", name: "Sam Sample", imageSrc: null, cardLine: "Eight rounds and a raffle.", access: [], booking: "free",
      sharesWithOther: true, nbccSharePercent: 60, otherCauseName: "Kilmarnock Food Larder",
      ...over,
    }) as FundraiserRecord;
  const m = meter({ onlinePence: 0, cashPence: 0, targetPence: null });
  const plain = { sharesWithOther: false, nbccSharePercent: null, otherCauseName: null };

  it("the words are the ones on the posters too", () => {
    expect(ALL_TO_NBCC).toBe("Gifts made on the NBCC page all go to NBCC.");
  });

  it("a raising money card says, under the statement, that gifts on the NBCC page all go to NBCC", () => {
    const html = renderFundraiserCard(publicCard(record({ path: "raising", targetPence: 50000 }), m));
    expect(html).toContain(`<p class="fr-card__split">${STATEMENT}</p><p class="fr-card__split fr-card__split-note">${ALL_TO_NBCC}</p>`);
    expect(renderFundraiserCard(publicCard(record({ path: "raising", ...plain }), m))).not.toContain(ALL_TO_NBCC);
  });

  it("an event's card says it after the statement", () => {
    const html = renderCard(fundraiserEventRecord(publicCard(record(), m))!);
    expect(html).toContain(`${STATEMENT} ${ALL_TO_NBCC}`);
    expect(renderCard(fundraiserEventRecord(publicCard(record(plain), m))!)).not.toContain(ALL_TO_NBCC);
  });
});
