import { SCHOOL_LOGO_SRC } from "../logo";
import { giftTag, rosette } from "./paper";

// NBCC Elf Detective School: the present at the top of the enrol page, in paper
// (docs/superpowers/specs/2026-11-04-elf-paper-design.md): the painted red present, with the
// school's elf peeking out from behind it over the bow, a paper gift tag ("Top secret") and a paper
// rosette ("24 prizes"). The elf is the school's own logo, cut above the line under its hands, inside
// an edge that never moves, with the present laid over it: however the elf bobs, the bow hides where
// it is cut (Jaimie, 3 November 2026: the line under the elf showed above the box). Where each piece
// sits, and the motion, are in assets/css/elf.css; the motion plays only for someone who has not
// asked for less. Unit tested in test/unit/elf-look.test.ts.

const PRESENT = "/assets/img/elf/paper/deco/present-crimson.webp";

/** The painted present with the school's elf peeking out from behind it. */
export function giftHero(): string {
  return (
    `<div class="elf-gift">` +
    `<div class="elf-gift__art" role="img" aria-label="The Elf Detective School elf peeking out of a red present">` +
    `<span class="elf-gift__edge"><img class="elf-gift__peek" src="${SCHOOL_LOGO_SRC}" width="640" height="640" alt="" decoding="async" /></span>` +
    `<img class="elf-gift__box" src="${PRESENT}" width="479" height="480" alt="" decoding="async" />` +
    `</div>` +
    `<span class="elf-gift__tag">${giftTag({ i: 0, colour: "card" })}<span class="elf-gift__words">Top secret</span></span>` +
    `<span class="elf-gift__seal">${rosette({ className: "elf-gift__rosette", petals: 18, tails: true })}<b>24</b> <small>prizes</small></span>` +
    `</div>`
  );
}
