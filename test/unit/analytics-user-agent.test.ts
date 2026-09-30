import { describe, it, expect } from "vitest";
import { readUserAgent, isBot } from "../../src/analytics/user-agent";

// TASK-479: phone, tablet or computer; browser family; operating system family; and bots dropped.

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.54",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/113.0.0.0",
  cubotPhone:
    "Mozilla/5.0 (Linux; Android 12; CUBOT X50) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
};

describe("readUserAgent", () => {
  it.each([
    ["iphoneSafari", "phone", "Safari", "iOS"],
    ["iphoneChrome", "phone", "Chrome", "iOS"],
    ["ipad", "tablet", "Safari", "iOS"],
    ["androidChrome", "phone", "Chrome", "Android"],
    ["androidTablet", "tablet", "Chrome", "Android"],
    ["samsung", "phone", "Samsung Internet", "Android"],
    ["windowsChrome", "computer", "Chrome", "Windows"],
    ["windowsEdge", "computer", "Edge", "Windows"],
    ["macSafari", "computer", "Safari", "macOS"],
    ["macFirefox", "computer", "Firefox", "macOS"],
    ["linuxFirefox", "computer", "Firefox", "Linux"],
    ["chromebook", "computer", "Chrome", "ChromeOS"],
    ["opera", "computer", "Other", "Windows"],
  ] as const)("%s is a %s running %s on %s", (key, device, browser, os) => {
    expect(readUserAgent(UA[key])).toEqual({ device, browser, os });
  });

  it("reads an unknown agent as a computer running Other", () => {
    expect(readUserAgent("SomethingNew/1.0")).toEqual({ device: "computer", browser: "Other", os: "Other" });
  });
});

describe("isBot", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
    "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
    "Some-Web-Crawler/1.0",
    "ExampleSpider/2.0",
    "Mozilla/5.0 (compatible; Google-PageRenderer Google Web Preview)",
    "WhatsApp/2.23.20.0",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "curl/8.4.0",
    "python-requests/2.32.0",
    "",
  ])("drops %s", (ua) => {
    expect(isBot(ua)).toBe(true);
  });

  it.each(Object.entries(UA))("keeps a real browser: %s", (_name, ua) => {
    expect(isBot(ua)).toBe(false);
  });
});
