// The checks before sending for the paper look blocks (14 November 2026), and the square-bracket
// finder every newsletter now uses. Called from ./preflight.ts, which owns the messages for the
// classic blocks; a classic block is never looked at here, so their checks cannot change.
// Pure: no database, no clock (today's date is passed in).
import type { BlockType } from "./blocks";
import type { PreflightFinding } from "./preflight";
import { looksSendable } from "./link-safety";
import { parseIsoDate } from "./paper-blocks";
import { liveTotalShows } from "./live-blocks";
import type { LiveNumbers } from "./theme";

/** Above this, the finished email risks being cut short by Gmail (which clips near 102 KB). */
export const BIG_EMAIL_BYTES = 80 * 1024;

type Data = Record<string, unknown>;
const isRecord = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (d: Data, k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
const list = (d: Data, k: string): Data[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter(isRecord) : []);
const hasPicture = (d: Data, k: string): boolean => /^https?:\/\/\S+$/i.test(str(d, k).trim());
const noAlt = (d: Data, pictureKey: string): boolean => hasPicture(d, pictureKey) && !str(d, "alt").trim();
const filled = (d: Data, keys: string[]): boolean => keys.some((k) => str(d, k).trim() !== "");

export interface PaperChecks {
  imagesWithoutAlt: number;
  deadLinks: number;
  findings: PreflightFinding[];
}

const warn = (message: string): PreflightFinding => ({ level: "warn", message });
const block = (message: string): PreflightFinding => ({ level: "block", message });

/** What one block adds to the checks. Nothing at all for a classic block. */
/** TASK-646: what the live blocks' checks may know: the UK day it is scheduled to send, today's numbers. */
export interface LiveCheckContext {
  sendDay?: string;
  live?: LiveNumbers;
}

export function paperBlockChecks(type: BlockType, variant: number, raw: unknown, today?: string, extra: LiveCheckContext = {}): PaperChecks {
  const data: Data = isRecord(raw) ? raw : {};
  const out: PaperChecks = { imagesWithoutAlt: 0, deadLinks: 0, findings: [] };

  if (type === "hero") {
    if (noAlt(data, "imageUrl")) out.imagesWithoutAlt++;
    if (!str(data, "headline").trim()) {
      out.findings.push(warn("A picture header has no headline. The headline is what readers see first, even with pictures off."));
    }
  }

  if (type === "photoRow") {
    const photos = list(data, "items").filter((p) => hasPicture(p, "url"));
    out.imagesWithoutAlt += photos.filter((p) => !str(p, "alt").trim()).length;
    if (photos.length < 2) out.findings.push(warn("A photo row has fewer than two photos."));
  }

  if (type === "note" && !str(data, "text").trim()) out.findings.push(warn("A handwritten note is empty."));

  if (type === "eventCard") {
    const keys = ["imageUrl", "day", "month", "date", "name", "when", "location", "body"];
    const listed = list(data, "items").filter((e) => filled(e, keys));
    const events = variant === 3 && listed.length > 0 ? listed : [data];
    for (const e of events) {
      if (variant !== 2 && noAlt(e, "imageUrl")) out.imagesWithoutAlt++;
      if (!looksSendable(str(e, "href"))) out.deadLinks++;
      const date = parseIsoDate(str(e, "date"));
      if (today && date && str(e, "date").trim() < today) {
        out.findings.push(warn("An event card is for a date that has already passed."));
      }
    }
  }

  if (type === "logoStrip") {
    const logos = list(data, "items").filter((p) => hasPicture(p, "url"));
    if (logos.some((p) => !str(p, "name").trim())) {
      out.findings.push(block("A partner logo has no name. Readers with pictures off, and the plain-text version, would not know who it is."));
    }
    if (data.showNames === false && logos.length > 0) {
      out.findings.push(warn("The partners' names are switched off, so readers with pictures off will not see who they are."));
    }
  }

  if (type === "giftTags") {
    for (const t of list(data, "items").filter((t) => filled(t, ["title", "body"]))) {
      if (!looksSendable(str(t, "href"))) out.deadLinks++;
    }
  }

  if (type === "bagList") {
    if (variant === 2 && !looksSendable(str(data, "href"))) out.deadLinks++;
    const words = [str(data, "title"), str(data, "footnote"), ...list(data, "items").map((i) => str(i, "name"))].join(" ");
    if (/\bwill (buy|pay for|fund)\b/i.test(words)) {
      out.findings.push(warn('A bag list says what a gift "will buy". Say what it "could" do instead: a gift goes where it is needed most.'));
    }
  }

  if (type === "paperStory") {
    if (variant !== 3 && noAlt(data, "imageUrl")) out.imagesWithoutAlt++;
    const href = str(data, "href").trim();
    if (href && !looksSendable(href)) out.deadLinks++;
  }

  // TASK-646: the live blocks.
  if (type === "countdown") {
    const raw = str(data, "date").trim();
    if (!parseIsoDate(raw)) {
      out.findings.push(block("A countdown has no date, or its date is not a real date, so it would show nothing."));
    } else if (today && raw <= today) {
      out.findings.push(warn("A countdown's day has already come, so readers would see its words for after the day, or nothing, instead of a count."));
    } else if (extra.sendDay && raw <= extra.sendDay) {
      out.findings.push(warn("A countdown's day comes before this is scheduled to send, so readers would not see a count."));
    }
  }

  if (type === "liveTotal") {
    const href = str(data, "href").trim();
    if (href && !looksSendable(href)) out.deadLinks++;
    // Only when the number is known: a typed one always is; a read one when today's numbers were given.
    const source = data.source === "sleigh" || data.source === "typed" ? data.source : "redBag";
    const known = source === "typed" || (extra.live !== undefined && source in extra.live);
    if (known && !liveTotalShows(data, extra.live)) {
      out.findings.push(warn("A live total has no number to show right now, so readers would see its words for when there is no number, or nothing."));
    }
  }

  return out;
}

// A note in square brackets: something inside the brackets, on one line. "[]" and a stray "]" are not
// notes.
const NOTE = /\[[^[\]\n]*[^\s[\]][^[\]\n]*\]/g;

/** Every [note] left in the subject or in any words of any block, in the order they appear. */
export function bracketNotes(subject: string, datas: unknown[]): string[] {
  const found: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") found.push(...(v.match(NOTE) ?? []));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (isRecord(v)) Object.values(v).forEach(walk);
  };
  walk(subject);
  datas.forEach(walk);
  return found;
}
