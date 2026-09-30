import { describe, it, expect } from "vitest";
import {
  periodsFor,
  splitVisits,
  buildPanels,
  countryName,
  labelNewsletters,
  newsletterIds,
  type ViewFact,
  type ClickFact,
} from "../../src/analytics/report";

// TASK-482: the arithmetic behind Admin > Analytics, from invented rows. Every visitor id, place
// and label here is made up.

let seq = 0;
function view(over: Partial<ViewFact> & { at: string }): ViewFact {
  seq += 1;
  return {
    day: over.at.slice(0, 10),
    visitor: "v" + seq,
    path: "/",
    channel: "direct",
    source: null,
    campaign: null,
    country: null,
    region: null,
    city: null,
    device: "computer",
    browser: "Chrome",
    activeSeconds: null,
    maxScroll: null,
    ...over,
  };
}

const PERIOD = { from: "2026-09-01", to: "2026-09-03" };

describe("periodsFor", () => {
  it("covers the last N UK days including today, and the same length just before", () => {
    expect(periodsFor("2026-10-01", 7)).toEqual({
      current: { from: "2026-09-25", to: "2026-10-01" },
      previous: { from: "2026-09-18", to: "2026-09-24" },
    });
  });

  it("crosses month and year ends", () => {
    expect(periodsFor("2026-01-15", 30)).toEqual({
      current: { from: "2025-12-17", to: "2026-01-15" },
      previous: { from: "2025-11-17", to: "2025-12-16" },
    });
  });
});

describe("splitVisits", () => {
  it("keeps views 30 minutes apart in one visit and starts a new one after a longer gap", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", path: "/" }),
      view({ at: "2026-09-01T10:30:00Z", visitor: "a", path: "/donate" }),
      view({ at: "2026-09-01T11:00:01Z", visitor: "a", path: "/events" }),
    ];
    const visits = splitVisits(views);
    expect(visits.map((v) => v.views.map((x) => x.path))).toEqual([["/", "/donate"], ["/events"]]);
  });

  it("orders each visitor's views by time, whatever order the rows came in", () => {
    const visits = splitVisits([
      view({ at: "2026-09-01T10:05:00Z", visitor: "a", path: "/donate" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", path: "/" }),
    ]);
    expect(visits).toHaveLength(1);
    expect(visits[0].entry.path).toBe("/");
  });

  it("never joins two visitors, or one visitor id on two days", () => {
    const visits = splitVisits([
      view({ at: "2026-09-01T10:00:00Z", visitor: "a" }),
      view({ at: "2026-09-01T10:01:00Z", visitor: "b" }),
      view({ at: "2026-09-02T10:00:00Z", visitor: "a" }),
    ]);
    expect(visits).toHaveLength(3);
  });
});

describe("buildPanels: the headline figures", () => {
  it("counts visitors as distinct visitor and day pairs, visits, views and the one page share", () => {
    const views = [
      // a: two views close together on day 1 (one visit), and again on day 2 (a new visitor that day)
      view({ at: "2026-09-01T10:00:00Z", visitor: "a" }),
      view({ at: "2026-09-01T10:10:00Z", visitor: "a", path: "/donate" }),
      view({ at: "2026-09-02T09:00:00Z", visitor: "a" }),
      // b: two single page visits on day 1, an hour apart
      view({ at: "2026-09-01T12:00:00Z", visitor: "b" }),
      view({ at: "2026-09-01T13:00:00Z", visitor: "b" }),
    ];
    const p = buildPanels(views, [], PERIOD);
    expect(p.headline).toEqual({ visitors: 3, visits: 4, views: 5, bounceShare: 75 });
  });

  it("is all zeros with no views, rather than dividing by nothing", () => {
    expect(buildPanels([], [], PERIOD).headline).toEqual({ visitors: 0, visits: 0, views: 0, bounceShare: 0 });
  });

  it("gives every day of the period its visitors, zero on a quiet day", () => {
    const p = buildPanels(
      [view({ at: "2026-09-01T10:00:00Z", visitor: "a" }), view({ at: "2026-09-03T10:00:00Z", visitor: "a" })],
      [],
      PERIOD,
    );
    expect(p.daily).toEqual([
      { day: "2026-09-01", visitors: 1 },
      { day: "2026-09-02", visitors: 0 },
      { day: "2026-09-03", visitors: 1 },
    ]);
  });

  it("leaves out rows outside the period, so both periods can be read in one go", () => {
    const p = buildPanels(
      [view({ at: "2026-08-31T10:00:00Z" }), view({ at: "2026-09-02T10:00:00Z" }), view({ at: "2026-09-04T10:00:00Z" })],
      [{ day: "2026-08-31", kind: "donate", label: "Donate", count: 4 }],
      PERIOD,
    );
    expect(p.headline.views).toBe(1);
    expect(p.clickKinds).toEqual([]);
  });
});

describe("buildPanels: where they came from", () => {
  it("files each visit under the channel of its first view, most visits first", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", channel: "search", source: "Google" }),
      view({ at: "2026-09-01T10:05:00Z", visitor: "a", channel: "direct" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "b", channel: "search", source: "Bing" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "c", channel: "social", source: "Facebook" }),
    ];
    expect(buildPanels(views, [], PERIOD).channels).toEqual([
      { channel: "search", visits: 2 },
      { channel: "social", visits: 1 },
    ]);
  });

  it("names the other websites and the newsletter issues that brought visits", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", channel: "other_websites", source: "www.example.org" }),
      view({ at: "2026-09-01T10:00:00Z", channel: "other_websites", source: "www.example.org" }),
      view({ at: "2026-09-01T10:00:00Z", channel: "other_websites", source: "blog.example.net" }),
      view({ at: "2026-09-01T10:00:00Z", channel: "newsletter", campaign: "41" }),
      view({ at: "2026-09-01T10:00:00Z", channel: "newsletter", campaign: null }),
      view({ at: "2026-09-01T10:00:00Z", channel: "search", source: "Google" }),
    ];
    const p = buildPanels(views, [], PERIOD);
    expect(p.otherWebsites).toEqual([
      { source: "www.example.org", visits: 2 },
      { source: "blog.example.net", visits: 1 },
    ]);
    expect(p.newsletters).toEqual([
      { campaign: "41", label: "41", visits: 1 },
      { campaign: null, label: "Not known", visits: 1 },
    ]);
  });
});

describe("buildPanels: where they are", () => {
  it("counts visitors per town and per country, skipping views with no place", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", city: "Dunbar", region: "Scotland", country: "GB" }),
      view({ at: "2026-09-01T10:05:00Z", visitor: "a", city: "Dunbar", region: "Scotland", country: "GB" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "b", city: "Haddington", region: "Scotland", country: "GB" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "c", city: "Lyon", region: "Auvergne-Rhone-Alpes", country: "FR" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "d" }),
    ];
    const p = buildPanels(views, [], PERIOD);
    expect(p.cities[0]).toEqual({ city: "Dunbar", region: "Scotland", country: "GB", visitors: 1 });
    expect(p.cities).toHaveLength(3);
    expect(p.countries).toEqual([
      { country: "GB", name: "United Kingdom", visitors: 2 },
      { country: "FR", name: "France", visitors: 1 },
    ]);
  });
});

describe("buildPanels: pages", () => {
  it("gives each page its views, visitors, averages that ignore missing values, and where visits began", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", path: "/", activeSeconds: 30, maxScroll: 40 }),
      view({ at: "2026-09-01T10:01:00Z", visitor: "a", path: "/donate", activeSeconds: 90, maxScroll: 100 }),
      view({ at: "2026-09-01T10:02:00Z", visitor: "a", path: "/", activeSeconds: null, maxScroll: null }),
      view({ at: "2026-09-01T11:00:00Z", visitor: "b", path: "/", activeSeconds: 10, maxScroll: 20 }),
      view({ at: "2026-09-01T11:00:00Z", visitor: "c", path: "/donate", activeSeconds: null, maxScroll: null }),
    ];
    const p = buildPanels(views, [], PERIOD);
    expect(p.pages).toEqual([
      // three visits began: a on /, b on /, c on /donate
      { path: "/", views: 3, visitors: 2, avgActiveSeconds: 20, avgScroll: 30, entryShare: 67 },
      { path: "/donate", views: 2, visitors: 2, avgActiveSeconds: 90, avgScroll: 100, entryShare: 33 },
    ]);
  });

  it("says nothing about time or scroll for a page no one has left yet", () => {
    const p = buildPanels([view({ at: "2026-09-01T10:00:00Z", path: "/events" })], [], PERIOD);
    expect(p.pages[0]).toMatchObject({ avgActiveSeconds: null, avgScroll: null, entryShare: 100 });
  });
});

describe("buildPanels: clicks and what they used", () => {
  it("adds up clicks by kind and by kind and label", () => {
    const clicks: ClickFact[] = [
      { day: "2026-09-01", kind: "donate", label: "Donate now", count: 3 },
      { day: "2026-09-02", kind: "donate", label: "Donate now", count: 2 },
      { day: "2026-09-02", kind: "outbound", label: "www.example.org", count: 1 },
    ];
    const p = buildPanels([], clicks, PERIOD);
    expect(p.clickKinds).toEqual([
      { kind: "donate", clicks: 5 },
      { kind: "outbound", clicks: 1 },
    ]);
    expect(p.clicks).toEqual([
      { kind: "donate", label: "Donate now", clicks: 5 },
      { kind: "outbound", label: "www.example.org", clicks: 1 },
    ]);
  });

  it("counts visitors per device and per browser", () => {
    const views = [
      view({ at: "2026-09-01T10:00:00Z", visitor: "a", device: "phone", browser: "Safari" }),
      view({ at: "2026-09-01T10:01:00Z", visitor: "a", device: "phone", browser: "Safari" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "b", device: "computer", browser: "Chrome" }),
      view({ at: "2026-09-01T10:00:00Z", visitor: "c", device: "phone", browser: "Chrome" }),
    ];
    const p = buildPanels(views, [], PERIOD);
    expect(p.devices).toEqual([
      { device: "phone", visitors: 2 },
      { device: "computer", visitors: 1 },
    ]);
    expect(p.browsers).toEqual([
      { browser: "Chrome", visitors: 2 },
      { browser: "Safari", visitors: 1 },
    ]);
  });
});

describe("countryName", () => {
  it("names a country from its ISO code, and keeps a code it does not know", () => {
    expect(countryName("GB")).toBe("United Kingdom");
    expect(countryName("de")).toBe("Germany");
    expect(countryName("ZZ9")).toBe("ZZ9");
  });
});

describe("newsletter issues", () => {
  it("picks out the campaigns that are newsletter ids", () => {
    expect(newsletterIds([{ campaign: "41" }, { campaign: "ballConfirmation" }, { campaign: null }, { campaign: "7" }])).toEqual([41, 7]);
  });

  it("labels an issue with its newsletter's subject, and keeps any other campaign as it came", () => {
    const rows = [
      { campaign: "41", label: "41", visits: 3 },
      { campaign: "spring", label: "spring", visits: 1 },
    ];
    expect(labelNewsletters(rows, new Map([[41, "Our winter news"]]))).toEqual([
      { campaign: "41", label: "Our winter news", visits: 3 },
      { campaign: "spring", label: "spring", visits: 1 },
    ]);
  });
});
