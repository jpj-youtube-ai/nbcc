// TASK-479: where a visit came from. The rules run in order and the first match wins (the design,
// docs/superpowers/specs/2026-09-30-site-analytics-design.md, "Channels"). Pure: no DB, no clock.
//
// Only the referring website's HOST is ever kept, never its full address.

export type Channel = "newsletter" | "email" | "qr" | "search" | "social" | "other_websites" | "direct";

export type Arrival = { channel: Channel; source: string | null; campaign: string | null };

export type Utm = { source?: string; medium?: string; campaign?: string };

type Site = { name: string; host: RegExp; words: string[] };

// Hosts are compared without "www.". A search engine matches only its real search hosts, so
// docs.google.com, sites.google.com or mail.yahoo.com are other websites, not Search. A country
// ending is allowed where the engine has them: google.com, google.co.uk, google.com.au.
const TLD = "(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})";
const SEARCH: Site[] = [
  { name: "Google", host: new RegExp(`^google\\.${TLD}$`), words: ["google"] },
  { name: "Bing", host: /^bing\.com$/, words: ["bing"] },
  { name: "DuckDuckGo", host: /^((html|lite)\.)?duckduckgo\.com$/, words: ["duckduckgo", "ddg"] },
  { name: "Yahoo", host: /^([a-z]{2}\.)?search\.yahoo\.(com|co\.jp)$/, words: ["yahoo"] },
  { name: "Ecosia", host: /^ecosia\.org$/, words: ["ecosia"] },
  { name: "Yandex", host: new RegExp(`^yandex\\.${TLD}$`), words: ["yandex"] },
  { name: "Brave", host: /^search\.brave\.com$/, words: ["brave"] },
  { name: "Startpage", host: /^startpage\.(com|nl)$/, words: ["startpage"] },
];

// A social site matches itself or any of its subdomains (l.facebook.com, m.facebook.com):
// "notfacebook.example.com" is not Facebook.

const SOCIAL: Site[] = [
  { name: "Facebook", host: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/, words: ["facebook", "fb"] },
  { name: "Instagram", host: /(^|\.)instagram\.com$/, words: ["instagram", "ig"] },
  { name: "X", host: /(^|\.)(x\.com|twitter\.com|t\.co)$/, words: ["x", "twitter"] },
  { name: "LinkedIn", host: /(^|\.)(linkedin\.com|lnkd\.in)$/, words: ["linkedin"] },
  { name: "TikTok", host: /(^|\.)tiktok\.com$/, words: ["tiktok"] },
  { name: "YouTube", host: /(^|\.)(youtube\.com|youtu\.be)$/, words: ["youtube"] },
  { name: "WhatsApp", host: /(^|\.)(whatsapp\.com|wa\.me)$/, words: ["whatsapp"] },
  { name: "Threads", host: /(^|\.)threads\.(net|com)$/, words: ["threads"] },
  { name: "Pinterest", host: /(^|\.)(pinterest\.[a-z.]+|pin\.it)$/, words: ["pinterest"] },
  { name: "Reddit", host: /(^|\.)reddit\.com$/, words: ["reddit"] },
];

// The newsletter's own link tracker (and anything else on the newsletter's address).
const NEWSLETTER_HOST = /(^|\.)news\.nbcc\.scot$/;

// Paying: Stripe's checkout and card check pages. Coming back from them is part of the same visit.
const PAYMENT_HOST = /(^|\.)stripe\.com$/;

// Where a payment returns the visitor. A bank's own card check page can send them here too, so any
// website arriving on one of these is treated as the same visit coming back, not a new arrival.
const PAYMENT_RETURN_PATHS = ["/donate/thank-you", "/business/thank-you", "/ball/thank-you"];

const tidy = (s: string | undefined): string => (s ?? "").trim();

/** The referring address's host name, lower case and without "www.", or null. Never the path. */
export function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function findByHost(list: Site[], host: string): Site | undefined {
  return list.find((s) => s.host.test(host));
}

function findBySource(list: Site[], source: string): Site | undefined {
  const s = source.toLowerCase().replace(/^www\./, "");
  return list.find((site) => site.words.includes(s) || site.host.test(s));
}

/**
 * The channel for a view, or "internal" when the visitor came from another page of our own site:
 * that is not a new arrival, and the caller keeps the channel of the visit it belongs to.
 */
export function classifyArrival(input: {
  referrer: string;
  utm: Utm;
  ownHosts: string[];
  /** The page being viewed, without its query string. */
  path?: string;
}): Arrival | "internal" {
  const source = tidy(input.utm.source);
  const medium = tidy(input.utm.medium).toLowerCase();
  const campaign = tidy(input.utm.campaign) || null;
  const host = referrerHost(input.referrer);

  // 1. The newsletter.
  if (source.toLowerCase() === "newsletter" || (host && NEWSLETTER_HOST.test(host))) {
    return { channel: "newsletter", source: null, campaign };
  }
  // 2. Any other email of ours.
  if (medium === "email") return { channel: "email", source: null, campaign };
  // TASK-492: a scan of one of the admin's QR codes (src/site/qr.ts), with the page's code named.
  if (medium === "qr") return { channel: "qr", source: null, campaign };
  // 3. Any other utm_source decides.
  if (source) {
    const search = findBySource(SEARCH, source);
    if (search) return { channel: "search", source: search.name, campaign };
    const social = findBySource(SOCIAL, source);
    if (social) return { channel: "social", source: social.name, campaign };
    return { channel: "other_websites", source: source.toLowerCase().slice(0, 100), campaign };
  }
  if (host) {
    // 4. Search engines.
    const search = findByHost(SEARCH, host);
    if (search) return { channel: "search", source: search.name, campaign: null };
    // 5. Social sites.
    const social = findByHost(SOCIAL, host);
    if (social) return { channel: "social", source: social.name, campaign: null };
    // 6. Our own site, or coming back from paying.
    const own = input.ownHosts.map((h) => h.toLowerCase().replace(/^www\./, ""));
    if (own.includes(host) || PAYMENT_HOST.test(host)) return "internal";
    const path = (input.path ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
    if (PAYMENT_RETURN_PATHS.includes(path)) return "internal";
    // 7. Any other website.
    return { channel: "other_websites", source: host, campaign: null };
  }
  // 8. No referrer.
  return { channel: "direct", source: null, campaign: null };
}
