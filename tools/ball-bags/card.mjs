import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// The Festive Ball table card, A6 and four to an A4 sheet, as two HTML pages for Chrome to print to PDF.
// Run node tools/ball-bags/qr.mjs first, then from the repo root: node tools/ball-bags/card.mjs
// Reads and writes tools/ball-bags/out/ (git ignored); see tools/ball-bags/README.md.
mkdirSync("tools/ball-bags/out", { recursive: true });
const qr = readFileSync("tools/ball-bags/out/bag-qr.svg", "utf8").replace("<svg ", '<svg class="qr" ');

const bag = `<svg class="bag" viewBox="0 0 120 132" aria-hidden="true">
<path class="cord back" d="M44 36C44 10 88 10 88 36"/>
<path class="tissue" d="M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z"/>
<path class="paper" d="M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z"/>
<path class="gusset" d="M92 36h16v88a4 4 0 0 1-4 4H92z"/>
<path class="fold" d="M12 36h96v10H12z"/>
<path class="crease" d="M12 46h96M92 46v82"/>
<path class="cord" d="M32 40C32 12 76 12 76 40"/>
<circle class="eyelet" cx="32" cy="41" r="2.2"/><circle class="eyelet" cx="76" cy="41" r="2.2"/>
<g class="tag"><path class="string" d="M60 20c-3 9 3 21 0 31"/>
<path class="card" d="M41 44h38l11 11v35a4 4 0 0 1-4 4H34a4 4 0 0 1-4-4V55z"/>
<circle class="hole" cx="60" cy="51.5" r="2.6"/>
<text class="words"><tspan x="60" y="73">Packed</tspan><tspan x="60" y="88">with love</tspan></text></g>
<g><path class="ribbon" d="M57.5 20l-8 12 5.5-.5 2 4.5 3.5-15zM62.5 20l8 12-5.5-.5-2 4.5-3.5-15z"/>
<path class="ribbon" d="M60 18c-5-8-17-9-17-1s12 6 17 1zM60 18c5-8 17-9 17-1s-12 6-17 1z"/>
<rect class="knot" x="56" y="14" width="8" height="8" rx="2.5"/></g></svg>`;

const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.c{width:105mm;height:148mm;background:#F8F5EE;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;padding:8mm 8mm 6mm;font-family:Poppins,sans-serif;color:#333}
.c::before{content:"";position:absolute;inset:3.5mm;border:0.5mm solid #C02238;border-radius:4mm;pointer-events:none}
.eyebrow{font-size:7pt;letter-spacing:.22em;font-weight:600;color:#800000;margin-top:1mm}
h1{font-family:'Playfair Display',serif;font-weight:800;color:#C02238;font-size:20pt;line-height:1.08;text-align:center;margin:2.5mm 0 0}
.mid{display:flex;align-items:center;gap:3mm;margin:6mm 0 4mm}
.bagwrap{position:relative;width:28mm}
.bag{width:28mm;height:auto;display:block}
.price{position:absolute;right:-4mm;bottom:-1mm;width:13mm;height:13mm;border-radius:50%;background:#800000;color:#F8F5EE;font-family:'Playfair Display',serif;font-weight:800;font-size:11pt;display:flex;align-items:center;justify-content:center;transform:rotate(-8deg);border:0.6mm solid #F8F5EE}
.qrbox{background:#fff;border-radius:3mm;padding:1.5mm;border:0.4mm solid #E8C4B4}
.qr{width:52mm;height:52mm;display:block}
.scan{font-family:Caveat,cursive;font-weight:700;color:#800000;font-size:19pt;line-height:1.1;text-align:center;margin:1mm 0 2.5mm}
.line{font-size:9pt;line-height:1.5;text-align:center;max-width:82mm}
.line b{color:#C02238}
.foot{margin-top:auto;font-size:6.5pt;color:#6b6b6b;text-align:center;line-height:1.4}
.foot b{color:#333;font-weight:600}
.cord{fill:none;stroke:#C02238;stroke-width:3.4;stroke-linecap:round}
.cord.back{stroke:#800000;opacity:.5}
.tissue{fill:#F8F5EE;stroke:#D29C8A;stroke-width:1.2;stroke-linejoin:round}
.paper{fill:#C02238}
.gusset{fill:#800000;opacity:.16}
.fold{fill:#800000;opacity:.12}
.crease{stroke:#800000;stroke-width:1;opacity:.4;fill:none}
.eyelet{fill:#800000}
.ribbon{fill:#B8862B;stroke:#9a5a1d;stroke-width:1.1}
.knot{fill:#c79c55;stroke:#9a5a1d;stroke-width:1.1}
.tag{transform-origin:60px 20px;transform:rotate(4deg)}
.string{fill:none;stroke:#9a5a1d;stroke-width:1.1}
.card{fill:#FFFDFA;stroke:#D29C8A;stroke-width:1.3}
.hole{fill:#F3EEE3;stroke:#D29C8A;stroke-width:1.1}
.words{font-family:Caveat,cursive;font-size:15px;font-weight:700;fill:#800000;text-anchor:middle}
`;

const card = `<div class="c">
<p class="eyebrow">NBCC FESTIVE BALL</p>
<h1>Fill a red bag<br>this Christmas</h1>
<div class="mid"><div class="bagwrap">${bag}<span class="price">£50</span></div><div class="qrbox">${qr}</div></div>
<p class="scan">Scan with your phone camera</p>
<p class="line"><b>£50 fills a full red bag</b> for children, young people and vulnerable adults across South West Scotland who would otherwise wake up on Christmas morning with nothing to open. Give one, or a few.</p>
<p class="foot"><b>nbcc.scot/bag</b><br>Night Before Christmas Campaign, a Scottish charity SC047995</p>
</div>`;

writeFileSync("tools/ball-bags/out/card-a6.html",
  `<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Playfair+Display:wght@700;800&family=Poppins:wght@400;600&display=block" rel="stylesheet"><style>@page{size:105mm 148mm;margin:0}${css}</style></head><body>${card}</body></html>`);
writeFileSync("tools/ball-bags/out/card-a4-four.html",
  `<!doctype html><html><head><meta charset="utf-8"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Playfair+Display:wght@700;800&family=Poppins:wght@400;600&display=block" rel="stylesheet"><style>@page{size:210mm 297mm;margin:0}${css}
.sheet{width:210mm;height:296mm;display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148mm 148mm;position:relative}
.sheet::after{content:"";position:absolute;inset:0;background:linear-gradient(#bbb,#bbb) 105mm 0/0.2mm 100% no-repeat,linear-gradient(#bbb,#bbb) 0 148mm/100% 0.2mm no-repeat;pointer-events:none}</style></head><body><div class="sheet">${card}${card}${card}${card}</div></body></html>`);
console.log("written");
