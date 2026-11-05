// What brought someone to give (docs/superpowers/specs/2026-11-05-donations-screen-design.md, "What we
// know today", 1). Pure: no DB, no clock, no config. The checkout works it out from the giving page (the
// request's Referer, our page with its query string) and the page before it (document.referrer, which
// the giving page sends as cameFrom), sorted by the very rules page views use (classifyArrival), so a
// gift and a visit are named alike. Nothing is kept in the browser.
//
// Only ever a channel, a short source (a search engine or social site's name, another website's host,
// or for one of our own pages its path) and the link's campaign tag: never a full address, and never
// anything at all when the browser sends Do Not Track or Global Privacy Control.

import { classifyArrival, referrerHost, PAYMENT_HOST, PAYMENT_RETURN_PATHS, type Channel, type Utm } from "../analytics/channel";

/** Every channel a gift can carry: the page view channels, plus "site" for another page of ours. */
export const ARRIVAL_CHANNELS = ["qr", "email", "newsletter", "search", "social", "other_websites", "direct", "site"] as const;
export type ArrivalChannel = (typeof ARRIVAL_CHANNELS)[number];

export type GiftArrival = {
  channel: ArrivalChannel;
  source: string | null;
  campaign: string | null;
  givenOn: string | null;
};

const MAX = 100;
const cut = (s: string | null | undefined): string | null => (s ? s.slice(0, MAX) : null);

// A host as we compare them: lower case, no "www.", no port (a local copy runs on localhost:3000).
const bareHost = (h: string): string => h.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");

function parse(address: string | null): URL | null {
  if (!address || !referrerHost(address)) return null;
  try {
    return new URL(address);
  } catch {
    return null;
  }
}

// A path as we show it: no query, no trailing slash (except the home page's own).
const pathOf = (url: URL): string => url.pathname.replace(/\/+$/, "") || "/";

function utmOf(url: URL | null): Utm | null {
  if (!url) return null;
  const q = url.searchParams;
  const utm: Utm = {
    source: q.get("utm_source") ?? undefined,
    medium: q.get("utm_medium") ?? undefined,
    campaign: q.get("utm_campaign") ?? undefined,
  };
  return utm.source || utm.medium || utm.campaign ? utm : null;
}

// Where paying sends someone back: Stripe itself, or one of our thank you pages. The analytics list,
// plus any other thank you page of ours (/fill/thank-you, /bag/thank-you). Coming from one is not a
// new arrival, and not "another page of ours" either.
function isPaymentReturn(url: URL, own: boolean): boolean {
  if (PAYMENT_HOST.test(bareHost(url.hostname))) return true;
  if (!own) return false;
  const path = pathOf(url).toLowerCase();
  return PAYMENT_RETURN_PATHS.includes(path) || path.endsWith("/thank-you");
}

export function giftArrival(o: {
  givingPage: string | null;
  cameFrom: string | null;
  ownHosts: string[];
  doNotTrack: boolean;
}): GiftArrival | null {
  if (o.doNotTrack) return null;
  // The page did not say where it came from (an older copy of it, or some other caller): any
  // channel would be a guess.
  if (o.cameFrom === null || o.cameFrom === undefined) return null;

  const own = o.ownHosts.map(bareHost);
  const isOurs = (url: URL | null): url is URL => url !== null && own.includes(bareHost(url.host));

  const giving = parse(o.givingPage);
  const givingOurs = isOurs(giving) ? giving : null;
  let before = parse(o.cameFrom);
  const beforeOurs = isOurs(before);
  if (before && isPaymentReturn(before, beforeOurs)) before = null;

  // Link tags: the giving page's own, else the page before it when that is ours (scanned onto the
  // home page, then pressed Donate). Never another website's tags, and never a page not ours.
  const utm = utmOf(givingOurs) ?? (before && beforeOurs ? utmOf(before) : null) ?? {};

  const arrival = classifyArrival({ referrer: before ? before.href : "", utm, ownHosts: own });
  const sorted: { channel: Channel | "site"; source: string | null; campaign: string | null } =
    arrival === "internal"
      ? { channel: "site", source: before ? pathOf(before) : null, campaign: null }
      : arrival;

  return {
    channel: sorted.channel,
    source: cut(sorted.source),
    campaign: cut(sorted.campaign),
    givenOn: givingOurs ? cut(pathOf(givingOurs)) : null,
  };
}
