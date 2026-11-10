// The Kilmarnock Santa Sleigh (docs/superpowers/specs/2026-11-10-santa-sleigh-design.md): the fixed
// values, and the pure rules every other part reads. No pool, no config, no clock of its own: a date
// is always handed in, as a UK date string (londonDate in src/ball/sales-report.ts).

/** The page, and the one address on every poster and QR code (Jaimie, 10 November 2026). */
export const SLEIGH_PATH = "/sleigh";
/** The long address, kept so it still works: it forwards to SLEIGH_PATH. */
export const SLEIGH_OLD_PATH = "/santa-sleigh";
/** Where Stripe brings a giver back to. */
export const SLEIGH_THANKS_PATH = "/sleigh/thank-you";
/** donations.source for a gift given on the page or tapped on a card machine on a sleigh night. */
export const SLEIGH_SOURCE = "santa_sleigh";
/** The smallest gift, in pence, as every other giving page. */
export const SLEIGH_MIN_PENCE = 200;
/** The address the posters print and their QR codes open. */
export const SLEIGH_PUBLIC_URL = "https://nbcc.scot/sleigh";

/** One night of the sleigh: a UK date, the areas it goes round, and its times once known (HH:MM). */
export interface SleighNight {
  id: number;
  nightOn: string;
  areas: string;
  startsAt: string | null;
  endsAt: string | null;
}

/** The one row of settings: the first day counted in the year's total, and the day the page goes. */
export interface SleighSettings {
  seasonFrom: string;
  offOn: string;
}

/**
 * Where the page is in the year. "before": ahead of the first night, or a day between nights;
 * "on": a sleigh night; "after": the last night has gone, the thank you shows, giving stays open;
 * "off": from the switch off day the address goes to the home page.
 */
export type SleighPhase = "before" | "on" | "after" | "off";

const byDate = (nights: readonly SleighNight[]) => [...nights].sort((a, b) => a.nightOn.localeCompare(b.nightOn));

export function sleighPhase(today: string, nights: readonly SleighNight[], offOn: string): SleighPhase {
  if (today >= offOn) return "off";
  const sorted = byDate(nights);
  if (sorted.length === 0) return "before";
  if (sorted.some((n) => n.nightOn === today)) return "on";
  return today > sorted[sorted.length - 1].nightOn ? "after" : "before";
}

/** Which house on the road the sleigh is at: tonight's, else the next one; past the last afterwards. */
export function roadStop(today: string, nights: readonly SleighNight[]): number {
  const i = byDate(nights).findIndex((n) => n.nightOn >= today);
  return i === -1 ? nights.length : i;
}

/** "6pm", "8.30pm", "12am": a time of day said the way a poster says it. */
function spoken(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `.${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "6pm to 8.30pm", or "Timings TBC" until both times are set. Never a dash. */
export function timesLabel(n: Pick<SleighNight, "startsAt" | "endsAt">): string {
  if (!n.startsAt || !n.endsAt) return "Timings TBC";
  return `${spoken(n.startsAt)} to ${spoken(n.endsAt)}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The parts of a night's date for its little calendar block: "Tue", "15", "Dec". */
export function dayLabel(nightOn: string): { day: string; date: string; month: string } {
  const [y, m, d] = nightOn.split("-").map(Number);
  const when = new Date(Date.UTC(y, m - 1, d));
  return { day: DAYS[when.getUTCDay()], date: String(d), month: MONTHS[m - 1] };
}

/** "£50", "£1,234", "£12.50": pence shown only when there are some. */
export function pounds(pence: number): string {
  const whole = Math.floor(pence / 100);
  const rest = Math.round(pence % 100);
  return `£${whole.toLocaleString("en-GB")}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}
