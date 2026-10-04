import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateParts, escapeHtml, time12 } from "../events/render";
import { MATERIALS_STATEMENT, MATERIALS_STATEMENT_SHORT, POSTAL_ADDRESS } from "../legal/registration";
import { ALL_TO_NBCC, hasPage, splitStatement, type FundraiserRecord, type FundraiserStatus, type Meter } from "./model";
import { TRACKED_PIECES, trackedPath, type TrackedPiece } from "./material-codes";
import { qrSvg } from "./qr";
import { isInMemory } from "./in-memory";
import { formatPounds, shorten } from "./render";
import { entryWords } from "./entry";

// TASK-504 (stage 2 of community fundraising): the materials an organiser prints and shares. Each is
// a print ready HTML page, A4, with its own @page rules and a print button, that looks right on screen
// too. Built the way the business supporters' certificate (src/business/certificate.ts) and the thank
// you letters (src/thank-you/letter-page.ts) are: one self contained page, the brand fonts and the
// logos inlined, so it prints with no network and also opens from the admin as a page in its own
// tab (fetched with the staff member's session and shown from memory, where no relative link works).
//
//   the poster          A4 portrait: logo, "Fundraising for NBCC", the title, when and where, a
//                       short line, the target, a big QR code and the address in words
//   the social images   a square (1080 x 1080) and a story (1080 x 1920), drawn in the browser on a
//                       canvas (assets/js/fundraise-social.js) and downloaded as PNGs
//   the sponsor form    A4 landscape, two pages, HMRC's sponsorship and Gift Aid columns and their
//                       model declaration word for word; also blank, for anyone (/fundraise/sponsor-form)
//   the certificate     A4 landscape, a thank you once the fundraiser is finished
//
// Pure renders over MaterialFacts, which are taken from the stored fundraiser record only: that is
// the APPROVED version (a change an organiser asked for waits in fundraiser_edits and is never
// passed in). Everything a person typed is escaped on the way out. Plain friendly words, no dashes.
//
// TASK-512, round two:
//   - every printed piece carries the charity statement word for word (MATERIALS_STATEMENT, in
//     src/legal/registration.ts); the pictures carry the shorter one (MATERIALS_STATEMENT_SHORT)
//   - the logo as big as each layout allows
//   - the poster also comes as an A5 leaflet and an A3 poster: the A4 design, scaled to the paper
//   - every printed piece's QR code is its own short link (./material-codes.ts), so a scan says
//     which fundraiser and which piece it came from
//   - the pictures in five sizes: Instagram square and portrait, a story, a Facebook post and a
//     Facebook event cover, each its own download, or all of them as one zip
//   - every page says how to ask us for anything else (ASK_US), on screen only
//   - renderEverything: every printed piece on one page, for staff to print or save as one PDF
//
// "Print the QR code" (staff and hosts asked for a simple way to print an event's code):
//   the QR code sheet   A4 portrait: the logo, the name, the page's own QR code large, the address in
//                       words under it, and the charity statement. For any page that has one.

export const MATERIALS = ["poster", "poster-a3", "leaflet", "social", "sponsor-form", "certificate"] as const;
export type MaterialPiece = (typeof MATERIALS)[number];
/** The page's QR code on one A4 page, to print. Only for a fundraiser or an event with a page. */
export const QR_SHEET = "qr-code";

export const CHARITY_NAME = "Night Before Christmas Campaign";
export const CHARITY_NUMBER = "SC047995";
export const EVERY_POUND = "Every pound helps the children, young people and vulnerable adults we support, all year round.";

/** NBCC's policy, on every piece, the logo pack and the private area. Jaimie's words. */
export const ASK_US =
  "Need something else, like a banner or a different size? Give us a call on 01292 811 015 or email events@nbcc.scot and we'll make it for you. Please don't make your own versions of our logo or materials.";

/** The poster's three papers. Each is the A4 design, scaled. */
export const POSTER_SIZES = {
  a5: { label: "A5 leaflet", paper: "A5", widthMm: 148, heightMm: 210 },
  a4: { label: "A4 poster", paper: "A4", widthMm: 210, heightMm: 297 },
  a3: { label: "A3 poster", paper: "A3", widthMm: 297, heightMm: 420 },
} as const;
export type PosterSize = keyof typeof POSTER_SIZES;

/** Which poster each piece is, and which piece each poster is. */
export const POSTER_PIECE: Record<PosterSize, TrackedPiece> = { a4: "poster", a3: "poster-a3", a5: "leaflet" };

/**
 * The pictures to share (checked against Meta's guidance, October 2026): Instagram's square post and
 * its 4:5 portrait post (the tallest a feed post can be), a story for Instagram and Facebook (9:16),
 * a Facebook post (1.91:1, as a shared link's picture), and a Facebook event's cover (1920 x 1005,
 * what Facebook asks for so it is not cropped on phones).
 */
export const SOCIAL_SIZES = [
  { kind: "square", width: 1080, height: 1080, name: "Instagram post, square", use: "For an Instagram or Facebook post." },
  { kind: "portrait", width: 1080, height: 1350, name: "Instagram post, tall", use: "Fills more of the screen in an Instagram feed." },
  { kind: "story", width: 1080, height: 1920, name: "Story", use: "For an Instagram or Facebook story." },
  { kind: "facebook", width: 1200, height: 630, name: "Facebook post", use: "A wide picture for a Facebook post." },
  { kind: "cover", width: 1920, height: 1005, name: "Facebook event cover", use: "The cover picture for a Facebook event." },
] as const;
// Clarity audit (Jaimie, 2026-10-03): the money is paid in from the private area, not posted with the form.
export const SEND_IT_BACK = "Please send this form back to us once you have paid the money in, so we can claim Gift Aid.";
/** Clarity audit: on a shared sponsor form, by the declaration. Only NBCC's part of a gift can carry Gift Aid. */
export const GIFT_AID_NBCC_PART = "NBCC can claim Gift Aid only on the part of each gift that comes to NBCC.";

/**
 * HMRC's model sponsorship declaration, word for word, from its "Sponsorship and Gift Aid declaration
 * form" (gov.uk, publication "charities-sponsorship-and-gift-aid-declaration-form", the November 2015
 * PDF), with the charity named on the form above it. Kept exactly as HMRC words it, their spelling,
 * slash, curly quotes and √ sign included, so nobody has to wonder whether a change still counts.
 */
export const SPONSOR_DECLARATION =
  "If I have ticked the box headed ‘Gift Aid? √’, I confirm that I am a UK Income or Capital Gains taxpayer. " +
  "I have read this statement and want the charity or Community Amateur Sports Club (CASC) named above to reclaim tax " +
  "on the donation detailed below, given on the date shown. I understand that if I pay less Income Tax / or Capital " +
  "Gains tax in the current tax year than the amount of Gift Aid claimed on all of my donations it is my responsibility " +
  "to pay any difference. I understand the charity will reclaim 25p of tax on every £1 that I have given.";

/** What every piece is drawn from: the approved record, and nothing private but the organiser's name. */
export interface MaterialFacts {
  id: number;
  slug: string;
  title: string;
  /** As they gave it. Only the certificate shows it. */
  organiser: string;
  status: FundraiserStatus;
  /** "Saturday 5 December 2026, 10am", or null. */
  when: string | null;
  /** "North Inch, Perth", or null. */
  where: string | null;
  /** The card line, or the description's first sentence, kept short. */
  line: string | null;
  targetPence: number | null;
  raisedPence: number;
  giftAidPence: number;
  /** What the QR code carries: the public page, Get involved for a listed event, or nothing. */
  link: string | null;
  linkKind: "page" | "get-involved" | null;
  /** The same address, as people would type it. */
  linkWords: string | null;
  /**
   * TASK-512: what each printed piece's QR code carries: its own short link on the public site
   * (https://nbcc.scot/q/12-a4), which finds the fundraiser by its id and counts the scan. Null
   * whenever there is no link at all.
   */
  qrLinks: Record<TrackedPiece, string> | null;
  /**
   * Jaimie, 2026-10-03: when what is raised is shared with another cause, the statement the Charities
   * and Benevolent Fundraising (Scotland) Regulations 2009 ask for ("60% of what we raise goes to the
   * Night Before Christmas Campaign... The rest goes to ..."), on every piece that carries the charity
   * statement, just before it. Null when it is not shared.
   */
  splitStatement: string | null;
  /** The other cause, when shared: the sponsor form says it is in aid of both. Null otherwise. */
  otherCauseName: string | null;
  /** NBCC's share, when shared: the sponsor form's foot asks for that much to be paid in. Null otherwise. */
  nbccSharePercent?: number | null;
  /**
   * In memory of someone (Jaimie, 2026-10-03): who, and their dates. Every piece is then the gentle
   * version: "In memory", "In memory of <name>", "Give in their memory", the quieter colours, never
   * "Fundraising for NBCC". Null for any other fundraiser.
   */
  memory?: { name: string; dates: string | null } | null;
  /**
   * Jaimie, 2026-10-03: an event (its poster asks people to scan for the details as well as to give,
   * as giving on its page is a donation, never a ticket), and how people get in ("Entry: £5, paid on
   * the door"), or null. Optional, so facts made before stay valid.
   */
  event?: boolean;
  entry?: string | null;
}

/** The first sentence of a story: up to its first full stop, question or exclamation mark. */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  return m ? m[0] : flat;
}

export function materialFacts(
  f: FundraiserRecord,
  m: Meter,
  urls: { pageUrl: string | null; getInvolvedUrl: string },
): MaterialFacts {
  let when: string | null = null;
  if (f.eventDate) {
    const p = dateParts(f.eventDate);
    when = `${p.dayName} ${p.day} ${p.month} ${p.year}${f.startTime ? `, ${time12(f.startTime)}` : ""}`;
  }
  const where = [f.venue, f.town].map((s) => (s ?? "").trim()).filter(Boolean).join(", ") || null;
  const source = (f.cardLine ?? "").trim() || firstSentence(f.description ?? "");
  const line = source ? shorten(source, 140) : null;
  // Event pages: an event with a page carries it too, as a fundraiser's does (the caller gives its
  // /event/ address); one without falls back to Get involved, as before.
  const page = hasPage(f) ? urls.pageUrl : null;
  const listed = f.path === "event" && f.public;
  const link = page ?? (listed ? urls.getInvolvedUrl : null);
  // The short links sit on the same public site as Get involved.
  const origin = new URL(urls.getInvolvedUrl).origin;
  const qrLinks = link
    ? (Object.fromEntries(TRACKED_PIECES.map((p) => [p, `${origin}${trackedPath(f.id, p)}`])) as Record<TrackedPiece, string>)
    : null;
  return {
    id: f.id,
    slug: f.slug,
    title: f.title,
    organiser: f.name,
    status: f.status,
    when,
    where,
    line,
    // In memory: the target only if the family chose to show it (src/fundraising/in-memory.ts).
    targetPence: f.targetPence && f.targetPence > 0 && !(isInMemory(f) && f.memoryShowTarget !== true) ? f.targetPence : null,
    raisedPence: m.raisedPence,
    giftAidPence: m.giftAidPence ?? 0,
    link,
    linkKind: page ? "page" : link ? "get-involved" : null,
    linkWords: link ? link.replace(/^https?:\/\//, "").replace(/\/+$/, "") : null,
    qrLinks,
    splitStatement: splitStatement(f),
    otherCauseName: splitStatement(f) ? (f.otherCauseName ?? "").trim() : null,
    nbccSharePercent: splitStatement(f) ? (f.nbccSharePercent ?? null) : null,
    memory: isInMemory(f) && f.memoryName ? { name: f.memoryName.trim(), dates: f.memoryDates?.trim() || null } : null,
    event: f.path === "event",
    entry: f.path === "event" ? entryWords(f) : null,
  };
}

/** In memory: the gentle line in a piece's foot, in place of EVERY_POUND's. */
export const IN_MEMORY_POUND = "Every gift goes to NBCC in their memory, for the children, young people and vulnerable adults we support.";

/** The headline of a piece: the fundraiser's name, or "In memory of <name>". */
export function headlineOf(d: Pick<MaterialFacts, "title" | "memory">): string {
  return d.memory ? `In memory of ${d.memory.name}` : d.title;
}

/**
 * Which piece may be opened, by whom. Nothing for a sign up that is new or declined: its details
 * are not approved. The certificate is the organiser's once the fundraiser is finished; staff can
 * preview it before then.
 */
export function materialAllowed(piece: MaterialPiece, status: FundraiserStatus, who: "organiser" | "staff"): boolean {
  if (status !== "approved" && status !== "finished") return false;
  if (piece === "certificate" && who === "organiser") return status === "finished";
  return true;
}

// --- the brand assets, inlined ---------------------------------------------------------------------

export interface MaterialAssets {
  /** @font-face rules for Playfair Display and Poppins, as data URIs. */
  fontCss: string;
  /** The colour logo (maroon NBCC), for light backgrounds. */
  logo: string;
  /** The logo with white NBCC, for dark backgrounds. */
  logoOnDark: string;
}

// This file compiles to dist/fundraising/materials.js, so ../.. is the app root (as certificate.ts).
const REPO_ROOT = resolve(__dirname, "../..");
let cachedAssets: MaterialAssets | null = null;

/** Read once and kept: the fonts and the two logos as data URIs. */
export function materialAssets(): MaterialAssets {
  if (cachedAssets) return cachedAssets;
  const b64 = (rel: string) => readFileSync(resolve(REPO_ROOT, rel)).toString("base64");
  const fontCss =
    `@font-face{font-family:"Playfair Display";font-style:normal;font-weight:400 800;font-display:block;` +
    `src:url(data:font/woff2;base64,${b64("assets/fonts/playfair-var.woff2")}) format("woff2")}` +
    `@font-face{font-family:"Poppins";font-style:normal;font-weight:400;font-display:block;` +
    `src:url(data:font/woff2;base64,${b64("assets/fonts/poppins-400.woff2")}) format("woff2")}`;
  cachedAssets = {
    fontCss,
    logo: `data:image/png;base64,${b64("assets/img/nbcc-logo.png")}`,
    logoOnDark: `data:image/png;base64,${b64("assets/img/nbcc-logo-footer.png")}`,
  };
  return cachedAssets;
}

/** The drawing script for the social images, inlined into its page (kept as its own file for tests). */
export function socialScript(): string {
  return readFileSync(resolve(REPO_ROOT, "assets/js/fundraise-social.js"), "utf8");
}

// --- the page every piece sits in ------------------------------------------------------------------

const BASE_CSS = `
  :root{--crimson:#C02238;--maroon:#800000;--maroon-dk:#5c0f18;--cream:#F8F5EE;--tan:#D29C8A;--tan-soft:#F3E4DD;
    --holly:#1A531A;--gold:#B8862B;--gold-soft:#E9D9B0;--slate:#333333;--muted:#6F6A66;--line:#E9DFD2;
    --head:"Playfair Display",Georgia,serif;--body:"Poppins",system-ui,sans-serif}
  *{box-sizing:border-box}
  html,body{margin:0;background:#E9E2D6;-webkit-text-size-adjust:100%;text-size-adjust:100%;color:var(--slate);font-family:var(--body)}
  .toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:center;
    padding:10px 16px;background:var(--maroon);color:var(--cream);font-size:.92rem;line-height:1.4;text-align:center}
  .toolbar button{font-family:var(--body);font-weight:600;font-size:.92rem;border:0;border-radius:999px;background:var(--cream);
    color:var(--maroon);padding:9px 22px;cursor:pointer}
  .toolbar button:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
  .toolbar .tip{flex-basis:100%;font-size:.8rem;opacity:.85}
  .toolbar .flag{background:var(--gold);color:#fff;border-radius:999px;padding:2px 12px;font-weight:600}
  .page{margin:18px auto;box-shadow:0 12px 40px rgba(60,20,20,.22);overflow:hidden;position:relative}
  .portrait{width:210mm;height:297mm}
  .landscape{width:297mm;height:210mm}
  .ask-us{max-width:640px;margin:16px auto 0;padding:12px 18px;background:#F3EEE3;border:1.6px solid var(--line);
    border-radius:12px;font-size:.9rem;line-height:1.55;color:var(--slate)}
  .ask-us a{color:var(--maroon);font-weight:600}
  @media (max-width:700px){.ask-us{margin:12px 12px 0}}
  @media print{
    html,body{background:#fff}
    .toolbar{display:none}
    .page{margin:0;box-shadow:none;zoom:1 !important;break-after:page;page-break-after:always}
    .page:last-of-type{break-after:auto;page-break-after:auto}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }
  @media print{.ask-us{display:none}}`;

/** The policy line, on screen only: nobody needs it on a poster in a shop window. */
const ASK_US_HTML = `<aside class="ask-us">${escapeHtml(ASK_US)}</aside>`;

// On a screen narrower than the paper, shrink the page to fit rather than scroll sideways. Printing
// ignores it (zoom:1 above).
const FIT_SCRIPT = `<script>
(function(){
  function fit(){
    var pages=document.querySelectorAll(".page");
    for(var i=0;i<pages.length;i++){
      var p=pages[i];p.style.zoom="";
      var w=p.offsetWidth, room=document.documentElement.clientWidth-24;
      if(w>room&&room>0)p.style.zoom=String(room/w);
    }
  }
  fit();window.addEventListener("resize",fit);
})();
</script>`;

type Paper = "A4 portrait" | "A4 landscape" | "A3 portrait" | "A5 portrait";

/** The page every piece sits in (also the in memory envelopes, ./envelope.ts). */
export function shell(o: {
  title: string;
  /** The paper it prints on; or, for a page of several sizes, its own @page rules. */
  paper: Paper | { rules: string };
  fontCss: string;
  css: string;
  toolbar: string;
  body: string;
  print?: boolean;
  tail?: string;
  /** Print tip, when the paper is not A4. */
  tip?: string;
}): string {
  const print = o.print !== false;
  const pageRule = !print ? "" : typeof o.paper === "string" ? `@page{size:${o.paper};margin:0}` : o.paper.rules;
  const paperName = typeof o.paper === "string" ? o.paper.split(" ")[0] : "the paper size of each page";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${o.title} | NBCC</title>
<style>${o.fontCss}${BASE_CSS}
${pageRule}
${o.css}</style>
</head>
<body>
<div class="toolbar">${o.toolbar}${
    print
      ? `<button type="button" onclick="window.print()">Print or save as PDF</button><span class="tip">${
          o.tip ?? `In the print window, choose ${paperName} and switch off headers and footers.`
        }</span>`
      : ""
  }</div>
${ASK_US_HTML}
${o.body}
${print ? FIT_SCRIPT : ""}${o.tail ?? ""}
</body>
</html>`;
}

const ICON_CLOCK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_PIN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

// --- the poster, in three sizes --------------------------------------------------------------------
//
// One design, drawn on an A4 sheet (.p-scale, 210 x 297mm) and scaled to the paper: the A5 leaflet
// and the A3 poster are exactly the A4 poster, smaller or bigger. A transform scales the drawing as
// drawing (the QR code stays a sharp vector), and the page around it is exactly the paper's size, so
// nothing can spill onto a second sheet.

/** Big for a short name, smaller as it grows, so even 100 characters fits the page. */
function posterTitleSize(title: string): string {
  const n = title.length;
  if (n <= 18) return "56pt";
  if (n <= 30) return "46pt";
  if (n <= 48) return "38pt";
  if (n <= 70) return "31pt";
  return "26pt";
}

/**
 * The logo's height on the A4 design, in millimetres: as big as the page allows (Jaimie: "as big as
 * possible"), giving a little way to a long name or line so the QR code keeps its size and
 * everything still fits: 66mm for a short name and line. Never below 38mm (it was 34mm before round two).
 */
export function posterLogoMm(
  d: Pick<MaterialFacts, "title" | "line" | "when" | "where" | "targetPence"> & Partial<Pick<MaterialFacts, "splitStatement" | "memory" | "entry" | "linkKind">>,
  size: PosterSize = "a4",
): number {
  const t = (d.memory ? `In memory of ${d.memory.name}` : d.title).length;
  const l = d.line?.length ?? 0;
  let mm = 66;
  // In memory: the headline is "In memory of <name>", and the dates take a line under it.
  if (d.memory) mm -= 8;
  if (t > 30) mm -= 6;
  if (t > 48) mm -= 6;
  if (t > 70) mm -= 4;
  if (l > 70) mm -= 6;
  if (l > 110) mm -= 2;
  if (d.when && d.where && d.targetPence) mm -= 2;
  // Review fix: the split statement's lines in the foot. On the leaflet the foot's words are drawn
  // bigger on the design (so they print at 7pt or more: statementPt), so it takes more room there.
  // With a split the logo may go below its usual least, so the worst case still fits the paper.
  if (d.splitStatement) mm -= size === "a5" ? 12 : 6;
  // Clarity audit: "Gifts made on the NBCC page all go to NBCC." after the statement can take the
  // foot a line further (measured in headless Chromium at A5, A4 and A3, worst case).
  const note = posterSplitNote(d) ? (size === "a5" ? SPLIT_NOTE_LOGO_A5_MM : SPLIT_NOTE_LOGO_MM) : 0;
  mm -= note;
  // Event clarity review: an event's entry line under the target ("Entry: £5, paid on the door"), and
  // a second line when it is long enough to wrap. The logo gives way to it, below its usual least too,
  // so the address and QR code stay inside the frame (measured in headless Chromium at A5, A4 and A3).
  const entry = d.entry ? ENTRY_LOGO_MM + (d.entry.length > ENTRY_WRAPS_AT ? ENTRY_WRAP_LOGO_MM : 0) : 0;
  return Math.max((d.splitStatement ? SPLIT_LOGO_MIN_MM - note : 38) - entry, mm - entry);
}

/**
 * What the words after the split statement take from the logo. On A4 and A3 they can take the foot a
 * line further (3.8mm on the design, measured); on the leaflet the room made for the split already
 * holds most of that.
 */
const SPLIT_NOTE_LOGO_MM = 4;
const SPLIT_NOTE_LOGO_A5_MM = 2;

/** The least the logo is ever drawn: the page gives it up, down to this, before anything else moves. */
const LOGO_LEAST_MM = 10;

/**
 * Review (PR #655): the QR code's size on the A4 design, in millimetres. 66mm, and a little smaller
 * only where even the smallest logo would not leave room for the longest name and line: a shared
 * event, an event whose way in takes two lines, and on the leaflet (whose foot is set bigger, so it is
 * legible on A5) anything shared or with a way in. The least is 48mm on the design: about 34mm across
 * on A5, which still scans well. Measured over a grid in headless Chromium at A5 and A4.
 */
export function posterQrMm(d: Partial<Pick<MaterialFacts, "splitStatement" | "entry">>, size: PosterSize = "a4"): number {
  const split = Boolean(d.splitStatement);
  const entry = Boolean(d.entry);
  const entryWraps = entry && (d.entry as string).length > ENTRY_WRAPS_AT;
  if (size === "a5") return 66 - (split ? 8 : 0) - (entry ? (entryWraps ? 10 : 4) : 0);
  return 66 - (split && entry ? 8 : entryWraps ? 4 : 0);
}

/** The words after a poster's split statement: only where there is an NBCC page to give on. */
function posterSplitNote(d: Partial<Pick<MaterialFacts, "splitStatement" | "linkKind" | "memory">>): string | null {
  // A piece in memory of someone is as it was.
  return d.splitStatement && d.linkKind === "page" && !d.memory ? ALL_TO_NBCC : null;
}

/** The least the poster's logo goes to when there is a split statement to fit in too. */
export const SPLIT_LOGO_MIN_MM = 26;

/** What an event's entry line takes from the logo, and a second line when it is longer than this. */
const ENTRY_LOGO_MM = 8;
const ENTRY_WRAP_LOGO_MM = 6;
const ENTRY_WRAPS_AT = 45;

// Each paper's scale from A4: its width over 210mm, so the design fills it edge to edge.
const SCALE: Record<PosterSize, string> = { a5: "0.70476", a4: "1", a3: "1.41428" };

/** The smallest the charity statement may be on the paper: OSCR asks for it to be legible. */
export const STATEMENT_MIN_PT = 7;
/** Its size on the A4 design, which A4 itself prints as it is. */
const STATEMENT_DESIGN_PT = 7.6;

/**
 * TASK-512 review: the statement's size on the A4 design for one paper, so that once scaled it is
 * never under 7pt on the paper. The leaflet draws it bigger (scaled straight down it would print at
 * about 5.4pt); A3 lets it grow with the paper.
 */
export function statementPt(size: PosterSize): number {
  const scale = Number(SCALE[size]);
  return Math.max(STATEMENT_DESIGN_PT, Math.ceil((STATEMENT_MIN_PT / scale) * 100) / 100);
}

// After the general rules, so each paper's statement size wins.
const SIZE_CSS = (Object.keys(POSTER_SIZES) as PosterSize[])
  .map(
    (s) =>
      `.size-${s}{width:${POSTER_SIZES[s].widthMm}mm;height:${POSTER_SIZES[s].heightMm}mm}.size-${s} .p-scale{transform:scale(${SCALE[s]})}` +
      `.size-${s} .p-foot .legal{font-size:${statementPt(s)}pt}`,
  )
  .join("\n  ");

// Review fix: with a split, the pledge in the foot is one smaller line. (The QR code's own size, a
// little smaller on a shared leaflet, is posterQrMm's.)
const SPLIT_POSTER_CSS = `
  .has-split .p-foot .pledge{font-size:11pt;line-height:1.25}`;

// In memory: the page's quieter colours. Cream and tan, maroon only for the name, no gold frame and
// no crimson; the foot in soft tan with the charity statement in slate.
const MEMORY_POSTER_CSS = `
  .poster.memory,.memory .p-sheet{background:var(--tan-soft)}
  .memory .p-body{background:var(--cream)}
  .memory .p-body::before{border-color:var(--tan);opacity:.8}
  .memory .p-eyebrow{color:var(--muted)}
  .memory .p-eyebrow::before,.memory .p-eyebrow::after{background:var(--tan)}
  .memory .p-title{font-weight:600}
  .memory .p-dates{font-family:var(--head);font-style:italic;color:var(--muted);font-size:17pt;margin-top:2.5mm}
  .memory .p-meta svg{color:var(--muted)}
  .memory .p-line{color:var(--slate)}
  .memory .p-target{background:var(--tan-soft);color:var(--slate);font-weight:400}
  .memory .p-target b{color:var(--maroon);font-weight:700}
  .memory .p-qr{box-shadow:0 0 0 1px var(--line)}
  .memory .p-scan-words{font-weight:600}
  .memory .p-address{color:var(--maroon)}
  .memory .p-foot{background:var(--tan-soft);color:var(--slate)}
  .memory .p-foot .pledge{font-size:12.5pt}`;

/** The poster's rules, with each paper size's own logo height for these facts. */
function posterCss(d: MaterialFacts): string {
  const logos = (Object.keys(POSTER_SIZES) as PosterSize[])
    .map((s) => `.size-${s} .p-logo{height:${posterLogoMm(d, s)}mm}.size-${s} .p-qr svg{width:${posterQrMm(d, s)}mm;height:${posterQrMm(d, s)}mm}`)
    .join("");
  return `${posterCssFor(posterLogoMm(d))}${SPLIT_POSTER_CSS}${d.memory ? MEMORY_POSTER_CSS : ""}
  ${logos}`;
}

function posterCssFor(logoMm: number): string {
  return `
  .poster{background:var(--maroon)}
  .p-scale{width:210mm;height:297mm;padding:7mm;transform-origin:0 0}
  .p-sheet{height:100%;background:var(--maroon);display:flex;flex-direction:column;position:relative}
  .p-body{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:9mm 14mm 6mm;min-height:0;position:relative;
    background:radial-gradient(120% 70% at 50% 0%,#fffdf8 0%,var(--cream) 70%)}
  .p-body::before{content:"";position:absolute;inset:4mm 4mm 3mm;border:1px solid var(--gold);border-radius:2mm;pointer-events:none;opacity:.7}
  .p-body>*{flex-shrink:0}
  .p-logo{height:${logoMm}mm;width:auto;display:block;flex:0 1 auto;min-height:${LOGO_LEAST_MM}mm;object-fit:contain}
  .p-eyebrow{display:flex;align-items:center;gap:4mm;margin-top:2mm;font-weight:600;letter-spacing:.24em;text-transform:uppercase;
    color:var(--crimson);font-size:11pt;padding-left:.24em}
  .p-eyebrow::before,.p-eyebrow::after{content:"";width:14mm;height:1px;background:var(--gold)}
  .p-title{font-family:var(--head);font-weight:800;color:var(--maroon);line-height:1.04;letter-spacing:-.01em;margin:4.5mm 0 0;
    overflow-wrap:anywhere;max-width:172mm}
  .p-meta{display:flex;flex-wrap:wrap;justify-content:center;gap:2mm 7mm;margin-top:4mm;font-size:12.5pt;color:var(--slate)}
  .p-meta span{display:inline-flex;align-items:center;gap:2mm}
  .p-meta svg{color:var(--crimson);flex:0 0 auto}
  .p-line{font-family:var(--head);font-style:italic;color:var(--crimson);font-size:15pt;line-height:1.32;margin:4mm 0 0;max-width:155mm;overflow-wrap:anywhere}
  .p-target{margin-top:4mm;background:var(--tan-soft);color:var(--maroon);border-radius:999px;padding:2mm 8mm;font-size:13pt;font-weight:600}
  .p-target b{font-family:var(--head);font-weight:800;font-size:15pt}
  .p-entry{margin-top:3mm;color:var(--maroon);font-size:12.5pt;font-weight:600;overflow-wrap:anywhere;max-width:160mm}
  .p-scan{flex:1 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;margin-top:4mm}
  .p-qr{background:#fff;border-radius:4mm;padding:3mm;box-shadow:0 0 0 1px var(--line),0 3mm 8mm -4mm rgba(92,15,24,.35)}
  .p-qr svg{display:block;width:66mm;height:66mm}
  .p-scan-words{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:17pt;margin-top:3mm}
  .p-address{font-weight:600;color:var(--crimson);font-size:12pt;margin-top:1mm;overflow-wrap:anywhere}
  .p-noqr{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:17pt;line-height:1.4}
  .p-noqr b{color:var(--crimson)}
  .p-foot{background:var(--maroon);color:var(--cream);text-align:center;padding:4mm 10mm 3.5mm}
  .p-foot .pledge{font-family:var(--head);font-style:italic;font-size:14pt;line-height:1.3}
  .p-foot .legal{line-height:1.4;opacity:.9;margin:1.5mm auto 0;max-width:182mm}
  .p-foot .legal.split{opacity:1;font-weight:600}
  ${SIZE_CSS}`;
}

/**
 * Review (PR #655): the size of "or visit <address>" under the QR code. Pages are given short
 * addresses (30 characters at most), which fit a line at 12pt; staff can set one of up to 60, which
 * wrapped onto more lines and pushed the address out of the frame. A long one is drawn smaller, so it
 * is always one line (measured in headless Chromium with wide letters).
 */
export function posterAddressPt(linkWords: string | null): number {
  const n = linkWords?.length ?? 0;
  if (n <= 52) return 12;
  return n <= 66 ? 10 : 8.4;
}

/** The split statement, when what is raised is shared with another cause; nothing when it is not. */
function splitHtml(d: MaterialFacts | null, cls: string): string {
  return d?.splitStatement ? `<div class="${cls}">${escapeHtml(d.splitStatement)}</div>` : "";
}

/** What a scan does, under a QR code: gently in memory, the details too for an event. */
function scanWordsOf(d: Pick<MaterialFacts, "memory" | "linkKind" | "event">): string {
  if (d.memory) return "Give in their memory";
  if (d.linkKind !== "page") return "Scan to find out more";
  return d.event ? "Scan for the details, and to give" : "Scan to give";
}

/** One poster page, at one size. Its QR code is that size's own short link. */
function posterPage(d: MaterialFacts, a: MaterialAssets, size: PosterSize): string {
  const meta = [
    d.when ? `<span>${ICON_CLOCK}${escapeHtml(d.when)}</span>` : "",
    d.where ? `<span>${ICON_PIN}${escapeHtml(d.where)}</span>` : "",
  ].join("");
  const qr = d.qrLinks ? d.qrLinks[POSTER_PIECE[size]] : null;
  const memory = d.memory ?? null;
  const headline = headlineOf(d);
  const scanWords = scanWordsOf(d);
  const scan =
    qr && d.linkWords
      ? `<div class="p-qr">${qrSvg(qr, { title: `QR code for ${headline}` })}</div>
        <div class="p-scan-words">${scanWords}</div>
        <div class="p-address" style="font-size:${posterAddressPt(d.linkWords)}pt">or visit ${escapeHtml(d.linkWords)}</div>`
      : `<p class="p-noqr">Find out more about NBCC<br>at <b>nbcc.scot</b></p>`;
  const target = d.targetPence
    ? memory
      ? `<div class="p-target">Raising <b>${formatPounds(d.targetPence)}</b> in their memory</div>`
      : `<div class="p-target">Help us raise <b>${formatPounds(d.targetPence)}</b></div>`
    : "";
  return `<div class="page size-${size} poster${memory ? " memory" : ""}${d.splitStatement ? " has-split" : ""}">
  <div class="p-scale">
  <div class="p-sheet">
    <div class="p-body">
      <img class="p-logo" src="${a.logo}" alt="Night Before Christmas Campaign">
      <div class="p-eyebrow">${memory ? "In memory" : "Fundraising for NBCC"}</div>
      <h1 class="p-title" style="font-size:${posterTitleSize(headline)}">${escapeHtml(headline)}</h1>
      ${memory?.dates ? `<div class="p-dates">${escapeHtml(memory.dates)}</div>` : ""}
      ${meta ? `<div class="p-meta">${meta}</div>` : ""}
      ${d.line ? `<p class="p-line">${escapeHtml(d.line)}</p>` : ""}
      ${target}
      ${d.entry ? `<div class="p-entry">${escapeHtml(d.entry)}</div>` : ""}
      <div class="p-scan">
        ${scan}
      </div>
    </div>
    <div class="p-foot">
      <div class="pledge">${memory ? IN_MEMORY_POUND : EVERY_POUND}</div>
      ${d.splitStatement ? `<div class="legal split">${escapeHtml([d.splitStatement, posterSplitNote(d)].filter(Boolean).join(" "))}</div>` : ""}<div class="legal">${escapeHtml(MATERIALS_STATEMENT)}</div>
    </div>
  </div>
  </div>
</div>`;
}

/** The poster at one size: A4 (the poster), A3 (the big poster) or A5 (the leaflet). */
export function renderPoster(d: MaterialFacts, a: MaterialAssets, size: PosterSize = "a4"): string {
  const { label, paper } = POSTER_SIZES[size];
  return shell({
    title: `${label} for ${escapeHtml(d.title)}`,
    paper: `${paper} portrait`,
    fontCss: a.fontCss,
    css: posterCss(d),
    toolbar: `<span>Your ${label} for <b>${escapeHtml(d.title)}</b></span>`,
    body: posterPage(d, a, size),
    tip:
      size === "a5"
        ? "In the print window, choose A5, or A4 with two to a sheet, and switch off headers and footers."
        : `In the print window, choose ${paper} and switch off headers and footers.`,
  });
}

// --- the QR code, on a page of its own -------------------------------------------------------------------
//
// For a noticeboard, a table or a till: the name, the page's own QR code large (the same link as the
// code in the private area and the admin), the address in words, and the charity statement. One A4
// page; a long name or address is drawn smaller, so nothing spills onto a second sheet.

const QR_SHEET_MM = 120;
const QR_SHEET_CSS = `
  .qrsheet{background:#fff}
  .q-sheet{height:100%;display:flex;flex-direction:column;align-items:center;text-align:center;padding:16mm 16mm 10mm}
  .q-sheet>*{flex-shrink:0}
  .q-logo{height:30mm;width:auto;display:block}
  .q-title{font-family:var(--head);font-weight:800;color:var(--maroon);line-height:1.1;letter-spacing:-.01em;margin:8mm 0 0;
    overflow-wrap:anywhere;max-width:176mm}
  .q-scan{flex:1 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0}
  .q-qr{background:#fff;border:1px solid var(--line);border-radius:4mm;padding:4mm}
  .q-qr svg{display:block;width:${QR_SHEET_MM}mm;height:${QR_SHEET_MM}mm}
  .q-words{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:22pt;line-height:1.2;margin-top:6mm}
  .q-address{font-weight:600;color:var(--slate);margin-top:2mm;overflow-wrap:anywhere;max-width:176mm}
  .q-legal{font-size:8.5pt;line-height:1.45;color:var(--slate);max-width:176mm;margin-top:3mm}
  .q-legal.split{font-weight:600}`;

function qrSheetTitlePt(title: string): number {
  const n = title.length;
  if (n <= 18) return 44;
  if (n <= 30) return 38;
  if (n <= 48) return 32;
  return n <= 70 ? 27 : 23;
}

function qrSheetAddressPt(linkWords: string): number {
  if (linkWords.length <= 40) return 18;
  return linkWords.length <= 60 ? 14 : 11;
}

/** The page's QR code on one A4 page, or null when there is no page of its own to scan to. */
export function renderQrSheet(d: MaterialFacts, a: MaterialAssets): string | null {
  if (d.linkKind !== "page" || !d.link || !d.linkWords) return null;
  const headline = headlineOf(d);
  const body = `<div class="page portrait qrsheet">
  <div class="q-sheet">
    <img class="q-logo" src="${a.logo}" alt="Night Before Christmas Campaign">
    <h1 class="q-title" style="font-size:${qrSheetTitlePt(headline)}pt">${escapeHtml(headline)}</h1>
    <div class="q-scan">
      <div class="q-qr">${qrSvg(d.link, { title: `QR code for ${headline}` })}</div>
      <div class="q-words">${scanWordsOf(d)}</div>
      <div class="q-address" style="font-size:${qrSheetAddressPt(d.linkWords)}pt">${escapeHtml(d.linkWords)}</div>
    </div>
    ${splitHtml(d, "q-legal split")}
    <div class="q-legal">${escapeHtml(MATERIALS_STATEMENT)}</div>
  </div>
</div>`;
  return shell({
    title: `QR code for ${escapeHtml(d.title)}`,
    paper: "A4 portrait",
    fontCss: a.fontCss,
    css: QR_SHEET_CSS,
    toolbar: `<span>The QR code for <b>${escapeHtml(d.title)}</b>, on one A4 page</span>`,
    body,
  });
}

// --- the social images ---------------------------------------------------------------------------------

/** JSON that can sit inside a script element: nothing in it can close the element or open a comment. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");
}

const SOCIAL_CSS = `
  .s-wrap{max-width:1160px;margin:0 auto;padding:22px 16px 48px}
  .s-intro{font-size:1rem;line-height:1.6;max-width:62ch;margin:0 auto 18px;text-align:center}
  .s-intro h1{font-family:var(--head);color:var(--maroon);font-size:clamp(1.6rem,4vw,2.2rem);margin:0 0 6px}
  .s-choice{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:center;margin:0 0 20px}
  .s-choice label{display:inline-flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 18px;cursor:pointer}
  .s-choice input{width:18px;height:18px;accent-color:var(--crimson)}
  .s-grid{display:flex;flex-wrap:wrap;gap:24px;justify-content:center;align-items:flex-start}
  .s-card{background:#fff;border-radius:16px;padding:16px;box-shadow:0 10px 30px -18px rgba(60,20,20,.5);display:flex;flex-direction:column;gap:10px;align-items:center;max-width:100%}
  .s-card h2{font-family:var(--head);color:var(--maroon);font-size:1.15rem;margin:0;text-align:center}
  .s-card p{margin:0;font-size:.85rem;color:var(--muted);text-align:center;max-width:36ch}
  .s-card canvas{display:block;border-radius:8px;box-shadow:0 0 0 1px var(--line);height:auto;max-width:calc(100vw - 64px)}
  .s-square canvas{width:340px}
  .s-portrait canvas{width:300px}
  .s-story canvas{width:230px}
  .s-facebook canvas{width:480px}
  .s-cover canvas{width:560px}
  .s-wrap button{font-family:var(--body);font-weight:600;font-size:1rem;border:0;border-radius:999px;background:var(--crimson);color:#fff;padding:11px 26px;cursor:pointer}
  .s-wrap button:hover{background:var(--maroon)}
  .s-wrap button:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
  .s-wrap button[disabled]{opacity:.6;cursor:progress}
  .s-wrap .s-zip{background:var(--maroon)}
  .s-status{min-height:1.2em;font-size:.85rem;color:var(--holly);text-align:center}`;

/** What the drawing script is handed: the approved facts it draws, and nothing else about anyone. */
function socialData(d: MaterialFacts, a: MaterialAssets) {
  return {
    slug: d.slug,
    title: d.title,
    line: d.line,
    when: d.when,
    linkWords: d.linkWords,
    linkKind: d.linkKind,
    event: !!d.event,
    raisedPence: d.raisedPence,
    targetPence: d.targetPence,
    statement: MATERIALS_STATEMENT_SHORT,
    // Jaimie, 2026-10-03: drawn whole before the statement when shared with another cause.
    split: d.splitStatement,
    // Clarity audit: drawn straight after it, where there is an NBCC page to give on.
    splitNote: posterSplitNote(d),
    // Only the logo with white lettering is drawn on the maroon pictures. In memory the pictures are
    // the page's cream, so the logo with maroon lettering goes in its place.
    logoOnDark: d.memory ? a.logo : a.logoOnDark,
    // In memory (Jaimie, 2026-10-03): the gentle pictures (assets/js/fundraise-social.js).
    memory: d.memory ?? null,
  };
}

/** The script that draws the pictures, after the data it draws from. */
function socialTail(d: MaterialFacts, a: MaterialAssets, script: string): string {
  return `<script type="application/json" id="socialData">${scriptJson(socialData(d, a))}</script>\n<script>${script}</script>`;
}

const ZIP_BUTTON = `<button type="button" class="s-zip" data-social-zip>Download every picture as a zip</button>`;

export function renderSocial(d: MaterialFacts, a: MaterialAssets, script: string): string {
  const showMeter = d.raisedPence > 0;
  const cards = SOCIAL_SIZES.map(
    (s) => `<section class="s-card s-${s.kind}" aria-labelledby="${s.kind}Heading">
      <h2 id="${s.kind}Heading">${s.name}</h2>
      <p>${s.use} ${s.width} by ${s.height} pixels.</p>
      <canvas data-social="${s.kind}" width="${s.width}" height="${s.height}" role="img" aria-label="${escapeHtml(s.name)} picture for ${escapeHtml(d.title)}"></canvas>
      <button type="button" data-social-download="${s.kind}">Download</button>
    </section>`,
  ).join("\n    ");
  const body = `<main class="s-wrap">
  <div class="s-intro">
    <h1>Pictures to share</h1>
    <p>Pictures for <b>${escapeHtml(d.title)}</b>, in the sizes Facebook and Instagram ask for. Download the ones you need, then add them to a post, a story or your event. ${
      d.linkWords ? "Put your page address in the words of your post too, so people can tap it." : ""
    }</p>
  </div>
  <div class="s-choice"><label><input type="checkbox" data-social-meter${showMeter ? " checked" : ""}> Show how much has been raised</label>${ZIP_BUTTON}</div>
  <div class="s-grid">
    ${cards}
  </div>
  <p class="s-status" role="status" aria-live="polite" data-social-status></p>
</main>`;
  return shell({
    title: `Pictures to share for ${escapeHtml(d.title)}`,
    paper: "A4 portrait",
    fontCss: a.fontCss,
    css: SOCIAL_CSS,
    toolbar: `<span>Your pictures for <b>${escapeHtml(d.title)}</b></span>`,
    body,
    print: false,
    tail: socialTail(d, a, script),
  });
}

// --- the sponsor form -------------------------------------------------------------------------------------

const SPONSOR_CSS = `
  .sf-sheet{background:#fff;padding:6mm 11mm 4.5mm;display:flex;flex-direction:column}
  .sf-head{display:flex;align-items:center;gap:5mm;border-bottom:2px solid var(--maroon);padding-bottom:2.5mm}
  .sf-head img{height:23mm;width:auto}
  .sf-head .t{flex:1}
  .sf-head h1{font-family:var(--head);font-weight:800;color:var(--maroon);font-size:21pt;margin:0;line-height:1.05}
  .sf-head .sub{font-size:8.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--crimson);font-weight:600;margin-top:1mm}
  .sf-head .charity{text-align:right;font-size:8.5pt;line-height:1.45;color:var(--slate)}
  .sf-head .charity b{color:var(--maroon)}
  .sf-fields{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2.2mm 4mm;align-items:end;margin-top:3mm;font-size:9pt}
  .sf-fields .k{font-weight:600;color:var(--maroon);white-space:nowrap}
  .sf-fields .v{border-bottom:1px solid #9b8f86;min-height:6mm;padding:0 1mm .6mm;font-family:var(--head);font-weight:700;color:var(--slate);font-size:11pt;overflow-wrap:anywhere}
  .sf-fields .wide{grid-column:2 / span 3}
  .sf-fields .v.long{font-size:9.5pt;line-height:1.3}
  .sf-split{margin-top:2mm;font-size:8pt;line-height:1.35;font-weight:600;color:var(--maroon)}
  .sf-decl{margin-top:3mm;background:var(--tan-soft);border-left:3px solid var(--crimson);border-radius:0 2mm 2mm 0;padding:2.2mm 4mm;font-size:7.8pt;line-height:1.45}
  .sf-remember{margin-top:1.6mm;font-size:8pt;font-weight:600;color:var(--maroon)}
  .sf-head .sf-online{margin-top:1.2mm;font-size:8pt;line-height:1.35;color:var(--slate);overflow-wrap:anywhere;max-width:165mm}
  .sf-head .sf-online.is-long{font-size:7pt}
  .sf-table{width:100%;border-collapse:collapse;margin-top:2.5mm;table-layout:fixed;font-size:8pt}
  .sf-table th{background:var(--maroon);color:var(--cream);font-weight:600;text-align:left;padding:1.4mm 2mm;vertical-align:bottom;line-height:1.25;border:1px solid var(--maroon)}
  .sf-table th small{display:block;font-weight:400;font-size:6.8pt;opacity:.9}
  .sf-table td{border:1px solid #b9ada4;height:6.2mm;padding:0 2mm}
  .sf-table td.n{color:var(--muted);text-align:center;font-size:7.5pt;padding:0}
  .sf-table .c{text-align:center}
  .sf-table tfoot td{height:6.4mm;border:1px solid #b9ada4;font-weight:600;color:var(--maroon)}
  .sf-table tfoot td.lbl{text-align:right;border:0;border-right:1px solid #b9ada4;background:transparent}
  .sf-table tfoot td.blank{border:0;background:transparent}
  .sf-grand{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm;margin-top:2.5mm}
  .sf-grand div{border:1px solid #b9ada4;border-radius:1.5mm;padding:1.6mm 3mm;display:flex;justify-content:space-between;align-items:center;gap:3mm;min-height:10mm;font-size:8pt;font-weight:600;color:var(--maroon)}
  .sf-grand b{min-width:24mm;border-bottom:1px solid #9b8f86;height:5.5mm;font-weight:600}
  .sf-foot{margin-top:auto;padding-top:2.5mm;display:flex;gap:6mm;align-items:flex-end;justify-content:space-between;font-size:8pt;line-height:1.45}
  .sf-foot .back{font-family:var(--head);font-weight:700;color:var(--crimson);font-size:11.5pt;line-height:1.3}
  .sf-foot .how{color:var(--slate);max-width:205mm}
  .sf-foot .pg{color:var(--muted);white-space:nowrap}
  .sf-memory{margin-top:1mm;font-family:var(--head);font-style:italic;font-size:11pt;color:var(--maroon)}
  .sf-head.is-memory{border-bottom-color:var(--tan)}
  .sf-head.is-memory .sub{color:var(--muted)}
  .sf-legal{margin-top:1.8mm;padding-top:1.5mm;border-top:1px solid var(--line);font-size:7pt;line-height:1.4;color:var(--muted);text-align:center}`;

function sponsorRows(from: number, count: number): string {
  let rows = "";
  for (let i = from; i < from + count; i++) rows += `<tr class="sf-row"><td class="n">${i}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  return rows;
}

/**
 * Review fix: the rows on each page of the sponsor form. 12 and 11 as always, a row less on page 1
 * with a long event name (it wraps in its box); with a split, fewer on each page for its lines (below),
 * so the foot and the charity statement always fit the paper.
 */
export function sponsorRowCounts(
  d: (Pick<MaterialFacts, "title" | "splitStatement"> & Partial<Pick<MaterialFacts, "otherCauseName" | "linkKind" | "linkWords" | "memory">>) | null,
): [number, number] {
  const longName = d && d.title.length > 60 ? 1 : 0;
  if (!d?.splitStatement) return [12 - longName, 11];
  // Clarity audit: the split's lines end with the Gift Aid line, which takes them onto a second line
  // (never a third, even with the longest name), and page 1 gives up two rows for them. One more when
  // the event's name is long (it wraps in its box) or the other cause's name is (it wraps "In aid
  // of"). Measured in headless Chromium, worst case.
  const longCause = (d.otherCauseName ?? "").length > SPONSOR_CAUSE_WRAPS_AT ? 1 : 0;
  // Review: a long page address takes the heading's line onto a third line, which page 2 has no room for.
  const longAddress = sponsorOnlineLine(d) && (d.linkWords ?? "").length > SPONSOR_ADDRESS_LONG_AT ? 1 : 0;
  return [10 - Math.max(longName, longCause), 10 - longAddress];
}

/**
 * A cause's name longer than this may wrap "In aid of" on the sponsor form: it does from about 45
 * characters in ordinary letters, and from 39 in the widest (capital Ws and Ms), as measured.
 */
const SPONSOR_CAUSE_WRAPS_AT = 38;
/** A page address longer than this is drawn smaller in the sponsor form's heading (pages are given 30 characters at most; staff can set 60). */
const SPONSOR_ADDRESS_LONG_AT = 52;

/**
 * Clarity audit: a sponsor who gives on the page and also signs the paper form is counted twice, and
 * Gift Aid could be claimed twice. Only where there is a page to give on; never on the blank form or
 * on a form in memory of someone.
 */
function sponsorOnlineLine(d: Partial<Pick<MaterialFacts, "linkKind" | "linkWords" | "memory">> | null): string | null {
  if (!d || d.memory || d.linkKind !== "page" || !d.linkWords) return null;
  return `Sponsoring online instead? Give on the page at ${d.linkWords}, and please don't add your name here as well.`;
}

const SPONSOR_COLS = `<colgroup><col style="width:7mm"><col style="width:60mm"><col><col style="width:25mm"><col style="width:23mm"><col style="width:23mm"><col style="width:17mm"></colgroup>`;
const SPONSOR_HEAD = `<thead><tr><th class="c">No.</th><th>Full name<small>first name or initial, and surname</small></th><th>Home address<small>first line. Only needed if you tick Gift Aid. Not your work address, please.</small></th><th>Postcode</th><th>Amount<small>&pound;</small></th><th>Date paid</th><th class="c">Gift Aid?<small>tick &#10003;</small></th></tr></thead>`;

/** The sponsor form's two A4 landscape pages. */
function sponsorPages(d: MaterialFacts | null, a: MaterialAssets): string {
  const event = d ? escapeHtml(d.title) : "";
  // Clarity audit: one declaration under two causes, so it says whose part can carry Gift Aid.
  const split = d?.splitStatement ? `<div class="sf-split">${escapeHtml(d.splitStatement)} ${GIFT_AID_NBCC_PART}</div>` : "";
  const online = sponsorOnlineLine(d);
  const decl = `${split}<p class="sf-decl">${escapeHtml(SPONSOR_DECLARATION)}</p>
    <p class="sf-remember">Remember: please give your full name, home address and postcode, and tick Gift Aid, so that we can claim tax back on your donation.</p>`;
  // Shared with another cause: only NBCC's share is paid in to NBCC.
  const payIn = d?.splitStatement && d.nbccSharePercent ? escapeHtml(`Pay NBCC's ${d.nbccSharePercent}% in`) : "Pay the money in";
  // In memory: who it remembers, under the heading, in the quieter colours.
  const memory = d?.memory
    ? `<div class="sf-memory">In memory of ${escapeHtml(d.memory.name)}${d.memory.dates ? `, ${escapeHtml(d.memory.dates)}` : ""}</div>`
    : "";
  const head = (heading: string) => `<div class="sf-head${d?.memory ? " is-memory" : ""}">
      <img src="${a.logo}" alt="Night Before Christmas Campaign">
      <div class="t"><h1>${heading}</h1><div class="sub">Sponsorship and Gift Aid declaration</div>${memory}${
        // Beside the logo, which is taller than the heading: it takes no room from the rows.
        // A long address (staff can set one of up to 60 characters) is drawn smaller, to stay on two lines.
        online ? `<div class="sf-online${(d?.linkWords ?? "").length > SPONSOR_ADDRESS_LONG_AT ? " is-long" : ""}">${escapeHtml(online)}</div>` : ""
      }</div>
      <div class="charity"><b>${CHARITY_NAME} (NBCC)</b><br>Scottish Charity ${CHARITY_NUMBER}<br>nbcc.scot &middot; events@nbcc.scot</div>
    </div>`;
  const fields = `<div class="sf-fields">
      <span class="k">Please sponsor me</span><span class="v"></span>
      <span class="k">To (name of event)</span><span class="v${d && d.title.length > 60 ? " long" : ""}">${event}</span>
      <span class="k">In aid of</span><span class="v wide">${CHARITY_NAME} (NBCC), Scottish Charity ${CHARITY_NUMBER}${
        d?.otherCauseName ? `, and ${escapeHtml(d.otherCauseName)}` : ""
      }</span>
    </div>`;
  const foot = (page: number) => `<div class="sf-foot">
      <div><div class="back">${SEND_IT_BACK}</div>
      <div class="how">${payIn} from your private area at nbcc.scot/fundraise/manage, then post this form to ${POSTAL_ADDRESS}, or email a clear photo of it to events@nbcc.scot. ${EVERY_POUND}</div></div>
      <div class="pg">Page ${page} of 2</div>
    </div>
    <div class="sf-legal">${escapeHtml(MATERIALS_STATEMENT)}</div>`;
  const total = `<tfoot><tr><td class="blank" colspan="2"></td><td class="lbl" colspan="2">Total on this page</td><td>&pound;</td><td class="blank" colspan="2"></td></tr></tfoot>`;
  const grand = `<div class="sf-grand">
      <div><span>Total donations received, both pages</span><b>&pound;</b></div>
      <div><span>Total Gift Aid donations</span><b>&pound;</b></div>
      <div><span>Date the money was given to NBCC</span><b></b></div>
    </div>`;
  const [first, second] = sponsorRowCounts(d);
  return `<div class="page landscape">
  <div class="sheet sf-sheet" style="height:100%">
    ${head("Sponsor form")}
    ${fields}
    ${decl}
    <table class="sf-table">${SPONSOR_COLS}${SPONSOR_HEAD}<tbody>${sponsorRows(1, first)}</tbody>${total}</table>
    ${foot(1)}
  </div>
</div>
<div class="page landscape">
  <div class="sheet sf-sheet" style="height:100%">
    ${head("Sponsor form, continued")}
    <div class="sf-fields"><span class="k">To (name of event)</span><span class="v wide">${event}</span></div>
    ${decl}
    <table class="sf-table">${SPONSOR_COLS}${SPONSOR_HEAD}<tbody>${sponsorRows(first + 1, second)}</tbody>${total}</table>
    ${grand}
    ${foot(2)}
  </div>
</div>`;
}

export function renderSponsorForm(d: MaterialFacts | null, a: MaterialAssets): string {
  const event = d ? escapeHtml(d.title) : "";
  return shell({
    title: d ? `Sponsor form for ${event}` : "Sponsor form",
    paper: "A4 landscape",
    fontCss: a.fontCss,
    css: SPONSOR_CSS,
    toolbar: d ? `<span>Your sponsor form for <b>${event}</b></span>` : `<span>NBCC sponsor form</span>`,
    body: sponsorPages(d, a),
  });
}

// --- the certificate ------------------------------------------------------------------------------------------

const CERT_CSS = `
  .cert{background:var(--maroon);padding:8mm}
  .c-sheet{height:100%;position:relative;background:radial-gradient(120% 95% at 50% 0%,#fffdf8 0%,var(--cream) 72%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:10mm 24mm 9mm}
  .c-sheet::before{content:"";position:absolute;inset:4.5mm;border:1.2px solid var(--gold);border-radius:2mm;pointer-events:none}
  .c-sheet::after{content:"";position:absolute;inset:6.5mm;border:.5px solid var(--gold);border-radius:1.5mm;opacity:.55;pointer-events:none}
  .c-logo{height:38mm;width:auto;display:block}
  .c-title{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:34pt;line-height:1;margin:2.5mm 0 0;letter-spacing:.01em}
  .c-orn{display:flex;align-items:center;gap:4mm;margin:3.5mm 0 0;color:var(--gold);font-size:10pt}
  .c-orn::before,.c-orn::after{content:"";width:30mm;height:1px;background:linear-gradient(90deg,transparent,var(--gold))}
  .c-orn::after{background:linear-gradient(90deg,var(--gold),transparent)}
  .c-to{margin-top:5mm;font-size:8.5pt;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);font-weight:600;padding-left:.24em}
  .c-name{font-family:var(--head);font-weight:700;color:var(--maroon-dk);font-size:31pt;line-height:1.08;margin-top:1.5mm;max-width:220mm;overflow-wrap:anywhere}
  .c-for{font-family:var(--head);font-style:italic;color:var(--crimson);font-size:16pt;line-height:1.3;margin-top:2.5mm;max-width:215mm;overflow-wrap:anywhere}
  .c-raised{margin-top:4mm;font-size:11pt;color:var(--slate)}
  .c-raised b{display:block;font-family:var(--head);font-weight:800;color:var(--maroon);font-size:28pt;line-height:1.1;margin-top:.5mm}
  .c-ga{font-size:10.5pt;color:var(--holly);font-weight:600;margin-top:.5mm}
  .c-body{max-width:170mm;margin:4mm auto 0;font-size:10pt;line-height:1.55;color:var(--slate)}
  .c-sign{display:flex;justify-content:space-between;align-items:flex-end;width:100%;max-width:210mm;margin-top:5mm}
  .c-sign .s{width:62mm}
  .c-sign .v{font-family:var(--head);font-weight:700;color:var(--slate);font-size:12pt;min-height:8mm;display:flex;align-items:flex-end;justify-content:center}
  .c-sign .team{font-family:var(--head);font-style:italic;
    font-weight:700;color:var(--crimson);font-size:19pt;line-height:1}
  .c-sign .rule{height:1px;background:var(--maroon);opacity:.45;margin:1.5mm 0}
  .c-sign .k{font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .c-legal{margin-top:4mm;font-size:7pt;line-height:1.45;color:var(--muted);max-width:215mm}
  .c-legal.c-split{color:var(--maroon);font-weight:600}
  .c-legal.c-split + .c-legal{margin-top:1mm}
  /* Review fix: closer set when there is a split, a long name or a long title, so everything, the
     charity statement last, stays inside the gold border. */
  .c-tight .c-sheet{padding:8mm 22mm 8mm}
  .c-tight .c-logo{height:28mm}
  .c-tight .c-title{font-size:30pt}
  .c-tight .c-orn{margin-top:2.5mm}
  .c-tight .c-to{margin-top:3.5mm}
  .c-tight .c-name{font-size:25pt}
  .c-tight .c-for{font-size:14pt;margin-top:2mm}
  .c-tight .c-raised{margin-top:3mm}
  .c-tight .c-raised b{font-size:24pt}
  .c-tight .c-body{margin-top:3mm;max-width:205mm;line-height:1.45}
  .c-tight .c-sign{margin-top:3.5mm}
  .c-tight .c-legal{margin-top:2.5mm;line-height:1.35}
  .c-tight .c-legal.c-split + .c-legal{margin-top:1mm}`;

/** Review fix: the certificate is closer set when it has more to say. */
export function certificateTight(d: Pick<MaterialFacts, "splitStatement" | "organiser" | "title">): boolean {
  return Boolean(d.splitStatement) || d.organiser.length > 30 || d.title.length > 60;
}

/** The certificate's one A4 landscape page. */
function certificatePage(d: MaterialFacts, a: MaterialAssets, date: string): string {
  const raised =
    d.raisedPence > 0
      ? `<div class="c-raised">raising<b>${formatPounds(d.raisedPence)}</b></div>${
          d.giftAidPence > 0 ? `<div class="c-ga">+ ${formatPounds(d.giftAidPence)} Gift Aid</div>` : ""
        }`
      : "";
  return `<div class="page landscape cert${certificateTight(d) ? " c-tight" : ""}">
  <div class="c-sheet">
    <img class="c-logo" src="${a.logo}" alt="Night Before Christmas Campaign">
    <h1 class="c-title">Certificate of thanks</h1>
    <div class="c-orn" aria-hidden="true">&#10022;</div>
    <div class="c-to">Proudly presented to</div>
    <div class="c-name">${escapeHtml(d.organiser)}</div>
    <div class="c-for">for ${escapeHtml(d.title)}</div>
    ${raised}
    <p class="c-body">Thank you for fundraising for the ${CHARITY_NAME}. ${EVERY_POUND} We could not do it without people like you.</p>
    <div class="c-sign">
      <div class="s"><div class="v">${escapeHtml(date)}</div><div class="rule"></div><div class="k">Date</div></div>
      <div class="s"><div class="v team">NBCC Team</div><div class="rule"></div><div class="k">${CHARITY_NAME}</div></div>
    </div>
    ${splitHtml(d, "c-legal c-split")}<div class="c-legal">${escapeHtml(MATERIALS_STATEMENT)}</div>
  </div>
</div>`;
}

export function renderCertificate(d: MaterialFacts, a: MaterialAssets, o: { date: string; preview: boolean }): string {
  const flag = o.preview ? `<span class="flag">Preview</span><span>The organiser can open this once the fundraiser is marked finished.</span>` : "";
  return shell({
    title: `Certificate of thanks for ${escapeHtml(d.title)}`,
    paper: "A4 landscape",
    fontCss: a.fontCss,
    css: CERT_CSS,
    toolbar: `${flag}<span>Certificate of thanks for <b>${escapeHtml(d.title)}</b></span>`,
    body: certificatePage(d, a, o.date),
  });
}

// --- everything, on one page (staff) ---------------------------------------------------------------------
//
// TASK-512: Admin > Fundraising's "Download everything". Every printed piece one after another, each
// on its own paper (a named @page for each size, so the print window and Save as PDF give every page
// its right size), ready to print or save as one PDF. The pictures to share are drawn in the browser,
// so they come as a zip from the same page: there is no image library on the server to draw them
// there, and adding one is not possible (no new packages). The certificate only once finished.

const EVERYTHING_PAGES =
  "@page{margin:0}\n@page a4p{size:A4 portrait;margin:0}\n@page a4l{size:A4 landscape;margin:0}\n" +
  "@page a3p{size:A3 portrait;margin:0}\n@page a5p{size:A5 portrait;margin:0}";
const EVERYTHING_CSS = `
  .size-a4{page:a4p}.size-a3{page:a3p}.size-a5{page:a5p}.landscape{page:a4l}`;

export function renderEverything(d: MaterialFacts, a: MaterialAssets, o: { date: string; script: string }): string {
  const pages = [
    posterPage(d, a, "a4"),
    posterPage(d, a, "a3"),
    posterPage(d, a, "a5"),
    sponsorPages(d, a),
    // In memory (review fix): no certificate of thanks.
    d.status === "finished" && !d.memory ? certificatePage(d, a, o.date) : "",
  ].join("\n");
  return shell({
    title: `Everything for ${escapeHtml(d.title)}`,
    paper: { rules: EVERYTHING_PAGES },
    fontCss: a.fontCss,
    css: posterCss(d) + SPONSOR_CSS + CERT_CSS + EVERYTHING_CSS,
    toolbar:
      `<span>Everything for <b>${escapeHtml(d.title)}</b>: the A4 and A3 posters, the A5 leaflet, the sponsor form${
        d.status === "finished" && !d.memory ? " and the certificate" : ""
      }</span>` + `<button type="button" data-social-zip>Download every picture as a zip</button><span class="tip" role="status" aria-live="polite" data-social-status></span>`,
    tip: "Each page prints on its own paper size. To print just one, open it on its own from Admin > Get involved > Sign ups.",
    body: pages,
    tail: socialTail(d, a, o.script),
  });
}

/** A page a materials link answers with when it cannot open: plain, and never indexed. */
export function materialsMessagePage(heading: string, words: string, link?: { href: string; text: string }): string {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(heading)} | NBCC</title>
<link rel="stylesheet" href="/assets/css/styles.css"></head>
<body><main class="wrap" style="padding:48px 16px;max-width:640px"><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(words)}</p>${
    link ? `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></p>` : ""
  }</main></body></html>`;
}

/**
 * Welcome packs (./welcome-pack-print.ts): the pages and rules of the printed pieces, so the one
 * print view of a pack is drawn from exactly what each piece draws on its own.
 */
export const PACK_PIECES = { posterPage, posterCss, sponsorPages, sponsorCss: SPONSOR_CSS, pageRules: EVERYTHING_PAGES, pageCss: EVERYTHING_CSS };
