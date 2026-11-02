import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// The Festive Ball table card, A6 and four to an A4 sheet, as two HTML pages for Chrome to print to PDF.
// Run node tools/ball-bags/qr.mjs first, then from the repo root: node tools/ball-bags/card.mjs
// Reads and writes tools/ball-bags/out/ (git ignored); see tools/ball-bags/README.md.
//
// The look is the new home page's "Where would you like to start?" band (assets/css/home-top.css):
// the quilted maroon card back, the gold ribbon and bow, and a cream gift tag hanging from it, here
// carrying the QR code. The NBCC elf logo sits on cream, as the brand rules ask (.impeccable.md).
mkdirSync("tools/ball-bags/out", { recursive: true });
const qr = readFileSync("tools/ball-bags/out/bag-qr.svg", "utf8").replace("<svg ", '<svg class="qr" ');
const logo = "../../../assets/img/nbcc-logo-full.svg";

// The home page's bow (index.html), unchanged.
const bow = `<svg class="bow" viewBox="0 0 120 70" aria-hidden="true"><g fill="#D9A93E">
<path d="M52 36L30 68l14-2 6 10 12-36zM68 36l22 32-14-2-6 10-12-36z"/>
<path d="M60 32C46 8 8 2 8 26s38 22 52 6zM60 32c14-24 52-30 52-6s-38 22-52 6z"/></g>
<path fill="#B8862B" d="M60 32C50 18 28 14 26 26c10-2 24 0 34 6zM60 32c10-14 32-18 34-6-10-2-24 0-34 6z"/>
<rect fill="#B8862B" x="50" y="22" width="20" height="20" rx="6"/></svg>`;

// The home page's drift, the wave under the band.
const wave = `<svg class="wave" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true">
<path fill="currentColor" d="M0 62c90-34 170-44 262-20s150 44 252 26 176-58 292-44 168 54 276 50 170-40 358-34v60H0z"/></svg>`;

const grain = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='.13'/%3E%3C/svg%3E")`;

const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#F8F5EE}
.c{--gold:#D9A93E;--crimson:#C02238;--maroon:#800000;--cream:#F8F5EE;--card:#FFFDFA;--slate:#333333;--soft:#6F6A66;
  width:105mm;height:148mm;position:relative;overflow:hidden;background:var(--cream);font-family:Poppins,system-ui,sans-serif;color:var(--slate)}
.band{position:absolute;left:0;right:0;top:0;height:80mm;color:var(--cream);
  background:radial-gradient(120% 90% at 18% 0,#8f0a0a 0,var(--maroon) 46%,#5E0000 100%)}
.band::before{content:"";position:absolute;inset:0;background-image:${grain},
  repeating-linear-gradient(45deg,rgba(248,245,238,.085) 0 .3mm,transparent .3mm 5.2mm),
  repeating-linear-gradient(-45deg,rgba(248,245,238,.085) 0 .3mm,transparent .3mm 5.2mm)}
.wave{position:absolute;left:0;bottom:-.3mm;width:100%;height:9mm;color:var(--cream);display:block}
.top{position:relative;padding:8.5mm 8mm 0;display:flex;justify-content:space-between;align-items:flex-start;gap:3mm}
.eyebrow{font-size:6.4pt;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
h1{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:23pt;line-height:1;letter-spacing:-.01em;color:var(--cream);margin-top:2.2mm}
h1 em{font-style:italic;font-weight:700}
.seal{flex:none;width:19mm;height:19mm;margin-top:1mm;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(circle at 35% 30%,#f0cf7a,var(--gold) 55%,#b8862b);color:#5E0000;transform:rotate(8deg);
  box-shadow:0 1.6mm 2.4mm -1mm rgba(30,0,0,.55),inset 0 0 0 .5mm rgba(255,240,200,.55)}
.seal b{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:15pt;line-height:1}
.seal span{font-size:5.6pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-top:.4mm}
.ribbon{position:absolute;left:0;right:0;top:37.5mm;height:2.6mm;background:linear-gradient(180deg,#e4bb5b,var(--gold) 45%,#b8862b);box-shadow:0 1.4mm 2mm -1mm rgba(30,0,0,.6)}
.bow{position:absolute;left:50%;top:38.8mm;width:21mm;height:auto;transform:translate(-50%,-48%);filter:drop-shadow(0 1mm 1mm rgba(30,0,0,.4));z-index:3}
.string{position:absolute;left:50%;top:40mm;width:.5mm;height:7.5mm;margin-left:-.25mm;background:repeating-linear-gradient(180deg,var(--gold) 0 .7mm,#b8862b .7mm 1.4mm);z-index:2}
.tag{position:absolute;left:50%;top:43.5mm;width:56mm;margin-left:-28mm;transform:rotate(-1.4deg);transform-origin:50% 0;filter:drop-shadow(0 3mm 3mm rgba(35,0,0,.38));z-index:1}
.tag::after{content:"";position:absolute;left:50%;top:2.3mm;width:5mm;height:5mm;margin-left:-2.5mm;border-radius:50%;border:.7mm solid var(--gold);box-shadow:0 .2mm .5mm rgba(30,0,0,.4)}
.face{--k:6mm;background:#FFFFFF;padding:9.5mm 5mm 3.2mm;display:flex;flex-direction:column;align-items:center;border-radius:0 0 4mm 4mm;
  clip-path:polygon(var(--k) 0,calc(100% - var(--k)) 0,100% var(--k),100% 100%,0 100%,0 var(--k));
  -webkit-mask:radial-gradient(circle 1.9mm at 50% 4.8mm,transparent 97%,#000);mask:radial-gradient(circle 1.9mm at 50% 4.8mm,transparent 97%,#000)}
.qr{width:44mm;height:44mm;display:block}
.scan{font-family:Caveat,cursive;font-weight:700;font-size:13.5pt;line-height:1;color:var(--maroon);margin-top:1.2mm;text-align:center;white-space:nowrap}
.below{position:absolute;left:0;right:0;top:109.5mm;padding:0 9mm;text-align:center}
.line{font-size:7.9pt;line-height:1.5;text-wrap:pretty}
.line b{color:var(--crimson);font-weight:600}
.foot{position:absolute;left:0;right:0;bottom:6mm;display:flex;align-items:center;justify-content:center;gap:3mm}
.foot img{height:10.5mm;width:auto;display:block}
.foot p{font-size:6pt;line-height:1.45;color:var(--soft);text-align:left}
.foot p b{display:block;font-size:8.4pt;font-weight:600;color:var(--maroon);letter-spacing:.01em}
`;

const card = `<div class="c">
<div class="band">
<div class="top"><div><p class="eyebrow">NBCC Festive Ball</p><h1>Fill a red bag<br>this <em>Christmas.</em></h1></div>
<p class="seal"><b>£50</b><span>a bag</span></p></div>
${wave}</div>
<div class="ribbon"></div>${bow}<div class="string"></div>
<div class="tag"><div class="face">${qr}<p class="scan">Scan with your phone camera</p></div></div>
<div class="below"><p class="line"><b>£50 could fill a full red bag</b> for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open. Give one, or a few.</p></div>
<div class="foot"><img src="${logo}" alt="NBCC"><p><b>nbcc.scot/bag</b>Night Before Christmas Campaign<br>A Scottish charity, SC047995</p></div>
</div>`;

const fonts = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Playfair+Display:ital,wght@0,800;1,700&family=Poppins:wght@400;600&display=block" rel="stylesheet">`;

writeFileSync("tools/ball-bags/out/card-a6.html",
  `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>@page{size:105mm 148mm;margin:0}${css}</style></head><body>${card}</body></html>`);
writeFileSync("tools/ball-bags/out/card-a4-four.html",
  `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>@page{size:210mm 297mm;margin:0}${css}
.sheet{width:210mm;height:296mm;display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148mm 148mm;position:relative}
.sheet::after{content:"";position:absolute;inset:0;background:linear-gradient(#bbb,#bbb) 105mm 0/0.2mm 100% no-repeat,linear-gradient(#bbb,#bbb) 0 148mm/100% 0.2mm no-repeat;pointer-events:none}</style></head><body><div class="sheet">${card}${card}${card}${card}</div></body></html>`);
console.log("written");
