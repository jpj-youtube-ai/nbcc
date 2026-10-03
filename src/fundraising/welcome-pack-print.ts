import { escapeHtml } from "../events/render";
import { MATERIALS_STATEMENT, POSTAL_ADDRESS_LINES } from "../legal/registration";
import { CHARITY_NAME, PACK_PIECES, POSTER_SIZES, shell, type MaterialAssets, type MaterialFacts, type PosterSize } from "./materials";
import { qrSvg } from "./qr";
import { EMAIL, PHONE, coveringNote, welcomeLetter, type PackItemView, type PackSubject, type PackView, type Signer } from "./welcome-pack";

// Welcome packs (Jaimie, 2026-10-03): the one print view staff open from Admin > Fundraising
// ("Print welcome pack"), built the way every printed piece is (./materials.ts): one self contained
// page, the brand fonts and the logo inlined, so it opens from the admin as a page in its own tab
// and prints or saves as a PDF from the browser. In order:
//
//   the welcome letter   A4, in the thank you letter's house style (src/thank-you/letter-page.ts):
//                        the maroon frame, our address and the logo, a script signature, the
//                        maroon foot with how to reach us and the charity statement. Their name
//                        and address sit where the window of a C5 or DL envelope shows them, with
//                        the letter folded in three: 20mm in from the left and 45mm down, in a
//                        space 90mm by 40mm that nothing else enters.
//   their posters        the A4 poster, the A3 poster and the A5 leaflet, as many of each as they
//                        asked for, each on its own paper size (a named @page for each)
//   the sponsor form     for someone raising money, never an event
//
// Anything staff left out of the pack is left out here, and out of the letter's list. What is in
// the pack but cannot be printed (buckets, the T-shirt) is listed on screen. In memory of someone, a
// gentle covering note takes the letter's place: quiet colours, no QR code, no exclamation marks.
//
// A poster asked for ten times is drawn once, and a small script copies it before printing, so the
// page stays light (the logo is inlined in every poster). The copies only show on paper.

/** Our address as the printed pieces write it, with the apostrophe (as ./envelope.ts). */
const FROM_LINES = ["The Elves' Workshop", ...POSTAL_ADDRESS_LINES.slice(1)];

export interface PackPrintInput {
  subject: PackSubject;
  view: PackView;
  facts: MaterialFacts;
  assets: MaterialAssets;
  signer: Signer;
  /** Today in words: "3 October 2026". */
  date: string;
  /** The whole pack, or the letter on its own. */
  part: "all" | "letter";
}

const LETTER_CSS = `
  .wl{page:a4p}
  .wl{width:210mm;height:297mm;background:var(--maroon);padding:7mm}
  .wl-sheet{position:relative;height:100%;background:var(--cream);display:flex;flex-direction:column;overflow:hidden}
  .wl-from{position:absolute;left:13mm;top:8mm;font-style:normal;font-weight:600;color:var(--maroon);font-size:8.5pt;line-height:1.45}
  .wl-from span{display:block}
  .wl-logo{position:absolute;right:13mm;top:6mm;height:40mm;width:auto}
  /* The window of a C5 or DL envelope, measured from the edge of the paper (the frame is 7mm). */
  .wl-to{position:absolute;left:15mm;top:41mm;width:84mm;height:34mm;display:flex;flex-direction:column;justify-content:center;
    font-size:11pt;line-height:1.32;color:#1f1b1a;overflow:hidden}
  .wl-to span{display:block;overflow-wrap:anywhere}
  .wl-to.long{font-size:9pt;line-height:1.24}
  .wl-body{flex:1;min-height:0;padding:84mm 15mm 0;display:flex;flex-direction:column}
  .wl-date{font-weight:600;color:var(--slate);font-size:9.5pt}
  .wl p.wl-greeting{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:13pt;margin:5mm 0 0}
  .wl-heading{font-family:var(--head);font-weight:800;color:var(--crimson);letter-spacing:-.01em;font-size:19pt;line-height:1.12;margin:1.5mm 0 0;overflow-wrap:anywhere}
  .wl-heading.long{font-size:14.5pt;line-height:1.16}
  .wl-open{display:flex;gap:8mm;align-items:flex-start;margin-top:4mm}
  .wl-open .words{flex:1;min-width:0}
  .wl p{font-size:10pt;line-height:1.5;color:var(--slate);margin:0 0 2.6mm;overflow-wrap:anywhere}
  .wl-qr{flex:0 0 auto;width:31mm;text-align:center}
  .wl-qr .code{background:#fff;border-radius:2.5mm;padding:1.5mm;box-shadow:0 0 0 1px var(--line)}
  .wl-qr svg{display:block;width:28mm;height:28mm}
  .wl-qr .cap{font-size:7.5pt;font-weight:600;color:var(--maroon);margin-top:1.2mm;line-height:1.3}
  .wl-pack{background:var(--tan-soft);border-left:1.1mm solid var(--crimson);border-radius:0 2mm 2mm 0;padding:3mm 5mm 3.2mm;margin:1mm 0 4mm}
  .wl-pack .intro{font-family:var(--head);font-weight:700;color:var(--maroon);font-size:11pt;margin:0 0 1.4mm}
  .wl-list{margin:0;padding:0;list-style:none;columns:2;column-gap:8mm;font-size:10pt;line-height:1.5;color:var(--slate)}
  .wl-list li{break-inside:avoid;padding-left:4.5mm;position:relative;overflow-wrap:anywhere}
  .wl-list li::before{content:"";position:absolute;left:0;top:.62em;width:1.8mm;height:1.8mm;border-radius:50%;background:var(--gold)}
  .wl-sign{margin-top:2.5mm}
  .wl-sign p{margin:0}
  .wl-sig{font-family:"Snell Roundhand","Palace Script MT","Edwardian Script ITC","Apple Chancery","Lucida Calligraphy","Lucida Handwriting",cursive;
    color:var(--crimson);font-size:25pt;line-height:1.15;margin-top:1mm}
  .wl-role{font-size:9pt;color:var(--muted);line-height:1.4}
  .wl-foot{background:var(--maroon);color:var(--cream);padding:4.5mm 8mm 4mm;text-align:center}
  .wl-reach{display:flex;justify-content:center;font-weight:600;font-size:10pt}
  .wl-reach span{padding:0 6mm}
  .wl-reach span + span{border-left:1px solid rgba(248,245,238,.3)}
  .wl-legal{font-size:7pt;line-height:1.4;opacity:.9;margin:2.6mm auto 0;max-width:178mm}
  /* More to say (a long list, a long title): closer set, so the foot is never pushed off the paper. */
  .wl.tight p{font-size:9.5pt;line-height:1.42;margin-bottom:2mm}
  .wl.tight .wl-list{font-size:9.5pt;line-height:1.42}
  .wl.tight p.wl-greeting{margin-top:3.5mm}
  .wl.tight .wl-open{margin-top:3mm}
  .wl.tight .wl-pack{padding:2.4mm 5mm 2.6mm;margin-bottom:3mm}
  /* In memory: the quieter colours of every in memory piece. Cream and tan, maroon only for names. */
  .wl.memory{background:var(--tan-soft)}
  .wl.memory p.wl-greeting{font-weight:600;margin-bottom:4mm}
  .wl.memory p{font-size:11pt;line-height:1.6;margin-bottom:3.5mm;max-width:150mm}
  .wl.memory .wl-sig{color:var(--maroon)}
  .wl.memory .wl-foot{background:var(--tan-soft);color:var(--slate)}
  .wl.memory .wl-reach span + span{border-left-color:var(--tan)}`;

const PACK_CSS = `
  .pk-label{max-width:640px;margin:26px auto -6px;padding:0 16px;font-size:.9rem;font-weight:600;color:var(--maroon);text-align:center}
  .pk-also{max-width:640px;margin:16px auto 0;padding:12px 18px;background:#fff;border:1.6px solid var(--line);border-radius:12px;
    font-size:.9rem;line-height:1.55;color:var(--slate)}
  .pk-copy{display:none}
  @media (max-width:700px){.pk-also{margin:12px 12px 0}}
  @media print{
    .pk-label,.pk-also{display:none}
    .pk-copy{display:block}
    /* Every page ends its sheet, the copies too; only the very last page of the pack does not. */
    .page{break-after:page !important;page-break-after:always !important}
    [data-pack-piece]:last-of-type > .page:last-child{break-after:auto !important;page-break-after:auto !important}
  }`;

// Before printing: each piece asked for more than once is copied that many times. The copies are
// only for paper (.pk-copy shows in print alone), so the screen stays one of each.
const COPIES_SCRIPT = `<script>
(function(){
  var pieces=document.querySelectorAll("[data-pack-piece][data-copies]");
  for(var i=0;i<pieces.length;i++){
    var piece=pieces[i],n=parseInt(piece.getAttribute("data-copies"),10)||1,page=piece.querySelector(".page");
    if(!page||n<2)continue;
    for(var c=1;c<n;c++){
      var copy=page.cloneNode(true);
      copy.classList.add("pk-copy");
      copy.setAttribute("aria-hidden","true");
      piece.appendChild(copy);
    }
  }
})();
</script>`;

const lines = (list: string[]) => list.map((l) => `<span>${escapeHtml(l)}</span>`).join("");
const andList = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function head(i: PackPrintInput): string {
  const to = [i.view.address.name, ...i.view.address.lines].filter(Boolean);
  return `<address class="wl-from">${lines(FROM_LINES)}</address>
      <img class="wl-logo" src="${i.assets.logo}" alt="${CHARITY_NAME}">
      <div class="wl-to${to.length > 5 || to.some((l) => l.length > 34) ? " long" : ""}">${lines(to)}</div>`;
}

function sign(signOff: string, signer: string, signerLines: string[]): string {
  return `<div class="wl-sign">
          <p>${escapeHtml(signOff)}</p>
          <div class="wl-sig">${escapeHtml(signer)}</div>
          ${signerLines.map((l) => `<div class="wl-role">${escapeHtml(l)}</div>`).join("")}
        </div>`;
}

function foot(): string {
  return `<div class="wl-foot">
      <div class="wl-reach"><span>${PHONE}</span><span>${EMAIL}</span><span>nbcc.scot</span></div>
      <div class="wl-legal">${escapeHtml(MATERIALS_STATEMENT)}</div>
    </div>`;
}

/** The things going in the pack: everything staff have not left out. */
const going = (view: PackView): PackItemView[] => view.items.filter((item) => !item.skippedReason);

/** The welcome letter's one A4 page. */
function letterPage(i: PackPrintInput): string {
  const page = i.facts.linkKind === "page" ? i.facts.linkWords : null;
  const l = welcomeLetter(i.subject, going(i.view), i.signer, page);
  const qr =
    page && i.facts.link
      ? `<div class="wl-qr"><div class="code">${qrSvg(i.facts.link, { title: `QR code for ${i.facts.title}` })}</div><div class="cap">Scan to see your page</div></div>`
      : "";
  const pack = l.packIntro
    ? `<div class="wl-pack"><p class="intro">${escapeHtml(l.packIntro)}</p><ul class="wl-list">${l.packList.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>`
    : "";
  const tight = l.packList.length > 6 || l.heading.length > 60;
  return `<div class="page wl${tight ? " tight" : ""}">
  <div class="wl-sheet">
    ${head(i)}
    <div class="wl-body">
      <div class="wl-date">${escapeHtml(i.date)}</div>
      <p class="wl-greeting">${escapeHtml(l.greeting)}</p>
      <h1 class="wl-heading${l.heading.length > 45 ? " long" : ""}">${escapeHtml(l.heading)}</h1>
      <div class="wl-open"><div class="words">${l.opening.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div>${qr}</div>
      ${pack}
      ${l.closing.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}
      ${sign(l.signOff, l.signer, l.signerLines)}
    </div>
    ${foot()}
  </div>
</div>`;
}

/** In memory: the covering note's one A4 page. */
function notePage(i: PackPrintInput): string {
  const n = coveringNote(i.subject, i.signer);
  return `<div class="page wl memory">
  <div class="wl-sheet">
    ${head(i)}
    <div class="wl-body">
      <div class="wl-date">${escapeHtml(i.date)}</div>
      <p class="wl-greeting">${escapeHtml(n.greeting)}</p>
      <div class="wl-open"><div class="words">${n.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}</div></div>
      ${sign(n.signOff, n.signer, n.signerLines)}
    </div>
    ${foot()}
  </div>
</div>`;
}

/** Which poster each thing in a pack prints as. */
const POSTER_OF: Record<string, PosterSize> = { posters_a4: "a4", posters_a3: "a3", leaflets: "a5" };

function piece(key: string, copies: number, label: string, pages: string): string {
  return `<section data-pack-piece="${key}" data-copies="${copies}">
<p class="pk-label">${escapeHtml(label)}</p>
${pages}
</section>`;
}

/** The pack's one print view, or the letter on its own. */
export function renderWelcomePack(i: PackPrintInput): string {
  const memory = i.view.kind === "memory";
  const title = escapeHtml(i.facts.title);
  const items = going(i.view);
  const letter = piece("letter", 1, memory ? "Covering note" : "Welcome letter", memory ? notePage(i) : letterPage(i));
  const pieces = [letter];
  const printed: string[] = [memory ? "the covering note" : "the welcome letter"];
  const also: string[] = [];
  if (i.part === "all") {
    for (const item of items) {
      if (item.key === "letter") continue;
      const size = POSTER_OF[item.key];
      if (size) {
        const n = item.quantity ?? 1;
        const name = POSTER_SIZES[size].label;
        const copies = `${name}: prints ${n} ${n === 1 ? "copy" : "copies"}${size === "a3" ? ", on A3 paper" : size === "a5" ? ", on A5 paper" : ""}`;
        pieces.push(piece(item.key, n, copies, PACK_PIECES.posterPage(i.facts, i.assets, size)));
        printed.push(item.words);
      } else if (item.key === "sponsor_form") {
        pieces.push(piece(item.key, 1, "Sponsor form: 2 pages, A4 on its side", PACK_PIECES.sponsorPages(i.facts, i.assets)));
        printed.push("the sponsor form");
      } else {
        also.push(item.waiting ? `${item.label} (waiting for their size)` : item.words);
      }
    }
  }
  const alsoHtml = also.length
    ? `<aside class="pk-also">${escapeHtml(`${memory ? "Also to send" : "Also in this pack"}, not printed here: ${andList(also)}.`)}</aside>`
    : "";
  const what = i.part === "letter" ? (memory ? "Covering note" : "Welcome letter") : i.view.title;
  return shell({
    title: `${what} for ${title}`,
    paper: { rules: PACK_PIECES.pageRules },
    fontCss: i.assets.fontCss,
    css: PACK_PIECES.posterCss(i.facts) + PACK_PIECES.sponsorCss + PACK_PIECES.pageCss + LETTER_CSS + PACK_CSS,
    toolbar: `<span>${what} for <b>${title}</b>${i.part === "all" && printed.length > 1 ? `: ${escapeHtml(andList(printed))}` : ""}</span>`,
    tip:
      i.part === "letter"
        ? "In the print window, choose A4 and switch off headers and footers. Folded in three, the address shows in the window of a C5 or DL envelope."
        : "Each page prints on its own paper size, and each poster as many times as they asked for. In the print window, switch off headers and footers. The letter, folded in three, shows the address in the window of a C5 or DL envelope.",
    body: `${alsoHtml}\n${pieces.join("\n")}`,
    tail: COPIES_SCRIPT,
  });
}
