// TASK-646: the two live blocks of the paper look (Stage 2 of
// docs/superpowers/specs/2026-11-14-newsletter-paper-blocks-design.md).
//
//   countdown, "Sleeps to go": how many sleeps (or days) until a date, counted in UK days from
//     ctx.today (the send worker passes the UK date of the moment it sends; left out, it is today in
//     the UK). It ALWAYS prints the real date beside the count, because an email is often opened days
//     after it went out. On or after the day it shows its after words, or nothing.
//   liveTotal, "Live total": bags filled through Fill a Red Bag (one for every £50 since 1 November,
//     exactly as the Workshop's sign counts them), the Santa Sleigh's total (online, card machine and
//     bucket cash, as /sleigh shows), or a number typed in. It shows the number frozen into the block
//     when the newsletter was sent (data.sent), else today's number from ctx.live, else the fallback
//     words. NEVER "0 bags" or "£0": below hideBelow, or with no number, the fallback words or nothing.
//
// Like every paper block: new types with their own renderers (no existing block changes), tables and
// inline styles only, every word live text, everything an author types escaped and cut to its limit.
// The renderers stay pure apart from a countdown with no ctx.today, which reads the clock once.
import type { Block } from "./blocks";
import { type RenderCtx, type LiveNumbers, escapeHtml, MAROON, CRIMSON, CREAM, CREAM_82, SLATE, TAN_SOFT, HEAD, BODY } from "./theme";
import { parseIsoDate, stickerButton, band, paperCard, CARD, HOLLY, GOLD, INK, HAND } from "./paper-blocks";
import { looksSendable } from "./link-safety";
import { pounds } from "../sleigh/model";

export const LIVE_PAPER_TYPES = ["liveTotal", "countdown"] as const;
export type LivePaperType = (typeof LIVE_PAPER_TYPES)[number];

/** Where a live total's number comes from. "typed" is a number the writer types in. */
export type LiveSource = "redBag" | "sleigh" | "typed";
/** The sources read from the database (a typed number needs no reading). */
export const READ_SOURCES = ["redBag", "sleigh"] as const;
export type ReadSource = (typeof READ_SOURCES)[number];

type Data = Record<string, unknown>;
const isRecord = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
const esc = escapeHtml;
const str = (d: Data, k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
const limit = (value: string, max: number): string => Array.from(value).slice(0, max).join("");
const cut = (d: Data, k: string, max: number): string => limit(str(d, k).trim(), max);

// ---- the day in the UK -------------------------------------------------------------------------

const UK_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** The date in the UK at `now`, written YYYY-MM-DD. */
export function ukToday(now: Date = new Date()): string {
  return UK_DAY.format(now);
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utc = (p: { y: number; m: number; d: number }): number => Date.UTC(p.y, p.m - 1, p.d);

/** "Thursday 24 December", with the year only when it is not this year. */
function sayDate(p: { y: number; m: number; d: number }, thisYear: number): string {
  const weekday = WEEKDAYS[new Date(utc(p)).getUTCDay()];
  return `${weekday} ${p.d} ${MONTHS[p.m - 1]}${p.y === thisYear ? "" : ` ${p.y}`}`;
}

// ---- countdown, Sleeps to go -------------------------------------------------------------------
//   0: the big number on a tan card   1: on a crimson band   2: one sentence
//   3: on a holly band, the number in gold
//
// data: date (YYYY-MM-DD), label (60, "until Christmas Eve"), unit ("sleeps" or "days"), afterText (80).
type Look = { bg: string | null; number: string; words: string; date: string };
const COUNT_LOOKS: Record<number, Look> = {
  0: { bg: TAN_SOFT, number: CRIMSON, words: MAROON, date: SLATE },
  1: { bg: CRIMSON, number: CARD, words: CARD, date: CREAM_82 },
  3: { bg: HOLLY, number: GOLD, words: CREAM, date: CREAM_82 },
};

function countdown(b: Block, ctx: RenderCtx): string {
  const raw = str(b.data, "date").trim();
  const date = parseIsoDate(raw);
  if (!date) return "";
  const todayRaw = ctx.today && parseIsoDate(ctx.today) ? ctx.today : ukToday();
  const today = parseIsoDate(todayRaw) as { y: number; m: number; d: number };
  const left = Math.round((utc(date) - utc(today)) / DAY_MS);
  const label = cut(b.data, "label", 60);
  const after = cut(b.data, "afterText", 80);
  const days = b.data.unit === "days";
  const look = COUNT_LOOKS[b.variant];

  const sentence = (inner: string): string =>
    `<div style="padding:12px 40px"><p style="font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.6;margin:0">${inner}</p></div>`;
  const boxed = (inner: string): string => {
    if (!look) return sentence(inner);
    if (b.variant === 0) {
      return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${look.bg}" style="background:${look.bg};border-radius:12px;padding:22px 24px;text-align:center">${inner}</td></tr></table></div>`;
    }
    return `<div style="padding:8px 0">${band(look.bg as string, inner, "22px 40px")}</div>`;
  };

  if (left <= 0) {
    if (!after) return "";
    if (!look) return sentence(`<b style="color:${CRIMSON}">${esc(after)}</b>`);
    return boxed(`<div style="font-family:${HEAD};color:${look.words};font-size:22px;font-weight:700;line-height:1.3;margin:0">${esc(after)}</div>`);
  }

  const unit = left === 1 ? (days ? "day" : "sleep") : days ? "days" : "sleeps";
  const when = sayDate(date, today.y);
  if (!look) {
    return sentence(`<b style="color:${CRIMSON}">${left} ${unit}</b>${label ? ` ${esc(label)}` : ""} (${esc(when)})`);
  }
  return boxed(
    `<div style="font-family:${HEAD};color:${look.words};font-size:20px;font-weight:700;line-height:1.3;margin:0">` +
      `<span style="font-size:40px;font-weight:800;color:${look.number}">${left}</span> ${unit}${label ? ` ${esc(label)}` : ""}</div>` +
      `<div style="font-family:${BODY};color:${look.date};font-size:14px;line-height:1.5;margin-top:6px">${esc(when)}</div>`,
  );
}

// ---- liveTotal, Live total ---------------------------------------------------------------------
//   0: the big number over its words   1: a Workshop sign (lined paper, handwriting)
//   2: progress towards a target   3: one sentence
//
// data: source (redBag, sleigh, typed), typed (the typed number: "£" in front for money), before (60),
// after (60), fallbackText (120), hideBelow (default 1), target (the progress style), label (30), href,
// and sent: { value, at }, written only by the send (src/db/newsletters.ts freezeNewsletterLiveTotals).

/** A typed number: commas, spaces and a pound sign allowed. NaN when it is not a number. */
function typedNumber(value: unknown): { n: number; money: boolean } {
  const s = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const plain = s.replace(/[£,\s]/g, "");
  return { n: plain === "" ? NaN : Number(plain), money: s.startsWith("£") };
}

const sourceOf = (d: Data): LiveSource => (d.source === "sleigh" || d.source === "typed" ? d.source : "redBag");

/** The number a live total shows, before hideBelow is applied: frozen, else today's, else null. */
export function liveTotalNumber(d: Data, live: LiveNumbers | undefined): number | null {
  if (isRecord(d.sent) && "value" in d.sent) {
    const v = d.sent.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  const source = sourceOf(d);
  if (source === "typed") {
    const t = typedNumber(d.typed);
    return Number.isFinite(t.n) ? t.n : null;
  }
  const v = live?.[source];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Whether a live total has a number it may show: above zero, and at least hideBelow. */
export function liveTotalShows(d: Data, live: LiveNumbers | undefined): boolean {
  const n = liveTotalNumber(d, live);
  const floor = typedNumber(d.hideBelow);
  return n !== null && n > 0 && n >= (Number.isFinite(floor.n) ? floor.n : 1);
}

const count = (n: number): string => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** A number as its source says it: bags as a count, the sleigh's pence as pounds, typed as typed. */
function sayNumber(d: Data, n: number, typedMoney: boolean): string {
  const source = sourceOf(d);
  if (source === "sleigh") return pounds(n);
  return (typedMoney ? "£" : "") + count(n);
}

function liveTotal(b: Block, ctx: RenderCtx): string {
  const d = b.data;
  const before = cut(d, "before", 60);
  const after = cut(d, "after", 60);
  const fallback = cut(d, "fallbackText", 120);
  const money = sourceOf(d) === "typed" && typedNumber(d.typed).money;
  const shows = liveTotalShows(d, ctx.live);
  if (!shows && !fallback) return "";

  const href = str(d, "href").trim();
  const button = stickerButton(cut(d, "label", 30), looksSendable(href) ? href : "", "crimson", b.variant === 1 ? "left" : "center");
  const withButton = (inner: string): string => inner + (button ? `<div style="margin-top:14px">${button}</div>` : "");
  const plainSentence = (inner: string): string =>
    `<div style="padding:12px 40px">${withButton(`<p style="font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.6;margin:0">${inner}</p>`)}</div>`;

  if (!shows) {
    if (b.variant === 1) {
      return `<div style="padding:12px 40px">${paperCard(withButton(`<div style="font-family:${HAND};color:${INK};font-size:20px;line-height:1.4">${esc(fallback)}</div>`))}</div>`;
    }
    if (b.variant === 0) {
      return `<div style="padding:12px 40px;text-align:center">${withButton(`<div style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:700;line-height:1.3">${esc(fallback)}</div>`)}</div>`;
    }
    return plainSentence(esc(fallback));
  }

  const n = liveTotalNumber(d, ctx.live) as number;
  // The big styles stack the words on their own lines with display:block spans inside ONE block, so
  // the plain-text version (which breaks lines only at the end of a block) reads as one sentence.
  const oneLine = (...parts: string[]): string => `<div>${parts.filter(Boolean).join(" ")}</div>`;
  const number = esc(sayNumber(d, n, money));
  const words = (w: string): string => (w ? esc(w) : "");

  if (b.variant === 0) {
    return (
      `<div style="padding:12px 40px;text-align:center">` +
      withButton(
        oneLine(
          before ? `<span style="display:block;font-family:${BODY};color:${SLATE};font-size:14px;line-height:1.5;margin:0 0 2px">${words(before)}</span>` : "",
          `<span style="display:block;font-family:${HEAD};color:${CRIMSON};font-size:40px;font-weight:800;line-height:1.1">${number}</span>`,
          after ? `<span style="display:block;font-family:${HEAD};color:${MAROON};font-size:20px;font-weight:700;line-height:1.3;margin-top:4px">${words(after)}</span>` : "",
        ),
      ) +
      `</div>`
    );
  }
  if (b.variant === 1) {
    return (
      `<div style="padding:12px 40px">` +
      paperCard(
        withButton(
          oneLine(
            before ? `<span style="display:block;font-family:${HAND};color:${INK};font-size:18px;line-height:1.3">${words(before)}</span>` : "",
            `<span style="display:block;font-family:${HAND};color:${CRIMSON};font-size:40px;font-weight:700;line-height:1.15">${number}</span>`,
            after ? `<span style="display:block;font-family:${HAND};color:${INK};font-size:20px;line-height:1.3">${words(after)}</span>` : "",
          ),
        ),
      ) +
      `</div>`
    );
  }
  const line = [words(before), `<b style="font-family:${HEAD};color:${b.variant === 2 ? MAROON : CRIMSON};font-size:${b.variant === 2 ? 22 : 16}px">${number}</b>`, words(after)]
    .filter(Boolean)
    .join(" ");
  if (b.variant === 2) {
    const goal = typedNumber(d.target);
    const target = Number.isFinite(goal.n) && goal.n > 0 ? (sourceOf(d) === "sleigh" ? goal.n * 100 : goal.n) : 0;
    let bar = "";
    if (target > 0) {
      const pc = Math.max(2, Math.min(100, Math.round((n * 100) / target)));
      bar =
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px"><tr><td bgcolor="${TAN_SOFT}" style="background:${TAN_SOFT};border-radius:999px;height:14px;font-size:0;line-height:0">` +
        `<div style="width:${pc}%;background:${CRIMSON};border-radius:999px;height:14px;font-size:0;line-height:0">&nbsp;</div></td></tr></table>` +
        `<div style="font-family:${BODY};color:${SLATE};font-size:13px;line-height:1.5;margin-top:6px">Our target: ${esc(sayNumber(d, target, money || goal.money))}</div>`;
    }
    return `<div style="padding:12px 40px">${withButton(`<div style="font-family:${BODY};color:${SLATE};font-size:16px;line-height:1.5">${line}</div>${bar}`)}</div>`;
  }
  return plainSentence(line);
}

// ---- freezing the number for a send ------------------------------------------------------------

const blocksOf = (doc: unknown): Data[] =>
  isRecord(doc) && Array.isArray(doc.blocks) ? (doc.blocks as unknown[]).filter(isRecord) : [];
const isLiveTotal = (b: Data): boolean => b.type === "liveTotal" && isRecord(b.data);

/** The sources a newsletter's live totals read, once each, in the order they first appear. */
export function liveSourcesIn(doc: unknown): ReadSource[] {
  const found: ReadSource[] = [];
  for (const b of blocksOf(doc)) {
    if (!isLiveTotal(b)) continue;
    const source = sourceOf(b.data as Data);
    if (source !== "typed" && !found.includes(source)) found.push(source);
  }
  return found;
}

/**
 * The document with `data.sent = { value, at }` set on each live total that reads a source, and
 * nothing else changed. A source missing from `values`, or null there, freezes "no number": every
 * reader of that send then gets the fallback words. Returns a new document; the one given is untouched.
 */
export function withFrozenTotals(doc: unknown, values: LiveNumbers, at: string): unknown {
  if (!isRecord(doc) || !Array.isArray(doc.blocks)) return doc;
  return {
    ...doc,
    blocks: (doc.blocks as unknown[]).map((b) => {
      if (!isRecord(b) || !isLiveTotal(b)) return b;
      const source = sourceOf(b.data as Data);
      if (source === "typed") return b;
      const v = values[source];
      return { ...b, data: { ...(b.data as Data), sent: { value: typeof v === "number" && Number.isFinite(v) ? v : null, at } } };
    }),
  };
}

/** The document without any frozen number, so one never leaks into a new draft or a template. */
export function withoutFrozenTotals<T>(doc: T): T {
  if (!blocksOf(doc).some((b) => isLiveTotal(b) && "sent" in (b.data as Data))) return doc;
  const d = doc as unknown as Data;
  return {
    ...d,
    blocks: (d.blocks as unknown[]).map((b) => {
      if (!isRecord(b) || !isLiveTotal(b) || !("sent" in (b.data as Data))) return b;
      const { sent: _sent, ...rest } = b.data as Data;
      return { ...b, data: rest };
    }),
  } as unknown as T;
}

// ---- the register ------------------------------------------------------------------------------

export const LIVE_RENDERERS: Record<LivePaperType, (b: Block, ctx: RenderCtx) => string> = { liveTotal, countdown };
