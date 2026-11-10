import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ABOUT_NBCC_SHORT } from "../email/brand";
import { escapeHtml } from "../ball/page";
import { materialAssets } from "../fundraising/materials";
import { qrSvg } from "../fundraising/qr";
import { NAME_MAX } from "../site/qr-named";
import { dayLabel, timesLabel, type SleighNight } from "./model";

// The Santa Sleigh posters, downloaded from Admin > Santa Sleigh (docs/superpowers/specs/
// 2026-11-10-santa-sleigh-design.md, added on approval). Jaimie, 10 November 2026: one poster with
// every night and area, one per area, A4 and A3, each with the QR code; "bold, fun, family, money";
// and "use a named QR on the posters", so each poster's scans are counted in Admin > QR codes.
//
// One design drawn on an A4 sheet (210 by 297mm) and, for A3, the same sheet scaled by transform, so
// the QR code stays a sharp vector and nothing can spill onto a second page (as the fundraising
// posters do, src/fundraising/materials.ts). The page is self contained: the fonts, the logo and the
// sleigh picture are inside it, so it prints the same from a window opened by the admin.
//
// Pure apart from sleighPosterAssets, which reads the site's own files once.

export type PosterSize = "a4" | "a3";

export interface PosterAssets {
  fontCss: string;
  /** The sleigh picture, as a data URI. */
  art: string;
  /** NBCC's logo with white letters, for the dark band, as a data URI. */
  logo: string;
}

const ROOT = resolve(__dirname, "../..");
let cached: PosterAssets | null = null;

export function sleighPosterAssets(): PosterAssets {
  if (cached) return cached;
  const m = materialAssets();
  const art = readFileSync(resolve(ROOT, "assets/img/santa-sleigh-1340.webp")).toString("base64");
  cached = { fontCss: m.fontCss, art: `data:image/webp;base64,${art}`, logo: m.logoOnDark };
  return cached;
}

/** The name of the named QR code a poster carries: one for every night, one per area. */
export function posterCodeName(night: SleighNight | null): string {
  const name = `Santa Sleigh poster: ${night ? night.areas : "every night"}`;
  return name.length <= NAME_MAX ? name : name.slice(0, NAME_MAX).trimEnd();
}

const when = (n: SleighNight) => {
  const d = dayLabel(n.nightOn);
  return `${d.day} ${d.date} ${d.month}`;
};

const CSS = `
:root{--crimson:#C02238;--maroon:#800000;--cream:#F8F5EE;--card:#FFFDFA;--tan-soft:#F3E4DD;--holly:#1A531A;
  --gold:#E8B54A;--ink:#5E2427;--night:#4A0B12;--night-lo:#2C060B;--slate:#333333;--muted:#6F6A66;
  --head:"Playfair Display",Georgia,serif;--body:"Poppins",system-ui,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;background:#E9E2D6;color:var(--slate);font-family:var(--body);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;justify-content:center;padding:10px 16px;
  background:var(--maroon);color:var(--cream);font-size:.92rem;text-align:center}
.bar button{font:600 .92rem var(--body);border:0;border-radius:999px;background:var(--cream);color:var(--maroon);padding:9px 22px;cursor:pointer}
.bar span{flex-basis:100%;font-size:.8rem;opacity:.85}
.paper{margin:18px auto;overflow:hidden;position:relative;box-shadow:0 12px 40px rgba(60,20,20,.22);background:var(--cream)}
.paper.a4{width:210mm;height:297mm}
.paper.a3{width:297mm;height:420mm}
.sheet{position:relative;width:210mm;height:297mm;transform-origin:0 0;overflow:hidden;background:var(--cream)}
.a3 .sheet{transform:scale(1.4142)}

.sky{position:absolute;left:0;right:0;top:0;height:142mm;color:var(--cream);
  background:radial-gradient(95mm 70mm at 82% 6%,#6E1420 0%,transparent 70%),linear-gradient(180deg,var(--night) 0%,var(--night-lo) 100%)}
.snow{position:absolute;inset:0;opacity:.75;background-image:
  radial-gradient(1.1mm 1.1mm at 12mm 18mm,#fff 50%,transparent 52%),radial-gradient(.8mm .8mm at 44mm 40mm,#fff 50%,transparent 52%),
  radial-gradient(1.3mm 1.3mm at 70mm 12mm,#fff 50%,transparent 52%),radial-gradient(.9mm .9mm at 96mm 34mm,#fff 50%,transparent 52%),
  radial-gradient(1mm 1mm at 126mm 20mm,#fff 50%,transparent 52%),radial-gradient(.8mm .8mm at 18mm 62mm,#fff 50%,transparent 52%),
  radial-gradient(1.2mm 1.2mm at 58mm 74mm,#fff 50%,transparent 52%),radial-gradient(.9mm .9mm at 150mm 60mm,#fff 50%,transparent 52%),
  radial-gradient(1mm 1mm at 196mm 44mm,#fff 50%,transparent 52%),radial-gradient(.8mm .8mm at 104mm 96mm,#fff 50%,transparent 52%);
  background-size:210mm 110mm}
.moon{position:absolute;right:14mm;top:12mm;width:24mm;height:24mm;border-radius:50%;background:#FBEFD6;box-shadow:0 0 0 4mm rgba(251,239,214,.07),0 0 0 9mm rgba(251,239,214,.04)}
.logo{position:absolute;left:12mm;top:10mm;width:24mm;height:auto}
.eyebrow{position:absolute;left:12mm;right:44mm;top:38mm;margin:0;font:600 10.5pt var(--body);letter-spacing:.16em;text-transform:uppercase;color:var(--gold)}
.title{position:absolute;left:12mm;right:12mm;top:46mm;margin:0;font:800 50pt/.95 var(--head);letter-spacing:-.01em;color:var(--cream)}
.title em{font-style:italic;font-weight:700;color:var(--gold)}
.title.long{font-size:40pt}
.title.longer{font-size:33pt}
.roofs{position:absolute;left:0;right:0;top:120mm;width:210mm;height:24mm}
.art{position:absolute;right:8mm;top:84mm;width:110mm;height:auto;filter:drop-shadow(0 3mm 3mm rgba(20,2,5,.35))}

.low{position:absolute;left:12mm;right:12mm;top:150mm;bottom:56mm;display:grid;grid-template-columns:minmax(0,1fr) 58mm;gap:8mm;align-items:start}
.low .scan{align-self:end}
.nights{list-style:none;margin:0;padding:0;display:grid;gap:1.5mm}
.nights li{display:grid;grid-template-columns:27mm minmax(0,1fr);gap:3mm;align-items:center;border-bottom:.35mm dashed rgba(94,36,39,.3);padding-bottom:1.5mm}
.nights .d{font:700 10pt var(--body);color:var(--crimson);background:var(--tan-soft);border-radius:2.4mm;padding:1.2mm 2mm;text-align:center}
.nights .a{font:700 12.5pt/1.15 var(--head);color:var(--ink)}
.nights .t{display:block;font:400 8.5pt var(--body);color:var(--muted)}
.one{display:grid;gap:5mm}
.one .when{margin:0;font:800 34pt/1.02 var(--head);color:var(--crimson)}
.one .time{margin:0;font:600 16pt var(--body);color:var(--ink)}
.one .bring{margin:0;font:400 13.5pt/1.5 var(--body);color:var(--slate)}
.money{position:absolute;left:12mm;right:12mm;bottom:38mm;margin:0;text-align:center;background:var(--holly);color:var(--cream);border-radius:4mm;padding:3.6mm 4.4mm;font:700 13pt/1.3 var(--head)}
.scan{background:var(--card);border:1.2mm solid var(--ink);border-radius:6mm;box-shadow:0 2mm 0 var(--ink);padding:4mm;text-align:center}
.scan svg{width:48mm;height:48mm;display:block;margin:0 auto}
.scan b{display:block;margin-top:2.4mm;font:800 17pt/1.05 var(--head);color:var(--crimson)}
.scan span{display:block;margin-top:1mm;font:600 11pt var(--body);color:var(--ink)}
.foot{position:absolute;left:0;right:0;bottom:0;height:32mm;background:var(--maroon);color:var(--cream);padding:6mm 12mm;display:grid;align-content:center;gap:1.4mm}
.foot p{margin:0;font-size:9.5pt;line-height:1.4}
.foot .small{font-size:7.5pt;opacity:.85}
@media print{html,body{background:#fff}.bar{display:none}.paper{margin:0;box-shadow:none}}
`;

const ROOFS =
  '<svg class="roofs" viewBox="0 0 210 24" preserveAspectRatio="none" aria-hidden="true">' +
  '<path fill="#64121D" d="M0 24V12h6V9l7-5 7 5v3h7V7h5V5h2v2h5v5h10V9l8-5 8 5v3h9V6l6-4 6 4v6h9V9l8-5 8 5v3h10V8h4V6h2v2h5v4h11V10l8-6 8 6v2h9V8l6-4 6 4v4h8V24z"/>' +
  '<path fill="#3A0810" d="M0 24V16h13v-2l6-4 6 4v2h18v-1l5-4 5 4v1h22v-2l7-4 7 4v2h20v-1l6-4 6 4v1h22v-2l6-4 6 4v2h20v-2l6-3 6 3v2h10V24z"/>' +
  '<path fill="#F8F5EE" d="M0 20c35-3 70 3 105 0s70-3 105 0V24H0z"/></svg>';

export interface PosterInput {
  nights: readonly SleighNight[];
  /** One night's poster, or null for the poster with every night. */
  night: SleighNight | null;
  size: PosterSize;
  /** The named code's own link (namedShortLink), which the QR code holds. */
  qrUrl: string;
  assets: PosterAssets;
}

export function renderSleighPoster(o: PosterInput): string {
  const sorted = [...o.nights].sort((a, b) => a.nightOn.localeCompare(b.nightOn));
  const qr = qrSvg(o.qrUrl, { ecc: "M", margin: 2, title: "QR code for nbcc.scot/sleigh" });
  const n = o.night;
  const place = n ? n.areas : "Kilmarnock";
  const titleClass = place.length > 34 ? " longer" : place.length > 18 ? " long" : "";
  const title = `Santa’s coming to <em>${escapeHtml(place)}!</em>`;

  const scan = `<div class="scan">${qr}<b>Scan to give</b><span>nbcc.scot/sleigh</span></div>`;
  const money = '<p class="money">Every pound in Santa’s bucket helps fill a red bag for Christmas morning.</p>';

  const lower = n
    ? '<div class="one">' +
      `<p class="when">${escapeHtml(when(n))}</p>` +
      `<p class="time">${escapeHtml(timesLabel(n))}</p>` +
      '<p class="bring">Listen for the bells, bring the family out to wave, and pop a coin in Santa’s bucket. Can’t make it? Scan the code to give.</p>' +
      "</div>" +
      scan
    : '<div class="one">' +
      '<ol class="nights">' +
      sorted
        .map(
          (x) =>
            `<li><span class="d">${escapeHtml(when(x))}</span><span class="a">${escapeHtml(x.areas)}<span class="t">${escapeHtml(timesLabel(x))}</span></span></li>`,
        )
        .join("") +
      "</ol>" +
      "</div>" +
      scan;

  const sheet =
    '<div class="sheet">' +
    '<div class="sky"><div class="snow"></div><span class="moon"></span>' +
    `<img class="logo" src="${o.assets.logo}" alt="NBCC" />` +
    '<p class="eyebrow">Kilmarnock Santa Sleigh 2026</p>' +
    `<h1 class="title${titleClass}">${title}</h1>` +
    "</div>" +
    ROOFS +
    `<img class="art" src="${o.assets.art}" alt="Santa and an NBCC elf waving from a red sleigh full of presents" />` +
    `<div class="low">${lower}</div>` +
    money +
    '<div class="foot">' +
    `<p>${escapeHtml(ABOUT_NBCC_SHORT)}</p>` +
    '<p class="small">Night Before Christmas Campaign, Scottish Charity Number SC047995. Regulated by the Scottish Charity Regulator, OSCR.</p>' +
    "</div></div>";

  const paper = o.size === "a3" ? "A3 portrait" : "A4 portrait";
  const label = n ? `${place}, ${when(n)}` : "every night";
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Santa Sleigh poster, ${escapeHtml(label)} (${o.size.toUpperCase()}) | NBCC</title>
<style>${o.assets.fontCss}${CSS}
@page{size:${paper};margin:0}</style>
</head>
<body>
<div class="bar"><button type="button" onclick="window.print()">Print or save as PDF</button><span>In the print window, choose ${paper.split(" ")[0]}, switch on background graphics and switch off headers and footers.</span></div>
<div class="paper ${o.size}">${sheet}</div>
</body>
</html>`;
}
