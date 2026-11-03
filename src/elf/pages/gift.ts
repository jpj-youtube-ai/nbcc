import { SCHOOL_LOGO_SRC } from "../logo";

// NBCC Elf Detective School: the look of nbcc.scot/bag and /fill on the school's screens (wave 1
// plan, Task 11, from the walkthrough Jaimie liked on 3 November 2026): gold sparkles, and one big
// drawn red present with the school's elf peeking out of it, a "Top secret!" gift tag and a round
// red "24 prizes" seal. Drawn here as SVG (no picture file): the elf is the school's own logo with
// its lettering clipped away, so only the elf shows above the box. The motion is in assets/css/elf.css,
// and plays only for someone who has not asked for less. Unit tested in test/unit/elf-look.test.ts.

/** Gold sparkles, as on /bag: [left %, top %, size px, delay s]. Hidden from screen readers. */
export function twinkles(list: readonly (readonly [number, number, number, number])[]): string {
  return list
    .map(([x, y, w, d]) => `<span class="elf-twk" aria-hidden="true" style="left:${x}%;top:${y}%;--w:${w}px;--d:${d}s"></span>`)
    .join("");
}

const STAR4 = "M0-7L1.8-1.8 7 0 1.8 1.8 0 7-1.8 1.8-7 0-1.8-1.8z";

/** The red present with the school's elf peeking out of it. */
export function giftHero(): string {
  const svg =
    `<svg class="elf-gift__art" viewBox="0 0 300 270" role="img" aria-label="The school's elf peeking out of a red present">` +
    `<defs><clipPath id="elfGiftClip"><rect x="0" y="-60" width="300" height="175"/></clipPath><clipPath id="elfGiftEdge"><rect x="0" y="-60" width="300" height="180"/></clipPath>` +
    `<linearGradient id="elfGiftRed" x1="0" x2="1"><stop offset="0" stop-color="#D3344B"/><stop offset=".55" stop-color="#C02238"/><stop offset="1" stop-color="#A81B30"/></linearGradient>` +
    `<linearGradient id="elfGiftGold" x1="0" x2="1"><stop offset="0" stop-color="#F4D27A"/><stop offset=".5" stop-color="#E2B04A"/><stop offset="1" stop-color="#C89234"/></linearGradient>` +
    `<linearGradient id="elfGiftLid" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DA4258"/><stop offset="1" stop-color="#B51E34"/></linearGradient></defs>` +
    `<ellipse cx="150" cy="258" rx="128" ry="9" fill="#800000" opacity=".1"/>` +
    `<polygon points="46,120 222,120 254,104 78,104" fill="#6E0F1E"/>` +
    `<g class="elf-gift__lid"><rect x="40" y="86" width="196" height="34" rx="6" fill="url(#elfGiftLid)"/><rect x="126" y="86" width="24" height="34" fill="url(#elfGiftGold)"/><rect x="40" y="112" width="196" height="8" rx="3" fill="#800000" opacity=".18"/></g>` +
    // The elf moves inside a box edge that stays still (elfGiftEdge, the top of the box front), and
    // the logo itself is cut just above the line under its hands (elfGiftClip), so neither that line
    // nor a cut edge ever shows above the box.
    `<g clip-path="url(#elfGiftEdge)"><g class="elf-gift__peek"><image clip-path="url(#elfGiftClip)" href="${SCHOOL_LOGO_SRC}" x="48" y="10" width="180" height="180"/></g></g>` +
    `<rect x="46" y="120" width="176" height="128" rx="5" fill="url(#elfGiftRed)"/>` +
    `<polygon points="222,120 254,104 254,232 222,248" fill="#8E1428"/>` +
    `<polygon points="234,114 242,110 242,238 234,242" fill="#B98A2E"/>` +
    `<rect x="52" y="126" width="9" height="116" rx="4.5" fill="#FFFFFF" opacity=".12"/>` +
    `<rect x="122" y="120" width="24" height="128" fill="url(#elfGiftGold)"/>` +
    `<g fill="#F0A495" opacity=".6"><path transform="translate(80 166)" d="${STAR4}"/><path transform="translate(196 206) scale(.8)" d="${STAR4}"/><path transform="translate(92 224) scale(.7)" d="${STAR4}"/><path transform="translate(198 150) scale(.6)" d="${STAR4}"/>` +
    `<circle cx="104" cy="196" r="2"/><circle cx="176" cy="232" r="2"/><circle cx="70" cy="140" r="1.6"/><circle cx="206" cy="180" r="1.6"/></g>` +
    `<g fill="url(#elfGiftGold)" stroke="#A87622" stroke-width="1.2" stroke-linejoin="round"><path d="M134 124C110 100 92 118 104 134C112 142 126 134 134 124z"/><path d="M134 124C158 100 176 118 164 134C156 142 142 134 134 124z"/>` +
    `<path d="M130 128L116 162 126 158 132 168 134 130z"/><path d="M138 128L152 162 142 158 136 168 134 130z"/><rect x="126" y="117" width="16" height="15" rx="5"/></g></svg>`;
  return (
    `<div class="elf-gift">` +
    twinkles([
      [6, 12, 16, 0],
      [88, 8, 12, -0.9],
      [94, 40, 18, -1.7],
      [2, 52, 11, -0.4],
      [90, 72, 10, -2.1],
    ]) +
    svg +
    `<span class="elf-gift__tag">Top secret!</span>` +
    `<span class="elf-gift__seal"><b>24</b><small>prizes</small></span>` +
    `</div>`
  );
}
