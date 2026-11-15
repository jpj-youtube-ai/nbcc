// The paper look blocks (Jaimie, 14 November 2026): newsletter building blocks in the look of the newer
// pages. Fill a Red Bag's lined paper and handwriting, the home page's hanging gift tags, taped
// prints, and the chunky "sticker" button.
//
// Every one is a NEW block type with its own helpers. Nothing here changes an existing block, the
// frame, brandButton, the merge or the colours (test/unit/newsletter-golden.test.ts pins all of those
// byte for byte); this file only reads the theme's constants.
//
// An email is not a web page, so the look is rebuilt from what every mail client has:
//   * tables and inline styles only: no position, transform, clip-path, flex, grid, gradients or SVG;
//   * no web font: the handwriting is a stack of faces already on the reader's machine;
//   * no media queries: columns never stack on a phone, so every column is a percentage;
//   * art is hosted PNG or JPG in assets/img/email (scripts/build-email-art.mjs), already flattened
//     onto the colour it sits on;
//   * words are always live text, never part of a picture, so a block still reads with pictures off
//     and in the plain-text version (which is made from this HTML and drops pictures).
//
// Every renderer treats its data as untrusted: fields are read as strings, cut to their limit and
// escaped; a link is written only if it is one we would send, a picture only from a web address.
// Pure: no database, no clock.
import type { Block } from "./blocks";
import {
  type RenderCtx,
  escapeHtml,
  proseHtml,
  MAROON,
  CRIMSON,
  CREAM,
  CREAM_82,
  SLATE,
  SLATE_SOFT,
  TAN_SOFT,
  HEAD,
  BODY,
  LINE,
} from "./theme";
import { looksSendable } from "./link-safety";

export const STILL_PAPER_TYPES = [
  "hero",
  "photoRow",
  "note",
  "eventCard",
  "logoStrip",
  "giftTags",
  "bagList",
  "trim",
  "paperStory",
] as const;
export type StillPaperType = (typeof STILL_PAPER_TYPES)[number];

// ---- the look ----------------------------------------------------------------------------------

/** Where the email art is served from (the LOGO_URL pattern: an email needs a full address). */
export const EMAIL_ART = "https://nbcc.scot/assets/img/email/";

// The newer pages' colours, as the site's stylesheet has them. The theme's own are imported above.
const CARD = "#FFFDFA"; // a paper card
const WHITE = "#FFFFFF"; // a photo print's frame
const KRAFT = TAN_SOFT; // a kraft card
const HOLLY = "#1A531A";
const GOLD = "#D9A93E";
const TAN = "#D29C8A";
const INK = "#5C1818"; // the sticker edge: the logo's maroon-brown outline
const MARGIN_LINE = "#E39AA3"; // a ruled pad's red margin line, as it shows on the paper
const RULED = "#D6D5D2"; // a ruled pad's lines, as they show on the paper

// The paper's hand. The pages use Caveat, which a mail client will not load, so this is the rest of
// their stack: faces already on Windows, Macs and iPhones, ending in whatever "cursive" is.
const HAND = "'Segoe Print','Bradley Hand','Noteworthy','Ink Free','Comic Sans MS',cursive";

// The pictures the renderers themselves draw with. Each is a file in assets/img/email.
const ART_FILES = [
  "tape-top.png",
  "tape-on-card.png",
  "tape-on-white.png",
  "tape-on-kraft.png",
  "tag-top-card.png",
  "tag-top-crimson.png",
  "tag-top-holly.png",
  "tag-top-tan.png",
  "trim-bow.png",
  "trim-snow.png",
  "trim-torn.png",
  "trim-stars.png",
] as const;
const art = (name: (typeof ART_FILES)[number]): string => `${EMAIL_ART}${name}`;

/** The Red Bag paintings a bag list may draw: assets/img/email/item-<key>.png. */
export const BAG_PICS: readonly string[] = [
  "blanket", "insulated-cup", "toiletry-set", "toy", "soft-toy", "headphones", "book", "colouring-book",
  "pencil", "notebook", "pyjamas", "socks", "hat-gloves", "present",
  "crisis-15", "crisis-30", "crisis-60", "school-25", "school-35", "school-40", "hand-20", "hand-75", "hand-150",
];

/** Every file the renderers can name, for the test that checks each one is really there. */
export const EMAIL_ART_FILES: readonly string[] = [...ART_FILES, ...BAG_PICS.map((key) => `item-${key}.png`)];

// ---- reading data ------------------------------------------------------------------------------

type Data = Record<string, unknown>;
const isRecord = (v: unknown): v is Data => typeof v === "object" && v !== null && !Array.isArray(v);
const esc = escapeHtml;
const str = (d: Data, k: string): string => (typeof d[k] === "string" ? (d[k] as string) : "");
/** At most `max` characters (whole characters: an emoji is never cut in half). */
const limit = (value: string, max: number): string => Array.from(value).slice(0, max).join("");
/** A one-line field: trimmed, and cut to its limit rather than refused, so an old draft always opens. */
const cut = (d: Data, k: string, max: number): string => limit(str(d, k).trim(), max);
/** A prose field: its line breaks kept, cut to its limit. */
const prose = (d: Data, k: string, max: number): string => limit(str(d, k), max).trim();
const list = (d: Data, k: string): Data[] => (Array.isArray(d[k]) ? (d[k] as unknown[]).filter(isRecord) : []);
/** A picture's address, or "" unless it is a web address: an email cannot show anything else. */
const picture = (d: Data, k: string): string => {
  const url = str(d, k).trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : "";
};
/** A link, or "" unless it is one we would send. */
const link = (d: Data, k: string): string => {
  const url = str(d, k).trim();
  return looksSendable(url) ? url : "";
};

// ---- parts -------------------------------------------------------------------------------------

/** A picture that fills its column up to `width`, and shrinks with it on a phone. */
function img(src: string, alt: string, width: number, extra = ""): string {
  return `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0${extra}" />`;
}

/**
 * A picture that fills whatever it is in, edge to edge: a header picture, the top of a card. The width
 * attribute is for Outlook on a desktop, which ignores the style. No max-width: the email's card can
 * come out a few pixels wider than 636 (its footer's contact line does not wrap), and a capped
 * picture would leave a sliver of cream down its right side.
 */
function fill(src: string, alt: string, width: number, extra = ""): string {
  return `<img src="${esc(src)}" alt="${esc(alt)}" width="${width}" style="display:block;width:100%;height:auto;border:0${extra}" />`;
}

/** A small piece of art at a fixed width, centred, for the eye only. */
function ornament(name: (typeof ART_FILES)[number], width: number): string {
  return `<div style="font-size:0;line-height:0"><img src="${art(name)}" alt="" width="${width}" style="display:block;width:${width}px;height:auto;border:0;margin:0 auto" /></div>`;
}

/** A full-width band of colour, as a table cell (a mail client keeps a cell's background and padding). */
function band(bg: string, inner: string, padding: string, extra = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="${bg}" style="background:${bg};padding:${padding};text-align:center${extra}">${inner}</td></tr></table>`;
}

const gap = (px: number): string => `<div style="height:${px}px;font-size:0;line-height:0">&nbsp;</div>`;

export type StickerTone = "crimson" | "paper" | "holly" | "gold";
const STICKER: Record<StickerTone, { bg: string; fg: string; edge: string }> = {
  crimson: { bg: CRIMSON, fg: CARD, edge: INK },
  paper: { bg: CARD, fg: INK, edge: INK },
  holly: { bg: HOLLY, fg: CARD, edge: "#0C2A0C" },
  gold: { bg: GOLD, fg: INK, edge: INK },
};

/**
 * The chunky button of the newer pages: an outline and a thick darker edge underneath, drawn as the
 * borders of a table cell (a shadow would not survive most mail clients). Not brandButton, which the
 * classic blocks keep. Nothing at all without a label, or without a link we would send.
 */
export function stickerButton(label: string, href: string, tone: StickerTone = "crimson", align: "center" | "left" = "center"): string {
  const text = label.trim();
  const url = href.trim();
  if (!text || !looksSendable(url)) return "";
  const t = STICKER[tone] ?? STICKER.crimson;
  const place = align === "left" ? ' style="margin:0"' : ' align="center" style="margin:0 auto"';
  return `<table role="presentation" cellpadding="0" cellspacing="0"${place}><tr><td style="background:${t.bg};border:2px solid ${t.edge};border-bottom:5px solid ${t.edge};border-radius:14px;padding:10px 22px"><a href="${esc(url)}" style="font-family:${BODY};font-weight:700;font-size:15px;color:${t.fg};text-decoration:none">${esc(text)}</a></td></tr></table>`;
}

// Tape is two pictures: the top half sits above a card, on the email's cream; the bottom half is the
// first thing inside the card, on the card's own colour. The card's top border shows between them
// like the paper's edge through the tape, and with pictures off it is simply a card.
const tapeTop = (width: number): string => ornament("tape-top.png", width);
const tapeOn = (surface: "card" | "white" | "kraft", width: number): string => ornament(`tape-on-${surface}.png`, width);

/** A photo as a print: a white frame, taped at the top, with an optional handwritten caption. */
function print(src: string, alt: string, width: number, caption: string, tape: number): string {
  const words = caption
    ? `<div style="font-family:${HAND};color:${INK};font-size:16px;line-height:1.3;margin-top:8px;text-align:center">${esc(caption)}</div>`
    : "";
  return (
    tapeTop(tape) +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${WHITE};border:1px solid ${LINE};padding:0 8px 10px">` +
    `${tapeOn("white", tape)}${gap(6)}${img(src, alt, width)}${words}</td></tr></table>`
  );
}

/**
 * A card of lined-pad paper with the red margin line every ruled pad has: a narrow first cell with a
 * pale crimson right border. The words' cell is padded so that it sits centred in the card (14px on
 * the left after the 20px margin, 33px on the right), which is what lines the two halves of the tape up.
 */
function paperCard(inner: string, taped = false): string {
  return (
    (taped ? tapeTop(112) : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:3px"><tr>` +
    `<td width="18" style="width:18px;border-right:1px solid ${MARGIN_LINE};font-size:0;line-height:0">&nbsp;</td>` +
    `<td style="padding:${taped ? "0" : "18px"} 33px 20px 14px">${taped ? tapeOn("card", 112) + gap(8) : ""}${inner}</td>` +
    `</tr></table>`
  );
}

// ---- hero, the picture header ------------------------------------------------------------------
// A big picture and a headline to open an issue. The headline is always live text.
//   0: the picture edge to edge, then the words on cream
//   1: the picture, then the words on a maroon band
//   2: "night": the words on a holly band with a gold eyebrow, then the picture
//   3: art beside the words
//
// data: imageUrl, alt (140), eyebrow (40), headline (80), subline (160). Words alone without a
// picture; the picture alone without words; nothing with neither.
function hero(b: Block): string {
  const src = picture(b.data, "imageUrl");
  const alt = cut(b.data, "alt", 140);
  const eyebrow = cut(b.data, "eyebrow", 40);
  const headline = cut(b.data, "headline", 80);
  const subline = cut(b.data, "subline", 160);
  const hasWords = Boolean(eyebrow || headline || subline);
  if (!src && !hasWords) return "";

  const words = (c: { eyebrow: string; headline: string; subline: string }): string =>
    (eyebrow
      ? `<div style="font-family:${BODY};color:${c.eyebrow};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px">${esc(eyebrow)}</div>`
      : "") +
    (headline
      ? `<h1 style="font-family:${HEAD};color:${c.headline};font-size:28px;font-weight:800;line-height:1.15;margin:0">${esc(headline)}</h1>`
      : "") +
    (subline
      ? `<p style="font-family:${BODY};color:${c.subline};font-size:16px;line-height:1.5;margin:8px 0 0">${esc(subline)}</p>`
      : "");
  const onCream = { eyebrow: CRIMSON, headline: MAROON, subline: SLATE };
  const onDark = { eyebrow: GOLD, headline: CREAM, subline: CREAM_82 };
  const wide = src ? fill(src, alt, 636) : "";

  if (b.variant === 1) return wide + (hasWords ? band(MAROON, words(onDark), "22px 40px 24px") : "");
  if (b.variant === 2) return (hasWords ? band(HOLLY, words(onDark), "24px 40px 22px") : "") + wide;
  if (b.variant === 3) {
    if (!src) return `<div style="padding:20px 40px 8px">${words(onCream)}</div>`;
    return `<div style="padding:20px 40px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;width:36%">${img(src, alt, 200)}</td><td style="vertical-align:middle;padding-left:20px">${words(onCream)}</td></tr></table></div>`;
  }
  return wide + (hasWords ? `<div style="padding:20px 40px 8px;text-align:center">${words(onCream)}</div>` : "");
}

// ---- photoRow, the photo row -------------------------------------------------------------------
// Two or three photos side by side. They stay side by side on a phone (an email cannot stack them),
// so each column is a share of the width. No tilt: a mail client cannot turn a picture.
//   0: two photos   1: three photos   2: two prints   3: three prints
// A print is a white frame with tape above it and a handwritten caption.
//
// data: items of { url, alt (140), caption (60) }. An item with no photo is left out; nothing is
// drawn when none has one.
function photoRow(b: Block): string {
  const three = b.variant === 1 || b.variant === 3;
  const prints = b.variant >= 2;
  const photos = list(b.data, "items")
    .map((item) => ({ src: picture(item, "url"), alt: cut(item, "alt", 140), caption: cut(item, "caption", 60) }))
    .filter((p) => p.src)
    .slice(0, three ? 3 : 2);
  if (photos.length === 0) return "";

  const share = three ? "33%" : "50%";
  const width = three ? 176 : 272;
  const cells = photos
    .map((p) => {
      const inner = prints
        ? print(p.src, p.alt, width - 18, p.caption, 80)
        : img(p.src, p.alt, width, ";border-radius:10px") +
          (p.caption
            ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;line-height:1.4;margin-top:6px;text-align:center">${esc(p.caption)}</div>`
            : "");
      return `<td style="vertical-align:top;width:${share};padding:0 6px">${inner}</td>`;
    })
    .join("");
  return `<div style="padding:12px 34px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></div>`;
}

// ---- note, the handwritten note ----------------------------------------------------------------
// A thank-you or a quote, written by hand on paper.
//   0: a paper card with the red margin line   1: the same, taped
//   2: large handwriting, no card              3: a kraft card, taped
//
// data: text (600, prose: **bold**, *italic* and line breaks), from (60), role (60). Nothing without
// the note itself.
function note(b: Block): string {
  const words = prose(b.data, "text", 600);
  if (!words) return "";
  const from = cut(b.data, "from", 60);
  const role = cut(b.data, "role", 60);
  const body =
    `<p style="font-family:${HAND};color:${SLATE};font-size:${b.variant === 2 ? 24 : 20}px;line-height:1.5;margin:0">&ldquo;${proseHtml(words)}&rdquo;</p>` +
    (from
      ? `<p style="font-family:${HAND};color:${CRIMSON};font-size:20px;font-weight:700;line-height:1.3;margin:10px 0 0">${esc(from)}</p>`
      : "") +
    (role ? `<p style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;line-height:1.4;margin:2px 0 0">${esc(role)}</p>` : "");

  if (b.variant === 2) return `<div style="padding:12px 40px;text-align:center">${body}</div>`;
  if (b.variant === 3) {
    return (
      `<div style="padding:12px 40px">${tapeTop(112)}` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${KRAFT};border:1px solid ${TAN};border-radius:3px"><tr>` +
      `<td style="padding:0 24px 20px">${tapeOn("kraft", 112)}${gap(8)}${body}</td></tr></table></div>`
    );
  }
  return `<div style="padding:12px 40px">${paperCard(body, b.variant === 1)}</div>`;
}

// ---- eventCard, the event card -----------------------------------------------------------------
// One event with its picture, date badge and button.
//   0: picture on top   1: picture left   2: a ticket (a crimson date stub, a dashed tear line)
//   3: two cards side by side, from items (or from its own fields when the list is empty)
//
// data: imageUrl, alt (140), date (YYYY-MM-DD, optional), day (10), month (10), name (80), when (60),
// location (80), body (240), label (30), href; items of the same. The badge takes its day and month
// from the date when they are left blank, so one date field is enough; they can still be typed for a
// run of nights ("1 to 24", "DEC"). No button without a link we would send.
const MONTHS_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A real calendar date written YYYY-MM-DD, or null (31 February is not a date). */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const when = new Date(Date.UTC(y, m - 1, d));
  if (when.getUTCFullYear() !== y || when.getUTCMonth() !== m - 1 || when.getUTCDate() !== d) return null;
  return { y, m, d };
}

interface EventBits {
  src: string;
  alt: string;
  day: string;
  month: string;
  name: string;
  when: string;
  location: string;
  body: string;
  label: string;
  href: string;
}

function eventBits(d: Data): EventBits {
  const date = parseIsoDate(str(d, "date"));
  return {
    src: picture(d, "imageUrl"),
    alt: cut(d, "alt", 140),
    day: cut(d, "day", 10) || (date ? String(date.d) : ""),
    month: cut(d, "month", 10) || (date ? MONTHS_SHORT[date.m - 1] : ""),
    name: cut(d, "name", 80),
    when: cut(d, "when", 60),
    location: cut(d, "location", 80),
    body: prose(d, "body", 240),
    label: cut(d, "label", 30),
    href: link(d, "href"),
  };
}
const eventIsEmpty = (e: EventBits): boolean => !(e.src || e.day || e.month || e.name || e.when || e.location || e.body);

// The day over the month. Two spans with a space between, not two divs, so the plain text reads
// "12 DEC" on one line.
function dateStack(e: EventBits, daySize: number, monthSize: number): string {
  return (
    `<span style="display:block;font-family:${HEAD};font-size:${daySize}px;font-weight:800;line-height:1.05">${esc(e.day)}</span> ` +
    `<span style="display:block;font-family:${BODY};font-size:${monthSize}px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:2px">${esc(e.month)}</span>`
  );
}

function eventWords(e: EventBits, titleSize: number, dateLine: boolean): string {
  return (
    (dateLine && (e.day || e.month)
      ? `<div style="font-family:${BODY};color:${CRIMSON};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 3px">${esc(`${e.day} ${e.month}`.trim())}</div>`
      : "") +
    (e.name
      ? `<h3 style="font-family:${HEAD};color:${MAROON};font-size:${titleSize}px;font-weight:800;line-height:1.2;margin:0">${esc(e.name)}</h3>`
      : "") +
    (e.when
      ? `<div style="font-family:${BODY};color:${SLATE};font-size:14px;font-weight:700;line-height:1.4;margin-top:4px">${esc(e.when)}</div>`
      : "") +
    (e.location
      ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:13px;line-height:1.4;margin-top:2px">${esc(e.location)}</div>`
      : "") +
    (e.body ? `<p style="font-family:${BODY};color:${SLATE};font-size:14px;line-height:1.55;margin:8px 0 0">${proseHtml(e.body)}</p>` : "") +
    (e.href ? `<div style="margin-top:12px">${stickerButton(e.label || "Find out more", e.href, "crimson", "left")}</div>` : "")
  );
}

const CARD_TABLE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:12px">`;
const pictureRow = (e: EventBits, width: number): string =>
  e.src ? `<tr><td style="font-size:0;line-height:0">${fill(e.src, e.alt, width, ";border-radius:11px 11px 0 0")}</td></tr>` : "";

function eventCard(b: Block): string {
  if (b.variant === 3) {
    const own = eventBits(b.data);
    const listed = list(b.data, "items").map(eventBits).filter((e) => !eventIsEmpty(e)).slice(0, 2);
    const events = listed.length > 0 ? listed : eventIsEmpty(own) ? [] : [own];
    if (events.length === 0) return "";
    // Two cards that end level whatever their pictures' shapes: one table, a row of pictures over a
    // row of words, each column drawn as a card by its cells' borders, with a cream cell between.
    const side = `background:${CARD};border-left:1px solid ${LINE};border-right:1px solid ${LINE}`;
    const between = `<td width="12" style="width:12px;font-size:0;line-height:0">&nbsp;</td>`;
    const pictures = events
      .map(
        (e) =>
          `<td style="vertical-align:top;width:50%;${side};border-top:1px solid ${LINE};border-radius:12px 12px 0 0;font-size:0;line-height:0">${e.src ? fill(e.src, e.alt, 270, ";border-radius:11px 11px 0 0") : "&nbsp;"}</td>`,
      )
      .join(between);
    const words = events
      .map(
        (e) =>
          `<td style="vertical-align:top;width:50%;${side};border-bottom:1px solid ${LINE};border-radius:0 0 12px 12px;padding:12px 14px 14px">${eventWords(e, 16, true)}</td>`,
      )
      .join(between);
    // One event still takes half the width, as a card of the same size as it would be beside another.
    const spare = events.length === 1 ? `${between}<td style="width:50%">&nbsp;</td>` : "";
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pictures}${spare}</tr><tr>${words}${spare}</tr></table></div>`;
  }

  const e = eventBits(b.data);
  if (eventIsEmpty(e)) return "";
  const dated = Boolean(e.day || e.month);

  if (b.variant === 1) {
    const pic = e.src
      ? `<td style="vertical-align:top;width:38%;padding:14px 0 14px 14px">${img(e.src, e.alt, 200, ";border-radius:8px")}</td>`
      : "";
    return `<div style="padding:12px 40px">${CARD_TABLE}<tr>${pic}<td style="vertical-align:top;padding:14px 16px 16px">${eventWords(e, 18, true)}</td></tr></table></div>`;
  }

  if (b.variant === 2) {
    const stub = dated
      ? `<td width="92" style="width:92px;vertical-align:middle;background:${CRIMSON};color:${CARD};text-align:center;padding:16px 6px;border-radius:11px 0 0 11px">${dateStack(e, 28, 12)}</td>`
      : "";
    return `<div style="padding:12px 40px">${CARD_TABLE}<tr>${stub}<td style="vertical-align:middle;border-left:2px dashed ${LINE};padding:16px 18px">${eventWords(e, 20, false)}</td></tr></table></div>`;
  }

  // The badge is a little table inside its cell, not the cell itself: a cell stretches to the height of
  // its row, and the badge would become a tall crimson bar beside a long description.
  const badge = dated
    ? `<td width="64" style="width:64px;vertical-align:top"><table role="presentation" width="64" cellpadding="0" cellspacing="0"><tr><td style="background:${CRIMSON};color:${CARD};text-align:center;padding:10px 2px;border-radius:8px">${dateStack(e, 22, 10)}</td></tr></table></td>`
    : "";
  return (
    `<div style="padding:12px 40px">${CARD_TABLE}${pictureRow(e, 554)}<tr><td style="padding:16px 18px 18px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${badge}<td style="vertical-align:top;padding-left:${dated ? 14 : 0}px">${eventWords(e, 18, false)}</td></tr></table>` +
    `</td></tr></table></div>`
  );
}

// ---- logoStrip, the partner logos --------------------------------------------------------------
//   0: one row of four   1: two rows of three   2: one partner with words beside   3: on a white band
//
// data: heading (60), showNames (anything but false is on), items of { url, name (60), href }.
// The partners' names are printed in a small line under the logos by default: the plain-text version
// and a reader with pictures off see no logo. The NAMES carry the links, so the plain text reads
// "Name (address)" rather than a bare address; a logo is itself a link only with the names off.
function logoStrip(b: Block): string {
  const heading = cut(b.data, "heading", 60);
  const showNames = b.data.showNames !== false;
  const partners = list(b.data, "items")
    .map((item) => ({ src: picture(item, "url"), name: cut(item, "name", 60), href: link(item, "href") }))
    .filter((p) => p.src || p.name)
    .slice(0, [4, 6, 1, 4][b.variant] ?? 4);
  if (partners.length === 0) return "";

  type Partner = (typeof partners)[number];
  const logo = (p: Partner, width: number): string => {
    if (!p.src) return "";
    const pic = img(p.src, p.name, width, ";margin:0 auto");
    return !showNames && p.href ? `<a href="${esc(p.href)}" style="text-decoration:none">${pic}</a>` : pic;
  };
  const nameOf = (p: Partner): string =>
    p.href ? `<a href="${esc(p.href)}" style="color:${CRIMSON};text-decoration:underline">${esc(p.name)}</a>` : esc(p.name);
  const named = showNames ? partners.filter((p) => p.name) : [];

  if (b.variant === 2) {
    const p = partners[0];
    const words =
      (heading
        ? `<div style="font-family:${HEAD};color:${MAROON};font-size:18px;font-weight:800;line-height:1.3">${esc(heading)}</div>`
        : "") +
      (named.length
        ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:14px;line-height:1.4;margin-top:2px">${nameOf(p)}</div>`
        : "");
    const pic = p.src ? `<td style="vertical-align:middle;width:34%">${logo(p, 160)}</td>` : "";
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pic}<td style="vertical-align:middle;padding-left:${p.src ? 18 : 0}px">${words}</td></tr></table></div>`;
  }

  const head = heading
    ? `<div style="font-family:${BODY};color:${SLATE_SOFT};font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-align:center;margin:0 0 10px">${esc(heading)}</div>`
    : "";
  const withLogo = partners.filter((p) => p.src);
  const perRow = b.variant === 1 ? 3 : 4;
  let rows = "";
  for (let i = 0; i < withLogo.length; i += perRow) {
    rows += `<tr>${withLogo
      .slice(i, i + perRow)
      .map((p) => `<td style="vertical-align:middle;text-align:center;width:${perRow === 3 ? "33%" : "25%"};padding:6px 8px">${logo(p, 120)}</td>`)
      .join("")}</tr>`;
  }
  const grid = rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>` : "";
  const names = named.length
    ? `<p style="font-family:${BODY};color:${SLATE_SOFT};font-size:12px;line-height:1.6;margin:10px 0 0;text-align:center">${named.map(nameOf).join(", ")}</p>`
    : "";
  if (!grid && !names) return "";

  const inner = head + grid + names;
  if (b.variant === 3) return band(WHITE, inner, "18px 32px", `;border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}`);
  return `<div style="padding:12px 32px">${inner}</div>`;
}

// ---- giftTags, the gift tags -------------------------------------------------------------------
// The home page's hanging tags, as two or three choices.
//   0: three across   1: two across   2: stacked, one under another   3: one large
//
// data: items of { title (30), body (90), label (24), href, colour }. The page cuts a tag's corners
// and punches its hole with clip-path and a mask; here the top of a tag is a hosted picture in its
// colour (the corners, the hole, the gold string) over a plain coloured cell, so with pictures off it
// is a coloured card. A tag with no colour, or one we do not have, takes the next in turn.
const TAG_COLOURS = ["card", "crimson", "holly", "tan"] as const;
type TagColour = (typeof TAG_COLOURS)[number];
const TAG_LOOK: Record<TagColour, { bg: string; title: string; text: string; button: StickerTone; edged: boolean }> = {
  card: { bg: CARD, title: MAROON, text: SLATE, button: "crimson", edged: true },
  crimson: { bg: CRIMSON, title: CARD, text: CARD, button: "paper", edged: false },
  holly: { bg: HOLLY, title: CARD, text: CARD, button: "paper", edged: false },
  tan: { bg: TAN, title: MAROON, text: SLATE, button: "paper", edged: false },
};
const isTagColour = (value: string): value is TagColour => (TAG_COLOURS as readonly string[]).includes(value);

function giftTags(b: Block): string {
  const tags = list(b.data, "items")
    .map((item) => ({
      title: cut(item, "title", 30),
      body: cut(item, "body", 90),
      label: cut(item, "label", 24),
      href: link(item, "href"),
      colour: str(item, "colour").trim(),
    }))
    .filter((t) => t.title || t.body)
    .slice(0, [3, 2, 3, 1][b.variant] ?? 3);
  if (tags.length === 0) return "";

  const tag = (t: (typeof tags)[number], n: number, width: number, big: boolean): string => {
    const colour: TagColour = isTagColour(t.colour) ? t.colour : TAG_COLOURS[n % 3];
    const look = TAG_LOOK[colour];
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:0;line-height:0">` +
      `<img src="${art(`tag-top-${colour}.png`)}" alt="" width="${width}" style="display:block;width:100%;height:auto;border:0" /></td></tr>` +
      `<tr><td bgcolor="${look.bg}" style="background:${look.bg};${look.edged ? `border:1px solid ${LINE};border-top:0;` : ""}border-radius:0 0 14px 14px;padding:2px 12px 16px;text-align:center">` +
      (t.title
        ? `<h3 style="font-family:${HEAD};color:${look.title};font-size:${big ? 22 : 18}px;font-weight:800;line-height:1.15;margin:0">${esc(t.title)}</h3>`
        : "") +
      (t.body
        ? `<p style="font-family:${BODY};color:${look.text};font-size:${big ? 15 : 13}px;line-height:1.45;margin:6px 0 0">${esc(t.body)}</p>`
        : "") +
      (t.href ? `<div style="margin-top:12px">${stickerButton(t.label || "Find out more", t.href, look.button)}</div>` : "") +
      `</td></tr></table>`
    );
  };

  if (b.variant === 2 || b.variant === 3) {
    const width = b.variant === 3 ? 380 : 300;
    const stacked = tags.map((t, n) => `<tr><td style="padding-bottom:14px">${tag(t, n, width, b.variant === 3)}</td></tr>`).join("");
    return `<div style="padding:12px 40px 0"><table role="presentation" width="${width}" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;margin:0 auto">${stacked}</table></div>`;
  }
  const two = b.variant === 1;
  const cells = tags
    .map((t, n) => `<td style="vertical-align:top;width:${two ? "50%" : "33%"};padding:0 ${two ? 8 : 5}px">${tag(t, n, two ? 272 : 182, false)}</td>`)
    .join("");
  return `<div style="padding:12px ${two ? 32 : 30}px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></div>`;
}

// ---- bagList, what goes in a bag ---------------------------------------------------------------
// Fill a Red Bag's lined paper: each thing on its own ruled line, written by hand, its price on the
// right.
//   0: with the paintings   1: words only   2: with the paintings and a button   3: two columns
//
// data: title (40), items of { name (40), price (10), pic }, footnote (120), label (30), href. Eight
// things at most. `pic` is the key of a Red Bag painting (BAG_PICS); anything else draws no picture.
// The wording must say what a gift COULD do, never what it will buy (src/impact/examples.ts): the
// checks before sending look for that.
function bagList(b: Block): string {
  const title = cut(b.data, "title", 40);
  const footnote = cut(b.data, "footnote", 120);
  const things = list(b.data, "items")
    .map((item) => {
      const key = str(item, "pic").trim();
      return { name: cut(item, "name", 40), price: cut(item, "price", 10), pic: BAG_PICS.includes(key) ? key : "" };
    })
    .filter((t) => t.name)
    .slice(0, 8);
  if (!title && things.length === 0) return "";

  const twoColumns = b.variant === 3;
  const withPics = b.variant !== 1 && things.some((t) => t.pic);
  const size = twoColumns ? 32 : 44;
  const ruled = `border-bottom:1px solid ${RULED}`;
  // The words' face and size are set once on the table and inherited by its cells, which keeps a long
  // list small; a row's cells carry only what differs. The space between the two cells is what puts
  // "Warm pyjamas £5" on one line of the plain text.
  const row = (t: (typeof things)[number]): string =>
    `<tr>` +
    (withPics
      ? `<td width="${size}" style="padding:5px 10px 5px 0;${ruled}">${t.pic ? `<img src="${EMAIL_ART}item-${t.pic}.png" alt="" width="${size}" height="${size}" style="display:block;border:0" />` : ""}</td>`
      : "") +
    `<td style="padding:8px 0;color:${SLATE};${ruled}">${esc(t.name)}</td> ` +
    `<td style="padding:8px 0 8px 10px;color:${MAROON};text-align:right;white-space:nowrap;${ruled}">${esc(t.price)}</td></tr>`;
  const rows = (some: typeof things): string =>
    some.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${HAND};font-size:${twoColumns ? 18 : 20}px;line-height:1.2">${some.map(row).join("")}</table>`
      : "";
  const half = Math.ceil(things.length / 2);
  const listed = twoColumns
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top;width:50%;padding-right:10px">${rows(things.slice(0, half))}</td><td style="vertical-align:top;width:50%;padding-left:10px">${rows(things.slice(half))}</td></tr></table>`
    : rows(things);

  const inner =
    (title
      ? `<h3 style="font-family:${HAND};color:${CRIMSON};font-size:26px;font-weight:700;line-height:1.15;margin:0 0 6px">${esc(title)}</h3>`
      : "") +
    listed +
    (footnote ? `<p style="font-family:${BODY};color:${SLATE_SOFT};font-size:12px;line-height:1.5;margin:12px 0 0">${esc(footnote)}</p>` : "") +
    (b.variant === 2
      ? ((button) => (button ? `<div style="margin-top:14px">${button}</div>` : ""))(
          stickerButton(cut(b.data, "label", 30) || "Fill a Red Bag", link(b.data, "href"), "crimson", "left"),
        )
      : "");
  return `<div style="padding:12px 40px">${paperCard(inner)}</div>`;
}

// ---- trim, the festive divider -----------------------------------------------------------------
// For the eye only: no fields, no words, nothing in the plain text, never resized.
//   0: a gold ribbon with a bow   1: a band of snowy night   2: a torn strip of paper
//   3: a star between a snowflake and a twinkle
// The ribbon either side of the bow is two plain gold cells, so it still shows with pictures off.
function trim(b: Block): string {
  const wide = (name: "trim-snow.png" | "trim-torn.png", padding: string): string =>
    `<div style="padding:${padding};font-size:0;line-height:0">${fill(art(name), "", 636)}</div>`;
  if (b.variant === 1) return wide("trim-snow.png", "8px 0 0");
  if (b.variant === 2) return wide("trim-torn.png", "10px 0");
  if (b.variant === 3) return `<div style="padding:12px 40px">${ornament("trim-stars.png", 220)}</div>`;
  const ribbon = `<td style="vertical-align:middle"><div style="height:6px;background:${GOLD};border-top:2px solid #E4BB5B;border-bottom:2px solid #B8862B;font-size:0;line-height:0">&nbsp;</div></td>`;
  return `<div style="padding:6px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${ribbon}<td width="100" style="width:100px;vertical-align:middle">${ornament("trim-bow.png", 100)}</td>${ribbon}</tr></table></div>`;
}

// ---- paperStory, a story in the paper look -----------------------------------------------------
// A story told the way the newer pages look. The words are always live text.
//   0: the photo as a taped print above the words   1: the print left, the words right
//   2: the words on a paper card, taped, with the print inside it
//   3: no photo: a paper card with a handwritten kicker
//
// data: imageUrl, alt (140), kicker (40), title (80), body (600, prose), label (30), href. The words
// alone without a photo; nothing with neither.
function paperStory(b: Block): string {
  const src = b.variant === 3 ? "" : picture(b.data, "imageUrl");
  const alt = cut(b.data, "alt", 140);
  const kicker = cut(b.data, "kicker", 40);
  const title = cut(b.data, "title", 80);
  const body = prose(b.data, "body", 600);
  if (!src && !kicker && !title && !body) return "";

  const button = stickerButton(cut(b.data, "label", 30) || "Read more", link(b.data, "href"), "crimson", "left");
  const words =
    (kicker
      ? `<div style="font-family:${HAND};color:${CRIMSON};font-size:${b.variant === 3 ? 24 : 18}px;font-weight:700;line-height:1.2;margin:0 0 4px">${esc(kicker)}</div>`
      : "") +
    (title ? `<h3 style="font-family:${HEAD};color:${MAROON};font-size:22px;font-weight:800;line-height:1.2;margin:0">${esc(title)}</h3>` : "") +
    (body ? `<p style="font-family:${BODY};color:${SLATE};font-size:15px;line-height:1.6;margin:8px 0 0">${proseHtml(body)}</p>` : "") +
    (button ? `<div style="margin-top:14px">${button}</div>` : "");

  if (b.variant === 3) return `<div style="padding:12px 40px">${paperCard(words)}</div>`;
  if (b.variant === 2) {
    const inside = src
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${WHITE};border:1px solid ${LINE};padding:8px">${img(src, alt, 494)}</td></tr></table>${gap(14)}`
      : "";
    return (
      `<div style="padding:12px 40px">${tapeTop(112)}` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:3px"><tr>` +
      `<td style="padding:0 22px 22px">${tapeOn("card", 112)}${gap(10)}${inside}${words}</td></tr></table></div>`
    );
  }
  if (b.variant === 1) {
    const pic = src ? `<td style="vertical-align:top;width:42%">${print(src, alt, 215, "", 80)}</td>` : "";
    return `<div style="padding:12px 40px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pic}<td style="vertical-align:top;padding-left:${src ? 18 : 0}px">${words}</td></tr></table></div>`;
  }
  const above = src
    ? `<table role="presentation" width="420" align="center" cellpadding="0" cellspacing="0" style="width:100%;max-width:420px;margin:0 auto 16px"><tr><td>${print(src, alt, 402, "", 112)}</td></tr></table>`
    : "";
  return `<div style="padding:12px 40px">${above}${words}</div>`;
}

// ---- the register ------------------------------------------------------------------------------

export const PAPER_RENDERERS: Record<StillPaperType, (b: Block, ctx: RenderCtx) => string> = {
  hero,
  photoRow,
  note,
  eventCard,
  logoStrip,
  giftTags,
  bagList,
  trim,
  paperStory,
};

/** Paper blocks a text size step never touches: the divider has no words. */
export const PAPER_NO_SIZE_STEP: readonly StillPaperType[] = ["trim"];
