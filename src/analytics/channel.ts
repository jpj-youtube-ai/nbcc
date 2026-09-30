// TASK-479: where a visit came from. The rules run in order and the first match wins (the design,
// docs/superpowers/specs/2026-09-30-site-analytics-design.md, "Channels"). Pure: no DB, no clock.
//
// Only the referring website's HOST is ever kept, never its full address.

export type Channel = "newsletter" | "email" | "search" | "social" | "other_websites" | "direct";

export type Arrival = { channel: Channel; source: string | null; campaign: string | null };

export type Utm = { source?: string; medium?: string; campaign?: string };

type Site = { name: string; host: RegExp; words: string[] };

// A host matches when it IS the site or a subdomain of it: "notgoogle.example.com" is not Google.
const SEARCH: Site[] = [
  { name: "Google", host: /(^|\.)google\.[a-z.]+$/, words: ["google"] },
  { name: "Bing", host: /(^|\.)bing\.com$/, words: ["bing"] },
  { name: "DuckDuckGo", host: /(^|\.)duckduckgo\.com$/, words: ["duckduckgo", "ddg"] },
  { name: "Yahoo", host: /(^|\.)yahoo\.[a-z.]+$/, words: ["yahoo"] },
  { name: "Ecosia", host: /(^|\.)ecosia\.org$/, words: ["ecosia"] },
  { name: "Yandex", host: /(^|\.)yandex\.[a-z.]+$/, words: ["yandex"] },
  { name: "Brave", host: /(^|\.)search\.brave\.com$/, words: ["brave"] },
  { name: "Startpage", host: /(^|\.)startpage\.com$/, words: ["startpage"] },
];

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
export function classifyArrival(input: { referrer: string; utm: Utm; ownHosts: string[] }): Arrival | "internal" {
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
    // 6. Our own site.
    const own = input.ownHosts.map((h) => h.toLowerCase().replace(/^www\./, ""));
    if (own.includes(host)) return "internal";
    // 7. Any other website.
    return { channel: "other_websites", source: host, campaign: null };
  }
  // 8. No referrer.
  return { channel: "direct", source: null, campaign: null };
}
