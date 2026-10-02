import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateParts, escapeHtml, time12 } from "../events/render";
import type { FundraiserRecord, FundraiserStatus, Meter } from "./model";
import { qrSvg } from "./qr";
import { formatPounds, shorten } from "./render";

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

export const MATERIALS = ["poster", "social", "sponsor-form", "certificate"] as const;
export type MaterialPiece = (typeof MATERIALS)[number];

export const CHARITY_NAME = "Night Before Christmas Campaign";
export const CHARITY_NUMBER = "SC047995";
export const EVERY_POUND = "Every pound helps the families we support, all year round.";
export const SEND_IT_BACK = "Please send this form back to us with the money so we can claim Gift Aid.";

/**
 * HMRC's model sponsorship declaration, word for word, from its "Sponsorship and Gift Aid declaration
 * form" (gov.uk, publication "charities-sponsorship-and-gift-aid-declaration-form", the November 2015
 * PDF), with the charity named on the form above it. Kept exactly as HMRC words it, their spelling
 * and slash included, so nobody has to wonder whether a change still counts.
 */
export const SPONSOR_DECLARATION =
  "If I have ticked the box headed 'Gift Aid? ✓', I confirm that I am a UK Income or Capital Gains taxpayer. " +
  "I have read this statement and want the charity or Community Amateur Sports Club (CASC) named above to reclaim tax " +
  "on the donation detailed below, given on the date shown. I understand that if I pay less Income Tax / or Capital " +
  "Gains tax in the current tax year than the amount of Gift Aid claimed on all of my donations it is my responsibility " +
  "to pay any difference. I understand the charity will reclaim 25p of tax on every £1 that I have given.";

/** What every piece is drawn from: the approved record, and nothing private but the organiser's name. */
export interface MaterialFacts {
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
  const page = f.path === "raising" && f.public && (f.status === "approved" || f.status === "finished") ? urls.pageUrl : null;
  const listed = f.path === "event" && f.public;
  const link = page ?? (listed ? urls.getInvolvedUrl : null);
  return {
    slug: f.slug,
    title: f.title,
    organiser: f.name,
    status: f.status,
    when,
    where,
    line,
    targetPence: f.targetPence && f.targetPence > 0 ? f.targetPence : null,
    raisedPence: m.raisedPence,
    giftAidPence: m.giftAidPence ?? 0,
    link,
    linkKind: page ? "page" : link ? "get-involved" : null,
    linkWords: link ? link.replace(/^https?:\/\//, "").replace(/\/+$/, "") : null,
  };
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
  @media print{
    html,body{background:#fff}
    .toolbar{display:none}
    .page{margin:0;box-shadow:none;zoom:1 !important;break-after:page;page-break-after:always}
    .page:last-of-type{break-after:auto;page-break-after:auto}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  }`;

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

function shell(o: {
  title: string;
  orientation: "portrait" | "landscape";
  fontCss: string;
  css: string;
  toolbar: string;
  body: string;
  print?: boolean;
  tail?: string;
}): string {
  const print = o.print !== false;
  const pageRule = print ? `@page{size:A4 ${o.orientation};margin:0}` : "";
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
      ? `<button type="button" onclick="window.print()">Print or save as PDF</button><span class="tip">In the print window, choose A4 and switch off headers and footers.</span>`
      : ""
  }</div>
${o.body}
${print ? FIT_SCRIPT : ""}${o.tail ?? ""}
</body>
</html>`;
}

const ICON_CLOCK =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ICON_PIN =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

// --- the poster --------------------------------------------------------------------------------------

/** Big for a short name, smaller as it grows, so even 100 characters fits the page. */
function posterTitleSize(title: string): string {
  const n = title.length;
  if (n <= 18) return "56pt";
  if (n <= 30) return "46pt";
  if (n <= 48) return "38pt";
  if (n <= 70) return "31pt";
  return "26pt";
}

const POSTER_CSS = `
  .poster{background:var(--maroon);padding:7mm}
  .p-sheet{height:100%;background:radial-gradient(120% 70% at 50% 0%,#fffdf8 0%,var(--cream) 70%);display:flex;flex-direction:column;position:relative}
  .p-body{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:12mm 16mm 7mm;min-height:0;position:relative}
  .p-body::before{content:"";position:absolute;inset:4mm 4mm 3mm;border:1px solid var(--gold);border-radius:2mm;pointer-events:none;opacity:.7}
  .p-logo{height:34mm;width:auto;display:block}
  .p-eyebrow{display:flex;align-items:center;gap:4mm;margin-top:3mm;font-weight:600;letter-spacing:.24em;text-transform:uppercase;
    color:var(--crimson);font-size:11pt;padding-left:.24em}
  .p-eyebrow::before,.p-eyebrow::after{content:"";width:14mm;height:1px;background:var(--gold)}
  .p-title{font-family:var(--head);font-weight:800;color:var(--maroon);line-height:1.04;letter-spacing:-.01em;margin:6mm 0 0;
    overflow-wrap:anywhere;max-width:170mm}
  .p-meta{display:flex;flex-wrap:wrap;justify-content:center;gap:2mm 7mm;margin-top:5mm;font-size:12.5pt;color:var(--slate)}
  .p-meta span{display:inline-flex;align-items:center;gap:2mm}
  .p-meta svg{color:var(--crimson);flex:0 0 auto}
  .p-line{font-family:var(--head);font-style:italic;color:var(--crimson);font-size:16pt;line-height:1.35;margin:5mm 0 0;max-width:150mm;overflow-wrap:anywhere}
  .p-target{margin-top:5mm;background:var(--tan-soft);color:var(--maroon);border-radius:999px;padding:2.2mm 8mm;font-size:13pt;font-weight:600}
  .p-target b{font-family:var(--head);font-weight:800;font-size:15pt}
  .p-scan{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;margin-top:5mm}
  .p-qr{background:#fff;border-radius:4mm;padding:3mm;box-shadow:0 0 0 1px var(--line),0 3mm 8mm -4mm rgba(92,15,24,.35)}
  .p-qr svg{display:block;width:72mm;height:72mm}
  .p-scan-words{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:17pt;margin-top:4mm}
  .p-address{font-weight:600;color:var(--crimson);font-size:12.5pt;margin-top:1mm;overflow-wrap:anywhere}
  .p-noqr{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:17pt;line-height:1.4}
  .p-noqr b{color:var(--crimson)}
  .p-foot{background:var(--maroon);color:var(--cream);text-align:center;padding:5mm 12mm 4.5mm}
  .p-foot .pledge{font-family:var(--head);font-style:italic;font-size:16pt;line-height:1.3}
  .p-foot .legal{font-size:8pt;opacity:.85;margin-top:1.5mm;letter-spacing:.02em}`;

export function renderPoster(d: MaterialFacts, a: MaterialAssets): string {
  const meta = [
    d.when ? `<span>${ICON_CLOCK}${escapeHtml(d.when)}</span>` : "",
    d.where ? `<span>${ICON_PIN}${escapeHtml(d.where)}</span>` : "",
  ].join("");
  const scan =
    d.link && d.linkWords
      ? `<div class="p-qr">${qrSvg(d.link)}</div>
        <div class="p-scan-words">${d.linkKind === "page" ? "Scan to give" : "Scan to find out more"}</div>
        <div class="p-address">or visit ${escapeHtml(d.linkWords)}</div>`
      : `<p class="p-noqr">Find out more about NBCC<br>at <b>nbcc.scot</b></p>`;
  const body = `<div class="page portrait poster">
  <div class="p-sheet">
    <div class="p-body">
      <img class="p-logo" src="${a.logo}" alt="Night Before Christmas Campaign">
      <div class="p-eyebrow">Fundraising for NBCC</div>
      <h1 class="p-title" style="font-size:${posterTitleSize(d.title)}">${escapeHtml(d.title)}</h1>
      ${meta ? `<div class="p-meta">${meta}</div>` : ""}
      ${d.line ? `<p class="p-line">${escapeHtml(d.line)}</p>` : ""}
      ${d.targetPence ? `<div class="p-target">Help us raise <b>${formatPounds(d.targetPence)}</b></div>` : ""}
      <div class="p-scan">
        ${scan}
      </div>
    </div>
    <div class="p-foot">
      <div class="pledge">${EVERY_POUND}</div>
      <div class="legal">${CHARITY_NAME} &middot; Scottish Charity ${CHARITY_NUMBER} &middot; nbcc.scot</div>
    </div>
  </div>
</div>`;
  return shell({
    title: `Poster for ${escapeHtml(d.title)}`,
    orientation: "portrait",
    fontCss: a.fontCss,
    css: POSTER_CSS,
    toolbar: `<span>Your poster for <b>${escapeHtml(d.title)}</b></span>`,
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
  .s-wrap{max-width:1000px;margin:0 auto;padding:22px 16px 48px}
  .s-intro{font-size:1rem;line-height:1.6;max-width:62ch;margin:0 auto 18px;text-align:center}
  .s-intro h1{font-family:var(--head);color:var(--maroon);font-size:clamp(1.6rem,4vw,2.2rem);margin:0 0 6px}
  .s-choice{display:flex;justify-content:center;margin:0 0 20px}
  .s-choice label{display:inline-flex;gap:10px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 18px;cursor:pointer}
  .s-choice input{width:18px;height:18px;accent-color:var(--crimson)}
  .s-grid{display:flex;flex-wrap:wrap;gap:24px;justify-content:center;align-items:flex-start}
  .s-card{background:#fff;border-radius:16px;padding:16px;box-shadow:0 10px 30px -18px rgba(60,20,20,.5);display:flex;flex-direction:column;gap:12px;align-items:center}
  .s-card h2{font-family:var(--head);color:var(--maroon);font-size:1.15rem;margin:0}
  .s-card p{margin:0;font-size:.85rem;color:var(--muted);text-align:center}
  .s-card canvas{display:block;border-radius:8px;box-shadow:0 0 0 1px var(--line);height:auto}
  .s-square canvas{width:min(420px,calc(100vw - 64px))}
  .s-story canvas{width:min(270px,calc(100vw - 64px))}
  .s-card button{font-family:var(--body);font-weight:600;font-size:1rem;border:0;border-radius:999px;background:var(--crimson);color:#fff;padding:11px 26px;cursor:pointer}
  .s-card button:hover{background:var(--maroon)}
  .s-card button:focus-visible{outline:3px solid var(--gold);outline-offset:2px}
  .s-card button[disabled]{opacity:.6;cursor:progress}
  .s-status{min-height:1.2em;font-size:.85rem;color:var(--holly);text-align:center}`;

export function renderSocial(d: MaterialFacts, a: MaterialAssets, script: string): string {
  const data = {
    slug: d.slug,
    title: d.title,
    line: d.line,
    when: d.when,
    linkWords: d.linkWords,
    linkKind: d.linkKind,
    raisedPence: d.raisedPence,
    targetPence: d.targetPence,
    logo: a.logo,
    logoOnDark: a.logoOnDark,
  };
  const showMeter = d.raisedPence > 0;
  const body = `<main class="s-wrap">
  <div class="s-intro">
    <h1>Pictures to share</h1>
    <p>Two pictures for <b>${escapeHtml(d.title)}</b>, ready for Facebook and Instagram. Download them, then add them to a post or a story. ${
      d.linkWords ? "Put your page address in the words of your post too, so people can tap it." : ""
    }</p>
  </div>
  <div class="s-choice"><label><input type="checkbox" data-social-meter${showMeter ? " checked" : ""}> Show how much has been raised</label></div>
  <div class="s-grid">
    <section class="s-card s-square" aria-labelledby="squareHeading">
      <h2 id="squareHeading">Square, for a post</h2>
      <canvas data-social="square" width="1080" height="1080" role="img" aria-label="Square picture for ${escapeHtml(d.title)}"></canvas>
      <button type="button" data-social-download="square">Download the square picture</button>
    </section>
    <section class="s-card s-story" aria-labelledby="storyHeading">
      <h2 id="storyHeading">Tall, for a story</h2>
      <canvas data-social="story" width="1080" height="1920" role="img" aria-label="Story picture for ${escapeHtml(d.title)}"></canvas>
      <button type="button" data-social-download="story">Download the story picture</button>
    </section>
  </div>
  <p class="s-status" role="status" aria-live="polite" data-social-status></p>
</main>`;
  return shell({
    title: `Pictures to share for ${escapeHtml(d.title)}`,
    orientation: "portrait",
    fontCss: a.fontCss,
    css: SOCIAL_CSS,
    toolbar: `<span>Your pictures for <b>${escapeHtml(d.title)}</b></span>`,
    body,
    print: false,
    tail: `<script type="application/json" id="socialData">${scriptJson(data)}</script>\n<script>${script}</script>`,
  });
}

// --- the sponsor form -------------------------------------------------------------------------------------

const SPONSOR_CSS = `
  .sf-sheet{background:#fff;padding:8mm 11mm 7mm;display:flex;flex-direction:column}
  .sf-head{display:flex;align-items:center;gap:5mm;border-bottom:2px solid var(--maroon);padding-bottom:3mm}
  .sf-head img{height:17mm;width:auto}
  .sf-head .t{flex:1}
  .sf-head h1{font-family:var(--head);font-weight:800;color:var(--maroon);font-size:21pt;margin:0;line-height:1.05}
  .sf-head .sub{font-size:8.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--crimson);font-weight:600;margin-top:1mm}
  .sf-head .charity{text-align:right;font-size:8.5pt;line-height:1.45;color:var(--slate)}
  .sf-head .charity b{color:var(--maroon)}
  .sf-fields{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:2.2mm 4mm;align-items:end;margin-top:3mm;font-size:9pt}
  .sf-fields .k{font-weight:600;color:var(--maroon);white-space:nowrap}
  .sf-fields .v{border-bottom:1px solid #9b8f86;min-height:6mm;padding:0 1mm .6mm;font-family:var(--head);font-weight:700;color:var(--slate);font-size:11pt;overflow-wrap:anywhere}
  .sf-fields .wide{grid-column:2 / span 3}
  .sf-decl{margin-top:3mm;background:var(--tan-soft);border-left:3px solid var(--crimson);border-radius:0 2mm 2mm 0;padding:2.2mm 4mm;font-size:7.8pt;line-height:1.45}
  .sf-remember{margin-top:1.6mm;font-size:8pt;font-weight:600;color:var(--maroon)}
  .sf-table{width:100%;border-collapse:collapse;margin-top:2.5mm;table-layout:fixed;font-size:8pt}
  .sf-table th{background:var(--maroon);color:var(--cream);font-weight:600;text-align:left;padding:1.4mm 2mm;vertical-align:bottom;line-height:1.25;border:1px solid var(--maroon)}
  .sf-table th small{display:block;font-weight:400;font-size:6.8pt;opacity:.9}
  .sf-table td{border:1px solid #b9ada4;height:7.4mm;padding:0 2mm}
  .sf-table td.n{color:var(--muted);text-align:center;font-size:7.5pt;padding:0}
  .sf-table .c{text-align:center}
  .sf-table tfoot td{height:7.4mm;border:1px solid #b9ada4;font-weight:600;color:var(--maroon)}
  .sf-table tfoot td.lbl{text-align:right;border:0;border-right:1px solid #b9ada4;background:transparent}
  .sf-table tfoot td.blank{border:0;background:transparent}
  .sf-grand{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4mm;margin-top:2.5mm}
  .sf-grand div{border:1px solid #b9ada4;border-radius:1.5mm;padding:1.6mm 3mm;display:flex;justify-content:space-between;align-items:center;gap:3mm;min-height:10mm;font-size:8pt;font-weight:600;color:var(--maroon)}
  .sf-grand b{min-width:24mm;border-bottom:1px solid #9b8f86;height:5.5mm;font-weight:600}
  .sf-foot{margin-top:auto;padding-top:2.5mm;display:flex;gap:6mm;align-items:flex-end;justify-content:space-between;font-size:8pt;line-height:1.45}
  .sf-foot .back{font-family:var(--head);font-weight:700;color:var(--crimson);font-size:11.5pt;line-height:1.3}
  .sf-foot .how{color:var(--slate);max-width:150mm}
  .sf-foot .pg{color:var(--muted);white-space:nowrap}`;

function sponsorRows(from: number, count: number): string {
  let rows = "";
  for (let i = from; i < from + count; i++) rows += `<tr class="sf-row"><td class="n">${i}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
  return rows;
}

const SPONSOR_COLS = `<colgroup><col style="width:7mm"><col style="width:60mm"><col><col style="width:25mm"><col style="width:23mm"><col style="width:23mm"><col style="width:17mm"></colgroup>`;
const SPONSOR_HEAD = `<thead><tr><th class="c">No.</th><th>Full name<small>first name or initial, and surname</small></th><th>Home address<small>first line. Only needed if you tick Gift Aid. Not your work address, please.</small></th><th>Postcode</th><th>Amount<small>&pound;</small></th><th>Date paid</th><th class="c">Gift Aid?<small>tick &#10003;</small></th></tr></thead>`;

export function renderSponsorForm(d: MaterialFacts | null, a: MaterialAssets): string {
  const event = d ? escapeHtml(d.title) : "";
  const decl = `<p class="sf-decl">${escapeHtml(SPONSOR_DECLARATION)}</p>
    <p class="sf-remember">Remember: please give your full name, home address and postcode, and tick Gift Aid, so that we can claim tax back on your donation.</p>`;
  const head = (heading: string) => `<div class="sf-head">
      <img src="${a.logo}" alt="Night Before Christmas Campaign">
      <div class="t"><h1>${heading}</h1><div class="sub">Sponsorship and Gift Aid declaration</div></div>
      <div class="charity"><b>${CHARITY_NAME} (NBCC)</b><br>Scottish Charity ${CHARITY_NUMBER}<br>nbcc.scot &middot; events@nbcc.scot</div>
    </div>`;
  const fields = `<div class="sf-fields">
      <span class="k">Please sponsor me</span><span class="v"></span>
      <span class="k">To (name of event)</span><span class="v">${event}</span>
      <span class="k">In aid of</span><span class="v wide">${CHARITY_NAME} (NBCC), Scottish Charity ${CHARITY_NUMBER}</span>
    </div>`;
  const foot = (page: number) => `<div class="sf-foot">
      <div><div class="back">${SEND_IT_BACK}</div>
      <div class="how">Pay the money in from your private area at nbcc.scot/fundraise/manage, then post this form to Elves Workshop, Annbank Village Hall, Weston Avenue, Annbank, KA6 5EE, or email a clear photo of it to events@nbcc.scot. ${EVERY_POUND}</div></div>
      <div class="pg">Page ${page} of 2</div>
    </div>`;
  const total = `<tfoot><tr><td class="blank" colspan="2"></td><td class="lbl" colspan="2">Total on this page</td><td>&pound;</td><td class="blank" colspan="2"></td></tr></tfoot>`;
  const grand = `<div class="sf-grand">
      <div><span>Total donations received, both pages</span><b>&pound;</b></div>
      <div><span>Total Gift Aid donations</span><b>&pound;</b></div>
      <div><span>Date the money was given to NBCC</span><b></b></div>
    </div>`;
  const body = `<div class="page landscape">
  <div class="sheet sf-sheet" style="height:100%">
    ${head("Sponsor form")}
    ${fields}
    ${decl}
    <table class="sf-table">${SPONSOR_COLS}${SPONSOR_HEAD}<tbody>${sponsorRows(1, 12)}</tbody>${total}</table>
    ${foot(1)}
  </div>
</div>
<div class="page landscape">
  <div class="sheet sf-sheet" style="height:100%">
    ${head("Sponsor form, continued")}
    <div class="sf-fields"><span class="k">To (name of event)</span><span class="v wide">${event}</span></div>
    ${decl}
    <table class="sf-table">${SPONSOR_COLS}${SPONSOR_HEAD}<tbody>${sponsorRows(13, 11)}</tbody>${total}</table>
    ${grand}
    ${foot(2)}
  </div>
</div>`;
  return shell({
    title: d ? `Sponsor form for ${event}` : "Sponsor form",
    orientation: "landscape",
    fontCss: a.fontCss,
    css: SPONSOR_CSS,
    toolbar: d ? `<span>Your sponsor form for <b>${event}</b></span>` : `<span>NBCC sponsor form</span>`,
    body,
  });
}

// --- the certificate ------------------------------------------------------------------------------------------

const CERT_CSS = `
  .cert{background:var(--maroon);padding:8mm}
  .c-sheet{height:100%;position:relative;background:radial-gradient(120% 95% at 50% 0%,#fffdf8 0%,var(--cream) 72%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12mm 26mm 11mm}
  .c-sheet::before{content:"";position:absolute;inset:4.5mm;border:1.2px solid var(--gold);border-radius:2mm;pointer-events:none}
  .c-sheet::after{content:"";position:absolute;inset:6.5mm;border:.5px solid var(--gold);border-radius:1.5mm;opacity:.55;pointer-events:none}
  .c-logo{height:27mm;width:auto;display:block}
  .c-title{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:36pt;line-height:1;margin:3mm 0 0;letter-spacing:.01em}
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
  .c-sign{display:flex;justify-content:space-between;align-items:flex-end;width:100%;max-width:210mm;margin-top:7mm}
  .c-sign .s{width:62mm}
  .c-sign .v{font-family:var(--head);font-weight:700;color:var(--slate);font-size:12pt;min-height:8mm;display:flex;align-items:flex-end;justify-content:center}
  .c-sign .team{font-family:var(--head);font-style:italic;
    font-weight:700;color:var(--crimson);font-size:19pt;line-height:1}
  .c-sign .rule{height:1px;background:var(--maroon);opacity:.45;margin:1.5mm 0}
  .c-sign .k{font-size:7.5pt;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .c-legal{margin-top:5mm;font-size:7.5pt;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}`;

export function renderCertificate(d: MaterialFacts, a: MaterialAssets, o: { date: string; preview: boolean }): string {
  const raised =
    d.raisedPence > 0
      ? `<div class="c-raised">raising<b>${formatPounds(d.raisedPence)}</b></div>${
          d.giftAidPence > 0 ? `<div class="c-ga">+ ${formatPounds(d.giftAidPence)} Gift Aid</div>` : ""
        }`
      : "";
  const body = `<div class="page landscape cert">
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
      <div class="s"><div class="v">${escapeHtml(o.date)}</div><div class="rule"></div><div class="k">Date</div></div>
      <div class="s"><div class="v team">NBCC Team</div><div class="rule"></div><div class="k">${CHARITY_NAME}</div></div>
    </div>
    <div class="c-legal">${CHARITY_NAME} &middot; Scottish Charity No. ${CHARITY_NUMBER}</div>
  </div>
</div>`;
  const flag = o.preview ? `<span class="flag">Preview</span><span>The organiser can open this once the fundraiser is marked finished.</span>` : "";
  return shell({
    title: `Certificate of thanks for ${escapeHtml(d.title)}`,
    orientation: "landscape",
    fontCss: a.fontCss,
    css: CERT_CSS,
    toolbar: `${flag}<span>Certificate of thanks for <b>${escapeHtml(d.title)}</b></span>`,
    body,
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
