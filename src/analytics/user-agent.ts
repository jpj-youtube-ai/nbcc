// TASK-479: what a visitor used, read from the user agent, which is then forgotten. Families only:
// phone, tablet or computer; a handful of browsers; a handful of operating systems.

export type Device = "phone" | "tablet" | "computer";
export type DeviceInfo = { device: Device; browser: string; os: string };

// Bots, crawlers, spiders, headless browsers and link preview fetchers. Checked before anything
// is stored. An empty user agent is not a browser either.
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|preview|externalhit|embedly|whatsapp\/|telegram|discord|skype|lighthouse|pingdom|uptime|monitor|curl\/|wget|python|node-fetch|axios|go-http|java\/|okhttp|scrapy|phantom|puppeteer|playwright/i;
// Real phones whose maker's name happens to end in "bot".
const NOT_A_BOT = /cubot/i;

export function isBot(userAgent: string): boolean {
  const ua = (userAgent ?? "").trim();
  if (ua === "") return true;
  return BOT.test(ua.replace(NOT_A_BOT, ""));
}

function device(ua: string): Device {
  if (/iPad|Tablet|Kindle|Silk|PlayBook/i.test(ua)) return "tablet";
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return "tablet";
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) return "phone";
  return "computer";
}

function browser(ua: string): string {
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/OPR\/|Opera|YaBrowser|Vivaldi/i.test(ua)) return "Other";
  if (/Edg(e|A|iOS)?\//i.test(ua)) return "Edge";
  if (/Firefox\/|FxiOS/i.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS|Chromium/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && /Version\//i.test(ua)) return "Safari";
  return "Other";
}

function os(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
  if (/Linux|X11/i.test(ua)) return "Linux";
  return "Other";
}

export function readUserAgent(userAgent: string): DeviceInfo {
  const ua = userAgent ?? "";
  return { device: device(ua), browser: browser(ua), os: os(ua) };
}
