import { DOOR_COUNT } from "../calendar";
import {
  HAIR_COLOURS,
  HAIR_STYLES,
  OUTFITS,
  SKIN_TONES,
  SLOTS,
  STYLES,
  drawElf,
  drawOutfit,
  drawPiece,
  inSentence,
  lookWords,
  normaliseLook,
  outfitUnlocked,
  outfitWords,
  pieceUnlocked,
  pieceWords,
} from "../wardrobe";
import type { ElfLook, WardrobeOutfit, WardrobeSlot, WardrobeState, WardrobeStyle } from "../wardrobe";
import { listWords, things } from "../words";
import { gift, icon } from "./icons";
import { elfPage, escapeHtml, sitePath } from "./shell";
import type { WardrobeView } from "./types";

// NBCC Elf Detective School: the wardrobe, where a detective dresses their elf. The plan is
// docs/superpowers/plans/2026-10-04-elf-detective-a3-screens.md.
//
// The page is ONE form of choices: skin and hair, a whole outfit, and a piece for each slot. Every
// choice is a radio button with a small drawing for a label, so it works with no script: pick, press
// Save, and the server keeps the look. The page's script (assets/js/elf-wardrobe-ui.js) only shows
// the elf changing as things are tried on, and saves without leaving the page.
//
// Everything in the wardrobe is shown, earned or not. What is still locked cannot be picked: it is
// drawn faint, wears a padlock and says how many doors earn it. The saved look is made safe before it
// is drawn, so the elf never wears what it has not earned, whatever was stored.
//
// Every drawing and every rule comes from the one wardrobe file the browser also loads
// (src/elf/wardrobe.ts), so the page and its script cannot disagree.
//
// Pure: no pool, no config, no clock. Unit tested in test/unit/elf-page-wardrobe.test.ts.

/** How many new things the news names before it counts the rest. */
const NEWS_NAMED = 6;

/** What is still new: the pieces as "style:colour" and the outfits by id. Only real things that the
 *  detective can already wear count. */
interface Fresh {
  pieces: Set<string>;
  outfits: Set<string>;
}

function freshThings(listed: unknown, state: WardrobeState): Fresh {
  const pieces = new Set<string>();
  const outfits = new Set<string>();
  for (const entry of Array.isArray(listed) ? listed : []) {
    if (typeof entry !== "string") continue;
    const [style, colour, more] = entry.split(":");
    if (colour === undefined) {
      if (outfitUnlocked(entry, state)) outfits.add(entry);
    } else if (more === undefined && pieceUnlocked(style, colour, state)) {
      pieces.add(`${style}:${colour}`);
    }
  }
  return { pieces, outfits };
}

/** Whole doors from none to 24, the way the wardrobe itself counts them. */
function doorsOf(state: WardrobeState): number {
  const n = state && typeof state.doorsDone === "number" && Number.isFinite(state.doorsDone) ? Math.floor(state.doorsDone) : 0;
  return Math.max(0, Math.min(DOOR_COUNT, n));
}

// ---- one choice ----------------------------------------------------------------------------

interface Tile {
  /** The radio group, and this choice's value in it. */
  name: string;
  value: string;
  id: string;
  /** The drawing, already safe SVG. */
  art: string;
  /** The words under the drawing. */
  caption: string;
  /** The whole choice in words, for a screen reader. */
  words: string;
  checked: boolean;
  /** Why it cannot be picked yet: a few words for the tile, and the same thing in full. */
  lock?: { short: string; full: string };
  fresh?: boolean;
  kind?: string;
}

function tile(t: Tile): string {
  const classes = ["elf-wd-tile"];
  if (t.kind) classes.push(`elf-wd-tile--${t.kind}`);
  if (t.lock) classes.push("is-locked");
  if (t.fresh) classes.push("is-new");
  const said = t.words + (t.lock ? `, ${t.lock.full}` : t.fresh ? ", new" : "");
  return (
    `<div class="${classes.join(" ")}">` +
    `<input type="radio" name="${t.name}" id="${t.id}" value="${escapeHtml(t.value)}"${t.checked ? " checked" : ""}${t.lock ? " disabled" : ""} />` +
    `<label for="${t.id}">` +
    (t.art ? `<span class="elf-wd-art" aria-hidden="true">${t.art}</span>` : "") +
    (t.lock
      ? `<span class="elf-wd-lock" aria-hidden="true">${icon("padlock", 13)} ${escapeHtml(t.lock.short)}</span>`
      : `<span class="elf-wd-name" aria-hidden="true">${escapeHtml(t.caption)}</span>`) +
    (t.fresh ? `<span class="elf-wd-new" aria-hidden="true">New</span>` : "") +
    `<span class="sr-only">${escapeHtml(said)}</span>` +
    `</label></div>`
  );
}

/** A choice that is only words: "None", "Bunches". */
function wordTile(name: string, id: string, value: string, label: string, checked: boolean): string {
  return (
    `<div class="elf-wd-tile elf-wd-tile--word">` +
    `<input type="radio" name="${name}" id="${id}" value="${escapeHtml(value)}"${checked ? " checked" : ""} />` +
    `<label for="${id}"><span class="elf-wd-name">${escapeHtml(label)}</span></label></div>`
  );
}

const swatch = (fill: string, edge: string): string =>
  `<svg width="40" height="40" viewBox="0 0 40 40" focusable="false"><circle cx="20" cy="20" r="17" fill="${fill}" stroke="${edge}" stroke-width="2"/></svg>`;

// ---- the sections ---------------------------------------------------------------------------

function lookPanel(look: ElfLook): string {
  const skins = SKIN_TONES.map((s, i) =>
    tile({ name: "skin", value: s.id, id: `wd-skin-${s.id}`, art: swatch(s.hex, "#B39A82"), caption: "", words: `Skin tone ${i + 1}`, checked: look.skin === s.id, kind: "swatch" }),
  ).join("");
  const hairs = HAIR_COLOURS.map((h) =>
    tile({ name: "hair", value: h.id, id: `wd-hair-${h.id}`, art: swatch(h.hex, h.dark), caption: h.name, words: `${h.name} hair`, checked: look.hair === h.id, kind: "swatch" }),
  ).join("");
  const cuts = HAIR_STYLES.map((h) => wordTile("hairStyle", `wd-cut-${h.id}`, h.id, h.name, look.hairStyle === h.id)).join("");
  return (
    `<fieldset class="elf-wd-group"><legend>Skin</legend><div class="elf-wd-row elf-wd-row--swatches">${skins}</div></fieldset>` +
    `<fieldset class="elf-wd-group"><legend>Hair colour</legend><div class="elf-wd-row elf-wd-row--swatches">${hairs}</div></fieldset>` +
    `<fieldset class="elf-wd-group"><legend>Hair style</legend><div class="elf-wd-row elf-wd-row--words">${cuts}</div></fieldset>`
  );
}

/** A thing unlocks at a number of doors DONE, cracked or visited, not when a door of that number
 *  opens on the calendar: a late joiner can see door 12 open and still be short of 12 doors. */
function doorsLock(doors: number): { short: string; full: string } {
  return { short: things(doors, "door"), full: `locked until you have done ${things(doors, "door")}` };
}

function outfitLock(outfit: WardrobeOutfit): { short: string; full: string } {
  if (outfit.special === "gold-seal") return { short: `Visit all ${DOOR_COUNT} places`, full: `locked until you have visited all ${DOOR_COUNT} places` };
  if (outfit.special === "race-win") return { short: "Win a race", full: "locked until you win a race" };
  return doorsLock(outfit.doors ?? 0);
}

function outfitsPanel(look: ElfLook, state: WardrobeState, fresh: Fresh): string {
  const none =
    `<div class="elf-wd-tile elf-wd-tile--word elf-wd-tile--none">` +
    `<input type="radio" name="outfit" id="wd-outfit-none" value=""${look.outfit ? "" : " checked"} />` +
    `<label for="wd-outfit-none"><span class="elf-wd-name">No outfit: wear my own pieces</span></label></div>`;
  const tiles = OUTFITS.map((o) =>
    tile({
      name: "outfit",
      value: o.id,
      id: `wd-outfit-${o.id}`,
      art: drawOutfit(o.id, look, 72),
      caption: o.name,
      words: outfitWords(o.id),
      checked: look.outfit === o.id,
      lock: outfitUnlocked(o.id, state) ? undefined : outfitLock(o),
      fresh: fresh.outfits.has(o.id),
      kind: "outfit",
    }),
  ).join("");
  return (
    `<fieldset class="elf-wd-group elf-wd-group--named elf-wd-outfits"><legend>Outfits</legend>` +
    `<p class="elf-wd-note">A whole outfit covers everything else. A new one arrives with every third door.</p>` +
    none +
    `<div class="elf-wd-row elf-wd-row--outfits">${tiles}</div></fieldset>`
  );
}

function styleRow(style: WardrobeStyle, slot: WardrobeSlot, look: ElfLook, state: WardrobeState, fresh: Fresh): string {
  const worn = look.pieces[slot.id];
  const tiles = style.colours
    .map((c) =>
      tile({
        name: `piece-${slot.id}`,
        value: `${style.id}:${c.id}`,
        id: `wd-p-${style.id}-${c.id}`,
        art: drawPiece(style.id, c.id, 56),
        caption: c.name,
        words: pieceWords(style.id, c.id),
        checked: !!worn && worn[0] === style.id && worn[1] === c.id,
        lock: pieceUnlocked(style.id, c.id, state) ? undefined : doorsLock(c.door),
        fresh: fresh.pieces.has(`${style.id}:${c.id}`),
      }),
    )
    .join("");
  return `<div class="elf-wd-style"><p class="elf-wd-style__name">${escapeHtml(style.name)}</p><div class="elf-wd-row">${tiles}</div></div>`;
}

function slotPanel(slot: WardrobeSlot, look: ElfLook, state: WardrobeState, fresh: Fresh): string {
  const none = slot.optional ? wordTile(`piece-${slot.id}`, `wd-none-${slot.id}`, "", "None", !look.pieces[slot.id]) : "";
  const rows = STYLES.filter((s) => s.slot === slot.id)
    .map((s) => styleRow(s, slot, look, state, fresh))
    .join("");
  return `<fieldset class="elf-wd-group elf-wd-group--named elf-wd-slot"><legend>${escapeHtml(slot.name)}</legend>${none}<div class="elf-wd-styles">${rows}</div></fieldset>`;
}

/** The news that things have arrived, or nothing when nothing has. */
function newsHtml(fresh: Fresh): string {
  const things = [
    ...OUTFITS.filter((o) => fresh.outfits.has(o.id)).map((o) => `the ${inSentence(outfitWords(o.id))}`),
    ...STYLES.flatMap((s) => s.colours.filter((c) => fresh.pieces.has(`${s.id}:${c.id}`)).map((c) => inSentence(pieceWords(s.id, c.id)))),
  ];
  if (things.length === 0) return "";
  const named = things.length > NEWS_NAMED ? [...things.slice(0, NEWS_NAMED - 1), `${things.length - (NEWS_NAMED - 1)} more`] : things;
  const sentence = listWords(named);
  return (
    `<div class="elf-wd-news">${gift(44)}<div>` +
    `<p class="elf-wd-news__title">${things.length} new ${things.length === 1 ? "thing has" : "things have"} arrived</p>` +
    `<p>${escapeHtml(sentence.charAt(0).toUpperCase() + sentence.slice(1))}.</p>` +
    `</div></div>`
  );
}

/** The whole wardrobe page. */
export function renderWardrobePage(view: WardrobeView): string {
  const d = view.detective;
  const state: WardrobeState = { doorsDone: doorsOf(view.state), goldSeal: view.state?.goldSeal === true, wonRace: view.state?.wonRace === true };
  const look = normaliseLook(view.look, state);
  const fresh = freshThings(view.fresh, state);
  const name = escapeHtml(d.name);
  const hq = sitePath(view.hqUrl) ?? "/";

  const sections: { id: string; name: string; isNew: boolean; html: string }[] = [
    { id: "wd-look", name: "Skin and hair", isNew: false, html: lookPanel(look) },
    { id: "wd-outfits", name: "Outfits", isNew: fresh.outfits.size > 0, html: outfitsPanel(look, state, fresh) },
    ...SLOTS.map((slot) => ({
      id: `wd-slot-${slot.id}`,
      name: slot.name,
      isNew: STYLES.some((s) => s.slot === slot.id && s.colours.some((c) => fresh.pieces.has(`${s.id}:${c.id}`))),
      html: slotPanel(slot, look, state, fresh),
    })),
  ];
  const tabs = sections
    .map(
      (s) =>
        `<li><a class="elf-wd-tab" href="#${s.id}">${escapeHtml(s.name)}` +
        `${s.isNew ? '<span class="elf-wd-tab__new"><span class="sr-only">, new things</span></span>' : ""}</a></li>`,
    )
    .join("");
  const panels = sections.map((s) => `<div class="elf-wd-panel" id="${s.id}">${s.html}</div>`).join("\n        ");

  const main = `  <section class="page-top elf-top elf-wd-top" aria-labelledby="elf-wd-heading">
    <div class="wrap">
      <span class="eyebrow">Elf Detective School</span>
      <h1 id="elf-wd-heading">The wardrobe</h1>
      <p class="lede">Three new things arrive with every door, and a whole new outfit with every third door.</p>
    </div>
  </section>

  <section class="elf-wd-section" aria-label="Dress the elf">
    <div class="wrap">
      ${newsHtml(fresh)}
      <form class="elf-wd" method="post" action="${sitePath(view.saveUrl) ?? "/"}" data-api="/api/elf/look" data-doors="${state.doorsDone}" data-gold="${state.goldSeal ? 1 : 0}" data-race="${state.wonRace ? 1 : 0}">
        <input type="hidden" name="detective" value="${escapeHtml(d.id)}" />
        <div class="elf-wd-preview">
          <div class="elf-wd-mirror">${drawElf(look, state, { size: 260, backdrop: false, key: "preview", label: `${d.name}'s elf` })}</div>
          <div class="elf-wd-preview__body">
            <h2>${name}</h2>
            <p class="elf-wd-preview__rank">Badge ${escapeHtml(d.badgeNumber)} &middot; <b>${escapeHtml(d.rank)}</b></p>
            <p class="elf-wd-wearing">Wearing: <span>${escapeHtml(lookWords(look, state))}</span>.</p>
            <p class="elf-wd-status" role="status"></p>
            <button class="btn btn-primary" type="submit">Save this look</button>
          </div>
        </div>
        <div class="elf-wd-choices">
          <ul class="elf-wd-tabs">${tabs}</ul>
        ${panels}
          <p class="elf-wd-back"><a class="elf-link" href="${hq}">Back to Detective HQ</a></p>
        </div>
      </form>
    </div>
  </section>`;

  return elfPage({
    title: "The wardrobe",
    description: "Dress your elf detective: hats, scarves, gadgets and whole outfits that unlock as the doors open.",
    cta: { href: view.hqUrl, label: "Detective HQ" },
    home: view.calendarUrl,
    main,
    scripts: ["elf-wardrobe.js", "elf-wardrobe-ui.js"],
  });
}
