// TASK-479: what happens to one event sent to POST /api/pulse. The orchestration only: every seam
// (the switch, the limiter, the database, the place lookup, the clock) is passed in, so each rule
// is unit-tested without a database. src/routes/pulse.ts wires the real ones.
//
// Nothing here stores the IP address or the user agent. The IP is used for the rate limit, the
// daily visitor id and the place lookup; the user agent for the visitor id, the bot check and the
// device. Both are then forgotten with the request.
import { classifyArrival, type Arrival } from "./channel";
import { canonicalPath } from "./paths";
import { parsePulse, type ClickKind } from "./payload";
import type { Place } from "./place";
import { BUSY } from "./gate";
import { isBot, readUserAgent, type Device } from "./user-agent";
import { ukDay, visitorId } from "./visitor";

export type ViewRow = {
  viewId: string;
  at: Date;
  day: string;
  path: string;
  visitor: string;
  channel: Arrival["channel"];
  source: string | null;
  campaign: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  device: Device;
  browser: string;
  os: string;
};

export type ClickRow = { viewId: string; at: Date; day: string; kind: ClickKind; label: string };

export type PulseDeps = {
  now: () => Date;
  isCollecting: (nowMs: number) => Promise<boolean>;
  limiter: { allow: (key: string, now: number) => boolean };
  saltFor: (day: string) => Promise<string>;
  lastArrival: (day: string, visitor: string) => Promise<Arrival | null>;
  insertView: (row: ViewRow) => Promise<void>;
  recordLeave: (viewId: string, activeSeconds: number, maxScroll: number) => Promise<void>;
  insertClick: (row: ClickRow) => Promise<void>;
  resolvePlace: (ip: string) => Place;
  /** At most a couple of events at the database at once; the rest are dropped (./gate.ts). */
  gate: { tryRun: <T>(work: () => Promise<T>) => Promise<T | typeof BUSY> };
};

/** The request headers that say where an event came from and what the browser asked for. */
export type PulseHeaders = {
  secFetchSite?: string;
  origin?: string;
  referer?: string;
  dnt?: string;
  secGpc?: string;
};

export type PulseRequest = { body: string; ip: string; userAgent: string; host: string; headers: PulseHeaders };

export type PulseOutcome = "kept" | "off" | "limited" | "bot" | "invalid" | "foreign" | "dnt" | "busy";

// Our own addresses: a referrer from one of these is a move between our pages, not an arrival.
const OWN_HOSTS = ["nbcc.scot", "www.nbcc.scot"];

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Did one of our own pages send this? A text/plain POST needs no preflight, so without this any
 * website could make its visitors' browsers send us made up events. Browsers that send
 * Sec-Fetch-Site are believed; for those that do not, the Origin (or failing that the Referer)
 * must be one of our own hosts. Nothing to go on at all counts as not ours.
 */
export function sentByOurOwnPage(headers: PulseHeaders, host: string): boolean {
  if (headers.secFetchSite) return headers.secFetchSite === "same-origin";
  const from = hostOf(headers.origin) ?? hostOf(headers.referer);
  if (!from) return false;
  return [...OWN_HOSTS, host].map((h) => h.toLowerCase().replace(/^www\./, "")).includes(from);
}

export async function handlePulse(req: PulseRequest, deps: PulseDeps): Promise<PulseOutcome> {
  const now = deps.now();
  // An IPv4 address can reach us written as an IPv6 one; use one spelling so the id matches.
  const ip = (req.ip || "").replace(/^::ffff:/i, "");

  if (!sentByOurOwnPage(req.headers, req.host)) return "foreign";
  // Do Not Track and Global Privacy Control are honoured here too, not only by the script.
  if (req.headers.dnt === "1" || req.headers.secGpc === "1") return "dnt";
  if (!deps.limiter.allow(ip, now.getTime())) return "limited";
  if (isBot(req.userAgent)) return "bot";
  const event = parsePulse(req.body);
  if (!event) return "invalid";

  const outcome = await deps.gate.tryRun(async (): Promise<PulseOutcome> => {
    if (!(await deps.isCollecting(now.getTime()))) return "off";
    await keep(event, now, ip, req, deps);
    return "kept";
  });
  return outcome === BUSY ? "busy" : outcome;
}

async function keep(
  event: NonNullable<ReturnType<typeof parsePulse>>,
  now: Date,
  ip: string,
  req: PulseRequest,
  deps: PulseDeps,
): Promise<void> {
  const day = ukDay(now);

  if (event.t === "leave") {
    await deps.recordLeave(event.v, event.a, event.s);
    return;
  }
  if (event.t === "click") {
    await deps.insertClick({ viewId: event.v, at: now, day, kind: event.k, label: event.l });
    return;
  }

  const visitor = visitorId(await deps.saltFor(day), ip, req.userAgent);
  const arrival = classifyArrival({
    referrer: event.r,
    utm: { source: event.u.s, medium: event.u.m, campaign: event.u.c },
    ownHosts: [...OWN_HOSTS, req.host],
    path: event.p,
  });
  // A move between our own pages keeps the channel of the visit it belongs to.
  const { channel, source, campaign } =
    arrival === "internal"
      ? ((await deps.lastArrival(day, visitor)) ?? { channel: "direct" as const, source: null, campaign: null })
      : arrival;
  const place = deps.resolvePlace(ip);
  const { device, browser, os } = readUserAgent(req.userAgent);

  await deps.insertView({
    viewId: event.v,
    at: now,
    day,
    path: canonicalPath(event.p),
    visitor,
    channel,
    source,
    campaign,
    country: place.country,
    region: place.region,
    city: place.city,
    device,
    browser,
    os,
  });
}
