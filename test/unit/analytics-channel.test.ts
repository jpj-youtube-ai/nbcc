import { describe, it, expect } from "vitest";
import { classifyArrival, referrerHost } from "../../src/analytics/channel";

// TASK-479: where a visit came from. The rules run in order and the first match wins; each rule
// in the design has its own test here.

const OWN = ["nbcc.scot", "www.nbcc.scot", "localhost"];
const arrive = (referrer: string, utm: { source?: string; medium?: string; campaign?: string } = {}) =>
  classifyArrival({ referrer, utm, ownHosts: OWN });

describe("rule 1: newsletter", () => {
  it("utm_source=newsletter is the newsletter, with the issue kept", () => {
    expect(arrive("", { source: "newsletter", medium: "email", campaign: "42" })).toEqual({
      channel: "newsletter",
      source: null,
      campaign: "42",
    });
  });

  it("a click through the newsletter's link tracker is the newsletter too", () => {
    expect(arrive("https://click.news.nbcc.scot/abc")).toEqual({ channel: "newsletter", source: null, campaign: null });
  });

  it("wins over utm_medium=email", () => {
    expect(arrive("", { source: "Newsletter", medium: "email" }).channel).toBe("newsletter");
  });
});

describe("rule 2: email", () => {
  it("utm_medium=email is an email, with the kind of email kept", () => {
    expect(arrive("", { source: "email", medium: "email", campaign: "ballConfirmation" })).toEqual({
      channel: "email",
      source: null,
      campaign: "ballConfirmation",
    });
  });
});

describe("rule 3: any other utm_source decides", () => {
  it("a search engine's name is Search", () => {
    expect(arrive("", { source: "google" })).toEqual({ channel: "search", source: "Google", campaign: null });
  });

  it("a social site's name is Social", () => {
    expect(arrive("", { source: "facebook", campaign: "spring" })).toEqual({
      channel: "social",
      source: "Facebook",
      campaign: "spring",
    });
  });

  it("anything else is Other websites, named after the source", () => {
    expect(arrive("https://www.google.com/", { source: "Village-Hall" })).toEqual({
      channel: "other_websites",
      source: "village-hall",
      campaign: null,
    });
  });
});

describe("rule 4: search engines", () => {
  it.each([
    ["https://www.google.com/", "Google"],
    ["https://www.google.co.uk/", "Google"],
    ["https://www.bing.com/search?q=nbcc", "Bing"],
    ["https://duckduckgo.com/", "DuckDuckGo"],
    ["https://uk.search.yahoo.com/", "Yahoo"],
    ["https://www.ecosia.org/", "Ecosia"],
    ["https://yandex.ru/", "Yandex"],
    ["https://search.brave.com/", "Brave"],
    ["https://www.startpage.com/", "Startpage"],
  ])("%s is Search (%s)", (referrer, name) => {
    expect(arrive(referrer)).toEqual({ channel: "search", source: name, campaign: null });
  });
});

describe("rule 5: social sites", () => {
  it.each([
    ["https://l.facebook.com/", "Facebook"],
    ["https://m.facebook.com/", "Facebook"],
    ["https://www.instagram.com/", "Instagram"],
    ["https://t.co/abc", "X"],
    ["https://twitter.com/", "X"],
    ["https://x.com/", "X"],
    ["https://www.linkedin.com/", "LinkedIn"],
    ["https://www.tiktok.com/", "TikTok"],
    ["https://www.youtube.com/", "YouTube"],
    ["https://web.whatsapp.com/", "WhatsApp"],
    ["https://www.threads.net/", "Threads"],
    ["https://uk.pinterest.com/", "Pinterest"],
    ["https://www.reddit.com/", "Reddit"],
  ])("%s is Social (%s)", (referrer, name) => {
    expect(arrive(referrer)).toEqual({ channel: "social", source: name, campaign: null });
  });
});

describe("rule 6: our own site", () => {
  it("is not a new arrival", () => {
    expect(arrive("https://nbcc.scot/about-us")).toBe("internal");
    expect(arrive("https://www.nbcc.scot/")).toBe("internal");
    expect(arrive("http://localhost:3000/donate")).toBe("internal");
  });
});

describe("rule 7: any other website", () => {
  it("is Other websites, named by its host without www", () => {
    expect(arrive("https://www.villagenews.example.com/story?id=9")).toEqual({
      channel: "other_websites",
      source: "villagenews.example.com",
      campaign: null,
    });
  });

  it("does not mistake a lookalike for a search engine", () => {
    expect(arrive("https://notgoogle.example.com/").channel).toBe("other_websites");
  });
});

describe("rule 8: no referrer", () => {
  it("is Direct", () => {
    expect(arrive("")).toEqual({ channel: "direct", source: null, campaign: null });
  });

  it("an unreadable referrer is Direct too", () => {
    expect(arrive("not a web address")).toEqual({ channel: "direct", source: null, campaign: null });
  });
});

describe("referrerHost", () => {
  it("keeps only the host name, never the full address", () => {
    expect(referrerHost("https://Example.com/a/b?c=d")).toBe("example.com");
    expect(referrerHost("")).toBeNull();
    expect(referrerHost("javascript:alert(1)")).toBeNull();
  });
});
