// The Overview's numbers (stage 2): how we are doing, one line each. These are the pure rules; the
// reads are in src/routes/admin-overview.ts. Design: docs/superpowers/specs/2026-10-03-admin-overview-design.md.

/** Money in pence, now (this month so far) and before (the same days last month). */
export type NowAndBefore = { now: number; before: number };

/** What the reads found. Each part is there only for someone who may see the screen it comes from. */
export interface NumberCounts {
  money?: { donations?: NowAndBefore; ball?: NowAndBefore; fundraising?: NowAndBefore };
  monthly?: { giving: number; monthlyPence: number; joined: number; stopped: number };
  ball?: { seatsSold: number; totalSeats: number; takenPence: number; transferSeats: number; daysToGo: number };
  website?: { visitors: number; visitorsBefore: number; onNow: number; topChannel: string | null };
}

export interface NumberLine {
  key: keyof NumberCounts;
  title: string;
  headline: string;
  detail: string;
  /** The admin screen that has the full story, and its name as the menu shows it. */
  view: string;
  button: string;
}

/** Whole pounds: at a glance £4,210 reads faster than £4,210.49. */
const pounds = (pence: number) => "£" + Math.round(Math.max(0, pence) / 100).toLocaleString("en-GB");
const n = (x: number) => x.toLocaleString("en-GB");
const people = (x: number) => `${n(x)} ${x === 1 ? "person" : "people"}`;

// As the Analytics screen names its channels.
const CHANNEL_WORDS: Record<string, string> = {
  newsletter: "Most came from the newsletter.",
  email: "Most came from an email.",
  qr: "Most came from a QR code.",
  search: "Most came from Search.",
  social: "Most came from social media.",
  other_websites: "Most came from other websites.",
  direct: "Most came straight to the site: typed in, a bookmark or an app.",
};

// Each part, its name, and its screen: the first part a person may see is where Money in opens.
const MONEY_PARTS = [
  ["donations", "Donations", "donations", "Donations"],
  ["ball", "Festive Ball", "ball", "Festive Ball"],
  ["fundraising", "fundraising pages", "fundraising", "Fundraising"],
] as const;

function moneyLine(m: NonNullable<NumberCounts["money"]>): NumberLine {
  const parts = MONEY_PARTS.filter(([k]) => m[k]).map(([k, name, view, button]) => ({ name, view, button, ...(m[k] as NowAndBefore) }));
  const now = parts.reduce((t, p) => t + p.now, 0);
  const before = parts.reduce((t, p) => t + p.before, 0);
  const split = parts.length > 1 ? " " + parts.map((p) => `${p.name} ${pounds(p.now)}`).join(", ") + "." : "";
  return {
    key: "money",
    title: "Money in",
    headline: `${pounds(now)} this month so far`,
    detail: `${pounds(before)} by this time last month.${split}`,
    view: parts[0].view,
    button: parts[0].button,
  };
}

function monthlyLine(m: NonNullable<NumberCounts["monthly"]>): NumberLine {
  const moved =
    m.joined || m.stopped ? `${n(m.joined)} joined and ${n(m.stopped)} stopped this month.` : "Nobody joined or stopped this month.";
  return {
    key: "monthly",
    title: "Monthly givers",
    headline: `${people(m.giving)} ${m.giving === 1 ? "gives" : "give"} ${pounds(m.monthlyPence)} a month`,
    detail: moved,
    view: "monthly",
    button: "Monthly givers",
  };
}

function ballLine(b: NonNullable<NumberCounts["ball"]>): NumberLine {
  const bits = [`${pounds(b.takenPence)} taken.`];
  if (b.transferSeats > 0) {
    bits.push(b.transferSeats === 1 ? "1 seat held for a bank transfer." : `${n(b.transferSeats)} seats held for bank transfers.`);
  }
  if (b.daysToGo === 0) bits.push("The Ball is tonight.");
  else if (b.daysToGo === 1) bits.push("1 day to go.");
  else if (b.daysToGo > 1) bits.push(`${n(b.daysToGo)} days to go.`);
  return {
    key: "ball",
    title: "Festive Ball",
    headline: `${n(b.seatsSold)} of ${n(b.totalSeats)} seats sold`,
    detail: bits.join(" "),
    view: "ball",
    button: "Festive Ball",
  };
}

function websiteLine(w: NonNullable<NumberCounts["website"]>): NumberLine {
  const bits = [`${n(w.visitorsBefore)} in the 7 days before.`, `${people(w.onNow)} on the site now.`];
  const channel = w.topChannel ? CHANNEL_WORDS[w.topChannel] : undefined;
  if (channel) bits.push(channel);
  return {
    key: "website",
    title: "Website",
    headline: `${n(w.visitors)} ${w.visitors === 1 ? "visitor" : "visitors"} in the last 7 days`,
    detail: bits.join(" "),
    view: "analytics",
    button: "Analytics",
  };
}

/** One line each, in the order money, monthly givers, the Festive Ball, the website. */
export function numbersLines(c: NumberCounts): NumberLine[] {
  const out: NumberLine[] = [];
  if (c.money && MONEY_PARTS.some(([k]) => c.money?.[k])) out.push(moneyLine(c.money));
  if (c.monthly) out.push(monthlyLine(c.monthly));
  if (c.ball) out.push(ballLine(c.ball));
  if (c.website) out.push(websiteLine(c.website));
  return out;
}

/** A stretch of UK days from `from` (a YYYY-MM-DD UK day) up to the moment `until`. */
export interface SoFar {
  from: string;
  until: string;
}

const UK_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function ukParts(at: Date) {
  const p = Object.fromEntries(UK_CLOCK.formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, min: p.minute, s: p.second };
}

/** How far the UK clock is ahead of UTC at this moment: 0 in winter, an hour in summer. */
function ukOffsetMs(at: Date): number {
  const p = ukParts(at);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The moment the UK clock shows this date and time (month 1 to 12). */
function ukMoment(y: number, m: number, d: number, h: number, min: number, s: number, ms: number): Date {
  const wall = Date.UTC(y, m - 1, d, h, min, s, ms);
  let at = new Date(wall);
  for (let i = 0; i < 2; i++) at = new Date(wall - ukOffsetMs(at));
  return at;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * This month so far, in UK days, and the same days of last month up to the same UK time of day, so
 * the 14th at 10:30 compares with last month's 14th at 10:30. When last month was shorter (the 31st
 * against February) the whole of last month counts.
 */
export function monthSoFar(now: Date): { current: SoFar; previous: SoFar } {
  const p = ukParts(now);
  const py = p.m === 1 ? p.y - 1 : p.y;
  const pm = p.m === 1 ? 12 : p.m - 1;
  const until =
    p.d > daysIn(py, pm)
      ? ukMoment(p.y, p.m, 1, 0, 0, 0, 0)
      : ukMoment(py, pm, p.d, p.h, p.min, p.s, now.getTime() % 1000);
  return {
    current: { from: `${p.y}-${pad(p.m)}-01`, until: now.toISOString() },
    previous: { from: `${py}-${pad(pm)}-01`, until: until.toISOString() },
  };
}

/** The UK day a moment falls on, YYYY-MM-DD. */
function ukDay(at: Date): string {
  const p = ukParts(at);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

type Giver = { monthlyPence: number; state: string; firstPaidAt: string; cancelledAt: string | null; lapsedAt: string | null };

/**
 * Monthly givers as the Monthly givers screen counts them: giving is active, or older ones with no
 * record either way ("unknown"); joined is a first paid gift this month; stopped is cancelled or
 * lapsed this month. Months are UK months.
 */
export function giversFrom(rows: readonly Giver[], now: Date): NonNullable<NumberCounts["monthly"]> {
  const month = ukDay(now).slice(0, 7);
  const inMonth = (at: string | null) => at !== null && ukDay(new Date(at)).slice(0, 7) === month;
  const giving = rows.filter((r) => r.state === "active" || r.state === "unknown");
  return {
    giving: giving.length,
    monthlyPence: giving.reduce((t, r) => t + r.monthlyPence, 0),
    joined: rows.filter((r) => inMonth(r.firstPaidAt)).length,
    stopped: rows.filter((r) => inMonth(r.cancelledAt) || inMonth(r.lapsedAt)).length,
  };
}
