import { escapeHtml } from "../events/render";
import { materialAssets, shell } from "../fundraising/materials";
import { qrSvg } from "../fundraising/qr";
import { MATERIALS_STATEMENT } from "../legal/registration";
import { DOOR_COUNT, type Door } from "./calendar";
import { isUsableSecretWord } from "./claim";
import type { Rank } from "./progress";
import { drawElf, type WardrobeState } from "./wardrobe";
import { clockWords, longDayWords } from "./words";

// NBCC Elf Detective School: the things that are printed or shared. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a4-print.md.
//
// Five pieces: the poster for a hiding place, the card for its staff, the tag an elf wears, the
// graduate's certificate, and the share card. The four printed ones sit in the site's own print
// page (shell in src/fundraising/materials.ts), with its fonts and its "Print or save as PDF"
// button, so they print the way NBCC's other materials do.
//
// Two of them hold secrets. The staff card names the place's day, and the tag carries the elf's
// secret word: both are for staff to print, never for a public address. The poster is the opposite:
// it stays in a shop window all month, so it says nothing about when the elf is there.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-print.test.ts.

/** A hiding place, as its poster needs it. `posterUrl` is the whole address of its poster page. */
export interface PlacePrint {
  placeName: string;
  placeTown: string;
  posterUrl: string;
}

export interface StaffCardPrint extends PlacePrint {
  door: Door;
  elfName: string;
  clueAt: Date;
  /** NBCC's number for the shop to ring, set in the admin. */
  phone: string;
}

export interface TagPrint {
  elfName: string;
  secretWord: string;
}

export interface CertificatePrint {
  /** The detective's name as their own family sees it. */
  name: string;
  badgeNumber: string;
  year: number;
  goldSeal: boolean;
  look: unknown;
  state: WardrobeState;
  awardedOn: Date;
}

export interface ShareCardPrint {
  /** The name as the PUBLIC may see it: from detectiveName in src/elf/names.ts, never the family's own. */
  publicName: string;
  rank: Rank;
  doorsDone: number;
  look: unknown;
  state: WardrobeState;
  year: number;
}

const GROWN_UP = "Under 16? Bring a grown up with you to every hiding place.";
const real = (d: Date): boolean => d instanceof Date && Number.isFinite(d.getTime());
const count = (n: unknown): number => Math.max(0, Math.floor(Number(n)) || 0);

/** Only the address of a poster page on a secure site may go into a code that will be printed and
 *  taped to a shop window for a month. Anything else is a mistake worth stopping for. */
function posterAddress(url: string): string {
  if (typeof url !== "string" || !/^https:\/\/[a-z0-9.-]+\/elf\/p\/[a-z0-9-]+$/.test(url)) {
    throw new Error("The poster needs the https address of a poster page, such as https://nbcc.scot/elf/p/the-code");
  }
  return url;
}

const BASE_CSS = `
  .page{background:var(--cream);color:var(--slate);display:flex;flex-direction:column}
  .elf-band{background:var(--maroon);color:var(--cream);padding:9mm 14mm;display:flex;align-items:center;gap:8mm}
  .elf-band img{width:24mm;height:24mm}
  .elf-band p{margin:0;font-family:var(--head);font-weight:800;font-size:19pt;line-height:1.15}
  .elf-body{flex:1;padding:10mm 14mm 0;display:flex;flex-direction:column}
  h1{font-family:var(--head);font-weight:800;color:var(--crimson);margin:0;line-height:1.05}
  h2{font-family:var(--head);font-weight:800;color:var(--maroon);margin:7mm 0 2mm;font-size:15pt}
  p,li{font-size:12pt;line-height:1.5}
  p{margin:0 0 3mm}
  .elf-statement{margin:auto 14mm 8mm;padding-top:4mm;border-top:.4mm solid var(--line);font-size:7.5pt;line-height:1.45;color:var(--muted)}
  .elf-grown{background:var(--tan-soft);border-radius:3mm;padding:3mm 5mm;margin-top:5mm}`;

const band = (logo: string): string =>
  `<div class="elf-band"><img src="${logo}" alt="NBCC" width="96" height="96"><p>NBCC Elf Detective School</p></div>`;
const statement = `<p class="elf-statement">${escapeHtml(MATERIALS_STATEMENT)}</p>`;

/** The poster a hiding place puts in its window. */
export function renderElfPoster(p: PlacePrint): string {
  const assets = materialAssets();
  const url = posterAddress(p.posterUrl);
  const place = escapeHtml(p.placeName);
  const css = `${BASE_CSS}
  .poster h1{font-size:43pt;margin-top:2mm}
  .poster .where{font-family:var(--head);font-weight:800;font-size:26pt;color:var(--maroon);margin:4mm 0 0}
  .poster .scan{display:flex;gap:10mm;align-items:center;margin:8mm 0 7mm}
  .poster .p-qr{flex:none;width:92mm;height:92mm;background:#fff;border-radius:4mm;padding:3mm;border:.6mm solid var(--line)}
  .poster .p-qr svg{width:100%;height:100%;display:block}
  .poster .scan p{font-size:15pt}
  .poster .scan b{display:block;font-family:var(--head);font-weight:800;font-size:34pt;line-height:1.08;color:var(--holly);margin-bottom:2mm}
  .poster .how p{font-size:15.5pt;margin-bottom:3mm}
  .poster .elf-grown{font-size:14pt}`;
  const body = `<div class="page portrait poster">
${band(assets.logoOnDark)}
<div class="elf-body">
  <h1>This is a hiding place</h1>
  <p class="where">${place}, ${escapeHtml(p.placeTown)}</p>
  <div class="scan">
    <div class="p-qr">${qrSvg(url, { title: `QR code for ${p.placeName}'s Elf Detective School page` })}</div>
    <p><b>Detectives, scan here</b>with a phone's camera.</p>
  </div>
  <div class="how">
    <p>Found the elf? Scan, then type the secret word on its tag.</p>
    <p>Here for a candy cane? Scan to check in once this place's door has opened.</p>
    <p>Not a detective yet? Scan to join the hunt.</p>
  </div>
  <p class="elf-grown">${GROWN_UP}</p>
</div>
${statement}
</div>`;
  return shell({ title: `Elf Detective School poster for ${place}`, paper: "A4 portrait", fontCss: assets.fontCss, css, toolbar: `<span>Poster for ${place}</span>`, body });
}

/** The card for the staff of a hiding place. It names their day: for the shop only. */
export function renderStaffCard(c: StaffCardPrint): string {
  if (!real(c.clueAt)) throw new Error("The staff card needs the real time the clue comes out");
  const assets = materialAssets();
  posterAddress(c.posterUrl);
  const place = escapeHtml(c.placeName);
  const elf = escapeHtml(c.elfName);
  const css = `${BASE_CSS}
  .card h1{font-size:26pt}
  .card .elf-body p,.card li{font-size:11pt}
  .card h2{margin-top:5mm;font-size:14pt}
  .card ol{margin:0 0 3mm;padding-left:6mm}
  .card .day{background:var(--holly);color:var(--cream);border-radius:3mm;padding:4mm 6mm;margin-top:5mm}
  .card .day p{margin:0;font-size:13pt}
  .card .ring{font-family:var(--head);font-weight:800;font-size:20pt;color:var(--maroon)}`;
  const body = `<div class="page portrait card">
${band(assets.logoOnDark)}
<div class="elf-body">
  <h1>For the team at ${place}</h1>
  <div class="day">
    <p>Your elf is ${elf}. Your day is ${longDayWords(c.clueAt)}: door ${count(c.door)}.</p>
    <p>The clue comes out at ${clockWords(c.clueAt)}. Please put ${elf} out, wearing its tag, before then.</p>
  </div>
  <h2>Keep it a secret</h2>
  <p>Please do not tell anyone which day is yours. The poster stays up all month, so nobody can tell from the window.</p>
  <h2>When a detective finds ${elf}</h2>
  <ol>
    <li>They scan your poster and type the secret word on the tag.</li>
    <li>The first to do it sees a gold screen that says You're first! Check three things. It names ${place}. It shows the right date. Its clock is ticking: a picture of the screen does not tick.</li>
    <li>Then hand over ${elf} and the prize. Thank you!</li>
  </ol>
  <h2>If a screen says too many wrong words</h2>
  <p>Someone holding ${elf} has mistyped the word six times. Please phone NBCC and we will sort it out.</p>
  <p class="ring">${escapeHtml(c.phone)}</p>
  <h2>If nobody finds ${elf} before you close</h2>
  <p>Leave ${elf} out when you next open. The first detective to type the word still wins.</p>
  <h2>After that</h2>
  <p>Families will keep calling in for their candy cane. They scan the poster themselves: there is nothing you need to do.</p>
</div>
${statement}
</div>`;
  return shell({ title: `Elf Detective School staff card for ${place}`, paper: "A4 portrait", fontCss: assets.fontCss, css, toolbar: `<span>Staff card for ${place}. For the shop only: it names their day.</span>`, body });
}

/** The tag an elf wears, to cut out. It carries the secret word: for staff to print. */
export function renderElfTag(t: TagPrint): string {
  if (!isUsableSecretWord(t.secretWord)) throw new Error("A tag's word needs a letter and at least three numbers, like SNOWBALL 472");
  const assets = materialAssets();
  const elf = escapeHtml(t.elfName);
  const css = `${BASE_CSS}
  .tags .elf-body{align-items:flex-start}
  .tag{width:105mm;border:.5mm dashed var(--maroon);border-radius:5mm;padding:7mm 8mm;background:#fff;margin-top:4mm}
  .tag p{margin:0 0 2mm;font-size:11pt}
  .tag .hello{font-family:var(--head);font-weight:800;font-size:20pt;color:var(--crimson);line-height:1.1}
  .tag .word{font-family:var(--head);font-weight:800;font-size:27pt;letter-spacing:.04em;color:var(--maroon);margin:3mm 0;overflow-wrap:anywhere}
  .tags .cut{color:var(--muted);font-size:10pt}`;
  const body = `<div class="page portrait tags">
${band(assets.logoOnDark)}
<div class="elf-body">
  <p class="cut">Cut along the dotted line and tie the tag to ${elf}.</p>
  <div class="tag">
    <p class="hello">You found me! I am ${elf}.</p>
    <p>Scan the poster here and type my secret word:</p>
    <p class="word">${escapeHtml(t.secretWord.toUpperCase())}</p>
    <p>The first detective to type it wins me.</p>
  </div>
</div>
${statement}
</div>`;
  return shell({ title: `Elf Detective School tag for ${elf}`, paper: "A4 portrait", fontCss: assets.fontCss, css, toolbar: `<span>Tag for ${elf}. It carries the secret word: keep it private.</span>`, body });
}

/** The certificate for a detective who has done all 24 doors. */
export function renderElfCertificate(c: CertificatePrint): string {
  const assets = materialAssets();
  const name = escapeHtml(c.name);
  const year = count(c.year);
  const when = real(c.awardedOn) ? `${longDayWords(c.awardedOn)} ${year}` : "";
  const seal =
    c.goldSeal === true
      ? `<div class="cert-seal"><b>Gold seal</b><span>Visited all ${DOOR_COUNT} hiding places</span></div>`
      : "";
  const css = `
  .cert{background:var(--cream);display:flex;flex-direction:column;padding:10mm}
  .cert-frame{flex:1;border:1.2mm solid var(--gold);border-radius:5mm;outline:.4mm solid var(--gold-soft);outline-offset:-3mm;padding:10mm 14mm 6mm;
    display:grid;grid-template-columns:1fr 62mm;gap:8mm;align-items:center}
  .cert h1{font-family:var(--head);font-weight:800;color:var(--crimson);font-size:38pt;line-height:1.1;margin:0 0 6mm}
  .cert .class{font-size:12pt;letter-spacing:.2em;text-transform:uppercase;color:var(--holly);margin:0 0 3mm}
  .cert p{margin:0 0 3mm;font-size:15pt;line-height:1.5}
  .cert .who{font-family:var(--head);font-weight:800;font-size:42pt;line-height:1.1;color:var(--maroon);margin:2mm 0 5mm;overflow-wrap:anywhere}
  .cert .small{font-size:11.5pt;color:var(--muted)}
  .cert-elf{background:var(--tan-soft);border-radius:5mm;padding:4mm}
  .cert-elf svg{display:block;width:100%;height:auto}
  .cert-seal{margin-top:4mm;background:var(--gold);color:#2A1C05;border-radius:4mm;padding:3mm 4mm;text-align:center}
  .cert-seal b{display:block;font-family:var(--head);font-weight:800;font-size:15pt}
  .cert-seal span{font-size:9.5pt}
  .cert .elf-statement{margin:5mm 4mm 0;padding-top:3mm;border-top:.4mm solid var(--line);font-size:7.5pt;line-height:1.45;color:var(--muted)}`;
  const body = `<div class="page landscape cert">
<div class="cert-frame">
  <div>
    <p class="class">NBCC Elf Detective School &middot; Class of ${year}</p>
    <h1>Graduate Elf Detective</h1>
    <p>This is to say that</p>
    <p class="who">${name}</p>
    <p>has done all ${DOOR_COUNT} doors and graduates from NBCC Elf Detective School.</p>
    <p class="small">Badge ${escapeHtml(c.badgeNumber)}${when ? ` &middot; ${when}` : ""}</p>
    <p class="small">With thanks from everyone at the Elves' Workshop, Annbank.</p>
  </div>
  <div>
    <div class="cert-elf">${drawElf(c.look, c.state, { size: 220, backdrop: false, key: "cert", label: `${c.name}'s elf` })}</div>
    ${seal}
  </div>
</div>
${statement}
</div>`;
  return shell({ title: `Elf Detective School certificate for ${name}`, paper: "A4 landscape", fontCss: assets.fontCss, css, toolbar: `<span>Certificate for ${name}</span>`, body });
}

/** The card a family can share: the elf and the rank, never a photo, and the public form of the
 *  name. One SVG of 1200 by 630; Stage B turns it into a PNG. It uses fonts every computer has,
 *  because a picture made on the server cannot fetch the site's own. */
export function shareCardSvg(s: ShareCardPrint): string {
  const serif = "Georgia, 'Times New Roman', serif";
  const sans = "Verdana, Arial, sans-serif";
  const elf = drawElf(s.look, s.state, { size: 380, backdrop: true, label: false, key: "share" });
  // A picture cannot wrap its words, so a long name or rank is set smaller until it fits the
  // 620 units beside the elf. A bold serif letter is a little over half as wide as it is tall.
  const fit = (words: string, biggest: number): number => Math.max(24, Math.min(biggest, Math.floor(620 / (Math.max(1, words.length) * 0.56))));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeHtml(`${s.publicName}, ${s.rank}`)}">` +
    `<rect width="1200" height="630" fill="#F8F5EE"/>` +
    `<rect x="24" y="24" width="1152" height="582" rx="28" fill="none" stroke="#C02238" stroke-width="6"/>` +
    `<g transform="translate(70 68)">${elf}</g>` +
    `<text x="510" y="170" font-family="${sans}" font-size="30" letter-spacing="5" fill="#1A531A">NBCC Elf Detective School ${count(s.year)}</text>` +
    `<text x="510" y="270" font-family="${serif}" font-weight="700" font-size="${fit(s.publicName, 58)}" fill="#800000">${escapeHtml(s.publicName)}</text>` +
    `<text x="510" y="360" font-family="${serif}" font-weight="700" font-size="${fit(s.rank, 76)}" fill="#C02238">${escapeHtml(s.rank)}</text>` +
    `<text x="510" y="440" font-family="${sans}" font-size="34" fill="#333333">${Math.min(DOOR_COUNT, count(s.doorsDone))} of ${DOOR_COUNT} doors done</text>` +
    `</svg>`
  );
}
